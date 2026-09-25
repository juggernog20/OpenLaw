# Envelope preparation — API upgrade note

This change accompanies #1171 under #1170. Interactive preparation remains
disabled by default until the feature's final cutover. Recovery of interrupted
creation belongs to #1174 and must land before the feature reaches `dev`.

## External API clients

Envelope responses now allow `sentAt` to be `null` instead of always containing
an ISO date-time string. This is a breaking response-contract change for clients
that require a timestamp. A null value means OpenLaw has no confirmed Sent
timestamp; it does not prove that the provider sent no invitation.

The status vocabulary adds `preparing`, `draft`, and `preparation_failed`.
`preparing` reserves an operation whose creation is pending or uncertain;
`draft` identifies a confirmed unsent Envelope; `preparation_failed` identifies
a confirmed creation failure. An Envelope's `draft` status is separate from the
Contract Stage `draft`.

Update response validators and status handling, check for null before parsing
or formatting `sentAt`, and regenerate clients from `apps/api/openapi.json`.
The repository's generated API client and Signatures UI already support these
values. The change applies to Envelope responses from signing reads, direct
send, preparation, and Void.

Even with interactive preparation disabled, an interrupted legacy direct send
can leave a `preparing` Envelope with `sentAt: null`. A matching idempotent retry
returns the existing operation rather than sending again. Keep the live
reservation until provider evidence resolves the outcome; elapsed time alone
is not evidence that creation failed.

## Existing records and migration

The expand migration `0172_durable-envelope-preparation.sql` preserves existing
`sent`, `signed`, `declined`, and `voided` rows, their Sent timestamps, Document
Version references, and executed-copy references. Successful direct sends
continue to return a Sent timestamp.

The live-Envelope rule now covers `preparing`, `draft`, and `sent`. An unresolved
creation therefore blocks another send or preparation and blocks connector
removal. The durable provider transaction identity, account, source, and Signer
snapshot remain available for recovery in #1174; do not delete an uncertain
reservation to permit another attempt.
