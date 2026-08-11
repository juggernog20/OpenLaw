// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The TOTP enrolment display blocks, shared by the standalone enrolment
 * route (M2, /auth/two-factor/enroll) and the Profile pane's two-factor
 * card (SET-006, #67): the QR with its manual-entry fallback, and the
 * show-once backup-code grid with its copy affordance.
 */

import { useState, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, Copy } from "lucide-react";
import { renderSVG } from "uqr";
import { Button } from "./ui/button";

export function TotpQr({ totpURI }: { totpURI: string }) {
  return (
    <>
      {/* The QR stays black-on-white inside the SVG in every theme:
          scanner contrast is a functional requirement, not a design
          color, so it deliberately bypasses the token system. */}
      <div
        className="mx-auto h-44 w-44"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderSVG(totpURI) }}
      />
      <p className="text-sm text-muted">
        <FormattedMessage
          id="auth.enroll.manualEntry"
          defaultMessage="No camera? Enter this secret manually: {secret}"
          values={{
            secret: (
              <span className="break-all text-primary">
                {new URL(totpURI).searchParams.get("secret")}
              </span>
            ),
          }}
        />
      </p>
    </>
  );
}

export function BackupCodes({
  codes,
  children,
}: {
  codes: string[];
  /** Extra actions rendered beside the copy button (e.g. a Done link). */
  children?: ReactNode;
}) {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setCopyError(false);
    } catch {
      // Clipboard access can be denied (permissions policy, insecure
      // context); the codes are on screen either way.
      setCopyError(true);
    }
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-card bg-section-header p-4 text-md">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => void copyCodes()} aria-live="polite">
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? (
            <FormattedMessage id="action.copied" defaultMessage="Copied" />
          ) : (
            <FormattedMessage id="action.copy" defaultMessage="Copy" />
          )}
        </Button>
        {children}
        {copyError && (
          <span className="text-xs text-status-danger-fg" aria-live="polite">
            {intl.formatMessage({
              id: "auth.enroll.error.copy",
              defaultMessage: "Could not copy the codes. Copy them manually.",
            })}
          </span>
        )}
      </div>
    </>
  );
}
