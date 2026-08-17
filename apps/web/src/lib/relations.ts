// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-relations vocabulary the record's Overview section reads
 * (M17/2, CTR-015): the parent chain, children, and typed links the API
 * answers for one contract.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail } from "./messages";

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
  | { ok: true; relations: ContractRelations }
  | { ok: false; detail?: string };

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
  const { data, error } = await api
    .GET("/api/v1/contracts/{number}/relations", {
      params: { path: { number } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, relations: data }
    : { ok: false, detail: problemDetail(error) };
}
