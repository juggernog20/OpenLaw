/* An OpenAI-compatible stand-in, so the seeded instance holds real
 * Analysis runs (CTR-008).
 *
 * The Unverified marker is one of the more interesting things on a
 * Contract record, and it only exists where an Analysis run wrote a
 * value. A run needs a provider, and pointing a seed script at a paid
 * model to fill a demo database would be absurd. So the seed runs its
 * own provider for the length of the run.
 *
 * It is not a fake in the sense of answering anything: it answers each
 * Contract's own text. The seed registers what it wrote into a document
 * before it uploads it, and this server answers the extraction with
 * exactly those values. What the instance ends up holding is therefore a
 * run whose evidence quotes the document it read.
 *
 * The connector stores this server's address, so nothing in the app's
 * environment has to change for it to be reached.
 */

import { createServer } from "node:http";

const PROBE_PROMPT = 'Reply with only the JSON object {"ok":true}.';

/** Everything the stand-in knows how to read, keyed by a phrase in the text. */
const registry = new Map();

/**
 * Teaches the stand-in one document.
 *
 * `marker` has to appear in the text the extraction is run over. The
 * Contract's own reference does, and is unique per Contract.
 */
export function registerDocument(marker, answers) {
  registry.set(marker, answers);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** The slugs the prompt asked for, read out of its own Fields block. */
function requestedSlugs(prompt) {
  const block = prompt.split("\nFields:\n")[1]?.split("\n\nContract text:")[0] ?? "";
  return block
    .split("\n")
    .map((line) => /^- ([a-z0-9_]+):/.exec(line.trim())?.[1])
    .filter(Boolean);
}

/**
 * Starts the stand-in on `port` and answers until it is closed.
 *
 * `stats` counts what happened, so the seed can report how many runs
 * actually reached a provider rather than assuming they did.
 */
export async function startAiStub({ port = 8130, apiKey = "seed-local-key" } = {}) {
  const stats = { probes: 0, extractions: 0, unknown: 0 };

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || !request.url?.startsWith("/v1/chat/completions")) {
        sendJson(response, 404, { error: { message: "Unknown route." } });
        return;
      }
      if (request.headers.authorization !== `Bearer ${apiKey}`) {
        sendJson(response, 401, { error: { message: "The API key is not valid." } });
        return;
      }
      const body = await readJson(request);
      const prompt = body?.messages?.find((message) => message.role === "user")?.content;
      if (typeof prompt !== "string") {
        sendJson(response, 400, { error: { message: "One user message is required." } });
        return;
      }

      let reply;
      if (prompt.includes(PROBE_PROMPT)) {
        stats.probes += 1;
        reply = JSON.stringify({ ok: true });
      } else {
        const marker = [...registry.keys()].find((key) => prompt.includes(key));
        if (!marker) {
          stats.unknown += 1;
          sendJson(response, 422, {
            error: { message: "The stand-in has not been taught this contract." },
          });
          return;
        }
        stats.extractions += 1;
        const known = registry.get(marker);
        const asked = requestedSlugs(prompt);
        // Answer only what was asked. A slug the document says nothing
        // about is answered null, which is the honest reply and the one
        // the writer is built to handle.
        const answer = {};
        for (const slug of asked) answer[slug] = known[slug] ?? { value: null, evidence: null };
        reply = JSON.stringify(answer);
      }

      sendJson(response, 200, {
        id: "chatcmpl-openlaw-seed",
        object: "chat.completion",
        created: 0,
        model: typeof body?.model === "string" ? body.model : "openlaw-seed",
        choices: [
          { index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } },
        ],
      });
    })().catch((error) => {
      if (!response.headersSent) sendJson(response, 500, { error: { message: String(error) } });
      else response.destroy();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback only. It answers without checking who is asking beyond a
    // fixed key, and it has no business being on the network.
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey,
    stats,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
