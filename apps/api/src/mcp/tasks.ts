// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Task Tools T17, T18 and T36 reuse the UI assignment services and Home's
 * active-record read. DD-029 and TECH-035 keep reach bound to the caller,
 * including when the Task filter names another assignee.
 */
import { z } from "zod";
import {
  readAssignedTasks,
  AssignedTasksCursorSchema,
  AssignedTasksPageSchema,
} from "../modules/home/sections/tasks.js";
import {
  createContractTask,
  CreateContractTaskBody,
  updateContractTask,
  MutateContractTaskBody,
} from "../modules/contract-tasks/service.js";
import { addMatterTask, updateMatterTask } from "../modules/matter-tasks/service.js";
import { readTool, writeTool } from "./workspace.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import type { ToolDefinition } from "./tool.js";

const kindSchema = z.enum(["contract", "matter"]);
const listInput = z.strictObject({
  ...pageInput,
  cursor: AssignedTasksCursorSchema.optional(),
  assigneeId: z.string().min(1).max(128).optional(),
  dueWithinDays: z.number().int().min(0).max(36500).optional(),
  overdue: z.boolean().optional(),
  includeCompleted: z.boolean().optional(),
});
const createInput = CreateContractTaskBody.extend({
  kind: kindSchema,
  number: z.number().int().min(1),
});
const updateInput = z.strictObject({
  kind: kindSchema,
  taskId: z.string().min(1).max(64),
  changes: MutateContractTaskBody,
});
const output = z.object({ taskId: z.string() });
export const taskTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "tasks",
    businessUser: "off",
    name: "openlaw_tasks_list",
    title: "List assigned Tasks",
    description:
      "Read Tasks assigned to you, or assigneeId for a named person, across Contracts and Matters you can reach. Uses Home's active-record rules: excludes archived records, ended Contracts and closed Matters. dueWithinDays includes overdue Tasks through today plus N days. overdue keeps only unfinished Tasks before today. includeCompleted defaults false. Dated Tasks sort first, undated last. Continue with nextCursor and the same filters.",
    inputSchema: listInput,
    outputSchema: AssignedTasksPageSchema,
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const options = listInput.parse(input);
        const result = await readAssignedTasks(db, user, options);
        const page = boundedPage(
          result.rows,
          options.limit,
          (r) => `${r.dueDate ?? "undated"}:${r.record.kind}:${r.id}`,
          result.nextCursor,
        );
        return bounded({ ...result, rows: page.items, nextCursor: page.nextCursor });
      }),
  },
  {
    ...writeTool,
    toolset: "tasks",
    name: "openlaw_task_create",
    title: "Create a Task",
    description:
      "Create a Task on kind contract or matter, identified by its number. Supply title, optional description, assigneeId and dueDate in YYYY-MM-DD. Assignees must be active staff who manage the record or are on its team. Ask the person before using addToTeam true to add an eligible assignee. Confidential team changes require audience permission. Creates a new Task each time.",
    inputSchema: createInput,
    outputSchema: output,
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { kind, number, ...body } = createInput.parse(input);
        const result = await (kind === "contract" ? createContractTask : addMatterTask)(
          db,
          user,
          number,
          body,
          notifier,
        );
        return { taskId: result.createdTaskId };
      }),
  },
  {
    ...writeTool,
    toolset: "tasks",
    annotations: { ...writeTool.annotations, idempotentHint: true },
    name: "openlaw_task_update",
    title: "Update a Task",
    description:
      "Update a Task by taskId and kind contract or matter. Set changes.isDone true to complete, false to reopen; assigneeId reassigns and dueDate reschedules. Null clears assignee or due date. title and description are editable. Uses the same active-staff and team rules as creation. Ask before addToTeam true. Completion, assignment, rescheduling, activity and notifications commit together. Repeating the same values does not toggle completion.",
    inputSchema: updateInput,
    outputSchema: output,
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { kind, taskId, changes } = updateInput.parse(input);
        await (kind === "contract" ? updateContractTask : updateMatterTask)(
          db,
          user,
          taskId,
          changes,
          notifier,
        );
        return { taskId };
      }),
  },
];
