// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Form, FormBranch, FormRow } from "@openlaw/shared";
import { json, problem } from "../testing/helpers";
import { setupForm } from "../testing/type-form";

describe("the type Form tab", () => {
  it.each(["text", "single_select"] as const)(
    "previews a %s Field's saved description as a tooltip",
    async (fieldType) => {
      const description = "Explain why this work is needed.";
      const { user } = setupForm(
        "contract",
        false,
        (form) =>
          form.map((row) => (row.id === "f1" ? { ...row, fieldType, onIntakeForm: true } : row)),
        "administrator",
        (call) =>
          call.url.pathname === "/api/v1/fields"
            ? json(200, {
                fields: [
                  {
                    id: "f1",
                    slug: "justification",
                    displayName: "Business justification",
                    fieldType,
                    moduleScope: "contract",
                    description,
                    options: fieldType === "single_select" ? ["Expansion", "Renewal"] : null,
                    archivedAt: null,
                  },
                ],
              })
            : undefined,
      );
      await user.click(await screen.findByRole("button", { name: "Preview intake form" }));
      const dialog = screen.getByRole("dialog", { name: "Preview intake form" });
      const control = within(dialog).getByLabelText("Business justification");
      expect(control).toHaveAccessibleDescription(description);
      expect(within(dialog).getByText(description)).toHaveClass("sr-only");
      expect(within(dialog).getByLabelText(/^Title/)).not.toHaveAttribute("aria-describedby");
      act(() => control.focus());
      expect(await screen.findByRole("tooltip")).toHaveTextContent(description);
    },
  );

  it.each(["contract", "matter", "entity"] as const)(
    "renders the %s Form without attachment cards",
    async (module) => {
      setupForm(module);
      expect(await screen.findByRole("heading", { name: "Form" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Form" })).toHaveAttribute("aria-current", "page");
      expect(screen.queryByText("Custom Fields")).not.toBeInTheDocument();
      expect(screen.queryByText("Default Fields")).not.toBeInTheDocument();
      if (module === "entity") {
        expect(screen.queryByText("On intake form")).not.toBeInTheDocument();
        expect(screen.queryByText("Visible on Portal")).not.toBeInTheDocument();
        expect(screen.queryByText("Built-in")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Preview intake form" }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it("writes keyboard order and reads it again after remount", async () => {
    const { user, writes, router, route } = setupForm();
    const grip = await screen.findByRole("button", { name: "Move Business justification" });
    grip.focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.at(-2)?.id).toBe("f1");
    expect(grip).toHaveFocus();
    await act(() => router.navigate(route.replace("/form", "")));
    await act(() => router.navigate(route));
    const moves = await screen.findAllByRole("button", { name: /^Move / });
    expect(moves.at(-2)).toHaveAccessibleName("Move Business justification");
  });

  it("keeps a lock reason in a tooltip and the root controls in the header", async () => {
    const { user } = setupForm();
    const locked = await screen.findByRole("switch", { name: "Title: On intake form" });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveAccessibleDescription(/Position and switches are fixed/);
    for (const reason of screen.getAllByText("Position and switches are fixed")) {
      expect(reason).toHaveClass("sr-only");
    }
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(locked);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Position and switches are fixed");
    await user.unhover(locked);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    act(() => locked.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Position and switches are fixed");
    const header = screen.getByRole("heading", { name: "Form" }).parentElement!;
    for (const name of ["Attach Field", "Create Field", "Add condition", "Preview intake form"]) {
      expect(within(header).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(header).queryByText("Changes apply immediately")).not.toBeInTheDocument();
  });

  it("derives touchpoints immediately and explains the Portal and User locks", async () => {
    const { user, writes } = setupForm();
    await user.click(
      await screen.findByRole("switch", { name: "Business justification: On intake form" }),
    );
    const portal = screen.getByRole("switch", {
      name: "Business justification: Visible on Portal",
    });
    expect(portal).toBeChecked();
    expect(portal).toHaveAttribute("aria-disabled", "true");
    await user.click(portal);
    expect(portal).toHaveFocus();
    await user.keyboard(" ");
    expect(portal).toBeChecked();
    expect(writes).toHaveLength(1);
    expect(portal).toHaveAccessibleDescription(/Turn off On intake form first/);
    expect(
      within(screen.getByRole("group", { name: "Business justification" })).getByText("Intake"),
    ).toBeInTheDocument();
    await waitFor(() => expect(writes).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Attach Field" }));
    expect(screen.queryByText("Other scope")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived Field")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: /Finance reviewer/ }));
    await user.click(
      await screen.findByRole("switch", { name: "Finance reviewer: On intake form" }),
    );
    const required = screen.getByRole("switch", {
      name: "Finance reviewer: Required for creation",
    });
    expect(required).toHaveAttribute("aria-disabled", "true");
    await user.click(required);
    expect(required).not.toBeChecked();
    expect(required).toHaveAccessibleDescription(/unavailable for Finance reviewer/);
  });

  it("adds a Fixed-term Branch, moves Expiry date into it and evaluates preview", async () => {
    const { user, read, router, route } = setupForm();
    await user.click(await screen.findByRole("switch", { name: "Term type: On intake form" }));
    await user.click(screen.getByRole("switch", { name: "Expiry date: On intake form" }));
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Row" }), "term_type");
    await user.selectOptions(screen.getByRole("combobox", { name: "Value" }), "fixed");
    await waitFor(() => expect(read().at(-1)?.kind).toBe("branch"));
    await user.click(screen.getByRole("button", { name: "Move Expiry date" }));
    await user.click(screen.getByRole("menuitem", { name: "Put under a condition…" }));
    await user.click(screen.getByRole("button", { name: /Show when all of: Term type is Fixed/ }));
    await waitFor(() =>
      expect(read().at(-1)).toMatchObject({
        kind: "branch",
        children: [expect.objectContaining({ id: "expiry_date" })],
      }),
    );
    await act(() => router.navigate(route.replace("/form", "")));
    await act(() => router.navigate(route));
    await user.click(await screen.findByRole("button", { name: "Preview intake form" }));
    const preview = within(screen.getByRole("dialog", { name: "Preview intake form" }));
    expect(preview.queryByLabelText("Expiry date")).not.toBeInTheDocument();
    await user.selectOptions(preview.getByLabelText("Term type"), "fixed");
    expect(preview.getByLabelText("Expiry date")).toBeInTheDocument();
    await user.selectOptions(preview.getByLabelText("Term type"), "evergreen");
    expect(preview.queryByLabelText("Expiry date")).not.toBeInTheDocument();
  });

  it("keeps the last tree after a server refusal beside the switch", async () => {
    const { user } = setupForm("contract", true);
    const control = await screen.findByRole("switch", {
      name: "Business justification: Required for creation",
    });
    await user.click(control);
    await waitFor(() => expect(control).not.toBeChecked());
    expect(control).toHaveAccessibleDescription(/The Form changed. Try again./);
  });
});

function conditional(form: Form): Form {
  const expiry = form.find((n) => n.id === "expiry_date") as FormRow;
  return [
    ...form
      .filter((n) => n.id !== "expiry_date")
      .map((n) => (n.id === "term_type" ? { ...n, onIntakeForm: true } : n)),
    {
      kind: "branch",
      id: "branch",
      match: "all",
      conditions: [{ rowRef: "term_type", operator: "equals", value: "fixed" }],
      children: [{ ...expiry, onIntakeForm: true, isRequired: true }],
    },
  ];
}

it("shows a derived caption and pending state before the write returns", async () => {
  const { user, hold, release } = setupForm();
  const row = within(await screen.findByRole("group", { name: "Business justification" }));
  hold();
  await user.click(row.getByRole("switch", { name: /Required for creation/ }));
  expect(row.getByText("Creation")).toBeInTheDocument();
  expect(row.getByText("Saving…")).toBeInTheDocument();
  await act(() => release());
  expect(await row.findByText("Saved")).toBeInTheDocument();
});

it("offers only preceding Rows and refuses moves across a Branch reference", async () => {
  const { user, writes } = setupForm("contract", false, conditional);
  await user.click(await screen.findByRole("button", { name: "Edit conditions" }));
  const select = screen.getByRole("combobox", { name: "Row" });
  expect(within(select).getByRole("option", { name: "Term type" })).toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: "Expiry date" })).not.toBeInTheDocument();
  const grip = screen.getByRole("button", { name: "Move Term type" });
  grip.focus();
  for (let i = 0; i < 8; i++) await user.keyboard("{ArrowDown}");
  await waitFor(() => expect(grip).toHaveAccessibleDescription(/Keep Term type above/));
  const count = writes.length;
  await user.keyboard("{ArrowDown}");
  expect(writes).toHaveLength(count);
});

it("refuses detaching a condition source beside Detach", async () => {
  const { user, writes } = setupForm("contract", false, (form) => [
    ...form,
    {
      kind: "branch",
      id: "branch",
      match: "all",
      conditions: [{ rowRef: "justification", operator: "is_set", value: null }],
      children: [],
    },
  ]);
  const detach = await screen.findByRole("button", { name: "Detach Business justification" });
  await user.click(detach);
  expect(detach).toHaveAccessibleDescription(/Used by a Branch condition/);
  expect(writes).toHaveLength(0);
});

it("moves out and removes a Branch while keeping its children", async () => {
  const { user, read } = setupForm("contract", false, conditional);
  await user.click(await screen.findByRole("button", { name: "Move Expiry date" }));
  await user.click(screen.getByRole("menuitem", { name: "Move out of the condition" }));
  await waitFor(() => expect(read().at(-1)?.id).toBe("expiry_date"));
  expect(read().at(-2)).toMatchObject({ kind: "branch", children: [] });
  await user.click(screen.getByRole("button", { name: /Actions for Show when all of/ }));
  await user.click(screen.getByRole("menuitem", { name: /Remove branch/ }));
  await waitFor(() => expect(read().some((n) => n.kind === "branch")).toBe(false));
  expect(read().at(-1)?.id).toBe("expiry_date");
});

it("drops a Row into a Branch through the same whole-tree write", async () => {
  const { read } = setupForm("contract", false, conditional);
  const grip = await screen.findByRole("button", { name: "Move Business justification" });
  fireEvent.dragStart(grip, { dataTransfer: { setData() {} } });
  fireEvent.drop(screen.getByLabelText("Children of Show when all of: Term type is Fixed"));
  await waitFor(() => expect((read().at(-1) as FormBranch).children.at(-1)?.id).toBe("f1"));
});

it("keeps incomplete Branches local and discards them with Escape", async () => {
  const { user, writes } = setupForm("entity");
  await user.click(await screen.findByRole("button", { name: "Add condition" }));
  expect(screen.getByRole("combobox", { name: "Row" })).toHaveFocus();
  await user.selectOptions(screen.getByRole("combobox", { name: "Row" }), "justification");
  expect(writes).toHaveLength(0);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("combobox", { name: "Row" })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("does not enforce hidden required Rows and never submits a Request", async () => {
  const { user, writes } = setupForm("contract", false, conditional);
  const opener = await screen.findByRole("button", { name: "Preview intake form" });
  await user.click(opener);
  const dialog = within(screen.getByRole("dialog", { name: "Preview intake form" }));
  await user.type(dialog.getByLabelText(/Title/), "   ");
  await user.click(dialog.getByRole("button", { name: "Submit request" }));
  expect(dialog.getByText("Title is required.")).toBeInTheDocument();
  await user.clear(dialog.getByLabelText(/Title/));
  await user.type(dialog.getByLabelText(/Title/), "A test");
  await user.click(dialog.getByRole("button", { name: "Submit request" }));
  expect(await dialog.findByText("Preview complete. No Request was sent")).toBeInTheDocument();
  await user.selectOptions(dialog.getByLabelText("Term type"), "fixed");
  await user.click(dialog.getByRole("button", { name: "Submit request" }));
  expect(dialog.getByText("Expiry date is required.")).toBeInTheDocument();
  await user.click(dialog.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(opener).toHaveFocus());
  expect(writes).toHaveLength(0);
});

it.each(["contract", "matter", "entity"] as const)(
  "keeps the Administrator gate on the %s Form route",
  async (module) => {
    setupForm(module, false, undefined, "legal_team_member");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  },
);

it("keeps a new Branch draft and its refusal visible after a failed write", async () => {
  const { user } = setupForm("contract", true);
  await user.click(await screen.findByRole("button", { name: "Add condition" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Row" }), "term_type");
  await user.selectOptions(screen.getByRole("combobox", { name: "Value" }), "fixed");
  expect(await screen.findByText("The Form changed. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Value" })).toHaveValue("fixed");
  expect(screen.getByRole("button", { name: "Retry condition change" })).toBeInTheDocument();
});

it("keeps an edited Branch draft after a failed write and resends it on Retry", async () => {
  const { user, writes } = setupForm("contract", true, conditional);
  await user.click(await screen.findByRole("button", { name: "Edit conditions" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Value" }), "evergreen");
  expect(await screen.findByText("The Form changed. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Value" })).toHaveValue("evergreen");
  expect(
    screen.getByRole("button", { name: /Move Show when all of: Term type is Evergreen/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry condition change" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect((writes[1]!.at(-1) as FormBranch).conditions[0]?.value).toBe("evergreen");
  screen.getByRole("combobox", { name: "Value" }).focus();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: /Move Show when all of: Term type is Fixed/ }),
  ).toBeInTheDocument();
});

it("removes a populated Branch without detaching its children", async () => {
  const { user, read } = setupForm("contract", false, conditional);
  await user.click(await screen.findByRole("button", { name: /Actions for Show when all of/ }));
  await user.click(screen.getByRole("menuitem", { name: /Remove branch/ }));
  await waitFor(() => expect(read().at(-1)?.id).toBe("expiry_date"));
  expect(read().some((n) => n.kind === "branch")).toBe(false);
});

it("keeps successful preview options and enforces Department when Entities fail", async () => {
  const { user } = setupForm("contract", false, undefined, "administrator", ({ url }) => {
    if (url.pathname === "/api/v1/portal/entities") return problem(503, "Unavailable");
    if (url.pathname === "/api/v1/departments/options")
      return json(200, { departments: [{ id: "d1", displayName: "Finance" }] });
    return undefined;
  });
  await user.click(await screen.findByRole("button", { name: "Preview intake form" }));
  const dialog = within(screen.getByRole("dialog", { name: "Preview intake form" }));
  expect(await dialog.findByText(/Some Portal options could not be loaded/)).toBeInTheDocument();
  await user.type(dialog.getByLabelText(/Title/), "A test");
  await user.click(dialog.getByRole("button", { name: "Submit request" }));
  expect(dialog.getByText("Department is required.")).toBeInTheDocument();
  expect(dialog.queryByText("Preview complete. No Request was sent")).not.toBeInTheDocument();
});

it("cannot complete preview when Department requirements could not be loaded", async () => {
  const { user } = setupForm("contract", false, undefined, "administrator", ({ url }) => {
    if (url.pathname === "/api/v1/departments/options") return problem(503, "Unavailable");
    return undefined;
  });
  await user.click(await screen.findByRole("button", { name: "Preview intake form" }));
  const dialog = within(screen.getByRole("dialog", { name: "Preview intake form" }));
  expect(await dialog.findByText(/Some Portal options could not be loaded/)).toBeInTheDocument();
  await user.type(dialog.getByLabelText(/Title/), "A test{Enter}");
  expect(dialog.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(dialog.queryByText("Preview complete. No Request was sent")).not.toBeInTheDocument();
});

it("stores money operands in explicit minor units and matches zero-decimal JPY answers", async () => {
  const { user, read } = setupForm("contract", false, (form) => {
    const expiry = form.find((n) => n.id === "expiry_date") as FormRow;
    return [
      ...form
        .filter((n) => n.id !== "expiry_date")
        .map((n) => (n.id === "value" ? { ...n, onIntakeForm: true } : n)),
      {
        kind: "branch",
        id: "branch",
        match: "all",
        conditions: [{ rowRef: "value", operator: "equals", value: 1 }],
        children: [{ ...expiry, onIntakeForm: true }],
      },
    ];
  });
  await user.click(await screen.findByRole("button", { name: "Edit conditions" }));
  const operand = screen.getByRole("spinbutton", { name: "Value" });
  expect(screen.getByText(/Enter minor units/)).toBeInTheDocument();
  await user.clear(operand);
  await user.type(operand, "5000{Enter}");
  await waitFor(() => expect((read().at(-1) as FormBranch).conditions[0]?.value).toBe(5000));
  expect(
    screen.getByRole("button", { name: /Move Show when all of: Value is 5,000 minor units/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview intake form" }));
  const dialog = within(screen.getByRole("dialog", { name: "Preview intake form" }));
  expect(dialog.queryByLabelText("Expiry date")).not.toBeInTheDocument();
  await user.type(dialog.getByLabelText("Value amount"), "5000");
  await user.selectOptions(dialog.getByLabelText("Value currency"), "JPY");
  expect(dialog.getByLabelText("Expiry date")).toBeInTheDocument();
  await user.selectOptions(dialog.getByLabelText("Value currency"), "USD");
  expect(dialog.queryByLabelText("Expiry date")).not.toBeInTheDocument();
});

it("does not reload reference labels after an unrelated switch or reorder", async () => {
  let reads = 0;
  const { user, writes } = setupForm(
    "contract",
    false,
    (form) => [
      ...form,
      {
        kind: "branch",
        id: "branch",
        match: "all",
        conditions: [{ rowRef: "region", operator: "equals", value: "r1" }],
        children: [],
      },
    ],
    "administrator",
    ({ url }) => {
      if (url.pathname === "/api/v1/regions") {
        reads++;
        return json(200, { regions: [{ id: "r1", displayName: "Europe" }] });
      }
      return undefined;
    },
  );
  await screen.findByRole("button", { name: /Move Show when all of: Region is Europe/ });
  const initialReads = reads;
  await user.click(
    screen.getByRole("switch", { name: "Business justification: Required for creation" }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  screen.getByRole("button", { name: "Move Business justification" }).focus();
  await user.keyboard("{ArrowUp}");
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(reads).toBe(initialReads);
});

it("loads later Entity condition options and stops on a repeated registry cursor", async () => {
  let reads = 0;
  const { user } = setupForm("contract", false, undefined, "administrator", ({ url }) => {
    if (url.pathname !== "/api/v1/entities") return undefined;
    reads++;
    if (reads > 4) return problem(500, "Repeated cursor requested again");
    return json(200, {
      entities: [
        {
          id: url.searchParams.has("cursor") ? "e2" : "e1",
          legalName: reads === 1 ? "First entity" : "Later entity",
        },
      ],
      nextCursor: "same",
    });
  });
  await user.click(await screen.findByRole("button", { name: "Add condition" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Row" }), "entity");
  expect(await screen.findByRole("option", { name: "Later entity" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "First entity" })).toBeInTheDocument();
  expect(reads).toBe(4);
});
