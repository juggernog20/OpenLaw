// SPDX-License-Identifier: AGPL-3.0-only

/** DD-021 points the shared reader at Portal routes. Callers memoize the returned reader
 * per Contract number so conversion and email effects do not restart on every render. */

import type { DocumentReaderSource } from "../components/documents/reader-context";
import { api } from "./api";

export function portalContractReader(number: number): DocumentReaderSource {
  const path = (documentId: string, versionId: string) =>
    `/api/v1/portal/contracts/${number}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`;
  return {
    documentDownloadHref: (documentId, versionId) => `${path(documentId, versionId)}/download`,
    documentPreviewHref: (documentId, versionId) => `${path(documentId, versionId)}/preview`,
    emailAttachmentDownloadHref: (documentId, versionId, index) =>
      `${path(documentId, versionId)}/attachments/${index}/download`,
    emailAttachmentPreviewHref: (documentId, versionId, index) =>
      `${path(documentId, versionId)}/attachments/${index}/preview`,
    readRenditionState: async (documentId, versionId) => {
      try {
        const { data } = await api.GET(
          "/api/v1/portal/contracts/{number}/documents/{documentId}/versions/{versionId}/rendition",
          { params: { path: { number, documentId, versionId } } },
        );
        return data?.rendition.state ?? "unreachable";
      } catch {
        return "unreachable";
      }
    },
    readEmail: async (documentId, versionId) => {
      try {
        const { data } = await api.GET(
          "/api/v1/portal/contracts/{number}/documents/{documentId}/versions/{versionId}/email",
          { params: { path: { number, documentId, versionId } } },
        );
        return data ? { ok: true, email: data.email } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}
