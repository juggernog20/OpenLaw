// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
import { dayBounds } from "../lib/format";
const ADMIN = {
  id: "admin",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator" as const,
};
const path = "/api/v1/audit-log/tool-calls";
const entry = {
  id: "call-1",
  createdAt: "2026-09-23T12:00:00Z",
  person: { id: "person", displayName: "Nadia Counsel" },
  clientName: "Claude Code",
  tool: "openlaw_whoami",
  outcome: "success",
  durationMs: 42,
};
it("shows Tool calls in the settings section tabs, pages and exports the selected dates", async () => {
  const reads: URLSearchParams[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === path) {
        reads.push(call.url.searchParams);
        return json(200, {
          entries: call.url.searchParams.has("cursor")
            ? [{ ...entry, id: "call-2", tool: "openlaw_search", outcome: "rate_limited" }]
            : [entry],
          nextCursor: call.url.searchParams.has("cursor") ? null : "call-1",
        });
      }
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/audit-log/tool-calls");
  expect(await screen.findByText("openlaw_whoami")).toBeInTheDocument();
  const tabs = screen.getByRole("navigation", { name: "Audit log panes" });
  expect(within(tabs).getByRole("link", { name: "Tool calls" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(within(tabs).getByRole("link", { name: "Activity" })).not.toHaveAttribute("aria-current");
  for (const value of ["Nadia Counsel", "Claude Code", "Success", "42 ms"])
    expect(screen.getByText(value)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("openlaw_search")).toBeInTheDocument();
  expect(screen.getByText("Rate limited")).toBeInTheDocument();
  expect(reads.at(-1)?.get("cursor")).toBe("call-1");
  await user.type(screen.getByLabelText("From"), "2026-09-23");
  await user.type(screen.getByLabelText("To"), "2026-09-24");
  await waitFor(() => expect(reads.at(-1)?.get("to")).toBe(dayBounds("2026-09-24")!.end));
  expect(reads.at(-1)?.get("from")).toBe(dayBounds("2026-09-23")!.start);
  expect(reads.at(-1)?.has("cursor")).toBe(false);
  const href = new URL(
    screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")!,
    "http://localhost",
  );
  expect(href.pathname).toBe(`${path}/export`);
  expect(href.searchParams.get("from")).toBe(dayBounds("2026-09-23")!.start);
  expect(href.searchParams.get("to")).toBe(dayBounds("2026-09-24")!.end);
  expect(href.searchParams.has("cursor")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(reads.at(-1)?.toString()).toBe(""));
});
it("resolves the MCP last-day link to a 24-hour window shared by the read and export", async () => {
  const reads: URLSearchParams[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === path) {
        reads.push(call.url.searchParams);
        return json(200, { entries: [], nextCursor: null });
      }
    },
  });
  const before = Date.now();
  renderAt("/settings/audit-log/tool-calls?range=last-day");
  expect(await screen.findByText("No Tool calls match these filters.")).toBeInTheDocument();
  const query = reads[0]!;
  const from = Date.parse(query.get("from")!);
  const to = Date.parse(query.get("to")!);
  expect(to - from).toBe(86_400_000);
  expect(to).toBeGreaterThanOrEqual(before);
  expect(to).toBeLessThanOrEqual(Date.now());
  const href = new URL(
    screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")!,
    "http://localhost",
  );
  expect(href.searchParams.toString()).toBe(query.toString());
});
it.each(["legal_team_member", "business_user"] as const)(
  "redirects a %s without reading Tool calls",
  async (role) => {
    const reads: string[] = [];
    stubApi({
      signedIn: { ...ADMIN, role },
      extra: (call) => {
        if (call.url.pathname === path) reads.push(path);
      },
    });
    const { router } = renderAt("/settings/audit-log/tool-calls");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        role === "business_user" ? "/portal" : "/settings/profile",
      ),
    );
    expect(reads).toEqual([]);
  },
);
it("shows a retry action when Tool calls cannot load", async () => {
  let fail = true;
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === path)
        return fail ? problem(500, "failure") : json(200, { entries: [entry], nextCursor: null });
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/audit-log/tool-calls");
  expect(await screen.findByRole("alert")).toHaveTextContent("Tool calls could not be read.");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("openlaw_whoami")).toBeInTheDocument();
});
