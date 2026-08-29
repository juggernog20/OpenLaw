// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Task checklist wire helpers (MTR-005, M23/4). */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problem, type OpenApiResult, type Problem } from "./problem";

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
  | ({ ok: false } & Problem);

async function outcome(
  result: (OpenApiResult & { data?: ListResponse }) | undefined,
): Promise<MatterTasksOutcome> {
  return result?.data
    ? {
        ok: true,
        tasks: result.data.tasks,
        doneCount: result.data.doneCount,
        totalCount: result.data.totalCount,
      }
    : { ok: false, ...(await problem(result)) };
}

export async function readMatterTasks(number: number): Promise<MatterTasksOutcome> {
  const result = await api
    .GET("/api/v1/matters/{number}/tasks", { params: { path: { number } } })
    .catch(() => undefined);
  return outcome(result);
}

export async function addMatterTask(
  number: number,
  input: MatterTaskInput,
): Promise<MatterTasksOutcome> {
  const result = await api
    .POST("/api/v1/matters/{number}/tasks", {
      params: { path: { number } },
      body: input,
    })
    .catch(() => undefined);
  return outcome(result);
}

export async function updateMatterTask(
  taskId: string,
  input: MatterTaskInput,
): Promise<MatterTasksOutcome> {
  const result = await api
    .PATCH("/api/v1/matter-tasks/{taskId}", {
      params: { path: { taskId } },
      body: input,
    })
    .catch(() => undefined);
  return outcome(result);
}

export async function toggleMatterTask(taskId: string): Promise<MatterTasksOutcome> {
  const result = await api
    .POST("/api/v1/matter-tasks/{taskId}/toggle", { params: { path: { taskId } } })
    .catch(() => undefined);
  return outcome(result);
}

export async function reorderMatterTasks(
  number: number,
  taskIds: string[],
): Promise<MatterTasksOutcome> {
  const result = await api
    .PUT("/api/v1/matters/{number}/tasks/reorder", {
      params: { path: { number } },
      body: { taskIds },
    })
    .catch(() => undefined);
  return outcome(result);
}

export async function removeMatterTask(taskId: string): Promise<MatterTasksOutcome> {
  const result = await api
    .DELETE("/api/v1/matter-tasks/{taskId}", { params: { path: { taskId } } })
    .catch(() => undefined);
  return outcome(result);
}
