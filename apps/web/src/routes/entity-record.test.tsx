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
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
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
    sharesAuthorized: null,
    sharesIssued: null,
    parValue: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The record loader's two reads plus the mutations under test, over
 * the standard stub. The record is stateful: mutations answer with the
 * row they produce, and later GETs answer the latest row. */
function recordApi(
  initial: Record<string, unknown>,
  linked: {
    counts?: { contracts: number; matters: number };
    contracts?: unknown[];
    matters?: unknown[];
  } = {},
) {
  let row = initial;
  const patches: unknown[] = [];
  const posts: string[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/entities/e1" && call.method === "GET") {
      return json(200, { entity: row, fields: [], customFieldRefs: { users: [], entities: [] } });
    }
    if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
      return json(200, { entityTypes: TYPE_OPTIONS });
    }
    if (call.url.pathname === "/api/v1/entities/e1/linked-record-counts" && call.method === "GET") {
      return json(200, linked.counts ?? { contracts: 0, matters: 0 });
    }
    if (call.url.pathname === "/api/v1/entities/e1/contracts" && call.method === "GET") {
      return json(200, { records: linked.contracts ?? [] });
    }
    if (call.url.pathname === "/api/v1/entities/e1/matters" && call.method === "GET") {
      return json(200, { records: linked.matters ?? [] });
    }
    if (call.url.pathname === "/api/v1/entities/e1/documents" && call.method === "GET") {
      return json(200, { documents: [], nextCursor: null });
    }
    if (call.url.pathname === "/api/v1/entities/e1/folders" && call.method === "GET") {
      return json(200, { folders: [] });
    }
    if (call.url.pathname === "/api/v1/entities/e1" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as Record<string, unknown>;
      row = {
        ...row,
        ...body,
        ...(body.entityTypeId === "t-llc" ? { entityTypeName: "LLC" } : {}),
      };
      return json(200, { entity: row, fields: [], customFieldRefs: { users: [], entities: [] } });
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
  it("draws the DD-014 banner and CONFI marker and opens the Administrator grant dialog", async () => {
    const api = recordApi(entityRow({ isConfidential: true }));
    const writes: unknown[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/grants" && call.method === "GET") {
          return json(200, {
            grants: [{ id: "u2", displayName: "Nadia Counsel", image: null, archived: false }],
            candidates: [
              { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
              { id: "u4", displayName: "Sarah Chen", image: null, archived: false },
            ],
          });
        }
        if (call.url.pathname === "/api/v1/entities/e1/grants" && call.method === "POST") {
          writes.push(call.body);
          return json(201, {
            grant: { id: "u4", displayName: "Sarah Chen", image: null, archived: false },
          });
        }
        return api.handler(call);
      },
    });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    expect(await screen.findByRole("region", { name: "Confidential Entity" })).toHaveTextContent(
      "Administrators and granted Legal Team Members see it",
    );
    expect(screen.getByText("CONFI")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage access" }));
    expect(await screen.findByRole("dialog", { name: "Confidential access" })).toBeInTheDocument();
    expect(screen.getByText("Nadia Counsel")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Legal Team Member" }), "u4");
    await user.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(writes).toEqual([{ userId: "u4" }]));
  });

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
    expect(screen.getByLabelText("Registered agent")).toHaveValue("Aldgate Corporate Services Ltd");
    expect(screen.getByLabelText("Registered address")).toHaveValue(
      "1 Gresham Street, London EC2V 7BX, United Kingdom",
    );
  });

  it("renders every Overview section and commits share capital per field", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    for (const heading of ["Registry", "Share capital", "Fields", "Officers", "Registrations"]) {
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    }
    const authorized = screen.getByLabelText("Authorized shares");
    await user.type(authorized, "1000000");
    await user.tab();
    await waitFor(() => expect(api.patches).toContainEqual({ sharesAuthorized: 1_000_000 }));
  });

  it("routes all six DES-032 sections and renders the shipped Obligations tab", async () => {
    const api = recordApi(entityRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/entities/e1");
    expect(await screen.findByRole("navigation", { name: "Entity sections" })).toBeInTheDocument();

    await router.navigate("/entities/e1/ownership");
    expect(await screen.findByRole("heading", { name: "Owners" })).toBeInTheDocument();

    await router.navigate("/entities/e1/obligations");
    expect(await screen.findByRole("heading", { name: "Obligations" })).toBeInTheDocument();
    expect(screen.getByText("No obligations for this Entity.")).toBeInTheDocument();

    for (const tab of ["documents", "contracts", "matters"]) {
      await router.navigate(`/entities/e1/${tab}`);
      expect(
        await screen.findByRole("heading", { name: tab[0]!.toUpperCase() + tab.slice(1) }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/later M27 ticket/)).not.toBeInTheDocument();
    }
  });

  it("shows scoped counts and opens rows from both generic roll-up tabs", async () => {
    const api = recordApi(entityRow(), {
      counts: { contracts: 1, matters: 1 },
      contracts: [
        {
          restricted: false,
          kind: "contract",
          id: "c1",
          number: 7,
          title: "Lease",
          statusName: "Active",
          statusCategory: "active",
          isConfidential: false,
          archived: false,
        },
      ],
      matters: [
        {
          restricted: false,
          kind: "matter",
          id: "m1",
          number: 8,
          title: "Dispute",
          statusName: "Open",
          statusCategory: "open",
          isConfidential: false,
          archived: false,
        },
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/entities/e1/contracts");
    expect(await screen.findByRole("link", { name: /C-7.*Lease/ })).toHaveAttribute(
      "href",
      "/contracts/7",
    );
    expect(screen.getByRole("img", { name: "1 linked Contract" })).toBeInTheDocument();
    await router.navigate("/entities/e1/matters");
    expect(await screen.findByRole("link", { name: /M-8.*Dispute/ })).toHaveAttribute(
      "href",
      "/matters/8",
    );
    expect(screen.getByRole("img", { name: "1 linked Matter" })).toBeInTheDocument();
  });

  it("mounts the Activity applet with the Entity reference", async () => {
    const api = recordApi(entityRow());
    const activityCalls: string[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/activity") {
          activityCalls.push(call.url.search);
          return json(200, { entries: [], nextCursor: null });
        }
        return api.handler(call);
      },
    });
    renderAt("/entities/e1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "History" }));
    await waitFor(() => expect(activityCalls).toEqual(["?entityType=entity&entityId=e1"]));
  });

  it("commits an attached Field through the Fields card as one PATCH", async () => {
    const api = recordApi(entityRow());
    const field = {
      fieldId: "f1",
      slug: "reporting_code",
      displayName: "Reporting code",
      description: null,
      fieldType: "text",
      fieldTag: "legal",
      options: null,
      displayOrder: 1,
      isRequired: false,
    };
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        const answer = api.handler(call);
        if (call.url.pathname !== "/api/v1/entities/e1" || !answer) return answer;
        // Keep the stub's own row, so the committed value reads back;
        // only add the attachment the Fields card draws.
        return answer
          .json()
          .then((body) => json(200, { ...(body as Record<string, unknown>), fields: [field] }));
      },
    });
    renderAt("/entities/e1");
    const user = userEvent.setup();
    const control = await screen.findByLabelText("Reporting code");
    await user.type(control, "ENT-44");
    await user.tab();
    await waitFor(() =>
      expect(api.patches).toContainEqual({ customFields: { reporting_code: "ENT-44" } }),
    );
    expect(screen.getByLabelText("Reporting code")).toHaveValue("ENT-44");
  });

  it("adds, resigns, and removes an officer through the Officers card", async () => {
    const api = recordApi(entityRow());
    const officer = (overrides: Record<string, unknown>) => ({
      id: "o1",
      entityId: "e1",
      name: "Dana Director",
      officerRoleId: "r-director",
      officerRoleName: "Director",
      appointedOn: "2025-02-03",
      resignedOn: null,
      user: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      ...overrides,
    });
    const writes: { method: string; path: string; body: unknown }[] = [];
    let held: Record<string, unknown> | null = null;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/officers" && call.method === "GET") {
          const former = call.url.searchParams.get("includeFormer") === "true";
          return json(200, {
            officers: held && (former || held.resignedOn === null) ? [held] : [],
          });
        }
        if (call.url.pathname === "/api/v1/entities/officer-roles") {
          return json(200, {
            officerRoles: [{ id: "r-director", slug: "director", displayName: "Director" }],
            users: [
              { id: "u2", displayName: "Nadia Counsel", image: null, role: "legal_team_member" },
            ],
          });
        }
        if (call.url.pathname === "/api/v1/entities/e1/officers" && call.method === "POST") {
          writes.push({ method: "POST", path: call.url.pathname, body: call.body });
          held = officer(call.body as Record<string, unknown>);
          return json(201, { officer: held });
        }
        if (call.url.pathname === "/api/v1/entities/e1/officers/o1") {
          writes.push({ method: call.method, path: call.url.pathname, body: call.body });
          if (call.method === "DELETE") {
            held = null;
            return new Response(null, { status: 204 });
          }
          held = { ...held, ...(call.body as Record<string, unknown>) };
          return json(200, { officer: held });
        }
        return api.handler(call);
      },
    });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    expect(await screen.findByText("No current officers.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add officer" }));
    await user.type(screen.getByLabelText("Officer name"), "Dana Director");
    await user.type(screen.getByLabelText("Appointed on"), "2025-02-03");
    await user.selectOptions(screen.getByLabelText("Linked user"), "u2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByLabelText("Dana Director Officer name")).toHaveValue("Dana Director");
    expect(writes).toEqual([
      {
        method: "POST",
        path: "/api/v1/entities/e1/officers",
        body: {
          name: "Dana Director",
          officerRoleId: "r-director",
          appointedOn: "2025-02-03",
          userId: "u2",
        },
      },
    ]);

    // Resigning moves the row out of the current list.
    await user.type(screen.getByLabelText("Dana Director Resigned on"), "2026-08-29");
    await user.tab();
    await waitFor(() =>
      expect(writes[1]).toEqual({
        method: "PATCH",
        path: "/api/v1/entities/e1/officers/o1",
        body: { resignedOn: "2026-08-29" },
      }),
    );
    expect(await screen.findByText("No current officers.")).toBeInTheDocument();

    // The former toggle reads the row back; remove deletes it.
    await user.click(screen.getByRole("checkbox", { name: "Show former" }));
    await user.click(await screen.findByRole("button", { name: "Remove Dana Director" }));
    await waitFor(() =>
      expect(writes.at(-1)).toMatchObject({
        method: "DELETE",
        path: "/api/v1/entities/e1/officers/o1",
      }),
    );
    expect(await screen.findByText("No current officers.")).toBeInTheDocument();
  });

  it("adds a registration, changes its status, and shows a refused row edit", async () => {
    const api = recordApi(entityRow());
    const registration = (overrides: Record<string, unknown>) => ({
      id: "g1",
      entityId: "e1",
      jurisdiction: "Delaware",
      registrationNumber: "DE-88412",
      registeredAgent: null,
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      ...overrides,
    });
    const writes: { method: string; body: unknown }[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/registrations" && call.method === "POST") {
          writes.push({ method: "POST", body: call.body });
          return json(201, { registration: registration(call.body as Record<string, unknown>) });
        }
        if (call.url.pathname === "/api/v1/entities/e1/registrations/g1") {
          writes.push({ method: call.method, body: call.body });
          const body = call.body as Record<string, unknown>;
          if (body.registeredAgent === "Nobody") {
            return problem(400, "The registered agent is not on file.");
          }
          return json(200, { registration: registration(body) });
        }
        return api.handler(call);
      },
    });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    expect(await screen.findByText("No additional registrations.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add registration" }));
    await user.type(screen.getByLabelText("Jurisdiction"), "Delaware");
    await user.type(screen.getByLabelText("Registration number"), "DE-88412");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const status = await screen.findByLabelText("Delaware Status");
    expect(status).toHaveValue("active");
    expect(writes[0]).toEqual({
      method: "POST",
      body: {
        jurisdiction: "Delaware",
        registrationNumber: "DE-88412",
        registeredAgent: null,
        status: "active",
      },
    });

    await user.selectOptions(status, "lapsed");
    await waitFor(() => expect(writes[1]).toEqual({ method: "PATCH", body: { status: "lapsed" } }));
    expect(screen.getByLabelText("Delaware Status")).toHaveValue("lapsed");

    // A refused row edit is visible with the add form closed.
    await user.type(screen.getByLabelText("Delaware Registered agent"), "Nobody");
    await user.tab();
    expect(await screen.findByText("The registered agent is not on file.")).toBeInTheDocument();
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

  it("shows the API's refusal beside the field when a commit fails", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1" && call.method === "GET") {
          return json(200, {
            entity: entityRow(),
            fields: [],
            customFieldRefs: { users: [], entities: [] },
          });
        }
        if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
          return json(200, { entityTypes: TYPE_OPTIONS });
        }
        if (call.url.pathname === "/api/v1/entities/e1" && call.method === "PATCH") {
          return problem(400, "The entity type must be a live entity type.");
        }
        return undefined;
      },
    });
    renderAt("/entities/e1");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Entity type"), "t-llc");
    expect(
      await screen.findByText("The entity type must be a live entity type."),
    ).toBeInTheDocument();
    // The select still shows the saved truth — nothing was adopted.
    expect(screen.getByLabelText("Entity type")).toHaveValue("t-corp");
  });

  it("keeps a saved type that the picker read no longer offers selectable as itself", async () => {
    const api = recordApi(entityRow({ entityTypeId: "t-archived", entityTypeName: "Partnership" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1");

    const select = await screen.findByLabelText("Entity type");
    expect(select).toHaveValue("t-archived");
    // The archived type renders by its display name (ENT-008 keeps it
    // out of the picker read, but the record must not lie about it).
    expect(
      within(select as HTMLElement).getByRole("option", { name: "Partnership" }),
    ).toBeInTheDocument();
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

  it("shows the entity in the URL after moving between two records (#372)", async () => {
    const first = recordApi(entityRow());
    const second = entityRow({
      id: "e2",
      legalName: "Bishopsgate Trading Ltd",
      entityTypeId: "t-llc",
      entityTypeName: "LLC",
      jurisdiction: "Ireland",
      registrationNumber: "551204",
    });
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e2" && call.method === "GET") {
          return json(200, {
            entity: second,
            fields: [],
            customFieldRefs: { users: [], entities: [] },
          });
        }
        return first.handler(call);
      },
    });
    const { router } = renderAt("/entities/e1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Aldgate Holdings Ltd" }),
    ).toBeInTheDocument();

    await router.navigate("/entities/e2");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Bishopsgate Trading Ltd" }),
    ).toBeInTheDocument();
    // Every seeded draft moves with the record, not just the heading.
    expect(screen.getByLabelText("Legal name")).toHaveValue("Bishopsgate Trading Ltd");
    expect(screen.getByLabelText("Entity type")).toHaveValue("t-llc");
    expect(screen.getByLabelText("Formation jurisdiction")).toHaveValue("Ireland");
    expect(screen.getByLabelText("Registration no.")).toHaveValue("551204");
  });
});
