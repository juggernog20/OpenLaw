// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { expect, it, vi } from "vitest";
import { MatterStatusProgression } from "./matter-status-progression";
import type { MatterStatusOption } from "../../lib/matters";

const statuses: MatterStatusOption[] = [
  { id: "open", slug: "open", displayName: "Open", category: "open", progressionGroup: "open" },
  {
    id: "hold",
    slug: "on_hold",
    displayName: "On hold",
    category: "open",
    progressionGroup: "open",
  },
  {
    id: "work",
    slug: "in_progress",
    displayName: "In progress",
    category: "open",
    progressionGroup: "in_progress",
  },
  {
    id: "business",
    slug: "custom",
    displayName: "With business",
    category: "open",
    progressionGroup: "waiting",
  },
  {
    id: "counsel",
    slug: "other_custom",
    displayName: "With external counsel",
    category: "open",
    progressionGroup: "waiting",
  },
  {
    id: "closed",
    slug: "closed",
    displayName: "Closed",
    category: "closed",
    progressionGroup: "in_progress",
  },
];

it("groups On hold with Open and offers only the selected group's statuses", async () => {
  const pick = vi.fn();
  render(
    <IntlProvider locale="en">
      <MatterStatusProgression statuses={statuses} statusId="hold" busy={false} onPick={pick} />
    </IntlProvider>,
  );
  const user = userEvent.setup();
  expect(
    screen.getByRole("list", { name: "Status" }).querySelector('[aria-current="step"]'),
  ).toHaveTextContent("Open");
  await user.click(screen.getByRole("button", { name: "Open — move matter" }));
  expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
    "Open",
    "On hold",
  ]);
  expect(screen.getByRole("menuitemradio", { name: "On hold" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Waiting — move matter" }));
  expect(within(screen.getByRole("menu")).queryByText("Open")).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitemradio", { name: "With external counsel" }));
  expect(pick).toHaveBeenCalledExactlyOnceWith("counsel");
});

it("keeps renamed waiting statuses grouped, with no controls for a read-only record", () => {
  render(
    <IntlProvider locale="en">
      <MatterStatusProgression
        statuses={statuses.map((status) =>
          status.id === "business" ? { ...status, displayName: "Instructions pending" } : status,
        )}
        statusId="business"
        busy={false}
      />
    </IntlProvider>,
  );
  expect(
    screen.getByRole("list", { name: "Status" }).querySelector('[aria-current="step"]'),
  ).toHaveTextContent("Waiting");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
