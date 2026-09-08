# Find version information and get help

Identify the documentation you are reading and give the right person enough information to investigate a problem.

## Find the applicable edition

1. Select **Help** in the staff or Portal header. For the complete suite, select **All documentation**, or **Read this article in the full documentation** when reading a Help article. Formal documentation can also be read without signing in.
2. Expand **Edition details** near the bottom of the reader.
3. Record the edition identifier and channel, **Supported app**, **Distribution commit**, and **Content digest**. **Publication target** distinguishes where that edition is intended to be used.

**Supported app** is the version/build declared by this documentation edition. It is not a live measurement of the running server. Ask your Administrator or operator for the installed app build when comparing a problem with these instructions. Operators can use the build and image records described in [upgrades](upgrade.md).

The package version alone is insufficient for development builds: different builds can share `0.0.1`. The distribution commit identifies the source used to assemble the docs, while the content digest identifies the bundled documentation content. **Working changes** means the bundle included uncommitted source changes.

**Development preview: draft and validation content is unverified.** and **Unverified article** identify review content. A feature-review preview is not a production release or a claim that every article has passed final acceptance. Record those notices if you report a mismatch.

## If a link names another edition or a missing article

An installed app reads its bundled edition. It does not silently replace older instructions with an external latest manual.

For **Article unavailable**, read the accompanying explanation. A requested edition may not be bundled, or that article may not be available in this edition. Return to **Help** or **All documentation**, then search for the task. For an unavailable section, use **On this page** to find the current heading. Ask your operator for a retained copy when you specifically need an earlier edition. Builds from before Help was added need their corresponding source documentation or a retained export.

Help limits its recommendations to your role and surface. An article outside that selection can offer a full-documentation link; reading it does not grant the role or access required to perform its procedure.

## Keep instructions available during an outage

While the instance is reachable, expand **Edition details** and select **Download standalone edition**. Extract the archive and keep the complete extracted directory outside the instance. Open its `index.html` to read it. **Open standalone edition** reads the copy served by the app; it is not a substitute for keeping your own copy before an outage.

Bundled reading and documentation search do not require an external documentation service. If an external support link fails, return to the local article and try the external destination later. If the app itself is down, use the separately retained export. Its index and prose remain readable without JavaScript; local search needs JavaScript and its accompanying files. Missing files in a copied edition should be recovered from a complete retained copy.

## Check the relevant limitation

Before reporting a missing capability, check the procedure's prerequisites and current constraints:

- [Roles and access](roles-and-access.md): links, relationships, and mentions do not grant access; Administrators retain access to Confidential records.
- [Contributor work](contributor-guide.md): legal actions and Task completion remain with Legal.
- [Document reading](document-previews.md): storage support is wider than preview support; processing and original downloads can have different outcomes.
- [Approval](contract-approvals.md): requests are parallel internal decisions; unresolved requests produce a warning when moving beyond Approval.
- [Electronic signing](electronic-signing.md) and [Analysis](contract-analysis.md): availability depends on their separate connector configuration and the target Document. Manual signing remains available without a connector.
- [Notifications](notifications.md): preferences and audience affect delivery; morning email is not guaranteed at an exact minute.

These guides describe the edition's behavior, not a guarantee that an individual installation or provider is healthy. For a visible failure, start with [common problems](troubleshooting.md). If the controls differ, capture both the installed build and documentation edition rather than assuming another edition's instructions apply.

## Contact your organization first

Ask your Administrator through your organization's usual support channel about accounts, access, configuration, missing work, or delivery problems. Legal can check the applicable Contract, Matter, or Request; an operator can investigate service failures using [operator troubleshooting](operator-troubleshooting.md).

Give your role, the action, approximate time and timezone, expected outcome, and the exact visible error. Share any necessary record link only through your organization's approved channel. OpenLaw does not establish a universal support email address or response-time promise.

## Report a product defect or documentation correction

Use the [OpenLaw GitHub issue tracker](https://github.com/juggernog20/OpenLaw/issues). Search for an existing report before opening a new issue. Creating or commenting on an issue requires a GitHub account; if you cannot use it, ask your Administrator to help report through your organization's process.

Include:

- The installed app build when known, the documentation edition details, and any preview notice.
- The guide title and section, or the control and action that failed.
- Your account role and relevant configuration conditions, without credentials.
- Short steps using fictional names and records, the expected outcome, and what actually happened.
- The relevant error wording and time, with private data removed.

For example: “As a Contributor, I followed ‘Work on a shared Contract or Matter,’ ‘Supply a supporting Document.’ On fictional Contract C-123, adding a second Version returned [error]. The first Version still downloaded. App build: [build]; documentation edition and digest: [details].” Replace the bracketed report fields with facts from your incident.

The tracker is public. Do not include private Documents, record titles, personal details, passwords, sign-in links, provider keys, or complete logs. Use a minimal fictional reproduction and sanitized excerpts. Following the support link does not submit a report or send your records automatically.
