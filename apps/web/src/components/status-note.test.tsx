// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode, type ReactNode } from "react";
import { IntlProvider } from "react-intl";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusNote } from "./status-note";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <IntlProvider locale="en-US">{children}</IntlProvider>
    </StrictMode>
  );
}

function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("StatusNote", () => {
  it("announces a successful save, fades after three seconds, then removes the text", () => {
    const { container, rerender } = render(<StatusNote status="idle" />, { wrapper: Wrapper });
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeEmptyDOMElement();

    rerender(<StatusNote status="saving" />);
    expect(liveRegion).toHaveTextContent("Saving…");
    advance(5_000);
    expect(liveRegion).toHaveTextContent("Saving…");

    rerender(<StatusNote status="saved" />);
    expect(liveRegion).toHaveTextContent("Saved");
    advance(2_999);
    expect(screen.getByText("Saved")).toHaveClass("opacity-100");
    advance(1);
    expect(screen.getByText("Saved")).toHaveClass("opacity-0", "motion-reduce:transition-none");
    advance(300);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(liveRegion).toBeEmptyDOMElement();
  });

  it("gives each new save a full interval even when it interrupts the previous fade", () => {
    const { rerender } = render(<StatusNote status="saved" />, { wrapper: Wrapper });
    advance(3_100);
    rerender(<StatusNote status="saving" />);
    rerender(<StatusNote status="saved" />);
    advance(2_999);
    expect(screen.getByText("Saved")).toHaveClass("opacity-100");
    advance(301);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    rerender(<StatusNote status="saving" />);
    rerender(<StatusNote status="saved" />);
    expect(screen.getByText("Saved")).toHaveClass("opacity-100");
    advance(3_300);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("does not restart expired feedback on an unrelated rerender", () => {
    const { rerender } = render(<StatusNote status="saved" />, { wrapper: Wrapper });
    advance(3_300);
    rerender(<StatusNote status="saved" detail="" />);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("keeps an error visible when an earlier save's timers would expire", () => {
    const { rerender } = render(<StatusNote status="saved" />, { wrapper: Wrapper });
    advance(2_000);
    rerender(<StatusNote status="saving" />);
    rerender(<StatusNote status="error" detail="You no longer have access." />);
    advance(10_000);
    expect(screen.getByText("You no longer have access.")).toBeVisible();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    rerender(<StatusNote status="error" detail="" />);
    advance(10_000);
    expect(screen.getByText("The change could not be saved. Try again.")).toBeVisible();
  });

  it("expires feedback independently for different fields", () => {
    const { rerender } = render(
      <>
        <StatusNote status="saved" />
        <StatusNote status="saving" />
      </>,
      { wrapper: Wrapper },
    );
    advance(2_000);
    rerender(
      <>
        <StatusNote status="saved" />
        <StatusNote status="saved" />
      </>,
    );
    expect(screen.getAllByText("Saved")).toHaveLength(2);
    advance(1_300);
    expect(screen.getAllByText("Saved")).toHaveLength(1);
    advance(2_000);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("cancels pending timers when unmounted", () => {
    const { unmount } = render(<StatusNote status="saved" />, { wrapper: Wrapper });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
