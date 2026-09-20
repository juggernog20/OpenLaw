// SPDX-License-Identifier: AGPL-3.0-only

/** Real HTTP fixtures for the TECH-012 AI protocol-adapter contract tests. */

import { z } from "zod";
import { createServer } from "node:http";
import { once } from "node:events";
import { createAiProvider } from "../lib/ai/index.js";
import type { AiProtocol } from "@openlaw/db";

const schema = z.object({ properties: z.record(z.string(), z.unknown()) });
const messages = z.object({ messages: z.array(z.object({ content: z.string() })).min(1) });
const requestSchemas = {
  openai_chat_completions: messages
    .extend({
      response_format: z.object({ json_schema: z.object({ schema }) }),
    })
    .transform((body) => ({
      prompt: body.messages[0]!.content,
      schema: body.response_format.json_schema.schema,
    })),
  anthropic_messages: messages
    .extend({
      output_config: z.object({ format: z.object({ schema }) }),
    })
    .transform((body) => ({
      prompt: body.messages[0]!.content,
      schema: body.output_config.format.schema,
    })),
  gemini: z
    .object({
      contents: z.array(z.object({ parts: z.array(z.object({ text: z.string() })).min(1) })).min(1),
      generationConfig: z.object({ responseJsonSchema: schema }),
    })
    .transform((body) => ({
      prompt: body.contents[0]!.parts[0]!.text,
      schema: body.generationConfig.responseJsonSchema,
    })),
};

/** Serve each adapter the same slug-keyed reply through its real HTTP protocol. */
export async function startAiResponseServer(
  protocol: AiProtocol,
  answer: (slug: string) => Record<string, unknown>,
) {
  const prompts: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = requestSchemas[protocol].parse(JSON.parse(Buffer.concat(chunks).toString()));
      prompts.push(body.prompt);
      const text = JSON.stringify(
        Object.fromEntries(Object.keys(body.schema.properties).map((slug) => [slug, answer(slug)])),
      );
      const envelope =
        protocol === "anthropic_messages"
          ? { stop_reason: "end_turn", content: [{ type: "text", text }] }
          : protocol === "gemini"
            ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }
            : { choices: [{ finish_reason: "stop", message: { content: text } }] };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(envelope));
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Malformed AI fixture request." }));
    }
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
