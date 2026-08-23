// SPDX-License-Identifier: AGPL-3.0-only

/** Typed client helpers for MTR-007's one Contract-to-Matter link. */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail } from "./messages";

type MatterResponse =
  paths["/api/v1/contracts/{number}/matter"]["get"]["responses"]["200"]["content"]["application/json"];
type ContractsResponse =
  paths["/api/v1/matters/{number}/contracts"]["get"]["responses"]["200"]["content"]["application/json"];
type MatterCandidatesResponse =
  paths["/api/v1/contracts/{number}/matter-candidates"]["get"]["responses"]["200"]["content"]["application/json"];
type CreateMatterCandidatesResponse =
  paths["/api/v1/contracts/matter-candidates"]["get"]["responses"]["200"]["content"]["application/json"];
type ContractCandidatesResponse =
  paths["/api/v1/matters/{number}/contract-candidates"]["get"]["responses"]["200"]["content"]["application/json"];

export type LinkedMatter = MatterResponse["matter"];
export type LinkedContract = ContractsResponse["contracts"][number];
export type MatterLinkCandidate = MatterCandidatesResponse["candidates"][number];
export type CreateMatterLinkCandidate = CreateMatterCandidatesResponse["candidates"][number];
export type ContractLinkCandidate = ContractCandidatesResponse["candidates"][number];

export async function searchMatterCandidates(
  contractNumber: number,
  q: string,
): Promise<MatterLinkCandidate[]> {
  const { data } = await api.GET("/api/v1/contracts/{number}/matter-candidates", {
    params: { path: { number: contractNumber }, query: { q } },
  });
  return data?.candidates ?? [];
}

export async function searchCreateMatterCandidates(
  q: string,
): Promise<CreateMatterLinkCandidate[]> {
  const { data } = await api.GET("/api/v1/contracts/matter-candidates", {
    params: { query: { q } },
  });
  return data?.candidates ?? [];
}

export async function searchContractCandidates(
  matterNumber: number,
  q: string,
): Promise<ContractLinkCandidate[]> {
  const { data } = await api.GET("/api/v1/matters/{number}/contract-candidates", {
    params: { path: { number: matterNumber }, query: { q } },
  });
  return data?.candidates ?? [];
}

export async function readMatterContracts(
  matterNumber: number,
): Promise<{ ok: true; contracts: LinkedContract[] } | { ok: false }> {
  const { data } = await api
    .GET("/api/v1/matters/{number}/contracts", {
      params: { path: { number: matterNumber } },
    })
    .catch(() => ({ data: undefined }));
  return data ? { ok: true, contracts: data.contracts } : { ok: false };
}

export type LinkedReachableMatter = Extract<Exclude<LinkedMatter, null>, { restricted: false }>;

export type LinkMatterOutcome =
  | { ok: true; matter: LinkedReachableMatter; confidentialityMismatch: boolean }
  | { ok: false; detail?: string };

export async function linkContractMatter(
  contractNumber: number,
  matterNumber: number,
): Promise<LinkMatterOutcome> {
  const { data, error } = await api
    .POST("/api/v1/contracts/{number}/matter", {
      params: { path: { number: contractNumber } },
      body: { matterNumber },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data?.matter && !data.matter.restricted
    ? {
        ok: true,
        matter: data.matter,
        confidentialityMismatch: data.confidentialityMismatch,
      }
    : { ok: false, detail: problemDetail(error) };
}

export async function unlinkContractMatter(
  contractNumber: number,
): Promise<{ ok: true } | { ok: false; detail?: string }> {
  const { data, error } = await api
    .DELETE("/api/v1/contracts/{number}/matter", {
      params: { path: { number: contractNumber } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data ? { ok: true } : { ok: false, detail: problemDetail(error) };
}
