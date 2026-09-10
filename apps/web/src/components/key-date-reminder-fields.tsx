// SPDX-License-Identifier: AGPL-3.0-only

/** Add and Edit Key-date reminder controls, including NOT-004’s global and own ladders. */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { useRecord } from "./record-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

export interface KeyDateReminderDraft {
  reminderOffsetDays: number[];
  reminderRecipientIds: string[];
}
interface Options {
  globalOffsetDays: number[];
  recipients: { id: string; displayName: string }[];
}

export function KeyDateReminderFields({
  value,
  onChange,
}: Readonly<{
  value: KeyDateReminderDraft;
  onChange: (value: KeyDateReminderDraft) => void;
}>) {
  const { record } = useRecord();
  const intl = useIntl();
  const [options, setOptions] = useState<Options | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [offset, setOffset] = useState("");
  useEffect(() => {
    let active = true;
    const path =
      record.kind === "contract"
        ? ("/api/v1/contracts/{number}/key-date-reminder-options" as const)
        : ("/api/v1/matters/{number}/key-date-reminder-options" as const);
    void api
      .GET(path, { params: { path: { number: record.number } } })
      .then(({ data }) => {
        if (active) {
          setOptions(data ?? null);
          setFailed(!data);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [record.kind, record.number, retry]);
  const label = (days: number) =>
    intl.formatMessage(
      {
        id: "settings.reminders.offset",
        defaultMessage: "{days, plural, =0 {On the day} one {# day before} other {# days before}}",
      },
      { days },
    );
  const validOffset =
    offset.trim() !== "" &&
    Number.isInteger(Number(offset)) &&
    Number(offset) >= 0 &&
    Number(offset) <= 730;
  const ladder = [
    ...new Set([...(options?.globalOffsetDays ?? []), ...value.reminderOffsetDays]),
  ].sort((a, b) => b - a);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">
        <FormattedMessage id="keyDates.reminders.title" defaultMessage="Reminders" />
      </legend>
      {options ? (
        <>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="keyDates.reminders.global"
              defaultMessage="Global reminders: {ladder}"
              values={{ ladder: options.globalOffsetDays.map(label).join(", ") }}
            />
          </p>
          <p className="text-sm" aria-live="polite">
            <FormattedMessage
              id="keyDates.reminders.effective"
              defaultMessage="This date will remind: {ladder}"
              values={{ ladder: ladder.map(label).join(", ") }}
            />
          </p>
        </>
      ) : failed ? (
        <div role="alert">
          <FormattedMessage
            id="keyDates.reminders.loadFailed"
            defaultMessage="The current reminder ladder and team could not be loaded."
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFailed(false);
              setRetry(retry + 1);
            }}
          >
            <FormattedMessage id="action.retry" defaultMessage="Retry" />
          </Button>
        </div>
      ) : (
        <p role="status">
          <FormattedMessage
            id="keyDates.reminders.loading"
            defaultMessage="Loading reminder ladder and team…"
          />
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="key-date-offset">
          <FormattedMessage
            id="keyDates.reminders.addOffset"
            defaultMessage="Additional lead time (days before)"
          />
        </Label>
        <div className="flex gap-2">
          <Input
            id="key-date-offset"
            type="number"
            min={0}
            max={730}
            step={1}
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!validOffset || value.reminderOffsetDays.length >= 20}
            onClick={() => {
              onChange({
                ...value,
                reminderOffsetDays: [...new Set([...value.reminderOffsetDays, Number(offset)])],
              });
              setOffset("");
            }}
          >
            <FormattedMessage id="keyDates.reminders.add" defaultMessage="Add lead time" />
          </Button>
        </div>
      </div>
      {value.reminderOffsetDays.map((days) => (
        <div key={days} className="flex items-center justify-between text-sm">
          <span>{label(days)}</span>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              onChange({
                ...value,
                reminderOffsetDays: value.reminderOffsetDays.filter((held) => held !== days),
              })
            }
            aria-label={intl.formatMessage(
              { id: "keyDates.reminders.remove", defaultMessage: "Remove {offset}" },
              { offset: label(days) },
            )}
          >
            <FormattedMessage id="action.remove" defaultMessage="Remove" />
          </Button>
        </div>
      ))}
      <p className="text-sm text-muted">
        <FormattedMessage
          id="keyDates.reminders.recipientHelp"
          defaultMessage="With no selection, reminders go to the Owner or Matter Manager and record team. Select people to send this Key date's reminders only to them. Current access and personal preferences still apply."
        />
      </p>
      {options?.recipients.map((person) => (
        <label key={person.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.reminderRecipientIds.includes(person.id)}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                reminderRecipientIds:
                  checked === true
                    ? [...value.reminderRecipientIds, person.id]
                    : value.reminderRecipientIds.filter((id) => id !== person.id),
              })
            }
          />
          {person.displayName}
        </label>
      ))}
      {value.reminderRecipientIds.some(
        (id) => options && !options.recipients.some((person) => person.id === id),
      ) && (
        <p role="status" className="text-sm text-muted">
          <FormattedMessage
            id="keyDates.reminders.departed"
            defaultMessage="Some selected recipients have left the team and will not be reminded."
          />
          {value.reminderRecipientIds.some((id) =>
            options?.recipients.some((person) => person.id === id),
          ) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...value,
                  reminderRecipientIds: value.reminderRecipientIds.filter((id) =>
                    options?.recipients.some((person) => person.id === id),
                  ),
                })
              }
            >
              <FormattedMessage
                id="keyDates.reminders.removeUnavailable"
                defaultMessage="Remove unavailable recipients"
              />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ ...value, reminderRecipientIds: [] })}
          >
            <FormattedMessage
              id="keyDates.reminders.reset"
              defaultMessage="Use the usual audience"
            />
          </Button>
        </p>
      )}
    </fieldset>
  );
}
