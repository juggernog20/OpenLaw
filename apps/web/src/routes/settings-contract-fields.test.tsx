// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Fields (#83) at the route seam: the DES-021 table variant
 * of the list-editor — column header, no reorder, the scope pill, the
 * prompt sparkle — with create and edit through the field-editor dialog
 * (type immutable after creation, options on select types, the prompt
 * on contract scope only) and the guard that archives without ever
 * reassigning. The API behaviors themselves are covered at the HTTP
 * seam in apps/api — these stubs only shape what this UI must react to.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = { ...ADMIN, id: "u2", email: "casey@example.com", role: "legal_team_member" };

/** The CTR-008 seeds: id, slug, name, type, tag, options, prompt. */
const SEEDS = [
  ["f1", "governing_law", "Governing law", "text", "legal", null, "Find the governing law."],
  ["f2", "jurisdiction", "Jurisdiction", "text", "legal", null, "Find the forum."],
  [
    "f3",
    "our_position",
    "Our position",
    "single_select",
    "business",
    ["Customer", "Provider", "Other"],
    "Decide our role.",
  ],
] as const;

interface StubFieldRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  moduleScope: string;
  fieldType: string;
  options: readonly string[] | null;
  fieldTag: string;
  aiPrompt: string | null;
  archivedAt: string | null;
  inUseCount: number;
}

function seededFields(archivedSlugs: string[] = []): StubFieldRow[] {
  return SEEDS.map(([id, slug, displayName, fieldType, fieldTag, options, aiPrompt]) => ({
    id,
    slug,
    displayName,
    description: null,
    moduleScope: "contract",
    fieldType,
    options,
    fieldTag,
    aiPrompt,
    archivedAt: archivedSlugs.includes(slug) ? "2026-08-10T12:00:00.000Z" : null,
    inUseCount: 0,
  }));
}

interface FieldCalls {
  creates: unknown[];
  patches: { id: string; body: unknown }[];
  scopes: { id: string; body: unknown }[];
  archives: string[];
  restores: string[];
}

function newCalls(): FieldCalls {
  return { creates: [], patches: [], scopes: [], archives: [], restores: [] };
}

/** Serves the seeded catalog and captures the pane's writes — the pane
 * holds its own row state, so the stub never needs to mutate. */
function fieldsApi(calls: FieldCalls, rows = seededFields()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/fields" && call.method === "GET") {
      return json(200, { fields: rows });
    }
    if (path === "/api/v1/fields" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as Record<string, unknown>;
      return json(201, {
        field: {
          id: "f-new",
          slug: "department",
          displayName: body.displayName,
          description: body.description ?? null,
          moduleScope: body.moduleScope,
          fieldType: body.fieldType,
          options: body.options ?? null,
          fieldTag: body.fieldTag,
          aiPrompt: body.aiPrompt ?? null,
          archivedAt: null,
          inUseCount: 0,
        },
      });
    }
    const patch = /^\/api\/v1\/fields\/([^/]+)$/.exec(path);
    if (patch && call.method === "PATCH") {
      calls.patches.push({ id: patch[1]!, body: call.body });
      return json(200, { field: { ...byId(patch[1]!), ...(call.body as object) } });
    }
    const scope = /^\/api\/v1\/fields\/([^/]+)\/scope$/.exec(path);
    if (scope && call.method === "PUT") {
      calls.scopes.push({ id: scope[1]!, body: call.body });
      const body = call.body as { moduleScope: string };
      return json(200, { field: { ...byId(scope[1]!), moduleScope: body.moduleScope } });
    }
    const archive = /^\/api\/v1\/fields\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push(archive[1]!);
      return json(200, { field: { ...byId(archive[1]!), archivedAt: "2026-08-12T09:00:00.000Z" } });
    }
    const restore = /^\/api\/v1\/fields\/([^/]+)\/restore$/.exec(path);
    if (restore && call.method === "POST") {
      calls.restores.push(restore[1]!);
      return json(200, { field: { ...byId(restore[1]!), archivedAt: null } });
    }
    return undefined;
  };
}

const fieldList = () => screen.getByRole("list");

/** Matches the innermost element whose full accessible text — sr-only
 * prefix plus visible label — is `text`; wrappers repeating the same
 * text are skipped, so pills inside plain cells stay unambiguous. */
const fullText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text &&
  ![...element.children].some((child) => child.textContent === text);

describe("the SET-002 gate on the pane", () => {
  it("bounces a Legal Team Member off the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/contracts/fields");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("the Contracts section tabs", () => {
  it("marks Fields current alongside Types and Statuses", async () => {
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls()) });
    renderAt("/settings/contracts/fields");
    await screen.findByText("Governing law");
    const tabs = screen.getByRole("navigation", { name: "Contracts panes" });
    expect(within(tabs).getByRole("link", { name: "Fields" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Types" })).toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: "Statuses" })).toBeInTheDocument();
  });
});

describe("the seeded catalog (CTR-008 core fields)", () => {
  it("renders the three seeds with type, scope, tag, and the prompt sparkle", async () => {
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls()) });
    renderAt("/settings/contracts/fields");
    await screen.findByText("Governing law");
    const items = within(fieldList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["Governing law", "Jurisdiction", "Our position"]);

    const first = items[0]!;
    expect(within(first).getByText(fullText("Type: Text"))).toBeInTheDocument();
    expect(within(first).getByText(fullText("Scope: Contract"))).toBeInTheDocument();
    expect(within(first).getByText(fullText("Tag: Legal"))).toBeInTheDocument();
    // Every seed carries a default prompt, marked by the sparkle.
    expect(
      within(first).getByRole("img", { name: "Governing law has an AI extraction prompt" }),
    ).toBeInTheDocument();

    expect(screen.getByText("3 fields")).toBeInTheDocument();
    expect(screen.getByText("Contract and global fields")).toBeInTheDocument();
    // The catalog is unordered: no reorder grips (DES-021).
    expect(screen.queryByRole("button", { name: /^Reorder/ })).not.toBeInTheDocument();
  });

  it("shows a dash, not a sparkle, on fields without a prompt", async () => {
    const rows = seededFields();
    const promptless = { ...rows[0]!, aiPrompt: null };
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls(), [promptless, ...rows.slice(1)]) });
    renderAt("/settings/contracts/fields");
    await screen.findByText("Governing law");
    const first = within(fieldList()).getAllByRole("listitem")[0]!;
    expect(
      within(first).queryByRole("img", { name: /AI extraction prompt/ }),
    ).not.toBeInTheDocument();
    expect(within(first).getByText("No AI prompt")).toBeInTheDocument();
  });
});

describe("in-place rename (DES-017)", () => {
  it("commits the display name only", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Jurisdiction" }));
    const input = screen.getByRole("textbox", { name: "Rename Jurisdiction" });
    await user.clear(input);
    await user.type(input, "Venue{Enter}");
    await waitFor(() =>
      expect(calls.patches).toEqual([{ id: "f2", body: { displayName: "Venue" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

describe("create (the field-editor dialog)", () => {
  it("creates a select field with options, scope, tag, and no prompt on global", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add field" }));

    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Department");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Type" }),
      "single_select",
    );
    // Picking a select type reveals the options editor.
    const options = within(dialog).getByRole("textbox", { name: "Options" });
    await user.type(options, "Legal{Enter}Procurement");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Scope" }), "global");
    // A global field takes no prompt: the prompt editor leaves.
    expect(within(dialog).queryByRole("textbox", { name: "AI prompt" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    await waitFor(() =>
      expect(calls.creates).toEqual([
        {
          displayName: "Department",
          moduleScope: "global",
          fieldType: "single_select",
          fieldTag: "business",
          options: ["Legal", "Procurement"],
        },
      ]),
    );
    expect(await screen.findByRole("button", { name: "Rename Department" })).toBeInTheDocument();
    expect(screen.getByText("4 fields")).toBeInTheDocument();
  });

  it("sends the prompt on a contract-scoped field", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Payment terms");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Type" }), "text");
    await user.type(
      within(dialog).getByRole("textbox", { name: "AI prompt" }),
      "Extract the payment terms.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    await waitFor(() =>
      expect(calls.creates).toEqual([
        {
          displayName: "Payment terms",
          moduleScope: "contract",
          fieldType: "text",
          fieldTag: "business",
          aiPrompt: "Extract the payment terms.",
        },
      ]),
    );
  });

  it("refuses to create without a type or without options on a select", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });

    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Half-formed");
    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Pick a type for the new field.",
    );

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Type" }),
      "multi_select",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Add at least one option, one per line.",
    );
    expect(calls.creates).toEqual([]);
  });
});

describe("edit (type immutable; scope promotes; prompt edits)", () => {
  it("locks the type, promotes the scope, and patches the prompt", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Governing law" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Governing law" });
    // The type renders as a fact, not a control (immutable after creation).
    expect(within(dialog).queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("The field type is immutable after creation."),
    ).toBeInTheDocument();

    const prompt = within(dialog).getByRole("textbox", { name: "AI prompt" });
    expect(prompt).toHaveValue("Find the governing law.");
    await user.clear(prompt);
    await user.type(prompt, "Extract the governing law clause.");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Scope" }), "global");
    // Promoting hides the prompt editor — prompts live on contract scope.
    expect(within(dialog).queryByRole("textbox", { name: "AI prompt" })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Scope" }), "contract");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.patches).toEqual([
        { id: "f1", body: { aiPrompt: "Extract the governing law clause." } },
      ]),
    );
    expect(calls.scopes).toEqual([]);
  });

  it("promotes to global through the scope route", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Jurisdiction" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Jurisdiction" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Scope" }), "global");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.scopes).toEqual([{ id: "f2", body: { moduleScope: "global" } }]),
    );
    // The list reflects the promotion.
    const row = screen.getByRole("button", { name: "Rename Jurisdiction" }).closest("li")!;
    expect(within(row).getByText(fullText("Scope: Global"))).toBeInTheDocument();
  });

  it("surfaces the server's narrowing refusal in the dialog", async () => {
    const calls = newCalls();
    const rows = seededFields();
    const globalRow = { ...rows[1]!, moduleScope: "contract" };
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (/\/scope$/.exec(call.url.pathname) && call.method === "PUT") {
          return problem(
            409,
            "Jurisdiction is attached outside the contract module — detach it there first.",
          );
        }
        return fieldsApi(calls, [rows[0]!, { ...globalRow, moduleScope: "global" }, rows[2]!])(
          call,
        );
      },
    });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Jurisdiction" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Jurisdiction" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Scope" }), "contract");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Jurisdiction is attached outside the contract module — detach it there first.",
    );
  });
});

describe("the archive guard (retention, never reassignment)", () => {
  it("archives through the modal, which never offers reassignment", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Our position" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Our position" });
    expect(
      within(dialog).getByText(
        "Our position is not attached to any type. The definition is kept and the field " +
          "can be restored.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("The change applies immediately and is recorded in the audit log."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive field" }));
    await waitFor(() => expect(calls.archives).toEqual(["f3"]));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Rename Our position" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("2 fields")).toBeInTheDocument();
  });

  it("labels an in-use field's count as type attachments, not records", async () => {
    // Records don't exist until M8/M22 — the count is attachments only,
    // and the dialog must say so.
    const calls = newCalls();
    const rows = seededFields().map((row) => (row.id === "f3" ? { ...row, inUseCount: 3 } : row));
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls, rows) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Our position" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Our position" });
    expect(
      within(dialog).getByText(
        "Our position is attached to 3 types — the attachments are kept, hidden until " +
          "the field is restored.",
      ),
    ).toBeInTheDocument();
  });

  it("reveals archived rows greyed with a pill and restores them", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls, seededFields(["our_position"])) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await screen.findByText("Governing law");
    expect(screen.queryByText("Our position")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    const row = screen.getByText("Our position").closest("li")!;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    // Archived rows offer restore only — no edit.
    expect(within(row).queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Restore Our position" }));
    await waitFor(() => expect(calls.restores).toEqual(["f3"]));
    await waitFor(() => {
      const items = within(fieldList()).getAllByRole("listitem");
      expect(within(items.at(-1)!).getByText("Our position")).toBeInTheDocument();
    });
  });
});
