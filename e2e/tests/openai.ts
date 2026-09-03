// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The OpenAI-compatible stand-in used by the M31 built-stack demo.
 *
 * The connector stores this server's base URL, so Compose needs no
 * provider-specific environment variable. The worker reaches the host
 * through compose.dev.yml's existing host.docker.internal mapping.
 *
 * The extraction reply waits for the test to release it. This gives a
 * second browser time to open the Contract while the run is pending,
 * then proves the completion frame updates that open record.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const DEMO_CONTRACT_LINES = [
  "M31 SERVICES AGREEMENT",
  "This Contract is effective on January 15, 2026.",
  "The initial term ends on January 14, 2027.",
  "The term renews automatically for successive twelve-month periods.",
  "Either party may stop renewal by giving 90 days written notice.",
  "The annual Contract value is USD 125,000.",
  "The primary Counterparty is Northstar Systems LLC.",
] as const;

const CANNED_EXTRACTION = {
  term_type: {
    value: "auto_renew",
    evidence: "The term renews automatically for successive twelve-month periods.",
  },
  effective_date: {
    value: "2026-01-15",
    evidence: "This Contract is effective on January 15, 2026.",
  },
  expiry_date: {
    value: "2027-01-14",
    evidence: "The initial term ends on January 14, 2027.",
  },
  renewal_period_months: {
    value: 12,
    evidence: "The term renews automatically for successive twelve-month periods.",
  },
  notice_period_days: {
    value: 90,
    evidence: "Either party may stop renewal by giving 90 days written notice.",
  },
  value: {
    value: { amount: 12_500_000, currency: "USD", cadence: "annually" },
    evidence: "The annual Contract value is USD 125,000.",
  },
  counterparty: {
    value: "Northstar Systems LLC",
    evidence: "The primary Counterparty is Northstar Systems LLC.",
  },
} as const;

interface ChatRequest {
  model?: unknown;
  messages?: { role?: unknown; content?: unknown }[];
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function chatContent(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const messages = (body as ChatRequest).messages;
  const content = messages?.find((message) => message.role === "user")?.content;
  return typeof content === "string" ? content : null;
}

function modelName(body: unknown): string {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return "openlaw-e2e";
  const model = (body as ChatRequest).model;
  return typeof model === "string" ? model : "openlaw-e2e";
}

/** A small PDF with a native text layer containing DEMO_CONTRACT_LINES. */
export function demoContractPdf(): Buffer {
  const literal = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const text = [
    "BT",
    "/F1 12 Tf",
    "72 740 Td",
    "18 TL",
    ...DEMO_CONTRACT_LINES.flatMap((line, index) => [
      `(${literal(line)}) Tj`,
      ...(index === DEMO_CONTRACT_LINES.length - 1 ? [] : ["T*"]),
    ]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text, "ascii")} >>\nstream\n${text}\nendstream`,
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let length = chunks[0]!.byteLength;
  for (const [index, body] of objects.entries()) {
    offsets.push(length);
    const object = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "ascii");
    chunks.push(object);
    length += object.byteLength;
  }
  const xrefAt = length;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefAt),
    "%%EOF",
    "",
  ].join("\n");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}

export class OpenAiStub {
  readonly #server: Server;
  readonly #apiKey: string;
  #port = 0;
  #releaseExtraction!: () => void;
  readonly #extractionReleased = new Promise<void>((resolve) => {
    this.#releaseExtraction = resolve;
  });
  #noteExtraction!: () => void;
  readonly #extractionSeen = new Promise<void>((resolve) => {
    this.#noteExtraction = resolve;
  });
  #extractionCount = 0;

  private constructor(apiKey: string) {
    this.#apiKey = apiKey;
    this.#server = createServer((request, response) => {
      void this.#answer(request, response).catch((error: unknown) => {
        if (!response.headersSent) sendJson(response, 500, { error: { message: String(error) } });
        else response.destroy(error instanceof Error ? error : undefined);
      });
    });
  }

  static async start(options: { apiKey: string }): Promise<OpenAiStub> {
    const stub = new OpenAiStub(options.apiKey);
    await new Promise<void>((resolve, reject) => {
      stub.#server.once("error", reject);
      stub.#server.listen(0, "0.0.0.0", () => {
        stub.#server.off("error", reject);
        resolve();
      });
    });
    const address = stub.#server.address() as AddressInfo;
    stub.#port = address.port;
    return stub;
  }

  get baseUrl(): string {
    return `http://host.docker.internal:${this.#port}/v1`;
  }

  get extractionCount(): number {
    return this.#extractionCount;
  }

  async waitForExtraction(timeoutMs = 180_000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.#extractionSeen,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The worker did not reach the OpenAI-compatible stand-in.")),
          timeoutMs,
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  releaseExtraction(): void {
    this.#releaseExtraction();
  }

  async close(): Promise<void> {
    this.releaseExtraction();
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async #answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      sendJson(response, 404, { error: { message: "Unknown OpenAI-compatible route." } });
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.#apiKey}`) {
      sendJson(response, 401, { error: { message: "The API key is not valid." } });
      return;
    }

    const body = await readJson(request);
    const prompt = chatContent(body);
    if (!prompt) {
      sendJson(response, 400, { error: { message: "One user message is required." } });
      return;
    }

    let reply: string;
    if (prompt.includes('Reply with only the JSON object {"ok":true}.')) {
      reply = JSON.stringify({ ok: true });
    } else if (DEMO_CONTRACT_LINES.every((line) => prompt.includes(line))) {
      this.#extractionCount += 1;
      this.#noteExtraction();
      await this.#extractionReleased;
      reply = JSON.stringify(CANNED_EXTRACTION);
    } else {
      sendJson(response, 422, {
        error: { message: "The stand-in does not know this Contract text." },
      });
      return;
    }

    sendJson(response, 200, {
      id: "chatcmpl-openlaw-m31",
      object: "chat.completion",
      created: 0,
      model: modelName(body),
      choices: [
        { index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } },
      ],
    });
  }
}
