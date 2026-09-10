// SPDX-License-Identifier: AGPL-3.0-only

/** Shared Document and email readers use staff routes by default, or Portal routes
 * under DD-021. Keep a supplied reader stable: conversion and email effects depend on it. */

import { createContext, useContext } from "react";
import {
  documentDownloadHref,
  documentPreviewHref,
  readRenditionState,
  readEmail,
  emailAttachmentDownloadHref,
  emailAttachmentPreviewHref,
} from "../../lib/documents";

export const staffDocumentReader = {
  documentDownloadHref,
  documentPreviewHref,
  readRenditionState,
  readEmail,
  emailAttachmentDownloadHref,
  emailAttachmentPreviewHref,
};
export type DocumentReaderSource = typeof staffDocumentReader;
export const DocumentReaderContext = createContext<DocumentReaderSource>(staffDocumentReader);
export const useDocumentReader = () => useContext(DocumentReaderContext);
