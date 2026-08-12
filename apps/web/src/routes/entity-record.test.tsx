// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /entities/:entityId record page (ENT-001/ENT-004, #99), through
 * the real route table with the standard fetch stub: Member+ lands on
 * the identity card with every field populated, corrects a field in
 * place (DES-017 — blur commits one PATCH, Escape reverts without
 * one), sets the type and the status from their selects, archives the
 * record (fields freeze, the sub-bar action flips), and restores it.
 * Contributors are bounced home; unauthenticated visitors land on
 * login.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

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

const TYPE_OPTIONS = [
  { id: "t-corp", slug: "corporation", displayName: "Corporation" },
  { id: "t-llc", slug: "llc", displayName: "LLC" },
];

function entityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "e1",
    legalName: "Aldgate Holdings Ltd",
    entityTypeId: "t-corp",
    entityTypeName: "Corporation",
    jurisdiction: "England & Wales",
    formedOn: "2014-03-12",
    registrationNumber: "08841201",
    taxId: "GB 927 4801 33",
    registeredAgent: "Aldgate Corporate Services Ltd",
    registeredAddress: "1 Gresham Street, London EC2V 7BX, United Kingdom",
    status: "active",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The record loader's two reads plus the mutations under test, over
 * the standard stub. The record is stateful: mutations answer with the
 * row they produce, and later GETs answer the latest row. */
function recordApi(initial: Record<string, unknown>) {
  let row = initial;
  const patches: unknown[] = [];
  const posts: string[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/entities/e1" && call.method === "GET") {
      return json(200, { entity: row });
    }
    if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
      return json(200, { entityTypes: TYPE_OPTIONS });
    }
    if (call.url.pathname === "/api/v1/entities/e1" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as Record<string, unknown>;
      row = {
        ...row,
        ...body,
        ...(body.entityTypeId === "t-llc" ? { entityTypeName: "LLC" } : {}),
      };
      return json(200, { entity: row });
    }
    if (call.url.pathname === "/api/v1/entities/e1/archive" && call.method === "POST") {
      posts.push("archive");
      row = { ...row, archivedAt: "2026-08-12T00:00:00.000Z" };
      return json(200, { entity: row });
    }
    if (call.url.pathname === "/api/v1/entities/e1/restore" && call.method === "POST") {
      posts.push("restore");
      row = { ...row, archivedAt: null };
      return json(200, { entity: row });
    }
    return undefined;
  };
  return { handler, patches, posts };
}

describe("the /entities/:entityId record page", () => {
  it("shows a Legal Team Member the full identity card", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(entityRow()).handler });
    renderAt("/entities/e1");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Aldgate Holdings Ltd" }),
    ).toBeInTheDocument();
    // The breadcrumb leads back to the registry, and the status pill rides
    // beside the title (both scoped to the sub-bar region — the nav also
    // links to Entities, and the status select's options carry the same
    // labels).
    const subbar = screen.getByRole("region", { name: "Aldgate Holdings Ltd" });
    expect(within(subbar).getByRole("link", { name: "Entities" })).toHaveAttribute(
      "href",
      "/entities",
    );
    expect(within(subbar).getByText("Active")).toBeInTheDocument();

    expect(screen.getByLabelText("Legal name")).toHaveValue("Aldgate Holdings Ltd");
    expect(screen.getByLabelText("Entity type")).toHaveValue("t-corp");
    expect(screen.getByLabelText("Status")).toHaveValue("active");
    expect(screen.getByLabelText("Formation jurisdiction")).toHaveValue("England & Wales");
    expect(screen.getByLabelText("Formed on")).toHaveValue("2014-03-12");
    expect(screen.getByLabelText("Registration no.")).toHaveValue("08841201");
    expect(screen.getByLabelText("Tax ID")).toHaveValue("GB 927 4801 33");
    expect(screen.getByLabelText("Registered agent")).toHaveValue(
      "Aldgate Corporate Services Ltd",
    );
    expect(screen.getByLabelText("Registered address")).toHaveValue(
      "1 Gresham Street, London EC2V 7BX, United Kingdom",
    );
  });

  it("commits a corrected field on blur as one PATCH (DES-017) and notes Saved", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    const jurisdiction = await screen.findByLabelText("Formation jurisdiction");
    await user.clear(jurisdiction);
    await user.type(jurisdiction, "England");
    await user.tab();

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(api.patches).toEqual([{ jurisdiction: "England" }]);
  });

  it("reverts an in-progress edit on Escape without a PATCH", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    const taxId = await screen.findByLabelText("Tax ID");
    await user.clear(taxId);
    await user.type(taxId, "wrong value");
    await user.keyboard("{Escape}");

    expect(taxId).toHaveValue("GB 927 4801 33");
    await user.tab();
    expect(api.patches).toEqual([]);
  });

  it("renames the entity — the title follows the committed legal name", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    const legalName = await screen.findByLabelText("Legal name");
    await user.clear(legalName);
    await user.type(legalName, "Aldgate Group Ltd{Enter}");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Aldgate Group Ltd" }),
      ).toBeInTheDocument(),
    );
    expect(api.patches).toEqual([{ legalName: "Aldgate Group Ltd" }]);
  });

  it("changes the type and the status from their selects", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Entity type"), "t-llc");
    await waitFor(() => expect(api.patches).toEqual([{ entityTypeId: "t-llc" }]));

    await user.selectOptions(screen.getByLabelText("Status"), "dormant");
    await waitFor(() =>
      expect(api.patches).toEqual([{ entityTypeId: "t-llc" }, { status: "dormant" }]),
    );
    // The sub-bar pill follows the saved status.
    const subbar = screen.getByRole("region", { name: "Aldgate Holdings Ltd" });
    expect(within(subbar).getByText("Dormant")).toBeInTheDocument();
  });

  it("archives the record — fields freeze and the action flips — then restores it", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.posts).toEqual(["archive"]));
    expect(screen.getByText(/This entity is archived/)).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.posts).toEqual(["archive", "restore"]));
    expect(screen.queryByText(/This entity is archived/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("opens an archived record read-only, with restore on offer", async () => {
    const api = recordApi(entityRow({ archivedAt: "2026-08-10T00:00:00.000Z" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");

    expect(await screen.findByText(/This entity is archived/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.getByLabelText("Registered agent")).toBeDisabled();
  });

  it("bounces a Contributor home", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    renderAt("/entities/e1");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/entities/e1");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
