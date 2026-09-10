// SPDX-License-Identifier: AGPL-3.0-only

/** DES-046 list reads follow the current navigation. DataRouterContext
 * exposes router.state before React commits its loader and location hooks. */

import { useCallback, useContext, useRef } from "react";
import { UNSAFE_DataRouterContext, type RouterState } from "react-router";

/** Read the router itself: its loader can finish before React commits
 * the corresponding context update. A read started in that gap already
 * belongs to the new loader, so committing it must not cancel the read. */
export function useListReadGuard() {
  const context = useContext(UNSAFE_DataRouterContext);
  const latest = useRef<{ state: RouterState } | null>(null);
  if (!context) throw new Error("List reads require a data router.");
  const { router } = context;

  const beginRead = useCallback(() => {
    const read = { state: router.state };
    latest.current = read;
    return () => {
      const current = router.state;
      return (
        latest.current === read &&
        current.location === read.state.location &&
        current.navigation.location === read.state.navigation.location &&
        current.loaderData === read.state.loaderData
      );
    };
  }, [router]);

  const shouldAdoptLoader = useCallback(
    (loaded: unknown) => {
      // A local read made after this loader finished supersedes its rows,
      // even if that read resolves before React commits the loader.
      return (
        Object.values(router.state.loaderData).includes(loaded) &&
        (!latest.current || !Object.values(latest.current.state.loaderData).includes(loaded))
      );
    },
    [router],
  );

  return { beginRead, shouldAdoptLoader };
}
