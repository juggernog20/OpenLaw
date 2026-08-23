// SPDX-License-Identifier: AGPL-3.0-only

/** M22/5's record interactions through the real router and typed API client. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u-admin",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
};
const MEMBER = {
  id: "u-member",
  displayName: "Mina Member",
  image: null,
  archived: false,
  role: "legal_team_member",
};
const FIELD = {
  fieldId: "f-unit",
  slug: "business-unit",
  displayName: "Business unit",
  description: null,
  fieldType: "text",
  options: null,
  displayOrder: 1,
  isRequired: true,
};
const TYPES = [
  { id: "t-general", slug: "general", displayName: "General", fields: [] },
  { id: "t-employment", slug: "employment", displayName: "Employment", fields: [FIELD] },
];
const STATUSES = [
  { id: "s-open", slug: "open", displayName: "Open", category: "open" },
  { id: "s-review", slug: "review", displayName: "Review", category: "open" },
  { id: "s-closed", slug: "closed", displayName: "Closed", category: "closed" },
];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-12",
    number: 12,
    title: "Editable advice",
    description: "Initial description",
    matterTypeId: "t-general",
    matterTypeName: "General",
    statusId: "s-open",
    statusName: "Open",
    statusCategory: "open",
    manager: null,
    priority: "medium",
    risk: null,
    customFields: {},
    openedAt: "2026-08-23T08:00:00.000Z",
    closedAt: null,
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    updatedAt: "2026-08-23T08:00:00.000Z",
    ...overrides,
  };
}

function record(matter: ReturnType<typeof row>, team: unknown[] = []) {
  const type = TYPES.find((candidate) => candidate.id === matter.matterTypeId)!;
  return {
    matter,
    fields: type.fields,
    customFieldRefs: { users: [], entities: [] },
    team,
  };
}

function options() {
  return json(200, { matterTypes: TYPES, matterStatuses: STATUSES, users: [MEMBER] });
}

describe("the editable matter record", () => {
  it("commits inline fields independently and groups every live status by category", async () => {
    let saved = row();
    const patches: unknown[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET")
          return json(200, record(saved));
        if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET")
          return options();
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "PATCH") {
          patches.push(call.body);
          const body = call.body as Record<string, unknown>;
          if (body.title) saved = row({ ...saved, title: body.title });
          if (body.statusId) {
            const status = STATUSES.find((candidate) => candidate.id === body.statusId)!;
            saved = row({
              ...saved,
              statusId: status.id,
              statusName: status.displayName,
              statusCategory: status.category,
              closedAt: status.category === "closed" ? "2026-08-23T09:00:00.000Z" : null,
            });
          }
          return json(200, record(saved));
        }
        return undefined;
      },
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Renamed advice{Enter}");
    await waitFor(() => expect(patches).toContainEqual({ title: "Renamed advice" }));

    const status = screen.getByRole("combobox", { name: "Status" });
    const groups = within(status).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("label"))).toEqual(["Open", "Closed"]);
    expect(
      within(groups[0]!)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Open", "Review"]);
    await user.selectOptions(status, "s-closed");
    await waitFor(() => expect(patches).toContainEqual({ statusId: "s-closed" }));
    await waitFor(() => expect(status).toHaveValue("s-closed"));
  });

  it("shows a PATCH refusal beside its field and lets that field retry", async () => {
    let saved = row();
    let patchCount = 0;
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET")
          return json(200, record(saved));
        if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET")
          return options();
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1) return problem(400, "Title is required.");
          saved = row({ ...saved, title: (call.body as { title: string }).title });
          return json(200, record(saved));
        }
        return undefined;
      },
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Refused once{Enter}");
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(title).toBeEnabled();

    await user.clear(title);
    await user.type(title, "Accepted next{Enter}");
    await waitFor(() => expect(title).toHaveValue("Accepted next"));
    expect(patchCount).toBe(2);
  });

  it("prompts for re-type gaps and commits the type with those values once", async () => {
    let saved = row();
    const patches: unknown[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET")
          return json(200, record(saved));
        if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET")
          return options();
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "PATCH") {
          patches.push(call.body);
          const body = call.body as { matterTypeId: string; customFields: Record<string, string> };
          saved = row({
            ...saved,
            matterTypeId: body.matterTypeId,
            matterTypeName: "Employment",
            customFields: body.customFields,
          });
          return json(200, record(saved));
        }
        return undefined;
      },
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Matter type"), "t-employment");
    const dialog = await screen.findByRole("dialog", {
      name: "Change matter type to Employment",
    });
    await user.type(within(dialog).getByLabelText(/Business unit/), "People");
    await user.click(within(dialog).getByRole("button", { name: "Change type" }));
    await waitFor(() =>
      expect(patches).toEqual([
        { matterTypeId: "t-employment", customFields: { "business-unit": "People" } },
      ]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("works the team tray, draws the confidential banner, and confirms archive and restore", async () => {
    const creator = {
      id: ADMIN.id,
      displayName: ADMIN.displayName,
      image: null,
      archived: false,
      role: "creator",
    };
    let saved = row({ isConfidential: true });
    let team: unknown[] = [creator];
    const calls: StubCall[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET")
          return json(200, record(saved, team));
        if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET")
          return options();
        if (call.url.pathname === "/api/v1/matters/12/team" && call.method === "POST") {
          calls.push(call);
          team = [...team, { ...MEMBER, role: (call.body as { role: string }).role }];
          return json(201, { team });
        }
        if (
          call.url.pathname === "/api/v1/matters/12/team/u-member/watcher" &&
          call.method === "DELETE"
        ) {
          calls.push(call);
          team = [creator];
          return json(200, { team });
        }
        if (call.url.pathname === "/api/v1/matters/12/archive" && call.method === "POST") {
          calls.push(call);
          saved = row({ ...saved, archivedAt: "2026-08-23T10:00:00.000Z" });
          return json(200, { matter: saved });
        }
        if (call.url.pathname === "/api/v1/matters/12/restore" && call.method === "POST") {
          calls.push(call);
          saved = row({ ...saved, archivedAt: null });
          return json(200, { matter: saved });
        }
        return undefined;
      },
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    expect(
      await screen.findByText(
        "Confidential matter — the matter team, the Matter Manager, and Administrators see it.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add team member" }));
    const add = await screen.findByRole("dialog", { name: "Add team member" });
    await user.selectOptions(within(add).getByLabelText("Person"), MEMBER.id);
    await user.selectOptions(within(add).getByLabelText("Role"), "watcher");
    await user.click(within(add).getByRole("button", { name: "Add to team" }));
    expect(
      within(screen.getByRole("complementary", { name: "Matter team" })).getByText(
        MEMBER.displayName,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Take Mina Member off/ }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === "DELETE" && call.url.pathname.endsWith("/watcher")),
      ).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    const archive = await screen.findByRole("dialog", { name: "Archive Editable advice?" });
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    const restore = await screen.findByRole("dialog", { name: "Restore Editable advice?" });
    await user.click(within(restore).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(calls.map((call) => call.url.pathname)).toEqual(
        expect.arrayContaining(["/api/v1/matters/12/archive", "/api/v1/matters/12/restore"]),
      ),
    );
  });
});
