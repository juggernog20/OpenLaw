// SPDX-License-Identifier: AGPL-3.0-only

import {
  conditionProblem,
  SearchQuestionSchema,
  simpleSearchQuestion,
  type SearchQuestion,
} from "@openlaw/shared";
import { useEffect, useId, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { useConditionDefinitions } from "./condition-definitions";
import { dropUnavailableFields, FIELD_NOTICES } from "./field-definitions";
import { SavedSearchList, SaveSearch, useSavedSearches } from "./saved-searches";
import { RecentSearchList } from "./recent-search-list";
import { SearchConditions } from "./search-conditions";
import { querySearch, type QuestionSearchOutcome } from "../../lib/search";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { SEARCH_KIND_ORDER, SearchResultRow, searchKindLabel } from "./search-result-row";
import {
  CHIP_CLASS,
  IDLE_CHIP_CLASS,
  SELECTED_CHIP_CLASS,
  SCOPE_LABELS,
  WORD_LABELS,
  questionIsEmpty,
} from "./search-question";

function Preview({
  question,
  onClose,
  fieldsValid,
}: Readonly<{ question: SearchQuestion; onClose: () => void; fieldsValid: boolean }>) {
  const intl = useIntl();
  const [settled, setSettled] = useState<{
    question: SearchQuestion;
    outcome: QuestionSearchOutcome;
  } | null>(null);
  const empty = questionIsEmpty(question);
  const noScope = !Object.values(question.scope).some(Boolean);
  const tooLong = Object.values(question.words).some((words) => words.trim().length > 200);
  const validation = SearchQuestionSchema.safeParse(question);
  const conditionError = validation.success
    ? null
    : validation.error.issues
        .filter((issue) => issue.path[0] === "conditions")
        .map((issue) => issue.message)
        .join(" ");
  const runnable = fieldsValid && !empty && !noScope && !tooLong && !conditionError;
  const outcome = settled?.question === question ? settled.outcome : null;

  useEffect(() => {
    if (!runnable) return;
    let live = true;
    const timer = setTimeout(() => {
      void querySearch(question, { limit: 10 }).then((answer) => {
        if (live) setSettled({ question, outcome: answer });
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [question, runnable]);

  return (
    <section
      aria-label={intl.formatMessage({ id: "search.preview", defaultMessage: "Preview" })}
      className="min-w-0 border-t border-border-default bg-canvas @3xl/dialog:border-s @3xl/dialog:border-t-0"
    >
      <h2
        className="flex min-h-14 items-center border-b border-border-default px-6 font-semibold"
        aria-live="polite"
      >
        {outcome?.ok ? (
          <FormattedMessage
            id="search.total"
            defaultMessage="{total, plural, one {# match} other {# matches}}"
            values={{ total: outcome.total }}
          />
        ) : (
          <FormattedMessage id="search.preview" defaultMessage="Preview" />
        )}
      </h2>
      <div aria-live="polite" aria-busy={runnable && !outcome}>
        {noScope ? (
          <p role="status" className="p-6 text-sm text-muted">
            <FormattedMessage
              id="search.scope.required"
              defaultMessage="Choose at least one search scope."
            />
          </p>
        ) : empty ? (
          <div
            role="status"
            className="flex min-h-70 flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <Search size={24} aria-hidden="true" className="text-muted" />
            <h3 className="font-semibold">
              <FormattedMessage id="search.build" defaultMessage="Build your search" />
            </h3>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="search.build.body"
                defaultMessage="Add words, choose a kind, or add a condition to see matching records."
              />
            </p>
          </div>
        ) : tooLong ? (
          <p role="alert" className="p-6 text-sm text-status-danger-fg">
            <FormattedMessage
              id="search.words.tooLong"
              defaultMessage="Search words rows must be 200 characters or fewer."
            />
          </p>
        ) : conditionError ? (
          <p role="alert" className="p-6 text-sm text-status-danger-fg">
            {conditionError}
          </p>
        ) : !outcome ? (
          <p
            role="status"
            className="flex items-center justify-center gap-2 p-6 text-sm text-muted"
          >
            <LoaderCircle size={20} aria-hidden="true" className="animate-spin" />
            <FormattedMessage id="search.searching" defaultMessage="Searching…" />
          </p>
        ) : !outcome.ok ? (
          <div role="alert" className="p-6 text-sm text-status-danger-fg">
            <p className="font-semibold">
              <FormattedMessage id="search.error.title" defaultMessage="Search could not load" />
            </p>
            <p>
              {outcome.detail ??
                intl.formatMessage({
                  id: "search.error.body",
                  defaultMessage: "The server did not answer. Try again in a moment.",
                })}
            </p>
          </div>
        ) : outcome.results.length === 0 ? (
          <p role="status" className="p-6 text-center text-sm text-muted">
            <FormattedMessage id="search.noMatches" defaultMessage="No matches" />
          </p>
        ) : (
          <div className="p-3">
            <ul>
              {outcome.results.slice(0, 10).map((result) => (
                <li key={`${result.kind}:${result.id}`}>
                  <SearchResultRow
                    result={result}
                    query={Object.values(question.words).filter(Boolean).join(" ")}
                    onNavigate={onClose}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted">
              <FormattedMessage
                id="search.preview.limit"
                defaultMessage="Showing the first {count} of {total} matches"
                values={{ count: Math.min(outcome.results.length, 10), total: outcome.total }}
              />
            </p>
          </div>
        )}
      </div>
      <p className="px-6 pb-6 text-sm text-muted">
        <FormattedMessage
          id="search.preview.help"
          defaultMessage="Preview updates as you change the question."
        />
      </p>
    </section>
  );
}

export function AdvancedSearchDialog({
  question,
  recents,
  onChange,
  onClose,
  onSearch,
  returnFocus,
  focusCondition,
}: Readonly<{
  question: SearchQuestion;
  recents: SearchQuestion[];
  onChange: (question: SearchQuestion) => void;
  onClose: () => void;
  onSearch: () => void;
  returnFocus: HTMLElement | null;
  focusCondition?: number;
}>) {
  const intl = useIntl();
  const id = useId();
  const [notice, setNotice] = useState("");
  const searches = useSavedSearches(question, onChange, setNotice);
  const definitions = useConditionDefinitions(question.kinds, (catalog) => {
    const next = dropUnavailableFields(question, catalog);
    if (next !== question) {
      setNotice(intl.formatMessage(FIELD_NOTICES.removed));
      onChange(next);
    }
  });
  const { fields } = definitions;
  const fieldsValid = question.conditions.every(
    (condition) =>
      !condition.property.startsWith("field:") ||
      (fields.ready && !conditionProblem(condition, fields.fields)),
  );
  const valid =
    fieldsValid &&
    Object.values(question.scope).some(Boolean) &&
    SearchQuestionSchema.safeParse(question).success;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        width="wide"
        className="p-0"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
      >
        <header className="flex h-16 items-center justify-between border-b border-border-default px-6">
          <DialogTitle>
            <FormattedMessage id="search.advanced.title" defaultMessage="Advanced search" />
          </DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={intl.formatMessage({
                id: "search.advanced.close",
                defaultMessage: "Close Advanced search",
              })}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </DialogClose>
        </header>
        <div className="grid grid-cols-1 @3xl/dialog:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-6 p-6">
            <fieldset className="min-w-0 space-y-2">
              <legend className="mb-3 font-semibold">
                <FormattedMessage id="search.words" defaultMessage="Words" />
              </legend>
              {(Object.keys(WORD_LABELS) as (keyof typeof WORD_LABELS)[]).map((key) => (
                <div
                  key={key}
                  className="grid grid-cols-1 items-center gap-2 @xl/dialog:grid-cols-[8.375rem_minmax(0,1fr)]"
                >
                  <label htmlFor={`${id}-${key}`} className="text-sm">
                    <FormattedMessage {...WORD_LABELS[key]} />
                  </label>
                  <Input
                    id={`${id}-${key}`}
                    value={question.words[key]}
                    onChange={(event) =>
                      onChange({
                        ...question,
                        words: { ...question.words, [key]: event.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
            <fieldset>
              <legend className="mb-3 font-semibold">
                <FormattedMessage id="search.scope" defaultMessage="Search in" />
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).map((key) => (
                  <label key={key} className="flex min-h-6 items-center gap-2 text-sm">
                    <Checkbox
                      checked={question.scope[key]}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...question,
                          scope: { ...question.scope, [key]: checked === true },
                        })
                      }
                    />
                    <FormattedMessage {...SCOPE_LABELS[key]} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 font-semibold">
                <FormattedMessage id="search.kinds" defaultMessage="Kinds" />
              </legend>
              <div className="flex flex-wrap gap-2">
                {SEARCH_KIND_ORDER.map((kind) => {
                  const selected = question.kinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={selected}
                      className={cn(CHIP_CLASS, selected ? SELECTED_CHIP_CLASS : IDLE_CHIP_CLASS)}
                      onClick={() => {
                        if (
                          selected &&
                          question.conditions.some((condition) => condition.kind === kind)
                        )
                          setNotice(
                            intl.formatMessage(
                              {
                                id: "search.conditions.removed",
                                defaultMessage: "Conditions for {kind} were removed.",
                              },
                              { kind: searchKindLabel(intl, kind) },
                            ),
                          );
                        onChange({
                          ...question,
                          kinds: selected
                            ? question.kinds.filter((value) => value !== kind)
                            : [...question.kinds, kind],
                          conditions: selected
                            ? question.conditions.filter((condition) => condition.kind !== kind)
                            : question.conditions,
                        });
                      }}
                    >
                      {searchKindLabel(intl, kind)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-sm text-muted">
                {question.kinds.length > 0 ? (
                  <FormattedMessage
                    id="search.kinds.help.selected"
                    defaultMessage="Only selected kinds are searched."
                  />
                ) : (
                  <FormattedMessage
                    id="search.kinds.help"
                    defaultMessage="No kinds selected searches every kind."
                  />
                )}
              </p>
            </fieldset>
            {notice && (
              <p role="status" className="text-sm text-muted">
                {notice}
              </p>
            )}
            <SearchConditions
              question={question}
              onChange={onChange}
              focusCondition={focusCondition}
              definitions={definitions}
            />
            <SavedSearchList searches={searches} />
            <RecentSearchList
              questions={recents}
              onSelect={searches.selectRecent}
              disabled={searches.busy}
            />
          </div>
          <Preview question={question} onClose={onClose} fieldsValid={fieldsValid} />
        </div>
        <footer className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-t border-border-default px-6 py-3">
          <Button
            variant="secondary"
            disabled={searches.busy}
            onClick={() => {
              searches.clear();
              setNotice("");
              onChange(simpleSearchQuestion());
            }}
          >
            <FormattedMessage id="search.clear" defaultMessage="Clear" />
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <SaveSearch searches={searches} valid={valid} />
            <Button disabled={!valid || searches.busy} onClick={onSearch}>
              <FormattedMessage id="search.header.label" defaultMessage="Search" />
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
