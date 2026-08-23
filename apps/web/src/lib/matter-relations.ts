// SPDX-License-Identifier: AGPL-3.0-only

/** Typed client helpers for MTR-015's Matter relationship surface. */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";

export type MatterRelations =
  paths["/api/v1/matters/{number}/relations"]["get"]["responses"]["200"]["content"]["application/json"];
export type MatterRelative = NonNullable<MatterRelations["parent"]>;
export type MatterRelationCandidate =
  paths["/api/v1/matters/{number}/relation-candidates"]["get"]["responses"]["200"]["content"]["application/json"]["candidates"][number];

export async function searchMatterCandidates(number: number, q: string) {
  const { data } = await api
    .GET("/api/v1/matters/{number}/relation-candidates", {
      params: { path: { number }, query: { q } },
    })
    .catch(() => ({ data: undefined }));
  return data?.candidates ?? [];
}

export async function addMatterRelation(number: number, relatedMatterNumber: number) {
  return api
    .POST("/api/v1/matters/{number}/relations", {
      params: { path: { number } },
      body: { relatedMatterNumber },
    })
    .catch(() => ({ data: undefined, error: undefined }));
}

export async function removeMatterRelation(number: number, relatedMatterNumber: number) {
  return api
    .DELETE("/api/v1/matters/{number}/relations", {
      params: { path: { number } },
      body: { relatedMatterNumber },
    })
    .catch(() => ({ data: undefined, error: undefined }));
}

export async function setMatterParent(number: number, parentMatterNumber: number) {
  return api
    .PUT("/api/v1/matters/{number}/parent", {
      params: { path: { number } },
      body: { parentMatterNumber },
    })
    .catch(() => ({ data: undefined, error: undefined }));
}

export async function removeMatterParent(number: number) {
  return api
    .DELETE("/api/v1/matters/{number}/parent", { params: { path: { number } } })
    .catch(() => ({ data: undefined, error: undefined }));
}
