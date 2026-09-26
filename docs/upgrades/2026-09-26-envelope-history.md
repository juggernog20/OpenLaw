# Envelope history and Signer erasure

The expanded lifecycle keeps existing Envelope IDs, real timestamps, original
Version references and executed-copy links. Old rows keep their Sent ordering
and recorded sender. The upgrade does not add invented preparation or session
Activity, provider accounts or sending identities. Existing sent Envelopes can
still use Void. Manual hand-off and the direct-send API remain available.

New preparation history names who started it and who requested each editing
session. Confirmed provider outcomes remain separate. A shared provider user
does not establish which human sent. Signatures names the preparer as the
preparer, and that person remains in the Void audience and the executed-copy
author field. Drafts have no Sent timestamp or sent/signed counter contribution.

An Administrator's external-Signer erasure now also clears the retained subject
on each affected Envelope. Subjects are free text and can identify a Signer.
Preparation Activity holds references and counts, not a copy of Signer names or
addresses. Direct-send Activity keeps erased positions as tombstones even when
erasure occurs while the provider is answering. Matching request retries and
later recovery keep the erasure. Internal-user treatment is unchanged.

This erases retained OpenLaw Signer metadata. It does not remove names from
provider-held fields or documents, executed PDFs, or already exported logs.
Those copies follow the existing separate erasure procedures and operator
retention rules in [Deployment](../DEPLOYMENT.md).
