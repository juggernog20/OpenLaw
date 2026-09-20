// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { aiPresetLabel } from "../lib/ai-presets";
import { AiKeyStatus } from "./ai-key-status";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

type Connector =
  paths["/api/v1/ai-connector"]["get"]["responses"][200]["content"]["application/json"]["connector"];

/** Used in both AI analysis forms; callers key this by the pending destination's Saved key. */
export function AiSavedKeyControl({
  savedKey,
  onChanged,
}: Readonly<{
  savedKey: Connector["savedKeys"][number];
  onChanged: (connector: Connector) => void;
}>) {
  const intl = useIntl();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forgetting = useRef(false);

  async function forget() {
    if (forgetting.current || savedKey.inUse) return;
    forgetting.current = true;
    setBusy(true);
    setError(null);
    const fallback = intl.formatMessage({
      id: "settings.aiAnalysis.forgetFailed",
      defaultMessage: "The Saved key could not be forgotten. Try again.",
    });
    try {
      const result = await api.DELETE("/api/v1/ai-connector/saved-keys/{id}", {
        params: { path: { id: savedKey.id } },
      });
      if (result.data) onChanged(result.data.connector);
      else setError((await problem(result)).detail ?? fallback);
    } catch {
      setError(fallback);
    } finally {
      setConfirming(false);
      setBusy(false);
      forgetting.current = false;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AiKeyStatus inUse={savedKey.inUse} />
      {!savedKey.inUse && (
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <FormattedMessage id="settings.aiAnalysis.forgetKey" defaultMessage="Forget key" />
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirming(false)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>
              <FormattedMessage
                id="settings.aiAnalysis.forgetTitle"
                defaultMessage="Forget the Saved key"
              />
            </DialogTitle>
            <div className="mt-4 flex flex-col gap-4">
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="settings.aiAnalysis.forgetBody"
                  defaultMessage="Forget the Saved key for {provider} at {baseUrl}? Paste it again if you want to use it later."
                  values={{
                    provider: aiPresetLabel(intl, savedKey.preset),
                    baseUrl: savedKey.baseUrl,
                  }}
                />
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void forget()}
                >
                  <FormattedMessage
                    id="settings.aiAnalysis.forgetKey"
                    defaultMessage="Forget key"
                  />
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
