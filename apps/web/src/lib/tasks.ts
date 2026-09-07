// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The tasks vocabulary the contract record's Tasks section reads
 * (M17/1, CTR-017): the row shape the API answers, and the calls the
 * section makes.
 *
 * **What the section holds is the checklist.** The seam answers the
 * tasks as one ordered list with a done count and a total count.
 *
 * **Every write answers the whole checklist** rather than the row it was
 * addressed at, and the section replaces what it holds — because a
 * toggle or a removal changes the counts.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problem, type Problem } from "./problem";

type ListResponse =
  paths["/api/v1/contracts/{number}/tasks"]["get"]["responses"]["200"]["content"]["application/json"];

/** One task on the contract's checklist. */
export type ContractTask = ListResponse["tasks"][number];

/** What one task carries when it is written. */
export interface TaskInput {
  title: string;
  assigneeId?: string | null;
  addToTeam?: boolean;
  dueDate?: string | null;
}

/** What a read or a write over the checklist answers. */
export type TasksOutcome =
  | { ok: true; tasks: ContractTask[]; doneCount: number; totalCount: number }
  | ({ ok: false } & Problem);

/** Reads one contract's task checklist, whole. */
export async function readContractTasks(contractNumber: number): Promise<TasksOutcome> {
  const result = await api
    .GET("/api/v1/contracts/{number}/tasks", {
      params: { path: { number: contractNumber } },
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        tasks: result.data.tasks,
        doneCount: result.data.doneCount,
        totalCount: result.data.totalCount,
      }
    : { ok: false, ...(await problem(result)) };
}

/** Adds a task to the checklist (CTR-017). */
export async function addContractTask(
  contractNumber: number,
  input: TaskInput,
): Promise<TasksOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/tasks", {
      params: { path: { number: contractNumber } },
      body: input,
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        tasks: result.data.tasks,
        doneCount: result.data.doneCount,
        totalCount: result.data.totalCount,
      }
    : { ok: false, ...(await problem(result)) };
}

/** Edits a task's title, assignee, or due date. */
export async function updateContractTask(
  taskId: string,
  input: Partial<TaskInput>,
): Promise<TasksOutcome> {
  const result = await api
    .PATCH("/api/v1/tasks/{taskId}", {
      params: { path: { taskId } },
      body: input,
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        tasks: result.data.tasks,
        doneCount: result.data.doneCount,
        totalCount: result.data.totalCount,
      }
    : { ok: false, ...(await problem(result)) };
}

/** Toggles a task between done and not done. */
export async function toggleContractTask(taskId: string): Promise<TasksOutcome> {
  const result = await api
    .POST("/api/v1/tasks/{taskId}/toggle", {
      params: { path: { taskId } },
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        tasks: result.data.tasks,
        doneCount: result.data.doneCount,
        totalCount: result.data.totalCount,
      }
    : { ok: false, ...(await problem(result)) };
}

/** Takes a task off the checklist. */
export async function removeContractTask(taskId: string): Promise<TasksOutcome> {
  const result = await api
    .DELETE("/api/v1/tasks/{taskId}", {
      params: { path: { taskId } },
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        tasks: result.data.tasks,
        doneCount: result.data.doneCount,
        totalCount: result.data.totalCount,
      }
    : { ok: false, ...(await problem(result)) };
}
