// SPDX-License-Identifier: AGPL-3.0-only
/** The "why" block the evidence popover and the source reader share (DES-070). */
import { FileText, Quote } from "lucide-react";
import { FormattedMessage } from "react-intl";

/**
 * The model's reasoning, or one muted line when a historical suggestion
 * saved none. The popover and the reader show the same block, so a
 * reader who lands in either sees the same "why".
 */
export function EvidenceExplanation({ justification }: Readonly<{ justification?: string }>) {
  return justification ? (
    <>
      <p className="text-xs font-medium text-muted">
        <FormattedMessage id="conversion.justification" defaultMessage="Why this value" />
      </p>
      <p className="mt-1 text-base">{justification}</p>
    </>
  ) : (
    <p className="text-sm text-muted">
      <FormattedMessage
        id="conversion.noJustification"
        defaultMessage="No explanation was saved for this value."
      />
    </p>
  );
}

/** A file or a quote glyph in front of a source's name. */
export function SourceGlyph({ file }: Readonly<{ file: boolean }>) {
  return file ? (
    <FileText size={16} aria-hidden="true" className="shrink-0" />
  ) : (
    <Quote size={16} aria-hidden="true" className="shrink-0" />
  );
}
