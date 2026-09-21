// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pinnedFormRows, type Form, type FormRow } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
const MEMBER = { ...ADMIN, role: "legal_team_member" };
function review(overrides = {}) {
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
    ...overrides,
  };
}
const CONTRACT_TYPES = [
  { id: "ct-default", displayName: "Default", archivedAt: null, isDefault: true },
  { id: "ct-nda", displayName: "NDA", archivedAt: null, isDefault: false },
  { id: "ct-old", displayName: "Retired kind", archivedAt: "2026-01-01", isDefault: false },
];
const MATTER_TYPES = [
  { id: "mt-default", displayName: "Default", archivedAt: null, isDefault: true },
  { id: "mt-lit", displayName: "Litigation", archivedAt: null, isDefault: false },
];
function row(rowRef: string, fieldType: FormRow["fieldType"] = "text", extra = {}): FormRow {
  return {
    kind: "row",
    id: rowRef,
    rowRef,
    fieldType,
    onIntakeForm: true,
    isRequired: false,
    visibleOnPortal: true,
    ...extra,
  };
}
const FORM: Form = [
  ...pinnedFormRows("contract"),
  row("description", "long_text"),
  row("owning_department", "single_select"),
  row("priority", "single_select"),
  row("term_type", "single_select"),
  {
    kind: "branch",
    id: "b1",
    match: "all",
    conditions: [{ rowRef: "term_type", operator: "equals", value: "fixed" }],
    children: [
      row("expiry_date", "date", { isRequired: true }),
      {
        kind: "branch",
        id: "b2",
        match: "any",
        conditions: [{ rowRef: "expiry_date", operator: "is_set", value: null }],
        children: [row("justification")],
      },
    ],
  },
  row("risk", "single_select", { onIntakeForm: false }),
  {
    kind: "branch",
    id: "b3",
    match: "all",
    conditions: [{ rowRef: "risk", operator: "is_set", value: null }],
    children: [row("internal", "text", { onIntakeForm: false })],
  },
];
interface EditorCalls {
  patches: unknown[];
  reads: string[];
}
const newCalls = (): EditorCalls => ({ patches: [], reads: [] });
function editorApi(
  calls: EditorCalls,
  initial = review(),
  refuse?: { status: number; detail: string },
) {
  let current = initial;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (call.method === "GET") calls.reads.push(path);
    if (path === `/api/v1/request-types/${current.id}`) {
      if (call.method === "PATCH") {
        calls.patches.push(call.body);
        if (refuse) return problem(refuse.status, refuse.detail);
        current = { ...current, ...(call.body as object) };
      }
      return json(200, { requestType: current });
    }
    if (path === "/api/v1/request-types")
      return json(200, {
        requestTypes: [review({ id: "other", displayName: "Other request" }), current],
      });
    if (path === "/api/v1/contract-types") return json(200, { contractTypes: CONTRACT_TYPES });
    if (path === "/api/v1/matter-types") return json(200, { matterTypes: MATTER_TYPES });
    if (path === "/api/v1/contract-types/ct-default/form") return json(200, { form: FORM });
    if (path === "/api/v1/contract-types/ct-nda/form")
      return json(200, { form: [...pinnedFormRows("contract"), row("effective_date", "date")] });
    if (path.startsWith("/api/v1/matter-types/") && path.endsWith("/form"))
      return json(200, { form: [...pinnedFormRows("matter")] });
    if (path === "/api/v1/fields")
      return json(200, {
        fields: [
          {
            id: "justification",
            slug: "justification",
            displayName: "Business justification",
            fieldType: "text",
            moduleScope: "contract",
            description: null,
            options: null,
            archivedAt: null,
          },
        ],
      });
    if (path === "/api/v1/portal/entities") return json(200, { entities: [] });
    if (path === "/api/v1/departments/options") return json(200, { departments: [] });
    if (path === "/api/v1/regions") return json(200, { regions: [] });
    return undefined;
  };
}
function openEditor(extra: ReturnType<typeof editorApi>) {
  stubApi({ signedIn: ADMIN, extra });
  return renderAt("/settings/intake/request-types/r2");
}

it("bounces a Legal Team Member to their own settings", async () => {
  stubApi({ signedIn: MEMBER });
  renderAt("/settings/intake/request-types/r2");
  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

it("edits Request type facts and uses the saved wording in its preview", async () => {
  const calls = newCalls();
  openEditor(editorApi(calls));
  const user = userEvent.setup();
  const name = await screen.findByLabelText("Display name");
  expect(name).toHaveValue("Contract review");
  await user.clear(name);
  await user.type(name, "Contract triage");
  await user.tab();
  const description = screen.getByLabelText("Description");
  await user.clear(description);
  await user.type(description, "Tell us what to review");
  await user.tab();
  await waitFor(() =>
    expect(calls.patches).toEqual([
      { displayName: "Contract triage" },
      { description: "Tell us what to review" },
    ]),
  );
  await user.click(screen.getByRole("button", { name: "Preview intake form" }));
  const preview = await screen.findByRole("dialog", { name: "Preview intake form" });
  expect(within(preview).getByRole("heading", { name: "Contract triage" })).toBeVisible();
  expect(within(preview).getByText("Tell us what to review")).toBeVisible();
  expect(within(preview).queryByLabelText("Request type")).not.toBeInTheDocument();
});

describe("the Intake form card", () => {
  it("lists fixed basics and Intake Rows in order with nested Branch headers and no editing controls", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const card = await screen.findByRole("region", { name: "Intake form" });
    await within(card).findByText("Business justification");
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "TitleTextRequired",
      "DepartmentSingle selectRequired",
      "UrgencySingle selectRequired",
      "DescriptionLong textOptional",
      "Term typeSingle selectOptional",
      expect.stringContaining("Show when all of: Term type is Fixed"),
      "Expiry dateDateRequired",
      expect.stringContaining("Show when any of: Expiry date is set"),
      "Business justificationTextOptional",
      "AttachmentsFilesOptional",
    ]);
    expect(within(card).queryByText("Risk")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Attach|Detach|Reorder/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Form fields")).not.toBeInTheDocument();
    expect(calls.reads.some((p) => p.includes("request-types/r2/fields"))).toBe(false);
    expect(within(card).getByText("Default")).toBeVisible();
    expect(within(card).getByRole("link", { name: "Edit on Default" })).toHaveAttribute(
      "href",
      "/settings/contracts/types/ct-default/form",
    );
  });

  it("uses the current name of a renamed Default type", async () => {
    const base = editorApi(newCalls());
    openEditor((call) =>
      call.url.pathname === "/api/v1/contract-types"
        ? json(200, {
            contractTypes: CONTRACT_TYPES.map((t) =>
              t.isDefault ? { ...t, displayName: "General contracts" } : t,
            ),
          })
        : base(call),
    );
    expect(await screen.findByRole("link", { name: "Edit on General contracts" })).toHaveAttribute(
      "href",
      "/settings/contracts/types/ct-default/form",
    );
  });

  it("refreshes after a type or module change and retains the basics for a Form with no other Intake Rows", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByText("Business justification");
    await user.selectOptions(screen.getByLabelText("Default contract type"), "ct-nda");
    expect(await screen.findByText("Effective date")).toBeVisible();
    expect(screen.queryByText("Business justification")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit on NDA" })).toHaveAttribute(
      "href",
      "/settings/contracts/types/ct-nda/form",
    );
    await user.selectOptions(screen.getByLabelText("Default destination"), "matter");
    expect(await screen.findByRole("link", { name: "Edit on Default" })).toHaveAttribute(
      "href",
      "/settings/matters/types/mt-default/form",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview intake form" })).toBeEnabled(),
    );
    const card = screen.getByRole("region", { name: "Intake form" });
    expect(within(card).getAllByRole("listitem")).toHaveLength(4);
    expect(calls.patches).toEqual([
      { targetModule: "contract", targetTypeId: "ct-nda" },
      { targetModule: "matter", targetTypeId: null },
    ]);
  });

  it("evaluates Branch children in the shared preview and returns focus to the eye", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByText("Business justification");
    const eye = screen.getByRole("button", { name: "Preview intake form" });
    await user.click(eye);
    const preview = await screen.findByRole("dialog", { name: "Preview intake form" });
    expect(within(preview).queryByLabelText(/Expiry date/)).not.toBeInTheDocument();
    await user.selectOptions(within(preview).getByLabelText("Term type"), "fixed");
    expect(within(preview).getByLabelText(/Expiry date/)).toBeVisible();
    await user.selectOptions(within(preview).getByLabelText("Term type"), "evergreen");
    expect(within(preview).queryByLabelText(/Expiry date/)).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(eye).toHaveFocus());
    expect(calls.patches).toEqual([]);
  });
});

it("keeps an archived destination visible and reads that type's Form", async () => {
  const base = editorApi(newCalls(), review({ targetTypeId: "ct-old" }));
  openEditor((call) =>
    call.url.pathname === "/api/v1/contract-types/ct-old/form"
      ? json(200, { form: FORM })
      : base(call),
  );
  expect(await screen.findByRole("option", { name: "Retired kind (unavailable)" })).toBeDisabled();
  expect(await screen.findByText("Business justification")).toBeVisible();
  expect(screen.getByRole("link", { name: "Edit on Retired kind" })).toHaveAttribute(
    "href",
    "/settings/contracts/types/ct-old/form",
  );
});

it("ignores an old Form read that finishes after a destination change", async () => {
  const base = editorApi(newCalls());
  let release: (() => void) | undefined;
  stubApi({
    signedIn: ADMIN,
    extra(call) {
      if (call.url.pathname === "/api/v1/contract-types/ct-default/form")
        return new Promise<Response>((resolve) => {
          release = () => resolve(json(200, { form: FORM }));
        });
      return base(call);
    },
  });
  renderAt("/settings/intake/request-types/r2");
  const user = userEvent.setup();
  await screen.findByLabelText("Default contract type");
  await waitFor(() => expect(release).toBeDefined());
  await user.selectOptions(screen.getByLabelText("Default contract type"), "ct-nda");
  expect(await screen.findByText("Effective date")).toBeVisible();
  release!();
  await waitFor(() => expect(screen.queryByText("Business justification")).not.toBeInTheDocument());
  expect(screen.getByRole("link", { name: "Edit on NDA" })).toBeVisible();
});

it("requires a destination module and offers only live types", async () => {
  openEditor(editorApi(newCalls()));
  const module = await screen.findByLabelText("Default destination");
  expect(module).toBeRequired();
  expect(
    within(module)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value),
  ).toEqual(["contract", "matter"]);
  const type = screen.getByLabelText("Default contract type");
  expect(within(type).getByRole("option", { name: "Default" })).toHaveValue("");
  expect(within(type).queryByRole("option", { name: "Retired kind" })).not.toBeInTheDocument();
});

it("keeps the previous destination and card when the server refuses a change", async () => {
  openEditor(
    editorApi(newCalls(), review(), { status: 400, detail: "The destination is unavailable." }),
  );
  const user = userEvent.setup();
  await screen.findByText("Business justification");
  await user.selectOptions(screen.getByLabelText("Default destination"), "matter");
  expect(await screen.findByText("The destination is unavailable.")).toBeVisible();
  expect(screen.getByLabelText("Default destination")).toHaveValue("contract");
  expect(screen.getByText("Business justification")).toBeVisible();
});

it("shows a Form read failure and retries without displaying the previous destination's Rows", async () => {
  const base = editorApi(newCalls());
  let failed = true;
  openEditor((call) =>
    call.url.pathname === "/api/v1/contract-types/ct-nda/form" && failed
      ? problem(503, "Unavailable")
      : base(call),
  );
  const user = userEvent.setup();
  await screen.findByText("Business justification");
  await user.selectOptions(screen.getByLabelText("Default contract type"), "ct-nda");
  expect(await screen.findByRole("alert")).toHaveTextContent("The Intake form could not be read.");
  expect(screen.queryByText("Business justification")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Preview intake form" })).toBeDisabled();
  failed = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Effective date")).toBeVisible();
});

it("reseeds the destination when navigating to another Request type", async () => {
  const base = editorApi(newCalls());
  const { router } = openEditor((call) =>
    call.url.pathname === "/api/v1/request-types/r3"
      ? json(200, {
          requestType: review({ id: "r3", displayName: "Legal question", targetModule: "matter" }),
        })
      : base(call),
  );
  await screen.findByText("Business justification");
  await router.navigate("/settings/intake/request-types/r3");
  await waitFor(() => expect(screen.getByLabelText("Display name")).toHaveValue("Legal question"));
  expect(screen.getByLabelText("Default destination")).toHaveValue("matter");
  expect(screen.queryByText("Business justification")).not.toBeInTheDocument();
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
