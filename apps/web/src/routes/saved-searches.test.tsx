// SPDX-License-Identifier: AGPL-3.0-only
import { simpleSearchQuestion, encodeSearchQuestion, type SearchQuestion } from "@openlaw/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "reader",
  email: "reader@example.com",
  displayName: "Reader",
  role: "legal_team_member",
};
const QUESTION: SearchQuestion = {
  ...simpleSearchQuestion("renewal", ["contract", "document"]),
  words: { all: "renewal", phrase: "notice period", any: "extend renew", none: "draft" },
  scope: { titles: false, text: true, contents: true },
  conditions: [{ kind: "contract", property: "expiry", operator: "in_next_days", value: 90 }],
  match: "any",
  sort: "expiry",
};
type View = {
  id: string;
  surface: string;
  name: string;
  config: SearchQuestion;
  isDefault: boolean;
};
/**
 * The key order Postgres gives a jsonb object: shorter keys first, then
 * bytewise. A config the API answers has been through that column, so
 * the stub answers it the same way and a comparison that depends on the
 * order the question was written in fails here as it would in the app.
 */
function jsonbOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map(jsonbOrder) as T;
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).sort(
    ([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  return Object.fromEntries(entries.map(([key, item]) => [key, jsonbOrder(item)])) as T;
}
function stub(initial: View[] = [], refusal?: string) {
  let views = jsonbOrder(structuredClone(initial));
  const calls: StubCall[] = [];
  stubApi({
    signedIn: MEMBER,
    extra: (call) => {
      calls.push(call);
      if (call.url.pathname === "/api/v1/search/query")
        return json(200, { results: [], total: 12, nextCursor: null });
      if (call.url.pathname === "/api/v1/search/fields")
        return json(200, { fields: [], people: [], entities: [] });
      if (!call.url.pathname.startsWith("/api/v1/list-views")) return undefined;
      if (call.method === "GET") return json(200, { views });
      if (refusal) return problem(409, refusal);
      const body = call.body as Partial<View>;
      if (call.method === "POST")
        views = [
          ...views,
          jsonbOrder({ ...body, id: `view-${views.length}`, isDefault: false } as View),
        ];
      if (call.method === "PATCH")
        views = views.map((view) =>
          call.url.pathname.endsWith(view.id) ? jsonbOrder({ ...view, ...body }) : view,
        );
      if (call.method === "DELETE")
        views = views.filter((view) => !call.url.pathname.endsWith(view.id));
      return json(call.method === "POST" ? 201 : 200, { views });
    },
  });
  return { calls, views: () => views };
}
async function open() {
  await userEvent.setup().click(await screen.findByRole("button", { name: "Advanced search" }));
  return screen.getByRole("dialog", { name: "Advanced search" });
}
const saved = (config = QUESTION): View => ({
  id: "renewals",
  name: "Renewals",
  surface: "search",
  isDefault: false,
  config,
});
async function nameAndSave(user: ReturnType<typeof userEvent.setup>, name: string) {
  const input = await screen.findByRole("textbox", { name: "Name" });
  await user.clear(input);
  await user.type(input, name);
  await user.click(
    within(screen.getByRole("dialog", { name: "Save this search" })).getByRole("button", {
      name: "Save",
    }),
  );
}
describe("saved searches in the dialog", () => {
  it("saves a question, reopens it after reload, restores every part and previews it", async () => {
    const api = stub();
    const { router, view } = renderAt(`/search?aq=${encodeSearchQuestion(QUESTION)}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advanced" }));
    await user.click(screen.getByRole("button", { name: "Save search" }));
    await nameAndSave(user, "Renewals");
    await waitFor(() => expect(api.views()[0]?.config).toEqual(QUESTION));
    view.unmount();
    router.dispose();
    renderAt("/");
    const dialog = await open();
    const beforeSelect = api.calls.length;
    expect(within(dialog).getByLabelText("All of these words")).toHaveValue("");
    await user.click(await within(dialog).findByRole("button", { name: "Renewals" }));
    for (const [label, value] of [
      ["All of these words", "renewal"],
      ["This exact phrase", "notice period"],
      ["Any of these words", "extend renew"],
      ["None of these words", "draft"],
    ])
      expect(within(dialog).getByLabelText(label!)).toHaveValue(value);
    expect(within(dialog).getByRole("checkbox", { name: "Titles and numbers" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Contract" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      const preview = api.calls
        .slice(beforeSelect)
        .find((call) => call.method === "POST" && call.url.pathname.endsWith("/search/query"));
      expect(preview?.body).toMatchObject({ ...QUESTION, limit: 10 });
    });
    expect(within(dialog).queryByText("Modified")).not.toBeInTheDocument();
  });
  it("marks edits, overwrites with Save, forks with Save as, renames and deletes without offering defaults", async () => {
    const api = stub([saved()]);
    renderAt("/");
    const user = userEvent.setup();
    const dialog = await open();
    await user.click(await within(dialog).findByRole("button", { name: "Renewals" }));
    fireEvent.change(within(dialog).getByLabelText("All of these words"), {
      target: { value: "changed" },
    });
    expect(within(dialog).getByText("Modified")).toBeVisible();
    expect(api.views()[0]!.config.words.all).toBe("renewal");
    fireEvent.change(within(dialog).getByLabelText("All of these words"), {
      target: { value: "renewal" },
    });
    expect(within(dialog).queryByText("Modified")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("All of these words"), {
      target: { value: "changed" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save search" }));
    await waitFor(() => expect(api.views()[0]!.config.words.all).toBe("changed"));
    expect(within(dialog).queryByText("Modified")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Renewals actions" }));
    expect(screen.queryByRole("menuitem", { name: "Set as default" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Save as…" }));
    await nameAndSave(user, "Renewals copy");
    await waitFor(() => expect(api.views()).toHaveLength(2));
    await user.click(within(dialog).getByRole("button", { name: "Manage Renewals copy" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Later");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(await within(dialog).findByRole("button", { name: "Manage Later" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.views().map((row) => row.name)).toEqual(["Renewals"]));
    expect(within(dialog).getByLabelText("All of these words")).toHaveValue("changed");
  });
  it.each([
    "You already have a view with that name on this list.",
    "A list holds at most 20 saved views.",
  ])("shows a save refusal where the name was entered: %s", async (detail) => {
    stub([], detail);
    renderAt("/");
    const user = userEvent.setup();
    const dialog = await open();
    expect(within(dialog).getByRole("button", { name: "Save search" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("All of these words"), "renewal");
    await user.click(within(dialog).getByRole("button", { name: "Save search" }));
    await nameAndSave(user, "Renewals");
    expect(await screen.findByRole("alert")).toHaveTextContent(detail);
  });
  it("drops removed properties and archived Fields even after the catalog has already loaded", async () => {
    const old = {
      ...QUESTION,
      conditions: [
        ...QUESTION.conditions,
        { kind: "contract" as const, property: "removed", operator: "contains", value: "x" },
        { kind: "contract" as const, property: "field:archived", operator: "contains", value: "x" },
      ],
    };
    const api = stub([saved(old)]);
    renderAt("/");
    const user = userEvent.setup();
    const dialog = await open();
    await user.click(within(dialog).getByRole("button", { name: "Contract" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.url.pathname.endsWith("/search/fields"))).toBe(true),
    );
    await user.click(await within(dialog).findByRole("button", { name: "Renewals" }));
    expect(
      await within(dialog).findByText("Unavailable search conditions were removed."),
    ).toBeVisible();
    await waitFor(() => {
      const preview = api.calls
        .filter((call) => call.method === "POST" && call.url.pathname.endsWith("/search/query"))
        .at(-1);
      expect(preview?.body).toMatchObject(QUESTION);
    });
    expect(within(dialog).queryByText("Modified")).not.toBeInTheDocument();
    expect(api.views()[0]!.config).toEqual(old);
  });
});
