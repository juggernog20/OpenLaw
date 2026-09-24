// SPDX-License-Identifier: AGPL-3.0-only

/** M25's two web search surfaces at the routed API seam. */
import {
  decodeSearchQuestion,
  encodeSearchQuestion,
  simpleSearchQuestion,
  type SearchQuestion,
} from "@openlaw/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";
import { searchResultPath } from "../components/search/search-result-row";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

const REQUESTER = {
  id: "u9",
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  role: "business_user",
};

const CONTRACT = {
  kind: "contract",
  id: "contract-58",
  number: 58,
  title: "Orion Cloud master services agreement",
  isConfidential: true,
  rank: 8,
} as const;

const MATTER = {
  kind: "matter",
  id: "matter-51",
  number: 51,
  title: "Orion Cloud renewal negotiation",
  isConfidential: false,
  rank: 7,
} as const;

const DOCUMENT = {
  kind: "document",
  id: "document-7",
  number: null,
  title: "Orion_MSA_2026_counter_redline.pdf",
  isConfidential: false,
  rank: 6,
  ownerKind: "contract",
  ownerNumber: 58,
  ownerTitle: "Orion Cloud master services agreement",
  versionId: "version-4",
  versionNumber: 4,
  snippet: "…either party may <mark>terminate for convenience</mark> on sixty days' notice…",
} as const;

const KNOWLEDGE = {
  kind: "knowledge_item",
  id: "knowledge-7",
  number: null,
  title: "Acquisition template",
  isConfidential: false,
  rank: 5,
  state: "draft",
} as const;

const KNOWLEDGE_DOCUMENT = {
  ...DOCUMENT,
  id: "knowledge-document-7",
  ownerKind: "knowledge_item",
  ownerId: "knowledge-7",
  ownerTitle: "Acquisition template",
  ownerNumber: null,
} as const;

function searchAnswer(results: readonly object[], nextCursor: string | null = null) {
  return json(200, { results, total: results.length, nextCursor });
}

function searchCall(call: StubCall): boolean {
  return call.method === "GET" && call.url.pathname === "/api/v1/search";
}

function questionCall(call: StubCall): boolean {
  return call.method === "POST" && call.url.pathname === "/api/v1/search/query";
}

async function headerSearch() {
  const input = await screen.findByRole("combobox", { name: "Search" });
  await userEvent.setup().click(input);
  return input;
}

describe("the header search box", () => {
  it("waits for 2 characters and debounces a run of typing", async () => {
    const queries: string[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (!searchCall(call)) return undefined;
        queries.push(call.url.searchParams.get("q") ?? "");
        return searchAnswer([]);
      },
    });
    renderAt("/");

    const input = await headerSearch();
    const user = userEvent.setup();
    await user.type(input, "t");
    expect(queries).toEqual([]);

    await user.type(input, "er");
    expect(queries).toEqual([]);
    await waitFor(() => expect(queries).toEqual(["ter"]));
  });

  it("keeps a slower earlier answer from replacing the current answer", async () => {
    const pending = new Map<string, (response: Response) => void>();
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (!searchCall(call)) return undefined;
        const query = call.url.searchParams.get("q") ?? "";
        return new Promise<Response>((resolve) => pending.set(query, resolve));
      },
    });
    renderAt("/");

    const input = await headerSearch();
    const user = userEvent.setup();
    await user.type(input, "te");
    await waitFor(() => expect(pending.has("te")).toBe(true));
    await user.type(input, "rm");
    await waitFor(() => expect(pending.has("term")).toBe(true));

    await act(async () => pending.get("term")?.(searchAnswer([MATTER])));
    expect(await screen.findByRole("option", { name: /M-51.*renewal negotiation/i })).toBeVisible();

    await act(async () => pending.get("te")?.(searchAnswer([CONTRACT])));
    expect(screen.queryByRole("option", { name: /C-58/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /M-51/i })).toBeVisible();
  });

  it("groups rows, announces the listbox, and opens the active row with Arrow and Enter", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => (searchCall(call) ? searchAnswer([CONTRACT, MATTER, DOCUMENT]) : undefined),
    });
    const { router } = renderAt("/");
    const input = await headerSearch();
    const user = userEvent.setup();
    await user.type(input, "term");

    const listbox = await screen.findByRole("listbox", { name: "Search results" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(await within(listbox).findByText("Contract")).toBeVisible();
    expect(within(listbox).getByText("Matter")).toBeVisible();
    expect(within(listbox).getByText("Document")).toBeVisible();
    expect(within(listbox).getByText("CONFI")).toBeVisible();
    const documentOption = within(listbox).getByRole("option", { name: /counter_redline/i });
    expect(documentOption).toHaveTextContent("C-58 · Orion Cloud master services agreement");
    expect(within(documentOption).queryByText("v4")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("terminate for convenience")).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/matters/51"));
  });

  it("opens Knowledge items and their matching Documents on the item record", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        searchCall(call) ? searchAnswer([KNOWLEDGE, KNOWLEDGE_DOCUMENT]) : undefined,
    });
    renderAt("/");
    const input = await headerSearch();
    await userEvent.setup().type(input, "indemnity");
    expect(
      await screen.findByRole("option", { name: /Draft.*Acquisition template/i }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: /counter_redline/i })).toBeVisible();
    expect(searchResultPath(KNOWLEDGE, "indemnity")).toBe("/knowledge/knowledge-7");
    expect(searchResultPath(KNOWLEDGE_DOCUMENT, "indemnity")).toBe(
      "/knowledge/knowledge-7?doc=knowledge-document-7&version=version-4&find=indemnity",
    );
  });

  it("keeps the answer when a keystroke changes only whitespace", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => (searchCall(call) ? searchAnswer([CONTRACT]) : undefined),
    });
    renderAt("/");
    const input = await headerSearch();
    const user = userEvent.setup();
    await user.type(input, "term");
    await screen.findByRole("option", { name: /C-58/i });

    // A trailing space changes the value but not the trimmed query.
    // Nothing refetches, so the answer must stay on screen instead of
    // an unresolvable spinner.
    await user.type(input, " ");
    expect(screen.getByRole("option", { name: /C-58/i })).toBeVisible();
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  });

  it("closes locally on Esc and leaves the query in place", async () => {
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    stubApi({
      signedIn: MEMBER,
      extra: (call) => (searchCall(call) ? searchAnswer([CONTRACT]) : undefined),
    });
    renderAt("/");
    const input = await headerSearch();
    const user = userEvent.setup();
    await user.type(input, "term");
    await screen.findByRole("listbox", { name: "Search results" });

    bubbled.mockClear();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Search results" })).not.toBeInTheDocument();
    expect(input).toHaveValue("term");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbled);
  });

  it("states an empty answer in plain words", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");
    const input = await headerSearch();
    await userEvent.setup().type(input, "assignation");

    expect(await screen.findByText("No matches")).toBeVisible();
    expect(screen.getByText(/No matches for.*assignation/i)).toBeVisible();
  });

  it("shows a server refusal inside the box", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        searchCall(call)
          ? problem(500, "Search is unavailable while the index starts.")
          : undefined,
    });
    renderAt("/");
    const input = await headerSearch();
    await userEvent.setup().type(input, "term");

    expect(await screen.findByRole("alert")).toHaveTextContent("Search could not load");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Search is unavailable while the index starts.",
    );
  });

  it("offers a See all results option that carries the query", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => (searchCall(call) ? searchAnswer([CONTRACT]) : undefined),
    });
    const { router } = renderAt("/");
    const input = await headerSearch();
    await userEvent.setup().type(input, "termination clause");

    const all = await screen.findByRole("option", { name: "See all results" });
    await userEvent.setup().click(all);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/search");
      expect(router.state.location.search).toBe("?q=termination+clause");
    });
  });
});

describe("the results page", () => {
  it("prompts for a query instead of describing empty results", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/search?q=");

    expect(
      await screen.findByRole("heading", {
        name: "Search contracts, matters, documents, entities, counterparties, and requests",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/No matches for/)).not.toBeInTheDocument();
    expect(document.title).toBe(
      "Search contracts, matters, documents, entities, counterparties, and requests · OpenLaw",
    );
  });

  it("returns a Business User to the portal", async () => {
    stubApi({ signedIn: REQUESTER });
    const { router } = renderAt("/search?q=termination");

    await waitFor(() => expect(router.state.location.pathname).toBe("/portal"));
    expect(screen.queryByRole("combobox", { name: "Search" })).not.toBeInTheDocument();
  });

  it("reports a failed initial search read", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        questionCall(call) ? problem(500, "Search index is unavailable.") : undefined,
    });
    renderAt("/search?q=termination");

    expect(await screen.findByRole("alert")).toHaveTextContent("Search index is unavailable.");
  });

  it("renders the shared rows, kind chips, Document landing link, and URL-backed filter", async () => {
    const reads: (SearchQuestion & { limit?: number; cursor?: string })[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (!questionCall(call)) return undefined;
        reads.push(call.body as SearchQuestion);
        return searchAnswer(
          (call.body as SearchQuestion).kinds.includes("matter") ? [MATTER] : [DOCUMENT],
        );
      },
    });
    const { router } = renderAt("/search?q=termination&kind=document");

    expect(
      await screen.findByRole("heading", { name: "Search results for “termination”" }),
    ).toBeVisible();
    const filters = screen.getByRole("navigation", { name: "Filter search results" });
    expect(within(filters).getAllByRole("link")).toHaveLength(8);
    expect(within(filters).getByRole("link", { name: "Document" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const documentRow = await screen.findByRole("link", { name: /counter_redline/i });
    expect(documentRow).toHaveAttribute(
      "href",
      "/contracts/58/documents?doc=document-7&version=version-4&find=termination",
    );
    expect(documentRow).toHaveTextContent("C-58 · Orion Cloud master services agreement");
    expect(within(documentRow).queryByText("v4")).not.toBeInTheDocument();
    expect(screen.getByText("terminate for convenience").tagName).toBe("MARK");
    expect(reads[0]?.limit).toBe(25);
    expect(reads[0]?.kinds[0]).toBe("document");

    await userEvent.setup().click(within(filters).getByRole("link", { name: "Matter" }));
    expect(await screen.findByRole("link", { name: /M-51.*renewal negotiation/i })).toBeVisible();
    expect(
      decodeSearchQuestion(new URLSearchParams(router.state.location.search).get("aq")!)?.kinds,
    ).toEqual(["matter"]);
    expect(reads.at(-1)?.kinds[0]).toBe("matter");
  });

  it("pages by nextCursor without changing the query URL", async () => {
    const reads: (SearchQuestion & { limit?: number; cursor?: string })[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (!questionCall(call)) return undefined;
        reads.push(call.body as SearchQuestion);
        return (call.body as { cursor?: string }).cursor === "page-2"
          ? searchAnswer([MATTER])
          : searchAnswer([CONTRACT], "page-2");
      },
    });
    const { router } = renderAt("/search?q=termination");

    expect(await screen.findByRole("link", { name: /C-58/i })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("link", { name: /M-51/i })).toBeVisible();
    expect(reads.at(-1)?.cursor).toBe("page-2");
    expect(reads.at(-1)?.words.all).toBe("termination");
    expect(router.state.location.search).toBe("?q=termination");
  });
});

it("renders no global search box in the portal", async () => {
  stubApi({ signedIn: MEMBER });
  renderAt("/portal");
  await screen.findByRole("heading", { name: "What do you need from Legal?" });
  expect(screen.queryByRole("combobox", { name: "Search" })).not.toBeInTheDocument();
});

it("restores encoded words and scope, removes chips, and reproduces the question on Back and reload", async () => {
  const original = {
    ...simpleSearchQuestion("termination", ["document"]),
    words: { all: "termination", phrase: "change of control", any: "renew extend", none: "draft" },
    scope: { titles: false, text: false, contents: true },
  };
  const reads: (SearchQuestion & { timeZone: string })[] = [];
  stubApi({
    signedIn: MEMBER,
    extra: (call) => {
      if (!questionCall(call)) return undefined;
      reads.push(call.body as SearchQuestion & { timeZone: string });
      return json(200, { results: [DOCUMENT], total: 42, nextCursor: null });
    },
  });
  const { router } = renderAt(`/search?aq=${encodeSearchQuestion(original)}&q=ignored`);
  expect(await screen.findByText("42 matches")).toBeVisible();
  expect(reads[0]).toMatchObject(original);
  expect(reads[0]?.timeZone).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Search" })).toHaveValue("termination");
  for (const label of [
    "All of these words: termination",
    "This exact phrase: change of control",
    "Any of these words: renew extend",
    "None of these words: draft",
    "Search in: Document contents",
  ]) {
    expect(screen.getByRole("link", { name: `Remove ${label}` })).toBeVisible();
  }
  await userEvent
    .setup()
    .click(screen.getByRole("link", { name: "Remove This exact phrase: change of control" }));
  await waitFor(() => expect(reads.at(-1)?.words.phrase).toBe(""));
  await act(() => router.navigate(-1));
  await waitFor(() => expect(reads.at(-1)?.words.phrase).toBe("change of control"));
  await act(() => router.revalidate());
  await waitFor(() => expect(reads.at(-1)).toMatchObject(original));
  await userEvent
    .setup()
    .click(screen.getByRole("link", { name: "Remove Search in: Document contents" }));
  await waitFor(() =>
    expect(reads.at(-1)?.scope).toEqual({ titles: true, text: true, contents: true }),
  );
});

it("returns to the prompt when the last words chip is removed", async () => {
  stubApi({
    signedIn: MEMBER,
    extra: (call) => (questionCall(call) ? searchAnswer([CONTRACT]) : undefined),
  });
  const { router } = renderAt("/search?q=termination");
  await userEvent
    .setup()
    .click(await screen.findByRole("link", { name: "Remove All of these words: termination" }));
  await waitFor(() => expect(router.state.location.search).toBe(""));
  expect(await screen.findByRole("heading", { name: /Search contracts, matters/ })).toBeVisible();
});

it("shows the refusal for an oversized legacy query without breaking the filters", async () => {
  stubApi({
    signedIn: MEMBER,
    extra: (call) =>
      questionCall(call)
        ? problem(400, "Search words rows must be 200 characters or fewer.")
        : undefined,
  });
  renderAt(`/search?q=${"x".repeat(201)}`);
  expect(await screen.findByRole("alert")).toHaveTextContent("200 characters or fewer");
});
