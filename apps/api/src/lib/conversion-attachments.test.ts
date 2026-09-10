// SPDX-License-Identifier: AGPL-3.0-only
import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { createFakeDocEngine, fakeImageOnlyPdf, fakeComparisonDocx } from "./doc-engine/fake.js";
import { extractAttachment, ATTACHMENT_LIMITS } from "./conversion-attachments.js";

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
  await expect(extractAttachment(engine, "broken.pdf", Buffer.from("not a PDF"))).rejects.toThrow();
});
it("bounds extracted text independently for each source", async () => {
  const large = {
    ...engine,
    extractPdfText: async () => "a".repeat(ATTACHMENT_LIMITS.characters + 10),
  };
  const read = await extractAttachment(large, "large.pdf", Buffer.from("%PDF-1.4"));
  expect(read.status).toBe("truncated");
  expect(read.text).toHaveLength(ATTACHMENT_LIMITS.characters);
});

it("keeps useful sources after failures and enforces the source budget", async () => {
  const { readConversionAttachments } = await import("./conversion-attachments.js");
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
    180_000,
  );
  expect(reads[0]!.status).toBe("unreadable");
  expect(reads[1]!.status).toBe("readable");
  expect(reads.slice(20).map((r) => r.reason)).toEqual(["source_limit", "source_limit"]);
});

it("ends a hung source read at its runtime bound and continues with readable paper", async () => {
  const { vi } = await import("vitest");
  const { readConversionAttachments } = await import("./conversion-attachments.js");
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
      180_000,
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
  const { readConversionAttachments } = await import("./conversion-attachments.js");
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
    180_000,
  );
  expect(reads[0]).toMatchObject({ status: "omitted", reason: "byte_limit", text: "" });
  expect(reads[1]!.status).toBe("readable");
});
