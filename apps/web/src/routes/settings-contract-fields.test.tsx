// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Fields (#83) at the route seam: the DES-021 table variant
 * of the list-editor — column header, no reorder, the
 * prompt sparkle — with create and edit through the field-editor dialog
 * (type immutable after creation, options on select types, the prompt
 * on contract scope only) and the guard that archives without ever
 * reassigning. The API behaviors themselves are covered at the HTTP
 * seam in apps/api — these stubs only shape what this UI must react to.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = { ...ADMIN, id: "u2", email: "casey@example.com", role: "legal_team_member" };

/** The CTR-008 seeds: id, slug, name, type, options, prompt. */
const SEEDS = [
  ["f1", "governing_law", "Governing law", "text", null, "Find the governing law."],
  ["f2", "jurisdiction", "Jurisdiction", "text", null, "Find the forum."],
  [
    "f3",
    "our_position",
    "Our position",
    "single_select",
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
  aiPrompt: string | null;
  isSystemDefault?: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

function seededFields(archivedSlugs: string[] = []): StubFieldRow[] {
  return SEEDS.map(([id, slug, displayName, fieldType, options, aiPrompt]) => ({
    id,
    slug,
    displayName,
    description: null,
    moduleScope: "contract",
    fieldType,
    options,
    aiPrompt,
    archivedAt: archivedSlugs.includes(slug) ? "2026-08-10T12:00:00.000Z" : null,
    inUseCount: 0,
  }));
}

interface FieldCalls {
  creates: unknown[];
  patches: { id: string; body: unknown }[];
  archives: string[];
  restores: string[];
}

function newCalls(): FieldCalls {
  return { creates: [], patches: [], archives: [], restores: [] };
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

const fieldList = () =>
  within(screen.getByRole("region", { name: "Custom Fields" })).getByRole("list");

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
  it("renders the three seeds with type and the prompt sparkle, without a Tag column", async () => {
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls()) });
    renderAt("/settings/contracts/fields");
    await screen.findByText("Governing law");
    const items = within(fieldList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["Governing law", "Jurisdiction", "Our position"]);

    const first = items[0]!;
    expect(within(first).getByText(fullText("Type: Text"))).toBeInTheDocument();
    expect(screen.queryByText("Scope")).not.toBeInTheDocument();
    expect(screen.queryByText("Tag")).not.toBeInTheDocument();
    expect(within(first).queryByText(fullText("Tag: Legal"))).not.toBeInTheDocument();
    // Every seed carries a default prompt, marked by the sparkle.
    expect(
      within(first).getByRole("img", { name: "Governing law has an AI extraction prompt" }),
    ).toBeInTheDocument();

    expect(screen.getByText("3 fields")).toBeInTheDocument();
    // The catalog is unordered: no reorder grips (DES-021).
    expect(screen.queryByRole("button", { name: /^Reorder/ })).not.toBeInTheDocument();
  });

  it("locks a default Field against archive and keeps its editor (SET-004)", async () => {
    const rows = seededFields().map((row, index) => ({ ...row, isSystemDefault: index < 2 }));
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls(), rows) });
    renderAt("/settings/contracts/fields");
    await screen.findByText("Governing law");
    const [first, , third] = within(fieldList()).getAllByRole("listitem");
    expect(
      within(first!).getByRole("img", {
        name: "Governing law is a default Field and can't be archived",
      }),
    ).toBeInTheDocument();
    expect(
      within(first!).queryByRole("button", { name: "Archive Governing law" }),
    ).not.toBeInTheDocument();
    expect(within(first!).getByRole("button", { name: "Edit Governing law" })).toBeInTheDocument();
    // A user-created field keeps its archive control.
    expect(
      within(third!).getByRole("button", { name: "Archive Our position" }),
    ).toBeInTheDocument();
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
  it("creates a select field in its area with options and no tag control", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add field" }));

    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    expect(within(dialog).queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Department");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Type" }),
      "single_select",
    );
    // Picking a select type reveals the options editor.
    const options = within(dialog).getByRole("textbox", { name: "Options" });
    await user.type(options, "Legal{Enter}Procurement");
    expect(within(dialog).getByRole("textbox", { name: "AI prompt" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Scope" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    await waitFor(() =>
      expect(calls.creates).toEqual([
        {
          displayName: "Department",
          moduleScope: "contract",
          fieldType: "single_select",

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
    expect(within(dialog).queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();
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

          aiPrompt: "Extract the payment terms.",
        },
      ]),
    );
  });

  it.each(["user", "entity"])(
    "hides and omits the prompt after selecting %s",
    async (fieldType) => {
      const calls = newCalls();
      stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
      renderAt("/settings/contracts/fields");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Add field" }));
      const dialog = await screen.findByRole("dialog", { name: "Add field" });
      expect(within(dialog).queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();
      await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Internal reference");
      const type = within(dialog).getByRole("combobox", { name: "Type" });
      await user.selectOptions(type, "text");
      await user.type(
        within(dialog).getByRole("textbox", { name: "AI prompt" }),
        "Find the party.",
      );
      await user.selectOptions(type, fieldType);
      expect(within(dialog).queryByRole("textbox", { name: "AI prompt" })).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Add field" }));
      await waitFor(() =>
        expect(calls.creates).toEqual([
          {
            displayName: "Internal reference",
            moduleScope: "contract",
            fieldType,
          },
        ]),
      );
    },
  );

  it("refuses to create without a type or without options on a select", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    renderAt("/settings/contracts/fields");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    expect(within(dialog).queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();

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

describe("edit (type immutable; prompt edits)", () => {
  it.each(["user", "entity"])(
    "edits a legacy %s Field without showing or sending its prompt",
    async (fieldType) => {
      const calls = newCalls();
      const row = { ...seededFields()[0]!, fieldType, aiPrompt: " Old saved prompt. " };
      stubApi({ signedIn: ADMIN, extra: fieldsApi(calls, [row]) });
      renderAt("/settings/contracts/fields");
      await screen.findByText("Governing law");
      // The catalog row shows no sparkle either: the saved prompt is dead.
      const first = within(fieldList()).getAllByRole("listitem")[0]!;
      expect(
        within(first).queryByRole("img", { name: /AI extraction prompt/ }),
      ).not.toBeInTheDocument();
      expect(within(first).getByText("No AI prompt")).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(within(first).getByRole("button", { name: "Edit Governing law" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit Governing law" });
      expect(within(dialog).queryByRole("textbox", { name: "AI prompt" })).not.toBeInTheDocument();
      await user.type(
        within(dialog).getByRole("textbox", { name: "Description" }),
        "An internal reference.",
      );
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(calls.patches).toEqual([
          { id: row.id, body: { description: "An internal reference." } },
        ]),
      );
    },
  );

  it("locks the type and patches the prompt", async () => {
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
    expect(within(dialog).getByRole("textbox", { name: "AI prompt" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Scope" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.patches).toEqual([
        { id: "f1", body: { aiPrompt: "Extract the governing law clause." } },
      ]),
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
    // This stub count represents attachments only; the dialog must not
    // claim record values from the M8/M22 modules.
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

describe("Field answer style", () => {
  it("names the current default, saves an override, and clears it", async () => {
    const calls = newCalls();
    const rows = seededFields();
    rows[0]!.fieldType = "long_text";
    stubApi({
      signedIn: ADMIN,
      extra: (call) =>
        call.url.pathname === "/api/v1/ai-connector"
          ? json(200, { connector: { answerStyle: "few_words" } })
          : fieldsApi(calls, rows)(call),
    });
    const user = userEvent.setup();
    renderAt("/settings/contracts/fields");
    await user.click(await screen.findByRole("button", { name: "Edit Governing law" }));
    const select = screen.getByRole("combobox", { name: "Answer style" });
    expect(
      await screen.findByRole("option", { name: "Organisation default (Few word summary)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Full clause text" })).not.toBeDisabled();
    await user.selectOptions(select, "full_clause");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(calls.patches).toEqual([{ id: "f1", body: { aiAnswerStyle: "full_clause" } }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: "Edit Governing law" }));
    expect(screen.getByRole("combobox", { name: "Answer style" })).toHaveValue("full_clause");
    await user.selectOptions(screen.getByRole("combobox", { name: "Answer style" }), "");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(calls.patches.at(-1)).toEqual({ id: "f1", body: { aiAnswerStyle: null } }),
    );
  });

  it("disables Full clause text on text Fields and describes the reason", async () => {
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls()) });
    const user = userEvent.setup();
    renderAt("/settings/contracts/fields");
    await user.click(await screen.findByRole("button", { name: "Edit Governing law" }));
    expect(screen.getByRole("option", { name: "Full clause text" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Answer style" })).toHaveAccessibleDescription(
      "Full clause text needs a long text Field.",
    );
    await user.click(screen.getByRole("combobox", { name: "Answer style" }));
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("omits Answer style for other Field types", async () => {
    stubApi({ signedIn: ADMIN, extra: fieldsApi(newCalls()) });
    const user = userEvent.setup();
    renderAt("/settings/contracts/fields");
    await user.click(await screen.findByRole("button", { name: "Edit Our position" }));
    expect(screen.queryByRole("combobox", { name: "Answer style" })).not.toBeInTheDocument();
  });

  it("clears Full clause text when a new Field changes to text and sends an override on create", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: fieldsApi(calls) });
    const user = userEvent.setup();
    renderAt("/settings/contracts/fields");
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    expect(within(dialog).queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Assignment clause");
    const type = within(dialog).getByRole("combobox", { name: "Type" });
    await user.selectOptions(type, "long_text");
    await user.selectOptions(screen.getByRole("combobox", { name: "Answer style" }), "full_clause");
    await user.selectOptions(type, "text");
    expect(screen.getByRole("combobox", { name: "Answer style" })).toHaveValue("");
    await user.selectOptions(type, "long_text");
    await user.selectOptions(screen.getByRole("combobox", { name: "Answer style" }), "full_clause");
    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    await waitFor(() =>
      expect(calls.creates[0]).toMatchObject({
        fieldType: "long_text",
        aiAnswerStyle: "full_clause",
      }),
    );
  });
});
