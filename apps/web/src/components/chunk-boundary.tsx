// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An error boundary for a lazy-loaded subtree.
 *
 * After a self-hoster upgrades the image, a tab that is still open
 * asks for a chunk hash that no longer exists. The API's SPA fallback
 * answers with index.html and a 200, so the dynamic import throws
 * inside Suspense and the user sees nothing. This boundary catches
 * that and shows a short notice with a Reload button. It never reloads
 * on its own, because a reload would drop unsaved edits.
 *
 * `resetKey` clears the caught error when it changes, so switching to
 * another document retries the import.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  /** Change this to clear a caught error and render the children again. */
  resetKey?: unknown;
}

interface State {
  failed: boolean;
}

export class ChunkBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Lazy chunk failed to load", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div
        role="alert"
        className="m-4 flex flex-wrap items-center gap-3 rounded-card bg-status-info-bg px-3 py-2 text-md text-status-info-fg"
      >
        <span>
          <FormattedMessage
            id="chunkBoundary.notice"
            defaultMessage="This part of OpenLaw was updated. Reload to continue."
          />
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <FormattedMessage id="chunkBoundary.reload" defaultMessage="Reload" />
        </Button>
      </div>
    );
  }
}
