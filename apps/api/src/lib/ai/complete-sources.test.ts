// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from "vitest";
import { extractCompleteSources, sourceSections } from "./complete-sources.js";
import type { AiProvider, AiSource } from "./provider.js";
const source = (text: string): AiSource => ({
  id: "document:1",
  revision: "v1",
  kind: "document",
  label: "Agreement",
  text,
});
const targets = [{ slug: "needed_by", prompt: "Extract the legal review deadline." }];
const provider = (extract: AiProvider["extract"]): AiProvider => ({
  preset: "openrouter",
  protocol: "openai_chat_completions",
  model: "test",
  probe: async () => {},
  extract,
});

it("covers every character and overlaps boundaries without losing the original source identity", () => {
  const text = "Start" + "x".repeat(210_000) + "Final schedule";
  const sections = sourceSections([source(text)]).flat();
  expect(sections).toHaveLength(4);
  expect(sections.map((s, i) => (i ? s.text.slice(1000) : s.text)).join("")).toBe(text);
  expect(sections.every((s) => s.id === "document:1" && s.revision === "v1")).toBe(true);
});

it("uses one call for a normal document and retains a justified finding after character 30,000", async () => {
  const quote = "Legal review is due September 21, 2026.";
  const extract = vi.fn<AiProvider["extract"]>(async () => [
    {
      slug: "needed_by",
      value: "2026-09-21",
      sourceId: "document:1",
      evidence: quote,
      justification: "This is the legal review deadline, distinct from signature.",
    },
  ]);
  const answers = await extractCompleteSources(
    provider(extract),
    [source("x".repeat(35_000) + quote)],
    targets,
  );
  expect(extract).toHaveBeenCalledOnce();
  expect(answers[0]).toMatchObject({
    value: "2026-09-21",
    justification: expect.stringContaining("legal review"),
    citations: [{ sourceId: "document:1", revision: "v1", quote }],
  });
});

it("reconciles later corrections with earlier findings and keeps their original citations", async () => {
  const first = "Review is due September 21, 2026.";
  const corrected = "Correction: the review deadline is September 22, 2026.";
  const extract = vi
    .fn<AiProvider["extract"]>()
    .mockResolvedValueOnce([
      { slug: "needed_by", value: "2026-09-21", sourceId: "document:1", evidence: first },
    ])
    .mockResolvedValueOnce([
      { slug: "needed_by", value: "2026-09-22", sourceId: "document:1", evidence: corrected },
    ])
    .mockResolvedValueOnce([
      {
        slug: "needed_by",
        value: "2026-09-22",
        justification: "The later passage explicitly corrects the deadline.",
        citations: [{ sourceId: "document:1", quote: corrected }],
      },
    ]);
  const result = await extractCompleteSources(
    provider(extract),
    [source(first + "x".repeat(65_000) + corrected)],
    targets,
  );
  expect(extract).toHaveBeenCalledTimes(3);
  expect(extract.mock.calls[2]![0]).toMatchObject([
    { id: "document:1", text: expect.stringContaining(first) },
  ]);
  expect(extract.mock.calls[2]![0]).toMatchObject([{ text: expect.stringContaining(corrected) }]);
  expect(result[0]).toMatchObject({
    value: "2026-09-22",
    citations: [{ sourceId: "document:1", revision: "v1", quote: corrected }],
  });
});

it("refuses to silently lose supported findings during reconciliation", async () => {
  const quote = "Review due October 1.";
  const extract = vi
    .fn<AiProvider["extract"]>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { slug: "needed_by", value: "2026-10-01", evidence: quote, sourceId: "document:1" },
    ])
    .mockResolvedValueOnce([]);
  await expect(
    extractCompleteSources(provider(extract), [source("x".repeat(65_000) + quote)], targets),
  ).rejects.toThrow("reconcile all document sections");
});
