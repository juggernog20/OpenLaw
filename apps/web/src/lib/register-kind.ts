// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ENT-012's fixed register vocabulary, with localized labels and descriptions
 * shared by the Entity type editor and the Ownership controls.
 */

import { defineMessages } from "react-intl";

export const REGISTER_KINDS = ["shares", "partnership", "trust", "none"] as const;
export type RegisterKind = (typeof REGISTER_KINDS)[number];
export const registerKindLabels = defineMessages({
  shares: { id: "entities.registerKind.shares", defaultMessage: "Share register" },
  partnership: { id: "entities.registerKind.partnership", defaultMessage: "Partnership register" },
  trust: { id: "entities.registerKind.trust", defaultMessage: "Trust register" },
  none: { id: "entities.registerKind.none", defaultMessage: "None" },
});
export const registerKindDescriptions = defineMessages({
  shares: {
    id: "entities.registerKind.sharesHelp",
    defaultMessage: "Share classes, holders and dated movements of shares.",
  },
  partnership: {
    id: "entities.registerKind.partnershipHelp",
    defaultMessage: "Partners, their capacity and capital.",
  },
  trust: {
    id: "entities.registerKind.trustHelp",
    defaultMessage: "Trust parties, their roles and the trust fund.",
  },
  none: {
    id: "entities.registerKind.noneHelp",
    defaultMessage: "No register. Record a head office for a branch.",
  },
});
