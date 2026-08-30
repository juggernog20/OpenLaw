// SPDX-License-Identifier: AGPL-3.0-only

import type { paths } from "@openlaw/api-client";
import { api } from "./api";

type ContractResponse =
  paths["/api/v1/entities/{id}/contracts"]["get"]["responses"]["200"]["content"]["application/json"];
type MatterResponse =
  paths["/api/v1/entities/{id}/matters"]["get"]["responses"]["200"]["content"]["application/json"];
export type LinkedRecord = ContractResponse["records"][number] | MatterResponse["records"][number];
export type LinkedRecordKind = LinkedRecord["kind"];

export interface LinkedRecordsSeam {
  kind: LinkedRecordKind;
  read: (entityId: string) => Promise<LinkedRecord[]>;
}

export const ENTITY_LINKED_RECORD_SEAMS: Record<LinkedRecordKind, LinkedRecordsSeam> = {
  contract: {
    kind: "contract",
    read: async (id) => {
      const { data } = await api.GET("/api/v1/entities/{id}/contracts", {
        params: { path: { id } },
      });
      if (!data) throw new Error("The linked Contracts could not be read.");
      return data.records;
    },
  },
  matter: {
    kind: "matter",
    read: async (id) => {
      const { data } = await api.GET("/api/v1/entities/{id}/matters", {
        params: { path: { id } },
      });
      if (!data) throw new Error("The linked Matters could not be read.");
      return data.records;
    },
  },
};
