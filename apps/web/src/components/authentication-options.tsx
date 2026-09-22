// SPDX-License-Identifier: AGPL-3.0-only

/** Shared Legal and Business authentication-policy controls for setup and Settings (TECH-008). */

import { useId } from "react";
import { defineMessages, FormattedMessage } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

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
  return (
    <div className="flex flex-col gap-3">
      {(["password", "magicLink", "sso", "requireTwoFactor"] as const).map((method) => (
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
          <Switch
            id={`${id}-${method}`}
            checked={value[method]}
            disabled={disabled || (method === "sso" && !ssoConfigured && !value.sso)}
            onCheckedChange={(checked) => onChange({ ...value, [method]: checked })}
          />
        </div>
      ))}
    </div>
  );
}
