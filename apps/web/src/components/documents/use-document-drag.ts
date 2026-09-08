// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState, type DragEvent } from "react";

const DOCUMENT_DRAG_TYPE = "application/x-openlaw-document";

/** Only a document picked up in this surface can be moved by its drop targets. */
export function useDocumentDrag<T extends { id: string }>() {
  const [source, setSource] = useState<T | null>(null);
  const held = useRef<T | null>(null);
  function clear() {
    held.current = null;
    setSource(null);
  }
  return {
    source,
    clear,
    start(document: T, event: DragEvent) {
      held.current = document;
      event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, document.id);
      event.dataTransfer.effectAllowed = "move";
      setSource(document);
    },
    accepts(transfer: DataTransfer | null) {
      return (
        held.current !== null && Array.from(transfer?.types ?? []).includes(DOCUMENT_DRAG_TYPE)
      );
    },
    take(transfer: DataTransfer | null) {
      const document = held.current;
      const id = transfer?.getData(DOCUMENT_DRAG_TYPE);
      clear();
      return document?.id === id ? document : null;
    },
  };
}
