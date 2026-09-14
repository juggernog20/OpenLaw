// SPDX-License-Identifier: AGPL-3.0-only

/** DD-027: Portal Field controls read only Portal-listed Entity names. */

import { api } from "./api";
import type { FieldReference } from "../components/custom-field-control";

export async function readPortalEntityOptions(): Promise<FieldReference[]> {
  const res = await api.GET("/api/v1/portal/entities");
  if (!res.data) throw new Error("The Portal-listed Entities could not be read.");
  return res.data.entities.map(({ id, name }) => ({ id, label: name }));
}
