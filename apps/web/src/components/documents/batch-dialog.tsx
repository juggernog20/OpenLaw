// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The batch import dialog (M13/4, M13/5, DOC-011, DES-033), drawn from
 * the C27, C28 and C29 mocks.
 *
 * **What is dropped is what is drawn.** A folder drop's confirmation
 * shows the tree it will create before it creates anything — the folders
 * with their counts, the files inside them — because a 200-file import
 * of somebody's drive folder is a decision about a structure and not
 * about a list. The destination readout says where that structure lands:
 * the record root, or the folder row the drop landed on.
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
 * unless a retry cannot succeed. A refusal the file itself earned —
 * over the size ceiling, a path or a name or a kind the seam will not
 * take — names the reason and offers no control, because the same file
 * earns the same answer and a control that cannot succeed reads as
 * "try again" when the answer will not change.
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
 *
 * **The folders are the server's to create, not this dialog's.** Every
 * file's upload carries its own path, and the seam find-or-creates the
 * chain under the owning contract's row lock — so several files of one
 * folder converge on one folder without this dialog co-ordinating
 * anything, and a failed file leaves the folders its siblings made. The
 * only folders asked for on their own are the **empty** directories of
 * the dropped tree, which no upload would recreate.
 */

import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  Folder,
  Info,
  Loader,
  RotateCcw,
} from "lucide-react";
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
  type DroppedFile,
} from "../../lib/batch-upload";
import { recreateContractFolderPath } from "../../lib/folders";
import {
  DOCUMENT_VERSION_KINDS,
  uploadContractDocument,
  type HandSetDocumentVersionKind,
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

/** The seam gave up waiting for the body. About the moment, not the
 * file. */
const REQUEST_TIMEOUT = 408;

/** The seam is being asked too often. About the moment, not the file. */
const TOO_MANY_REQUESTS = 429;

/**
 * Whether sending this file again could end any differently
 * (DES-033 §11).
 *
 * A 4xx is the seam's answer about *this file*: over the ceiling, a
 * folder path it will not accept, a name too long, a kind it does not
 * know. The file does not change between attempts, so neither does the
 * answer, and a Retry control on that row promises something it cannot
 * deliver.
 *
 * Two are the exception, because they are answers about the moment
 * rather than about the file: 408, the seam gave up waiting, and 429,
 * the seam is being asked too often. A later attempt genuinely can
 * succeed.
 *
 * Everything else is retryable — a 5xx is the server having a bad
 * minute, and no status at all is the connection dropping mid-flight.
 * Both are worth another go.
 */
function retryCouldSucceed(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status === REQUEST_TIMEOUT || status === TOO_MANY_REQUESTS) return true;
  return status < 400 || status >= 500;
}

/** How the batch was started. It decides one line: a drop already said
 * where the files land, and a pick did not. */
export type BatchSource = "drop" | "picker";

/** The folder a gesture landed on, or the record root. One drop, one
 * base: every path in the batch is relative to it. */
export interface BatchDestination {
  id: string;
  name: string;
}

export function BatchDialog({
  contractNumber,
  files,
  emptyFolders,
  unreadable,
  destination,
  source,
  onLanded,
  onClose,
}: Readonly<{
  /** CTR-003's reference — the address every file of the batch is sent
   * to, one call per file. */
  contractNumber: number;
  /** What was dropped or chosen, each file with the folder chain it sat
   * at. Fixed for the life of the dialog: the batch is what the gesture
   * carried, and adding to it would be a second gesture. */
  files: readonly DroppedFile[];
  /** The directories of the dropped tree that held nothing. No upload
   * would recreate them, so they are asked for on their own (DOC-011). */
  emptyFolders: readonly (readonly string[])[];
  /** The directories the walk could not read to the end. Said before the
   * import rather than after it: what is missing is missing from the
   * batch itself, so the reader can cancel and drop again. */
  unreadable: readonly (readonly string[])[];
  /** The folder the gesture landed on, or null for the record root. */
  destination: BatchDestination | null;
  source: BatchSource;
  /** The record's paper and its folders, read again. Called once a run
   * settles rather than per file, because a 200-file import would
   * otherwise re-read the section 200 times. */
  onLanded: () => Promise<void>;
  onClose: () => void;
}>) {
  const intl = useIntl();
  /** What sits between two names of a path — a mark a reader reads, so
   * it is a message rather than a literal (DES-013), and the same one
   * the Move picker joins a destination's path with. */
  const separator = intl.formatMessage({
    id: "documents.folder.pathSeparator",
    defaultMessage: "/",
  });
  const [rows, setRows] = useState<BatchRow[]>(() => batchOf(files));
  const [kind, setKind] = useState<HandSetDocumentVersionKind>("draft_ours");
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
  /** Why the empty directories of the dropped tree could not be
   * recreated, when they could not. Said beside the file failures rather
   * than on a row of its own: no file is missing because of it, so it is
   * a note about the structure and not about the import. */
  const [folderError, setFolderError] = useState<string | null>(null);

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
  async function send(ids: readonly string[], firstRun = false) {
    if (running.current) return;
    // A drop can carry only structure: empty directories and not one
    // file. Its import is the folder creates alone — nothing to pool,
    // nothing to watch land — so the folders are made, the section is
    // read again, and the dialog closes on success. It stays open only
    // to say why they could not be made. A retry over zero rows is
    // still nothing to do.
    if (ids.length === 0) {
      if (!firstRun) return;
      running.current = true;
      const made = await recreateEmptyFolders();
      running.current = false;
      await onLanded();
      if (made) onClose();
      return;
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    running.current = true;
    cancelled.current = false;
    setStarted(true);
    setRows((current) =>
      current.map((row) =>
        ids.includes(row.id) ? { ...row, state: "queued", reason: null, retryable: true } : row,
      ),
    );
    // The empty directories first, and only on the first run: they are
    // part of the structure that was dropped, so they should be there
    // whether or not every file lands. A retry is about files.
    if (firstRun) await recreateEmptyFolders();
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
      // The batch's one kind, no note (DOC-011), and this file's own
      // destination: the folder the gesture landed on, plus the chain it
      // sat at in the dropped tree. The seam makes that chain under the
      // contract's row lock, so the files of one folder converge on one
      // folder without anything here co-ordinating them.
      const outcome = await uploadContractDocument(contractNumber, {
        file: row.file,
        kind,
        note: "",
        destination: { folderId: destination?.id ?? null, path: row.path },
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
        retryable: retryCouldSucceed(outcome.status),
      });
    });
    running.current = false;
    // Once, at the end. Every file that landed is a document on the
    // record, and a batch on a record with no paper has just decided
    // which of them the record calls its instrument (CTR-014).
    await onLanded();
  }

  /**
   * The directories of the dropped tree that held nothing, recreated
   * (DOC-011).
   *
   * One at a time rather than at once: they are few, and asking for them
   * in parallel would have them race each other on the levels they share
   * — which the seam would resolve correctly and slowly, since every one
   * of them takes the same row lock.
   *
   * A refusal is reported once, in the seam's own words, and the import
   * carries on: the files are what the reader came to import.
   *
   * Answers whether every one of them was made, because a drop that
   * carried only structure has nothing else to say whether it worked.
   */
  async function recreateEmptyFolders(): Promise<boolean> {
    if (emptyFolders.length === 0) return true;
    for (const path of emptyFolders) {
      const outcome = await recreateContractFolderPath(contractNumber, {
        path,
        ...(destination ? { parentId: destination.id } : {}),
      });
      if (outcome.ok) continue;
      setFolderError(
        outcome.detail ??
          intl.formatMessage({
            id: "documents.batch.folderError",
            defaultMessage: "Some empty folders of the dropped tree could not be created.",
          }),
      );
      return false;
    }
    return true;
  }

  /** Which rows are drawn, and how many are left unsaid. Failures come
   * first and are never cut, because they are the rows the reader has
   * something to do about. */
  const shown = started ? [...failed, ...rows.filter((row) => row.state !== "failed")] : [...rows];
  const drawn = shown.slice(0, Math.max(BATCH_ROWS, failed.length));
  const hidden = shown.length - drawn.length;
  /** The structure the import will create, drawn before it creates it
   * (DES-033 §9). Only before: once the import is running, the rows say
   * what happened to each file rather than what was promised. */
  const summary = started ? [] : summaryOf(rows, emptyFolders);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="md:max-w-xl">
        <DialogTitle>
          {!started ? (
            <FormattedMessage
              id="documents.batch.confirmTitle"
              // `=0` is a drop that carried only structure — empty
              // directories and not one file. Its import is real: the
              // folders are created, and only the files are absent.
              defaultMessage="{count, plural, =0 {Import folders} one {Import # file} other {Import # files}}"
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
          {/* The destination is named as a group, because the readout
              under the label is a value and not a control: without the
              association a reader landing on "Record root" is told a
              folder name with nothing saying what it answers. */}
          {!started && (
            <div
              role="group"
              aria-labelledby="batch-destination-label"
              className="flex flex-col gap-1.5"
            >
              <span id="batch-destination-label" className="text-sm font-medium">
                <FormattedMessage id="documents.batch.destination" defaultMessage="Destination" />
              </span>
              {/* Static, and offered no way to change it: the gesture
                  already answered where the files land, and a picker
                  here would let the confirmation contradict the drop
                  that opened it (DES-033 §9). A drop on a folder row
                  names that folder; everything else lands at the record
                  root, and the tree below it is created inside
                  whichever. */}
              <span className="flex items-center gap-2 rounded-card bg-section-header px-2.5 py-1.5 text-sm">
                <Folder size={16} aria-hidden="true" className="shrink-0 text-muted" />
                {destination ? (
                  <span className="min-w-0 truncate">{destination.name}</span>
                ) : (
                  <FormattedMessage id="documents.batch.root" defaultMessage="Record root" />
                )}
                {source === "drop" && (
                  <span className="ms-auto shrink-0 text-xs text-muted">
                    <FormattedMessage
                      id="documents.batch.setByDrop"
                      defaultMessage="Set by the drop"
                    />
                  </span>
                )}
              </span>
              {/* Said once, above the tree it is true of: a folder drop
                  keeps the organization it arrived with (DOC-011), and
                  the lines below are what that will look like. Drawn
                  only when there is a structure to keep. */}
              {summary.some((line) => line.kind === "folder") && (
                <p className="text-xs text-muted">
                  <FormattedMessage
                    id="documents.batch.structureKept"
                    defaultMessage="Folder structure is kept"
                  />
                </p>
              )}
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
          {/* Named, because it is two different lists in one place: what
              the import will create, and then where each file of it got
              to. A reader moving by landmark has to be told which one
              they are in. */}
          <ul
            aria-label={
              started
                ? intl.formatMessage({
                    id: "documents.batch.progressList",
                    defaultMessage: "Files in this import",
                  })
                : intl.formatMessage({
                    id: "documents.batch.summaryList",
                    defaultMessage: "What this import will create",
                  })
            }
            className="flex flex-col divide-y divide-border-default rounded-card border border-border-default"
          >
            {!started ? (
              <SummaryRows lines={summary} />
            ) : (
              drawn.map((row) => (
                <BatchFileRow
                  key={row.id}
                  row={row}
                  settled={settled}
                  onRetry={() => void send([row.id])}
                />
              ))
            )}
            {started && hidden > 0 && (
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
                onChange={(event) => {
                  const picked = DOCUMENT_VERSION_KINDS.find(
                    (option) => option === event.target.value,
                  );
                  if (picked) setKind(picked);
                }}
              >
                {DOCUMENT_VERSION_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {intl.formatMessage(
                      {
                        id: "documents.kind",
                        defaultMessage:
                          "{kind, select, draft_ours {Draft · ours} draft_theirs {Draft · theirs} " +
                          "redline_theirs {Redline · theirs} redline_ours {Redline · ours} " +
                          "executed {Executed} amendment {Amendment} " +
                          "generated_redline {Generated redline} other {Unknown}}",
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
          {/* A directory the browser would not read to the end. Said
              here rather than left silent, because what is missing is
              missing from the batch below it — a drop that arrived short
              and said nothing would be the one failure a bulk import
              cannot afford. The reader can cancel and drop it again. */}
          {unreadable.length > 0 && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-card bg-status-danger-bg px-3 py-2.5 text-sm text-status-danger-fg"
            >
              <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <FormattedMessage
                id="documents.batch.unreadable"
                defaultMessage="{count, plural, one {# folder could not be read} other {# folders could not be read}}: {names}. Check the list below — it may be missing files."
                values={{
                  count: unreadable.length,
                  names: unreadable.map((path) => path.join(separator)).join(", "),
                }}
              />
            </p>
          )}
          {folderError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-card bg-status-danger-bg px-3 py-2.5 text-sm text-status-danger-fg"
            >
              <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {folderError}
            </p>
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
                  <Button
                    type="button"
                    onClick={() =>
                      void send(
                        rows.map((row) => row.id),
                        true,
                      )
                    }
                  >
                    <FormattedMessage
                      id="documents.batch.import"
                      // `=0` as the title above: a drop of only empty
                      // directories still has an import to run.
                      defaultMessage="{count, plural, =0 {Import folders} one {Import # file} other {Import # files}}"
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

/** How far in one level of the summary tree sits, in pixels. DES-033's
 * own 18px a level, so the confirmation indents exactly as the folder
 * tree it is promising to create. */
const SUMMARY_INDENT = 18;

/** One line of the tree summary: a folder that will be created, or a
 * file that will land in it (DES-033 §9). */
type SummaryRow =
  | {
      kind: "folder";
      key: string;
      depth: number;
      name: string;
      /** How many folders and files sit anywhere beneath it. The whole
       * subtree, as C27 draws it: a folder's line says what it will
       * hold, and the lines under it say how. */
      folders: number;
      files: number;
    }
  | { kind: "file"; key: string; depth: number; name: string; size: number };

/** One node of the dropped tree, while the summary is being built. */
interface SummaryNode {
  name: string;
  folders: Map<string, SummaryNode>;
  files: { name: string; size: number }[];
}

const emptyNode = (name: string): SummaryNode => ({ name, folders: new Map(), files: [] });

/**
 * The structure a drop will create, as lines to draw (DES-033 §9).
 *
 * Built from the paths the files carry and from the empty directories
 * beside them, because those are the two things a dropped tree is made
 * of. Siblings are ordered by name without case, which is the order the
 * seam will answer the folders in — the confirmation and the tree it
 * creates read the same way round.
 *
 * The files at the drop target itself come last, under the folders, as
 * the record's own list draws them.
 */
function summaryOf(
  rows: readonly BatchRow[],
  emptyFolders: readonly (readonly string[])[],
): SummaryRow[] {
  const root = emptyNode("");
  const nodeAt = (path: readonly string[]): SummaryNode => {
    let at = root;
    for (const segment of path) {
      // Case-insensitively, as the seam matches a path segment against
      // the siblings already there: two spellings of one folder are one
      // folder, and the first spelling is the one that stands.
      const key = segment.toLowerCase();
      const held = at.folders.get(key);
      if (held) at = held;
      else {
        const made = emptyNode(segment);
        at.folders.set(key, made);
        at = made;
      }
    }
    return at;
  };
  for (const row of rows) {
    nodeAt(row.path).files.push({ name: row.file.name, size: row.file.size });
  }
  for (const path of emptyFolders) nodeAt(path);

  const lines: SummaryRow[] = [];
  const walk = (
    node: SummaryNode,
    depth: number,
    key: string,
  ): { folders: number; files: number } => {
    let folders = 0;
    let files = node.files.length;
    const children = [...node.folders.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    // The folder's own line goes in before its children's, and its
    // counts are filled in once they have been walked — a line cannot
    // say what it holds until what it holds has been counted.
    const line: SummaryRow = { kind: "folder", key, depth, name: node.name, folders: 0, files: 0 };
    if (depth >= 0) lines.push(line);
    for (const child of children) {
      const below = walk(child, depth + 1, `${key}/${child.name}`);
      folders += 1 + below.folders;
      files += below.files;
    }
    for (const [index, file] of node.files.entries()) {
      lines.push({
        kind: "file",
        key: `${key}/${index}-${file.name}`,
        depth: depth + 1,
        name: file.name,
        size: file.size,
      });
    }
    if (line.kind === "folder") {
      line.folders = folders;
      line.files = files;
    }
    return { folders, files };
  };
  // The record root itself draws no line: the destination readout above
  // has already said where the drop lands, and a line for it would say
  // it twice.
  walk(root, -1, "");
  return lines;
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
 * The tree the import will create, before it creates anything (DES-033
 * §9).
 *
 * The folder lines are all drawn, however many there are: the structure
 * is what the reader is confirming, and a truncated structure would be
 * a confirmation of something else. The **files** are what gets cut,
 * which is what the truncation row counts.
 */
function SummaryRows({ lines }: Readonly<{ lines: readonly SummaryRow[] }>) {
  let drawnFiles = 0;
  const drawn: SummaryRow[] = [];
  for (const line of lines) {
    if (line.kind === "file") {
      if (drawnFiles >= BATCH_ROWS) continue;
      drawnFiles += 1;
    }
    drawn.push(line);
  }
  const hidden = lines.filter((line) => line.kind === "file").length - drawnFiles;
  return (
    <>
      {drawn.map((line) => (
        <li key={line.key} className="flex items-center gap-2 px-3 py-2">
          {/* 18px a level, drawn as a spacer at the head of the line, as
              the folder tree itself indents (DES-033 §2). */}
          {line.depth > 0 && (
            <span
              aria-hidden="true"
              className="shrink-0"
              style={{ width: line.depth * SUMMARY_INDENT }}
            />
          )}
          {line.kind === "folder" ? (
            <>
              <Folder size={16} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="min-w-0 truncate text-sm font-semibold">{line.name}</span>
              <span className="ms-auto shrink-0 text-xs text-muted">
                {line.folders > 0 ? (
                  <FormattedMessage
                    id="documents.batch.folderMeta"
                    defaultMessage="{folders, plural, one {# folder} other {# folders}} · {files, plural, one {# file} other {# files}}"
                    values={{ folders: line.folders, files: line.files }}
                  />
                ) : (
                  <FormattedMessage
                    id="documents.batch.fileMeta"
                    defaultMessage="{files, plural, =0 {Empty} one {# file} other {# files}}"
                    values={{ files: line.files }}
                  />
                )}
              </span>
            </>
          ) : (
            <>
              <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="min-w-0 truncate text-sm">{line.name}</span>
              <span className="ms-auto shrink-0 text-xs text-muted">
                {formatFileSize(line.size)}
              </span>
            </>
          )}
        </li>
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
    </>
  );
}

/**
 * One file's row, once the import is running.
 *
 * It states where that file got to, and a failure states why on its own
 * row rather than in a note over the top of the list. The folder it is
 * headed for is drawn before its name, in muted text, so a long import
 * of a nested tree reads as the tree rather than as a list of names
 * (DES-033 §11).
 */
function BatchFileRow({
  row,
  settled,
  onRetry,
}: Readonly<{
  row: BatchRow;
  /** The run has finished. Retry is offered only then, as C29 draws it:
   * a control that would start a second pool over rows the first one is
   * still working through is a way to send a file twice. */
  settled: boolean;
  onRetry: () => void;
}>) {
  const intl = useIntl();
  /** What sits between two names of the file's path — a mark a reader
   * reads, so it is a message rather than a literal (DES-013), and the
   * same one the Move picker joins a destination's path with. */
  const separator = intl.formatMessage({
    id: "documents.folder.pathSeparator",
    defaultMessage: "/",
  });
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
        <span className="truncate text-sm">
          {/* Where this file is headed, before its name and in muted
              text (DES-033 §11), so a long import of a nested tree reads
              as the tree. The separator is a mark a reader reads, so it
              is the same message the Move picker's path is joined with
              (DES-013). */}
          {row.path.length > 0 && (
            <span className="text-muted">{`${row.path.join(separator)}${separator} `}</span>
          )}
          {row.file.name}
        </span>
        {row.reason && <span className="text-xs text-status-danger-fg">{row.reason}</span>}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-2 text-xs text-muted">
        {row.state === "done" ? (
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
