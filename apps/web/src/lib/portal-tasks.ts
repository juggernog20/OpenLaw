// SPDX-License-Identifier: AGPL-3.0-only

/** A Business User's own Tasks in the Portal (MTR-005 addendum, 2026-10-02). */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import type { PortalRecordModule } from "./portal-records";

export type PortalTaskPage =
  paths["/api/v1/portal/tasks"]["get"]["responses"]["200"]["content"]["application/json"];
export type PortalTask = PortalTaskPage["rows"][number];

export async function readPortalTasks({
  includeCompleted = false,
  cursor,
  record,
}: {
  includeCompleted?: boolean;
  cursor?: string;
  record?: { kind: PortalRecordModule; number: number };
} = {}): Promise<PortalTaskPage | undefined> {
  const { data } = await api.GET("/api/v1/portal/tasks", {
    params: {
      query: {
        includeCompleted: includeCompleted ? "true" : "false",
        ...(cursor ? { cursor } : {}),
        ...(record ? { kind: record.kind, number: record.number } : {}),
      },
    },
  });
  return data;
}

/** Completes an open Task or reopens a done one; undefined when the write fails. */
export async function togglePortalTask(task: PortalTask): Promise<PortalTask | undefined> {
  const { data } = await api.POST("/api/v1/portal/tasks/{taskId}/toggle", {
    params: { path: { taskId: task.id } },
    body: { kind: task.record.kind },
  });
  return data?.task;
}
