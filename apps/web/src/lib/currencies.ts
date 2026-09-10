// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { problem } from "./problem";

export type CurrencySettings = { currencies: string[]; canManage: boolean };
const CHANGED = "openlaw:currencies-changed";

export function notifyCurrenciesChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** Mounted pickers refresh together after a settings change or an inline addition. */
export function useCurrencies() {
  const [settings, setSettings] = useState<CurrencySettings>({ currencies: [], canManage: false });
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await api.GET("/api/v1/org/currencies", { signal: controller.signal }).catch(() => undefined);
      if (controller.signal.aborted) return;
      if (result?.data) { setSettings(result.data); setError(undefined); }
      else setError((await problem(result)).detail);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [attempt]);
  return { ...settings, error, loading, reload };
}
