// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { Label } from "./label";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

function Field() {
  return (
    <>
      <Label htmlFor="name" help="Use the full legal name." helpId="name-help" required>
        Name
      </Label>
      <input id="name" aria-describedby="name-help" />
    </>
  );
}

describe("field help", () => {
  it("waits 500 ms on hover and cancels a passing hover", () => {
    vi.useFakeTimers();
    try {
      render(
        <IntlProvider locale="en">
          <Field />
        </IntlProvider>,
      );
      const button = screen.getByRole("button", { name: "More information" });
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(499));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      fireEvent.pointerLeave(button);
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByRole("tooltip")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps labels and descriptions accessible without visible subtext", () => {
    render(
      <IntlProvider locale="en">
        <Field />
      </IntlProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription(
      "Use the full legal name.",
    );
    expect(screen.getByText("Use the full legal name.")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "More information" })).toHaveAccessibleDescription(
      "Name Use the full legal name.",
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on hover, remains readable over the tooltip, and closes on leaving", async () => {
    const user = userEvent.setup();
    render(
      <IntlProvider locale="en">
        <Field />
      </IntlProvider>,
    );
    const button = screen.getByRole("button", { name: "More information" });
    await user.hover(button);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Use the full legal name.");
    await user.unhover(button);
    await user.hover(tooltip);
    expect(tooltip).toBeVisible();
    await user.unhover(tooltip);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("supports keyboard focus and Escape without closing the containing dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <IntlProvider locale="en">
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <DialogTitle>Edit person</DialogTitle>
            <Field />
          </DialogContent>
        </Dialog>
      </IntlProvider>,
    );
    act(() => screen.getByRole("button", { name: "More information" }).focus());
    expect(screen.getByRole("button", { name: "More information" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("opens on touch without submitting the form or activating the input", async () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <IntlProvider locale="en">
        <form onSubmit={submit}>
          <Field />
        </form>
      </IntlProvider>,
    );
    const button = screen.getByRole("button", { name: "More information" });
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.focus(button);
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(await screen.findByRole("tooltip")).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).not.toHaveFocus();
    fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not add an icon for empty help", () => {
    render(
      <IntlProvider locale="en">
        <Label htmlFor="empty" help="">
          Empty
        </Label>
        <input id="empty" />
      </IntlProvider>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
