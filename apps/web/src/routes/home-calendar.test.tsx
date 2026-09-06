// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const today = new Date();
const year = today.getFullYear();
const month = today.getMonth();
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const firstDay = dateKey(new Date(year, month, 1));
const lastDay = dateKey(new Date(year, month + 1, 0));
const nextFirst = dateKey(new Date(year, month + 1, 1));
const rows = [12, 12, 13, 20].map((day, index) => ({
  source: "key_date",
  keyDateId: `date-${index}`,
  date: dateKey(new Date(year, month, day)),
  label: index === 3 ? "Beyond the Home preview" : `Deadline ${index + 1}`,
  noticePeriodDays: null,
  unverified: false,
  record: {
    kind: index === 1 ? "matter" : "contract",
    id: `record-${index}`,
    number: index + 1,
    title: `Record ${index + 1}`,
    isConfidential: index === 0,
  },
}));

describe("Home dates calendar", () => {
  it("opens all dates in a modal, filters a day, browses months, and restores trigger focus", async () => {
    const user = userEvent.setup();
    const reads: string[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/home")
          return json(200, { sections: [{ type: "dates", total: 4, rows: rows.slice(0, 3) }] });
        if (call.url.pathname === "/api/v1/home/dates") {
          const from = call.url.searchParams.get("from")!;
          reads.push(from);
          if (from === firstDay) {
            expect(call.url.searchParams.get("to")).toBe(lastDay);
            return json(200, { total: 4, rows });
          }
          return json(200, { total: 0, rows: [] });
        }
        return undefined;
      },
    });
    const { router } = renderAt("/");
    const trigger = await screen.findByRole("button", { name: "View all 4" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Your dates" });
    expect(await within(dialog).findByText("Beyond the Home preview")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    expect(within(dialog).getByRole("link", { name: /Deadline 2/ })).toHaveAttribute(
      "href",
      "/matters/2/key-dates",
    );
    expect(within(dialog).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    const dayName = new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, month, 12),
    );
    await user.click(within(dialog).getByRole("button", { name: `${dayName} — 2 dates` }));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "Show whole month" }));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    await user.click(within(dialog).getByRole("button", { name: /Next Month/i }));
    expect(await within(dialog).findByText("No dates in this period.")).toBeInTheDocument();
    expect(reads).toContain(nextFirst);
    await user.click(within(dialog).getByRole("button", { name: "Today" }));
    await waitFor(() => expect(reads.filter((from) => from === firstDay)).toHaveLength(2));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(router.state.location.pathname).toBe("/");
  });

  it("shows failed reads with a working retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/home")
          return json(200, { sections: [{ type: "dates", total: 4, rows: rows.slice(0, 3) }] });
        if (call.url.pathname === "/api/v1/home/dates")
          return fail ? problem(503, "Unavailable") : json(200, { total: 4, rows });
        return undefined;
      },
    });
    renderAt("/");
    await user.click(await screen.findByRole("button", { name: "View all 4" }));
    const dialog = await screen.findByRole("dialog", { name: "Your dates" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Dates could not be loaded");
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByText("Beyond the Home preview")).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close calendar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
