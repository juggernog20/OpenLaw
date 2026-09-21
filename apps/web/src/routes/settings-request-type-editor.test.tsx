// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Request type editor (#85, INT-002) at the route seam: the
 * shared TypeEditorScreen on the request mount — identity at its own
 * URL with the Intake vocabulary, and the one control that is intake's
 * own, the target. The machinery itself is covered by the Contracts and
 * Matters editor suites; these tests pin the wiring and the target.
 *
 * The right card is the form definition (#355): the five basics as
 * locked rows, and below them the catalog fields, offered by the rule
 * the target sets.
 *
 * Six things are asserted rather than assumed: the picker offers live
 * types only, an archived target still reads as itself and is flagged,
 * the basics are locked and never in the Attach menu, the menu follows
 * the target as it is picked, the API's own strand refusal reaches the
 * screen, and a `user` row takes no required box (#400).
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
  formFieldOrder?: string[];
}

/** One catalog row, as the Fields pane's list route answers it. */
interface StubField {
  id: string;
  slug: string;
  displayName: string;
  moduleScope: "contract" | "matter" | "contract";
  fieldType: "text" | "number";
  builtInKey?: string;
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
    moduleScope: "contract",
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
  /** Whether each attach asked for the default destination type too. */
  alsoAttach: boolean[];
  expectedTargets: unknown[];
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
    moduleScope: "contract",
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
  /** The field ids the NDA contract type already attaches. */
  onNda: string[] = [],
) {
  let current = row;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/contract-types/ct-nda/fields" && call.method === "GET") {
      return json(200, {
        attachedFields: onNda.map((fieldId, index) => ({
          fieldId,
          slug: fieldId,
          displayName: fieldId,
          fieldType: "text",
          moduleScope: "contract",
          displayOrder: index + 1,
          isRequired: false,
        })),
      });
    }
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
      const { fieldId, alsoAttachToTarget, expectedTarget } = call.body as {
        fieldId: string;
        alsoAttachToTarget?: boolean;
        expectedTarget?: unknown;
      };
      calls.attached.push(fieldId);
      calls.alsoAttach.push(alsoAttachToTarget === true);
      calls.expectedTargets.push(expectedTarget);
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
        alsoAttachedTo: alsoAttachToTarget
          ? { module: "contract", typeId: "ct-nda", typeDisplayName: "NDA", attached: true }
          : null,
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

const newCalls = (): EditorCalls => ({
  patches: [],
  attached: [],
  alsoAttach: [],
  expectedTargets: [],
  detached: [],
});

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
    expect(screen.getByLabelText("Default destination")).toHaveValue("contract");

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

describe("default destination", () => {
  it("saves a specific type, clears it on a module change, and refreshes eligible fields", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls, review(), undefined, []));
    const user = userEvent.setup();
    const module = await screen.findByLabelText("Default destination");
    await user.selectOptions(screen.getByLabelText("Default contract type"), "ct-nda");
    await waitFor(() =>
      expect(screen.getByLabelText("Default contract type")).toHaveValue("ct-nda"),
    );
    await user.selectOptions(module, "matter");
    const type = await screen.findByLabelText("Default matter type");
    expect(type).toHaveValue("");
    await user.selectOptions(type, "mt-lit");
    await waitFor(() => expect(type).toHaveValue("mt-lit"));
    expect(calls.patches).toEqual([
      { targetModule: "contract", targetTypeId: "ct-nda" },
      { targetModule: "matter", targetTypeId: null },
      { targetModule: "matter", targetTypeId: "mt-lit" },
    ]);
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Practice area")).toBeInTheDocument();
    expect(within(menu).queryByText("Governing law")).not.toBeInTheDocument();
    expect(calls.attached).toHaveLength(0);
  });

  it("clears both destination values when Legal should decide during triage", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls, review({ targetTypeId: "ct-nda" }), undefined, []));
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Default destination"), "");
    await waitFor(() =>
      expect(screen.queryByLabelText("Default contract type")).not.toBeInTheDocument(),
    );
    expect(calls.patches).toEqual([{ targetModule: null, targetTypeId: null }]);
    expect(screen.getByLabelText("Default destination")).toHaveValue("");
  });

  it("preserves the saved destination and fields when the API refuses a change", async () => {
    const calls = newCalls();
    openEditor(
      editorApi(calls, review({ targetTypeId: "ct-nda" }), {
        status: 409,
        detail: "Counterparty name does not fit that target. Detach it from the form first.",
      }),
    );
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Default destination"), "matter");
    expect(await screen.findByText(/Counterparty name does not fit/)).toBeInTheDocument();
    expect(screen.getByLabelText("Default destination")).toHaveValue("contract");
    expect(screen.getByLabelText("Default contract type")).toHaveValue("ct-nda");
    expect(screen.getByRole("button", { name: "Detach Counterparty name" })).toBeInTheDocument();
    expect(calls.detached).toHaveLength(0);
  });

  it("shows an archived selection by name but offers only live replacement types", async () => {
    openEditor(editorApi(newCalls(), review({ targetTypeId: "ct-old" })));
    const picker = within(await screen.findByLabelText("Default contract type"));
    expect(picker.getByRole("option", { name: "Retired kind (unavailable)" })).toBeDisabled();
    expect(picker.getByRole("option", { name: "NDA" })).toBeEnabled();
    expect(picker.getByRole("option", { name: "MSA" })).toBeEnabled();
  });
});

describe("the form definition (ST14's right card)", () => {
  it("opens with the four basics, locked and disabled, on the DES-018 ramp", async () => {
    openEditor(editorApi(newCalls()));
    expect(await screen.findByText("Form fields")).toBeInTheDocument();
    expect(screen.getByText("Basics are always on the form")).toBeInTheDocument();

    for (const [name, required] of [
      ["Title", true],
      ["Attachments", false],
      ["Department", true],
      ["Urgency", true],
    ] as const) {
      const box = screen.getByRole("checkbox", { name: `${name} required` });
      expect(box).toBeDisabled();
      expect(box).toHaveAttribute("data-state", required ? "checked" : "unchecked");
    }
    const urgencyRow = screen.getByRole("checkbox", { name: "Urgency required" }).closest("li")!;
    expect(within(urgencyRow).getByText("Single select")).toBeInTheDocument();
    // A basic is stated, never detachable.
    expect(screen.queryByRole("button", { name: "Detach Title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reorder Title/ })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Form fields" })).toBeInTheDocument();
  });

  it("offers what the target allows, and never a basic", async () => {
    openEditor(editorApi(newCalls()));
    const user = userEvent.setup();
    await screen.findByText("Form fields");
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    // Contract target: contract-scoped. Counterparty name is
    // already attached, so what is left is one of each.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
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

  it("locks the required box on a user field, and says why", async () => {
    openEditor(editorApi(newCalls(), review(), undefined, ATTACHED_WITH_REFERENCE));
    await screen.findByText("Form fields");

    const box = screen.getByRole("checkbox", { name: "Business owner required" });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("data-state", "unchecked");
    const reason = screen.getByText(
      "Business owner can be on the form, but it can't be required. " +
        "A requester cannot pick a person in the Portal.",
    );
    // The reason is the box's own description, so a reader that lands
    // on the box hears why it is shut rather than meeting a bare
    // disabled control.
    expect(box).toHaveAttribute("aria-describedby", reason.id);
    expect(reason.id).not.toBe("");
  });

  it("lets an Entity Field be required", async () => {
    const calls = newCalls();
    const signer = {
      ...ATTACHED[0]!,
      fieldId: "f-entity",
      slug: "signing_entity",
      displayName: "Signing Entity",
      fieldType: "entity",
    };
    const base = editorApi(calls, review(), undefined, [signer]);
    openEditor((call) => {
      if (
        call.method === "PATCH" &&
        call.url.pathname === "/api/v1/request-types/r2/fields/f-entity"
      ) {
        calls.patches.push(call.body);
        return json(200, { attachedField: { ...signer, isRequired: true } });
      }
      return base(call);
    });
    const box = await screen.findByRole("checkbox", { name: "Signing Entity required" });
    expect(box).toBeEnabled();
    await userEvent.setup().click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(calls.patches).toEqual([{ isRequired: true }]);
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

it("attaches without a companion-attach offer", async () => {
  const calls = newCalls();
  openEditor(editorApi(calls, review({ targetTypeId: "ct-nda" })));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Attach field" }));
  await user.click(await screen.findByRole("menuitem", { name: /Governing law/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.alsoAttach).toEqual([false]);
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

    // Undecided destinations can collect fields from either module.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
    expect(within(menu).getByRole("menuitem", { name: /Department/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Practice area/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Governing law/ })).toBeInTheDocument();
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

it("requests the intake catalog and labels default field choices", async () => {
  const field = {
    id: "native",
    slug: "native_notice",
    displayName: "Notice period (days)",
    fieldType: "number" as const,
    moduleScope: "contract" as const,
    builtInKey: "noticePeriodDays",
  };
  CATALOG.push(field);
  try {
    const handler = editorApi(newCalls());
    let queriedIntake = false;
    openEditor((call) => {
      if (call.url.pathname === "/api/v1/fields")
        queriedIntake = call.url.searchParams.get("intake") === "true";
      return handler(call);
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Attach field" }));
    expect(
      await screen.findByRole("menuitem", { name: /Notice period.*Default/ }),
    ).toBeInTheDocument();
    expect(queriedIntake).toBe(true);
  } finally {
    CATALOG.pop();
  }
});

it.each([
  { destination: "contract", catalog: "contract" },
  { destination: "matter", catalog: "matter" },
  { destination: null, catalog: "contract" },
  { destination: null, catalog: "matter" },
] as const)(
  "creates and attaches a $catalog field with destination $destination",
  async ({ destination, catalog }) => {
    const calls = newCalls();
    const serve = editorApi(calls, review({ targetModule: destination }), undefined, []);
    const writes: StubCall[] = [];
    let created: Record<string, unknown>;
    openEditor((call) => {
      if (call.url.pathname === "/api/v1/fields" && call.method === "POST") {
        writes.push(call);
        created = {
          ...(call.body as Record<string, unknown>),
          id: "f-new",
          slug: "additional_context",
          displayOrder: 0,
          archivedAt: null,
          options: null,
          builtInKey: null,
        };
        return json(201, { field: created });
      }
      if (call.url.pathname === "/api/v1/request-types/r2/fields" && call.method === "POST") {
        writes.push(call);
        return json(201, { attachedField: { ...created, fieldId: "f-new", isRequired: false } });
      }
      return serve(call);
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Attach field" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add new field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    if (destination === null) {
      await user.selectOptions(
        within(dialog).getByRole("combobox", { name: "Field catalog" }),
        catalog,
      );
    } else {
      expect(
        within(dialog).queryByRole("combobox", { name: "Field catalog" }),
      ).not.toBeInTheDocument();
    }
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Additional context");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Description" }),
      "Explain the request",
    );
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Type" }), "text");
    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes[0]?.body).toMatchObject({
      displayName: "Additional context",
      description: "Explain the request",
      moduleScope: catalog,
      fieldType: "text",
      fieldTag: "business",
    });
    expect(writes[1]?.body).toMatchObject({ fieldId: "f-new" });
    expect(screen.getByText("Additional context")).toBeVisible();
    expect(screen.getByRole("button", { name: "Attach field" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Detach Additional context" }));
    await waitFor(() => expect(screen.queryByText("Additional context")).not.toBeInTheDocument());
    await user.selectOptions(
      screen.getByLabelText("Default destination"),
      catalog === "contract" ? "matter" : "contract",
    );
    await waitFor(() => expect(calls.patches).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: /Additional context/ }),
    ).not.toBeInTheDocument();
  },
);
