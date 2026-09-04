/* Reading the mail the instance sends, so the seed can finish the flows
 * that only complete through a link.
 *
 * Two accounts are born from an email and nothing else: a staff member
 * activates through the set-password link, and a Business User comes
 * into existence when a magic link is redeemed (DD-010). The seed
 * therefore has to read the mailbox, exactly as the person would.
 *
 * Mailpit catches everything the dev loop sends and publishes it on
 * :8025.
 */

import { pause, waitFor } from "./client.mjs";

const MAILPIT_URL = (process.env.SEED_MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");

async function mailpit(path) {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} for ${path}.`);
  return response.json();
}

/** Empties the catcher, so a re-seed never reads a previous run's link. */
export async function clearMailbox() {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Mailpit refused to clear: ${response.status}.`);
}

/** True when Mailpit is up, so the seed can say so before it starts. */
export async function mailpitIsUp() {
  try {
    await mailpit("/api/v1/messages?limit=1");
    return true;
  } catch {
    return false;
  }
}

/**
 * The newest message sent to `address`, waited for.
 *
 * `subject` narrows the wait. An address that has already been written
 * to satisfies "a message exists" straight away, so a caller expecting
 * the *next* message has to name it.
 */
export async function waitForMail(address, subject) {
  const message = await waitFor(`mail to ${address}`, async () => {
    const found = await mailpit(`/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const match = (found.messages ?? []).find((m) => !subject || subject.test(m.Subject));
    if (!match) return null;
    // The search result carries no body; the message read does.
    return mailpit(`/api/v1/message/${match.ID}`);
  });
  // Delivery and body write are not one act in Mailpit's store; a body
  // that arrives empty is worth one more look rather than a crash.
  if (!message.Text) {
    await pause(250);
    return waitForMail(address, subject);
  }
  return { subject: message.Subject, text: message.Text };
}

/** The first link in `text` whose path matches `path`. */
export function extractLink(text, path) {
  const match = text.match(new RegExp(`https?://[^\\s<>"')]*${path}[^\\s<>"')]*`));
  if (!match) throw new Error(`No ${path} link in the message.`);
  // A plain-text mail can end a URL with a full stop; the token never does.
  return match[0].replace(/[.,]+$/, "");
}

export { MAILPIT_URL };
