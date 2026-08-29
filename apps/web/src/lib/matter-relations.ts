// SPDX-License-Identifier: AGPL-3.0-only

/** Typed client helpers for MTR-015's Matter relationship surface. */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problem, type ProblemResult } from "./problem";

export type MatterRelations =
  paths["/api/v1/matters/{number}/relations"]["get"]["responses"]["200"]["content"]["application/json"];
export type MatterRelative = NonNullable<MatterRelations["parent"]>;
export type MatterRelationCandidate =
  paths["/api/v1/matters/{number}/relation-candidates"]["get"]["responses"]["200"]["content"]["application/json"]["candidates"][number];
type MatterRelationResult = ProblemResult<MatterRelations>;

export async function searchMatterCandidates(number: number, q: string) {
  const { data } = await api
    .GET("/api/v1/matters/{number}/relation-candidates", {
      params: { path: { number }, query: { q } },
    })
    .catch(() => ({ data: undefined }));
  return data?.candidates ?? [];
}

export async function addMatterRelation(
  number: number,
  relatedMatterNumber: number,
): Promise<MatterRelationResult> {
  const result = await api
    .POST("/api/v1/matters/{number}/relations", {
      params: { path: { number } },
      body: { relatedMatterNumber },
    })
    .catch(() => undefined);
  return { data: result?.data, ...(await problem(result)) };
}

export async function removeMatterRelation(
  number: number,
  relatedMatterNumber: number,
): Promise<MatterRelationResult> {
  const result = await api
    .DELETE("/api/v1/matters/{number}/relations", {
      params: { path: { number } },
      body: { relatedMatterNumber },
    })
    .catch(() => undefined);
  return { data: result?.data, ...(await problem(result)) };
}

export async function setMatterParent(
  number: number,
  parentMatterNumber: number,
): Promise<MatterRelationResult> {
  const result = await api
    .PUT("/api/v1/matters/{number}/parent", {
      params: { path: { number } },
      body: { parentMatterNumber },
    })
    .catch(() => undefined);
  return { data: result?.data, ...(await problem(result)) };
}

export async function removeMatterParent(number: number): Promise<MatterRelationResult> {
  const result = await api
    .DELETE("/api/v1/matters/{number}/parent", { params: { path: { number } } })
    .catch(() => undefined);
  return { data: result?.data, ...(await problem(result)) };
}
