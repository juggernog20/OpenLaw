// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { expect, it, vi } from "vitest";
import { TitlePatternInput } from "./title-pattern-input";

function Example({
  initial = "NDA supplier agreement",
  fields = [{ slug: "supplier", label: "Supplier name" }],
  onBlur = () => {},
}) {
  const [value, setValue] = useState(initial);
  return (
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <label htmlFor="title">Title pattern</label>
      <TitlePatternInput
        id="title"
        value={value}
        fields={fields}
        onChange={setValue}
        onBlur={onBlur}
        onKeyDown={() => {}}
      />
      <button type="button">Next field</button>
    </IntlProvider>
  );
}

it("replaces selected text with a variable, restores the cursor, and commits when leaving the input group", async () => {
  const user = userEvent.setup();
  const commit = vi.fn();
  render(<Example onBlur={commit} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  await user.click(input);
  fireEvent.select(input, { target: { selectionStart: 4, selectionEnd: 12 } });
  expect(input.selectionStart).toBe(4);
  expect(input.selectionEnd).toBe(12);
  await user.click(screen.getByRole("button", { name: "Insert title variable" }));
  await user.click(await screen.findByRole("menuitem", { name: "Supplier name" }));
  expect(input).toHaveValue("NDA {{supplier}} agreement");
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(16);
  expect(commit).not.toHaveBeenCalled();
  await user.keyboard("!");
  expect(input).toHaveValue("NDA {{supplier}}! agreement");
  await user.click(screen.getByRole("button", { name: "Next field" }));
  expect(commit).toHaveBeenCalledOnce();
});

it("offers only the current form's variables and preserves text when dismissed", async () => {
  const user = userEvent.setup();
  render(<Example fields={[]} />);
  await user.click(screen.getByRole("button", { name: "Insert title variable" }));
  expect(
    await screen.findByRole("menuitem", { name: "Add form fields to make variables available." }),
  ).toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("textbox")).toHaveValue("NDA supplier agreement");
  expect(screen.getByRole("textbox")).toHaveFocus();
});

it("does not insert a variable beyond the title pattern limit", async () => {
  const user = userEvent.setup();
  render(<Example initial={"x".repeat(2000)} />);
  await user.click(screen.getByRole("button", { name: "Insert title variable" }));
  expect(await screen.findByRole("menuitem", { name: "Supplier name" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(screen.getByRole("textbox", { hidden: true })).toHaveValue("x".repeat(2000));
});
