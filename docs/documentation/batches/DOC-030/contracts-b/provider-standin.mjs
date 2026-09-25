// DOC-030 contracts-b: a copy of the DOC-029 analysis-standin provider stand-in
// (DOC-029/analysis-standin/provider-standin.mjs). Two changes: at 067c1646 the
// structured extraction appends a "Response JSON Schema" block after the Sources
// JSON, so sourcesOf() cuts the prompt there before parsing; and stats keep the
// shape (length, source count, tail) of the last prompt it could not answer.
// A local OpenAI-compatible provider stand-in.
//
// It runs in its own container on this lab's backend network only. It answers
// an extraction with the answers the walkthrough registered for a marker that
// appears in the Document text. It does not call any real provider.
//
// Environment (set by the walkthrough, never written to the repository):
//   STANDIN_API_KEY        the Bearer key the AI connector sends
//   STANDIN_CONTROL_TOKEN  the header value the control routes require
//
// Control routes (x-control-token header required):
//   POST /control/register {marker, answers}   answers keyed by slug
//   POST /control/pause    {paused: boolean}   hold extraction replies
//   POST /control/malformed {count}            next <count> replies are not JSON
//   POST /control/fallback {enabled, cite}     answer unknown text: every slug null,
//                                              except cite [{slug, needle}] quoted
//                                              from the source that contains needle
//   GET  /control/stats                        request counts and last targets
import { createServer } from "node:http";

const apiKey = process.env.STANDIN_API_KEY;
const controlToken = process.env.STANDIN_CONTROL_TOKEN;
if (!apiKey || !controlToken)
  throw new Error("STANDIN_API_KEY and STANDIN_CONTROL_TOKEN are required");

const PROBE_PROMPT = 'Reply with only the JSON object {"ok":true}.';
const registry = new Map();
const stats = { probes: 0, extractions: 0, unknown: 0, malformed: 0, byMarker: {}, last: null };
let paused = false;
let malformedLeft = 0;
let fallback = { enabled: false, cite: [] };
const waiting = [];

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function requestedSlugs(prompt) {
  const block = prompt.split("\nFields:\n")[1] ?? "";
  return [...block.matchAll(/^- ([a-z0-9_]+(?::[a-z_]+)?): /gm)].map((match) => match[1]);
}

function sourcesOf(prompt) {
  const index = prompt.lastIndexOf("\nSources:\n");
  if (index < 0) return [];
  let json = prompt.slice(index + "\nSources:\n".length);
  const schemaAt = json.indexOf("\n\nResponse JSON Schema");
  if (schemaAt >= 0) json = json.slice(0, schemaAt);
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function waitIfPaused() {
  if (!paused) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://standin");
    if (url.pathname.startsWith("/control/")) {
      if (request.headers["x-control-token"] !== controlToken) return send(response, 403, {});
      if (request.method === "GET" && url.pathname === "/control/stats")
        return send(response, 200, { ...stats, paused, waiting: waiting.length, malformedLeft });
      const body = await readJson(request);
      if (url.pathname === "/control/register") {
        registry.set(body.marker, body.answers);
        return send(response, 200, { registered: registry.size });
      }
      if (url.pathname === "/control/pause") {
        paused = !!body.paused;
        if (!paused) while (waiting.length) waiting.shift()();
        return send(response, 200, { paused });
      }
      if (url.pathname === "/control/fallback") {
        fallback = { enabled: !!body.enabled, cite: Array.isArray(body.cite) ? body.cite : [] };
        return send(response, 200, fallback);
      }
      if (url.pathname === "/control/malformed") {
        malformedLeft = Number(body.count ?? 1);
        return send(response, 200, { malformedLeft });
      }
      return send(response, 404, {});
    }
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions"))
      return send(response, 404, { error: { message: "Unknown route." } });
    if (request.headers.authorization !== `Bearer ${apiKey}`)
      return send(response, 401, { error: { message: "The API key is not valid." } });
    const body = await readJson(request);
    const prompt = body?.messages?.find((message) => message.role === "user")?.content;
    if (typeof prompt !== "string")
      return send(response, 400, { error: { message: "One user message is required." } });

    let reply;
    if (prompt.includes(PROBE_PROMPT)) {
      stats.probes += 1;
      reply = JSON.stringify({ ok: true });
    } else {
      const sources = sourcesOf(prompt);
      const text = sources.map((source) => source.text ?? "").join("\n");
      // Longest marker first, so "M-1" never answers for "M-12".
      const marker = [...registry.keys()]
        .sort((a, b) => b.length - a.length)
        .find((key) => text.includes(key));
      if (!marker && !fallback.enabled) {
        stats.unknown += 1;
        stats.lastUnknown = { length: prompt.length, sources: sources.length, tail: prompt.slice(-300) };
        return send(response, 422, {
          error: { message: "The stand-in has no answers for this text." },
        });
      }
      const asked = requestedSlugs(prompt);
      stats.extractions += 1;
      const key = marker ?? "(fallback)";
      stats.byMarker[key] = (stats.byMarker[key] ?? 0) + 1;
      stats.last = {
        marker: key,
        asked,
        sourceIds: sources.map((source) => source.id),
        sourceKinds: sources.map((source) => source.kind ?? null),
      };
      await waitIfPaused();
      if (malformedLeft > 0) {
        malformedLeft -= 1;
        stats.malformed += 1;
        reply = "The stand-in cannot answer in JSON this time.";
      } else if (!marker) {
        const answer = {};
        for (const slug of asked) answer[slug] = { value: null };
        for (const item of fallback.cite) {
          const source = sources.find((candidate) => (candidate.text ?? "").includes(item.needle));
          if (source && asked.includes(item.slug))
            answer[item.slug] = {
              value: item.needle,
              sourceId: source.id,
              evidence: item.needle,
              justification: "The source names this value.",
            };
        }
        reply = JSON.stringify(answer);
      } else {
        const known = registry.get(marker);
        const documentId = sources.find((source) => source.kind === "document")?.id;
        const answer = {};
        for (const slug of asked) {
          let entry = known[slug] ?? { value: null, evidence: null };
          if (slug === "key_dates:milestones" && Array.isArray(entry.value))
            entry = {
              ...entry,
              value: entry.value.map((item) => ({ ...item, sourceId: documentId })),
            };
          answer[slug] = entry;
        }
        reply = JSON.stringify(answer);
      }
    }
    send(response, 200, {
      id: "chatcmpl-doc029-standin",
      object: "chat.completion",
      created: 0,
      model: typeof body?.model === "string" ? body.model : "doc029-standin",
      choices: [
        { index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } },
      ],
    });
  })().catch((error) => {
    if (!response.headersSent) send(response, 500, { error: { message: String(error) } });
    else response.destroy();
  });
});

server.listen(8080, "0.0.0.0");
