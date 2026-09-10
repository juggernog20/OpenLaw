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
  /** The read this page started last, wrapped so two reads taken in the
   * same router state stay distinguishable. */
  const latest = useRef<{ state: RouterState; echo: boolean } | null>(null);
  /** The loader data standing when this page's own URL sync landed. */
  const synced = useRef<RouterState["loaderData"] | null>(null);
  if (!context) throw new Error("List reads require a data router.");
  const { router } = context;

  const beginRead = useCallback(() => {
    const read = { state: router.state, echo: synced.current === router.state.loaderData };
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

  /** Hand over what a navigation this page started returns. The page put
   * its own answer on screen before asking for the URL, so the loader
   * data that navigation lands with repeats what the page already shows. */
  const noteUrlSync = useCallback(
    async (landing: void | Promise<void>) => {
      await landing;
      synced.current = router.state.loaderData;
    },
    [router],
  );

  const shouldAdoptLoader = useCallback(
    (loaded: unknown) => {
      if (!Object.values(router.state.loaderData).includes(loaded)) return false;
      const read = latest.current;
      if (!read || !Object.values(read.state.loaderData).includes(loaded)) return true;
      // The read started after this loader finished, so it supersedes
      // these rows. It does so only where the loader repeats a URL sync
      // this page asked for. A navigation the page did not start, a Back
      // press or a nav-rail click, still carries a list the page has
      // never shown.
      return !read.echo;
    },
    [router],
  );

  return { beginRead, noteUrlSync, shouldAdoptLoader };
}
