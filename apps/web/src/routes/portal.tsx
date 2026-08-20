// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal home (INT-001), from the I5 frame of intake.pen: where a
 * redeemed magic link lands.
 *
 * The loader gates on a session and nothing else. A Business User is
 * routed here from the staff application (see `homeLoader`), and Member+
 * staff are admitted rather than turned away — staff ask legal questions
 * too, and on this surface they are a Requester like anybody else.
 *
 * The body is the request type picker and the my-requests list; both
 * arrive with their own builds. This slice is the shell they hang in.
 */

import { redirect, useLoaderData, useNavigate } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { authClient } from "../lib/auth-client";
import { currentUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { PortalShell } from "../components/portal/portal-shell";
import { Card, CardContent } from "../components/ui/card";

export async function portalHomeLoader() {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  return { user };
}

const TITLE = defineMessage({
  id: "portal.home.title",
  defaultMessage: "What do you need from Legal?",
});

export function PortalHomePage() {
  const { user } = useLoaderData<typeof portalHomeLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    void navigate("/portal/enter", { replace: true });
  }

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(TITLE)} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage {...TITLE} />
        </h1>
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.home.lead"
            defaultMessage="Pick a request type — the form collects what Legal needs to get started."
          />
        </p>
      </div>
      {/* The picker's empty state, standing alone until the picker
          itself lands. It is not a placeholder: an instance whose
          Administrator has archived every request type says exactly
          this, and so does one that has configured none yet. */}
      <Card>
        <CardContent className="text-md text-muted">
          <FormattedMessage
            id="portal.home.noTypes"
            defaultMessage="No request types are available yet. Ask your legal team to open one."
          />
        </CardContent>
      </Card>
    </PortalShell>
  );
}
