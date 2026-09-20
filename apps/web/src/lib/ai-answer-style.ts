// SPDX-License-Identifier: AGPL-3.0-only

/** Shared labels for organisation and Field answer styles (CTR-008, DES-013). */

import { defineMessages } from "react-intl";

export const answerStyleLabels = defineMessages({
  few_words: { id: "settings.aiAnalysis.style.fewWords", defaultMessage: "Few word summary" },
  sentence: { id: "settings.aiAnalysis.style.sentence", defaultMessage: "1-2 sentence summary" },
  full_clause: { id: "settings.aiAnalysis.style.fullClause", defaultMessage: "Full clause text" },
});
