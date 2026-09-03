// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u1",
  email: "member@example.com",
  displayName: "Morgan Member",
  role: "legal_team_member",
};

const person = {
  id: "u1",
  displayName: "Morgan Member",
  image: null,
  archived: false,
};

function version(
  id: string,
  versionNumber: number,
  kind: "draft_ours" | "draft_theirs" | "generated_redline" = "draft_ours",
) {
  return {
    id,
    versionNumber,
    kind,
    note: null,
    originalFilename: `services-v${versionNumber}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    renderFamily: "word",
    byteSize: 1200,
    checksumSha256: "a".repeat(64),
    uploadedBy: person,
    createdAt: `2026-08-0${versionNumber}T10:00:00.000Z`,
    isCurrent: versionNumber === 5,
    isExecuted: false,
  } as const;
}

const versions = [
  version("v1", 1),
  version("v2", 2),
  version("v3", 3, "generated_redline"),
  version("v4", 4, "draft_theirs"),
  version("v5", 5),
];

const model = {
  paragraphs: [
    {
      index: 0,
      style: "heading" as const,
      label: "1.",
      runs: [
        { text: "Services", change: "unchanged" as const },
        { text: " and support", change: "inserted" as const },
      ],
    },
    {
      index: 1,
      style: "body" as const,
      label: null,
      runs: [
        { text: "Thirty days", change: "deleted" as const },
        { text: "Sixty days", change: "inserted" as const },
      ],
    },
  ],
  changes: [
    { id: "c1", paragraphIndex: 0, kind: "inserted" as const, ref: "§1", excerpt: "and support" },
    {
      id: "c2",
      paragraphIndex: 1,
      kind: "replaced" as const,
      ref: "§2.1",
      excerpt: "Thirty days → Sixty days",
    },
  ],
};

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmp-1",
    documentId: "doc-1",
    mode: "word",
    state: "ready",
    fromVersion: versions[1],
    toVersion: versions[3],
    changeModel: model,
    changeCount: 2,
    failure: null,
    exportedVersionId: null,
    document: {
      id: "doc-1",
      title: "Services Agreement",
      owner: {
        kind: "contract",
        id: "contract-1",
        number: 42,
        title: "Acme Services",
      },
      versions,
    },
    createdAt: "2026-08-04T10:00:00.000Z",
    finishedAt: "2026-08-04T10:00:01.000Z",
    ...overrides,
  };
}

function comparisonApi(initial = comparison()) {
  const calls: StubCall[] = [];
  return {
    calls,
    handler(call: StubCall) {
      if (/^\/api\/v1\/documents\/doc-1\/comparisons$/.test(call.url.pathname)) {
        calls.push(call);
        if (call.method === "POST") return json(200, { comparison: initial });
      }
      if (/^\/api\/v1\/documents\/doc-1\/comparisons\/cmp-1$/.test(call.url.pathname)) {
        calls.push(call);
        return json(200, { comparison: initial });
      }
      return undefined;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Document comparison screen", () => {
  it("draws and moves through a ready comparison with accessible change names", async () => {
    const api = comparisonApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents/doc-1/compare?from=v2&to=v4");

    expect(await screen.findByText("Acme Services")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "v2 → v4" })).toBeInTheDocument();
    expect(screen.getByText("services-v2.docx")).toBeInTheDocument();
    expect(screen.getByText("services-v4.docx")).toBeInTheDocument();
    expect(screen.getByLabelText("2 changes")).toHaveTextContent("2");

    const inserted = screen.getByText("and support", { selector: "article span" });
    expect(inserted).toHaveClass("text-status-success-fg", "underline");
    expect(within(inserted).getByText("Inserted:")).toHaveClass("sr-only");
    const deleted = screen.getByText("Thirty days", { selector: "article span" });
    expect(deleted).toHaveClass("text-status-danger-fg", "line-through");
    expect(within(deleted).getByText("Deleted:")).toHaveClass("sr-only");

    const first = screen.getByRole("button", { name: "§1, Inserted" });
    const second = screen.getByRole("button", { name: "§2.1, Replaced" });
    expect(first).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(second).toHaveAttribute("aria-current", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-current", "true");
    expect(document.querySelector('[data-paragraph-index="0"]')).toHaveClass("border-accent");
  });

  it("offers only hand-set valid operands and navigates when either changes", async () => {
    const calls: StubCall[] = [];
    stubApi({
      signedIn: MEMBER,
      extra(call) {
        if (call.url.pathname === "/api/v1/documents/doc-1/comparisons" && call.method === "POST") {
          calls.push(call);
          const body = call.body as { fromVersionId: string; toVersionId: string };
          return json(200, {
            comparison: comparison({
              id: `cmp-${body.fromVersionId}-${body.toVersionId}`,
              fromVersion: versions.find((row) => row.id === body.fromVersionId),
              toVersion: versions.find((row) => row.id === body.toVersionId),
            }),
          });
        }
        return undefined;
      },
    });
    const { router } = renderAt("/documents/doc-1/compare?from=v2&to=v4");
    await userEvent.click(await screen.findByRole("button", { name: "v2 → v4" }));

    const older = screen.getByRole("combobox", { name: "Older" });
    expect(within(older).queryByRole("option", { name: "v3" })).not.toBeInTheDocument();
    fireEvent.change(older, { target: { value: "v1" } });
    await waitFor(() => expect(router.state.location.search).toBe("?from=v1&to=v4"));
    expect(calls.at(-1)?.body).toEqual({ fromVersionId: "v1", toVersionId: "v4" });
  });

  it.each([
    [
      "pending",
      comparison({
        state: "pending",
        changeModel: null,
        changeCount: null,
        finishedAt: null,
      }),
      "Preparing comparison",
    ],
    [
      "failed",
      comparison({
        state: "failed",
        changeModel: null,
        changeCount: null,
        failure: "The newer file is unreadable.",
      }),
      "The newer file is unreadable.",
    ],
    [
      "no changes",
      comparison({ changeModel: { paragraphs: [], changes: [] }, changeCount: 0 }),
      "No changes",
    ],
  ])("draws the %s state", async (_name, value, expected) => {
    const api = comparisonApi(value);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents/doc-1/compare?from=v2&to=v4");
    expect(await screen.findByText(expected)).toBeInTheDocument();
    if (_name === "failed") {
      expect(screen.getByRole("link", { name: "Download services-v2.docx" })).toHaveAttribute(
        "href",
        "/api/v1/documents/doc-1/versions/v2/download",
      );
      expect(screen.getByRole("link", { name: "Download services-v4.docx" })).toBeInTheDocument();
    }
  });

  it("polls a preparing comparison on the document-rendition interval", async () => {
    const pending = comparison({
      state: "pending",
      changeModel: null,
      changeCount: null,
      finishedAt: null,
    });
    let reads = 0;
    stubApi({
      signedIn: MEMBER,
      extra(call) {
        if (call.url.pathname === "/api/v1/documents/doc-1/comparisons" && call.method === "POST") {
          return json(202, { comparison: pending });
        }
        if (call.url.pathname === "/api/v1/documents/doc-1/comparisons/cmp-1") {
          reads += 1;
          return json(200, { comparison: comparison() });
        }
        return undefined;
      },
    });
    renderAt("/documents/doc-1/compare?from=v2&to=v4");
    expect(await screen.findByText("Preparing comparison")).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByRole("button", { name: "§1, Inserted" })).toBeInTheDocument(),
      { timeout: 3_000 },
    );
    expect(reads).toBe(1);
  });

  it("labels a text-mode comparison", async () => {
    const api = comparisonApi(comparison({ mode: "text" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents/doc-1/compare?from=v2&to=v4");
    expect(
      await screen.findByText(/built from extracted text, so formatting is not shown/i),
    ).toBeInTheDocument();
  });

  it.each([
    ["contract", 42, "/contracts/42/documents"],
    ["matter", 17, "/matters/17/documents"],
    ["entity", null, "/entities/contract-1/documents"],
    ["knowledge_item", null, "/knowledge/contract-1"],
  ] as const)("closes a %s comparison to its owning record", async (kind, number, href) => {
    const value = comparison({
      document: {
        ...comparison().document,
        owner: { ...comparison().document.owner, kind, number },
      },
    });
    const api = comparisonApi(value);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents/doc-1/compare?from=v2&to=v4");
    expect(await screen.findByRole("link", { name: "Close comparison" })).toHaveAttribute(
      "href",
      href,
    );
  });

  it("bounces a business reader and surfaces a Document audience refusal", async () => {
    stubApi({ signedIn: { ...MEMBER, role: "business_user" } });
    const business = renderAt("/documents/doc-1/compare?from=v2&to=v4");
    await waitFor(() => expect(business.router.state.location.pathname).toBe("/portal"));
    business.view.unmount();

    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/documents/doc-1/comparisons" && call.method === "POST"
          ? problem(404, "No document exists with this reference.")
          : undefined,
    });
    renderAt("/documents/doc-1/compare?from=v2&to=v4");
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
  });
});
