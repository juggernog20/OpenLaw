// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts/:number record page (M8/1), through the real route
 * table with the standard fetch stub: Member+ lands on the record at
 * its number-based address, edits a field in place (DES-017 — blur
 * commits one PATCH, Escape commits none), sets the status, priority,
 * and risk from their selects, archives the record (every input
 * freezes, the sub-bar action flips), and restores it. The activity bar
 * mounts with the applet set that exists before M9. Contributors are
 * bounced home; unauthenticated visitors land on login.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
};

const OPTIONS = {
  contractTypes: [
    { id: "t-nda", slug: "nda", displayName: "NDA" },
    { id: "t-msa", slug: "msa", displayName: "MSA" },
  ],
  contractStatuses: [
    { id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" },
    { id: "s-redlining", slug: "redlining", displayName: "Redlining", stage: "review" },
    { id: "s-active", slug: "active", displayName: "Active", stage: "active" },
  ],
};

function contractRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-draft",
    statusName: "Draft",
    stage: "draft",
    priority: "medium",
    risk: null,
    description: "Three-year platform engagement.",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The record loader's two reads plus the mutations under test. The
 * record is stateful: mutations answer with the row they produce, and
 * later GETs answer the latest row. */
function recordApi(initial: Record<string, unknown>) {
  let row = initial;
  const patches: unknown[] = [];
  const posts: string[] = [];
  const statusById = new Map(OPTIONS.contractStatuses.map((status) => [status.id, status]));
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as Record<string, unknown>;
      const status = typeof body.statusId === "string" ? statusById.get(body.statusId) : undefined;
      row = {
        ...row,
        ...body,
        ...(status ? { statusName: status.displayName, stage: status.stage } : {}),
      };
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42/archive" && call.method === "POST") {
      posts.push("archive");
      row = { ...row, archivedAt: "2026-08-12T00:00:00.000Z" };
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42/restore" && call.method === "POST") {
      posts.push("restore");
      row = { ...row, archivedAt: null };
      return json(200, { contract: row });
    }
    return undefined;
  };
  return { handler, patches, posts };
}

describe("the /contracts/:number record page", () => {
  it("shows a Legal Team Member the record at its number-based address", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme master services agreement" }),
    ).toBeInTheDocument();
    // The sub-bar carries the breadcrumb, the reference, and the status
    // pill (the nav also links to Contracts, and the status select's
    // options carry the same labels).
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(within(subbar).getByText("C-42")).toBeInTheDocument();
    expect(within(subbar).getByText("Draft")).toBeInTheDocument();

    expect(screen.getByLabelText("Title")).toHaveValue("Acme master services agreement");
    expect(screen.getByLabelText("Status")).toHaveValue("s-draft");
    expect(screen.getByLabelText("Priority")).toHaveValue("medium");
    // Risk stays empty until legal assesses it (CTR-005).
    expect(screen.getByLabelText("Risk")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("Three-year platform engagement.");
    // The type is shown, not editable here — re-typing re-checks the
    // type's required fields, which lands with the field work.
    expect(screen.getByText("MSA")).toBeInTheDocument();
  });

  it("mounts the activity bar with the applet set that exists before M9", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    expect(within(bar).getByRole("link", { name: "Contract settings" })).toHaveAttribute(
      "href",
      "/settings/contracts",
    );
  });

  it("commits an edited field on blur as one PATCH (DES-017) and notes Saved", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Acme MSA");
    await user.tab();

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(api.patches).toEqual([{ title: "Acme MSA" }]);
    // The heading follows the committed title.
    expect(screen.getByRole("heading", { level: 1, name: "Acme MSA" })).toBeInTheDocument();
  });

  it("reverts an in-progress edit on Escape without a PATCH", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const description = await screen.findByLabelText("Description");
    await user.clear(description);
    await user.type(description, "wrong context");
    await user.keyboard("{Escape}");

    expect(description).toHaveValue("Three-year platform engagement.");
    await user.tab();
    expect(api.patches).toEqual([]);
  });

  it("changes the status to any other status, and the pill follows the new label", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Status"), "s-active");
    await waitFor(() => expect(api.patches).toEqual([{ statusId: "s-active" }]));
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByText("Active")).toBeInTheDocument();

    // Backwards too — deals collapse and reopen (CTR-001).
    await user.selectOptions(screen.getByLabelText("Status"), "s-redlining");
    await waitFor(() =>
      expect(api.patches).toEqual([{ statusId: "s-active" }, { statusId: "s-redlining" }]),
    );
  });

  it("sets priority and risk from the shared severity ramp, and clears risk again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Priority"), "critical");
    await waitFor(() => expect(api.patches).toEqual([{ priority: "critical" }]));

    await user.selectOptions(screen.getByLabelText("Risk"), "high");
    await waitFor(() => expect(api.patches).toEqual([{ priority: "critical" }, { risk: "high" }]));

    // Back to not-yet-assessed, which is a null, not a level.
    await user.selectOptions(screen.getByLabelText("Risk"), "");
    await waitFor(() =>
      expect(api.patches).toEqual([{ priority: "critical" }, { risk: "high" }, { risk: null }]),
    );
  });

  it("shows the API's refusal beside the field when a commit fails", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, { contract: contractRow() });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          return problem(400, "The status must be a live contract status.");
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Status"), "s-active");
    expect(
      await screen.findByText("The status must be a live contract status."),
    ).toBeInTheDocument();
    // The select still shows the saved truth — nothing was adopted.
    expect(screen.getByLabelText("Status")).toHaveValue("s-draft");
  });

  it("keeps a saved status the picker no longer offers selectable as itself", async () => {
    const api = recordApi(contractRow({ statusId: "s-archived", statusName: "Superseded" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const select = await screen.findByLabelText("Status");
    expect(select).toHaveValue("s-archived");
    expect(
      within(select as HTMLElement).getByRole("option", { name: "Superseded" }),
    ).toBeInTheDocument();
  });

  it("archives the record — every input freezes and the action flips — then restores it", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.posts).toEqual(["archive"]));
    expect(screen.getByText(/This contract is archived/)).toBeInTheDocument();
    for (const label of ["Title", "Status", "Priority", "Risk", "Description"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.posts).toEqual(["archive", "restore"]));
    expect(screen.queryByText(/This contract is archived/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("bounces a Contributor home", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
