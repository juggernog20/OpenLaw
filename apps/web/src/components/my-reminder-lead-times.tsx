// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Notifications · Reminder lead times (NOT-004 addendum,
 * 2026-09-24): how far ahead one person hears about the dates on their
 * records.
 *
 * A person uses the organization's list until they turn the switch off.
 * Turning it off copies the organization's list as a starting point.
 * Their own list then replaces the default for their reminders only.
 * Turning the switch back on clears their list.
 *
 * Every change is one immediate write (SET-003) of the whole list. The
 * list reads furthest first, because the round ignores order, so there
 * is nothing to drag.
 */

import { useRef, useState, type SubmitEvent as FormSubmitEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { MAX_OFFSET_DAYS, MAX_OFFSETS, offsetLabel } from "../lib/reminder-offsets";
import { SettingsCard } from "./settings-card";
import { StatusNote, type FieldStatus } from "./status-note";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

export function MyReminderLeadTimes({
  own: initialOwn,
  organization,
}: Readonly<{
  /** The person's own list, furthest first; null uses the organization's. */
  own: number[] | null;
  organization: number[];
}>) {
  const intl = useIntl();
  const [own, setOwn] = useState<number[] | null>(initialOwn);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  // A ref, not the state: a second press can arrive before React draws
  // the first one's "saving", and two whole-list writes would race.
  const saving = useRef(false);

  const usesDefault = own === null;
  const shown = own ?? organization;

  async function save(next: number[] | null): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    const previous = own;
    setOwn(next);
    setStatus("saving");
    setDetail(undefined);
    try {
      const result = await api
        .PATCH("/api/v1/me/notification-preferences", { body: { reminderOffsetDays: next } })
        .catch(() => undefined);
      if (!result?.data) {
        setOwn(previous);
        setStatus("error");
        setDetail((await problem(result)).detail);
        return false;
      }
      setOwn(result.data.reminderOffsetDays);
      setStatus("saved");
      return true;
    } finally {
      saving.current = false;
    }
  }

  async function add(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (own === null) return;
    const days = Number(draft.trim());
    if (draft.trim() === "" || !Number.isSafeInteger(days) || days < 0 || days > MAX_OFFSET_DAYS) {
      setDraftError(
        intl.formatMessage(
          {
            id: "settings.reminders.addInvalid",
            defaultMessage: "Enter a whole number of days between 0 and {max}.",
          },
          { max: MAX_OFFSET_DAYS },
        ),
      );
      return;
    }
    if (own.includes(days)) {
      setDraftError(
        intl.formatMessage(
          {
            id: "settings.reminders.addDuplicate",
            defaultMessage: "{label} is already on the list.",
          },
          { label: offsetLabel(intl, days) },
        ),
      );
      return;
    }
    if (own.length >= MAX_OFFSETS) {
      setDraftError(
        intl.formatMessage(
          {
            id: "settings.reminders.addFull",
            defaultMessage: "The list holds at most {max} lead times. Remove one first.",
          },
          { max: MAX_OFFSETS },
        ),
      );
      return;
    }
    setDraftError(undefined);
    if (await save([...own, days].sort((left, right) => right - left))) setDraft("");
  }

  return (
    <SettingsCard
      title={
        <FormattedMessage id="settings.myReminders.title" defaultMessage="Reminder lead times" />
      }
      actions={<StatusNote status={status} detail={detail} />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.myReminders.description"
            defaultMessage="How far ahead you hear about expiries, notice deadlines, Key dates and obligations."
          />
        </p>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="my-reminders-default" className="text-base font-medium">
            <FormattedMessage
              id="settings.myReminders.useDefault"
              defaultMessage="Use the organization's default lead times"
            />
          </label>
          <Switch
            id="my-reminders-default"
            checked={usesDefault}
            disabled={status === "saving"}
            onCheckedChange={(next) => {
              setDraft("");
              setDraftError(undefined);
              void save(next ? null : [...organization]);
            }}
          />
        </div>
        <ul
          aria-label={intl.formatMessage({
            id: "settings.myReminders.listLabel",
            defaultMessage: "Your reminder lead times",
          })}
          className="flex flex-wrap gap-2"
        >
          {shown.map((days) => (
            <li
              key={days}
              className="flex h-7 items-center gap-1 rounded-chip border border-border-default bg-control ps-2.5 pe-1 text-sm"
            >
              {offsetLabel(intl, days)}
              {!usesDefault && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={status === "saving" || shown.length === 1}
                  aria-label={intl.formatMessage(
                    { id: "settings.reminders.remove", defaultMessage: "Remove {label}" },
                    { label: offsetLabel(intl, days) },
                  )}
                  onClick={() => void save(shown.filter((value) => value !== days))}
                >
                  <X size={14} aria-hidden="true" className="text-muted" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!usesDefault && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void add(event)}>
            <Input
              type="number"
              min={0}
              max={MAX_OFFSET_DAYS}
              value={draft}
              aria-labelledby="my-reminders-add-unit"
              className="h-7 w-24"
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftError(undefined);
              }}
            />
            <span id="my-reminders-add-unit" className="text-sm text-muted">
              <FormattedMessage
                id="settings.reminders.addUnit"
                defaultMessage="days before the date"
              />
            </span>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={status === "saving" || draft.trim() === ""}
            >
              <FormattedMessage id="settings.reminders.add" defaultMessage="Add lead time" />
            </Button>
            {draftError && <StatusNote status="error" detail={draftError} />}
          </form>
        )}
      </div>
    </SettingsCard>
  );
}
