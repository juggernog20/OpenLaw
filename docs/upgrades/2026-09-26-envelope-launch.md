# Envelope launch and return (#1172)

Migration `0173_envelope-launch-return` adds a confirmation flag to Envelopes and a
separate table of hashed, expiring launch correlations. Existing Envelope statuses,
provider IDs, sent timestamps and executed-copy references retain their meaning.
Migration `0174_envelope-launch-timestamps` adds creation and update timestamps to
launch correlations, including installs that already applied 0173. Existing rows
receive the upgrade time; their hashes, expiry and consumption are unchanged.

The preparation feature switch stays off by default. When enabled, Continue to
DocuSign prepares the selected Version and Signers, then opens field placement in the
same tab. Send remains in DocuSign. Save returns to an unsent draft; a provider status
check after Send confirms the sent round. Open in DocuSign obtains another session
for that same draft. A failed or premature check displays Waiting for confirmation;
it never permits a second outstanding round. Sign-in interruption resumes through the
fixed signing return page without putting the correlation into localStorage or
sessionStorage. Return correlations expire after two hours and are single use.

Configure the application base URL to the browser-reachable OpenLaw origin. The
browser return uses `/api/v1/signing/return`; this is independent of Connect's public
webhook address. Polling retains its fifteen-minute per-Envelope read allowance. It
leaves a draft alone for at most fifteen minutes after a launch, reserving the next
eligible read for a prompt return. A prior poll can still hold that read allowance.
A send whose return was lost is confirmed on the next ordinary poll after the grace.
A new draft is also left alone for fifteen minutes after its creation, since the
creation response is its evidence. After that a draft is polled whether or not it was
ever launched, so a send made through the provider account with no browser session
still recovers. A launch made after either grace may find the allowance already spent
by a poll; its return then shows Waiting for confirmation until the next allowed check.

Protocol tests and a scripted browser stand-in establish application behavior only.
Before rollout, #1178 must record real DocuSign checks for recipient and message locks,
all document and page edit routes, field assignment, native save/close/discard,
missing-field validation, competing sessions, link expiry and any exposed scheduling.
No such native UI observation is claimed by this change. Live Connect remains tracked
separately in #888.
