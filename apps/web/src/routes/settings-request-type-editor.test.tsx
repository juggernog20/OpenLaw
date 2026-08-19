// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Request type editor (#85, INT-002) at the route seam: the
 * shared TypeEditorScreen on the request mount — identity at its own
 * URL with the Intake vocabulary, and the one control that is intake's
 * own, the target. The machinery itself is covered by the Contracts and
 * Matters editor suites; these tests pin the wiring and the target.
 *
 * Three things are asserted rather than assumed: the picker offers live
 * types only, an archived target still reads as itself and is flagged,
 * and there is no Form fields card yet — the form definition is #355's.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = { ...ADMIN, id: "u2", email: "casey@example.com", role: "legal_team_member" };

/** One request type as the routes answer it. */
interface StubType {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
  targetModule: "matter" | "contract" | null;
  targetTypeId: string | null;
}

/** "Contract review": the module-only state ST14 draws. */
function review(overrides: Partial<StubType> = {}): StubType {
  return {
    id: "r2",
    slug: "contract_review",
    displayName: "Contract review",
    description: "Review of a counterparty contract or redline.",
    displayOrder: 2,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 0,
    targetModule: "contract",
    targetTypeId: null,
    ...overrides,
  };
}

const MATTER_TYPES = [
  { id: "mt-lit", slug: "litigation", displayName: "Litigation", archivedAt: null },
  { id: "mt-old", slug: "old", displayName: "Retired matters", archivedAt: "2026-01-01T00:00:00Z" },
];

const CONTRACT_TYPES = [
  { id: "ct-nda", slug: "nda", displayName: "NDA", archivedAt: null },
  { id: "ct-msa", slug: "msa", displayName: "MSA", archivedAt: null },
  { id: "ct-old", slug: "old", displayName: "Retired kind", archivedAt: "2026-01-01T00:00:00Z" },
];

interface EditorCalls {
  patches: unknown[];
}

/** Serves the editor's three reads and captures its writes. `refuse`
 * stands in for the API's own refusal — the validator under the row
 * lock, which the client never second-guesses. */
function editorApi(
  calls: EditorCalls,
  row: StubType = review(),
  refuse?: { status: number; detail: string },
) {
  let current = row;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === `/api/v1/request-types/${row.id}` && call.method === "GET") {
      return json(200, { requestType: current });
    }
    if (path === "/api/v1/matter-types" && call.method === "GET") {
      return json(200, { matterTypes: MATTER_TYPES });
    }
    if (path === "/api/v1/contract-types" && call.method === "GET") {
      return json(200, { contractTypes: CONTRACT_TYPES });
    }
    if (path === `/api/v1/request-types/${row.id}` && call.method === "PATCH") {
      calls.patches.push(call.body);
      if (refuse) {
        return new Response(JSON.stringify({ status: refuse.status, detail: refuse.detail }), {
          status: refuse.status,
          headers: { "content-type": "application/problem+json" },
        });
      }
      current = { ...current, ...(call.body as Partial<StubType>) };
      return json(200, { requestType: current });
    }
    return undefined;
  };
}

const newCalls = (): EditorCalls => ({ patches: [] });

const openEditor = (extra: ReturnType<typeof editorApi>) => {
  stubApi({ signedIn: ADMIN, extra });
  renderAt("/settings/intake/request-types/r2");
};

const targetSelect = () => screen.getByLabelText("Target");

describe("the SET-002 gate on the editor", () => {
  it("bounces a Legal Team Member to their own settings", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/intake/request-types/r2");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("identity (ST14's left card)", () => {
  it("edits display name, description, and the immutable slug as a fact", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Display name")).toHaveValue("Contract review");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Review of a counterparty contract or redline.",
    );
    const slug = screen.getByLabelText("Slug");
    expect(slug).toHaveValue("contract_review");
    expect(slug).toHaveAttribute("readonly");

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Contract triage");
    await user.tab();
    await waitFor(() => expect(calls.patches).toEqual([{ displayName: "Contract triage" }]));
  });

  it("draws no in-use caption: requests land in M20, so every count is zero", async () => {
    openEditor(editorApi(newCalls()));
    await screen.findByLabelText("Display name");
    expect(screen.queryByText(/0 requests/)).not.toBeInTheDocument();
  });

  it("links back to the request types pane", async () => {
    openEditor(editorApi(newCalls()));
    expect(await screen.findByRole("link", { name: "All request types" })).toHaveAttribute(
      "href",
      "/settings/intake/request-types",
    );
  });

  it("draws no Form fields card yet — the form definition arrives with #355", async () => {
    openEditor(editorApi(newCalls()));
    await screen.findByLabelText("Display name");
    expect(screen.queryByText("Form fields")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Attach/ })).not.toBeInTheDocument();
  });
});

describe("the target (INT-002)", () => {
  it("groups the options: no target, the Matter module, the Contract module", async () => {
    openEditor(editorApi(newCalls()));
    const select = await screen.findByLabelText("Target");
    expect(within(select).getByRole("group", { name: "Matter" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Contract" })).toBeInTheDocument();
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No target", "Matter", "Litigation", "Contract", "NDA", "MSA"]);
  });

  it("offers live types only", async () => {
    openEditor(editorApi(newCalls()));
    const select = await screen.findByLabelText("Target");
    expect(within(select).queryByRole("option", { name: "Retired kind" })).not.toBeInTheDocument();
    expect(
      within(select).queryByRole("option", { name: "Retired matters" }),
    ).not.toBeInTheDocument();
  });

  it("shows the module-only state and says what conversion will do", async () => {
    openEditor(editorApi(newCalls()));
    expect(await screen.findByLabelText("Target")).toHaveValue("contract");
    expect(
      screen.getByText(
        "Converting a request of this type creates a contract; the reviewer picks the " +
          "contract type at conversion.",
      ),
    ).toBeInTheDocument();
  });

  it("names a contract type in one pick, and the help line follows", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByLabelText("Target");
    await user.selectOptions(targetSelect(), "contract:ct-nda");
    await waitFor(() =>
      expect(calls.patches).toEqual([{ targetModule: "contract", targetTypeId: "ct-nda" }]),
    );
    expect(
      await screen.findByText(
        "Converting a request of this type creates a contract of the NDA type.",
      ),
    ).toBeInTheDocument();
  });

  it("re-points at a matter type, and at no target at all", async () => {
    const calls = newCalls();
    openEditor(editorApi(calls));
    const user = userEvent.setup();
    await screen.findByLabelText("Target");

    await user.selectOptions(targetSelect(), "matter:mt-lit");
    await waitFor(() =>
      expect(calls.patches).toEqual([{ targetModule: "matter", targetTypeId: "mt-lit" }]),
    );
    expect(
      await screen.findByText(
        "Converting a request of this type creates a matter of the Litigation type.",
      ),
    ).toBeInTheDocument();

    await user.selectOptions(targetSelect(), "");
    await waitFor(() => expect(calls.patches).toHaveLength(2));
    expect(calls.patches[1]).toEqual({ targetModule: null, targetTypeId: null });
    expect(
      await screen.findByText(
        "Converting a request of this type creates no record. It is answered in the " +
          "thread and resolved there.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps an archived target selected, marks it, and flags it", async () => {
    openEditor(editorApi(newCalls(), review({ targetTypeId: "ct-old" })));
    const select = await screen.findByLabelText("Target");
    expect(select).toHaveValue("contract:ct-old");
    expect(within(select).getByRole("option", { name: "Retired kind (archived)" })).toBeVisible();
    expect(
      screen.getByText(
        "Retired kind is archived. Requests of this type convert with no type until you " +
          "pick a live one.",
      ),
    ).toBeInTheDocument();
  });

  it("puts back what the server still holds when the change is refused", async () => {
    const calls = newCalls();
    openEditor(
      editorApi(calls, review(), {
        status: 400,
        detail: "The target must be a live contract type.",
      }),
    );
    const user = userEvent.setup();
    await screen.findByLabelText("Target");
    await user.selectOptions(targetSelect(), "contract:ct-nda");
    // The API's own refusal is more actionable than any generic line.
    expect(await screen.findByText("The target must be a live contract type.")).toBeInTheDocument();
    await waitFor(() => expect(targetSelect()).toHaveValue("contract"));
  });
});
