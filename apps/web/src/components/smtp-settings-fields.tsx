// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const ports = { starttls: "587", tls: "465", none: "25" } as const;
const selectClassName =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

export function SmtpSettingsFields({ disabled }: { disabled: boolean }) {
  const [security, setSecurity] = useState<keyof typeof ports>("starttls");
  const [port, setPort] = useState<string>(ports.starttls);
  const [authentication, setAuthentication] = useState("password");

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="smtpHost">
            <FormattedMessage id="welcome.email.field.host" defaultMessage="SMTP server" />
          </Label>
          <Input
            id="smtpHost"
            name="smtpHost"
            autoComplete="off"
            required
            maxLength={253}
            placeholder="smtp.example.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="smtpPort">
            <FormattedMessage id="welcome.email.field.port" defaultMessage="Port" />
          </Label>
          <Input
            id="smtpPort"
            name="smtpPort"
            type="number"
            required
            min={1}
            max={65535}
            step={1}
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="smtpSecurity">
          <FormattedMessage
            id="welcome.email.field.security"
            defaultMessage="Connection security"
          />
        </Label>
        <select
          id="smtpSecurity"
          name="smtpSecurity"
          className={selectClassName}
          value={security}
          onChange={(event) => {
            const next = event.target.value as keyof typeof ports;
            if (port === ports[security]) setPort(ports[next]);
            setSecurity(next);
          }}
        >
          <option value="starttls">STARTTLS</option>
          <option value="tls">TLS</option>
          <option value="none">
            <FormattedMessage id="welcome.email.security.none" defaultMessage="None" />
          </option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="smtpAuthentication">
          <FormattedMessage
            id="welcome.email.field.authentication"
            defaultMessage="Authentication"
          />
        </Label>
        <select
          id="smtpAuthentication"
          name="smtpAuthentication"
          className={selectClassName}
          value={authentication}
          onChange={(event) => setAuthentication(event.target.value)}
        >
          <option value="password">
            <FormattedMessage
              id="welcome.email.authentication.password"
              defaultMessage="Username and password"
            />
          </option>
          <option value="none">
            <FormattedMessage id="welcome.email.authentication.none" defaultMessage="None" />
          </option>
        </select>
      </div>
      {authentication === "password" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smtpUsername">
              <FormattedMessage id="welcome.email.field.username" defaultMessage="SMTP username" />
            </Label>
            <Input
              id="smtpUsername"
              name="smtpUsername"
              autoComplete="off"
              required
              maxLength={1024}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smtpPassword">
              <FormattedMessage id="welcome.email.field.password" defaultMessage="SMTP password" />
            </Label>
            <Input
              id="smtpPassword"
              name="smtpPassword"
              type="password"
              autoComplete="new-password"
              required
              maxLength={4096}
            />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="smtpSenderName">
          <FormattedMessage
            id="welcome.email.field.senderName"
            defaultMessage="Sender name (optional)"
          />
        </Label>
        <Input id="smtpSenderName" name="smtpSenderName" autoComplete="off" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="smtpSenderEmail">
          <FormattedMessage id="welcome.email.field.senderEmail" defaultMessage="Sender email" />
        </Label>
        <Input
          id="smtpSenderEmail"
          name="smtpSenderEmail"
          type="email"
          autoComplete="off"
          required
          maxLength={254}
        />
      </div>
    </fieldset>
  );
}
