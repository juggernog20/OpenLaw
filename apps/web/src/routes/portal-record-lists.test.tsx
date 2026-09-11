// SPDX-License-Identifier: AGPL-3.0-only

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const BUSINESS = {
  id: "business",
  email: "business@example.com",
  displayName: "Business colleague",
  role: "business_user",
};
const owner = { id: "lawyer", displayName: "Legal colleague", image: null };
const options = {
  types: [{ id: "type-a", displayName: "Advice" }],
  owners: [owner],
  statuses: [{ id: "open", displayName: "In progress" }],
};
const contract = {
  number: 12,
  title: "Supply agreement",
  type: "Advice",
  stage: "active",
  counterparty: "Supplier Ltd",
  legalOwner: owner,
  businessOwner: null,
  expiryDate: "2026-12-31",
  effectiveDate: "2026-01-01",
  value: null,
};
const matter = {
  number: 12,
  title: "Supply advice",
  type: "Advice",
  status: "In progress",
  category: "open",
  manager: owner,
  businessOwner: null,
};

for (const module of ["contracts", "matters"] as const) {
  const title = module === "contracts" ? "Contracts" : "Matters";
  const record = module === "contracts" ? contract : matter;
  const response = (rows = [record], nextCursor: number | null = null, total = rows.length) =>
    json(200, { [module]: rows, nextCursor, total, filterOptions: options });
  describe(`Your ${title}`, () => {
    it("uses URL search and filters, sorts at the server, and restores the previous query on Back", async () => {
      const calls: URL[] = [];
      stubApi({
        signedIn: BUSINESS,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/portal/${module}`) return undefined;
          calls.push(call.url);
          return response();
        },
      });
      const { router } = renderAt(`/portal/${module}?q=Supply&typeId=type-a&sort=title&dir=desc`);
      await screen.findByRole("heading", { name: `Your ${title}` });
      expect(screen.getByRole("table")).toBeVisible();
      const search = screen.getByRole("searchbox", { name: `Search ${title}` });
      expect(search).toHaveValue("Supply");
      expect(screen.getByRole("columnheader", { name: "Title" })).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      expect(calls[0]!.searchParams.get("typeId")).toBe("type-a");
      const user = userEvent.setup();
      await user.clear(search);
      await user.type(search, "Updated{Enter}");
      await waitFor(() => expect(router.state.location.search).toContain("q=Updated"));
      expect(calls.at(-1)!.searchParams.get("sort")).toBe("title");
      await act(async () => {
        await router.navigate(-1);
      });
      await waitFor(() => expect(search).toHaveValue("Supply"));
      await user.click(
        within(screen.getByRole("columnheader", { name: "Title" })).getByRole("button", {
          name: "Title",
        }),
      );
      await waitFor(() => expect(router.state.location.search).not.toContain("sort="));
      expect(calls.at(-1)!.searchParams.get("q")).toBe("Supply");
    });
    it("applies the shared filter menu, clears its chip, and changes visible columns locally", async () => {
      const calls: URL[] = [];
      stubApi({
        signedIn: BUSINESS,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/portal/${module}`) return undefined;
          calls.push(call.url);
          return response();
        },
      });
      const { router } = renderAt(`/portal/${module}`);
      await screen.findByRole("table");
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Filter" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
          name: "Type",
        }),
      );
      await user.click(screen.getByRole("radio", { name: "Advice" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(router.state.location.search).toContain("typeId=type-a"));
      expect(screen.getByRole("button", { name: "Type: Advice" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Clear all" }));
      await waitFor(() => expect(router.state.location.search).not.toContain("typeId"));
      const count = calls.length;
      await user.click(screen.getByRole("button", { name: "Columns" }));
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Business Owner" }));
      await user.keyboard("{Escape}");
      expect(screen.getByRole("columnheader", { name: "Business Owner" })).toBeVisible();
      expect(calls).toHaveLength(count);
    });
    it("appends pages with the active query and retains the table when search fails", async () => {
      let failed = true;
      const calls: URL[] = [];
      stubApi({
        signedIn: BUSINESS,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/portal/${module}`) return undefined;
          calls.push(call.url);
          if (call.url.searchParams.get("q") === "missing")
            return failed ? problem(503, "Unavailable") : response([]);
          return call.url.searchParams.has("cursor")
            ? response([{ ...record, number: 11, title: "Earlier work" }], null, 2)
            : response([record], 12, 2);
        },
      });
      const { router } = renderAt(`/portal/${module}?q=Supply&sort=title`);
      await screen.findByRole("table");
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Show more" }));
      expect(await screen.findByRole("link", { name: "Earlier work" })).toBeVisible();
      expect(screen.getByRole("link", { name: record.title })).toBeVisible();
      expect(calls.at(-1)!.searchParams.get("cursor")).toBe("12");
      expect(calls.at(-1)!.searchParams.get("q")).toBe("Supply");
      expect(screen.getByText("2 of 2 records")).toBeVisible();
      const search = screen.getByRole("searchbox", { name: `Search ${title}` });
      await user.clear(search);
      await user.type(search, "missing{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("The list could not be updated");
      expect(screen.getByRole("link", { name: record.title })).toBeVisible();
      expect(router.state.location.search).toContain("q=Supply");
      failed = false;
      await user.click(screen.getByRole("button", { name: "Search" }));
      expect(
        await screen.findByRole("heading", { name: "No records match your search or filters" }),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
      expect(await screen.findByRole("link", { name: record.title })).toBeVisible();
    });
    it("discards a page that completes after navigation changes the search", async () => {
      let finish: ((response: Response) => void) | undefined;
      stubApi({
        signedIn: BUSINESS,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/portal/${module}`) return undefined;
          if (call.url.searchParams.has("cursor"))
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          return response(
            [
              {
                ...record,
                title: call.url.searchParams.get("q") === "new" ? "New search" : record.title,
              },
            ],
            12,
            2,
          );
        },
      });
      const { router } = renderAt(`/portal/${module}?q=old`);
      await screen.findByRole("table");
      await userEvent.setup().click(screen.getByRole("button", { name: "Show more" }));
      await act(async () => {
        await router.navigate(`/portal/${module}?q=new`);
      });
      expect(await screen.findByRole("link", { name: "New search" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
      await act(async () => {
        finish!(response([{ ...record, number: 11, title: "Stale page" }]));
      });
      expect(screen.queryByRole("link", { name: "Stale page" })).not.toBeInTheDocument();
      expect(screen.getByRole("searchbox", { name: `Search ${title}` })).toHaveValue("new");
    });
  });
}
