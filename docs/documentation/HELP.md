# Help delivery and checks

Task: [#727](https://github.com/juggernog20/OpenLaw/issues/727).
Design: DES-073 and [PUBLISHING.md](PUBLISHING.md).

## Reading paths

The staff header opens `/help`. The Portal header opens `/portal/help`.
Both reuse the canonical compiled reader in their existing authenticated shells.
Contributors can open staff Help. A Business User opening a staff Help address
moves to the matching Portal Help address. Anyone visiting Portal Help sees the
Business User article selection, including an Administrator using the portal.

Open a signed-out Help link to reach its public `/documentation` equivalent.
The redirect retains the article ID, query and section. If the session check
fails, follow the public documentation link. Read public documentation without
a session or setup request. Keep record and action guards in their owning routes.

Help uses the actual role for discovery. A guide outside that selection offers its
full-documentation link and asks the reader to check its prerequisites. Reading
that public guide does not change app access. An unavailable guide or requested
edition has an explicit message and a path to the index.

## Topics and search

The small `virtual:openlaw-help-metadata` module contains registered topics,
route bindings, and article eligibility. It contains no article bodies. The reader
and its full content load when a documentation route opens.

General header Help combines matching route topics before the shared fallback.
The link repeats `topic` for eligible matches. It carries no record number, name,
or originating address. The index falls back to the complete role selection when
no eligible topic is available. Unknown keys have no filtering effect.

The pilot has visible context links on Portal home, submission forms and Request
pages, and on Inbox and Request detail. Sign-in, portal entry and first-run pages
link to public guidance. During writing, these links can open an empty topic
result; a scoped catalog entry never becomes an invented article.

Search reads the compiled manual. Its words do not reach record search, the API,
or an external service. The staff header retains its separate record search and
`/` shortcut. `?` still opens keyboard shortcuts, and Escape closes that dialog.
Article links retain modified-click behavior; ordinary internal clicks use the
router so Back, section focus and shell navigation work together.

## Verification

[help-readiness.json](help-readiness.json) records the four-role browser fixture
run. It identifies the working frontend and the isolated authoring API build.
Checks include topic links, audience boundaries, local search, Back, section focus,
missing editions/articles, Light/Dark/Warm at 1440, 720, 375 and 320 CSS pixels,
and simulated 200% zoom. The browser checks both overflow and a usable reader
width; the Portal flex layout exposed a collapsed-width defect during inspection.
An external reference was blocked in a separate tab while each local Help reader
remained usable.

These are Help implementation checks, not article verification or a human user
study. The validation procedure is fictional publishing material. DOC-008 and the
later content batches must validate actual instructions against recorded builds.

Route tests cover signed-out and failed-session recovery, role selection, one main
landmark, search boundaries and preserved shortcuts. Topic tests use the real
binding registry, including optional tabs and combined fallbacks. Compiler tests
check multi-topic ranking with audience and destination filtering. The built
Compose browser suite checks both Help shells and the public deep-link fallback.
