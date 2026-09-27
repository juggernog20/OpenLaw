// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run setup: creates the initial Administrator while the instance
 * is empty. The server holds the real invariant (advisory-locked,
 * answers 409 forever after); this screen just fronts it and gets out
 * of the way once a user exists.
 */

import { useEffect, useState, type ComponentProps, type FormEvent } from "react";
import { Check } from "lucide-react";
import { z } from "zod";
import { Link, redirect, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { networkError } from "../lib/messages";
import { needsSetup } from "../lib/session";
import { clearSetupDrafts, useSetupDraft } from "../lib/setup-drafts";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PageTitle } from "../components/page-title";

const emptyDraft = {
  setupToken: "",
  displayName: "",
  email: "",
  password: "",
  confirm: "",
};

const emailSchema = z.email();

function SetupInput({
  valid,
  status,
  ...props
}: ComponentProps<typeof Input> & { valid: boolean; status?: string }) {
  const intl = useIntl();
  const description =
    status ?? intl.formatMessage({ id: "auth.setup.validValue", defaultMessage: "Valid value" });
  return (
    <div className="relative">
      <Input
        {...props}
        className="pr-9"
        aria-describedby={valid ? `${props.id}-valid` : undefined}
      />
      {valid && (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-status-success-fg">
          <Check size={16} aria-hidden="true" />
          <span id={`${props.id}-valid`} className="sr-only">
            {description}
          </span>
        </span>
      )}
    </div>
  );
}

export async function setupLoader() {
  if (!(await needsSetup())) {
    clearSetupDrafts("administrator");
    return redirect("/auth/login");
  }
  return null;
}

export function SetupPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useSetupDraft("administrator", "fields", emptyDraft);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);

  useEffect(() => {
    const token = draft.setupToken.trim();
    if (!token || token.length > 200) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api
        .POST("/api/v1/auth/setup/validate-token", {
          body: { setupToken: token },
          signal: controller.signal,
        })
        .then(({ data }) => {
          if (!controller.signal.aborted) {
            setVerifiedToken(data?.valid ? draft.setupToken : null);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setVerifiedToken(null);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft.setupToken]);

  function updateDraft(field: keyof typeof emptyDraft, value: string) {
    if (field === "setupToken") setVerifiedToken(null);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function clearDraft() {
    setVerifiedToken(null);
    setDraft({ ...emptyDraft });
    clearSetupDrafts("administrator");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError(
        intl.formatMessage({
          id: "auth.setPassword.error.mismatch",
          defaultMessage: "The passwords do not match.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { response, error: problem } = await api.POST("/api/v1/auth/setup", {
        body: {
          email: String(form.get("email") ?? ""),
          displayName: String(form.get("displayName") ?? ""),
          password,
          setupToken: String(form.get("setupToken") ?? "").trim(),
        },
      });
      if (response.status === 201) {
        clearDraft();
        // The response set the session cookie; the fresh Administrator
        // lands in the SET-004 onboarding wizard. Replace, so Back does
        // not step onto the now-disabled setup screen.
        void navigate("/welcome", { replace: true });
        return;
      }
      if (response.status === 409) {
        clearDraft();
        setAlreadyDone(true);
        return;
      }
      setError(
        (problem as { detail?: string } | undefined)?.detail ??
          intl.formatMessage({
            id: "auth.setup.error.generic",
            defaultMessage: "Setup failed. Try again.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <PageTitle
        title={intl.formatMessage({ id: "auth.setup.pageTitle", defaultMessage: "Set up" })}
      />
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.setup.title" defaultMessage="Set up OpenLaw" />
        </CardTitle>
        <CardDescription>
          <FormattedMessage
            id="auth.setup.hint"
            defaultMessage="Create the first Administrator account. This screen disables itself once a user exists."
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {alreadyDone && (
          <Alert variant="info">
            <FormattedMessage
              id="auth.setup.alreadyDone"
              defaultMessage="Setup has already been completed."
            />{" "}
            <Link className="text-link underline-offset-4 hover:underline" to="/auth/login">
              <FormattedMessage id="auth.login.title" defaultMessage="Sign in" />
            </Link>
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="setupToken"
              required
              help={
                <>
                  <FormattedMessage
                    id="auth.setup.tokenHint"
                    defaultMessage="Use the value of SETUP_TOKEN. If it is not set, use the token the server printed at first start, shown by docker compose logs app under Compose."
                  />
                </>
              }
            >
              <FormattedMessage id="auth.setup.token" defaultMessage="Setup token" />
            </Label>
            <SetupInput
              id="setupToken"
              valid={draft.setupToken.length > 0 && verifiedToken === draft.setupToken}
              status={intl.formatMessage({
                id: "auth.setup.tokenVerified",
                defaultMessage: "Setup token verified",
              })}
              name="setupToken"
              value={draft.setupToken}
              onChange={(event) => updateDraft("setupToken", event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">
              <FormattedMessage id="auth.field.displayName" defaultMessage="Name" />
            </Label>
            <SetupInput
              id="displayName"
              valid={draft.displayName.trim().length > 0}
              name="displayName"
              value={draft.displayName}
              onChange={(event) => updateDraft("displayName", event.target.value)}
              autoComplete="name"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">
              <FormattedMessage id="auth.field.email" defaultMessage="Email" />
            </Label>
            <SetupInput
              id="email"
              valid={emailSchema.safeParse(draft.email).success}
              name="email"
              value={draft.email}
              onChange={(event) => updateDraft("email", event.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">
              <FormattedMessage id="auth.field.password" defaultMessage="Password" />
            </Label>
            <SetupInput
              id="password"
              valid={draft.password.length >= 8}
              name="password"
              value={draft.password}
              onChange={(event) => updateDraft("password", event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">
              <FormattedMessage
                id="auth.setPassword.confirmPassword"
                defaultMessage="Confirm password"
              />
            </Label>
            <SetupInput
              id="confirm"
              valid={draft.confirm.length >= 8 && draft.confirm === draft.password}
              name="confirm"
              value={draft.confirm}
              onChange={(event) => updateDraft("confirm", event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" disabled={busy || alreadyDone}>
            <FormattedMessage id="auth.setup.submit" defaultMessage="Create Administrator" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
