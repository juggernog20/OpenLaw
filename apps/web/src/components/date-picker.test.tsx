// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { useState } from "react";
import { DatePicker, civilToLocalDate, localDateToCivil } from "./date-picker";
import { pickDate } from "../testing/dates";

/** The picker under a label, with whatever it has recorded written out
 * beside it. The civil date is shown as text rather than through a test
 * id: it is what the tests read, and reading it the way a person would
 * keeps the assertions honest about what is on screen. */
function Harness({
  initial = "",
  onRevert,
}: Readonly<{ initial?: string; onRevert?: () => void }>) {
  const [value, setValue] = useState(initial);
  return (
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <label htmlFor="when">When</label>
      <DatePicker id="when" value={value} onChange={setValue} onRevert={onRevert} />
      <span>{value || "(empty)"}</span>
    </IntlProvider>
  );
}

describe("civil date conversion", () => {
  it("round-trips a calendar date in local time", () => {
    const date = civilToLocalDate("2026-03-01");
    expect(date).toBeDefined();
    expect(localDateToCivil(date!)).toBe("2026-03-01");
  });

  it("rejects an impossible civil date", () => {
    expect(civilToLocalDate("2026-02-31")).toBeUndefined();
    expect(civilToLocalDate("not-a-date")).toBeUndefined();
  });
});

describe("DatePicker", () => {
  it("shows the placeholder when empty and the formatted date when set", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByLabelText("When")).toHaveTextContent("Select a date");
    unmount();

    render(<Harness initial="2026-03-01" />);
    expect(screen.getByLabelText("When")).toHaveTextContent("Mar 1, 2026");
  });

  it("writes a civil date when a day is picked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await pickDate(user, "When", "2026-03-01");

    expect(screen.getByText("2026-03-01")).toBeInTheDocument();
    expect(screen.getByLabelText("When")).toHaveTextContent("Mar 1, 2026");
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).not.toBeInTheDocument();
  });

  it("clears back to nothing recorded", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-03-01" />);

    await user.click(screen.getByLabelText("When"));
    await user.click(screen.getByRole("button", { name: "Clear date" }));

    expect(screen.getByText("(empty)")).toBeInTheDocument();
    expect(screen.getByLabelText("When")).toHaveTextContent("Select a date");
  });

  it("reverts on Escape from the closed trigger without opening the calendar", async () => {
    // The same key the typed fields use (DES-048). It is the way back
    // out of a pick the server refused, so it has to work on the
    // trigger itself rather than only inside the calendar.
    const user = userEvent.setup();
    const onRevert = vi.fn();
    render(<Harness initial="2026-03-01" onRevert={onRevert} />);

    await user.click(screen.getByLabelText("When"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onRevert).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).not.toBeInTheDocument();
  });
});
