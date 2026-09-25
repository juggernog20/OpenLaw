// SPDX-License-Identifier: AGPL-3.0-only
import { Link, redirect } from "react-router";
import { FormattedMessage } from "react-intl";
import { currentUser } from "../lib/session";
import { api } from "../lib/api";

export async function signingReturnLoader() {
  let user;
  try {
    user = await currentUser();
  } catch (error) {
    if (error instanceof Response) {
      const target = error.headers.get("Location");
      if (target?.startsWith("/auth/two-factor")) {
        const destination = new URL(target, window.location.origin);
        destination.searchParams.set("oauth_query", "signing_return=1");
        throw redirect(destination.pathname + destination.search);
      }
    }
    throw error;
  }
  if (!user) return redirect("/auth/login?signing_return=1");
  const result = await api.POST("/api/v1/signing/return").catch(() => undefined);
  if (result?.data) return redirect(result.data.destination);
  return null;
}

export function SigningReturnPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold text-primary">
        <FormattedMessage
          id="signing.returnUnavailable"
          defaultMessage="This signing return is unavailable"
        />
      </h1>
      <p className="mt-4 text-base text-primary">
        <FormattedMessage
          id="signing.returnHelp"
          defaultMessage="Open the Contract from Signatures to see its confirmed status."
        />
      </p>
      <Link to="/" className="mt-4 inline-block text-primary underline">
        <FormattedMessage id="signing.returnHome" defaultMessage="Go to Home" />
      </Link>
    </main>
  );
}
