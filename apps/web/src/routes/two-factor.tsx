// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TOTP challenge: reached when password sign-in answers with
 * `twoFactorRedirect` instead of a session. The challenge state lives in
 * an httpOnly cookie the page cannot inspect, so there is no loader
 * guard — a cold visit simply fails verification with the same copy.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { authClient } from "../lib/auth-client";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function TwoFactorPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setError(null);
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (res.error) {
      if (res.error.status === 429) {
        setError(
          intl.formatMessage({
            id: "auth.twoFactor.error.locked",
            defaultMessage: "Too many attempts. Wait 15 minutes, then try again.",
          }),
        );
      } else {
        setError(
          intl.formatMessage({
            id: "auth.twoFactor.error.wrongCode",
            defaultMessage: "Wrong code. Try again, or restart sign-in.",
          }),
        );
      }
      return;
    }
    void navigate("/");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.twoFactor.title" defaultMessage="Two-factor authentication" />
        </CardTitle>
        <CardDescription>
          {useBackup ? (
            <FormattedMessage
              id="auth.twoFactor.backupHint"
              defaultMessage="Enter one of your backup codes. Each works once."
            />
          ) : (
            <FormattedMessage
              id="auth.twoFactor.totpHint"
              defaultMessage="Enter the 6-digit code from your authenticator app."
            />
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert variant="danger">{error}</Alert>}
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">
              {useBackup ? (
                <FormattedMessage id="auth.twoFactor.backupField" defaultMessage="Backup code" />
              ) : (
                <FormattedMessage id="auth.twoFactor.totpField" defaultMessage="Code" />
              )}
            </Label>
            <Input
              id="code"
              name="code"
              autoComplete="one-time-code"
              inputMode={useBackup ? "text" : "numeric"}
              required
              autoFocus
            />
          </div>
          <Button type="submit" disabled={busy}>
            <FormattedMessage id="auth.twoFactor.submit" defaultMessage="Verify" />
          </Button>
        </form>
        <Button
          variant="link"
          className="self-start"
          onClick={() => {
            setError(null);
            setUseBackup((v) => !v);
          }}
        >
          {useBackup ? (
            <FormattedMessage
              id="auth.twoFactor.useTotp"
              defaultMessage="Use your authenticator app"
            />
          ) : (
            <FormattedMessage id="auth.twoFactor.useBackup" defaultMessage="Use a backup code" />
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
