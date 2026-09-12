// SPDX-License-Identifier: AGPL-3.0-only

import type { paths } from "@openlaw/api-client";
import { api } from "./api";

export type PortalRecordModule = "contract" | "matter";
export type PortalWork =
  paths["/api/v1/portal/contracts/{number}/work"]["get"]["responses"]["200"]["content"]["application/json"]["work"];
export type PortalDocuments =
  paths["/api/v1/portal/contracts/{number}/supporting-documents"]["get"]["responses"]["200"]["content"]["application/json"];

export function readPortalDocuments(module: PortalRecordModule, number: number, cursor?: string) {
  return api.GET(`/api/v1/portal/${module}s/{number}/supporting-documents`, {
    params: { path: { number }, query: cursor ? { cursor } : {} },
  });
}

export async function loadPortalWork(module: PortalRecordModule, number: number) {
  const { data } = await api.GET(`/api/v1/portal/${module}s/{number}/work`, {
    params: { path: { number } },
  });
  if (!data) throw new Error("This record could not be read.");
  const [documents, thread] = await Promise.all([
    readPortalDocuments(module, number),
    api
      .GET("/api/v1/comments", {
        params: {
          query: { entityType: module, entityId: data.work.id, visibility: "full_thread" },
        },
      })
      .catch(() => ({ data: undefined })),
  ]);
  if (!documents.data) throw new Error("The Documents could not be read.");
  return { work: data.work, documents: documents.data, thread: thread.data ?? null };
}

export function savePortalWork(
  module: PortalRecordModule,
  number: number,
  body: paths["/api/v1/portal/contracts/{number}/work"]["patch"]["requestBody"]["content"]["application/json"],
) {
  return api.PATCH(`/api/v1/portal/${module}s/{number}/work`, {
    params: { path: { number } },
    body,
  });
}
