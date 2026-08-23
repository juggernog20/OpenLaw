// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Task checklist wire helpers (MTR-005, M23/4). */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail } from "./messages";

type ListResponse =
  paths["/api/v1/matters/{number}/tasks"]["get"]["responses"]["200"]["content"]["application/json"];

export type MatterTask = ListResponse["tasks"][number];
export interface MatterTaskInput {
  title: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}
export type MatterTasksOutcome =
  | { ok: true; tasks: MatterTask[]; doneCount: number; totalCount: number }
  | { ok: false; detail?: string };

function outcome(data: ListResponse | undefined, error: unknown): MatterTasksOutcome {
  return data
    ? { ok: true, tasks: data.tasks, doneCount: data.doneCount, totalCount: data.totalCount }
    : { ok: false, detail: problemDetail(error) };
}

export async function readMatterTasks(number: number): Promise<MatterTasksOutcome> {
  const { data, error } = await api
    .GET("/api/v1/matters/{number}/tasks", { params: { path: { number } } })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function addMatterTask(
  number: number,
  input: MatterTaskInput,
): Promise<MatterTasksOutcome> {
  const { data, error } = await api
    .POST("/api/v1/matters/{number}/tasks", {
      params: { path: { number } },
      body: input,
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function updateMatterTask(
  taskId: string,
  input: MatterTaskInput,
): Promise<MatterTasksOutcome> {
  const { data, error } = await api
    .PATCH("/api/v1/matter-tasks/{taskId}", {
      params: { path: { taskId } },
      body: input,
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function toggleMatterTask(taskId: string): Promise<MatterTasksOutcome> {
  const { data, error } = await api
    .POST("/api/v1/matter-tasks/{taskId}/toggle", { params: { path: { taskId } } })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function reorderMatterTasks(
  number: number,
  taskIds: string[],
): Promise<MatterTasksOutcome> {
  const { data, error } = await api
    .PUT("/api/v1/matters/{number}/tasks/reorder", {
      params: { path: { number } },
      body: { taskIds },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function removeMatterTask(taskId: string): Promise<MatterTasksOutcome> {
  const { data, error } = await api
    .DELETE("/api/v1/matter-tasks/{taskId}", { params: { path: { taskId } } })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}
