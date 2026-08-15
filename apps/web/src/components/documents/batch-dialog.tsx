// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The batch import dialog (M13/4, DOC-011, DES-033), drawn from the C27,
 * C28 and C29 mocks.
 *
 * **One dialog, three moments.** The reader confirmed one thing and is
 * watching one thing, so the confirmation *becomes* the progress list
 * and then the report: three dialogs for one import would be three
 * places to look. The head, the body and the foot each say what the
 * moment they are in is about.
 *
 * **One batch, one kind, no note** (DOC-011). The confirmation shows
 * what will be created and collects a single version kind applied to
 * every file, defaulting to Draft · ours. There is no per-file control,
 * because 200 decisions is exactly the ceremony bulk intake exists to
 * remove, and no note field, because a note is what changed in one
 * round and a batch is not a round.
 *
 * **Cancel creates nothing.** Nothing is sent until Import is pressed,
 * which is what makes an accidental drop of the wrong files free.
 *
 * **A failure costs its own file and nothing else.** Each file is its
 * own upload, so a refusal marks one row and the pool carries on. A row
 * that failed says why in the seam's own sentence and offers Retry —
 * unless a retry cannot succeed. A file over the deployment's size
 * ceiling names the limit and offers none, because the same file will
 * be refused again and a control that cannot succeed reads as "try
 * again" when the answer will not change.
 *
 * **A file that landed is never sent again.** Retry re-runs the failed
 * rows alone, so no retry can put the same document on the record
 * twice.
 *
 * Two deliberate departures from the mocks, recorded as DES-033
 * normalization point 8. The per-file rows carry a state — Queued,
 * Uploading, Done, or the failure — rather than the mock's percentage,
 * because the upload seam is `fetch` and `fetch` cannot report how much
 * of a body has gone; a percentage drawn anyway would be a number
 * nobody measured. And no row is badged "OCR queued" and no scan is
 * counted, because whether a PDF is a scan is decided by reading the
 * file's own text layer on the server (DOC-005) and the browser has not
 * read it.
 */

import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CircleAlert, CircleCheck, Clock, Folder, Info, Loader, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { cn } from "../../lib/utils";
import { formatFileSize } from "../../lib/format";
import {
  BATCH_CONCURRENCY,
  batchOf,
  runBounded,
  type BatchRow,
  type BatchState,
} from "../../lib/batch-upload";
import {
  DOCUMENT_VERSION_KINDS,
  uploadContractDocument,
  type DocumentVersionKind,
} from "../../lib/documents";

/**
 * How many file rows the dialog draws before it stops listing them.
 *
 * Six, as C27 and C28 draw them: enough to recognise what was dropped,
 * few enough that a 200-file import is still a dialog rather than a
 * page. **Failures are never truncated** — the truncation exists to
 * keep a long list of things that went right short, and a failure is
 * the one row the reader has to act on.
 */
const BATCH_ROWS = 6;

/** The seam's refusal of a file over the deployment's ceiling. It names
 * the limit itself, and the same file earns the same answer, so the row
 * that carries it is offered no retry (DES-033 §11). */
const PAYLOAD_TOO_LARGE = 413;

/** How the batch was started. It decides one line: a drop already said
 * where the files land, and a pick did not. */
export type BatchSource = "drop" | "picker";

export function BatchDialog({
  contractNumber,
  files,
  source,
  onLanded,
  onClose,
}: Readonly<{
  /** CTR-003's reference — the address every file of the batch is sent
   * to, one call per file. */
  contractNumber: number;
  /** What was dropped or chosen. Fixed for the life of the dialog: the
   * batch is what the gesture carried, and adding to it would be a
   * second gesture. */
  files: readonly File[];
  source: BatchSource;
  /** The record's paper, read again. Called once a run settles rather
   * than per file, because a 200-file import would otherwise re-read
   * the section 200 times. */
  onLanded: () => Promise<void>;
  onClose: () => void;
}>) {
  const intl = useIntl();
  const [rows, setRows] = useState<BatchRow[]>(() => batchOf(files));
  const [kind, setKind] = useState<DocumentVersionKind>("draft_ours");
  /** Whether Import has been pressed. Before it, nothing has been sent
   * and Cancel creates nothing. */
  const [started, setStarted] = useState(false);
  /** Set by "Cancel remaining". A worker checks it before it takes the
   * next file, so what is already in flight finishes — a request that
   * has left cannot be recalled, and pretending otherwise would leave
   * documents on the record the dialog said it had not created. */
  const cancelled = useRef(false);
  /** A run is in flight. One at a time: a second pool over the same
   * rows would send a file twice, and no correction takes a duplicate
   * document back off a record. A ref rather than state, because the
   * check has to see the answer the press before it wrote. */
  const running = useRef(false);

  const landed = rows.filter((row) => row.state === "done").length;
  const failed = rows.filter((row) => row.state === "failed");
  const retryable = failed.filter((row) => row.retryable);
  const inFlight = rows.filter((row) => row.state === "uploading").length;
  const queued = rows.filter((row) => row.state === "queued").length;
  const settled = started && inFlight === 0 && queued === 0;

  /** One row's state, replaced in place. The pool settles files out of
   * order, so every update is against what is there now rather than
   * against the list the worker started with. */
  function mark(id: string, next: Pick<BatchRow, "state" | "reason" | "retryable">) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  /**
   * Sends the named rows, at most `BATCH_CONCURRENCY` at once.
   *
   * The same routine runs the first import and every retry — a retry is
   * the batch again over fewer files, which is why a landed file is
   * never in `ids` and so can never be sent twice.
   */
  async function send(ids: readonly string[]) {
    if (ids.length === 0 || running.current) return;
    const byId = new Map(rows.map((row) => [row.id, row]));
    running.current = true;
    cancelled.current = false;
    setStarted(true);
    setRows((current) =>
      current.map((row) =>
        ids.includes(row.id) ? { ...row, state: "queued", reason: null, retryable: true } : row,
      ),
    );
    await runBounded(ids, BATCH_CONCURRENCY, async (id) => {
      const row = byId.get(id);
      if (!row) return;
      if (cancelled.current) {
        mark(id, {
          state: "failed",
          reason: intl.formatMessage({
            id: "documents.batch.cancelled",
            defaultMessage: "Cancelled before it was uploaded.",
          }),
          // A file nobody sent is a file a retry would send, so the
          // control is offered.
          retryable: true,
        });
        return;
      }
      mark(id, { state: "uploading", reason: null, retryable: true });
      // The batch's one kind, and no note (DOC-011). M13/5 adds the
      // destination here, beside them, and nothing else moves.
      const outcome = await uploadContractDocument(contractNumber, {
        file: row.file,
        kind,
        note: "",
      });
      if (outcome.ok) {
        mark(id, { state: "done", reason: null, retryable: false });
        return;
      }
      mark(id, {
        state: "failed",
        reason:
          outcome.detail ??
          intl.formatMessage({
            id: "documents.batch.failed",
            defaultMessage: "That file could not be uploaded.",
          }),
        retryable: outcome.status !== PAYLOAD_TOO_LARGE,
      });
    });
    running.current = false;
    // Once, at the end. Every file that landed is a document on the
    // record, and a batch on a record with no paper has just decided
    // which of them the record calls its instrument (CTR-014).
    await onLanded();
  }

  /** Which rows are drawn, and how many are left unsaid. Failures come
   * first and are never cut, because they are the rows the reader has
   * something to do about. */
  const shown = started ? [...failed, ...rows.filter((row) => row.state !== "failed")] : [...rows];
  const drawn = shown.slice(0, Math.max(BATCH_ROWS, failed.length));
  const hidden = shown.length - drawn.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="md:max-w-xl">
        <DialogTitle>
          {!started ? (
            <FormattedMessage
              id="documents.batch.confirmTitle"
              defaultMessage="{count, plural, one {Import # file} other {Import # files}}"
              values={{ count: rows.length }}
            />
          ) : settled ? (
            <FormattedMessage
              id="documents.batch.settledTitle"
              defaultMessage="Imported {landed} of {total, plural, one {# file} other {# files}}"
              values={{ landed: intl.formatNumber(landed), total: rows.length }}
            />
          ) : (
            <FormattedMessage
              id="documents.batch.runningTitle"
              defaultMessage="{count, plural, one {Importing # file} other {Importing # files}}"
              values={{ count: rows.length }}
            />
          )}
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-3.5">
          {!started && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                <FormattedMessage id="documents.batch.destination" defaultMessage="Destination" />
              </span>
              {/* Static, and offered no way to change it: the gesture
                  already answered where the files land, and a picker
                  here would let the confirmation contradict the drop
                  that opened it (DES-033 §9). M13/4 has no folders in
                  it, so every file lands at the record root. */}
              <span className="flex items-center gap-2 rounded-card bg-section-header px-2.5 py-1.5 text-sm">
                <Folder size={16} aria-hidden="true" className="shrink-0 text-muted" />
                <FormattedMessage id="documents.batch.root" defaultMessage="Record root" />
                {source === "drop" && (
                  <span className="ms-auto text-xs text-muted">
                    <FormattedMessage
                      id="documents.batch.setByDrop"
                      defaultMessage="Set by the drop"
                    />
                  </span>
                )}
              </span>
            </div>
          )}
          {started && (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-baseline gap-2 text-sm">
                <FormattedMessage
                  id="documents.batch.progress"
                  defaultMessage="{landed} of {total, plural, one {# file} other {# files}} uploaded"
                  values={{ landed: intl.formatNumber(landed), total: rows.length }}
                />
                {!settled && (
                  <span className="ms-auto text-xs text-muted">
                    <FormattedMessage
                      id="documents.batch.inFlight"
                      defaultMessage="{uploading} uploading · {queued} queued"
                      values={{
                        uploading: intl.formatNumber(inFlight),
                        queued: intl.formatNumber(queued),
                      }}
                    />
                  </span>
                )}
              </span>
              {/* The bar is a second reading of the sentence above it,
                  so it is left to the sighted eye rather than named
                  again for a reader who has just been told the count. */}
              <span aria-hidden="true" className="block h-1.5 w-full rounded-chip bg-control">
                <span
                  className="block h-1.5 rounded-chip bg-cta-primary"
                  style={{ width: `${rows.length === 0 ? 0 : (landed / rows.length) * 100}%` }}
                />
              </span>
            </div>
          )}
          <ul className="flex flex-col divide-y divide-border-default rounded-card border border-border-default">
            {drawn.map((row) => (
              <BatchFileRow
                key={row.id}
                row={row}
                started={started}
                settled={settled}
                onRetry={() => void send([row.id])}
              />
            ))}
            {hidden > 0 && (
              <li className="px-3 py-2 text-sm text-muted">
                <FormattedMessage
                  id="documents.batch.more"
                  defaultMessage="…and {count, plural, one {# more file} other {# more files}}"
                  values={{ count: hidden }}
                />
              </li>
            )}
          </ul>
          {!started && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="batch-kind">
                <FormattedMessage id="documents.batch.kind" defaultMessage="Version kind" />
              </Label>
              <select
                id="batch-kind"
                value={kind}
                className={CONTROL_CLASS}
                aria-describedby="batch-kind-help"
                onChange={(event) => setKind(event.target.value as DocumentVersionKind)}
              >
                {DOCUMENT_VERSION_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {intl.formatMessage(
                      {
                        id: "documents.kind",
                        defaultMessage:
                          "{kind, select, draft_ours {Draft · ours} redline_theirs {Redline · theirs} " +
                          "redline_ours {Redline · ours} executed {Executed} amendment {Amendment} " +
                          "other {Unknown}}",
                      },
                      { kind: option },
                    )}
                  </option>
                ))}
              </select>
              <p id="batch-kind-help" className="text-xs text-muted">
                <FormattedMessage
                  id="documents.batch.kindHelp"
                  defaultMessage="Applied to every file in this import. Notes are not collected in bulk."
                />
              </p>
            </div>
          )}
          {settled && failed.length > 0 && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-card bg-status-danger-bg px-3 py-2.5 text-sm text-status-danger-fg"
            >
              <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <FormattedMessage
                id="documents.batch.failures"
                defaultMessage="{failed, plural, one {# file failed} other {# files failed}}. {landed, plural, =0 {Nothing was added to the contract.} one {The other # is on the contract.} other {The other # are on the contract.}}"
                values={{ failed: failed.length, landed }}
              />
            </p>
          )}
          <p className="flex items-start gap-2 rounded-card bg-status-neutral-bg px-3 py-2.5 text-sm text-status-neutral-fg">
            <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {!started ? (
              // What DOC-005 does with each landed file, said without
              // counting scans: whether a PDF is a scan is decided by
              // reading its own text layer on the server, and the
              // browser has not read it.
              <FormattedMessage
                id="documents.batch.derivations"
                defaultMessage="Text extraction and OCR run in the background after every file lands."
              />
            ) : settled ? (
              <FormattedMessage
                id="documents.batch.retryNote"
                defaultMessage="Retry re-uploads only the file you pick. A file over the size ceiling stays refused until it is made smaller."
              />
            ) : (
              <FormattedMessage
                id="documents.batch.carriesOn"
                defaultMessage="A file that fails costs that file. The rest of the import carries on."
              />
            )}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {!started ? (
                <FormattedMessage
                  id="documents.batch.nothingYet"
                  defaultMessage="Nothing is created until you import."
                />
              ) : settled ? (
                <FormattedMessage
                  id="documents.batch.onRecord"
                  defaultMessage="{count, plural, =0 {Nothing was added to the contract.} one {# file is already on the contract.} other {# files are already on the contract.}}"
                  values={{ count: landed }}
                />
              ) : (
                <FormattedMessage
                  id="documents.batch.keepOpen"
                  defaultMessage="Keep this dialog open until the import finishes."
                />
              )}
            </p>
            <div className="flex items-center gap-2">
              {!started && (
                <>
                  <Button type="button" variant="secondary" onClick={onClose}>
                    <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
                  </Button>
                  <Button type="button" onClick={() => void send(rows.map((row) => row.id))}>
                    <FormattedMessage
                      id="documents.batch.import"
                      defaultMessage="{count, plural, one {Import # file} other {Import # files}}"
                      values={{ count: rows.length }}
                    />
                  </Button>
                </>
              )}
              {started && !settled && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    cancelled.current = true;
                  }}
                >
                  <FormattedMessage
                    id="documents.batch.cancelRemaining"
                    defaultMessage="Cancel remaining"
                  />
                </Button>
              )}
              {settled && (
                <>
                  {retryable.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void send(retryable.map((row) => row.id))}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      <FormattedMessage
                        id="documents.batch.retryAll"
                        defaultMessage="{count, plural, one {Retry # file} other {Retry # files}}"
                        values={{ count: retryable.length }}
                      />
                    </Button>
                  )}
                  <Button type="button" onClick={onClose}>
                    <FormattedMessage id="action.done" defaultMessage="Done" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        {/* What the import is doing, for a reader who cannot watch the
            rows change. The dialog's own title says the same thing, and
            a title is announced once. */}
        <p aria-live="polite" className="sr-only">
          {started && (
            <FormattedMessage
              id="documents.batch.announce"
              defaultMessage="{landed} of {total} uploaded, {failed} failed."
              values={{
                landed: intl.formatNumber(landed),
                total: intl.formatNumber(rows.length),
                failed: intl.formatNumber(failed.length),
              }}
            />
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** The glyph one state wears (DES-033 §11, DES-008's Lucide set). */
const STATE_ICON: Record<BatchState, typeof Clock> = {
  queued: Clock,
  uploading: Loader,
  done: CircleCheck,
  failed: CircleAlert,
};

/** The colour one state wears. Queued is the muted default, because a
 * file nothing has happened to yet is not a status. */
const STATE_TONE: Record<BatchState, string> = {
  queued: "text-muted",
  uploading: "text-status-info-fg",
  done: "text-status-success-fg",
  failed: "text-status-danger-fg",
};

/**
 * One file's row.
 *
 * Before the import it states the file and its size — what will be
 * created. During and after it, it states where that file got to, and
 * a failure states why on its own row rather than in a note over the
 * top of the list.
 */
function BatchFileRow({
  row,
  started,
  settled,
  onRetry,
}: Readonly<{
  row: BatchRow;
  started: boolean;
  /** The run has finished. Retry is offered only then, as C29 draws it:
   * a control that would start a second pool over rows the first one is
   * still working through is a way to send a file twice. */
  settled: boolean;
  onRetry: () => void;
}>) {
  const intl = useIntl();
  const Glyph = STATE_ICON[row.state];
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <Glyph
        size={16}
        aria-hidden="true"
        className={cn(
          "mt-0.5 shrink-0",
          STATE_TONE[row.state],
          // The one glyph that says "still happening". Reduced motion
          // takes it to a stop, globally, in styles/globals.css.
          row.state === "uploading" && "animate-spin",
        )}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{row.file.name}</span>
        {row.reason && <span className="text-xs text-status-danger-fg">{row.reason}</span>}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-2 text-xs text-muted">
        {!started ? (
          formatFileSize(row.file.size)
        ) : row.state === "done" ? (
          <FormattedMessage id="documents.batch.state.done" defaultMessage="Done" />
        ) : row.state === "uploading" ? (
          <FormattedMessage id="documents.batch.state.uploading" defaultMessage="Uploading" />
        ) : row.state === "queued" ? (
          <FormattedMessage id="documents.batch.state.queued" defaultMessage="Queued" />
        ) : null}
        {/* Offered only on a failure a retry could fix. A file over the
            deployment's ceiling names the limit on the row above and
            gets no control, because the same file earns the same
            answer. */}
        {settled && row.state === "failed" && row.retryable && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            // The visible word is the verb; the name is what a reader
            // going through the failures by keyboard needs, because a
            // list of buttons all reading "Retry" says which file none
            // of them is about.
            aria-label={intl.formatMessage(
              { id: "documents.batch.retryFile", defaultMessage: "Retry {name}" },
              { name: row.file.name },
            )}
            onClick={onRetry}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <FormattedMessage id="documents.batch.retry" defaultMessage="Retry" />
          </Button>
        )}
      </span>
    </li>
  );
}
