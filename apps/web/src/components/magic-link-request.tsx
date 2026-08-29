// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The email step of magic-link sign-in (DD-010), as one card: a work
 * address in, and the same neutral "check your email" answer out.
 *
 * The answer is deliberately identical whether or not the address is on
 * the Administrator's domain allowlist — the issuance API already
 * answers 202 either way, and a screen that said more would hand an
 * anonymous visitor the allowlist oracle that behaviour exists to deny.
 *
 * Two screens ask the question: the portal entry screen, where a
 * Business User asks for their first link, and the dead-link page,
 * where they ask for a fresh one. Both must say the same thing, so the
 * sent state lives here rather than in either caller.
 */

import { useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { defineMessages, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { api } from "../lib/api";
import { networkError } from "../lib/messages";
import { problem as readProblem } from "../lib/problem";
import { PageTitle } from "./page-title";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const SENT = defineMessages({
  title: { id: "auth.magicSent.title", defaultMessage: "Check your email" },
});

export function MagicLinkRequest({
  title,
  description,
  footer,
}: Readonly<{
  /** The card's heading before the link is sent; also the document title. */
  title: MessageDescriptor;
  /** What this screen says above the email field. */
  description: ReactNode;
  /** Anything the screen offers below the form — a way back, usually. */
  footer?: ReactNode;
}>) {
  const intl = useIntl();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/auth/magic-link", {
        body: { email },
      });
      const { response } = result;
      if (response.status === 202) {
        setSent(true);
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "auth.login.error.magicLink",
            defaultMessage: "The link could not be sent. Try again.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <PageTitle title={intl.formatMessage(SENT.title)} />
        <CardHeader>
          <CardTitle>
            <FormattedMessage {...SENT.title} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* The submit button that had focus is gone with the form, so
              the answer has to announce itself (DES-011). */}
          <p role="status" className="text-md text-muted">
            <FormattedMessage
              id="auth.magicSent.body"
              defaultMessage="If {email} is eligible, a sign-in link is on its way. It expires in 5 minutes and works once."
              values={{ email: <span className="text-primary">{email}</span> }}
            />
          </p>
          <Button
            variant="link"
            className="self-start"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            <FormattedMessage
              id="auth.magic.useDifferentEmail"
              defaultMessage="Use a different email"
            />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <PageTitle title={intl.formatMessage(title)} />
      <CardHeader>
        <CardTitle>
          <FormattedMessage {...title} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert variant="danger">{error}</Alert>}
        <p className="text-md text-muted">{description}</p>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="magic-email">
              <FormattedMessage id="auth.field.email" defaultMessage="Email" />
            </Label>
            <Input
              id="magic-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            <FormattedMessage id="auth.magic.submit" defaultMessage="Send link" />
          </Button>
        </form>
        {footer}
      </CardContent>
    </Card>
  );
}
