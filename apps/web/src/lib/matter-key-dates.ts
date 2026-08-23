// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Key-date wire calls (MTR-004). */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail } from "./messages";

type ListResponse =
  paths["/api/v1/matters/{number}/key-dates"]["get"]["responses"]["200"]["content"]["application/json"];
export type MatterDeadline = ListResponse["deadlines"][number];
export type MatterKeyDateInput = NonNullable<
  paths["/api/v1/matters/{number}/key-dates"]["post"]["requestBody"]
>["content"]["application/json"];
export type MatterKeyDatePatch = NonNullable<
  paths["/api/v1/matter-key-dates/{keyDateId}"]["patch"]["requestBody"]
>["content"]["application/json"];
export type MatterDeadlinesOutcome =
  { ok: true; deadlines: MatterDeadline[] } | { ok: false; detail?: string };

const outcome = (data: ListResponse | undefined, error: unknown): MatterDeadlinesOutcome =>
  data ? { ok: true, deadlines: data.deadlines } : { ok: false, detail: problemDetail(error) };

export async function addMatterKeyDate(number: number, input: MatterKeyDateInput) {
  const { data, error } = await api
    .POST("/api/v1/matters/{number}/key-dates", {
      params: { path: { number } },
      body: input,
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function updateMatterKeyDate(keyDateId: string, input: MatterKeyDatePatch) {
  const { data, error } = await api
    .PATCH("/api/v1/matter-key-dates/{keyDateId}", {
      params: { path: { keyDateId } },
      body: input,
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}

export async function removeMatterKeyDate(keyDateId: string) {
  const { data, error } = await api
    .DELETE("/api/v1/matter-key-dates/{keyDateId}", { params: { path: { keyDateId } } })
    .catch(() => ({ data: undefined, error: undefined }));
  return outcome(data, error);
}
