// SPDX-License-Identifier: AGPL-3.0-only

import type { SearchQuestion } from "@openlaw/shared";
import { createContext, useContext, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../ui/button";
import { AdvancedSearchDialog } from "./advanced-search-dialog";
import { questionFromSearch, questionPath } from "./search-question";

const AdvancedSearchContext = createContext<{
  draft: SearchQuestion | null;
  open: (question: SearchQuestion, focusCondition?: number) => void;
} | null>(null);

export function useAdvancedSearch() {
  const context = useContext(AdvancedSearchContext);
  if (!context) throw new Error("Advanced search requires the application shell");
  return context;
}

export function AdvancedSearchProvider({ children }: Readonly<{ children: ReactNode }>) {
  const navigate = useNavigate();
  const [session, setSession] = useState<{
    question: SearchQuestion;
    returnFocus: HTMLElement | null;
    focusCondition?: number;
  } | null>(null);
  return (
    <AdvancedSearchContext.Provider
      value={{
        draft: session?.question ?? null,
        open: (question, focusCondition) =>
          setSession({
            question,
            focusCondition,
            returnFocus:
              document.activeElement instanceof HTMLElement ? document.activeElement : null,
          }),
      }}
    >
      {children}
      {session && (
        <AdvancedSearchDialog
          question={session.question}
          returnFocus={session.returnFocus}
          focusCondition={session.focusCondition}
          onChange={(question) => setSession({ ...session, question })}
          onClose={() => setSession(null)}
          onSearch={() => {
            const path = questionPath(session.question);
            setSession(null);
            void navigate(path);
          }}
        />
      )}
    </AdvancedSearchContext.Provider>
  );
}

export function AdvancedSearchButton() {
  const location = useLocation();
  const { open } = useAdvancedSearch();
  return (
    <Button variant="secondary" onClick={() => open(questionFromSearch(location.search))}>
      <SlidersHorizontal size={16} aria-hidden="true" />
      <FormattedMessage id="search.advanced.button" defaultMessage="Advanced" />
    </Button>
  );
}
