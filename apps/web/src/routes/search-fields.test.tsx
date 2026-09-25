// SPDX-License-Identifier: AGPL-3.0-only
import {
  encodeSearchQuestion,
  simpleSearchQuestion,
  decodeSearchQuestion,
  type SearchField,
} from "@openlaw/shared";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, renderAt, stubApi } from "../testing/helpers";
const MEMBER = {
  id: "reader",
  email: "reader@example.com",
  displayName: "Reader",
  role: "legal_team_member",
};
const operators = {
  text: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  long_text: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  number: ["equals", "greater_than", "less_than", "between", "is_empty", "is_not_empty"],
  currency: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  date: [
    "before",
    "after",
    "on",
    "between",
    "in_last_days",
    "in_next_days",
    "today",
    "this_week",
    "this_month",
    "this_quarter",
    "this_year",
    "is_empty",
    "is_not_empty",
  ],
  boolean: ["is_yes", "is_no", "is_empty"],
  single_select: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  multi_select: ["includes_any", "includes_all", "includes_none", "is_empty"],
  user: ["is_any_of", "is_none_of", "is_empty"],
  entity: ["is_any_of", "is_none_of", "is_empty"],
};
const catalog: SearchField[] = Object.keys(operators).map((fieldType) => ({
  slug: fieldType,
  displayName: fieldType === "text" ? "Governing law" : fieldType,
  moduleScope: "contract",
  fieldType: fieldType as SearchField["fieldType"],
  options: fieldType.endsWith("select") ? ["Delaware", "New York"] : null,
}));
function stub(fields = catalog) {
  return stubApi({
    signedIn: MEMBER,
    extra: (call) =>
      call.url.pathname === "/api/v1/search/fields"
        ? json(200, { fields, people: [{ id: "reader", displayName: "Reader" }], entities: [] })
        : call.url.pathname === "/api/v1/search/query"
          ? json(200, { results: [], total: 0, nextCursor: null })
          : undefined,
  });
}
describe("Fields in search", () => {
  it("lists live Fields under Fields, searches display names and writes the demo condition and chip", async () => {
    stub();
    const { router } = renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advanced search" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Contract" }));
    await user.click(within(dialog).getByRole("button", { name: "Add condition" }));
    expect(await screen.findByText("Fields", { exact: true })).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Search properties" }), "governing");
    await user.click(screen.getByRole("button", { name: "Governing law" }));
    const row = within(dialog).getByRole("group", { name: "Contract Governing law condition" });
    expect(
      within(row)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["contains", "does not contain", "is empty", "is not empty"]);
    await user.type(within(row).getByRole("textbox", { name: "Value" }), "Delaware");
    await user.click(within(dialog).getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("button", { name: "Edit Contract Governing law contains Delaware" }),
    ).toBeVisible();
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!)
        ?.conditions,
    ).toEqual([
      { kind: "contract", property: "field:text", operator: "contains", value: "Delaware" },
    ]);
  });
  for (const field of catalog)
    it(`offers ${field.fieldType} operators`, async () => {
      stub();
      renderAt("/");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Advanced search" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Contract" }));
      await user.click(within(dialog).getByRole("button", { name: "Add condition" }));
      await user.click(await screen.findByRole("button", { name: field.displayName }));
      const select = within(dialog).getByRole("combobox", { name: "Operator" });
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => (option as HTMLOptionElement).value),
      ).toEqual(operators[field.fieldType]);
      await user.selectOptions(select, "is_empty");
      expect(within(dialog).queryByLabelText("Value")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Search" })).toBeEnabled();
    });
  it("drops missing or archived Field conditions from a link with a notice", async () => {
    stub([]);
    const question = {
      ...simpleSearchQuestion("", ["contract"]),
      conditions: [
        {
          kind: "contract" as const,
          property: "field:archived",
          operator: "contains",
          value: "Delaware",
        },
      ],
    };
    renderAt(`/search?aq=${encodeSearchQuestion(question)}`);
    expect(await screen.findByText("Unavailable Field conditions were removed.")).toBeVisible();

    expect(
      screen.queryByRole("button", { name: /Edit Contract field:archived/ }),
    ).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText("Unavailable Field conditions were removed."),
    ).toBeVisible();
    expect(within(dialog).queryByRole("group", { name: /condition$/ })).not.toBeInTheDocument();
  });
  it("refreshes the catalog on the next dialog open and limits Fields to their module", async () => {
    const fields: SearchField[] = [
      {
        ...catalog[0]!,
        moduleScope: "matter",
        displayName: "Matter question",
        slug: "matter_question",
      },
      {
        ...catalog[0]!,
        moduleScope: "entity",
        displayName: "Entity question",
        slug: "entity_question",
      },
    ];
    stub(fields);
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advanced search" }));
    for (const [kind, name] of [
      ["Matter", "Matter question"],
      ["Entity", "Entity question"],
      ["Document", null],
    ] as const) {
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: kind }));
      await user.click(within(dialog).getByRole("button", { name: "Add condition" }));
      if (name) expect(await screen.findByRole("button", { name })).toBeVisible();
      else expect(screen.queryByText("Fields", { exact: true })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      await user.click(within(dialog).getByRole("button", { name: kind }));
    }
    await user.click(screen.getByRole("button", { name: "Close Advanced search" }));
    fields.push({ ...catalog[0]!, displayName: "New Field" });
    await user.click(screen.getByRole("button", { name: "Advanced search" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Contract" }));
    await user.click(within(dialog).getByRole("button", { name: "Add condition" }));
    expect(await screen.findByRole("button", { name: "New Field" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Matter question" })).not.toBeInTheDocument();
  });
  it("edits numeric ranges and renders valueless chips without an undefined value", async () => {
    stub();
    const { router } = renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advanced search" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Contract" }));
    await user.click(within(dialog).getByRole("button", { name: "Add condition" }));
    await user.click(await screen.findByRole("button", { name: "number" }));
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Operator" }), "between");
    await user.type(within(dialog).getByRole("spinbutton", { name: "From" }), "10");
    await user.type(within(dialog).getByRole("spinbutton", { name: "To" }), "20");
    await user.click(within(dialog).getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("button", { name: "Edit Contract number between 10, 20" }),
    ).toBeVisible();
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!)
        ?.conditions[0]?.value,
    ).toEqual([10, 20]);
    await user.click(screen.getByRole("button", { name: "Edit Contract number between 10, 20" }));
    await user.selectOptions(
      within(screen.getByRole("dialog")).getByRole("combobox", { name: "Operator" }),
      "is_empty",
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("button", { name: "Edit Contract number is empty" }),
    ).toBeVisible();
    await waitFor(() => expect(screen.queryByText(/undefined/)).not.toBeInTheDocument());
  });
});
