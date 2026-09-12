// SPDX-License-Identifier: AGPL-3.0-only
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { createFakeDocEngine, fakeImageOnlyPdf, fakeComparisonDocx } from "./doc-engine/fake.js";
import { SourceUnreadableError } from "./doc-engine/engine.js";
import {
  extractAttachment,
  ATTACHMENT_LIMITS,
  readConversionAttachments,
} from "./conversion-attachments.js";

const engine = createFakeDocEngine();
it("reads native PDF, converts Word through PDF, and OCRs scans", async () => {
  for (const [filename, bytes, expected] of [
    ["native.pdf", Buffer.from("%PDF-1.4\nNative supporting agreement"), "native_layer"],
    ["terms.docx", fakeComparisonDocx(), "converted"],
    ["scan.pdf", fakeImageOnlyPdf("scanned agreement"), "ocr"],
  ] as const) {
    const read = await extractAttachment(engine, filename, bytes);
    expect(read.method).toBe(expected);
    expect(read.text.length).toBeGreaterThan(16);
    if (expected === "converted") expect(read.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
  }
});
it("omits unsupported formats and rejects malformed files without inventing text", async () => {
  expect(await extractAttachment(engine, "sheet.xlsx", Buffer.from("PK\x03\x04"))).toMatchObject({
    status: "unsupported",
    text: "",
  });
  await expect(extractAttachment(engine, "broken.pdf", Buffer.from("not a PDF"))).rejects.toThrow(
    SourceUnreadableError,
  );
});
it("reads the end of a document beyond the former individual and total text limits", async () => {
  const large = {
    ...engine,
    extractPdfText: async () => "a".repeat(200_000) + "The final schedule governs notices.",
  };
  const read = await extractAttachment(large, "large.pdf", Buffer.from("%PDF-1.4"));
  expect(read.status).toBe("readable");
  expect(read.text).toHaveLength(200_000 + "The final schedule governs notices.".length);
  expect(read.text.endsWith("The final schedule governs notices.")).toBe(true);
});

it("keeps useful sources after failures and reads attachments beyond the former count limit", async () => {
  const sources = Array.from({ length: 22 }, (_, i) => ({
    id: `attachment:${i}`,
    revision: `revision-${i}`,
    label: `${i}.pdf`,
    fileRef: `local:test/${i}`,
    restricted: false,
    versionId: null,
  }));
  const reads = await readConversionAttachments(
    {
      docEngine: engine,
      storage: {
        driver: "local",
        put: async () => {
          throw new Error("No rendition expected");
        },
        delete: async () => {},
        get: async (ref) => {
          if (ref.endsWith("/0")) throw new Error("Missing source");
          return Readable.from([Buffer.from("%PDF-1.4 Native paper")]);
        },
      },
    },
    sources,
    "draft",
  );
  expect(reads[0]!.status).toBe("unreadable");
  expect(reads[1]!.status).toBe("readable");
  expect(reads).toHaveLength(22);
  expect(reads.slice(1).every((read) => read.status === "readable")).toBe(true);
});

it("ends a hung source read at its runtime bound and continues with readable paper", async () => {
  vi.useFakeTimers();
  try {
    const pending = readConversionAttachments(
      {
        docEngine: engine,
        storage: {
          driver: "local",
          put: async () => {
            throw new Error("No rendition expected");
          },
          delete: async () => {},
          get: async (ref) =>
            ref.endsWith("/0")
              ? new Promise<Readable>(() => {})
              : Readable.from([Buffer.from("%PDF-1.4 Native paper")]),
        },
      },
      [0, 1].map((i) => ({
        id: `attachment:${i}`,
        revision: `revision-${i}`,
        label: `${i}.pdf`,
        fileRef: `local:test/${i}`,
        restricted: false,
        versionId: null,
      })),
      "draft",
    );
    await vi.advanceTimersByTimeAsync(ATTACHMENT_LIMITS.sourceRuntimeMs);
    expect((await pending).map((r) => [r.status, r.reason])).toEqual([
      ["omitted", "runtime_limit"],
      ["readable", undefined],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("reports an oversized original without losing the next readable attachment", async () => {
  const reads = await readConversionAttachments(
    {
      docEngine: engine,
      storage: {
        driver: "local",
        put: async () => {
          throw new Error("No rendition expected");
        },
        delete: async () => {},
        get: async (ref) =>
          Readable.from([
            ref.endsWith("/0")
              ? Buffer.alloc(ATTACHMENT_LIMITS.bytes + 1)
              : Buffer.from("%PDF-1.4 Native paper"),
          ]),
      },
    },
    [0, 1].map((i) => ({
      id: `attachment:${i}`,
      revision: `revision-${i}`,
      label: `${i}.pdf`,
      fileRef: `local:test/${i}`,
      restricted: false,
      versionId: null,
    })),
    "draft",
  );
  expect(reads[0]).toMatchObject({ status: "omitted", reason: "byte_limit", text: "" });
  expect(reads[1]!.status).toBe("readable");
});

it("stores a Word rendition by generated key and skips restricted paper without reading it", async () => {
  const put = vi.fn(async () => "local:rendition");
  const get = vi.fn(async () => Readable.from([fakeComparisonDocx()]));
  const reads = await readConversionAttachments(
    { docEngine: engine, storage: { driver: "local", put, get, delete: async () => {} } },
    [false, true].map((restricted, index) => ({
      id: `attachment:${index}`,
      revision: "rev",
      label: "../../terms.docx",
      fileRef: `local:source/${index}`,
      restricted,
      versionId: null,
    })),
    "draft",
  );
  expect(reads[0]).toMatchObject({
    status: "readable",
    method: "converted",
    previewRef: "local:rendition",
  });
  expect(reads[1]).toMatchObject({ status: "omitted", reason: "restricted", text: "" });
  expect(get.mock.calls).toEqual([["local:source/0"]]);
  expect(put).toHaveBeenCalledWith(
    expect.stringMatching(/^conversion-drafts\/draft\/[\da-f-]+\.pdf$/),
    expect.any(Readable),
  );
});

it("deletes a rendition whose storage write finishes after the source deadline", async () => {
  vi.useFakeTimers();
  try {
    let finishPut!: (ref: string) => void;
    const put = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishPut = resolve;
        }),
    );
    const remove = vi.fn(async () => {});
    const pending = readConversionAttachments(
      {
        docEngine: engine,
        storage: {
          driver: "local",
          put,
          delete: remove,
          get: async () => Readable.from([fakeComparisonDocx()]),
        },
      },
      [
        {
          id: "attachment:1",
          revision: "rev",
          label: "terms.docx",
          fileRef: "local:source",
          restricted: false,
          versionId: null,
        },
      ],
      "draft",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(put).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(ATTACHMENT_LIMITS.sourceRuntimeMs);
    expect(await pending).toMatchObject([{ status: "omitted", reason: "runtime_limit" }]);
    finishPut("local:late-rendition");
    await vi.advanceTimersByTimeAsync(0);
    expect(remove).toHaveBeenCalledWith("local:late-rendition");
  } finally {
    vi.useRealTimers();
  }
});

it("does not charge late bytes from a timed-out stream against following attachments", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const late = new Readable({ read() {} });
  vi.spyOn(late, Symbol.asyncIterator).mockImplementation(async function* () {
    await held;
    yield Buffer.alloc(ATTACHMENT_LIMITS.bytes + 1);
    return undefined;
  });
  try {
    const pending = readConversionAttachments(
      {
        docEngine: engine,
        storage: {
          driver: "local",
          put: async () => "unused",
          delete: async () => {},
          get: async (ref) => {
            if (ref === "0") return late;
            release();
            await Promise.resolve();
            return Readable.from([Buffer.from("%PDF-1.4 Native paper")]);
          },
        },
      },
      [0, 1, 2].map((id) => ({
        id: String(id),
        revision: "rev",
        label: `${id}.pdf`,
        fileRef: String(id),
        restricted: false,
        versionId: null,
      })),
      "draft",
    );
    await vi.advanceTimersByTimeAsync(ATTACHMENT_LIMITS.sourceRuntimeMs);
    expect((await pending).map((read) => read.status)).toEqual(["omitted", "readable", "readable"]);
  } finally {
    release();
    vi.useRealTimers();
  }
});
