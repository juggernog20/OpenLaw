// SPDX-License-Identifier: AGPL-3.0-only
import {
  decodeSearchQuestion,
  encodeSearchQuestion,
  simpleSearchQuestion,
  type SearchQuestion,
} from "@openlaw/shared";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "recent-reader",
  email: "reader@example.com",
  displayName: "Reader",
  role: "legal_team_member",
};
const KEY = `openlaw.recent-searches.${MEMBER.id}`;
const QUESTION: SearchQuestion = {
  ...simpleSearchQuestion("renewal", ["contract", "document"]),
  words: { all: "renewal", phrase: "notice period", any: "extend renew", none: "draft" },
  scope: { titles: false, text: true, contents: true },
  conditions: [{ kind: "contract", property: "expiry", operator: "in_next_days", value: 90 }],
  match: "any",
  sort: "expiry",
};
function stored(): SearchQuestion[] {
  return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SearchQuestion[];
}
function stub(saved = false, member = MEMBER) {
  const calls: StubCall[] = [];
  let signedOut = false;
  stubApi({
    signedIn: member,
    extra: (call) => {
      calls.push(call);
      if (call.url.pathname === "/api/auth/sign-out") {
        signedOut = true;
        return json(200, { success: true });
      }
      if (signedOut && call.url.pathname === "/api/v1/me") return problem(401, "Signed out");
      if (call.url.pathname === "/api/v1/list-views")
        return json(200, {
          views: saved
            ? [
                {
                  id: "renewals",
                  surface: "search",
                  name: "Renewals",
                  config: QUESTION,
                  isDefault: false,
                },
              ]
            : [],
        });
      if (call.url.pathname === "/api/v1/search/query")
        return json(200, { results: [], total: 0, nextCursor: null });
      if (call.url.pathname === "/api/v1/search/fields")
        return json(200, { fields: [], people: [], entities: [] });
      return undefined;
    },
  });
  return calls;
}
async function focusBox() {
  const input = await screen.findByRole("combobox", { name: "Search" });
  await userEvent.setup().click(input);
  return input;
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("recent searches", () => {
  it("records a results question after navigation commits, without updating history during a pending loader", async () => {
    let answer: ((response: Response) => void) | undefined;
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/search/query"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : undefined,
    });
    const { router } = renderAt("/");
    await screen.findByRole("combobox", { name: "Search" });
    let navigation: Promise<void> | undefined;
    act(() => {
      navigation = router.navigate("/search?q=renewal");
    });
    await waitFor(() => expect(answer).toBeDefined());
    expect(stored()).toEqual([]);
    await act(async () => {
      answer?.(json(200, { results: [], total: 0, nextCursor: null }));
      await navigation;
    });
    await waitFor(() => expect(stored()).toEqual([simpleSearchQuestion("renewal")]));
  });

  it("records a dialog run, preserves the whole question, and restores it without recording previews", async () => {
    const calls = stub();
    const { router } = renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advanced search" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("All of these words"), "renewal");
    await waitFor(() =>
      expect(calls.some((call) => call.url.pathname.endsWith("/search/query"))).toBe(true),
    );
    expect(stored()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Search" }));
    await waitFor(() => expect(stored()).toEqual([simpleSearchQuestion("renewal")]));
    await act(() => router.navigate(`/search?aq=${encodeSearchQuestion(QUESTION)}`));
    await waitFor(() => expect(stored()[0]).toEqual(QUESTION));
    await act(() => router.navigate("/"));
    await user.click(await screen.findByRole("button", { name: "Advanced search" }));
    const recent = screen.getByRole("region", { name: "Recent searches" });
    const entry = within(recent).getAllByRole("button")[0]!;
    expect(entry.textContent).toBe(
      "renewal · This exact phrase: notice period · Any of these words: extend renew · None of these words: draft · Contracts + Documents · Record text + Document contents · Expiry date in the next 90 days · Sort: Expiry soonest",
    );
    await user.click(entry);
    expect(screen.getByLabelText("This exact phrase")).toHaveValue("notice period");
    expect(router.state.location.pathname).toBe("/");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(
        decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!),
      ).toEqual(QUESTION),
    );
    expect(
      calls.filter((call) => call.method !== "GET" && call.url.pathname !== "/api/v1/search/query"),
    ).toEqual([]);
  });

  it("keeps five distinct results-page questions and moves a repeat to the top", async () => {
    stub();
    const { router } = renderAt("/search?q=first");
    await waitFor(() => expect(stored()).toHaveLength(1));
    for (const word of ["second", "third", "fourth", "fifth", "sixth", "third"]) {
      await act(() => router.navigate(`/search?q=${word}`));
      await waitFor(() => expect(stored()[0]?.words.all).toBe(word));
    }
    expect(stored().map((q) => q.words.all)).toEqual([
      "third",
      "sixth",
      "fifth",
      "fourth",
      "second",
    ]);
    await act(() => router.navigate("/search"));
    expect(stored()).toHaveLength(5);
  });

  it("scopes persisted history to the signed-in user and clears it on sign-out", async () => {
    stub();
    const { router, view } = renderAt("/search?q=private");
    await waitFor(() => expect(stored()).toHaveLength(1));
    view.unmount();
    router.dispose();
    stub(false, { ...MEMBER, id: "other-reader" });
    const other = renderAt("/");
    await focusBox();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    other.view.unmount();
    other.router.dispose();
    stub();
    const signedIn = renderAt("/");
    await focusBox();
    expect(await screen.findByRole("option", { name: /private/ })).toBeVisible();
    localStorage.setItem("unrelated-preference", "keep");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reader" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    await waitFor(() => expect(signedIn.router.state.location.pathname).toBe("/auth/login"));
    expect(localStorage.getItem("unrelated-preference")).toBe("keep");
  });

  it.each(["Saved", "Recent"])("runs a %s entry from the empty header box", async (group) => {
    localStorage.setItem(KEY, JSON.stringify([QUESTION]));
    stub(true);
    const { router } = renderAt("/");
    await focusBox();
    const list = await screen.findByRole("group", { name: group });
    await userEvent.setup().click(within(list).getByRole("option"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/search"));
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!),
    ).toEqual(QUESTION);
  });

  it("navigates the empty groups with arrows and Enter, skips disabled See all, and closes on Escape and blur", async () => {
    localStorage.setItem(KEY, JSON.stringify([simpleSearchQuestion("recent")]));
    stub(true);
    const { router } = renderAt("/");
    const input = await focusBox();
    const saved = await screen.findByRole("option", { name: "Renewals" });
    expect(input).toHaveAttribute("aria-activedescendant", saved.id);
    expect(screen.getByRole("option", { name: "See all results" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const user = userEvent.setup();
    await user.keyboard("{Escape}{ArrowUp}");
    expect(screen.getByRole("option", { name: "Advanced search…" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.focus(input);
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/search"));
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!)?.words.all,
    ).toBe("recent");
  });

  it("removes the empty groups on the first keystroke and keeps the two-character rule", async () => {
    localStorage.setItem(KEY, JSON.stringify([simpleSearchQuestion("recent")]));
    const calls = stub(true);
    renderAt("/");
    const input = await focusBox();
    await screen.findByRole("group", { name: "Saved" });
    const user = userEvent.setup();
    await user.type(input, "r");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(calls.filter((call) => call.url.pathname === "/api/v1/search")).toEqual([]);
    await user.type(input, "e");
    await waitFor(() =>
      expect(calls.some((call) => call.url.pathname === "/api/v1/search")).toBe(true),
    );
    expect(screen.queryByRole("group", { name: "Saved" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
    await user.clear(input);
    expect(await screen.findByRole("group", { name: "Recent" })).toBeVisible();
  });

  it("summarises conditions without the kind prefix and spells the joiner only for match any", async () => {
    const conditions: SearchQuestion["conditions"] = [
      { kind: "matter", property: "opened", operator: "this_month" },
      { kind: "matter", property: "deadline", operator: "in_next_days", value: 30 },
    ];
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { ...simpleSearchQuestion("", ["matter"]), conditions, match: "any" },
        { ...simpleSearchQuestion("", ["matter"]), conditions },
      ]),
    );
    stub();
    renderAt("/");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Advanced search" }));
    const recent = screen.getByRole("region", { name: "Recent searches" });
    expect(
      within(recent)
        .getAllByRole("button")
        .map((entry) => entry.textContent),
    ).toEqual([
      "Matters · Opened date this month OR Next deadline in the next 30 days",
      "Matters · Opened date this month · Next deadline in the next 30 days",
    ]);
  });

  it("ignores corrupt storage and keeps search usable when storage is unavailable", async () => {
    localStorage.setItem(KEY, "invalid json");
    stub();
    const { router } = renderAt("/");
    await focusBox();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded");
    });
    await act(() => router.navigate("/search?q=renewal"));
    expect(
      await screen.findByRole("heading", { name: "Search results for “renewal”" }),
    ).toBeVisible();
  });

  it("treats reordered kinds as the same question and keeps a changed sort distinct", async () => {
    stub();
    const { router } = renderAt(`/search?aq=${encodeSearchQuestion(QUESTION)}`);
    await waitFor(() => expect(stored()).toHaveLength(1));
    await act(() =>
      router.navigate(
        `/search?aq=${encodeSearchQuestion({ ...QUESTION, kinds: ["document", "contract"] })}`,
      ),
    );
    expect(stored()).toHaveLength(1);
    await act(() =>
      router.navigate(`/search?aq=${encodeSearchQuestion({ ...QUESTION, sort: "title" })}`),
    );
    expect(stored()).toHaveLength(2);
  });

  it("updates an open list when another tab clears history", async () => {
    localStorage.setItem(KEY, JSON.stringify([simpleSearchQuestion("recent")]));
    stub();
    renderAt("/");
    await focusBox();
    expect(await screen.findByRole("group", { name: "Recent" })).toBeVisible();
    act(() => {
      localStorage.removeItem(KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: null }));
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps the empty box closed when saved searches arrive after Escape", async () => {
    let answer: ((response: Response) => void) | undefined;
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/list-views"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : undefined,
    });
    renderAt("/");
    const input = await focusBox();
    await waitFor(() => expect(answer).toBeDefined());
    await userEvent.setup().keyboard("{Escape}");
    await act(async () =>
      answer?.(
        json(200, {
          views: [
            {
              id: "renewals",
              surface: "search",
              name: "Renewals",
              config: QUESTION,
              isDefault: false,
            },
          ],
        }),
      ),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("drops unavailable Fields when restoring a recent question after the dialog catalog has loaded", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          ...QUESTION,
          conditions: [
            ...QUESTION.conditions,
            { kind: "contract", property: "field:archived", operator: "contains", value: "old" },
          ],
        },
      ]),
    );
    const calls = stub();
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advanced search" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Contract" }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.pathname === "/api/v1/search/fields")).toBe(true),
    );
    const recent = within(dialog).getByRole("region", { name: "Recent searches" });
    await user.click(within(recent).getByRole("button"));
    expect(
      await within(dialog).findByText("Unavailable search conditions were removed."),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        calls.filter((call) => call.url.pathname === "/api/v1/search/query").at(-1)?.body,
      ).toMatchObject({ ...QUESTION, limit: 10 }),
    );
  });
});
