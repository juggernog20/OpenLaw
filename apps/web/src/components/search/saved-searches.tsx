// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  resolveSearchQuestion,
  SearchQuestionSchema,
  simpleSearchQuestion,
  type SearchQuestion,
} from "@openlaw/shared";
import {
  createView,
  deleteView,
  readViews,
  updateView,
  type SavedView,
} from "../../lib/list-views";
import { Button } from "../ui/button";
import { ViewsMenu } from "../table/views-menu";
import { dropUnavailableFields, readSearchFields } from "./field-definitions";

type SearchView = SavedView<SearchQuestion>;

export function useSavedSearches(
  question: SearchQuestion,
  onChange: (question: SearchQuestion) => void,
  onNotice: (notice: string) => void,
) {
  const intl = useIntl();
  const [views, setViews] = useState<SearchView[]>([]);
  const [activeView, setActiveView] = useState<SearchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef(0);
  useEffect(() => {
    let live = true;
    void readViews<SearchQuestion>("search").then((rows) => {
      if (live) setViews(rows);
    });
    return () => {
      live = false;
      selection.current = -1;
    };
  }, []);

  async function select(view: SearchView | null) {
    const request = ++selection.current;
    setError(null);
    if (!view) {
      setActiveView(null);
      onNotice("");
      onChange(simpleSearchQuestion());
      return;
    }
    setBusy(true);
    try {
      const resolved = resolveSearchQuestion(view.layout);
      if (!resolved) throw new Error("invalid question");
      let next = resolved.question;
      if (next.conditions.some((condition) => condition.property.startsWith("field:"))) {
        const catalog = await readSearchFields();
        if (!catalog) throw new Error("unavailable catalog");
        next = dropUnavailableFields(next, catalog.fields);
      }
      if (request !== selection.current) return;
      onNotice(
        resolved.dropped || next !== resolved.question
          ? intl.formatMessage({
              id: "search.saved.conditionsRemoved",
              defaultMessage: "Unavailable search conditions were removed.",
            })
          : "",
      );
      setActiveView({ ...view, layout: next });
      onChange(next);
    } catch {
      if (request === selection.current)
        setError(
          intl.formatMessage({
            id: "search.saved.openError",
            defaultMessage: "This saved search could not open. Try again.",
          }),
        );
    } finally {
      if (request === selection.current) setBusy(false);
    }
  }

  async function mutate(act: () => Promise<SearchView[]>) {
    setBusy(true);
    try {
      const rows = await act();
      setViews(rows);
      return rows;
    } finally {
      setBusy(false);
    }
  }
  const normalized = SearchQuestionSchema.safeParse(question);
  const modified =
    !!activeView &&
    JSON.stringify(normalized.success ? normalized.data : question) !==
      JSON.stringify(activeView.layout);
  return {
    views,
    activeView,
    modified,
    busy,
    error,
    select: (view: SearchView | null) => {
      void select(view);
    },
    clear: () => {
      selection.current++;
      setBusy(false);
      setActiveView(null);
      setError(null);
    },
    save: async () => {
      if (!activeView) return;
      const rows = await mutate(() =>
        updateView<SearchQuestion>(activeView.id, { config: SearchQuestionSchema.parse(question) }),
      );
      setActiveView(rows.find((row) => row.id === activeView.id) ?? null);
    },
    saveAs: async (name: string) => {
      const rows = await mutate(() =>
        createView("search", name, SearchQuestionSchema.parse(question)),
      );
      setActiveView(rows.find((row) => row.name === name) ?? null);
    },
    rename: async (view: SearchView, name: string) => {
      await mutate(() => updateView<SearchQuestion>(view.id, { name }));
      setActiveView((active) => (active?.id === view.id ? { ...active, name } : active));
    },
    remove: async (view: SearchView) => {
      await mutate(() => deleteView<SearchQuestion>(view.id));
      setActiveView((active) => (active?.id === view.id ? null : active));
    },
    reset: () => {
      if (activeView) void select(activeView);
    },
  };
}

type Searches = ReturnType<typeof useSavedSearches>;

function SearchViewMenu({
  searches,
  view,
  control,
  valid = true,
}: Readonly<{
  searches: Searches;
  view: SearchView | null;
  control: "row" | "save";
  valid?: boolean;
}>) {
  return (
    <ViewsMenu
      surface="search"
      searchControl={control}
      views={searches.views}
      activeView={view}
      modified={control === "save" && searches.modified}
      busy={searches.busy}
      saveDisabled={!valid}
      onSelect={searches.select}
      onSave={searches.save}
      onSaveAs={searches.saveAs}
      onRename={async (name) => {
        if (view) await searches.rename(view, name);
      }}
      onDelete={searches.remove}
      onReset={searches.reset}
    />
  );
}

export function SavedSearchList({ searches }: Readonly<{ searches: Searches }>) {
  return (
    <section aria-labelledby="saved-searches-heading">
      <h2 id="saved-searches-heading" className="font-semibold">
        <FormattedMessage id="search.saved" defaultMessage="Saved searches" />
      </h2>
      {searches.error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {searches.error}
        </p>
      )}
      <ul className="mt-1">
        {searches.views.map((view) => (
          <li key={view.id} className="flex min-h-8 items-center gap-2">
            <Button
              variant="ghost"
              className="h-8 min-w-0 flex-1 justify-start px-0 text-sm font-normal"
              disabled={searches.busy}
              onClick={() => searches.select(view)}
            >
              <Bookmark size={16} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="truncate">{view.name}</span>
            </Button>
            <SearchViewMenu searches={searches} view={view} control="row" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SaveSearch({ searches, valid }: Readonly<{ searches: Searches; valid: boolean }>) {
  return (
    <SearchViewMenu searches={searches} view={searches.activeView} control="save" valid={valid} />
  );
}
