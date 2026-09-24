// SPDX-License-Identifier: AGPL-3.0-only

/** S5's empty-box groups. Saved searches come from DD-019's search surface
 * on focus; recent questions come from this browser's user-scoped history. */

import { resolveSearchQuestion, type SearchQuestion } from "@openlaw/shared";
import { useEffect, useState } from "react";
import { defineMessages, useIntl } from "react-intl";
import { readViews, type SavedView } from "../../lib/list-views";
import { useAdvancedSearch } from "./advanced-search";
import { useQuestionSummaries } from "./question-summary";

const GROUPS = defineMessages({
  saved: { id: "search.header.saved", defaultMessage: "Saved" },
  recent: { id: "search.header.recent", defaultMessage: "Recent" },
});

export function useEmptySearchEntries(open: boolean) {
  const intl = useIntl();
  const { recents } = useAdvancedSearch();
  const [saved, setSaved] = useState<SavedView<SearchQuestion>[]>([]);
  const summaries = useQuestionSummaries(open ? recents : []);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void readViews<SearchQuestion>("search").then((views) => {
      if (live) setSaved(views);
    });
    return () => {
      live = false;
    };
  }, [open]);
  return [
    {
      key: "saved",
      label: intl.formatMessage(GROUPS.saved),
      entries: saved.flatMap((view) => {
        const resolved = resolveSearchQuestion(view.layout);
        return resolved ? [{ key: view.id, label: view.name, question: resolved.question }] : [];
      }),
    },
    {
      key: "recent",
      label: intl.formatMessage(GROUPS.recent),
      entries: recents.map((question, index) => ({
        key: JSON.stringify(question),
        label: summaries[index] ?? "",
        question,
      })),
    },
  ];
}
