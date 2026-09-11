# Publish the guides in the development app

Task: [#800](https://github.com/juggernog20/OpenLaw/issues/800).

The user requested, "Okay lets publish the documentation and help guides to the app".
The preceding handoff disclosed that all 56 guides remained unverified pending
verification and proofreading. This instruction authorizes their availability now.
It does not record a walkthrough, provider result, human proofreading, or G4 acceptance.

PR #798 supplied the reviewed reader design. This publication uses its merge into
`dev`, `1ab2a82055e4de20e215b28a46150e9010c7aea9`, as the source reference. The
`edition.publication` record binds that authorization to the 56 existing source
hashes. No guide is promoted to verified or published in the verification catalogue.
The old supported-build declaration is preserved byte-for-byte in
[previous-edition.json](previous-edition.json). The current edition leaves the
tested app commit unset until that build has actually been verified.

Normal app builds now include the approved guides in `/documentation`, staff Help
and Portal Help, and the standalone edition. A concise notice says guide validation
is in progress. Publication approval details, author names, and evidence records
are not shipped as reader content. Existing audience and topic filters still apply.

## Maintenance

Edit a guide in an explicit preview when its source needs work. Update its publication
hash through a reviewed documentation change before distributing it again. New drafts
are omitted unless added to the publication record. Remove an entry when its guide is
promoted to verified and supply the required real evidence. Do not change old evidence
to match a newer source or build. A release edition cannot carry this development
publication record, and `docs:complete` continues to reject an unverified suite.

## Amendments

The independent Opus 5 review of the implementation PR found that
[versions-and-support.md](../../../user-guides/versions-and-support.md) still named
only the development-preview notice and badge, which this edition never shows. That
guide now describes both notices and the **Not yet verified** supported-app value.
Its publication hash was updated for the corrected bytes. The review made no other
change to a guide source and promoted no article.

DOC-022 #742, DOC-025 #745 and fully verified release publication #747 remain open.
The 56-guide and 55-coverage-group denominators are unchanged. Verification of the
publication mechanism and served readers is recorded in the implementation PR linked from #800.

The #829 feature update changes the approved source hashes for convert-request,
contract-analysis, configure-analysis, create-matter, matter-templates and
troubleshooting. These guides now describe the independent Request conversion
switches, Conversion draft review, post-conversion Analysis, source citations,
explicit clears and current ownership defaults. Their existing validation status
and old evidence remain unchanged. The live preparation observations supplied in
the feature handoff cover only the interactions actually recorded; they are not
blanket guide verification.
