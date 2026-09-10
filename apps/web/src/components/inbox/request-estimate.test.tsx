// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { IntlProvider } from "react-intl";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, stubApi } from "../../testing/helpers";
import { RequestEstimate, type EstimatedRequest } from "./request-estimate";

const initial = {
  number: 42,
  status: "new",
  expectedBy: null,
  suggestedExpectedBy: "2026-10-10",
} satisfies EstimatedRequest;
function mount(request: EstimatedRequest = initial) {
  function Editor() {
    const [saved, setSaved] = useState(request);
    return (
      <IntlProvider locale="en-US">
        <RequestEstimate request={saved} onSaved={setSaved} />
      </IntlProvider>
    );
  }
  render(<Editor />);
}
it("confirms a suggestion only on a click, retains failures for retry, and clears a saved estimate", async () => {
  let refuse = true;
  const writes: unknown[] = [];
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by")) {
        writes.push(call.body);
        if (refuse) return problem(500, "Could not save this estimate.");
        return json(200, { request: { ...initial, ...(call.body as object) } });
      }
    },
  });
  mount();
  const user = userEvent.setup();
  expect(writes).toEqual([]);
  await user.click(screen.getByRole("button", { name: /Use suggested date/ }));
  expect(await screen.findByText("Could not save this estimate.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Use suggested date/ })).toBeEnabled();
  refuse = false;
  await user.click(screen.getByRole("button", { name: /Use suggested date/ }));
  await user.click(await screen.findByRole("button", { name: "Clear estimate" }));
  await waitFor(() =>
    expect(writes).toEqual([
      { expectedBy: "2026-10-10" },
      { expectedBy: "2026-10-10" },
      { expectedBy: null },
    ]),
  );
  expect(await screen.findByRole("button", { name: /Use suggested date/ })).toBeEnabled();
});
it.each(["resolved", "declined"] as const)("keeps %s estimates read-only", (status) => {
  mount({ ...initial, status, expectedBy: "2026-10-11" });
  expect(screen.getByLabelText("Expected back (estimate)")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /Use suggested|Clear estimate/ }),
  ).not.toBeInTheDocument();
});
it("does not offer to overwrite a saved estimate with a changed suggestion", () => {
  mount({ ...initial, expectedBy: "2026-10-11" });
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("11");
  expect(screen.queryByRole("button", { name: /Use suggested date/ })).not.toBeInTheDocument();
});
