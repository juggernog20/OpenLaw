// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Placeholder shell proving the theme substrate is wired: inverted header
 * (DES-003 signature move), semantic tokens, and status colors.
 * Real application chrome arrives with the first module build.
 */

export function App() {
  return (
    <div className="min-h-screen bg-canvas text-primary">
      <header className="flex h-[62px] items-center bg-inverted px-page-x text-on-inverted">
        <span className="text-md font-semibold">OpenLaw</span>
      </header>
      <main className="px-page-x py-page-y">
        <h1 className="text-2xl font-semibold">Scaffold ready</h1>
        <p className="mt-2 text-muted">
          Vite + React + Tailwind v4 wired to the three-theme substrate in{" "}
          <code className="font-mono text-sm">styles/</code>.
        </p>
        <div className="mt-4 flex gap-2">
          <span className="rounded-[4px] bg-status-success-bg px-2 py-0.5 text-sm text-status-success-fg">
            Success
          </span>
          <span className="rounded-[4px] bg-status-warning-bg px-2 py-0.5 text-sm text-status-warning-fg">
            Warning
          </span>
          <span className="rounded-[4px] bg-status-info-bg px-2 py-0.5 text-sm text-status-info-fg">
            Info
          </span>
        </div>
      </main>
    </div>
  );
}
