// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds DOC-003's common change model from two extracted-text readings.
 * Text mode has no formatting to preserve. It aligns blank-line-separated
 * paragraphs first, then applies a word diff inside each changed pair.
 */

import { calcSlices, diff } from "fast-myers-diff";
import {
  changesOf,
  leadingClauseLabel,
  type ChangeKind,
  type ChangeModel,
  type ChangeParagraph,
  type ChangeRun,
} from "./change-model.js";

/**
 * A blank line, or a form feed. `pdftotext` and the OCR sidecar text put
 * a form feed between pages with no blank line before it, so without the
 * second alternative the last paragraph of one page and the first of the
 * next would read as one, and a pair that paginates differently (a Word
 * rendition against a PDF) would misalign around every page break.
 */
const PARAGRAPH_BREAK = /\f|\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/u;

function paragraphsOf(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.replaceAll(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function wordsOf(paragraph: string): string[] {
  return paragraph.split(/\s+/u).filter(Boolean);
}

function appendRun(runs: ChangeRun[], text: string, change: ChangeKind): void {
  if (!text) return;
  const previous = runs.at(-1);
  if (previous?.change === change) previous.text += text;
  else runs.push({ text, change });
}

function changedWords(older: string, newer: string): ChangeRun[] {
  const oldWords = wordsOf(older);
  const newWords = wordsOf(newer);
  const slices = [...calcSlices(oldWords, newWords)];
  const runs: ChangeRun[] = [];
  slices.forEach(([kind, words], index) => {
    const change = kind === -1 ? "deleted" : kind === 1 ? "inserted" : "unchanged";
    const trailingSpace = index < slices.length - 1 ? " " : "";
    appendRun(runs, `${words.join(" ")}${trailingSpace}`, change);
  });
  return runs;
}

interface TextParagraph {
  text: string;
  runs: ChangeRun[];
}

function changedParagraph(older: string, newer: string): TextParagraph {
  return { text: newer || older, runs: changedWords(older, newer) };
}

function wholeParagraph(text: string, change: ChangeKind): TextParagraph {
  return { text, runs: [{ text, change }] };
}

/** Build one JSON-safe model for the compare screen from extracted text. */
export function buildTextChangeModel(olderText: string, newerText: string): ChangeModel {
  const older = paragraphsOf(olderText);
  const newer = paragraphsOf(newerText);
  const answer: TextParagraph[] = [];
  let oldCursor = 0;

  for (const [oldStart, oldEnd, newStart, newEnd] of diff(older, newer)) {
    for (let index = oldCursor; index < oldStart; index += 1) {
      answer.push(wholeParagraph(older[index]!, "unchanged"));
    }

    const oldLength = oldEnd - oldStart;
    const newLength = newEnd - newStart;
    const paired = Math.min(oldLength, newLength);
    for (let index = 0; index < paired; index += 1) {
      answer.push(changedParagraph(older[oldStart + index]!, newer[newStart + index]!));
    }
    for (let index = oldStart + paired; index < oldEnd; index += 1) {
      answer.push(wholeParagraph(older[index]!, "deleted"));
    }
    for (let index = newStart + paired; index < newEnd; index += 1) {
      answer.push(wholeParagraph(newer[index]!, "inserted"));
    }
    oldCursor = oldEnd;
  }

  for (let index = oldCursor; index < older.length; index += 1) {
    answer.push(wholeParagraph(older[index]!, "unchanged"));
  }

  const paragraphs = answer.map((paragraph, index): ChangeParagraph => ({
    index,
    style: "body",
    label: leadingClauseLabel(paragraph.text),
    runs: paragraph.runs,
  }));
  return { paragraphs, changes: changesOf(paragraphs) };
}
