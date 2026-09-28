// SPDX-License-Identifier: AGPL-3.0-only

/** Shared Legal and Business authentication-policy controls for setup and Settings (TECH-008). */

import { useId } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Tooltip } from "./ui/tooltip";

export type AuthenticationOptions =
  paths["/api/v1/auth/methods"]["get"]["responses"][200]["content"]["application/json"]["policy"]["legal"];

const labels = defineMessages({
  password: { id: "settings.auth.method.password", defaultMessage: "Email and password" },
  magicLink: { id: "settings.auth.method.magicLink", defaultMessage: "Email magic link" },
  sso: { id: "settings.auth.method.sso", defaultMessage: "Single sign-on (SSO)" },
  requireTwoFactor: {
    id: "settings.auth.requireTwoFactor",
    defaultMessage: "Require two-factor authentication",
  },
});
export function AuthenticationOptionsFields({
  value,
  onChange,
  disabled = false,
  ssoConfigured,
}: {
  value: AuthenticationOptions;
  onChange: (value: AuthenticationOptions) => void;
  disabled?: boolean;
  ssoConfigured: boolean;
}) {
  const id = useId();
  const intl = useIntl();
  return (
    <div className="flex flex-col gap-3">
      {(["password", "magicLink", "sso", "requireTwoFactor"] as const).map((method) => {
        const missingProvider = method === "sso" && !ssoConfigured;
        const reason = missingProvider
          ? intl.formatMessage({
              id: "settings.auth.configureSso",
              defaultMessage: "Configure an identity provider below to enable single sign-on.",
            })
          : disabled
            ? intl.formatMessage({
                id: "settings.auth.waitForSave",
                defaultMessage: "Wait for the current changes to finish saving.",
              })
            : undefined;
        const reasonId = `${id}-${method}-disabled-reason`;
        const control = (
          <Switch
            id={`${id}-${method}`}
            checked={value[method] && (method !== "sso" || ssoConfigured)}
            disabled={!!reason}
            aria-describedby={reason ? reasonId : undefined}
            onCheckedChange={(checked) => onChange({ ...value, [method]: checked })}
          />
        );
        return (
          <div key={method} className="flex items-center justify-between gap-4">
            <Label
              htmlFor={`${id}-${method}`}
              help={
                method === "sso" && !ssoConfigured ? (
                  <FormattedMessage
                    id="settings.auth.configureSso"
                    defaultMessage="Configure an identity provider below to enable single sign-on."
                  />
                ) : method === "requireTwoFactor" ? (
                  <FormattedMessage
                    id="settings.auth.factorAllMethods"
                    defaultMessage="An authenticator app is required with every enabled sign-in method. Users must complete setup before accessing OpenLaw."
                  />
                ) : undefined
              }
            >
              <FormattedMessage {...labels[method]} />
            </Label>
            <span id={reasonId} className="sr-only">
              {reason}
            </span>
            <Tooltip content={reason} open={reason ? undefined : false}>
              <span
                role={reason ? "group" : undefined}
                tabIndex={reason ? 0 : undefined}
                aria-label={reason ? intl.formatMessage(labels[method]) : undefined}
                aria-describedby={reason ? reasonId : undefined}
                className={`inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link ${reason ? "cursor-not-allowed [&>button]:pointer-events-none" : ""}`}
              >
                {control}
              </span>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
