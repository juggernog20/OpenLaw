// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mailpit access for suites that exercise real email delivery (invites,
 * magic links). The dev overlay publishes Mailpit's REST API on :8025.
 * Discovery polls that API, never sleeps, and always scopes to a
 * per-run unique address, so the accumulated inbox of a persistent
 * instance (TECH-018) can never produce a false match.
 */

import { expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

const MailpitSearch = z.object({
  messages: z.array(z.object({ ID: z.string(), Subject: z.string() })),
});

const MailpitMessage = z.object({ Subject: z.string(), Text: z.string() });

async function searchMailTo(
  request: APIRequestContext,
  address: string,
): Promise<z.infer<typeof MailpitSearch>> {
  const search = await request.get(`${MAILPIT_URL}/api/v1/search`, {
    params: { query: `to:"${address}"` },
  });
  expect(search.ok()).toBe(true);
  return MailpitSearch.parse(await search.json());
}

/**
 * How many messages Mailpit holds for `address` right now. The
 * anti-enumeration suites use it to prove an ineligible request
 * delivered nothing. Always sequence it after some later delivery has
 * confirmed the pipeline flushed.
 */
export async function mailCountTo(request: APIRequestContext, address: string): Promise<number> {
  return (await searchMailTo(request, address)).messages.length;
}

/**
 * Polls Mailpit until a message addressed to `address` exists and
 * returns the newest one's subject and plain-text body.
 *
 * `subject` narrows the wait to the message actually being waited for.
 * Every per-run person was invited, so their address already satisfies
 * "a message exists". A bare wait would answer with the invite the
 * moment it is asked. A suite expecting the next message names it
 * (M18's demo waits for an approval request and for a morning briefing
 * on addresses whose set-password mail arrived minutes earlier).
 */
export async function waitForMailTo(
  request: APIRequestContext,
  address: string,
  subject?: RegExp,
): Promise<{ subject: string; text: string }> {
  let newestId: string | undefined;
  await expect
    .poll(
      async () => {
        const body = await searchMailTo(request, address);
        // Newest first, which is the order Mailpit answers in.
        const wanted = subject
          ? body.messages.filter((message) => subject.test(message.Subject))
          : body.messages;
        newestId = wanted[0]?.ID;
        return wanted.length;
      },
      {
        message: subject
          ? `an email to ${address} matching ${String(subject)} in Mailpit at ${MAILPIT_URL}`
          : `an email to ${address} in Mailpit at ${MAILPIT_URL}`,
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(0);

  const detail = await request.get(`${MAILPIT_URL}/api/v1/message/${newestId}`);
  expect(detail.ok()).toBe(true);
  const message = MailpitMessage.parse(await detail.json());
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
