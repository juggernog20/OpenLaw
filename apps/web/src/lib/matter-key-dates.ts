// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Key-date wire calls (MTR-004). */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problem, type Problem, type OpenApiResult } from "./problem";

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
  { ok: true; deadlines: MatterDeadline[] } | ({ ok: false } & Problem);

async function outcome(result: (OpenApiResult & { data?: ListResponse }) | undefined) {
  return result?.data
    ? { ok: true as const, deadlines: result.data.deadlines }
    : { ok: false as const, ...(await problem(result)) };
}

export async function addMatterKeyDate(number: number, input: MatterKeyDateInput) {
  const result = await api
    .POST("/api/v1/matters/{number}/key-dates", {
      params: { path: { number } },
      body: input,
    })
    .catch(() => undefined);
  return outcome(result);
}

export async function updateMatterKeyDate(keyDateId: string, input: MatterKeyDatePatch) {
  const result = await api
    .PATCH("/api/v1/matter-key-dates/{keyDateId}", {
      params: { path: { keyDateId } },
      body: input,
    })
    .catch(() => undefined);
  return outcome(result);
}

export async function removeMatterKeyDate(keyDateId: string) {
  const result = await api
    .DELETE("/api/v1/matter-key-dates/{keyDateId}", { params: { path: { keyDateId } } })
    .catch(() => undefined);
  return outcome(result);
}
