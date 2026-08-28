// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The chunk boundary shows a reload notice when a lazy import rejects,
 * and it reloads only when the user asks.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { lazy, Suspense } from "react";
import { ChunkBoundary } from "./chunk-boundary";

const Broken = lazy(() => Promise.reject(new Error("chunk missing")));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChunkBoundary", () => {
  it("shows the notice and a Reload button when the import rejects", async () => {
    // React logs the caught error. Keep the test output quiet.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    render(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <ChunkBoundary resetKey="doc-1">
          <Suspense fallback={<p>Opening…</p>}>
            <Broken />
          </Suspense>
        </ChunkBoundary>
      </IntlProvider>,
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("This part of OpenLaw was updated. Reload to continue.");
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
