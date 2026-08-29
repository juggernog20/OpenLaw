// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-relations vocabulary the record's Overview section reads
 * (M17/2, CTR-015): the parent chain, children, and typed links the API
 * answers for one contract.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problem, type Problem } from "./problem";

type RelationsResponse =
  paths["/api/v1/contracts/{number}/relations"]["get"]["responses"]["200"]["content"]["application/json"];

/** One entry in the parent chain, children list, or a link's target. */
export type RelationEntry = RelationsResponse["parentChain"][number];

/** One typed link between two contracts. */
export type ContractLink = RelationsResponse["links"][number];

/** The three link types the API distinguishes. */
export type RelationType = ContractLink["relationType"];

/** The direction of a typed link relative to this contract. */
export type LinkDirection = ContractLink["direction"];

/** The full relations surface for one contract. */
export interface ContractRelations {
  parentChain: RelationEntry[];
  children: RelationEntry[];
  links: ContractLink[];
}

/** What a read over the contract's relations answers. */
export type RelationsOutcome =
  { ok: true; relations: ContractRelations } | ({ ok: false } & Problem);

/**
 * Reads one contract's relation surface.
 *
 * Every call here settles rather than rejects. A refused answer and a
 * request that never arrived are the same event to the section that
 * awaited it — both mean "this did not happen" — and a rejection that
 * escaped would leave the surface disabled with nothing on screen to
 * say why.
 */
export async function readContractRelations(number: number): Promise<RelationsOutcome> {
  const result = await api
    .GET("/api/v1/contracts/{number}/relations", {
      params: { path: { number } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, relations: result.data }
    : { ok: false, ...(await problem(result)) };
}

// ---------------------------------------------------------------------------
// Link candidates (M17/4, CTR-018)
// ---------------------------------------------------------------------------

type CandidatesResponse =
  paths["/api/v1/contracts/{number}/link-candidates"]["get"]["responses"]["200"]["content"]["application/json"];

/** One contract the picker may offer. */
export type LinkCandidate = CandidatesResponse["candidates"][number];

/** Fetches contracts this viewer can reach, matched by number or title. */
export async function searchLinkCandidates(number: number, q: string): Promise<LinkCandidate[]> {
  const { data } = await api
    .GET("/api/v1/contracts/{number}/link-candidates", {
      params: { path: { number }, query: { q } },
    })
    .catch(() => ({ data: undefined }));
  return data?.candidates ?? [];
}

// ---------------------------------------------------------------------------
// Write operations (M17/4)
// ---------------------------------------------------------------------------

/** What a relation write answers. */
export type RelationWriteOutcome =
  { ok: true; relations: ContractRelations } | ({ ok: false } & Problem);

/** Add a typed link between two contracts. */
export async function addRelation(
  number: number,
  relatedContractNumber: number,
  relationType: RelationType,
): Promise<RelationWriteOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/relations", {
      params: { path: { number } },
      body: { relatedContractNumber, relationType },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, relations: result.data }
    : { ok: false, ...(await problem(result)) };
}

/** Remove a typed link between two contracts. */
export async function removeRelation(
  number: number,
  relatedContractNumber: number,
  relationType: RelationType,
): Promise<RelationWriteOutcome> {
  const result = await api
    .DELETE("/api/v1/contracts/{number}/relations", {
      params: { path: { number } },
      body: { relatedContractNumber, relationType },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, relations: result.data }
    : { ok: false, ...(await problem(result)) };
}

/** Put a contract under a parent. */
export async function setParent(
  number: number,
  parentContractNumber: number,
): Promise<RelationWriteOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/parent", {
      params: { path: { number } },
      body: { parentContractNumber },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, relations: result.data }
    : { ok: false, ...(await problem(result)) };
}

/** Take a contract out from under its parent. */
export async function removeParent(number: number): Promise<RelationWriteOutcome> {
  const result = await api
    .DELETE("/api/v1/contracts/{number}/parent", {
      params: { path: { number } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, relations: result.data }
    : { ok: false, ...(await problem(result)) };
}
