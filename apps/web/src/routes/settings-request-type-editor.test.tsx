// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Request type editor (#85, INT-002) at the route seam: the
 * shared TypeEditorScreen on the request mount — identity at its own
 * URL with the Intake vocabulary, and the one control that is intake's
 * own, the target. The machinery itself is covered by the Contracts and
 * Matters editor suites; these tests pin the wiring and the target.
 *
 * The right card is the form definition (#355): the four basics as
 * locked rows, and below them the catalog fields, offered by the rule
 * the target sets.
 *
 * Five things are asserted rather than assumed: the picker offers live
 * types only, an archived target still reads as itself and is flagged,
 * the basics are locked and never in the Attach menu, the menu follows
 * the target as it is picked, and the API's own strand refusal reaches
 * the screen.
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

/** One request type as the routes answer it. */
interface StubType {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
  targetModule: "matter" | "contract" | null;
  targetTypeId: string | null;
  formFieldCount: number;
}

/** One catalog row, as the Fields pane's list route answers it. */
interface StubField {
  id: string;
  slug: string;
  displayName: string;
  moduleScope: "contract" | "matter" | "global";
  fieldType: "text" | "number";
}

const CATALOG: StubField[] = [
  {
    id: "f-cp",
    slug: "counterparty_name",
    displayName: "Counterparty name",
    moduleScope: "contract",
    fieldType: "text",
  },
  {
    id: "f-practice",
    slug: "practice_area",
    displayName: "Practice area",
    moduleScope: "matter",
    fieldType: "text",
  },
  {
    id: "f-dept",
    slug: "department",
    displayName: "Department",
    moduleScope: "global",
    fieldType: "text",
  },
  // Contract-scoped and unattached, so the menu's scope is provable in
  // both directions: it appears under Contract and goes under Matter.
  {
    id: "f-law",
    slug: "governing_law",
    displayName: "Governing law",
    moduleScope: "contract",
    fieldType: "text",
  },
];

/** "Contract review": the module-only state ST14 draws. */
function review(overrides: Partial<StubType> = {}): StubType {
  return {
    id: "r2",
    slug: "contract_review",
    displayName: "Contract review",
    description: "Review of a counterparty contract or redline.",
    displayOrder: 2,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 0,
    targetModule: "contract",
    targetTypeId: null,
    formFieldCount: 1,
    ...overrides,
  };
}

const MATTER_TYPES = [
  { id: "mt-lit", slug: "litigation", displayName: "Litigation", archivedAt: null },
  { id: "mt-old", slug: "old", displayName: "Retired matters", archivedAt: "2026-01-01T00:00:00Z" },
];

const CONTRACT_TYPES = [
  { id: "ct-nda", slug: "nda", displayName: "NDA", archivedAt: null },
  { id: "ct-msa", slug: "msa", displayName: "MSA", archivedAt: null },
  { id: "ct-old", slug: "old", displayName: "Retired kind", archivedAt: "2026-01-01T00:00:00Z" },
];

interface EditorCalls {
  patches: unknown[];
  attached: unknown[];
  detached: string[];
}

/** The one attachment "Contract review" opens with. */
const ATTACHED = [
  {
    fieldId: "f-cp",
    slug: "counterparty_name",
    displayName: "Counterparty name",
    fieldType: "text",
    moduleScope: "contract",
    displayOrder: 1,
    isRequired: false,
  },
];

/** Serves the editor's five reads and captures its writes. `refuse`
 * stands in for the API's own refusal — the validator under the row
 * lock, which the client never second-guesses. */
function editorApi(
  calls: EditorCalls,
  row: StubType = review(),
  refuse?: { status: number; detail: string },
) {
  let current = row;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === `/api/v1/request-types/${row.id}` && call.method === "GET") {
      return json(200, { requestType: current });
    }
    if (path === "/api/v1/matter-types" && call.method === "GET") {
      return json(200, { matterTypes: MATTER_TYPES });
    }
    if (path === "/api/v1/contract-types" && call.method === "GET") {
      return json(200, { contractTypes: CONTRACT_TYPES });
    }
    if (path === `/api/v1/request-types/${row.id}/fields` && call.method === "GET") {
      return json(200, { attachedFields: ATTACHED });
    }
    if (path === "/api/v1/fields" && call.method === "GET") {
      return json(200, { fields: CATALOG });
    }
    if (path === `/api/v1/request-types/${row.id}/fields` && call.method === "POST") {
      const { fieldId } = call.body as { fieldId: string };
      calls.attached.push(fieldId);
      const field = CATALOG.find((candidate) => candidate.id === fieldId)!;
      return json(201, {
        attachedField: {
          fieldId: field.id,
          slug: field.slug,
          displayName: field.displayName,
          fieldType: field.fieldType,
          moduleScope: field.moduleScope,
          displayOrder: 2,
          isRequired: false,
        },
      });
    }
    if (path.startsWith(`/api/v1/request-types/${row.id}/fields/`) && call.method === "DELETE") {
      calls.detached.push(path.split("/").at(-1)!);
      return new Response(null, { status: 204 });
    }
    if (path === `/api/v1/request-types/${row.id}` && call.method === "PATCH") {
      calls.patches.push(call.body);
      if (refuse) return problem(refuse.status, refuse.detail);
      current = { ...current, ...(call.body as Partial<StubType>) };
      return json(200, { requestType: current });
    }
    return undefined;
  };
}

const newCalls = (): EditorCalls => ({ patches: [], attached: [], detached: [] });

const openEditor = (extra: ReturnType<typeof editorApi>) => {
  stubApi({ signedIn: ADMIN, extra });
  renderAt("/settings/intake/request-types/r2");
};

const targetSelect = () => screen.getByLabelText("Target");

describe("the SET-002 gate on the editor", () => {
  it("bounces a Legal Team Member to their own settings", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/intake/request-types/r2");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("identity (ST14's left card)", () => {
  it("edits display name, description, and the immutable slug as a fact", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Display name")).toHaveValue("Contract review");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Review of a counterparty contract or redline.",
    );
    const slug = screen.getByLabelText("Slug");
    expect(slug).toHaveValue("contract_review");
    expect(slug).toHaveAttribute("readonly");

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Contract triage");
    await user.tab();
    await waitFor(() => expect(calls.patches).toEqual([{ displayName: "Contract triage" }]));
  });

  it("draws no in-use caption: requests land in M20, so every count is zero", async () => {
    openEditor(editorApi(newCalls()));
    await screen.findByLabelText("Display name");
    expect(screen.queryByText(/0 requests/)).not.toBeInTheDocument();
  });

  it("links back to the request types pane", async () => {
    openEditor(editorApi(newCalls()));
    expect(await screen.findByRole("link", { name: "All request types" })).toHaveAttribute(
      "href",
      "/settings/intake/request-types",
    );
  });
});

describe("the form definition (ST14's right card)", () => {
  it("opens with the four basics, locked and disabled, on the DES-018 ramp", async () => {
    openEditor(editorApi(newCalls()));
    expect(await screen.findByText("Form fields")).toBeInTheDocument();
    expect(screen.getByText("Basics are always on the form")).toBeInTheDocument();

    for (const [name, required] of [
      ["Summary", true],
      ["Description", true],
      ["Attachments", false],
      ["Urgency", true],
    ] as const) {
      const box = screen.getByRole("checkbox", { name: `${name} required` });
      expect(box).toBeDisabled();
      expect(box).toHaveAttribute("data-state", required ? "checked" : "unchecked");
      expect(
        screen.getByText(`${name} is always collected and can't be changed.`),
      ).toBeInTheDocument();
    }
    // Urgency wears the severity ramp, not the pre-DES-018 wording.
    expect(screen.getByText("Low · medium · high · critical")).toBeInTheDocument();
    // A basic is stated, never detachable.
    expect(screen.queryByRole("button", { name: "Detach Summary" })).not.toBeInTheDocument();
    // Two lists in one card, each naming which it is.
    expect(screen.getByRole("list", { name: "Basics are always on the form" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Form fields" })).toBeInTheDocument();
  });

  it("offers what the target allows, and never a basic", async () => {
    openEditor(editorApi(newCalls()));
    const user = userEvent.setup();
    await screen.findByText("Form fields");
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    // Contract target: contract-scoped and global. Counterparty name is
    // already attached, so what is left is one of each.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(within(menu).getByRole("menuitem", { name: /Department/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Governing law/ })).toBeInTheDocument();
    expect(within(menu).queryByText("Practice area")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Summary")).not.toBeInTheDocument();
  });

  it("re-scopes the menu when the target is re-pointed, with no reload", async () => {
    openEditor(editorApi(newCalls()));
    const user = userEvent.setup();
    await screen.findByText("Form fields");

    await user.selectOptions(targetSelect(), "matter:mt-lit");
    await waitFor(() => expect(targetSelect()).toHaveValue("matter:mt-lit"));
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Practice area")).toBeInTheDocument();
    expect(within(menu).getByText("Department")).toBeInTheDocument();
    expect(within(menu).queryByText("Governing law")).not.toBeInTheDocument();
  });

  it("scopes the menu by the saved target, never by a pick the server refused", async () => {
    openEditor(
      editorApi(newCalls(), review(), {
        status: 409,
        detail: "Counterparty name does not fit that target. Detach it from the form first.",
      }),
    );
    const user = userEvent.setup();
    await screen.findByText("Form fields");
    await user.selectOptions(targetSelect(), "matter:mt-lit");
    await screen.findByText(
      "Counterparty name does not fit that target. Detach it from the form first.",
    );

    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    // The row is still contract-targeted, so the menu still is.
    expect(within(menu).getByText("Governing law")).toBeInTheDocument();
    expect(within(menu).queryByText("Practice area")).not.toBeInTheDocument();
  });

  it("attaches a field and announces it", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByText("Form fields");
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    await user.click(await screen.findByRole("menuitem", { name: /Department/ }));
    await waitFor(() => expect(calls.attached).toEqual(["f-dept"]));
    expect(await screen.findByText("Department attached.")).toBeInTheDocument();
  });

  it("detaches an attached field without touching the basics", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByText("Form fields");
    await user.click(screen.getByRole("button", { name: "Detach Counterparty name" }));
    await waitFor(() => expect(calls.detached).toEqual(["f-cp"]));
    await waitFor(() => expect(screen.queryByText("Counterparty name")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Summary required" })).toBeInTheDocument();
  });
});

describe("the target (INT-002)", () => {
  it("groups the options: no target, the Matter module, the Contract module", async () => {
    openEditor(editorApi(newCalls()));
    const select = await screen.findByLabelText("Target");
    expect(within(select).getByRole("group", { name: "Matter" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Contract" })).toBeInTheDocument();
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No target", "Matter", "Litigation", "Contract", "NDA", "MSA"]);
  });

  it("offers live types only", async () => {
    openEditor(editorApi(newCalls()));
    const select = await screen.findByLabelText("Target");
    expect(within(select).queryByRole("option", { name: "Retired kind" })).not.toBeInTheDocument();
    expect(
      within(select).queryByRole("option", { name: "Retired matters" }),
    ).not.toBeInTheDocument();
  });

  it("shows the module-only state and says what conversion will do", async () => {
    openEditor(editorApi(newCalls()));
    expect(await screen.findByLabelText("Target")).toHaveValue("contract");
    expect(
      screen.getByText(
        "Converting a request of this type creates a contract; the reviewer picks the " +
          "contract type at conversion.",
      ),
    ).toBeInTheDocument();
  });

  it("names a contract type in one pick, and the help line follows", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByLabelText("Target");
    await user.selectOptions(targetSelect(), "contract:ct-nda");
    await waitFor(() =>
      expect(calls.patches).toEqual([{ targetModule: "contract", targetTypeId: "ct-nda" }]),
    );
    expect(
      await screen.findByText(
        "Converting a request of this type creates a contract of the NDA type.",
      ),
    ).toBeInTheDocument();
  });

  it("re-points at a matter type, and at no target at all", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByLabelText("Target");

    await user.selectOptions(targetSelect(), "matter:mt-lit");
    await waitFor(() =>
      expect(calls.patches).toEqual([{ targetModule: "matter", targetTypeId: "mt-lit" }]),
    );
    expect(
      await screen.findByText(
        "Converting a request of this type creates a matter of the Litigation type.",
      ),
    ).toBeInTheDocument();

    await user.selectOptions(targetSelect(), "");
    await waitFor(() => expect(calls.patches).toHaveLength(2));
    expect(calls.patches[1]).toEqual({ targetModule: null, targetTypeId: null });
    expect(
      await screen.findByText(
        "Converting a request of this type creates no record. It is answered in the " +
          "thread and resolved there.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps an archived target selected, marks it, and flags it", async () => {
    openEditor(editorApi(newCalls(), review({ targetTypeId: "ct-old" })));
    const select = await screen.findByLabelText("Target");
    expect(select).toHaveValue("contract:ct-old");
    expect(within(select).getByRole("option", { name: "Retired kind (archived)" })).toBeVisible();
    expect(
      screen.getByText(
        "Retired kind is archived. Requests of this type convert with no type until you " +
          "pick a live one.",
      ),
    ).toBeInTheDocument();
  });

  it("puts back what the server still holds when the change is refused", async () => {
    const calls = newCalls();
    openEditor(
      editorApi(calls, review(), {
        status: 400,
        detail: "The target must be a live contract type.",
      }),
    );
    const user = userEvent.setup();
    await screen.findByLabelText("Target");
    await user.selectOptions(targetSelect(), "contract:ct-nda");
    // The API's own refusal is more actionable than any generic line.
    expect(await screen.findByText("The target must be a live contract type.")).toBeInTheDocument();
    await waitFor(() => expect(targetSelect()).toHaveValue("contract"));
  });

  it("shows the strand refusal by name and leaves the form as it was", async () => {
    const calls = newCalls();
    openEditor(
      editorApi(calls, review(), {
        status: 409,
        detail: "Counterparty name does not fit that target. Detach it from the form first.",
      }),
    );
    const user = userEvent.setup();
    await screen.findByLabelText("Target");
    await user.selectOptions(targetSelect(), "matter:mt-lit");
    expect(
      await screen.findByText(
        "Counterparty name does not fit that target. Detach it from the form first.",
      ),
    ).toBeInTheDocument();
    // The refusal put the control back, so the menu is scoped to the
    // target the server still holds.
    await waitFor(() => expect(targetSelect()).toHaveValue("contract"));
    expect(screen.getByText("Counterparty name")).toBeInTheDocument();
  });
});

describe("moving between two request types on the same route (#372)", () => {
  /** "Legal question": the no-target state, and no attachments. */
  const QUESTION: StubType = {
    id: "r3",
    slug: "legal_question",
    displayName: "Legal question",
    description: "A question answered in the thread.",
    displayOrder: 3,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 0,
    targetModule: null,
    targetTypeId: null,
    formFieldCount: 0,
  };

  /** Serves both request types; the second targets nothing and has an
   * empty form, so neither the target nor the fields can be mistaken. */
  function twoTypes(calls: EditorCalls) {
    const first = editorApi(calls);
    return (call: StubCall): Response | undefined => {
      const path = call.url.pathname;
      if (path === "/api/v1/request-types/r3" && call.method === "GET") {
        return json(200, { requestType: QUESTION });
      }
      if (path === "/api/v1/request-types/r3/fields" && call.method === "GET") {
        return json(200, { attachedFields: [] });
      }
      return first(call);
    };
  }

  it("reseeds the target and the form when :typeId changes", async () => {
    stubApi({ signedIn: ADMIN, extra: twoTypes(newCalls()) });
    const { router } = renderAt("/settings/intake/request-types/r2");
    expect(await screen.findByLabelText("Display name")).toHaveValue("Contract review");
    expect(targetSelect()).toHaveValue("contract");

    await router.navigate("/settings/intake/request-types/r3");

    await waitFor(() =>
      expect(screen.getByLabelText("Display name")).toHaveValue("Legal question"),
    );
    // The target lives on the page, not on the shared screen — it is the
    // piece keying the screen alone would have left behind.
    expect(targetSelect()).toHaveValue("");
    expect(screen.queryByText("Counterparty name")).not.toBeInTheDocument();

    // No target means global fields only, so the menu proves the scope
    // rule ran against the type in the URL.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    expect(within(menu).getByRole("menuitem", { name: /Department/ })).toBeInTheDocument();
  });
});
