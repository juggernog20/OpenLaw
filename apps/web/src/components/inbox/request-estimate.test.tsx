// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { IntlProvider } from "react-intl";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { json, problem, stubApi } from "../../testing/helpers";
import { pickDate } from "../../testing/dates";
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
it("keeps a refused pick in the box, and Escape puts the saved date back", async () => {
  // A pick that the server would not take is still the pick triage
  // made. Snapping the box back to the saved date would lose it and
  // leave a refusal beside a date nobody chose (DES-048).
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by"))
        return problem(500, "Could not save this estimate.");
    },
  });
  mount({ ...initial, expectedBy: "2026-10-11" });
  const user = userEvent.setup();
  await pickDate(user, "Expected back (estimate)", "2026-10-20");
  expect(await screen.findByText("Could not save this estimate.")).toBeInTheDocument();
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("Oct 20, 2026");

  await user.keyboard("{Escape}");
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("Oct 11, 2026");
  expect(screen.queryByText("Could not save this estimate.")).not.toBeInTheDocument();
});

it.each(["new", "resolved"] as const)(
  "adopts a refreshed saved estimate when the Request is %s",
  (status) => {
    const editor = (request: EstimatedRequest) => (
      <IntlProvider locale="en-US">
        <RequestEstimate request={request} onSaved={() => {}} />
      </IntlProvider>
    );
    const view = render(editor({ ...initial, expectedBy: "2026-10-10" }));
    view.rerender(editor({ ...initial, expectedBy: "2026-10-12", status }));
    expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("Oct 12, 2026");
  },
);

it("shows the saved date when another triager closes a Request with a refused draft", async () => {
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by"))
        return problem(500, "Could not save this estimate.");
    },
  });
  const editor = (request: EstimatedRequest) => (
    <IntlProvider locale="en-US">
      <RequestEstimate request={request} onSaved={() => {}} />
    </IntlProvider>
  );
  const view = render(editor(initial));
  await userEvent.setup().click(screen.getByRole("button", { name: /Use suggested date/ }));
  await screen.findByText("Could not save this estimate.");
  view.rerender(editor({ ...initial, status: "resolved" }));
  expect(screen.getByLabelText("Expected back (estimate)")).toBeDisabled();
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("Select a date");
});

it.each([
  { label: "saved date changes", next: { ...initial, expectedBy: "2026-10-12" } },
  { label: "Request closes", next: { ...initial, status: "resolved" as const } },
  { label: "Request number changes", next: { ...initial, number: 43 } },
])("discards a pending save after $label", async ({ next }) => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by")) return response;
    },
  });
  const onSaved = vi.fn();
  const editor = (request: EstimatedRequest) => (
    <IntlProvider locale="en-US">
      <RequestEstimate request={request} onSaved={onSaved} />
    </IntlProvider>
  );
  const view = render(editor(initial));
  await userEvent.setup().click(screen.getByRole("button", { name: /Use suggested date/ }));
  expect(screen.getByText("Saving…")).toBeInTheDocument();
  view.rerender(editor(next));
  expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  await act(async () => {
    release(json(200, { request: { ...initial, expectedBy: "2026-10-10" } }));
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent(
    next.expectedBy ? "Oct 12, 2026" : "Select a date",
  );
  if (next.status === "resolved")
    expect(screen.getByLabelText("Expected back (estimate)")).toBeDisabled();
  else expect(screen.getByLabelText("Expected back (estimate)")).toBeEnabled();
});

it("discards a response from the Request editor that navigation unmounted", async () => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by")) return response;
    },
  });
  const onSaved = vi.fn();
  const editor = (request: EstimatedRequest) => (
    <IntlProvider locale="en-US">
      <RequestEstimate key={request.number} request={request} onSaved={onSaved} />
    </IntlProvider>
  );
  const view = render(editor(initial));
  await userEvent.setup().click(screen.getByRole("button", { name: /Use suggested date/ }));
  view.rerender(editor({ ...initial, number: 43 }));
  await act(async () => {
    release(json(200, { request: { ...initial, expectedBy: "2026-10-10" } }));
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("Select a date");
});

it("keeps a newer save pending when an obsolete refusal arrives, including converted Requests", async () => {
  const releases: ((response: Response) => void)[] = [];
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by"))
        return new Promise<Response>((resolve) => {
          releases.push(resolve);
        });
    },
  });
  const onSaved = vi.fn();
  const editor = (request: EstimatedRequest) => (
    <IntlProvider locale="en-US">
      <RequestEstimate request={request} onSaved={onSaved} />
    </IntlProvider>
  );
  const view = render(editor(initial));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Use suggested date/ }));
  const refreshed = { ...initial, expectedBy: "2026-10-12", status: "converted" as const };
  view.rerender(editor(refreshed));
  await user.click(screen.getByRole("button", { name: "Clear estimate" }));
  expect(releases).toHaveLength(2);
  await act(async () => {
    releases[0]!(problem(500, "Obsolete refusal"));
  });
  expect(screen.queryByText("Obsolete refusal")).not.toBeInTheDocument();
  expect(screen.getByText("Saving…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear estimate" })).toBeDisabled();
  await act(async () => {
    releases[1]!(json(200, { request: { ...refreshed, expectedBy: null } }));
  });
  expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...refreshed, expectedBy: null });
  expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
});

it("shows Saved when the parent adopts the estimate returned by this editor", async () => {
  stubApi({
    extra: (call) => {
      if (call.method === "PATCH" && call.url.pathname.endsWith("/expected-by"))
        return json(200, { request: { ...initial, expectedBy: "2026-10-10" } });
    },
  });
  mount();
  await userEvent.setup().click(screen.getByRole("button", { name: /Use suggested date/ }));
  expect(await screen.findByRole("button", { name: "Clear estimate" })).toBeEnabled();
  expect(screen.getByLabelText("Expected back (estimate)")).toHaveTextContent("Oct 10, 2026");
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});
