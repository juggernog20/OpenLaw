// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DescribedField } from "./described-field";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const description = "The team funding the work.\nChoose the budget owner.";

function Field({ text = description }: { text?: string | null }) {
  return (
    <DescribedField description={text} descriptionId="department-description">
      <label htmlFor="department">Department</label>
      <input id="department" aria-describedby={text ? "department-description" : undefined} />
    </DescribedField>
  );
}

describe("saved field descriptions", () => {
  it("shows the description on hover or input focus and dismisses it with Escape", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByRole("textbox", { name: "Department" });
    expect(input).toHaveAccessibleDescription(description);
    expect(document.getElementById("department-description")).toHaveClass("sr-only");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.hover(input);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("The team funding the work.");
    await user.unhover(input);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    await user.tab();
    expect(input).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Choose the budget owner.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
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
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps a read-only field's description reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(
      <DescribedField description={description} descriptionId="readonly-description" tabIndex={0}>
        <span>Department</span>
        <span>Finance</span>
      </DescribedField>,
    );
    await user.tab();
    expect(document.activeElement).toHaveAccessibleDescription(description);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("The team funding the work.");
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
    act(() => screen.getByRole("textbox", { name: "Department" }).focus());
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
