// SPDX-License-Identifier: AGPL-3.0-only

import {
  decodeSearchQuestion,
  encodeSearchQuestion,
  simpleSearchQuestion,
  type SearchQuestion,
} from "@openlaw/shared";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};
const CONTRACT = {
  kind: "contract",
  id: "contract-58",
  number: 58,
  title: "Orion agreement",
  isConfidential: false,
  rank: 8,
};
const isPreview = (call: StubCall) =>
  call.method === "POST" &&
  call.url.pathname === "/api/v1/search/query" &&
  (call.body as { limit?: number }).limit === 10;
const answer = (results: object[] = [], total = results.length) =>
  json(200, { results, total, nextCursor: null });

async function openDialog() {
  await userEvent.setup().click(await screen.findByRole("button", { name: "Advanced search" }));
  return screen.getByRole("dialog", { name: "Advanced search" });
}

describe("Advanced search", () => {
  it("opens from the sliders with header words, traps focus, and restores it on Esc without navigating", async () => {
    stubApi({ signedIn: MEMBER });
    const { router } = renderAt("/");
    const user = userEvent.setup();
    const header = await screen.findByRole("combobox", { name: "Search" });
    await user.type(header, "renewal");
    const trigger = screen.getByRole("button", { name: "Advanced search" });
    const dialog = await openDialog();
    expect(within(dialog).getByRole("textbox", { name: "All of these words" })).toHaveValue(
      "renewal",
    );
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
    for (const scope of within(dialog).getAllByRole("checkbox")) expect(scope).toBeChecked();
    const close = within(dialog).getByRole("button", { name: "Close Advanced search" });
    close.focus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Search" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("/?");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(router.state.location.pathname).toBe("/");
  });

  it("places Advanced search after See all results and opens it by keyboard", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => (call.url.pathname === "/api/v1/search" ? answer([CONTRACT]) : undefined),
    });
    renderAt("/");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "renewal");
    await screen.findByRole("option", { name: /Orion agreement/ });
    const options = screen.getAllByRole("option");
    expect(options.at(-2)).toHaveTextContent("See all results");
    expect(options.at(-1)).toHaveTextContent("Advanced search…");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByRole("dialog", { name: "Advanced search" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("combobox", { name: "Search" })).toHaveFocus();
  });

  it("offers the dropdown entry even when there are no matches", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "missing");
    await screen.findByText("No matches");
    await user.click(screen.getByRole("option", { name: "Advanced search…" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("debounces edits for 300 ms, rejects stale answers, and renders the total and first ten shared rows", async () => {
    const pending: { question: SearchQuestion; resolve: (value: Response) => void }[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        isPreview(call)
          ? new Promise<Response>((resolve) =>
              pending.push({ question: call.body as SearchQuestion, resolve }),
            )
          : undefined,
    });
    renderAt("/");
    const dialog = await openDialog();
    const words = within(dialog).getByRole("textbox", { name: "All of these words" });
    vi.useFakeTimers();
    try {
      fireEvent.change(words, { target: { value: "old" } });
      await act(() => vi.advanceTimersByTimeAsync(299));
      expect(pending).toHaveLength(0);
      fireEvent.change(words, { target: { value: "older" } });
      await act(() => vi.advanceTimersByTimeAsync(299));
      expect(pending).toHaveLength(0);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(pending).toHaveLength(1);
      expect(within(dialog).getByText("Searching…")).toBeVisible();
      fireEvent.change(words, { target: { value: "new" } });
      await act(() => vi.advanceTimersByTimeAsync(300));
      expect(pending).toHaveLength(2);
      const rows = Array.from({ length: 10 }, (_, i) => ({
        ...CONTRACT,
        id: String(i),
        number: i + 1,
        title: `Current ${i}`,
      }));
      await act(async () => pending[1]!.resolve(answer(rows, 42)));
      expect(within(dialog).getByText("42 matches")).toBeVisible();
      expect(within(dialog).getAllByRole("link")).toHaveLength(10);
      expect(within(dialog).getByText("Showing the first 10 of 42 matches")).toBeVisible();
      await act(async () => pending[0]!.resolve(answer([CONTRACT])));
      expect(within(dialog).queryByText("Orion agreement")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prompts for an empty question or no scope, permits kinds alone, and clears every part", async () => {
    const reads: SearchQuestion[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (!isPreview(call)) return undefined;
        reads.push(call.body as SearchQuestion);
        return answer();
      },
    });
    renderAt("/");
    const dialog = await openDialog();
    const user = userEvent.setup();
    const search = within(dialog).getByRole("button", { name: "Search" });
    expect(search).toBeDisabled();
    expect(within(dialog).getByText("Build your search")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Contract" }));
    await screen.findByText("No matches");
    expect(reads.at(-1)?.kinds).toEqual(["contract"]);
    expect(search).toBeEnabled();
    for (const scope of within(dialog).getAllByRole("checkbox")) await user.click(scope);
    expect(within(dialog).getByText("Choose at least one search scope.")).toBeVisible();
    expect(search).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(search).toBeDisabled();
    for (const scope of within(dialog).getAllByRole("checkbox")) expect(scope).toBeChecked();
    for (const input of within(dialog).getAllByRole("textbox")) expect(input).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Contract" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows a refusal and opens a matching record after a corrected question", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        isPreview(call)
          ? (call.body as SearchQuestion).words.all === "bad"
            ? problem(400, "This question is unavailable.")
            : answer([CONTRACT])
          : undefined,
    });
    const { router } = renderAt("/");
    const dialog = await openDialog();
    const user = userEvent.setup();
    const words = within(dialog).getByRole("textbox", { name: "All of these words" });
    await user.type(words, "bad");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This question is unavailable.",
    );
    await user.clear(words);
    await user.type(words, "good");
    await user.click(await within(dialog).findByRole("link", { name: /Orion agreement/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/contracts/58"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads the results question, mirrors draft words, searches with the URL round trip, and preserves filters on header submission", async () => {
    const original = {
      ...simpleSearchQuestion("renewal", ["contract", "document"]),
      words: { all: "renewal", phrase: "control", any: "extend", none: "draft" },
      scope: { titles: false, text: false, contents: true },
      sort: "newest" as const,
    };
    const reads: SearchQuestion[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/search/query") {
          reads.push(call.body as SearchQuestion);
          return answer();
        }
        return undefined;
      },
    });
    const { router } = renderAt(`/search?aq=${encodeSearchQuestion(original)}`);
    const user = userEvent.setup();
    const advanced = await screen.findByRole("button", { name: "Advanced" });
    await user.click(advanced);
    await user.keyboard("{Escape}");
    expect(advanced).toHaveFocus();
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!),
    ).toEqual(original);
    await user.click(advanced);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "This exact phrase" })).toHaveValue(
      "control",
    );
    expect(within(dialog).getByRole("checkbox", { name: "Titles and numbers" })).not.toBeChecked();
    const words = within(dialog).getByRole("textbox", { name: "All of these words" });
    await user.clear(words);
    await user.type(words, "extension");
    expect(screen.getByRole("combobox", { name: "Search", hidden: true })).toHaveValue("extension");
    await user.click(within(dialog).getByRole("button", { name: "Search" }));
    const expected = { ...original, words: { ...original.words, all: "extension" } };
    await waitFor(() =>
      expect(
        decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!),
      ).toEqual(expected),
    );
    await act(() => router.revalidate());
    await waitFor(() => expect(reads.at(-1)).toMatchObject(expected));
    const header = screen.getByRole("combobox", { name: "Search" });
    await user.clear(header);
    await user.type(header, "updated");
    await user.click(await screen.findByRole("option", { name: "See all results" }));
    await waitFor(() =>
      expect(
        decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!),
      ).toEqual({ ...expected, words: { ...expected.words, all: "updated" } }),
    );
    await act(() => router.navigate(-1));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Search" })).toHaveValue("extension"),
    );
  });
});

it("sends all four word rows, scope and multiple kinds to the preview in M25 order", async () => {
  const reads: SearchQuestion[] = [];
  stubApi({
    signedIn: MEMBER,
    extra: (call) => {
      if (!isPreview(call)) return undefined;
      reads.push(call.body as SearchQuestion);
      return answer();
    },
  });
  renderAt("/");
  const dialog = await openDialog();
  const user = userEvent.setup();
  const fields = [
    ["All of these words", "renewal"],
    ["This exact phrase", "change of control"],
    ["Any of these words", "extend continue"],
    ["None of these words", "draft"],
  ];
  for (const [name, value] of fields)
    await user.type(within(dialog).getByRole("textbox", { name }), value!);
  const kinds = within(dialog).getByRole("group", { name: "Kinds" });
  expect(
    within(kinds)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual([
    "Contract",
    "Matter",
    "Document",
    "Entity",
    "Counterparty",
    "Request",
    "Knowledge Item",
  ]);
  await user.click(within(kinds).getByRole("button", { name: "Contract" }));
  await user.click(within(kinds).getByRole("button", { name: "Document" }));
  await user.click(within(dialog).getByRole("checkbox", { name: "Record text" }));
  await user.click(within(dialog).getByRole("checkbox", { name: "Titles and numbers" }));
  await waitFor(() =>
    expect(reads.at(-1)).toMatchObject({
      words: { all: "renewal", phrase: "change of control", any: "extend continue", none: "draft" },
      scope: { titles: false, text: false, contents: true },
      kinds: ["contract", "document"],
    }),
  );
});

it("Clear removes conditions, match and sort as well as words, scope and kinds", async () => {
  const original = {
    ...simpleSearchQuestion("renewal", ["contract"]),
    match: "any" as const,
    sort: "oldest" as const,
    conditions: [
      { kind: "contract" as const, property: "confidential", operator: "is", value: true },
    ],
  };
  const reads: SearchQuestion[] = [];
  stubApi({
    signedIn: MEMBER,
    extra: (call) => {
      if (!isPreview(call)) return undefined;
      reads.push(call.body as SearchQuestion);
      return answer();
    },
  });
  renderAt(`/search?aq=${encodeSearchQuestion(original)}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Advanced" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Clear" }));
  await user.type(within(dialog).getByRole("textbox", { name: "All of these words" }), "new");
  await waitFor(() => expect(reads.at(-1)).toMatchObject(simpleSearchQuestion("new")));
});

it("refuses an overlong row locally and cancels pending preview work on close", async () => {
  const reads: SearchQuestion[] = [];
  stubApi({
    signedIn: MEMBER,
    extra: (call) => {
      if (!isPreview(call)) return undefined;
      reads.push(call.body as SearchQuestion);
      return answer();
    },
  });
  renderAt("/");
  const dialog = await openDialog();
  const words = within(dialog).getByRole("textbox", { name: "All of these words" });
  vi.useFakeTimers();
  try {
    fireEvent.change(words, { target: { value: "x".repeat(201) } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("200 characters or fewer");
    expect(within(dialog).getByRole("button", { name: "Search" })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(reads).toHaveLength(0);
    fireEvent.change(words, { target: { value: "valid" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Advanced search" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(reads).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it("preserves legacy kind when submitting new header words with Enter", async () => {
  stubApi({ signedIn: MEMBER });
  const { router } = renderAt("/search?q=renewal&kind=contract");
  const user = userEvent.setup();
  const header = await screen.findByRole("combobox", { name: "Search" });
  await user.clear(header);
  await user.type(header, "changed");
  await within(screen.getByRole("listbox", { name: "Search results" })).findByText("No matches");
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!),
    ).toEqual(simpleSearchQuestion("changed", ["contract"])),
  );
});
