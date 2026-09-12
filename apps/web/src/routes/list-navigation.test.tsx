// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, stubApi } from "../testing/helpers";
import { createMemoryRouter, RouterProvider } from "react-router";
import { IntlProvider } from "react-intl";
import { routes } from "../router";

const transitions = { held: false, pending: [] as (() => void)[] };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const subscribe = router.subscribe.bind(router);
  router.subscribe = (listener) =>
    subscribe((...args) => {
      if (transitions.held) transitions.pending.push(() => listener(...args));
      else listener(...args);
    });
  render(
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <RouterProvider router={router} />
    </IntlProvider>,
  );
  return { router };
}

async function commitNavigation() {
  transitions.held = false;
  await act(async () => {
    for (const callback of transitions.pending.splice(0)) callback();
  });
}
afterEach(() => {
  // Cleanup unmounts the subscribers. A failed test can leave updates held.
  transitions.held = false;
  transitions.pending.length = 0;
});

const MEMBER = {
  id: "member",
  email: "member@example.com",
  displayName: "Mina Member",
  role: "legal_team_member",
};
const SURFACES = [
  { path: "contracts", resource: "contracts", filter: "owner", label: "Owner" },
  { path: "matters", resource: "matters", filter: "priority", label: "Priority" },
  { path: "inbox", resource: "requests", filter: "urgency", label: "Urgency" },
] as const;

function row(title: string, id = "first") {
  return {
    id,
    number: id === "first" ? 1 : 2,
    title,
    contractTypeId: "type",
    contractTypeName: "NDA",
    matterTypeId: "type",
    matterTypeName: "Advice",
    statusId: "status",
    statusName: "Open",
    statusCategory: "open",
    stage: "draft",
    status: "new",
    manager: null,
    primaryCounterparty: null,
    priority: "high",
    urgency: "high",
    risk: null,
    value: null,
    description: null,
    customFields: {},
    isConfidential: false,
    endedAt: null,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    openedAt: "2026-08-01T00:00:00.000Z",
    closedAt: null,
    nextDeadline: null,
    requestType: { id: "type", displayName: "Advice", targetModule: null, targetTypeName: null },
    requester: { id: "requester", displayName: "Dana Reyes" },
    convertedContract: null,
    convertedRecord: null,
  };
}

describe.each(SURFACES)("$path navigation commits", ({ path, resource, filter, label }) => {
  it.each(
    ["filter", "page"].flatMap((action) =>
      ["before", "after"].flatMap((timing) =>
        ["success", "failure"].map((outcome) => ({ action, timing, outcome })),
      ),
    ),
  )(
    "retains a second $action result arriving $timing the loader commit ($outcome)",
    async ({ action, timing, outcome }) => {
      let holdRead = false;
      let answer: (() => void) | undefined;
      const reads: URL[] = [];
      stubApi({
        signedIn: MEMBER,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/${resource}` || call.method !== "GET")
            return undefined;
          reads.push(call.url);
          const paged = call.url.searchParams.has("cursor");
          const title = paged
            ? "Next page"
            : call.url.searchParams.has("status")
              ? "Initial record"
              : call.url.searchParams.has(filter)
                ? "Filtered record"
                : "Unfiltered record";
          const response = () =>
            json(200, {
              [resource]: [row(title, paged ? "second" : "first")],
              nextCursor: paged ? null : "next",
              total: 2,
              counts: { open: 2, onHold: 0 },
            });
          if (holdRead) {
            holdRead = false;
            return new Promise<Response>((resolve) => {
              answer = () =>
                resolve(outcome === "failure" ? problem(503, "Try again.") : response());
            });
          }
          return response();
        },
      });
      const { router } = renderAt(`/${path}?status=status&${filter}=high`);
      const user = userEvent.setup();
      await screen.findByRole("row", { name: /Initial record/ });

      // The router finishes its loader while React still shows the list's
      // locally accepted answer. Hold delivery to React, not router progress.
      transitions.held = true;
      await user.click(screen.getByRole("button", { name: "Remove Status filter" }));
      await vi.waitFor(() => {
        expect(router.state.navigation.state).toBe("idle");
        expect(new URLSearchParams(router.state.location.search).has("status")).toBe(false);
      });
      expect(transitions.pending.length).toBeGreaterThan(0);
      await screen.findByRole("row", { name: /Filtered record/ });
      holdRead = true;
      await user.click(
        screen.getByRole("button", {
          name: action === "page" ? "Show more" : `Remove ${label} filter`,
        }),
      );
      await vi.waitFor(() => expect(answer).toBeDefined());
      if (timing === "after") await commitNavigation();
      await act(async () => {
        answer!();
      });
      if (timing === "before") {
        if (outcome === "success" && action === "filter") {
          await vi.waitFor(() =>
            expect(new URLSearchParams(router.state.location.search).has(filter)).toBe(false),
          );
        }
        await commitNavigation();
      }
      if (outcome === "failure") {
        await screen.findByText(/could not be read/);
        expect(screen.getByRole("row", { name: /Filtered record/ })).toBeInTheDocument();
        expect(new URLSearchParams(router.state.location.search).get(filter)).toBe("high");
        await user.click(
          screen.getByRole("button", {
            name: action === "page" ? "Show more" : `Remove ${label} filter`,
          }),
        );
      }

      await screen.findByRole("row", {
        name: action === "page" ? /Next page/ : /Unfiltered record/,
      });
      if (action === "filter") {
        await waitFor(() =>
          expect(new URLSearchParams(router.state.location.search).has(filter)).toBe(false),
        );
        expect(
          screen.queryByRole("button", { name: `Remove ${label} filter` }),
        ).not.toBeInTheDocument();
        await act(async () => {
          await router.navigate(-1);
        });
        expect(screen.getByRole("row", { name: /Filtered record/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: `Remove ${label} filter` })).toBeInTheDocument();
        await act(async () => {
          await router.navigate(1);
        });
        expect(screen.getByRole("row", { name: /Unfiltered record/ })).toBeInTheDocument();
      } else {
        expect(reads.at(-1)?.searchParams.get(filter)).toBe("high");
        expect(screen.getByRole("row", { name: /Filtered record/ })).toBeInTheDocument();
      }
    },
  );
  it.each(["before", "after"] as const)(
    "adopts an external navigation with the page response %s its commit",
    async (responseOrder) => {
      let holdRead = false;
      let answer: (() => void) | undefined;
      stubApi({
        signedIn: MEMBER,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/${resource}` || call.method !== "GET")
            return undefined;
          const paged = call.url.searchParams.has("cursor");
          const title = paged
            ? "Next page"
            : call.url.searchParams.has(filter)
              ? "Filtered record"
              : "Unfiltered record";
          const response = () =>
            json(200, {
              [resource]: [row(title, paged ? "second" : "first")],
              nextCursor: paged ? null : "next",
              total: 2,
              counts: { open: 2, onHold: 0 },
            });
          if (holdRead) {
            holdRead = false;
            return new Promise<Response>((resolve) => {
              answer = () => resolve(response());
            });
          }
          return response();
        },
      });
      const { router } = renderAt(`/${path}?${filter}=high`);
      const user = userEvent.setup();
      await screen.findByRole("row", { name: /Filtered record/ });

      // A nav-rail click, not a list control. The list never asked for this
      // URL, so the answer is a list it has never shown and a page read
      // taken in the gap must not discard it.
      transitions.held = true;
      await act(async () => {
        await router.navigate(`/${path}`);
      });
      expect(router.state.navigation.state).toBe("idle");
      expect(transitions.pending.length).toBeGreaterThan(0);

      holdRead = true;
      await user.click(screen.getByRole("button", { name: "Show more" }));
      await vi.waitFor(() => expect(answer).toBeDefined());
      if (responseOrder === "before")
        await act(async () => {
          answer!();
        });
      await commitNavigation();
      if (responseOrder === "after") {
        await screen.findByRole("row", { name: /Unfiltered record/ });
        await act(async () => {
          answer!();
        });
      }

      await screen.findByRole("row", { name: /Unfiltered record/ });
      expect(screen.queryByRole("row", { name: /Filtered record/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("row", { name: /Next page/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: `Remove ${label} filter` }),
      ).not.toBeInTheDocument();
      expect(new URLSearchParams(router.state.location.search).has(filter)).toBe(false);
    },
  );
  it("adopts a navigation that interrupts the list's URL sync", async () => {
    let filteredReads = 0;
    let releaseSync: (() => void) | undefined;
    let releasePage: (() => void) | undefined;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== `/api/v1/${resource}` || call.method !== "GET") return undefined;
        const paged = call.url.searchParams.has("cursor");
        const title = paged
          ? "Stale page"
          : call.url.searchParams.get("status") === "status"
            ? "Initial record"
            : call.url.searchParams.has(filter)
              ? "Filtered record"
              : "External record";
        const response = () =>
          json(200, {
            [resource]: [row(title, paged ? "second" : "first")],
            nextCursor: paged ? null : "next",
            total: 2,
            counts: { open: 2, onHold: 0 },
          });
        if (paged)
          return new Promise<Response>((resolve) => {
            releasePage = () => resolve(response());
          });
        if (
          !call.url.searchParams.has("status") &&
          call.url.searchParams.has(filter) &&
          ++filteredReads === 2
        )
          return new Promise<Response>((resolve) => {
            releaseSync = () => resolve(response());
          });
        return response();
      },
    });
    const { router } = renderAt(`/${path}?status=status&${filter}=high`);
    const user = userEvent.setup();
    await screen.findByRole("row", { name: /Initial record/ });
    transitions.held = true;
    await user.click(screen.getByRole("button", { name: "Remove Status filter" }));
    await vi.waitFor(() => expect(releaseSync).toBeDefined());
    expect(router.state.navigation.state).toBe("loading");
    await act(async () => {
      await router.navigate(`/${path}`);
    });
    expect(router.state.navigation.state).toBe("idle");
    await act(async () => {
      releaseSync!();
    });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await vi.waitFor(() => expect(releasePage).toBeDefined());
    await commitNavigation();
    await act(async () => {
      releasePage!();
    });
    await screen.findByRole("row", { name: /External record/ });
    expect(
      screen.queryByRole("row", { name: /Filtered record|Stale page/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Remove ${label} filter` }),
    ).not.toBeInTheDocument();
  });
  it.each(["filter", "page"])(
    "discards an old %s answer after a newer navigation",
    async (action) => {
      let holdRead = false;
      let fresh = false;
      let answer: (() => void) | undefined;
      stubApi({
        signedIn: MEMBER,
        extra: (call) => {
          if (call.url.pathname !== `/api/v1/${resource}` || call.method !== "GET")
            return undefined;
          const response = (title: string) =>
            json(200, {
              [resource]: [row(title)],
              nextCursor: "next",
              total: 2,
              counts: { open: 2, onHold: 0 },
            });
          if (holdRead) {
            holdRead = false;
            return new Promise<Response>((resolve) => {
              answer = () => resolve(response("Stale record"));
            });
          }
          return response(fresh ? "Fresh record" : "Initial record");
        },
      });
      const { router } = renderAt(`/${path}?status=status&${filter}=high`);
      const user = userEvent.setup();
      await screen.findByRole("row", { name: /Initial record/ });
      holdRead = true;
      await user.click(
        screen.getByRole("button", {
          name: action === "page" ? "Show more" : "Remove Status filter",
        }),
      );
      await vi.waitFor(() => expect(answer).toBeDefined());
      fresh = true;
      await act(async () => {
        await router.navigate(`/${path}?${filter}=high`);
      });
      expect(screen.getByRole("row", { name: /Fresh record/ })).toBeInTheDocument();
      await act(async () => {
        answer!();
      });
      await waitFor(() => expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled());
      expect(screen.queryByRole("row", { name: /Stale record/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("row", { name: /Fresh record/ })).toHaveLength(1);
      expect(new URLSearchParams(router.state.location.search).get(filter)).toBe("high");
    },
  );
});
