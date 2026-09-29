# Changelog

This file records the notable changes in each OpenLaw release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and OpenLaw uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- A new Contract type asks for Counterparties on Create contract. The Row starts On intake form and is not Required. Contract types that already exist keep their Forms. (#1223)
- Key dates says under the table when the expiry and notice deadline remind you, with your own lead times and a link to change them. (#1223)

### Fixed

- `pnpm dev:hot --seed`, `--fresh` and `--isolated` seed again. The seed failed with 403 `INVALID_ORIGIN` since 0.1.0. (#1223)
- The Counterparties list closes after a pick, so it no longer covers the next field. (#1223)
- Set parent and the other Contract and Matter link pickers find a record typed as printed, such as C-92. (#1223)
- Needed by shows its date like the other term dates, such as Oct 1, 2026. (#1223)
- The term timeline shows the year on both ends of a term that crosses a year. (#1223)

## 0.2.0 - 2026-09-29

### Upgrading

- This release adds no database migrations, environment variables or Compose changes. Back up first, as for every upgrade ([Upgrades](docs/DEPLOYMENT.md#upgrades)).
- API clients that send for signature must handle a new refusal. `POST /api/v1/contracts/{number}/envelopes` and `.../envelopes/prepare` now return 409 `urn:openlaw:problem:approval-soft-gate` when the send would move a Contract past the approval Stage while an Approval request is pending or rejected. Send again with `overrideSoftGate: true` to go ahead and record the override. (#1207)
- `DELETE` on the last identity provider now returns 409 while Legal Users or Business Users can sign in only with SSO. Turn on another sign-in method for that group first. (#1208)
- An empty allowed-domain list no longer turns Business sign-in off. To stop Business Users signing in, turn off their sign-in methods in Settings, Authentication. (#1209, #1210)

### Changed

- Send for signature meets the Soft gate. The Signatures card asks you to confirm before a send moves a Contract past approval while an Approval request is pending or rejected, and the Activity records the override. (#1207)
- A send moves the Status forward only. An Active or Ended Contract keeps its Status and end date when you send it for signature. (#1207)
- The allowed-domain list controls only who can create a new Business User account. The Business card in Settings and in the welcome wizard shows the sign-in methods that apply when the list is empty. (#1209, #1210)
- On an archived owning record, an Administrator can delete any Version, including the current one. (#1211)
- The Knowledge Item Type cell is read-only. (#1214)
- Changing the type of a Contract, Matter or Entity skips the required Rows under a Branch whose condition does not hold. (#1214)
- Help and the documentation edition no longer show a Validation in progress or Unverified article badge on guides. (#1220)
- The README now describes OpenLaw for the people who run and use it. The developer notes moved to `docs/DEVELOPMENT.md`. (#1219)

### Fixed

- The staff "Sign-in is unavailable" page offers Administrator sign-in. (#1208)
- The archive dialog in Settings, Contract Statuses no longer counts Partially signed as a live Signature status. (#1212)
- The Field archive dialog counts types and records separately. (#1214)
- Holding History entries show the percentage and the owner's name. (#1214)
- Copy shows "Copy failed" when the browser has no clipboard access. (#1214)
- Start blank lists every Status it keeps. The MCP OAuth note names both kinds of Client. Two-factor enrollment has text for an account with no password. (#1213)
- Adding an identity provider whose issuer does not answer names the discovery URL that failed. (#1213)
- The welcome wizard refuses a localhost or private DocuSign webhook URL, which DocuSign cannot reach. (#1213)

Full changes: https://github.com/juggernog20/OpenLaw/compare/v0.1.0...v0.2.0

## 0.1.0 - 2026-09-28

First public release.

### Contracts

- Contract records with a C-### number, an Owner, a team, our signing Entity, one or more Counterparties, value, priority, risk and custom Fields. Administrators configure types, statuses and Fields. Each status maps to one of six fixed Stages, from draft to ended.
- Parallel approvals from named people or an Approver group. A soft gate asks for confirmation before a Contract moves past the approval Stage with approvals still open.
- Term and renewal with a derived notice deadline, Key dates, Tasks, parent and linked Contracts, and Ending. The Confidential flag hides a record from everyone outside its audience, with no placeholder.

### Auto-Docs

- Legal uploads a Word template. OpenLaw detects its Placeholders and Blocks and builds a form, with Clause rules and mappings to Contract Fields.
- A Generation fills the template and returns `.docx` and `.pdf` files, in the app or in the Portal. An Auto-Doc that targets a Contract type also creates a draft Contract. Assignment rules pick its Legal Owner, and a Contract that no rule matches waits in the Inbox as an Unassigned contract.

### Matters

- Matter records with an M-### number, a Matter Manager, a team, priority, risk and custom Fields. Each status maps to an open or closed Category.
- Key dates, Tasks, sub-Matters, related Matters and links to Contracts. Closing a Matter does not lock it.
- Matter templates pre-fill a new Matter and add Tasks and Key dates with relative due dates.

### Requests and intake

- Business Users submit Requests in the Portal. Each Contract or Matter type owns a Form, and its Branches show questions only when a condition holds.
- The Inbox holds the Requests whose fate is undecided. The Disposition is Convert, Resolve or Decline. Convert creates a Contract or Matter and carries the collected answers, the attachments and the thread across.
- "Before you submit" deflection links point Business Users at an answer before they ask.

### Entities

- Entity records for our own companies, with Officers, Registrations in several jurisdictions, statutory Documents, and an ownership graph with an org chart.
- Obligations on a compliance calendar. An Obligation rolls forward only when a person confirms it.
- A share register with Share classes, Register entries and Certificates. It replays to any date, Holdings derive from it, and it exports to CSV.

### Knowledge

- Knowledge Items with a type, optional Markdown guidance, owned Documents with Version chains, and Knowledge Folders.
- Publish, unpublish and archive. A published Knowledge Item can be portal-readable and can appear as a deflection link.

### Documents and the doc engine

- Each Document has exactly one owning record and a linear chain of immutable Document Versions. Folder upload keeps the dropped folder structure.
- The doc-engine sidecar runs LibreOffice and OCRmyPDF. It previews Word and PowerPoint files in the app and extracts text, with OCR for scanned PDFs.
- A Comparison shows the changes between two Versions. Its Word export adds a Generated redline with tracked changes to the chain. The Documents destination lists every Document you can reach, with filters and saved views.

### E-signature

- A DocuSign Signing connector, configured in Settings. Send a Contract's primary Document to its Signers. Status arrives by polling or by the DocuSign Connect webhook.
- On completion, the executed PDF becomes a pinned Version and the Contract moves to active. The manual hand-off works without a connector.

### AI

- Bring your own key through an AI connector. It speaks the Anthropic Messages, OpenAI Chat Completions and Gemini protocols, with presets for common providers and a custom option.
- An Analysis run reads a Contract's Document and fills its term, value, notice period and custom Fields. Each value it writes is an Unverified value until a person confirms it. Answer style sets the length of text answers.
- A Conversion draft suggests values from a Request before Convert.

### MCP and OAuth Clients

- An MCP server at `/mcp`. A Client acts as the person who connected it, and the activity feed names the Client.
- API keys for headless Clients, issued after an Administrator approves the API key request. OAuth grants for Allowed Clients, seeded with Claude, Claude Code, ChatGPT and Microsoft 365 Copilot, with a consent page and Disconnect.
- Toolsets that Administrators turn on or off, record resources, triage and summary prompts, and change notifications. The Audit log has a Tool calls tab.

### Settings

- Personal settings for profile, password, two-factor authentication, sessions, timezone, theme and notifications. Three themes: Light, Warm and Dark.
- Separate sign-in methods for Legal users and for the Business Portal: email and password, email magic link, and single sign-on. Several OIDC identity providers, each routed by email domain. An option to require two-factor authentication.
- An Onboarding wizard at `/welcome` for the first Administrator, a Setup checklist for skipped steps, and an Administrator-only Audit log.

### Comments, activity and Home

- One comment system on Contracts, Matters, Requests and Documents, with mentions, attachments and three Visibility tiers: Legal Only, Working Team and Full Thread.
- An activity feed on each record. Comments, activity and approvals update in other open browsers without a reload.
- Home shows your pending approvals, assigned Tasks, approaching dates, Entity Obligations, the Inbox, and the Contracts and Matters you manage.

### Notifications

- A bell in the app and in the Portal, immediate email for direct events, and a morning briefing email for dates. Each person chooses channels for each event group.
- Device notifications through browser push.
- Every email uses one HTML layout with the organization's logo and name.

### Search

- Press `/` to search titles, descriptions and the text of uploaded files, including OCR text. Results leave out Confidential records you cannot see.
- Advanced search with conditions on standard properties and Fields, relative dates, Match all or Match any, private saved searches, and recent searches.

### Portal

- Business Users sign in with the methods the authentication policy allows, including a magic link. Only allowed email domains can sign in without an invitation.
- Business Users follow their Requests and work on the Contracts and Matters whose team they are on. They read Fields, add Documents and comment. A Business User named as an approver decides in the Portal.
- The Portal also shows portal-readable Knowledge, Auto-Doc Generations, and Portal-listed Entities on forms.

### Deployment and operations

- Docker Compose with four services: the app, which serves the API and the web app, the background worker, Postgres 16, and the doc engine. The app runs database migrations when it starts.
- Two container images for linux/amd64, `ghcr.io/juggernog20/openlaw` and `ghcr.io/juggernog20/openlaw-doc-engine`. Each carries the tags `0.1.0`, `0.1` and `latest`.
- File storage on local disk, an S3-compatible store or Azure Blob Storage. A setup token protects first-run setup. `/healthz` and `/readyz` report health. `docs/DEPLOYMENT.md` covers the reverse proxy, upgrades, backups and the credential encryption key. The user manual is at `/documentation` and in the in-app Help.
