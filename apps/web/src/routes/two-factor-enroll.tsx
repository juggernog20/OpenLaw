// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TOTP enrolment (and disable) for the signed-in user. Three steps:
 * confirm the password, scan the QR and prove the first code (the
 * factor only arms once proven — a half-finished enrolment never
 * challenges a sign-in), then save the backup codes, which are shown
 * this once and never again.
 */

import { useState, type FormEvent } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { authClient } from "../lib/auth-client";
import { networkError } from "../lib/messages";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PageTitle } from "../components/page-title";
import { BackupCodes, TotpQr } from "../components/two-factor";

export async function enrollLoader() {
  const { data } = await authClient.getSession();
  if (!data) return redirect("/auth/login");
  return { twoFactorEnabled: data.user.twoFactorEnabled === true };
}

type Step =
  | { name: "password" }
  | { name: "verify"; totpURI: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[] }
  | { name: "enabled" };

export function TwoFactorEnrollPage() {
  const loaded = useLoaderData<typeof enrollLoader>() as Exclude<
    Awaited<ReturnType<typeof enrollLoader>>,
    Response
  >;
  const intl = useIntl();
  const [step, setStep] = useState<Step>(
    loaded.twoFactorEnabled ? { name: "enabled" } : { name: "password" },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrongPassword = () =>
    setError(
      intl.formatMessage({
        id: "auth.enroll.error.password",
        defaultMessage: "Check your password.",
      }),
    );

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.twoFactor.enable({ password });
      if (res.error || !res.data) {
        wrongPassword();
        return;
      }
      // From better-auth 1.7 the answer says which second factor it
      // enrolled. TOTP is the only one this install can return — the
      // e-mail OTP fallback is deliberately not configured (no sendOTP,
      // TECH-008) — so anything else is a misconfiguration, not a state
      // this screen can walk the user through.
      if (res.data.method !== "totp") {
        setError(networkError(intl));
        return;
      }
      setStep({ name: "verify", totpURI: res.data.totpURI, backupCodes: res.data.backupCodes });
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    if (step.name !== "verify") return;
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setError(
          intl.formatMessage({
            id: "auth.enroll.error.code",
            defaultMessage: "Wrong code. Scan the QR code again and retry.",
          }),
        );
        return;
      }
      setStep({ name: "codes", backupCodes: step.backupCodes });
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.twoFactor.disable({ password });
      if (res.error) {
        wrongPassword();
        return;
      }
      setStep({ name: "password" });
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {/* Distinct from the challenge screen's title (DES-011: unique per screen). */}
      <PageTitle
        title={intl.formatMessage({
          id: "auth.enroll.pageTitle",
          defaultMessage: "Two-factor enrollment",
        })}
      />
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.enroll.title" defaultMessage="Two-factor authentication" />
        </CardTitle>
        {step.name === "password" && (
          <CardDescription>
            <FormattedMessage
              id="auth.enroll.passwordHint"
              defaultMessage="Confirm your password to start enrollment."
            />
          </CardDescription>
        )}
        {step.name === "verify" && (
          <CardDescription>
            <FormattedMessage
              id="auth.enroll.verifyHint"
              defaultMessage="Scan the QR code with your authenticator app, then enter the code it shows."
            />
          </CardDescription>
        )}
        {step.name === "codes" && (
          <CardDescription>
            <FormattedMessage
              id="auth.enroll.codesHint"
              defaultMessage="Two-factor authentication is on. Save these backup codes somewhere safe — each works once, and they are shown only now."
            />
          </CardDescription>
        )}
        {step.name === "enabled" && (
          <CardDescription>
            <FormattedMessage
              id="auth.enroll.enabledHint"
              defaultMessage="Two-factor authentication is on for your account."
            />
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert variant="danger">{error}</Alert>}

        {step.name === "password" && (
          <form className="flex flex-col gap-4" onSubmit={(e) => void enable(e)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">
                <FormattedMessage id="auth.field.password" defaultMessage="Password" />
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="auth.enroll.enable" defaultMessage="Turn on two-factor" />
            </Button>
          </form>
        )}

        {step.name === "verify" && (
          <>
            <TotpQr totpURI={step.totpURI} />
            <form className="flex flex-col gap-4" onSubmit={(e) => void verify(e)}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">
                  <FormattedMessage id="auth.twoFactor.totpField" defaultMessage="Code" />
                </Label>
                <Input
                  id="code"
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                />
              </div>
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="auth.enroll.confirm" defaultMessage="Confirm" />
              </Button>
            </form>
          </>
        )}

        {step.name === "codes" && (
          <BackupCodes codes={step.backupCodes}>
            <Button asChild variant="link">
              <Link to="/">
                <FormattedMessage id="action.done" defaultMessage="Done" />
              </Link>
            </Button>
          </BackupCodes>
        )}

        {step.name === "enabled" && (
          <form className="flex flex-col gap-4" onSubmit={(e) => void disable(e)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">
                <FormattedMessage
                  id="auth.enroll.disablePassword"
                  defaultMessage="Confirm your password to turn it off"
                />
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              <FormattedMessage id="auth.enroll.disable" defaultMessage="Turn off two-factor" />
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
