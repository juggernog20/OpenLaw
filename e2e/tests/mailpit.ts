// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mailpit access for suites that exercise real email delivery (invites,
 * magic links). The dev overlay publishes Mailpit's REST API on :8025;
 * discovery is by polling that API — never by sleeping — and always
 * scoped to a per-run unique address, so the accumulated inbox of a
 * persistent instance (TECH-018) can never produce a false match.
 */

import { expect, type APIRequestContext } from "@playwright/test";

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

interface MailpitSearch {
  messages: { ID: string }[];
}

interface MailpitMessage {
  Subject: string;
  Text: string;
}

async function searchMailTo(request: APIRequestContext, address: string): Promise<MailpitSearch> {
  const search = await request.get(`${MAILPIT_URL}/api/v1/search`, {
    params: { query: `to:"${address}"` },
  });
  expect(search.ok()).toBe(true);
  return (await search.json()) as MailpitSearch;
}

/**
 * How many messages Mailpit holds for `address`, right now — the
 * anti-enumeration suites' proof that an ineligible request delivered
 * nothing (always sequenced after some later delivery has confirmed
 * the pipeline flushed).
 */
export async function mailCountTo(request: APIRequestContext, address: string): Promise<number> {
  return (await searchMailTo(request, address)).messages.length;
}

/**
 * Polls Mailpit until a message addressed to `address` exists and
 * returns the newest one's subject and plain-text body.
 */
export async function waitForMailTo(
  request: APIRequestContext,
  address: string,
): Promise<{ subject: string; text: string }> {
  let newestId: string | undefined;
  await expect
    .poll(
      async () => {
        const body = await searchMailTo(request, address);
        newestId = body.messages[0]?.ID;
        return body.messages.length;
      },
      { message: `an email to ${address} in Mailpit at ${MAILPIT_URL}`, timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  const detail = await request.get(`${MAILPIT_URL}/api/v1/message/${newestId}`);
  expect(detail.ok()).toBe(true);
  const message = (await detail.json()) as MailpitMessage;
  return { subject: message.Subject, text: message.Text };
}

/**
 * The first absolute URL in an email body whose path starts with
 * `pathPrefix` (e.g. "/auth/set-password"). Fails the test if the body
 * carries no such link.
 */
export function extractLink(text: string, pathPrefix: string): string {
  const candidates = text.match(/https?:\/\/\S+/g) ?? [];
  const link = candidates.find((candidate) => new URL(candidate).pathname.startsWith(pathPrefix));
  expect(link, `a link to ${pathPrefix} in:\n${text}`).toBeDefined();
  return link!;
}
