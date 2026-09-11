// SPDX-License-Identifier: AGPL-3.0-only
/** Saved source citations use the record's DES-016 doc panel. */
import { createContext } from "react";
export const SourceDocumentPanel = createContext<
  | null
  | ((input: {
      module: "matter" | "contract";
      number: number;
      documentId: string;
      versionId: string;
      quote: string;
      trigger: HTMLElement;
      signal?: AbortSignal;
    }) => Promise<boolean>)
>(null);
