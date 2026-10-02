// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-013's fixed register vocabulary and localized labels. */

import { defineMessages } from "react-intl";

export const REGISTER_KINDS = ["shares", "partnership", "trust", "none"] as const;
export type RegisterKind = (typeof REGISTER_KINDS)[number];
export const registerKindLabels = defineMessages({
  shares: { id: "entities.registerKind.shares", defaultMessage: "Share register" },
  partnership: { id: "entities.registerKind.partnership", defaultMessage: "Partnership register" },
  trust: { id: "entities.registerKind.trust", defaultMessage: "Trust register" },
  none: { id: "entities.registerKind.none", defaultMessage: "None" },
});
