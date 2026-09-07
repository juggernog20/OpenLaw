// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderAt, stubApi } from "../testing/helpers";
import { dispositionApi, MEMBER, staffRequest, subbar } from "../testing/disposition";

it("keeps historical declined requests and their reasons readable", async () => {
  const api = dispositionApi({
    segment: "decline",
    initial: staffRequest({ status: "declined", declinedReason: "Ask Procurement." }),
    applied: (row) => row,
  });
  stubApi({ signedIn: MEMBER, extra: api.handler });
  renderAt("/inbox/45");
  expect(within(await subbar()).queryByRole("button", { name: "Triage" })).toBeNull();
  const outcome = await screen.findByRole("region", { name: "Outcome" });
  expect(within(outcome).getByText("Ask Procurement.")).toBeInTheDocument();
});
