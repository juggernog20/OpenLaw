/**
 * Copies text to the clipboard. The promise rejects when the copy fails.
 *
 * Browsers leave `navigator.clipboard` undefined outside a secure
 * context, for example on a plain-HTTP address that is not loopback.
 * A direct `navigator.clipboard.writeText` call then throws before it
 * returns a promise, so a `.catch` never runs. This helper turns that
 * case into a rejection, and the caller shows its "Copy failed" state.
 */
export async function copyText(text: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) throw new Error("The clipboard is not available.");
  await clipboard.writeText(text);
}
