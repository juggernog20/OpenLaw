// SPDX-License-Identifier: AGPL-3.0-only

import { CONTRACT_SORT_KEYS } from "@openlaw/shared";
import { render, screen } from "@testing-library/react";
import { createIntl, IntlProvider } from "react-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractRow } from "../../lib/contracts";
import { CONTRACTS_CATALOGUE } from "./contracts-columns";

const column = (key: string) => CONTRACTS_CATALOGUE.columns.find((column) => column.key === key);

it.each(["nextDeadline", "noticeDeadline"])("lets the %s column sort", (key) => {
  expect(column(key)?.sortKey).toBe(key);
});

it("names only sort keys the list API accepts", () => {
  for (const { sortKey } of CONTRACTS_CATALOGUE.columns)
    if (sortKey) expect(CONTRACT_SORT_KEYS).toContain(sortKey);
});

describe("the Notice by cell", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const intl = createIntl({ locale: "en-US", defaultLocale: "en-US", onError: () => {} });
  const cell = (noticeDeadline: string) =>
    render(
      <IntlProvider locale="en-US" defaultLocale="en-US" onError={() => {}}>
        {column("noticeDeadline")!.render({ noticeDeadline } as ContractRow, intl)}
      </IntlProvider>,
    );

  it("says Passed under a date before today", () => {
    cell("2026-08-16");
    expect(screen.getByText("Aug 16")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it.each(["2026-08-17", "2026-09-01"])("shows %s as a plain date", (date) => {
    cell(date);
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
  });
});
