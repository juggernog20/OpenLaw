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
    tasks: [
      {
        id: "task-conflict-check",
        title: "Run conflict check",
        dueOffsetDays: 1,
        assigneeRole: "matter_manager" as const,
        displayOrder: 1,
      },
      {
        id: "task-preservation",
        title: "Issue preservation notice",
        dueOffsetDays: 2,
        assigneeRole: "none" as const,
        displayOrder: 2,
      },
      {
        id: "task-documents",
        title: "Collect initial documents",
        dueOffsetDays: null,
        assigneeRole: "matter_manager" as const,
        displayOrder: 3,
      },
      {
        id: "task-interview",
        title: "Schedule client interview",
        dueOffsetDays: 5,
        assigneeRole: "none" as const,
        displayOrder: 4,
      },
    ],
    keyDates: [
      {
        id: "date-response",
        label: "Response deadline",
        offsetDays: 14,
        note: "Confirm any governing rule",
        displayOrder: 1,
      },
      {
        id: "date-review",
        label: "Initial case review",
        offsetDays: 30,
        note: null,
        displayOrder: 2,
      },
    ],
    taskCount: 4,
    keyDateCount: 2,
    customFieldCount: 3,
    defaultCustomFields: {
      business_unit: "Finance",
      budget: 5000,
      old_region: "MEA",
    },
    staleCustomFieldSlugs: ["old_region"],
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
    tasks: [],
    keyDates: [],
    taskCount: 1,
    keyDateCount: 0,
    customFieldCount: 0,
    defaultCustomFields: {},
    staleCustomFieldSlugs: [],
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
    tasks: [],
    keyDates: [],
    taskCount: 2,
    keyDateCount: 1,
    customFieldCount: 1,
    defaultCustomFields: {},
    staleCustomFieldSlugs: [],
  },
];

const ATTACHED_FIELDS = [
  {
    fieldId: "field-business-unit",
    slug: "business_unit",
    displayName: "Business unit",
    fieldType: "single_select" as const,
    moduleScope: "matter" as const,
    displayOrder: 1,
    isRequired: false,
  },
  {
    fieldId: "field-budget",
    slug: "budget",
    displayName: "Budget",
    fieldType: "number" as const,
    moduleScope: "matter" as const,
    displayOrder: 2,
    isRequired: false,
  },
];

const FIELD_CATALOG = [
  {
    id: "field-business-unit",
    slug: "business_unit",
    displayName: "Business unit",
    description: "The team funding the work.",
    moduleScope: "matter" as const,
    fieldType: "single_select" as const,
    options: ["Finance", "People"],
    fieldTag: "business" as const,
    aiPrompt: null,
    archivedAt: null,
    attachmentCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "field-budget",
    slug: "budget",
    displayName: "Budget",
    description: null,
    moduleScope: "matter" as const,
    fieldType: "number" as const,
    options: null,
    fieldTag: "legal" as const,
    aiPrompt: null,
    archivedAt: null,
    attachmentCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "field-old-region",
    slug: "old_region",
    displayName: "Old region",
    description: null,
    moduleScope: "matter" as const,
    fieldType: "text" as const,
    options: null,
    fieldTag: "business" as const,
    aiPrompt: null,
    archivedAt: null,
    attachmentCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

interface Calls {
  creates: unknown[];
  updates: { id: string; body: unknown }[];
  taskReplacements: { id: string; body: unknown }[];
  keyDateReplacements: { id: string; body: unknown }[];
  customFieldReplacements: { id: string; body: unknown }[];
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
    if (path === "/api/v1/matter-types/mt-employment/fields" && call.method === "GET") {
      return json(200, { attachedFields: ATTACHED_FIELDS });
    }
    if (path === "/api/v1/fields" && call.method === "GET") {
      return json(200, { fields: FIELD_CATALOG });
    }
    if (path === "/api/v1/users" && call.method === "GET") {
      return json(200, { users: [ADMIN] });
    }
    if (path === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
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
          tasks: [],
          keyDates: [],
          taskCount: 0,
          keyDateCount: 0,
          customFieldCount: 0,
          defaultCustomFields: {},
          staleCustomFieldSlugs: [],
        },
      });
    }
    const update = /^\/api\/v1\/matter-templates\/([^/]+)$/.exec(path);
    if (update && call.method === "PATCH") {
      calls.updates.push({ id: update[1]!, body: call.body });
      const original = TEMPLATES.find((template) => template.id === update[1])!;
      return json(200, { matterTemplate: { ...original, ...(call.body as object) } });
    }
    const tasks = /^\/api\/v1\/matter-templates\/([^/]+)\/tasks$/.exec(path);
    if (tasks && call.method === "PUT") {
      calls.taskReplacements.push({ id: tasks[1]!, body: call.body });
      const original = TEMPLATES.find((template) => template.id === tasks[1])!;
      const body = call.body as {
        tasks: Array<{
          title: string;
          dueOffsetDays: number | null;
          assigneeRole: "matter_manager" | "none";
        }>;
      };
      return json(200, {
        matterTemplate: {
          ...original,
          tasks: body.tasks.map((task, index) => ({
            id: `saved-task-${index + 1}`,
            ...task,
            displayOrder: index + 1,
          })),
          taskCount: body.tasks.length,
        },
      });
    }
    const customFields = /^\/api\/v1\/matter-templates\/([^/]+)\/custom-fields$/.exec(path);
    if (customFields && call.method === "PUT") {
      calls.customFieldReplacements.push({ id: customFields[1]!, body: call.body });
      const original = TEMPLATES.find((template) => template.id === customFields[1])!;
      const body = call.body as { defaultCustomFields: Record<string, unknown> };
      return json(200, {
        matterTemplate: {
          ...original,
          defaultCustomFields: {
            old_region: original.defaultCustomFields.old_region,
            ...body.defaultCustomFields,
          },
          customFieldCount:
            Object.keys(body.defaultCustomFields).length +
            (original.defaultCustomFields.old_region === undefined ? 0 : 1),
        },
      });
    }
    const keyDates = /^\/api\/v1\/matter-templates\/([^/]+)\/key-dates$/.exec(path);
    if (keyDates && call.method === "PUT") {
      calls.keyDateReplacements.push({ id: keyDates[1]!, body: call.body });
      const original = TEMPLATES.find((template) => template.id === keyDates[1])!;
      const latestTasks = calls.taskReplacements.filter((entry) => entry.id === keyDates[1]).at(-1)
        ?.body as
        | {
            tasks: Array<{
              title: string;
              dueOffsetDays: number | null;
              assigneeRole: "matter_manager" | "none";
            }>;
          }
        | undefined;
      const body = call.body as {
        keyDates: Array<{ label: string; offsetDays: number; note: string | null }>;
      };
      return json(200, {
        matterTemplate: {
          ...original,
          tasks:
            latestTasks?.tasks.map((task, index) => ({
              id: `saved-task-${index + 1}`,
              ...task,
              displayOrder: index + 1,
            })) ?? original.tasks,
          taskCount: latestTasks?.tasks.length ?? original.taskCount,
          keyDates: body.keyDates.map((keyDate, index) => ({
            id: `saved-date-${index + 1}`,
            ...keyDate,
            displayOrder: index + 1,
          })),
          keyDateCount: body.keyDates.length,
        },
      });
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
  return {
    creates: [],
    updates: [],
    taskReplacements: [],
    keyDateReplacements: [],
    customFieldReplacements: [],
    archives: [],
    restores: [],
  };
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
    expect(calls.customFieldReplacements).toHaveLength(1);
    expect(calls.taskReplacements).toHaveLength(1);
    expect(calls.keyDateReplacements).toHaveLength(1);
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "All templates" }));
    expect(router.state.location.pathname).toBe("/settings/matters/templates");
  });

  it("renders shared controls and keeps a detached default visibly stale", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: templateApi(calls) });
    renderAt("/settings/matters/templates/tpl-employment");
    const user = userEvent.setup();

    expect(await screen.findByRole("combobox", { name: "Business unit" })).toHaveValue("Finance");
    expect(screen.getByRole("spinbutton", { name: "Budget" })).toHaveValue(5000);
    expect(
      screen.getByText(
        "Old region is no longer attached to this Matter type. Its saved value (MEA) is retained.",
      ),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Business unit" }), "People");
    const budget = screen.getByRole("spinbutton", { name: "Budget" });
    await user.clear(budget);
    await user.type(budget, "7500");
    await user.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() =>
      expect(calls.customFieldReplacements).toEqual([
        {
          id: "tpl-employment",
          body: { defaultCustomFields: { business_unit: "People", budget: 7500 } },
        },
      ]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("edits, adds, removes, and reorders template tasks and key dates", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: templateApi(calls) });
    renderAt("/settings/matters/templates/tpl-employment");
    const user = userEvent.setup();

    const conflictTitle = await screen.findByRole("textbox", { name: "Task 1 title" });
    await user.clear(conflictTitle);
    await user.type(conflictTitle, "Complete conflict review");
    await user.click(screen.getByRole("button", { name: "Remove Collect initial documents" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));
    const newTaskTitle = screen.getByRole("textbox", { name: "Task 4 title" });
    await user.type(newTaskTitle, "Prepare engagement letter");
    await user.type(screen.getByRole("spinbutton", { name: "Task 4 due offset in days" }), "3");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Task 4 role" }),
      "matter_manager",
    );
    const newTaskGrip = screen.getByRole("button", {
      name: /Reorder Prepare engagement letter, position 4 of 4/,
    });
    newTaskGrip.focus();
    await user.keyboard("{ArrowUp}");

    await user.click(screen.getByRole("button", { name: "Remove Initial case review" }));
    await user.click(screen.getByRole("button", { name: "Add key date" }));
    await user.type(screen.getByRole("textbox", { name: "Key date 2 label" }), "Status review");
    await user.type(screen.getByRole("spinbutton", { name: "Key date 2 offset in days" }), "21");
    await user.type(screen.getByRole("textbox", { name: "Key date 2 note" }), "Review progress");
    const newDateGrip = screen.getByRole("button", {
      name: /Reorder Status review, position 2 of 2/,
    });
    newDateGrip.focus();
    await user.keyboard("{ArrowUp}");

    await user.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(calls.taskReplacements).toHaveLength(1));
    expect(calls.taskReplacements[0]).toEqual({
      id: "tpl-employment",
      body: {
        tasks: [
          {
            title: "Complete conflict review",
            dueOffsetDays: 1,
            assigneeRole: "matter_manager",
          },
          {
            title: "Issue preservation notice",
            dueOffsetDays: 2,
            assigneeRole: "none",
          },
          {
            title: "Prepare engagement letter",
            dueOffsetDays: 3,
            assigneeRole: "matter_manager",
          },
          {
            title: "Schedule client interview",
            dueOffsetDays: 5,
            assigneeRole: "none",
          },
        ],
      },
    });
    expect(calls.keyDateReplacements[0]).toEqual({
      id: "tpl-employment",
      body: {
        keyDates: [
          { label: "Status review", offsetDays: 21, note: "Review progress" },
          {
            label: "Response deadline",
            offsetDays: 14,
            note: "Confirm any governing rule",
          },
        ],
      },
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("blocks invalid content before any write", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: templateApi(calls) });
    renderAt("/settings/matters/templates/tpl-employment");
    const user = userEvent.setup();

    await user.clear(await screen.findByRole("textbox", { name: "Task 1 title" }));
    await user.click(screen.getByRole("button", { name: "Save template" }));

    expect(
      await screen.findByText(
        "Give every row a name and use whole-number offsets from 0 to 3650 days.",
      ),
    ).toBeInTheDocument();
    expect(calls.updates).toEqual([]);
    expect(calls.customFieldReplacements).toEqual([]);
    expect(calls.taskReplacements).toEqual([]);
    expect(calls.keyDateReplacements).toEqual([]);
  });
});
