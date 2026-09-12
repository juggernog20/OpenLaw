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
 * Six things are asserted rather than assumed: the picker offers live
 * types only, an archived target still reads as itself and is flagged,
 * the basics are locked and never in the Attach menu, the menu follows
 * the target as it is picked, the API's own strand refusal reaches the
 * screen, and a `user` or `entity` row takes no required box (#400).
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
  turnaroundDays: number | null;
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
    turnaroundDays: null,
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

/**
 * The same form, plus a `user` field already attached to it — the row
 * whose required box the mount never offers (#400).
 *
 * It is deliberately not in `CATALOG`: the Attach menu's own
 * assertions count what the target allows, and a fifth catalog row
 * would move those numbers for a reason that has nothing to do with
 * them.
 */
const ATTACHED_WITH_REFERENCE = [
  ...ATTACHED,
  {
    fieldId: "f-owner",
    slug: "business_owner",
    displayName: "Business owner",
    fieldType: "user",
    moduleScope: "global",
    displayOrder: 2,
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
  attached: typeof ATTACHED = ATTACHED,
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
      return json(200, { attachedFields: attached });
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

describe("the SET-002 gate on the editor", () => {
  it("bounces a Legal Team Member to their own settings", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/intake/request-types/r2");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("identity (ST14's left card)", () => {
  it("edits display name and description without showing the internal slug", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Display name")).toHaveValue("Contract review");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Review of a counterparty contract or redline.",
    );
    expect(screen.queryByLabelText("Slug")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target")).not.toBeInTheDocument();

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
      ["Title", true],
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
    const urgencyRow = screen.getByRole("checkbox", { name: "Urgency required" }).closest("li")!;
    expect(within(urgencyRow).getByText("Single select")).toBeInTheDocument();
    // A basic is stated, never detachable.
    expect(screen.queryByRole("button", { name: "Detach Title" })).not.toBeInTheDocument();
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
    expect(within(menu).queryByText("Title")).not.toBeInTheDocument();
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
    expect(screen.getByRole("checkbox", { name: "Title required" })).toBeInTheDocument();
  });

  /**
   * INT-002's M20/11 addendum (#400). The portal offers a requester no
   * rows for a `user` or an `entity`, so a required one is a question
   * nobody can answer. The editor locks the box rather than letting the
   * rule arrive as a save that fails.
   */
  it("locks the required box on a user field, and says why", async () => {
    openEditor(editorApi(newCalls(), review(), undefined, ATTACHED_WITH_REFERENCE));
    await screen.findByText("Form fields");

    const box = screen.getByRole("checkbox", { name: "Business owner required" });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("data-state", "unchecked");
    const reason = screen.getByText(
      "Business owner can be on the form, but it can't be required. " +
        "A requester picks no person and no entity in the portal.",
    );
    // The reason is the box's own description, so a reader that lands
    // on the box hears why it is shut rather than meeting a bare
    // disabled control.
    expect(box).toHaveAttribute("aria-describedby", reason.id);
    expect(reason.id).not.toBe("");
  });

  it("leaves the row itself a row: it still detaches and still reorders", async () => {
    openEditor(editorApi(newCalls(), review(), undefined, ATTACHED_WITH_REFERENCE));
    await screen.findByText("Form fields");
    expect(screen.getByRole("button", { name: "Detach Business owner" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reorder Business owner, position 2 of 2/ }),
    ).toBeInTheDocument();
    // Only this row's box is locked; an ordinary field keeps its own.
    expect(screen.getByRole("checkbox", { name: "Counterparty name required" })).toBeEnabled();
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
    turnaroundDays: null,
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

  it("reseeds the form and field scope when :typeId changes", async () => {
    stubApi({ signedIn: ADMIN, extra: twoTypes(newCalls()) });
    const { router } = renderAt("/settings/intake/request-types/r2");
    expect(await screen.findByLabelText("Display name")).toHaveValue("Contract review");

    await router.navigate("/settings/intake/request-types/r3");

    await waitFor(() =>
      expect(screen.getByLabelText("Display name")).toHaveValue("Legal question"),
    );
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

it("saves a whole business-day turnaround, rejects fractions, and clears back to no suggestion", async () => {
  const calls = newCalls();
  openEditor(editorApi(calls));
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Target turnaround (business days)");
  expect(input).toHaveValue(null);
  await user.type(input, "3{Enter}");
  await waitFor(() => expect(calls.patches).toEqual([{ turnaroundDays: 3 }]));
  await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
  await user.clear(input);
  await user.type(input, "1.5{Enter}");
  expect(await screen.findByText(/Enter a whole number from 0/)).toBeInTheDocument();
  expect(calls.patches).toHaveLength(1);
  await user.clear(input);
  await user.tab();
  await waitFor(() =>
    expect(calls.patches).toEqual([{ turnaroundDays: 3 }, { turnaroundDays: null }]),
  );
});

it("drops the turnaround refusal as soon as the text it was about changes", async () => {
  const calls = newCalls();
  openEditor(editorApi(calls));
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Target turnaround (business days)");
  await user.type(input, "1.5{Enter}");
  expect(await screen.findByText(/Enter a whole number from 0/)).toBeInTheDocument();

  await user.type(input, "{Backspace}{Backspace}");
  expect(screen.queryByText(/Enter a whole number from 0/)).not.toBeInTheDocument();
  expect(calls.patches).toEqual([]);
});

/** The editor with its turnaround write held open, so the box can be
 * asked what it is doing while the answer is still out. */
function heldTurnaround(calls: EditorCalls, refuse?: { status: number; detail: string }) {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = editorApi(calls, review(), refuse);
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      const answer = base(call);
      const patching = call.url.pathname === "/api/v1/request-types/r2" && call.method === "PATCH";
      return patching && answer ? held.then(() => answer) : answer;
    },
  });
  renderAt("/settings/intake/request-types/r2");
  return () => release!();
}

it("keeps the keyboard in the turnaround box while an Enter save is in flight", async () => {
  const calls = newCalls();
  const release = heldTurnaround(calls);
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Target turnaround (business days)");
  await user.type(input, "3{Enter}");
  await waitFor(() => expect(calls.patches).toEqual([{ turnaroundDays: 3 }]));

  // Held still, not disabled. A browser takes focus off a control it
  // disables, so committing with Enter used to throw the reader out of
  // the box they were typing in. jsdom does not blur on `disabled`, so
  // the two attribute assertions are what pin the mechanism here; the
  // focus assertion states the behaviour they buy.
  expect(screen.getByText("Saving…")).toBeInTheDocument();
  expect(input).toBeEnabled();
  expect(input).toHaveAttribute("readonly");
  expect(document.activeElement).toBe(input);

  // What `disabled` used to refuse, the guard and `readOnly` refuse now:
  // no second write, no edit under the one in flight, and Escape does
  // not revert the text the answer is about to replace.
  await user.keyboard("9{Enter}{Escape}");
  expect(calls.patches).toHaveLength(1);
  expect(input).toHaveValue(3);
  expect(document.activeElement).toBe(input);

  release();
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(document.activeElement).toBe(input);
  expect(input).not.toHaveAttribute("readonly");
  // Escape is itself again once the write has landed.
  await user.keyboard("{Escape}");
  expect(input).toHaveValue(3);
});

it("keeps the keyboard in the turnaround box when the save is refused", async () => {
  const calls = newCalls();
  const release = heldTurnaround(calls, {
    status: 400,
    detail: "That turnaround is out of range.",
  });
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Target turnaround (business days)");
  await user.type(input, "3{Enter}");
  await waitFor(() => expect(calls.patches).toEqual([{ turnaroundDays: 3 }]));
  expect(document.activeElement).toBe(input);

  release();
  expect(await screen.findByText("That turnaround is out of range.")).toBeInTheDocument();
  expect(document.activeElement).toBe(input);
  expect(input).not.toHaveAttribute("readonly");
  // The refused text stays in the box, so the retry is the key already
  // under the reader's hand.
  expect(input).toHaveValue(3);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(calls.patches).toHaveLength(2));
});
