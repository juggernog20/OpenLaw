// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from "node:http";
import { once } from "node:events";
import { createAiProvider } from "../lib/ai/index.js";
import type { AiProtocol } from "@openlaw/db";

/** Serve each adapter the same slug-keyed reply through its real HTTP protocol. */
export async function startAiResponseServer(
  protocol: AiProtocol,
  answer: (slug: string) => Record<string, unknown>,
) {
  const prompts: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      messages?: { content: string }[];
      contents?: { parts: { text: string }[] }[];
      response_format?: { json_schema: { schema: { properties: object } } };
      output_config?: { format: { schema: { properties: object } } };
      generationConfig?: { responseJsonSchema: { properties: object } };
    };
    prompts.push(body.messages?.[0]?.content ?? body.contents?.[0]?.parts[0]?.text ?? "");
    const schema =
      body.response_format?.json_schema.schema ??
      body.output_config?.format.schema ??
      body.generationConfig!.responseJsonSchema;
    const text = JSON.stringify(
      Object.fromEntries(Object.keys(schema.properties).map((slug) => [slug, answer(slug)])),
    );
    const envelope =
      protocol === "anthropic_messages"
        ? { stop_reason: "end_turn", content: [{ type: "text", text }] }
        : protocol === "gemini"
          ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }
          : { choices: [{ finish_reason: "stop", message: { content: text } }] };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(envelope));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server port");
  return {
    prompts,
    provider: createAiProvider({
      preset: "custom",
      protocol,
      model: "invalid-answer-test",
      apiKey: "fixture",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    }),
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
