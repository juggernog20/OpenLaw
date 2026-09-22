// SPDX-License-Identifier: AGPL-3.0-only

import { act, render as renderUi, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent, ReactNode } from "react";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { DescribedField, DescribedFieldLabel } from "./described-field";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const description = "The team funding the work.\nChoose the budget owner.";

function render(children: ReactNode) {
  return renderUi(
    <IntlProvider locale="en-US" defaultLocale="en-US">
      {children}
    </IntlProvider>,
  );
}

function Field({ text = description }: { text?: string | null }) {
  return (
    <DescribedField description={text} descriptionId="department-description">
      <DescribedFieldLabel fieldName="Department" htmlFor="department">
        Department
      </DescribedFieldLabel>
      <input id="department" aria-describedby={text ? "department-description" : undefined} />
    </DescribedField>
  );
}

describe("saved field descriptions", () => {
  it("shows the description on icon hover or focus and dismisses it with Escape", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByRole("textbox", { name: "Department" });
    const icon = screen.getByRole("button", { name: "Show description for Department" });
    expect(input).toHaveAccessibleDescription(description);
    expect(document.getElementById("department-description")).toHaveClass("sr-only");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.hover(icon);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("The team funding the work.");
    await user.unhover(icon);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    await user.tab();
    expect(icon).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Choose the budget owner.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(icon).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription(description);
  });

  it.each([null, "", "   "])("adds no tooltip for an empty description (%j)", async (text) => {
    const user = userEvent.setup();
    render(<Field text={text} />);
    const input = screen.getByRole("textbox", { name: "Department" });
    await user.tab();
    await user.hover(input);
    expect(input.parentElement).not.toHaveAttribute("data-state");
    expect(
      screen.queryByRole("button", { name: "Show description for Department" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps a read-only field's description reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(
      <DescribedField description={description} descriptionId="readonly-description">
        <DescribedFieldLabel fieldName="Department">Department</DescribedFieldLabel>
        <span>Finance</span>
      </DescribedField>,
    );
    await user.tab();
    expect(document.activeElement).toHaveAccessibleDescription(description);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("The team funding the work.");
  });

  it("opens on touch and dismisses outside without changing a checkbox or submitting the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <DescribedField description={description} descriptionId="checkbox-description">
          <DescribedFieldLabel fieldName="Department" htmlFor="department">
            Department
          </DescribedFieldLabel>
          <input id="department" type="checkbox" onChange={onChange} />
        </DescribedField>
        <button type="button">Another control</button>
      </form>,
    );
    const icon = screen.getByRole("button", { name: "Show description for Department" });
    await user.pointer({ target: icon, keys: "[TouchA]" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("The team funding the work.");
    await user.pointer({
      target: screen.getByRole("button", { name: "Another control" }),
      keys: "[TouchA]",
    });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("dismisses the tooltip without closing the containing dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle>Create record</DialogTitle>
          <Field />
        </DialogContent>
      </Dialog>,
    );
    act(() => screen.getByRole("button", { name: "Show description for Department" }).focus());
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
