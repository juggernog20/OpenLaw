# Envelope launch and return (#1172)

Migration `0173_envelope-launch-return` adds a confirmation flag to Envelopes and a
separate table of hashed, expiring launch correlations. Existing Envelope statuses,
provider IDs, sent timestamps and executed-copy references retain their meaning.

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
leaves a draft alone for fifteen minutes after a launch so a prompt return can confirm
at once; a send whose return was lost is confirmed on the next ordinary poll after that.

Protocol tests and a scripted browser stand-in establish application behavior only.
Before rollout, #1178 must record real DocuSign checks for recipient and message locks,
all document and page edit routes, field assignment, native save/close/discard,
missing-field validation, competing sessions, link expiry and any exposed scheduling.
No such native UI observation is claimed by this change. Live Connect remains tracked
separately in #888.
