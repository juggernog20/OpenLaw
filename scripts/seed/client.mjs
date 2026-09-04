/* The HTTP client the demo seed drives the instance through.
 *
 * The seed writes nothing to Postgres directly. Everything goes through
 * the same API the app uses, so the instance it leaves behind has the
 * activity entries, notifications, search vectors, numbering and derived
 * documents a real one has. A row written behind the API would be a row
 * with no history, and the history is half of what a UX review looks at.
 *
 * One `Session` is one signed-in person: its own cookie jar, its own
 * identity. Records the seed creates are therefore attributed to whoever
 * would plausibly have created them.
 */

const DEFAULT_BASE_URL = process.env.SEED_BASE_URL ?? "http://localhost:3000";

/** How many times a request is retried before the seed gives up. */
const MAX_ATTEMPTS = 4;

/** A refusal the API made on purpose, with the problem document it sent. */
export class ApiError extends Error {
  constructor(method, path, status, body) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    super(`${method} ${path} answered ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function parseSetCookie(headers) {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const pairs = [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    if (index > 0) pairs.push([pair.slice(0, index).trim(), pair.slice(index + 1).trim()]);
  }
  return pairs;
}

/**
 * A signed-in identity. `jar` accumulates cookies across calls, which is
 * what keeps a session a session.
 */
export class Session {
  constructor(label, baseUrl = DEFAULT_BASE_URL) {
    this.label = label;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.jar = new Map();
    /** Filled in by `signIn`, so callers can attribute records to people. */
    this.user = null;
  }

  get cookieHeader() {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  async request(method, path, { json, form, headers = {}, expect } = {}) {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const sent = { ...headers };
    if (this.jar.size > 0) sent.cookie = this.cookieHeader;
    let body;
    if (json !== undefined) {
      sent["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      body = form;
    }

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response;
      try {
        response = await fetch(url, { method, headers: sent, body, redirect: "manual" });
      } catch (error) {
        // A watch process restarting mid-seed drops the connection. That
        // is worth waiting out; a refusal is not.
        lastError = error;
        await pause(attempt * 400);
        continue;
      }

      for (const [name, value] of parseSetCookie(response.headers)) this.jar.set(name, value);

      const payload = await readBody(response);
      if (response.ok || (expect && expect.includes(response.status))) {
        return { status: response.status, body: payload, headers: response.headers };
      }
      // 5xx and 429 are the instance being busy, which a seed run causes
      // plenty of. Everything else is a refusal, and retrying it would
      // only hide the mistake that earned it.
      if (response.status < 500 && response.status !== 429) {
        throw new ApiError(method, path, response.status, payload);
      }
      lastError = new ApiError(method, path, response.status, payload);
      await pause(attempt * 600);
    }
    throw lastError;
  }

  get(path, options) {
    return this.request("GET", path, options);
  }

  post(path, json, options) {
    return this.request("POST", path, { json, ...options });
  }

  patch(path, json, options) {
    return this.request("PATCH", path, { json, ...options });
  }

  put(path, json, options) {
    return this.request("PUT", path, { json, ...options });
  }

  upload(path, form, options) {
    return this.request("POST", path, { form, ...options });
  }

  /** The body of a successful call, which is what almost every caller wants. */
  async json(method, path, payload) {
    const { body } = await this.request(
      method,
      path,
      payload === undefined ? {} : { json: payload },
    );
    return body;
  }
}

async function readBody(response) {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * The seed makes thousands of calls, and one at a time takes long enough
 * that nobody would re-run it. The limit is there because the API is one
 * watch process on a laptop, not a cluster.
 */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Waits until `probe` answers something truthy, or gives up loudly. */
export async function waitFor(what, probe, { timeoutMs = 60_000, everyMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const answer = await probe();
    if (answer) return answer;
    if (Date.now() > deadline) throw new Error(`${what} did not happen within ${timeoutMs}ms.`);
    await pause(everyMs);
  }
}

export { DEFAULT_BASE_URL };
