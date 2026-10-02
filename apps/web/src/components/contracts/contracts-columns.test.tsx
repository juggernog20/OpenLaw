// SPDX-License-Identifier: AGPL-3.0-only

import { CONTRACT_SORT_KEYS } from "@openlaw/shared";
import { expect, it } from "vitest";
import { CONTRACTS_CATALOGUE } from "./contracts-columns";

const column = (key: string) => CONTRACTS_CATALOGUE.columns.find((column) => column.key === key);

it.each(["nextDeadline", "noticeDeadline"])("lets the %s column sort", (key) => {
  expect(column(key)?.sortKey).toBe(key);
});

it("names only sort keys the list API accepts", () => {
  for (const { sortKey } of CONTRACTS_CATALOGUE.columns)
    if (sortKey) expect(CONTRACT_SORT_KEYS).toContain(sortKey);
});
