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
import { problemDetail } from "./messages";

type ListResponse =
  paths["/api/v1/contracts/{number}/tasks"]["get"]["responses"]["200"]["content"]["application/json"];

/** One task on the contract's checklist. */
export type ContractTask = ListResponse["tasks"][number];

/** What one task carries when it is written. */
export interface TaskInput {
  title: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}

/** What a read or a write over the checklist answers. */
export type TasksOutcome =
  | { ok: true; tasks: ContractTask[]; doneCount: number; totalCount: number }
  | { ok: false; detail?: string };

/** Reads one contract's task checklist, whole. */
export async function readContractTasks(contractNumber: number): Promise<TasksOutcome> {
  const { data, error } = await api
    .GET("/api/v1/contracts/{number}/tasks", {
      params: { path: { number: contractNumber } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, tasks: data.tasks, doneCount: data.doneCount, totalCount: data.totalCount }
    : { ok: false, detail: problemDetail(error) };
}

/** Adds a task to the checklist (CTR-017). */
export async function addContractTask(
  contractNumber: number,
  input: TaskInput,
): Promise<TasksOutcome> {
  const { data, error } = await api
    .POST("/api/v1/contracts/{number}/tasks", {
      params: { path: { number: contractNumber } },
      body: { title: input.title, assigneeId: input.assigneeId, dueDate: input.dueDate },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, tasks: data.tasks, doneCount: data.doneCount, totalCount: data.totalCount }
    : { ok: false, detail: problemDetail(error) };
}

/** Edits a task's title, assignee, or due date. */
export async function updateContractTask(taskId: string, input: TaskInput): Promise<TasksOutcome> {
  const { data, error } = await api
    .PATCH("/api/v1/tasks/{taskId}", {
      params: { path: { taskId } },
      body: { title: input.title, assigneeId: input.assigneeId, dueDate: input.dueDate },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, tasks: data.tasks, doneCount: data.doneCount, totalCount: data.totalCount }
    : { ok: false, detail: problemDetail(error) };
}

/** Toggles a task between done and not done. */
export async function toggleContractTask(taskId: string): Promise<TasksOutcome> {
  const { data, error } = await api
    .POST("/api/v1/tasks/{taskId}/toggle", {
      params: { path: { taskId } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, tasks: data.tasks, doneCount: data.doneCount, totalCount: data.totalCount }
    : { ok: false, detail: problemDetail(error) };
}

/** Takes a task off the checklist. */
export async function removeContractTask(taskId: string): Promise<TasksOutcome> {
  const { data, error } = await api
    .DELETE("/api/v1/tasks/{taskId}", {
      params: { path: { taskId } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, tasks: data.tasks, doneCount: data.doneCount, totalCount: data.totalCount }
    : { ok: false, detail: problemDetail(error) };
}
