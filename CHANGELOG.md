# Changelog

This file records the notable changes in each OpenLaw release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and OpenLaw uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.4.0 - 2026-10-01

### Upgrading

- The app applies four database migrations when it starts. Back up first, as for every upgrade ([Upgrades](docs/DEPLOYMENT.md#upgrades)). (#1240, #1266)
- The first migration deletes every Holding that a person typed with Add Holding. Holdings that a share register wrote stay. Before you upgrade, open each Entity whose owners you typed, add a share class on its Ownership tab, and record an allotment to each owner. (#1240)
- API clients that write Holdings must record share register entries instead. `POST`, `PATCH` and `DELETE` on `/api/v1/entities/{id}/holdings` are gone. Use `/api/v1/entities/{id}/share-classes` and `/api/v1/entities/{id}/share-entries`. (#1240)
- Each Entity type now names a register. The Partnership type starts with the partnership register, the Branch type starts with None, and every other type starts with the share register. An Entity that already has a share register keeps it, whatever its type. (#1266)
- An install with a DocuSign connector changes how it sends. Send for signature now saves an unsent Envelope and opens DocuSign's editor, where the preparer places the fields and sends. To keep the older interface, where Send envelope sends at once from OpenLaw, set `SIGNING_PREPARATION_ENABLED=false` in `.env` before you start the new version ([DocuSign sending interface](docs/DEPLOYMENT.md#docusign-sending-interface)). (#1260)
- This release adds one optional environment variable, `SIGNING_PREPARATION_ENABLED`. Unset, empty or `true` means preparation. `false` means the older interface. The app does not start on any other value. This release has no Compose changes. (#1260)

### Added

- An Entity can keep a trust register. It records each Trust party's Roles by date: settlor, trustee, protector, enforcer, beneficiary, or another Role with a label. It also records settlements into the trust fund and distributions out of it, and shows the balance for each currency. (#1266)
- An Entity can keep a partnership register. It records each Partner's admission, capacity, commitments, contributions, returns, transfers and withdrawal. The Ownership basis you choose sets the Holdings that the register writes: unreturned capital, units, stated percent or equal shares. (#1266)
- Each Entity type names its register in Settings, Entities, Types: share register, partnership register, trust register or None. Change register on the Ownership tab sets another one for a single Entity while its registers are empty. (#1266)
- An Entity with no register, such as a branch, names its Head office on the Ownership tab. (#1266)
- The ownership chart draws each Trust party with a dashed line that names its Role and carries no percentage. It draws a branch under its Head office. The PDF and PowerPoint exports show the same lines. (#1266)
- The trust register and the partnership register read at any past date and export to CSV, as the share register does. (#1266)
- An Administrator can duplicate a Contract type, a Matter type or an Entity type from the Types list. The copy gets the source Form with every Row and Branch. Default people, the default approver group and Request type destinations stay on the source. (#1256)
- The DocuSign settings form and the onboarding step have a Grant consent button. It opens DocuSign's consent page, and the connection test runs again when you grant consent. Both screens show the redirect URI to add to the DocuSign app. (#1260)
- The API adds `POST /api/v1/contract-types/{id}/duplicate`, the same path for Matter types and Entity types, and the trust and partnership paths under `/api/v1/entities/{id}`: `trust-register`, `trust-entries`, `partnership-register` and `partnership-entries`. (#1256, #1266)

### Changed

- Send for signature with a DocuSign connector opens the Prepare Envelope dialog, and Continue to DocuSign opens DocuSign's editor. Before, an install had to turn this on. (#1260)
- A failed DocuSign connection test says when the cause is missing consent or refused credentials, and offers Grant consent. The API returns the problem types `signing-consent-required` and `signing-credentials-refused` for these two cases. (#1260)
- Settings, Organization, Notifications shows the reminder lead times furthest first, with no reorder handles. The order never changed a reminder. A new lead time goes to its place in the list. (#1238)
- The MCP tool that reads one Entity returns the register the Entity keeps. `shareRegister` is null for an Entity that keeps another register, and `trustRegister` and `partnershipRegister` are new. (#1266)
- A duplicated Entity type keeps the register of its source. (#1266)
- Dependency updates, including better-auth, the AWS SDK, nodemailer, pg, pg-boss and sanitize-html. (#1235, #1265)

### Removed

- Add Holding and the Declared owners not in the register card are gone from the Entity Ownership tab. The share register is the only source of a Holding. Holdings in other Entities is a read-only list, and each row links to the register that wrote it. (#1240)
- The API no longer accepts `POST`, `PATCH` or `DELETE` on `/api/v1/entities/{id}/holdings`. The Holdings response no longer carries `source` or `warnings`, and a chart edge no longer carries `source`. (#1240)

### Security

- brace-expansion moves to 2.1.6 and 5.0.11 or later for GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p, a denial of service through nested brace groups. Only development tooling and the API test suite used the old versions. (#1238, #1240)

Full changes: https://github.com/juggernog20/OpenLaw/compare/v0.3.0...v0.4.0

## 0.3.0 - 2026-09-29

### Upgrading

- The app applies one database migration when it starts. It adds the `runtime_metrics` table for System status. Back up first, as for every upgrade ([Upgrades](docs/DEPLOYMENT.md#upgrades)). (#1230)
- This release adds no environment variables and no Compose changes.

### Added

- Settings, Advanced, System status shows how the app performs. The process table shows CPU and memory. New cards show API, worker, and database and queue performance for the last 5 minutes, hour and 24 hours. The page reads again every 30 seconds. (#1230)

### Changed

- Each process deletes performance data and stale process heartbeats after 24 hours. Before, stale heartbeats went away only when a process started. (#1230)
- Dependency updates, including the AWS SDK, nodemailer and the MCP SDK. (#1228, #1232)

### Fixed

- An Administrator can add Entra ID or Google as an identity provider. Registration failed before, because these providers put some endpoints on hosts other than the issuer's. (#1231)
- Sign-in works with an internal identity provider whose endpoints are on a different private host from its issuer. (#1231)

### Security

- undici moves to 7.30.0 for GHSA-3wwx-pv8p-q78v (CVE-2026-85024), a denial of service through WebSocket decompression. (#1232)
- drizzle-kit's loader moves to esbuild 0.25.12 for GHSA-67mh-4wv8-2f99. Only development tooling used the old esbuild. The published images did not contain it. (#1232)
- A public identity provider cannot use its discovery document to make the server call addresses on the install's private network. (#1231)
- A crafted comment can no longer stall the comment email worker. A 150,000-character body now takes 90 ms. (#1232)
- Matter updates no longer accept `__proto__` as a field name. Custom Field writes use only the Fields attached to the record. (#1232)

Full changes: https://github.com/juggernog20/OpenLaw/compare/v0.2.0...v0.3.0

## 0.2.0 - 2026-09-29

### Upgrading

- This release adds no database migrations, environment variables or Compose changes. Back up first, as for every upgrade ([Upgrades](docs/DEPLOYMENT.md#upgrades)).
- API clients that send for signature must handle a new refusal. `POST /api/v1/contracts/{number}/envelopes` and `.../envelopes/prepare` now return 409 `urn:openlaw:problem:approval-soft-gate` when the send would move a Contract past the approval Stage while an Approval request is pending or rejected. Send again with `overrideSoftGate: true` to go ahead and record the override. (#1207)
- `DELETE` on the last identity provider now returns 409 while Legal Users or Business Users can sign in only with SSO. Turn on another sign-in method for that group first. (#1208)
- An empty allowed-domain list no longer turns Business sign-in off. To stop Business Users signing in, turn off their sign-in methods in Settings, Authentication. (#1209, #1210)
- Business Portal intake now shows Department and Priority only when the destination Contract or Matter Form has them On intake form. Check those Rows in each Form that Business Users submit through. Department is required only when its Row is visible and Required for creation. (#1225)

### Changed

- Send for signature meets the Soft gate. The Signatures card asks you to confirm before a send moves a Contract past approval while an Approval request is pending or rejected, and the Activity records the override. (#1207)
- A send moves the Status forward only. An Active or Ended Contract keeps its Status and end date when you send it for signature. (#1207)
- The allowed-domain list controls only who can create a new Business User account. The Business card in Settings and in the welcome wizard shows the sign-in methods that apply when the list is empty. (#1209, #1210)
- On an archived owning record, an Administrator can delete any Version, including the current one. (#1211)
- The Knowledge Item Type cell is read-only. (#1214)
- Changing the type of a Contract, Matter or Entity skips the required Rows under a Branch whose condition does not hold. (#1214)
- Help and the documentation edition no longer show a Validation in progress or Unverified article badge on guides. (#1220)
- The README now describes OpenLaw for the people who run and use it. The developer notes moved to `docs/DEVELOPMENT.md`. (#1219)
- A new Contract type asks for Counterparties on Create contract. The Row starts On intake form and is not Required. Contract types that already exist keep their Forms. (#1223)
- Key dates says under the table when the expiry and notice deadline remind you, with your own lead times and a link to change them. (#1223)

### Fixed

- The staff "Sign-in is unavailable" page offers Administrator sign-in. (#1208)
- The archive dialog in Settings, Contract Statuses no longer counts Partially signed as a live Signature status. (#1212)
- The Field archive dialog counts types and records separately. (#1214)
- Holding History entries show the percentage and the owner's name. (#1214)
- Copy shows "Copy failed" when the browser has no clipboard access. (#1214)
- Start blank lists every Status it keeps. The MCP OAuth note names both kinds of Client. Two-factor enrollment has text for an account with no password. (#1213)
- Adding an identity provider whose issuer does not answer names the discovery URL that failed. (#1213)
- The welcome wizard refuses a localhost or private DocuSign webhook URL, which DocuSign cannot reach. (#1213)
- Business Portal intake and its preview follow the destination Form's Row order, required settings and conditions. Department appears once, and Rows that are not On intake form stay off the Portal form. (#1225)
- The Counterparties list closes after a pick, so it no longer covers the next field. (#1223)
- Set parent and the other Contract and Matter link pickers find a record typed as printed, such as C-92. (#1223)
- Needed by shows its date like the other term dates, such as Oct 1, 2026. (#1223)
- The term timeline shows the year on both ends of a term that crosses a year. (#1223)

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
