// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../../lib/api";
import type { FormRow } from "@openlaw/shared";

export async function referenceOptions(
  row: FormRow,
): Promise<{ value: string; label: string }[] | null> {
  if (row.rowRef === "contract_type") {
    const { data } = await api.GET("/api/v1/contract-types", {});
    if (!data) throw new Error("Contract types could not be read");
    return data.contractTypes.map((type) => ({ value: type.id, label: type.displayName }));
  }
  if (row.rowRef === "matter_type") {
    const { data } = await api.GET("/api/v1/matter-types", {});
    if (!data) throw new Error("Matter types could not be read");
    return data.matterTypes.map((type) => ({ value: type.id, label: type.displayName }));
  }
  if (row.fieldType === "user") {
    const { data } = await api.GET("/api/v1/users");
    if (!data) throw new Error("People could not be read");
    return data.users
      .filter((u) => u.status === "active")
      .map((u) => ({ value: u.id, label: u.displayName }));
  }
  if (row.fieldType === "entity") {
    const options: { value: string; label: string }[] = [];
    let cursor: string | undefined;
    do {
      const { data } = await api.GET("/api/v1/entities", { params: { query: { cursor } } });
      if (!data) throw new Error("Entities could not be read");
      options.push(...data.entities.map((e) => ({ value: e.id, label: e.legalName })));
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
    return options;
  }
  if (["department", "owning_department"].includes(row.rowRef)) {
    const { data } = await api.GET("/api/v1/departments/options");
    if (!data) throw new Error("Departments could not be read");
    return data.departments.map((d) => ({ value: d.id, label: d.displayName }));
  }
  if (row.rowRef === "region") {
    const { data } = await api.GET("/api/v1/regions", {});
    if (!data) throw new Error("Regions could not be read");
    return data.regions.map((r) => ({ value: r.id, label: r.displayName }));
  }
  if (row.rowRef === "counterparties") {
    const { data } = await api.GET("/api/v1/counterparties", {});
    if (!data) throw new Error("Counterparties could not be read");
    return data.counterparties.map((c) => ({ value: c.id, label: c.name }));
  }
  return null;
}
