// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · General (#63), from the ST4 frame of settings.pen: the
 * Organization card — name, logo, and the locale/timezone defaults on
 * the single org_settings row. Every field commits individually the
 * moment it is confirmed (DES-017: blur/Enter commits, Esc reverts, no
 * Save chrome), with the saving/saved/error micro-states beside it. The
 * loader is the client half of SET-002's gate: non-Administrators
 * bounce to their own settings home; the API's 403 is the real refusal.
 */

import { useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { problem, type ProblemResult } from "../lib/problem";
import { requireUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { TimezonePicker } from "../components/timezone-picker";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsGeneralLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/org/general");
  if (!data) throw new Error("The organization settings could not be read.");
  return { general: data.general };
}

/** The GET/PATCH /org/general envelope's payload, as the client sees it. */
interface General {
  name: string;
  logo: string | null;
  defaultLocale: "en-US";
  defaultTimezone: string;
}

/** One PATCH per committed field (DES-017); resolves to the saved row,
 * or the refusal's own sentence when the API sent one. */
async function patchGeneral(body: {
  name?: string;
  logo?: string | null;
  defaultLocale?: "en-US";
  defaultTimezone?: string;
}): Promise<ProblemResult<General>> {
  const result = await api.PATCH("/api/v1/org/general", { body }).catch(() => undefined);
  return { data: result?.data?.general, ...(await problem(result)) };
}

/** ~256 KB of image; matches the API's cap on the encoded data: URI. */
const LOGO_BYTE_LIMIT = 256 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const selectClassName =
  "h-8 w-80 max-w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50";

export function SettingsGeneralPage() {
  const { general } = useLoaderData<typeof settingsGeneralLoader>();
  const intl = useIntl();

  const [saved, setSaved] = useState<General>(general);
  const [nameDraft, setNameDraft] = useState(saved.name);
  const [status, setStatus] = useState<Record<keyof General, FieldStatus>>({
    name: "idle",
    logo: "idle",
    defaultLocale: "idle",
    defaultTimezone: "idle",
  });
  const [detail, setDetail] = useState<Record<keyof General, string | undefined>>({
    name: undefined,
    logo: undefined,
    defaultLocale: undefined,
    defaultTimezone: undefined,
  });
  const fileInput = useRef<HTMLInputElement>(null);

  async function commit(field: keyof General, body: Parameters<typeof patchGeneral>[0]) {
    setStatus((s) => ({ ...s, [field]: "saving" }));
    const { data: next, detail: message } = await patchGeneral(body);
    if (next) setSaved(next);
    setStatus((s) => ({ ...s, [field]: next ? "saved" : "error" }));
    setDetail((s) => ({ ...s, [field]: next ? undefined : message }));
    return next;
  }

  function commitName() {
    const name = nameDraft.trim();
    if (name === saved.name || name === "") {
      // Nothing to save (or nothing valid): revert per DES-017.
      setNameDraft(saved.name);
      return;
    }
    void commit("name", { name }).then((next) => {
      if (next) setNameDraft(next.name);
    });
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_BYTE_LIMIT) {
      setStatus((s) => ({ ...s, logo: "error" }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => void commit("logo", { logo: reader.result as string });
    reader.onerror = () => setStatus((s) => ({ ...s, logo: "error" }));
    reader.readAsDataURL(file);
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({ id: "settings.section.general", defaultMessage: "General" })}
      />
      <SettingsCard
        title={
          <FormattedMessage id="settings.general.organization" defaultMessage="Organization" />
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-name">
            <FormattedMessage id="settings.general.name" defaultMessage="Organization name" />
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="org-name"
              className="w-80"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") setNameDraft(saved.name);
              }}
            />
            <StatusNote status={status.name} detail={detail.name} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-primary">
            <FormattedMessage id="settings.general.logo" defaultMessage="Logo" />
          </span>
          <div className="flex items-center gap-3">
            {saved.logo ? (
              <img
                src={saved.logo}
                alt=""
                className="size-10 rounded-button border border-border-default object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-button bg-control text-lg font-semibold text-primary"
              >
                {(saved.name || "O").charAt(0).toUpperCase()}
              </span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={LOGO_TYPES.join(",")}
              // Visually hidden but still in the accessibility tree, so
              // it carries its own name (the Upload button drives it).
              aria-label={intl.formatMessage({
                id: "settings.general.uploadLogo",
                defaultMessage: "Upload a logo",
              })}
              className="sr-only"
              onChange={(event) => {
                uploadLogo(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
              <FormattedMessage id="settings.general.upload" defaultMessage="Upload" />
            </Button>
            <StatusNote status={status.logo} detail={detail.logo} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-locale">
            <FormattedMessage id="settings.general.locale" defaultMessage="Default locale" />
          </Label>
          <div className="flex items-center gap-2">
            <select
              id="org-locale"
              className={selectClassName}
              value={saved.defaultLocale}
              onChange={(event) =>
                void commit("defaultLocale", {
                  defaultLocale: event.target.value as General["defaultLocale"],
                })
              }
            >
              <option value="en-US">
                {intl.formatMessage({
                  id: "settings.general.locale.enUS",
                  defaultMessage: "English (United States)",
                })}
              </option>
            </select>
            <StatusNote status={status.defaultLocale} detail={detail.defaultLocale} />
          </div>
          {/* One option today is honest, not broken: DES-013 ships
                en-US alone, and the select comes alive with locale #2. */}
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.general.locale.hint"
              defaultMessage="English (United States) is the only available locale for now."
            />
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-timezone">
            <FormattedMessage id="settings.general.timezone" defaultMessage="Default timezone" />
          </Label>
          <div className="flex items-center gap-2">
            <TimezonePicker
              id="org-timezone"
              value={saved.defaultTimezone}
              onCommit={(zone) => {
                if (zone) void commit("defaultTimezone", { defaultTimezone: zone });
              }}
            />
            <StatusNote status={status.defaultTimezone} detail={detail.defaultTimezone} />
          </div>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.general.timezone.hint"
              defaultMessage="Used for the daily digest and date displays until a user signs in."
            />
          </p>
        </div>
      </SettingsCard>
    </>
  );
}
