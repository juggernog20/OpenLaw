# Settings — Mock Inventory

Source: `designs/settings.pen`. Ratified as the visual spec for the settings screens by the SET-001
amendment (2026-08-10, M5 grill), _as amended below_ — where a mock predates a grill decision, the mock
gets updated, not the decision.

All frames are 1440×940 desktop. ST9 (the first-run wizard's Authentication step) no longer exists in
the file — that flow shipped with M2 as `/welcome`. The shared shell components (AppHeader, NavBar,
ActivityBar, Pill, Avatar) live in this file as local copies per the designs convention.

## Frames

| Frame | Node ID  | Screen                                   | Ships in |
| ----- | -------- | ---------------------------------------- | -------- |
| ST1   | `t5FyJK` | Personal · Profile                       | M5       |
| ST2   | `vVsIu`  | Personal · Appearance                    | M5       |
| ST3   | `QQ3PT`  | Personal · Notification preferences      | M18      |
| ST4   | `b3rJp`  | Organization · General                   | M5       |
| ST5   | `vij2O`  | Organization · Users                     | M5       |
| ST6   | `TRZzk`  | Matters settings · Types                 | M6       |
| ST7   | `cW3R8`  | Organization · Integrations              | M15/M31  |
| ST8   | `Kq7bz`  | Archive type modal (SET-003 guard)       | M6       |
| ST10  | `Ptq2X`  | Contracts settings · Statuses            | M6       |
| ST11  | `MaQ3Y`  | Contracts settings · Fields              | M6       |
| ST12  | `kb2yb`  | Intake settings · Request types          | M19      |
| ST13  | `V1LdY`  | Intake settings · Deflection links       | M19      |
| ST14  | `rcP97`  | Intake settings · Request type editor    | M19      |
| ST15  | `AuiXQ`  | Matters settings · Type editor           | M6       |
| ST16  | `gQmoP`  | Contracts settings · Type editor         | M6       |
| ST17  | `svBem`  | Organization · Security (Authentication) | M5       |
| ST18  | `vpr5X`  | Organization · Security · OIDC           | M5       |
| ST19  | `BWmsJ`  | Contracts settings · Types               | M6       |

## What the mocks already got right

- The rail matches SET-001 as amended: Personal (Profile, Appearance, Notifications) and Organization
  (General, Users, Security, Matters, Contracts, Intake, Notifications, Integrations). Entities and
  Knowledge sections join the rail when their milestones land.
- ST5 draws a **pending invite as a row** (status "Invited") — SET-005 before it was written.
- ST17 matches TECH-008: mode cards (Built-in vs OIDC), the immediate-apply + activity-log caption,
  and the portal magic-link toggle with the built-in-mode "can't be turned off" rule.
- ST1 shows **email without a change affordance** and role as read-only ("Roles are managed in
  Organization → Users") — consistent with SET-006's email-change deferral and SET-005.

## Amendments required (2026-08-10 grill deltas)

1. ~~**Security is a collapsible group** with Authentication as its sub-item (SET-001 amendment); the
   mock draws Security as a flat rail item whose page body is Authentication. Update the rail
   treatment; the page content stands.~~ _Done (2026-08-11, #64): every rail draws Security with a
   collapse chevron; ST17/ST18 show it expanded with Authentication active._
2. ~~**ST17 lacks the DD-010 allowed-email-domains editor** — it belongs on the Authentication pane.
   The mock had drawn it on ST4 instead; that card was removed from ST4 when the General pane
   shipped (2026-08-11, #63). The ST17 half lands with the Authentication pane build.~~ _Done
   (2026-08-11, #64): the editor sits in the Portal access card on ST17 and ST18. Same pass: ST18
   gained the Email domain field the register/update routes require, its "Test connection /
   Connected" affordance became "Save provider / Saved" (no test route exists — a successful save
   IS the discovery round-trip), and the secret hint dropped its "Stored encrypted" claim, which
   contradicted the TECH-008 addendum (DB-at-rest storage, encryption flagged for later)._
3. ~~**ST5 lacks**: the archived-user render state (greyed + inactive, behind an Archived filter),
   in-place role edit, and per-user session revocation (SET-005) — these land with #66. Resend
   /revoke actions on invite rows~~ _Invite part done (2026-08-11, #65): the invite row carries
   send (resend) and trash (revoke) icons in a widened actions column, and its role select is
   flattened to plain text — invites never edit roles per SET-005. Same pass: the Invite-user
   CTA's plus icon moved to 16px (DES-008)._ _Remainder done (2026-08-11, #66): active rows gained
   a log-out (revoke sessions) icon beside archive; a greyed archived row (identity and role at
   50% opacity, neutral "Archived" pill, archive-restore action) sits at the bottom; the header
   gained a "Show archived" toggle (drawn on, count 7) — no mock had an archived filter, so the
   toggle is the recorded normalization. The self row keeps its role select but carries no row
   actions: self-archive is refused and your own sign-out belongs to Profile (SET-006)._
4. ~~**ST1 lacks**: TOTP management, sign-out-my-other-devices, and the DES-014 timezone picker
   (SET-006).~~ _Done (2026-08-11, #67): the Profile card gained the timezone field (combobox
   showing "Use browser timezone", the DES-014 null default); the Password card became
   "Password & two-factor" with a TOTP status row (drawn enabled: Re-enroll / Turn off) under a
   divider, the ST17 Portal-access multi-row pattern; a Sessions card carries
   sign-out-my-other-devices. Grouped this way so the pane fits the 940 frame — five single-row
   cards would overflow it._
5. ~~**ST3 ships in M18**, not M5 — the toggles wait for the notification engine.~~ _Confirmed
   (2026-08-11, #68): the shipped rail's Personal group carries Profile and Appearance only — no
   Notifications entry, omitted rather than disabled — and the M5 acceptance journey asserts the
   absence. ST3 stays in the file untouched, waiting for M18._

## Amendments (2026-08-12, M6 acceptance sweep, #86)

Every M6 frame shipped: ST6 (#85), ST8 (the guard dialog in #81/#82/#85), ST10 (#82), ST11 (#83),
ST15 (#85), ST16 (#84). The sweep's deltas:

1. **The file had no Contracts · Types frame** — the DES-020 reference pane (#81) shipped from
   ST6's anatomy with the CTR-002 vocabulary. **ST19 was added in this sweep** to close the gap:
   the Contracts rail entry active, the Contracts section head with the three shipped tabs
   (Types / Statuses / Fields — no Templates), the eight CTR-002 seed rows with Other locked, no
   Default pill (no decision defines a default contract type — DES-020 normalization point 2),
   and the trailing pencil-plus-archive pair the build added (see 2).
2. **Trailing row actions**: every shipped list row carries a pencil edit button before archive —
   it navigates to the type-editor screen (DES-022) on the Types panes and opens the field-editor
   dialog (DES-021) on Fields. ST6/ST10/ST11 draw only the archive (or lock) glyph; ST19 draws
   the shipped pair. Recorded in the DES-020 amendment; the older frames are not redrawn.
3. **The help caption below the card** (DES-020 card anatomy) is drawn on no frame; every shipped
   pane renders it. Decisions win over the mocks — the frames are not redrawn.
4. **ST6's Advisory row draws a "Default" pill and a second lock** that did not ship: MTR-001
   protects only `other`, and no default-type affordance exists. The shipped Matters · Types pane
   (#85) locks Other alone and renders no pill. The row stays drawn as-is; M22 either builds the
   machinery or strikes it from the frame.
5. **ST8's reassignment select** shipped with a third outcome beside reassign and block: in-use
   rows with no live reassignment candidate disable the select and the danger CTA with an
   explanatory line (DES-020 amendment 3). The frame stands; it draws the reassign case.
