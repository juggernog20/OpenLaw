# Settings — Mock Inventory

Source: `designs/settings.pen`. Ratified as the visual spec for the settings screens by the SET-001
amendment (2026-08-10, M5 grill), _as amended below_ — where a mock predates a grill decision, the mock
gets updated, not the decision.

All frames are 1440×940 desktop. ST9 (the first-run wizard's Authentication step) no longer exists in
the file — that flow shipped with M2 as `/welcome`. The shared shell components (AppHeader, NavBar,
ActivityBar, Pill, Avatar) live in this file as local copies per the designs convention.

## Frames

| Frame | Node ID  | Screen                                   | Ships in  |
| ----- | -------- | ---------------------------------------- | --------- |
| ST1   | `t5FyJK` | Personal · Profile                       | M5 ✓      |
| ST2   | `vVsIu`  | Personal · Appearance                    | M5 ✓      |
| ST3   | `QQ3PT`  | Personal · Notification preferences      | M18 ✓     |
| ST4   | `b3rJp`  | Organization · General                   | M5 ✓      |
| ST5   | `vij2O`  | Organization · Users                     | M5 ✓      |
| ST6   | `TRZzk`  | Matters settings · Types                 | M6 ✓      |
| ST7   | `cW3R8`  | Organization · Integrations              | M15 ✓/M31 |
| ST8   | `Kq7bz`  | Archive type modal (SET-003 guard)       | M6 ✓      |
| ST10  | `Ptq2X`  | Contracts settings · Statuses            | M6 ✓      |
| ST11  | `MaQ3Y`  | Contracts settings · Fields              | M6 ✓      |
| ST12  | `kb2yb`  | Intake settings · Request types          | M19 ✓     |
| ST13  | `V1LdY`  | Intake settings · Deflection links       | M19 ✓     |
| ST14  | `rcP97`  | Intake settings · Request type editor    | M19 ✓     |
| ST15  | `AuiXQ`  | Matters settings · Type editor           | M6 ✓      |
| ST16  | `gQmoP`  | Contracts settings · Type editor         | M6 ✓      |
| ST17  | `svBem`  | Organization · Security (Authentication) | M5 ✓      |
| ST18  | `vpr5X`  | Organization · Security · OIDC           | M5 ✓      |
| ST19  | `BWmsJ`  | Contracts settings · Types               | M6 ✓      |

## What the mocks already got right

- The rail matches SET-001 as amended: Personal (Profile, Appearance, Notifications) and Organization
  (General, Users, Security, Matters, Contracts, Intake, Entities, Notifications, Integrations). Knowledge
  joins the rail when its milestone lands.
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
   absence. ST3 stays in the file untouched, waiting for M18._ **Closed (2026-08-18, #320):** the
   pane shipped, the rail's Personal group gained its Notifications entry, and the M5 journey now
   asserts its presence. Two frame deviations are recorded in **DES-050** and ST3 is not redrawn:
   group 2 renders as **one row** rather than the frame's group header plus four sub-rows (NOT-002
   keys a preference on the group, never on one verb), and the **In-app column is interactive**
   rather than the frame's 55%-opacity locked treatment (M18 story 18: the feed is the person's to
   tune). The pane also carries a caption the frame does not draw, and the stacked narrow layout
   has no frame — both recorded in DES-050.

## Amendments (2026-08-12, M6 acceptance sweep, #86)

Every M6 frame shipped: ST6 (#85), ST8 (the guard dialog in #81/#82/#85), ST10 (#82), ST11 (#83),
ST15 (#85), ST16 (#84) — and ST19, added by this sweep, records the pane that had shipped without
a frame (#81). The sweep's deltas:

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
   (#85) locks Other alone and renders no pill. M22 closed the question without new machinery: the
   build remains the contract and the frame's extra pill/lock are struck by the amendment below.
5. **ST8's reassignment select** shipped with a third outcome beside reassign and block: in-use
   rows with no live reassignment candidate disable the select and the danger CTA with an
   explanatory line (DES-020 amendment 3). The frame stands; it draws the reassign case.

## Amendment (2026-08-16, M15 — the E-signature pane, #245)

ST7 draws the Integrations section this milestone builds, and its rail treatment shipped as drawn:
an **Integrations** entry in the Organization group, `plug` glyph, last in the group. Two deltas
between the frame and the shipped pane:

1. **ST7 draws a summary row, the pane ships a form.** The frame shows one DocuSign row — logo
   square, name, "Connected" pill, a **Configure** button, and an account caption — which implies a
   second screen or a dialog behind Configure. The shipped pane has no second screen: it is the
   **credential form itself**, on the ST18 anatomy (environment, integration key, user ID, RSA
   private key, Connect HMAC secret), with **Save connector** and **Test connection** beside each
   other and a read-only **webhook URL** with a Copy button below a divider. The two secret fields
   are write-only and start blank, with ST18's "Leave blank to keep the current value" hint. This
   is the recorded normalization; the decisions win over the mock.
2. **The frame cannot hold both cards at 1440×940.** The credential form is roughly four times the
   height of the summary row it replaces, so redrawing ST7 truthfully would push the AI analysis
   card (M31, CTR-008) off the 940 frame every other frame in this file keeps to. **ST7 is
   therefore left as drawn**, and the redraw is scheduled for the M31 Integrations pass, which owns
   the second card and can lay both out together — either as two frames or as one taller one.

The **placement** the frame assumes is now a recorded decision rather than only a mock: **SET-007**
supersedes CTR-013's "Settings → Contracts → E-signature" sentence, and Integrations is the home.

## Amendment (2026-08-18, M18 — Organization · Notifications, #322)

The NOT-004 reminder-offset list shipped as an Organization section. Two deltas between the file and
the shipped pane:

1. **The rail entry shipped as drawn; the pane body had no frame.** ST4's Organization group lists
   **Notifications** between Intake and Integrations with the `bell-ring` glyph, and that is exactly
   where and how the entry shipped — Entities takes the place the mock's unshipped Intake entry
   holds. No frame in this file draws the pane behind it: ST3 is the **Personal** preferences grid
   (DES-050), which is a different pane for a different reader. The body is therefore built from
   **DES-052** on DES-020's geometry, and no frame is added in this pass — the M19 Intake sweep owns
   the next pass over this file and can draw the pane against a settled surface.
2. **The screen title and the URL are not the rail label.** The rail says "Notifications", as drawn.
   The browser title says "Reminder lead times" and the address is `/settings/reminders`, because
   DES-011 asks every screen for a title of its own and the Personal pane already holds both the
   label and `/settings/notifications`. Recorded as DES-052 normalization 3.

Because two rail sections now carry the label "Notifications", each rail group renders as an ARIA
`group` named by its own heading — DES-052 normalization 4. Nothing about the rail's drawing changes.

## Amendment (2026-08-18, M18 close, #323) — ST3 has shipped

The milestone the ST3 row has been waiting on since M5 is done, so the row now carries a **✓** beside
its milestone: `M18 ✓`. Personal · Notification preferences is live at `/settings/notifications`, on
the anatomy **DES-050** settles, with amendment 5 above closed by #320 and its two frame deviations
recorded there — group 2 as one row rather than a header plus four sub-rows, and an interactive
In-app column. **ST3 is not redrawn**, for the reason ST7 was left as drawn: the deviations are
recorded in a decision, and decisions win over the mocks.

The tick is on this row alone, and that is a gap rather than a convention: every other frame whose
milestone has landed is equally shipped and says only its number. Marking the rest belongs to a sweep
of the whole table — the M19 Intake pass owns the next one, and it can mark them all at once.

## Amendment (2026-08-19) — the Integrations cards collapse

**DES-054** answers the M15 amendment's delta 1 halfway. The E-signature card's header is now a
disclosure: closed on arrival whether or not a connector is stored, with a Connected / Turned off /
Not connected chip beside the name. That is ST7's summary row — the name
and the state on one strip — reached without ST7's Configure button and without the second screen
the M15 amendment declined.

What is still owed is the **redraw**, and it is unchanged: ST7 draws a Configure button that does
not exist, and it has never drawn the credential form the card opens into. The M31 Integrations
pass still owns it, and it now lays out two collapsed cards rather than one summary row and one
form — which is what made the frame too short to redraw truthfully in M15.

## Amendment (2026-08-20, M19 — the form definition, #355) — ST14's Urgency row

ST14's Form fields card draws Urgency with the pre-DES-018 wording, `Low · normal · high · urgent`.
DES-018 settles one severity ramp for every ordinal scale, and INT-002 already records that the
request form's Urgency wears it. **The frame is redrawn** rather than left as a deviation, because
this one is a plain contradiction of a shipped decision and not a considered departure from it: the
row now reads `Low · medium · high · critical`, which is what the editor renders.

Nothing else in the card moves. The four basics keep their locked rows, their lock glyph, and their
disabled required boxes exactly as drawn — Summary, Description, and Urgency ticked, Attachments
clear — and the attached catalog fields below them keep the grip, the required box, and the detach
action the two type editors already draw.

**One frame deviation, recorded rather than redrawn:** the mock draws each locked row at 60% opacity,
and the build does not. DES-011 sets a 4.5:1 floor on body text, and fading a row an Administrator
still has to read takes it under that floor. The lock glyph, the disabled required box, and the muted
type caption say "locked" without dimming anything, so the shipped rows carry full contrast.

The ST12 **Form fields** column ships as drawn, counting the catalog fields on the form and never the
four basics, which are on every form and would say the same number on every row.

## Amendment (2026-08-20, M19 close, #357) — the Intake panes shipped, and every shipped row is ticked

M19 built the three Intake frames, so this pass reconciles them with what shipped and closes the
✓-marking gap the M18 close left open.

### The tick sweep

**A ✓ beside the milestone means the frame's screen is live in the product.** Every row whose
milestone has landed now carries one — M5, M6, M15, M18, and M19 — which ends the state where ST3
alone was ticked and every other shipped frame said only its number. ST7 reads `M15 ✓/M31` because
half of it shipped: the Integrations pane is live, and the AI analysis card the frame also draws
belongs to M31. A row with no tick is a frame waiting on a milestone that has not landed.

### The target strings match the shipped model

The three-state target (INT-002's #354 addendum — no target, a module, or a module and a type) was
checked against both frames, **and neither diverges**:

- **ST12** draws the three states as the three seeded rows: `Contract · NDA`, `Contract`, and
  `No target`. That is exactly what the Target column renders, string for string.
- **ST14** draws the module-only state — target `Contract`, with the help line "Converting a request
  of this type creates a contract; the reviewer picks the contract type at conversion." That is the
  shipped help text for that state, word for word.

Nothing is redrawn and no divergence stands. The frames were drawn before the third state was
written down and turned out to describe it already, which is why the addendum could say the state
"earns its place" rather than inventing it.

### Deviations recorded rather than redrawn

1. **ST14 draws no Slug row.** ST15 and ST16 both draw one — an immutable slug field with its own
   help line — and the shipped request-type editor renders it too, because all three screens are one
   shared component (DES-022) with the mount's own vocabulary: "Slug is immutable — it keys the
   portal form, reporting, and the API." This is an omission in the frame rather than a contradiction
   of a decision, so it follows the M6 sweep's precedent for omissions (amendment 2 above) and is
   recorded here instead of drawn.
2. **ST12's field counts and ST13's rows are illustrative, not seeds.** ST12 draws `4 fields`,
   `5 fields`, and `2 fields` beside the three request types, and ST13 draws three deflection links.
   A fresh install has neither: the migration seeds the **three request types alone**, each with an
   empty form, and seeds **no deflection links** — INT-004 has no sensible default URL. So a
   first-run Administrator sees `0 fields` on every row and an empty links pane. The frames draw a
   configured install, which is what a mock is for; this note exists so nobody reads a mock row as a
   seed row.
3. **The two shipped anatomy changes are already recorded in decisions**, and the frames are not
   redrawn for them: the header strip and the two-line row a pane with columns draws (DES-020's M19/4
   amendment), and the absence of a column-header strip on a single-chip pane like ST13 (DES-052's
   M19/6 amendment).

The rail shipped as ST12/ST13/ST14 draw it: **Intake** joins the Organization group between Contracts
and Entities with the `inbox` glyph, and the `settings.tsx` comment explaining why the entry was
omitted is gone with the omission.

### The Organization · Notifications pane still has no frame

The M18 close and DES-052 both handed the next pass over this file to the M19 Intake sweep, so this
pass has to answer it: **no frame is added for the reminder-lead-times pane here either.** The reason
has moved, though, and the new one is worth stating plainly. In M18 the surface was unsettled; it is
settled now — DES-052 has two mounts and an amendment, and the pane is fully specified by them. What
is left is a drawing task with **no decision behind it**, and adding a frame is how the ST7 and ST3
precedents say _not_ to spend a close: a frame is drawn when it would settle something, and this one
would only restate DES-052.

The **M22 settings pass** below closes this debt without a redraw: the component decisions already
specify the surface, while the ST6 Advisory decoration contradicts MTR-001.

## Amendment (2026-08-21, M20 close, #384) — the portal's notification pane, and what it means for ST3

M20 shipped a **second** notification-preferences surface. It is not in this file's frame table and it
does not belong there, but ST3 is now one of two panes over one component, so this file has to say
where the line falls.

### The portal pane is not a settings screen

`/portal/settings` is the portal's own "Notification settings" page (the INT-001 M20/9 addendum). It
is not under `/settings`, it is not on the settings rail, and no Business User can reach the rail at
all — SET-002's M20/10 addendum puts a Business User floor over the whole tree, Personal included. So
there is no ST-numbered frame for it and none is owed here: this file inventories
`designs/settings.pen`, and the portal is drawn in `designs/intake.pen`.

**It shipped without a frame of its own.** The portal frames I5, I6, and I7 draw the home, the form,
and the request detail; none of them draws a preferences page, because M20/2 recorded that the portal
had no settings destination at the time they were read. M20/9 gave it one. Adding a frame now would
restate DES-050 and settle nothing, which is the ST7/ST3 precedent the M19 close set for exactly this
choice. The **M22 settings pass** below records the same no-redraw answer for all three debts.

### What ST3 now shares, and what it does not

The switch grid behind ST3 was extracted so both panes draw from one component. What differs between
them is which groups they are handed, and nothing else:

- **ST3 (staff) draws four groups** — assigned to you, activity on your records, dates approaching,
  new requests — and **not** group 5, whose audience is the portal's and whose reader a staff member
  is not.
- **The portal pane draws `requester_events` alone**, labelled "Request updates". The other four are
  about contracts, records, dates, and the Inbox, none of which a Business User can open (DD-013).

A Member+ who raises a Request of their own sees both panes and both bells, with neither reading the
other (the NOT-001 M20/9 addendum). That is why the split is by surface and not by role.

### One shipped behaviour behind ST3 changed

**Saving a channel back to its group's default now removes the override row instead of writing one
that agrees with it.** A switch is on or off either way and the effective answer is identical, so
nothing in the frame is redrawn. It is recorded here because the
pane's behaviour moved: the change is at the shared write path, so it reached ST3 as well as the
portal pane. The decision is the NOT-001 M20/9 addendum, which marks the shipped M18/5 behaviour it
supersedes.

### The bell is the same bell

The portal's header carries the M18 bell rendered against the portal's own strip, taking a surface
prop and nothing else (the NOT-005 M20/9 addendum). DES-049 and DES-050 carry their own M20/9 addenda
for the two chrome facts that follow — the trigger's foreground pair per surface, and the portal
header's two-glyph trailing cluster. No settings frame draws either, so nothing here is redrawn.

## Amendment (2026-08-23, M22 close, #474) — the settings debts close without new frames

M22 revisited all three items handed to this pass. **ST6's Advisory Default pill and lock are not
product machinery.** MTR-001 protects Other alone and defines no default matter type, and the live
Types pane still says exactly that after real Matters arm its usage counts. The extra decoration is a
known frame deviation, not deferred work.

**No reminder-lead-times or portal-notification frame is added.** Both panes are complete mounts of
DES-050/DES-052 and a drawing would settle no behavior; the portal pane is also outside this file's
`/settings` inventory. The ST7/ST3 precedent therefore stands. M22's actual Settings delta is the
Statuses and Fields tabs plus live Type usage: existing settings anatomies mounted with Matter
vocabulary, not a reason to redraw unrelated notification panes. No inventory item from an earlier
pass is waiting on M22 now.

## Amendment (2026-08-29, M27/3, #575) — Entities mounts the shared settings anatomies

Entities Settings now carries three panes: **Types**, **Officer roles**, and **Fields**. Types opens a per-type editor that attaches Entity-scoped or global catalog Fields with the same order and required controls as ST15/ST16. Officer roles mounts the SET-003 taxonomy pane, seeded Director, CEO, CFO, Secretary, and Other; Other is protected, and the archive guard's count includes resigned officers because reassignment moves that same set. Fields mounts the shared catalog filtered to `entity` and `global` scopes.

No frame is added. The three screens are configurations of the shipped DES-020, DES-021, and DES-022 anatomies, with Entities vocabulary and the existing Entities section header. The Organization rail's Entities entry and its placement were already recorded when the section first shipped.
