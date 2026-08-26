// SPDX-License-Identifier: AGPL-3.0-only

/** The M24 template catalog and core editor at their real route seams. */

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

const MEMBER = { ...ADMIN, id: "u2", role: "legal_team_member" };

const MATTER_TYPES = [
  {
    id: "mt-employment",
    slug: "employment",
    displayName: "Employment",
    displayOrder: 1,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 3,
  },
  {
    id: "mt-litigation",
    slug: "litigation",
    displayName: "Litigation",
    displayOrder: 2,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 2,
  },
];

const TEMPLATES = [
  {
    id: "tpl-employment",
    matterTypeId: "mt-employment",
    matterTypeName: "Employment",
    name: "Standard employment dispute",
    description: "Investigation and early case assessment",
    defaultPriority: "medium" as const,
    defaultRisk: "high" as const,
    titlePrefix: "EMP",
    archivedAt: null,
    taskCount: 4,
    keyDateCount: 2,
    customFieldCount: 3,
  },
  {
    id: "tpl-old",
    matterTypeId: "mt-employment",
    matterTypeName: "Employment",
    name: "Old employment playbook",
    description: null,
    defaultPriority: null,
    defaultRisk: null,
    titlePrefix: null,
    archivedAt: "2026-08-20T10:00:00.000Z",
    taskCount: 1,
    keyDateCount: 0,
    customFieldCount: 0,
  },
  {
    id: "tpl-litigation",
    matterTypeId: "mt-litigation",
    matterTypeName: "Litigation",
    name: "New claim",
    description: "Initial court filing",
    defaultPriority: "high" as const,
    defaultRisk: "critical" as const,
    titlePrefix: "LIT",
    archivedAt: null,
    taskCount: 2,
    keyDateCount: 1,
    customFieldCount: 1,
  },
];

interface Calls {
  creates: unknown[];
  updates: { id: string; body: unknown }[];
  archives: string[];
  restores: string[];
}

function templateApi(calls: Calls) {
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/matter-types" && call.method === "GET") {
      return json(200, { matterTypes: MATTER_TYPES });
    }
    if (path === "/api/v1/matter-templates" && call.method === "GET") {
      return json(200, { matterTemplates: TEMPLATES });
    }
    if (path === "/api/v1/matter-templates" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { matterTypeId: string; name: string; description?: string };
      return json(201, {
        matterTemplate: {
          id: "tpl-new",
          matterTypeId: body.matterTypeId,
          matterTypeName: "Employment",
          name: body.name,
          description: body.description ?? null,
          defaultPriority: null,
          defaultRisk: null,
          titlePrefix: null,
          archivedAt: null,
          taskCount: 0,
          keyDateCount: 0,
          customFieldCount: 0,
        },
      });
    }
    const update = /^\/api\/v1\/matter-templates\/([^/]+)$/.exec(path);
    if (update && call.method === "PATCH") {
      calls.updates.push({ id: update[1]!, body: call.body });
      const original = TEMPLATES.find((template) => template.id === update[1])!;
      return json(200, { matterTemplate: { ...original, ...(call.body as object) } });
    }
    const archive = /^\/api\/v1\/matter-templates\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push(archive[1]!);
      const original = TEMPLATES.find((template) => template.id === archive[1])!;
      const latestName = calls.updates
        .filter((entry) => entry.id === archive[1])
        .map((entry) => (entry.body as { name?: string }).name)
        .findLast((name) => name !== undefined);
      return json(200, {
        matterTemplate: {
          ...original,
          name: latestName ?? original.name,
          archivedAt: "2026-08-26T08:00:00.000Z",
        },
      });
    }
    const restore = /^\/api\/v1\/matter-templates\/([^/]+)\/restore$/.exec(path);
    if (restore && call.method === "POST") {
      calls.restores.push(restore[1]!);
      const original = TEMPLATES.find((template) => template.id === restore[1])!;
      const latestName = calls.updates
        .filter((entry) => entry.id === restore[1])
        .map((entry) => (entry.body as { name?: string }).name)
        .findLast((name) => name !== undefined);
      return json(200, {
        matterTemplate: { ...original, name: latestName ?? original.name, archivedAt: null },
      });
    }
    return undefined;
  };
}

function newCalls(): Calls {
  return { creates: [], updates: [], archives: [], restores: [] };
}

describe("the SET-002 gate", () => {
  it("redirects a non-Administrator away from the Templates pane", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/matters/templates");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("the per-type template catalog", () => {
  it("shows live definitions for the selected type and preserves archived ones", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: templateApi(calls) });
    renderAt("/settings/matters/templates");
    const user = userEvent.setup();

    expect(await screen.findByText("Standard employment dispute")).toBeInTheDocument();
    expect(screen.getByText("Investigation and early case assessment")).toBeInTheDocument();
    expect(screen.getByText("4 tasks")).toBeInTheDocument();
    expect(screen.queryByText("Old employment playbook")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    expect(screen.getByText("Old employment playbook")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Matter type" }),
      "mt-litigation",
    );
    expect(screen.getByText("New claim")).toBeInTheDocument();
    expect(screen.queryByText("Standard employment dispute")).not.toBeInTheDocument();
  });

  it("creates, renames, archives, and restores without losing the definition", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: templateApi(calls) });
    renderAt("/settings/matters/templates");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add template" }));
    const create = screen.getByRole("dialog", { name: "Add Matter template" });
    await user.type(within(create).getByRole("textbox", { name: "Name" }), "Workplace inquiry");
    await user.type(
      within(create).getByRole("textbox", { name: "Description" }),
      "A reusable inquiry workflow",
    );
    await user.click(within(create).getByRole("button", { name: "Add template" }));
    await waitFor(() =>
      expect(calls.creates).toEqual([
        {
          matterTypeId: "mt-employment",
          name: "Workplace inquiry",
          description: "A reusable inquiry workflow",
        },
      ]),
    );
    expect(await screen.findByText("Workplace inquiry")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename Standard employment dispute" }));
    const rename = screen.getByRole("textbox", { name: "Rename Standard employment dispute" });
    await user.clear(rename);
    await user.type(rename, "Employment investigation{Enter}");
    await waitFor(() =>
      expect(calls.updates).toContainEqual({
        id: "tpl-employment",
        body: { name: "Employment investigation" },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Archive Employment investigation" }));
    const archive = await screen.findByRole("dialog", {
      name: "Archive Employment investigation?",
    });
    await user.click(within(archive).getByRole("button", { name: "Archive template" }));
    await waitFor(() => expect(calls.archives).toEqual(["tpl-employment"]));
    expect(screen.queryByText("Employment investigation")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    await user.click(screen.getByRole("button", { name: "Restore Employment investigation" }));
    await waitFor(() => expect(calls.restores).toEqual(["tpl-employment"]));
    expect(screen.getByText("Employment investigation")).toBeInTheDocument();
  });
});

describe("the core template editor", () => {
  it("saves defaults through PATCH and returns to the catalog", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: templateApi(calls) });
    const { router } = renderAt("/settings/matters/templates/tpl-employment");
    const user = userEvent.setup();

    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue(
      "Standard employment dispute",
    );
    expect(screen.getByText("Matter type: Employment")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "high");
    await user.selectOptions(screen.getByRole("combobox", { name: "Risk" }), "critical");
    await user.clear(screen.getByRole("textbox", { name: "Title prefix" }));
    await user.type(screen.getByRole("textbox", { name: "Title prefix" }), "CASE");
    await user.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() =>
      expect(calls.updates).toContainEqual({
        id: "tpl-employment",
        body: {
          name: "Standard employment dispute",
          description: "Investigation and early case assessment",
          defaultPriority: "high",
          defaultRisk: "critical",
          titlePrefix: "CASE",
        },
      }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "All templates" }));
    expect(router.state.location.pathname).toBe("/settings/matters/templates");
  });
});
