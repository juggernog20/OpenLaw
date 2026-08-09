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
import { Check, Copy } from "lucide-react";
import { renderSVG } from "uqr";
import { authClient } from "../lib/auth-client";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
  const [copied, setCopied] = useState(false);

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
    const res = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (res.error || !res.data) {
      wrongPassword();
      return;
    }
    setStep({ name: "verify", totpURI: res.data.totpURI, backupCodes: res.data.backupCodes });
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    if (step.name !== "verify") return;
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
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
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (res.error) {
      wrongPassword();
      return;
    }
    setStep({ name: "password" });
  }

  async function copyCodes(codes: string[]) {
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.enroll.title" defaultMessage="Two-factor authentication" />
        </CardTitle>
        {step.name === "password" && (
          <CardDescription>
            <FormattedMessage
              id="auth.enroll.passwordHint"
              defaultMessage="Confirm your password to start enrolment."
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
            {/* The QR stays black-on-white inside the SVG in every theme:
                scanner contrast is a functional requirement, not a design
                color, so it deliberately bypasses the token system. */}
            <div
              className="mx-auto h-44 w-44"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: renderSVG(step.totpURI) }}
            />
            <p className="text-sm text-muted">
              <FormattedMessage
                id="auth.enroll.manualEntry"
                defaultMessage="No camera? Enter this secret manually: {secret}"
                values={{
                  secret: (
                    <span className="break-all text-primary">
                      {new URL(step.totpURI).searchParams.get("secret")}
                    </span>
                  ),
                }}
              />
            </p>
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
          <>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-card bg-section-header p-4 text-md">
              {step.backupCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => void copyCodes(step.backupCodes)}
                aria-live="polite"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? (
                  <FormattedMessage id="action.copied" defaultMessage="Copied" />
                ) : (
                  <FormattedMessage id="action.copy" defaultMessage="Copy" />
                )}
              </Button>
              <Button asChild variant="link">
                <Link to="/">
                  <FormattedMessage id="action.done" defaultMessage="Done" />
                </Link>
              </Button>
            </div>
          </>
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
