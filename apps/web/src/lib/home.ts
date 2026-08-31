// SPDX-License-Identifier: AGPL-3.0-only

/** The generated M29 Home envelope, named once for its renderers. */
import type { paths } from "@openlaw/api-client";

export type HomeEnvelope =
  paths["/api/v1/home"]["get"]["responses"]["200"]["content"]["application/json"];
export type HomeSection = HomeEnvelope["sections"][number];
export type ApprovalHomeSection = Extract<HomeSection, { type: "approvals" }>;
export type TasksHomeSection = Extract<HomeSection, { type: "tasks" }>;
export type DatesHomeSection = Extract<HomeSection, { type: "dates" }>;
export type ObligationsHomeSection = Extract<HomeSection, { type: "obligations" }>;
export type InboxHomeSection = Extract<HomeSection, { type: "inbox" }>;
export type ContractsHomeSection = Extract<HomeSection, { type: "contracts" }>;
export type MattersHomeSection = Extract<HomeSection, { type: "matters" }>;
