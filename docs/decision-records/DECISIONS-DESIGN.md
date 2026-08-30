# OpenLaw — Design Language & UX Decision Record

Decisions about visual design, design system, UI patterns, and interaction conventions. Platform product decisions live in `DECISIONS.md`; this file covers the look-and-feel layer that drives Pencil mocks and frontend implementation.

Reference: per `DECISIONS.md` DD-004, the team detail-mocks all four modules and cross-cutting capabilities up front in Pencil before implementation. This file records the design-language decisions that those mocks encode.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `DES-###`.

## Scope of this document

This document records **front-end design decisions only** — visual system (color, type, spacing, icons), layout primitives, theming substrate, interaction primitives (keyboard, focus, accessibility), and formatting conventions (date/time/currency, i18n architecture, content tone register).

**Out of scope:** feature-level UX decisions (notifications surface and channels, comment composer / thread UI, status/lifecycle visualization, per-feature empty-state content, Cmd-K command catalog). Those belong with the feature decisions they implement, not in the design system. Where the line is fuzzy — e.g. DES-009's confidentiality affordance is a design pattern derived from feature DD-014 — the rule is: **design patterns are in scope, per-feature affordance design is not.**

## Open questions queued for the next grill-me session

- Secondary typeface for legal-document body (deferred per DES-006 — wait for the contract-detail / document-viewer screens to be mocked before picking)

### Feature-level questions raised but not in scope of this doc

(Listed here so they don't get lost — to be addressed in a separate feature-decisions grill.)

- Status / state visualization (depends on a future DD in `DECISIONS.md` defining the contract lifecycle states themselves)
- ~~Comment-tier UI per DD-016 (visual treatment for "Legal Only" / "Working Team" / "Full Thread")~~ — opened and answered by **DES-023**
- Notifications surface (in-app inbox / toasts / email digest / per-channel preferences)
- Cmd-K command palette (deferred per DES-010; revisit when command catalog crosses ~20 distinct actions or entity index spans more than two domains)
- Empty states and onboarding voice (per-feature; depends on feature scope)

---

## DES-001: Ship three themes (Light / Warm / Dark) as user-selectable from v1

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Three full-fidelity dashboard themes were finalized in `designs/final-themes.pen`:

- **Light** — white body, dark `#0D1117` header & top nav (GitHub Primer-derived), orange `#F78166` accent, green `#1F883D` primary CTA.
- **Warm** — cream `#FBFAF7` / sand `#E8E0D0` body, terracotta `#C97B5C` accent, sage `#5C7A4A` CTA. Has a distinct visual personality that does not share tokens with Light/Dark.
- **Dark** — `#0D1117` body, `#161B22` panels, `#21262D` raised surfaces, orange accent (matches Light), green `#238636` CTA, purple `#BC8CFF` avatar accent.

All three share an identical layout skeleton, type stack (Inter), spacing scale, and component shapes — they differ only in palette. The decision to make is whether one of these is the canonical OpenLaw look (with the others archived as exploration), or whether all three ship as a user-selectable theme set.

### Decision

**All three themes ship from v1 and are user-selectable** in account settings. The implementation substrate is Tailwind CSS with CSS variables, so palette tokens are the only theme-varying values; layout, spacing, typography, and component shape are theme-invariant.

### Rationale

1. The user explicitly likes the Warm option and considers it part of the OpenLaw identity, not an exploration. Demoting it to "considered, archived" would lose a real piece of brand character that distinguishes OpenLaw from clinical SaaS competitors (Ironclad, LinkSquares).
2. Themes 1 and 3 are clearly a matched Light/Dark pair (shared accent, shared `#0D1117` surface used as header in Light and body in Dark) — shipping them together costs almost nothing once the theming substrate exists.
3. The cost delta of 3 themes vs 2 is small **if and only if** tokens are wired through CSS variables from the first component. Retrofitting a multi-theme system onto a hard-coded palette later is the expensive path; doing it from the start is not.
4. The reference persona is technically curious — letting the team choose Light/Warm/Dark is a small, well-bounded customization that doesn't expand support surface (no per-user color picking, no custom themes).

### Alternatives considered

- **One canonical theme (collapse to Light only)** — rejected; loses Warm's brand differentiation and ignores the matched Light/Dark pair the user already built.
- **Light + Dark only, archive Warm** — rejected per user preference; Warm is part of the identity, not an experiment.
- **Per-user custom theme builder** — rejected as over-scope; three curated themes covers the actual need without an open-ended customization surface to support.

### Consequences

- A theming substrate decision is required next: assumed to be Tailwind CSS + CSS variables (shadcn-style), but recorded as its own DES once confirmed.
- Color tokens must be **semantic, not literal** — `--bg-canvas`, `--bg-raised`, `--bg-elevated`, `--border-subtle`, `--text-primary`, `--text-muted`, `--accent`, `--cta-primary` — never `--orange` / `--terracotta` / `--sage`. The same token resolves to a different color per theme.
- Layout, spacing, type sizes, radii, and component shapes are **theme-invariant** by contract. No theme may override geometry; differences are color-only. (The 1px nav height / gap delta in Warm in the current mocks is a deviation that gets normalized in implementation.)
- Every reusable component must be visually verified across all three themes during build-out. The Pencil mocks should grow to cover at least the high-traffic surfaces (matter detail, contract detail, intake triage) in all three themes before implementation; cross-cutting components (composer, status pills, activity feed) need swatches in all three.
- A `theme` user-preference column exists on the user model. Default theme on first install is recorded in a separate DES.
- Status colors (success / warning / danger / info) must work in all three palettes — likely a single semantic green / amber / red / blue family that's lightness-shifted per theme rather than three independent semantic palettes.
- The Pencil archive keeps `final-themes.pen` as the canonical token reference until tokens are extracted into code.

---

## DES-002: Light is the default theme; Warm and Dark are user-selectable

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Per **DES-001**, three themes ship and are user-selectable. A new user who has not yet set a theme preference needs a default. The default is also what a fresh self-host install renders before any user has logged in — and what appears in README screenshots, recorded demos, and embedded marketing images.

### Decision

**Light is the default theme** for any user who has not explicitly set a preference. Warm and Dark are opted into via the account-settings theme picker.

The `theme` user-preference column defaults to `light` at user-creation time. Server-side rendering uses `light` when no preference is known. There is no automatic OS-preference detection (`prefers-color-scheme`) in v1 — the default is unconditional Light.

### Rationale

1. Light is the most universally legible palette for the artifacts a fresh installer first encounters: README screenshots, demo GIFs, embedded blog images, projected conference screens. Light survives compression and glare; Warm and Dark do not, equally.
2. First impression for the reference persona (a General Counsel opening the tool for the first time) is "does this look like a neutral, professional tool I trust with sensitive matters." Light reads neutral; Warm reads opinionated; Dark reads developer-tool. Neutral is the right first-run register.
3. Warm becomes the brand mark (marketing site, illustrations, swag, social) without paying a brand-statement cost on the in-app first impression. Users who want character opt into it; users who don't, don't notice.
4. Dark-as-default has real accessibility friction for users who didn't ask for it (older eyes, bright offices, projector use). Letting users opt in is correct; defaulting them in is not.
5. Auto-detecting `prefers-color-scheme` was considered and deferred — it's a polish optimization, not a v1 requirement, and adds a server-side flash-of-wrong-theme problem that needs care to do well.

### Alternatives considered

- **Auto-detect `prefers-color-scheme` on first run** — deferred, not rejected. Reasonable polish for a later release; would default a user with a dark OS to Dark and a light OS to Light, leaving Warm always opt-in.
- **Warm-as-default-brand** — rejected; commits OpenLaw to a louder brand register than the persona expects on first contact, and degrades the README/demo artifact quality.
- **Dark-as-default** — rejected; accessibility friction for users who didn't opt in, plus poor demo-artifact legibility.

### Consequences

- The `theme` column on the user model has a server-side default of `light`.
- Pre-login screens (sign-in, magic-link landing, public request form) render in Light unconditionally.
- README screenshots, demo recordings, and the project landing page all use Light as the canonical look.
- A future DES may revisit this to add `prefers-color-scheme` detection as the new default behavior; until then, Light is unconditional.
- The setting itself lives on the user, not the deployment — different users on the same self-hosted instance can pick different themes without admin involvement.

---

## DES-003: Design language anchor — "utility-tool with character," GitHub-Primer-shaped

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Per `DECISIONS.md` **DD-004**, the team detail-mocks all four modules and cross-cutting capabilities up front in Pencil. Every component, page, and pattern decision needs a north-star vibe to be consistent. Without an explicit anchor, the design drifts toward whichever reference the implementer last looked at.

The three theme mocks in `designs/final-themes.pen` already encode a strong design language — this decision names it so that later component, density, and tone decisions stay coherent.

### Decision

OpenLaw's visual register is **a utility-first workspace, modeled on GitHub Primer in geometry and density, with a curated brand temperature (the Warm theme from DES-001) available for users who want it.**

Four anchors fall out of that:

1. **Information density before delight.** A dashboard row should fit a meaningful row of data; whitespace is a tool, not a brand asset. Density target sits between Linear (very tight) and Notion (very airy), closer to Linear/Vercel.
2. **Geometry is GitHub Primer.** 6px card radius, 1px stroke borders, 14px base font, top-nav + right-rail layout, status pills not status banners. These shapes are not reinvented per-component.
3. **Brand voice lives in palette and labels, not in shape.** The Warm theme's terracotta / sage / cream and labels like "Triage →" carry the character. The card itself does not get rounded corners or drop shadows to feel friendly.
4. **No decorative imagery in the app chrome.** Empty states get a single icon + a sentence, not an illustration. The marketing site may use illustrations; the app does not.

### Rationale

1. The mocks already encode this: Light/Dark themes are visibly Primer-derived (palette tokens, top-nav-with-underline-active, card-with-1px-stroke, success-green CTA). Naming the anchor explicitly prevents drift when a later contributor reaches for a different reference.
2. The reference persona (per `DECISIONS.md` DD-002 — small in-house legal team) wants to scan dense data quickly. Notion-style airiness pushes meaningful rows below the fold and is the wrong register for someone watching 30 active matters. Linear-style extreme density edges into "developer-tool intimidating" for a non-engineer GC.
3. GitHub Primer is the only major design system that is (a) genuinely free / OSS, (b) production-proven at the persona's density target, and (c) coherent across light and dark — a perfect substrate for a project that already shows three Primer-derived themes in its mocks.
4. Carrying brand voice in _palette_ (Warm) and _labels_ ("Triage →") rather than in _shape_ (rounded everything, drop shadows, illustrations) keeps the geometry layer cheap and theme-stable. A theme-aware system that also varies geometry is a maintenance burden DES-001 explicitly avoids.

### Alternatives considered

- **Notion-friendly (rounded everything, generous whitespace, illustrated empty states)** — rejected; wrong register for the persona and mismatched with the existing mocks.
- **Linear-tight (12/13px, very compressed, sidebar-heavy)** — rejected; the persona is non-engineer GCs and paralegals, not power-user developers. The current 14px / 24px-gap density is the right floor.
- **Bespoke / illustration-heavy brand** — rejected; out of scope for an OSS legal tool's first impression and undercuts the trust register.

### Consequences

- Component decisions default to "what would Primer do" unless there is a specific reason to deviate.
- Density target: 14px base font, 24px section gap, 16px-ish card padding, 1px borders. This is the floor; later decisions may codify a stricter scale.
- Empty states are _single-icon + sentence + optional CTA_, not illustration + paragraph + CTA. Decision recorded as a separate DES if needed.
- Component library choice (next decision) should not introduce shapes that fight Primer's geometry — radii, shadows, and stroke conventions must be overridable via theme tokens.
- The Pencil mocks' consistent geometry across all three themes is the contract; future themes added to DES-001 must adhere to the same geometry.

---

## DES-004: Component substrate — shadcn/ui (copied) + Tailwind CSS + CSS variables + Radix primitives

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

**DES-001** commits to three user-selectable themes via a CSS-variable-based theming substrate. **DES-003** anchors the design language on GitHub Primer geometry (6px radius, 1px borders, 14px base, top-nav with right-rail). Both decisions need a concrete component library + CSS approach + theming system to be realized in code.

The candidate libraries each commit to a specific CSS approach: Mantine and Primer React use CSS-in-JS; Radix Themes uses vanilla CSS + variables; shadcn/ui uses Tailwind + variables + Radix primitives. The user has already indicated Tailwind as the styling system.

### Decision

The frontend component substrate is:

- **Tailwind CSS** for styling — utility classes, no runtime CSS-in-JS, output is plain CSS at build time.
- **CSS variables** for theme tokens — semantic names (`--bg-canvas`, `--bg-raised`, `--text-primary`, `--accent`, `--cta-primary`, etc.). Each theme is a `:root[data-theme="<name>"]` block defining variable values. Tailwind's `theme.colors` reads from these variables.
- **shadcn/ui** for the component library — copied directly into the repository under `components/ui/`, not installed as a dependency. Components are owned source code and may be modified to fit Primer geometry where shadcn defaults differ.
- **Radix primitives** as the underlying headless interaction layer — used for any component requiring focus management, keyboard navigation, or screen-reader correctness (Dialog, Combobox, Dropdown, Tooltip, Tabs, Popover, etc.).

shadcn defaults are accepted unless they fight the geometry from DES-003. The known initial overrides are:

- Border radius: shadcn default `0.5rem` (8px) → override to `6px` to match the Pencil mocks.
- Default focus ring sizing follows Primer's tighter convention rather than shadcn's default; tactical, recorded in component code.

The implementation counterpart of this decision is recorded in `DECISIONS-TECH-STACK.md` as **TECH-001**.

### Rationale

1. shadcn's default geometry (6–8px radius, 1px borders, neutral palette, success-green CTA) is a near-1:1 match for the Primer-shaped mocks. Less time fighting library defaults than any other option.
2. shadcn's `:root` CSS-variable theme model is _exactly_ the substrate DES-001 requires — adding the Warm theme is "define another `[data-theme="warm"]` block," not "rewrite components."
3. shadcn is copy-paste-into-the-repo, not a versioned dependency. This matches `DECISIONS.md` DD-001 / DD-009 (portability, no vendor lock-in) — there is nothing to break when an upstream releases. The components are AGPL-relicensable per DD-011 since they enter the project as source code.
4. Radix primitives give a high accessibility floor for free. For a tool dealing with sensitive matters and a reference persona that includes a General Counsel reading complex tables daily, keyboard-and-screen-reader correctness is not optional. Re-implementing Radix-equivalent behavior is months of work.
5. Tailwind compiles to plain CSS at build time — no runtime overhead, no styled-system magic. A self-host contributor can read a component and understand its visuals without learning a new abstraction. Aligned with DD-001's "anyone clones this and it works" goal.

### Alternatives considered

- **Bare Radix + Tailwind, build the design system from scratch (no shadcn).** Rejected; re-implements what shadcn already wrote without a meaningful payoff. The shadcn defaults are net positive here, not friction.
- **Primer React directly.** Rejected; Tailwind commitment rules out Primer's CSS-in-JS approach, and Primer React is in slow-maintenance status.
- **Mantine.** Rejected; Emotion / CSS-in-JS conflicts with Tailwind, and Mantine's default shapes (rounded corners, soft shadows) fight the Primer geometry from DES-003.
- **Radix Themes (Radix's own theming layer).** Rejected; smaller ecosystem and less momentum than shadcn, and shadcn already wraps Radix primitives at a higher level.
- **Fully custom (no library).** Rejected; out of proportion for a v1 OSS tool. We pay the design-system cost twice for no gain.

### Consequences

- The frontend framework is locked to **React** as a downstream consequence — shadcn/ui is React-only. Recorded in `DECISIONS-TECH-STACK.md` TECH-001.
- Repository layout adds: `components/ui/` (shadcn components, owned source), `components/` (project components), `styles/themes/` (per-theme CSS-variable files: `light.css`, `warm.css`, `dark.css`).
- `tailwind.config.js` defines a semantic color scale that reads from CSS variables; Tailwind utilities like `bg-canvas` / `text-primary` resolve through the active theme.
- shadcn updates are pulled by re-copying components or by reading the upstream diff and applying it manually — not by `npm update`. This is the trade-off of owning the source. _(2026-08-28: the re-copy half is no longer available; the wrappers have diverged. See the TECH-001 note of the same date.)_
- Components must be visually verified across all three themes during build-out (per DES-001). A storybook-style preview surface or equivalent would help; deferred as a separate decision.
- Status colors (success / warning / danger / info) defined in DES-001 implementation will live in the same theme files; semantic naming (`--status-success`, `--status-danger`) keeps shadcn's default `--destructive` compatible.

---

## DES-005: Color tokens — semantic, theme-aware, four surface tiers, paired status pills

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

**DES-001** commits to three user-selectable themes; **DES-004** commits to Tailwind + CSS variables as the substrate. This decision defines the canonical token vocabulary that every component reads from — names, roles, and the per-theme value mapping.

The tokens were derived by inventorying every distinct color used in `designs/final-themes.pen` across all three themes (Light, Warm, Dark) and grouping them by _role_, not by hue. The full color audit revealed a richer palette than the dashboard screenshot suggested: 4 surface tiers, 2 border tiers, 8 text roles, 6 status pill families (each with a paired bg/fg), a counter-badge family, a confidentiality token, file-type icon colors, and an avatar palette.

The reference implementation is `styles/themes/light.css`, `styles/themes/warm.css`, and `styles/themes/dark.css`, with `styles/globals.css` mapping every CSS variable into Tailwind's `@theme` block so utilities like `bg-canvas`, `text-primary`, `border-default`, and `bg-status-success-bg` are available throughout the codebase.

### Decision

**Token roles.** Color tokens are organized by role, never by hue. Component code references roles; theme files supply values. The role taxonomy is:

#### Surfaces (4 tiers — escalating elevation)

- `--bg-canvas` — page background.
- `--bg-raised` — cards, panels, primary content surfaces.
- `--bg-section-header` — section-header strip inside a card; sub-bar background.
- `--bg-control` — interactive surfaces: secondary button bg, kbd chip, search-input interior.
- `--bg-inverted` — header & top-nav surface. In Light this is _darker_ than canvas (the GitHub-style dark-on-light pattern); in Warm it's a _deeper cream_; in Dark it's a _darker_ near-black than canvas.

#### Borders (3 tokens)

- `--border-default` — panel outlines, sub-bar bottom rule.
- `--border-muted` — inner row dividers (table rows, list items inside a card).
- `--border-on-inverted` — borders within the `--bg-inverted` region.

#### Text (8 roles)

- `--text-primary` — body, h1–h3.
- `--text-muted` — secondary copy, descriptions, timestamps.
- `--text-subtle` — placeholder, disabled.
- `--text-on-inverted` — text rendered on `--bg-inverted`.
- `--text-on-accent` — text rendered on `--accent` fill.
- `--text-on-cta` — text rendered on `--cta-primary` fill.
- `--text-link` — hyperlinks ("View all →", "Audit log →").
- `--text-danger` — _inline_ high-urgency text (e.g. "due May 5"); intentionally darker than `--status-danger-fg`.

#### Brand (2 roles)

- `--accent` — active nav underline, mention chips, default avatar fill, focus accent.
- `--cta-primary` — primary CTAs, "Triage →," success-affirmative button fill.

**Status — paired bg + fg (6 families)** — each pill is a `bg`/`fg` pair so contrast is theme-controlled, not derived.

- `--status-success-bg` / `--status-success-fg` — completed, signed, approved.
- `--status-warning-bg` / `--status-warning-fg` — in progress, awaiting, expiring.
- `--status-info-bg` / `--status-info-fg` — informational, draft, "with business," "with external."
- `--status-danger-bg` / `--status-danger-fg` — blocked, rejected, overdue, destructive.
- `--status-assigned-bg` / `--status-assigned-fg` — assigned, mention-style; purple in Light/Dark, mauve in Warm.
- `--status-onhold-bg` / `--status-onhold-fg` — paused / "On hold"; the only **filled-dark** soft pill, distinct from the soft-tinted variants.

#### Counter badges

- `--badge-count-bg` / `--badge-count-fg` — small pill inside section headers showing a count (e.g. "15"); intentionally neutral (gray) so it doesn't compete with status semantics.
- `--badge-alert-bg` / `--badge-alert-fg` — the solid attention badge on an activity-bar applet icon (**DES-016**), added 2026-08-10 with #47. Filled red, not a soft tint, so a count reads at 11px over a 20px glyph. The only user today is the chat unread count (CMT-004). See the DES-016 implementation clarification for the per-theme values.

**Confidentiality (per `DECISIONS.md` DD-014)**

- `--confidential-fg` — "🔒 CONFI" inline marker. Genuinely theme-divergent in semantics: Light and Dark use _purple_ (deliberate cultural marker for "privileged"); Warm uses its _terracotta-brown_ (the palette has no purple hue). Recorded as one token with three semantically-different values; the affordance pattern itself is decided in a later DES.

**Theme-invariant brand colors** — outside `:root` because they don't theme:

- `--file-word`, `--file-excel`, `--file-pdf`, `--file-default` — file-type icon backgrounds.
- `--avatar-1` … `--avatar-8` — generated avatar fills, deterministic per user id (hash → palette index). Theme-invariant because user identity should not change based on theme.

**Hue groupings.** Where a status pill's foreground is reused as an inline icon color (e.g. the leading status dot on a matter row), the icon reads the corresponding `--status-*-fg` directly — no separate `--icon-*` tokens.

**Tailwind exposure.** Every token above is registered in `styles/globals.css` under `@theme` (Tailwind v4 CSS-first config), making it available as a utility:

```html
<div class="bg-raised border border-default">
  <header class="bg-section-header">
    <h3 class="text-primary">My open matters</h3>
    <span class="bg-badge-count-bg text-badge-count-fg">15</span>
  </header>
  <span class="bg-status-warning-bg text-status-warning-fg">In progress</span>
</div>
```

### Rationale

1. **Roles, not hues, survive theming.** A token named `--orange-500` is a lie in the Warm theme (terracotta) and a worse lie in Dark (where the equivalent shifts in lightness). `--accent` is the only honest name across all three. This is the same pattern Primer, Radix, and shadcn use.
2. **Four surface tiers match what the mocks actually use.** The Dark theme alone uses four distinct backgrounds (`#0D1117`, `#161B22`, `#1C2128`, `#21262D`) with semantically different roles. Three tiers would force a collapse and lose the section-header / control distinction. Light collapses some tiers to the same hex, which is fine — semantic tokens are allowed to share values per theme.
3. **Paired status `bg`/`fg` makes contrast a theme decision, not a derivation.** A code path that does `lighten(status-success-fg, 0.85)` for the bg works in Light but not in Dark (Dark's success bg is _darker_ than the fg). Per-theme paired values make all three legible by construction.
4. **Inline danger text is darker than pill danger text.** Pill danger has a soft bg behind it; inline danger sits on the page surface and needs more contrast to feel urgent without being a pill. Two tokens, two roles, no derivation.
5. **`--confidential-fg` is a single token with semantically-different values per theme.** Warm intentionally substitutes terracotta-brown for purple because Warm's palette has no purple hue. Forcing purple into Warm would be the wrong call; the confidentiality _affordance_ is "marker that contrasts and reads as 'gated,'" not "specifically purple." Decision recorded so the discrepancy is intentional, not accidental.
6. **Avatar and file-type colors are brand-stable, theme-invariant.** A user's avatar color is part of their identity — flipping it when a viewer changes theme would be wrong. File-type colors derive from external brand convention (Word blue, Excel green, PDF red) and don't theme.

### Alternatives considered

- **Three surface tiers (collapse `--bg-section-header` and `--bg-control`).** Rejected — Warm and Dark visibly use both as distinct values for distinct purposes; collapsing them would lose the tier in those themes for no gain in Light.
- **Single status palette (one `--status-success` instead of `bg`/`fg` pair).** Rejected — bg/fg pairing is what makes Dark theme's status pills legible without runtime color math.
- **Generate Warm and Dark from Light via lightness rotation.** Rejected — the Warm palette is hand-tuned and includes substitutions (terracotta for purple) that no automatic transform produces. The 3 themes are 3 hand-curated vocabularies, not 3 derived shades.
- **Skip `--confidential-fg`, use `--accent` for confidentiality marker.** Rejected — accent is the active-nav / mention color and gets visually loud; conflating it with confidentiality muddles both.
- **Drop `--status-onhold-bg`/`-fg` and represent "on hold" with a `--badge-count` style.** Rejected — "on hold" is a status, not a count; using the count token would visually demote it. The filled-dark soft pill is its own visual register and earns its own token.

### Consequences

- The canonical token reference lives in three files: `styles/themes/light.css` (default in `:root`), `styles/themes/warm.css` (`[data-theme="warm"]`), `styles/themes/dark.css` (`[data-theme="dark"]`). All three are committed to the repo as part of this decision.
- `styles/globals.css` is the single Tailwind v4 entry: imports Tailwind, registers every CSS variable into `@theme`, imports the three theme files in order (light first as the default, warm and dark as data-attribute overrides).
- Theme switching is a single attribute change on `<html data-theme="...">`. No JavaScript theme-provider needed; no flash-of-unstyled-content risk if the attribute is rendered server-side from the `theme` user preference (per DES-002).
- Components reference utilities like `bg-canvas`, `text-primary`, `bg-status-success-bg`. They never reference raw hex or raw CSS variables. Lint rule recommended (deferred): forbid `bg-[#...]` arbitrary-value classes outside theme files.
- Adding a fourth theme later means writing one more theme file with the same set of tokens. No component changes required.
- The Pencil mocks remain the visual ground truth for the values; if a component looks wrong, fix the value in the theme file, not in the component.
- Confidentiality affordance (lock icon, ribbon, banner placement) is **not** decided here — only the color token. The affordance pattern is a separate DES.
- File-type icon expansion (PowerPoint, Markdown, image types, generic) is deferred; v1 ships the four colors above and a default.
- Avatar palette specifics (which 8 hues, how user-id hashes to index) are deferred to a separate DES; placeholders defined in theme files.

---

## DES-006: Typography ramp — Inter, 8-step size scale, 3 weights, reserved mono

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Per DES-003, Inter is the only typeface in the mocks across all three themes. DES-005 left the type ramp deferred. This decision pins the size scale, weights, line-heights, and the mono/serif policy so every component picks from a finite, named ramp instead of inventing per-instance sizes.

The size inventory was harvested from `designs/final-themes.pen` across all three themes. Eight discrete sizes are in use (9–32px), and three weights (400 / 500 / 600). One outlier (700-weight on tiny avatar initials) is normalized below.

### Decision

**Single typeface for the app:** Inter, via `--font-sans`. No CSS-in-JS @import is needed — Inter is loaded from a self-hosted woff2 (path TBD when the build pipeline lands) so the font does not depend on a third-party CDN per `DECISIONS.md` DD-001 (portability).

**Reserve a monospace stack:** `--font-mono` is registered for IDs (`#M-2418`), file paths, code blocks, and any future contract-clause-text. The actual mono face is left as a generic fallback chain (`ui-monospace, "JetBrains Mono", "Fira Mono", monospace`) — picking a specific face is deferred until a screen actually needs it.

**Defer a secondary typeface for legal-document body.** A serif or alternate sans for long-form clause text is a reasonable future need, but the contract-detail / document-viewer screens are not yet mocked. Picking now would be premature.

**Size ramp — 8 named sizes, line-heights baked in:**

| Token         | px  | Line-height (ratio) | Role in mocks                                                    |
| ------------- | --- | ------------------- | ---------------------------------------------------------------- |
| `--text-xs`   | 11  | 1.45                | status-pill labels, counter badges, avatar initials              |
| `--text-sm`   | 12  | 1.5                 | metadata, dates, secondary timestamps, tiny dates                |
| `--text-base` | 13  | 1.5                 | dense list-item body, intake-row author/title, "View all →" link |
| `--text-md`   | 14  | 1.5                 | primary body, list-item titles, nav items, section headers       |
| `--text-lg`   | 18  | 1.4                 | subheads (deferred screens — not in dashboard mock)              |
| `--text-xl`   | 20  | 1.3                 | page title (h1) — letter-spacing −0.2px                          |
| `--text-2xl`  | 24  | 1.25                | module hero (deferred screens)                                   |
| `--text-3xl`  | 32  | 1.2                 | empty-state hero, marketing                                      |

Sizes are exposed as Tailwind utilities `text-xs` through `text-3xl`. Components pick from the ramp; no arbitrary-value `text-[15px]` classes anywhere outside theme files (lint rule deferred).

**Weight ramp — 3 weights only:**

| Token             | Value | Role                                                         |
| ----------------- | ----- | ------------------------------------------------------------ |
| `--font-normal`   | 400   | body copy, list-item descriptions, search placeholder        |
| `--font-medium`   | 500   | inactive nav items, "View all →" links, status pill labels   |
| `--font-semibold` | 600   | active nav, titles, section headers, badges, avatar initials |

The 700-weight on tiny activity-feed avatar initials in the dashboard mock is **normalized to 600**. At 9–10px those initials are already maximally compressed; an extra 100 weight units do not improve legibility and add a third weight token to maintain.

**Letter-spacing convention.** `−0.2px` on `h1` only, applied as a base-layer rule (`@layer base h1 { letter-spacing: -0.2px; }`). No tracking token; no per-utility class.

**Tabular numerals.** Inter's tabular-numeral feature is opt-in via Tailwind's built-in `tabular-nums` utility (`font-variant-numeric: tabular-nums`). Use it on table cells, dates, durations, counters, and any other column where vertical alignment matters. Default text uses proportional numerals.

### Rationale

1. **Eight sizes covers the dashboard mock with three slots of headroom.** The dashboard uses sizes 11–20; sizes 18 / 24 / 32 are reserved for screens not yet mocked (intake landing, empty-state hero, contract-detail subhead). A tighter ramp (5–6 sizes) would force later screens into a wider step than the design wants.
2. **Line-heights baked into size tokens prevent the "what line-height for this size again?" question.** Single lookup per size; no separate tracking decision per usage.
3. **Three weights is the smallest ramp that preserves the visible weight rhythm in the mocks** (inactive-nav 500 vs active-nav 600 is a real, deliberate distinction worth preserving). Collapsing to 2 weights flattens the nav.
4. **Reserving `--font-mono` now is free** — adds one CSS-variable line to `globals.css`, avoids a future bikeshedding round when the first mono-needing screen lands.
5. **Deferring a serif body face is the right call.** Picking a serif for long-form clause text is a real decision (license, variable-font availability, x-height match with Inter, dark-mode legibility), and the screen that justifies it doesn't exist yet. Premature commitment ties our hands.
6. **Self-hosted Inter, not Google Fonts.** Per DD-001 (portability), a fresh self-host install must work without network access to fonts.googleapis.com. Inter is OFL-licensed; bundling the woff2 in the build is allowed.
7. **Tabular numerals as opt-in, not default.** Tabular spacing improves columns but harms reading flow in body copy; the Tailwind utility makes the choice explicit per surface.

### Alternatives considered

- **Tighter 5-step ramp (xs/sm/base/lg/xl).** Rejected; loses the 13/14 distinction that the mocks use to differentiate dense rows from primary rows, and forces later screens into a single large display step.
- **Use the rem-based default Tailwind scale (1rem = 16px).** Rejected; the mocks anchor on 14px body, not 16px. Re-basing every utility would invalidate the mocks' visual contract.
- **Add a 4th weight (700 for stronger emphasis).** Rejected; 600 covers every emphasis case in the mocks. Reserving 700 just adds a token nobody picks.
- **Pick a serif for body text now (e.g. Source Serif, Crimson Pro).** Deferred per the rationale above.
- **Load Inter from Google Fonts CDN.** Rejected per DD-001; OpenLaw must self-host its assets.

### Consequences

- `styles/globals.css` registers `--text-xs` through `--text-3xl` (with line-heights), `--font-normal` / `--font-medium` / `--font-semibold`, `--font-sans`, and `--font-mono` in `@theme`. Tailwind utilities (`text-md`, `font-semibold`, `font-mono`) read from these.
- Inter must be added to the build as a self-hosted woff2 with appropriate `@font-face` declarations. The exact load strategy (preload, swap, subset to Latin) is a build-pipeline decision deferred to TECH-### when the frontend repo is scaffolded.
- Component code uses Tailwind utilities; arbitrary sizes (`text-[15px]`) and arbitrary weights (`font-[450]`) are forbidden outside theme files.
- The avatar-initial 700 weight in the existing mocks is intentionally not preserved in implementation — components render initials at 600.
- A future DES will pick a secondary typeface for long-form legal-document body when the contract-detail / document-viewer screens are mocked.
- A future DES will pick a specific monospace face if one is needed (otherwise the fallback chain remains the implementation).

### Addendum (2026-08-14, M12/2 #185): the doc panel does not settle the secondary typeface, and says why

DOC-004 named the doc panel as the surface that would settle the deferred pick, and M12/2 is where the panel got built. It does not settle it, and the reason is worth recording so the deferral does not get re-opened by the same argument next milestone.

**A rendered legal document is not text we set.** The panel's PDF surface draws the file's own pages through pdf.js — its embedded fonts, its own metrics, its own layout. Word and PowerPoint reach the same surface in M12/3, because DOC-004 converts them to a PDF rendition and that rendition is what renders. Images are pixels. So nothing on the panel is long-form legal body copy in a typeface OpenLaw chose, and giving it one would be overriding what a signed document looks like — which is the opposite of what DOC-005 promises.

**The mocks agree.** `designs/documents.pen` DOC2 draws its simulated contract page in **Tinos** at 13px on a 1.6 line-height, with 700-weight section headings — a Times-metric serif. That is a drawing of what a PDF looks like, not a specification for type we render. The one place in the same file where OpenLaw really does set document text — DOC6's parsed email body — is drawn in **Inter**, the app face, and M12/4 builds it that way.

**The deferral therefore moves rather than closing.** The surface that would settle it is DOC-003's in-app compare view over extracted text (M32): a formatted comparison of two versions is the one place OpenLaw sets long-form clause text itself, and it is where a serif would earn its licence, its subsetting, and its dark-mode legibility check. Tinos is where that decision should start from, because it is what the mocks already draw and it is OFL-licensed and Times-metric.

Nothing ships from this addendum: no second `@font-face`, no `--font-serif` token. A face nothing renders is weight in the bundle and a token nobody picks.

### Addendum (2026-08-18): a record's own title is `text-md`, not `text-lg` or `text-xl`

The size ramp's "page title (h1)" role names `text-xl` (20px); the contract and entity record headers shipped at `text-lg` (18px) instead — already smaller than the documented role before this addendum, and still too large in practice. Both sit inside a single-line subbar crowded with a breadcrumb link, a reference badge, a status pill, and the stage pipeline, all set at 13px or smaller — a role built for a standalone page heading does not fit a title squeezed among that much other chrome on one row.

**The record-title role is split from the standalone page-title role.** `text-xl` stays the size for a page title that owns its own line with nothing beside it. A record's `<h1 id="page-title">`, which shares its line with breadcrumb, reference, and status chrome, now sets `text-md` (14px, `font-semibold`) — one step above the 13px chrome around it, enough to still read as the heading without dominating the row. Both record headers (`contract-record.tsx`, `entity-record.tsx`) share the same subbar shape and move together for that reason. The `-0.2px` h1 letter-spacing (base-layer rule) still applies; it is a rule about the element, not about which size role that element carries.

---

## DES-007: Spacing scale + density target — Tailwind default scale, 5 layout tokens, 4 chrome dimensions, normalized to 48/8/16

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

DES-003 anchored the density target qualitatively ("between Linear and Notion, closer to Linear"). This decision pins the actual numbers — what spacing scale components draw from, what page-level rhythm tokens exist by name, what the chrome dimensions are, and which density wins when the Pencil mocks disagree.

A spacing-value inventory of `designs/final-themes.pen` shows two real inconsistencies between themes:

- Top-nav height: Light/Dark `48px` vs Warm `46px`
- Top-nav item gap: Light/Dark `8px` vs Warm `6px`
- Header horizontal padding: Light/Dark `16px` vs Warm `20px`

Per DES-001, geometry is theme-invariant — these need to be normalized to a single value, not preserved as theme-specific.

### Decision

**Spacing utility scale:** Tailwind v4's default 4px-step scale, used unmodified. Every spacing value in the mocks (10, 12, 16, 20, 24, 32) maps to a stock utility (`gap-2.5`, `p-3`, `p-4`, `p-5`, `gap-6`, `p-8`). No new step values are added.

**Five named layout tokens** for page-level rhythm — registered as Tailwind utilities so layouts read declaratively (`px-page-x`, `gap-section-gap`, `p-card-x`):

| Token                   | px  | Role                                                              |
| ----------------------- | --- | ----------------------------------------------------------------- |
| `--spacing-page-x`      | 32  | body horizontal padding; sub-bar horizontal padding               |
| `--spacing-page-y`      | 24  | body vertical padding                                             |
| `--spacing-section-gap` | 24  | between cards in a column                                         |
| `--spacing-card-x`      | 16  | card interior horizontal padding                                  |
| `--spacing-card-y`      | 10  | card row interior vertical padding (12 for section-header strips) |

**Chrome dimensions** (four at decision time; **DES-016** later split the rail into activity bar + panel) — fixed sizes for the application shell, registered as plain CSS variables (not utility-generating) and referenced from the layout shell components only:

| Token                           | px  | Role                                                                                          |
| ------------------------------- | --- | --------------------------------------------------------------------------------------------- |
| `--height-header`               | 62  | top header strip                                                                              |
| `--height-nav`                  | 48  | top navigation row                                                                            |
| `--height-subbar`               | 64  | per-page sub-bar (page title + page actions)                                                  |
| `--width-activitybar`           | 48  | record-page activity bar _(amended by **DES-016**; originally a single `--width-rail: 320`)_  |
| `--width-activitybar-indicator` | 3   | active-applet strip on the bar's leading edge _(added by the **DES-016** clarification, #47)_ |
| `--width-panel`                 | 320 | record-page side panel hosting the active applet _(amended by **DES-016**)_                   |
| `--width-docpanel`              | 720 | the doc panel, DES-016's wider sibling layer _(added by the **DES-016** clarification, #185)_ |

**Density normalization.** When Light/Dark disagree with Warm in the existing Pencil mocks, **the implementation follows Light/Dark**: nav height 48px, nav gap 8px, header padding 16px. Warm's slightly tighter mock values were Pencil-time tweaks, not a deliberate brand-density signal. Per DES-001's geometry-invariance contract, the Warm mocks will be normalized to match in a follow-up Pencil pass; until then the implementation is the source of truth.

### Rationale

1. **Tailwind v4's default scale already covers every value the mocks use.** Replacing or extending the scale would create two parallel vocabularies (custom + default) without removing any. The discipline is "use what's there"; the scale is fine as-is.
2. **The 5 layout tokens earn their names.** `px-page-x` (which resolves to 32px) appears in the body, sub-bar, and every future detail page — making the body gutter a one-line change is worth a token. Pure Tailwind utilities (`px-8`) would scatter the value across files; renaming becomes a hunt-and-replace.
3. **Chrome dimensions don't need to be Tailwind utilities.** The header, nav, sub-bar, and rail show up in exactly one place each (the layout shell). Generating utilities for them would clutter the namespace; CSS-variable references (`style={{ height: "var(--height-nav)" }}` or `h-(--height-nav)`) are sufficient and cleaner.
4. **48px nav over 46px is the conservative pick.** The 2px difference does not change the perceived density (the eye does not register it), but 48px stays comfortably above the 44px minimum touch-target floor (WCAG 2.1 / Apple HIG / Material) for an eventual mobile/tablet view, while 46px sits right on the edge. Going with the value used in two of three themes also requires fewer downstream mock changes.
5. **The mocks-vs-implementation asymmetry is acceptable.** The Pencil file is a working artifact, not a contract. When the working artifact disagrees with the geometry-invariance contract from DES-001, the contract wins. The Warm mock will be brought into alignment in a follow-up; the implementation does not wait.

### Alternatives considered

- **Define a custom spacing scale (e.g., 4 / 8 / 12 / 16 / 24 / 32 only).** Rejected; constrains every component to a 6-step ramp when Tailwind's default already provides the right granularity for free.
- **Skip the 5 layout tokens, use raw `px-8` / `gap-6` everywhere.** Rejected; the body gutter and section gap are visually load-bearing values that will need to change as a unit. Anchoring them in named tokens prevents drift.
- **Normalize to Warm's 46/6.** Rejected; tighter than necessary, costs touch-target headroom, and requires changing two of three theme mocks rather than one.
- **Make density a user preference (compact / comfortable).** Rejected as out of scope for v1. The persona is small enough that one density target is sufficient; offering two doubles the visual-verification burden across three themes.
- **Register chrome dimensions as Tailwind utilities (`h-nav`, `w-rail`).** Rejected; they appear in too few places to earn the namespace pollution.

### Consequences

- `styles/globals.css` adds 5 `--spacing-*` layout tokens (registered in `@theme` so they generate Tailwind utilities) and 4 chrome-dimension CSS variables (also in `@theme` for centralized location, but not utility-generating under Tailwind v4's namespace conventions).
- The Pencil mocks for the Warm theme should be normalized to 48px nav / 8px gap / 16px header padding in a follow-up pass. Not a blocker — implementation proceeds against the contract.
- A breakpoint / responsive-collapse strategy is **not** decided here. The 320px right-rail and the top-nav layout assume a desktop viewport target; mobile/tablet is a separate DES.
- The record-page right side defers to **DES-016**: `--width-activitybar: 48px` + `--width-panel: 320px` are the layout contract (`--width-rail` is retired). The applet panel always docks as a flex sibling of the record content (DES-016 2026-08-17 clarification; its overlay-below-1100px rule is superseded). The doc panel docks above 1400px of record-content width and overlays that content below it (DES-016 2026-08-18 second-pass clarification) — the applet panel and the activity bar are outside the box it covers, so it never hides either. Future pages that opt out (e.g. full-bleed editors, focus mode) override at the layout-shell level rather than via per-page padding math.
- Dense / comfortable user-preference density is parked. If it ever ships, the 5 layout tokens are the right surface to vary (smaller `--spacing-card-y` for compact, larger for comfortable) — adding a `data-density="compact"` attribute to `<html>` would mirror the theme-attribute pattern from DES-001.

---

## DES-008: Iconography — Lucide as the v1 icon library, sizes 16/20/24, currentColor inheritance

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

The Pencil mocks use box-drawing characters (`⌂`, `▤`, `⊟`, `⎙`, `◇`) and emoji (`🔒`, `📅`, `🔔`, `📚`) as icon placeholders. These do not survive into implementation — they render inconsistently across operating systems, ignore the design system's color tokens, and cannot be styled. A real icon library is required before any component build-out.

### Decision

The icon library for v1 is **Lucide** (`lucide-react` package).

**Sizes** are pinned to three values matching the mocks' usage:

- `16px` — inline icons (status-row leading dots, inline action affordances, breadcrumb separators)
- `20px` — button icons, sub-bar control icons
- `24px` — top-nav glyphs, section-header icons

**Stroke width** is the Lucide default `2`. No per-icon override.

**Color** is via `currentColor` inheritance. Components apply text-color utilities (`text-muted`, `text-status-success-fg`, `text-confidential`) and the icon picks up the color. There is no separate `--icon-*` token family — DES-005's status and text tokens are the authoritative color source.

**File-type icons** continue the mocks' pattern in v1: a colored rounded square (`--file-word`, `--file-excel`, `--file-pdf`, `--file-default` from DES-005) with a single-letter label inside. Migrating to brand-asset SVGs (Microsoft / Adobe glyphs) is deferred to whenever the document-detail screen wants true file-type fidelity.

**Emoji in the existing mocks does not ship.** Implementation substitutes Lucide equivalents: `🔒` → `Lock`, `📅` → `Calendar`, `🔔` → `Bell`, `📚` → `BookOpen`. The Pencil mocks should be updated in a follow-up pass; implementation does not wait.

**No bespoke legal-domain icons in v1.** Generic Lucide glyphs cover every need in the four-module + cross-cutting capabilities scope. When a domain-specific need arises (e.g. a courtroom gavel for litigation matter types), the choice between commissioning a custom glyph and adopting it into Lucide-style is revisited as a separate DES.

### Rationale

1. **Lucide ships with shadcn/ui by default** (DES-004). Picking any other library means re-writing every shadcn-provided icon reference in copied components, and breaking the path of least resistance for future component additions.
2. **Visual register matches DES-003.** Lucide's 2px-stroke 24px-grid outline style aligns with GitHub Primer's geometry — the corner radii, the line caps, and the optical weight all sit comfortably next to the 6px-radius cards and 14px Inter type.
3. **License (ISC) is AGPL-compatible** per `DECISIONS.md` DD-011. Lucide is community-maintained (forked from Feather), with regular release cadence and broad coverage (~1500 icons).
4. **Coverage matches the mock inventory.** Top-nav glyphs, status indicators, action affordances, confidentiality marker, calendar, notifications — all covered. The only gap is brand-specific file-type icons, which the colored-square pattern from the mocks already handles cleanly.
5. **Single icon family is cheaper than mixing.** Multi-set introduces inconsistent stroke weights, inconsistent grid spacing, and "which set has X?" decisions per usage. Lucide-only is the floor.
6. **Three sizes is the smallest scale that respects the mocks' visible distinctions** (inline icons sit at 16, button icons at 20, nav at 24). Forcing everything to one size loses visual hierarchy in the top nav.
7. **`currentColor` inheritance lets icons reuse the color tokens from DES-005** without a parallel `--icon-*` token family. A status pill's icon and label share `--status-success-fg` automatically.

### Alternatives considered

- **Heroicons.** Rejected; smaller library (~300 icons) lacks several mock-required glyphs (specific status indicators, file types). Tailwind-team alignment is a marginal advantage; coverage is the deal-breaker.
- **Octicons (GitHub's own).** Rejected; closer to Primer in visual heritage, but coverage is narrower than Lucide and shadcn's components reference Lucide. Integration cost outweighs the visual-fidelity gain.
- **Phosphor (multi-weight).** Rejected; the 6 weights are an emphasis system we don't need, and the visual register tilts slightly more decorative than DES-003 wants.
- **Tabler.** Rejected; coverage is enormous (~5000) but a lot of that is over-specific (brand logos, niche industry glyphs). Lucide hits the sweet spot.
- **Custom icon set built on Lucide as a foundation.** Rejected as v1 over-scope. Revisit when we hit the third missing icon.
- **Multi-library mix (Lucide for general, Octicons for status indicators).** Rejected; inconsistent weights and grids are visible at small sizes and the maintenance cost is permanent.

### Consequences

- `lucide-react` is added as a frontend dependency when the frontend repo is scaffolded (per TECH-001). Self-hosted assets are not required — Lucide ships as React components compiled into the bundle.
- Component code imports specific glyphs (`import { Lock, Bell, Calendar } from "lucide-react"`); tree-shaking removes the ~1480 icons not used, so bundle impact is minimal.
- The Pencil mocks' emoji and box-drawing-character icons are placeholders; a follow-up Pencil pass should swap them for Lucide-style outline glyphs to keep the mocks faithful to the implementation. Not a blocker.
- Icon size is communicated via the `size` prop on Lucide components (`<Lock size={16} />`); a small wrapper component (`<Icon name="lock" size="inline" />`) is optional and deferred — direct Lucide imports are fine for v1.
- File-type icon migration to brand SVGs is deferred; the v1 implementation matches the mocks (colored square with letter), allowing graceful upgrade later without changing the surrounding component shape.
- Domain-specific icon needs are tracked as they arise; no v1 budget for custom glyphs.

---

## DES-009: Confidentiality affordance — 3-tier pattern (inline marker / detail banner / composer warning)

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

`DECISIONS.md` **DD-014** commits to silently hiding confidential matters from non-team Members (no `[hidden]` placeholders, no counts, nothing leaked) while letting _included_ viewers (matter team + Admins + creator) work normally. For included viewers, the surface must clearly and persistently signal "this is confidential" so the user does not accidentally screenshot, paste, or @-mention outward.

The Pencil mocks include a single inline affordance — `🔒 CONFI` text label inline next to the matter title in the row view, rendered with `--confidential-fg` from DES-005. That covers list views but is missable in the detail surface where the highest-leverage actions (commenting, document upload, @-mention) happen.

### Decision

**Three escalating affordance tiers**, used together — not interchangeably — across every surface touching a confidential matter:

**Tier 1 — Inline marker.** Rendered as a `Lock` icon (Lucide, 12–14px) + the literal text "CONFI" (uppercase, letter-spacing `0.4`), in `--confidential-fg`. Appears inline next to the matter title wherever the title appears outside the matter's own detail page: list rows, search results, breadcrumbs, mention chips, and as a small lock-only badge next to _every comment, activity-entry, and document filename_ inside a confidential matter (so copy-pasted snippets carry the marker visually).

**Tier 2 — Detail-page persistent banner.** Rendered between the top-nav (`--height-nav`) and the page sub-bar (`--height-subbar`) on every page within a confidential matter — the matter detail, its document detail pages, its activity timeline, etc. The banner is **chrome, not a notification**: no dismiss button, no close action, always visible.

- Height: `--height-confidential-banner: 36px`
- Background: `--confidential-bg` (new token, added to DES-005 token system as part of this decision)
- Foreground: `--confidential-fg` for icon + text
- Border bottom: 1px in `--border-default` to match sub-bar separation
- Layout: `Lock` icon (16px) + "Confidential matter — Members + named team only" text, left-aligned · "Manage team →" link, right-aligned (visible to Administrators and the matter creator only, per DD-014's gating rule)
- Padding: `0 var(--spacing-page-x)` to match sub-bar gutters

**Tier 3 — Composer @-mention warning.** ~~When the comment composer or the document-upload share-list inside a confidential matter receives an @-mention (or named-share) targeting a user who is not currently on the matter team, a non-blocking inline warning renders below the composer: _"@Sara Kim isn't on this confidential matter. They will be added as a watcher if you confirm."_ The submit action confirms the membership grant _and_ posts. No hard-block. The grant is recorded in the audit log per DD-014.~~

**Superseded for records by CMT-007, recorded for Contracts in CTR-022/DES-029 and confirmed for Matters at the M22 close.** There is nobody to offer. The mention typeahead offers only people the record already reaches, so on a confidential record it never names somebody outside the audience — the warning has no case to fire, and the membership grant it confirmed is one CMT-007 rejected. Tier 3 survives as the composer's confidential notice, which states the flag and names the bounded audience instead of offering to widen it.

**Lock icon only.** Confidentiality everywhere uses the same `Lock` glyph from Lucide. No alternates (`ShieldAlert`, `EyeOff`) — single glyph reduces cognitive overhead and reads as "restricted access" universally.

**New color token added to the DES-005 token system:**

| Token               | Light                     | Warm                 | Dark                         |
| ------------------- | ------------------------- | -------------------- | ---------------------------- |
| `--confidential-bg` | `#F5E6FA` (soft lavender) | `#EFE3D0` (soft tan) | `#241B30` (soft dark purple) |

Warm intentionally diverges from purple per DES-005's per-theme-semantics rationale — Warm's confidentiality fg is terracotta-brown (`#9B6B3A`), so the matching banner background is a soft tan rather than a soft purple. The banner reads as "warm-gated" rather than "purple-gated" in Warm; the affordance is the same.

### Rationale

1. **Single affordance is insufficient** for the cascading visibility DD-014 commits to. An inline-only marker is missable on the detail page where the highest-leverage actions happen; a banner-only treatment is invisible in the list views where one of 30 matters needs to be flagged. Both are needed, plus action-time prevention.
2. **The persistent banner is the surface that prevents the "I forgot this was confidential" failure mode.** A General Counsel who has been heads-down editing for 30 minutes and reaches for the screenshot button needs a visible persistent reminder above the page chrome, not a marker that scrolled off two minutes ago.
3. **Composer warning is the leak-prevention surface.** The most common confidentiality breach is not viewing — it is action-time hand-off (mistakenly @-mentioning the wrong person, sharing a document with someone outside the team). Tier 3 catches that moment without hard-blocking, preserving user agency consistent with DD-014's "open-by-default with a thin gate" posture.
4. **Lock icon is universal.** Every other glyph requires explanation; Lock is read as "restricted" by every user without prompting. Existing mocks already use the lock emoji.
5. **`--confidential-bg` deserves its own token rather than borrowing `--status-assigned-bg`.** The banner is full-width and persistent — visually loud surface area. Conflating its background with a status-pill family invites the question "is this a giant Assigned pill?" and creates accidental coupling: if the assigned pill family ever shifts, confidentiality shifts with it. One token per role.
6. **No dismiss on the banner.** A dismissible banner is a notification; this is chrome. Allowing dismissal lets a user dismiss confidentiality from view, which is the opposite of the goal.
7. **"Manage team" link gated to Admins + creator** matches DD-014's "setting / unsetting the flag is restricted to Administrators and the matter creator" rule. Members on the team see the banner without the management affordance.

### Alternatives considered

- **Tier 1 only (inline marker, no banner).** Rejected; missable on the detail page where confidentiality matters most.
- **Tier 2 only (banner, no inline marker).** Rejected; gating is invisible in list/search/breadcrumb contexts where users scan many matters at once.
- **Hard-block @-mentions of non-team users.** Rejected; over-correction. The user's intent might be exactly to add a watcher — DD-014 supports this. Non-blocking warning with explicit confirmation matches the policy.
- **Colored left-stripe on the page (Stripe-style sidebar mark) instead of a banner.** Rejected; less discoverable for non-engineer users than a horizontal banner with explanatory copy. The stripe pattern works well in dev tools but reads as decorative rather than restrictive in a legal-tool context.
- **Use `ShieldAlert` icon instead of `Lock`.** Rejected; `Lock` is universally read as "restricted access," `ShieldAlert` reads as "warning" (possibly a bug, possibly a security alert). Wrong register.
- **Borrow `--status-assigned-bg` for the banner instead of adding `--confidential-bg`.** Rejected; full-width banner sharing color with a status-pill family creates visual coupling and reads as an oversized pill rather than chrome.
- **Dismissible banner.** Rejected; a notification, not chrome. Dismissal is the failure mode.

### Consequences

- A `--confidential-bg` token is added to the DES-005 color-token system. Values land in `styles/themes/{light,warm,dark}.css`; the token is registered in `styles/globals.css` `@theme` as `--color-confidential-bg`.
- A `--height-confidential-banner: 36px` chrome dimension is added to `styles/globals.css`. Banner is rendered in the layout shell of any page within a confidential matter; absent on non-confidential pages.
- A new component family is required at build-out: `<ConfidentialMarker>` (Tier 1, with size variants for inline / micro / chip uses) and `<ConfidentialBanner>` (Tier 2, layout-shell component). The composer warning (Tier 3) is a per-composer concern, not a shared component — implemented inside the comment composer and the share-target picker.
- Pencil mocks for the matter detail screen (when produced) must include the persistent banner; the existing dashboard mock's inline marker continues unchanged.
- Rendering the banner requires a server-side hint that the current matter is confidential, available before the layout shell paints. With the SSR strategy from DES-002 (theme attribute server-rendered on `<html>`), adding a `data-confidential` attribute on the layout `<main>` (or a render-prop on the layout shell) is the natural pattern. Implementation detail; not a separate DES.
- The composer @-mention warning depends on the composer being able to query the matter's current team membership; this is a backend contract, not a design contract, and is recorded as a build-time dependency rather than a DES.
- Activity-entries, documents, and comments inside a confidential matter render the inline `Lock` micro-marker next to their timestamp; this is part of the Tier 1 specification and gets a small render guard at the activity-feed and comment-thread level.
- The existing mock's `🔒 CONFI` text-label is the Tier 1 reference; Pencil files should be updated to use a Lucide `Lock` glyph in a follow-up pass per DES-008.

---

## DES-010: Keyboard contract — `/`, `Esc`, `?` global keys; Radix component defaults; Cmd-K palette deferred

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

The mocks already commit to keyboard ergonomics: every search input renders a `/` keyboard chip in its placeholder, and the page-shell sub-bars expose filter chips that are obvious tab targets. DES-004 chose Radix primitives, which carry an opinionated keyboard contract (focus trapping in modals, arrow-key navigation in menus and tab strips, focus restoration on close, etc.). The decision to make is what we commit to _globally_ — the keystrokes that are app-wide, not per-component — and whether a `Cmd-K` command palette is in scope for v1.

### Decision

A small, fixed global key map ships in v1; `Cmd-K` command palette is **deferred** (not rejected); component-level keyboard support inherits Radix defaults, written down as a contract so we don't accidentally ship custom components that break it; a `?`-triggered shortcut cheat-sheet is the discovery surface.

#### Global keys (v1)

| Key   | Action                                                            | Scope                                          |
| ----- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `/`   | Focus the page-level search input                                 | Any page whose sub-bar contains a search input |
| `Esc` | Close the topmost overlay (modal, popover, dropdown, command bar) | Global                                         |
| `?`   | Open the keyboard shortcuts cheat-sheet modal                     | Global                                         |

Two-key navigation sequences (e.g. Gmail-style `g + d`) were considered and **rejected for v1** — they add cognitive load without a corresponding payoff at this stage; the top-nav is one click away on every screen.

#### Component keyboard contract (Radix defaults, written down)

- Tab order follows DOM order; no `tabindex > 0` anywhere.
- All interactive elements reachable without a mouse.
- Focus rings visible on all focusable elements (Primer-style 2px outline using `--accent`); always-on, not gated to `:focus-visible`.
- Modals and dropdowns trap focus while open and restore focus to the trigger on close.
- Arrow keys navigate within composite widgets (menus, listboxes, tab strips); custom composites follow the same pattern.
- Enter activates buttons and links; Space activates buttons and toggles checkboxes.
- Tables: rows are not focusable by default; row-level actions (open, more-menu) are reachable as standalone interactive elements within the row.

#### `?` cheat-sheet

A modal listing every global key plus the component-level patterns above, grouped by section. Rendered from a single `KEY_MAP` constant that is the source of truth for both the cheat-sheet and the actual keybinding handlers, so the displayed shortcuts can never drift from what the app does.

#### Cmd-K command palette: deferred

Cmd-K is revisited when either: (a) the catalog of distinct commands worth listing crosses ~20, or (b) the entity index spans more than two domains worth searching across. Until then, `/` covers the high-frequency entity-search case and the top-nav covers section-level navigation.

### Rationale

1. **`/` is already in the mocks.** The keyboard chip in every search input is an implicit promise; honoring it costs almost nothing.
2. **`Esc` is universal expectation.** Any overlay that doesn't dismiss on `Esc` will be perceived as broken.
3. **`?` is the dominant shortcut-discovery convention** (GitHub, Gmail, Linear, Slack). Choosing it costs nothing and lets the cheat-sheet substitute for per-screen documentation.
4. **A half-empty Cmd-K is worse than no Cmd-K.** A useful palette needs both a real command catalog and an entity index to search; v1 has neither. Building it now produces a thin, frustrating experience that discourages re-use.
5. **Always-on focus rings beat `:focus-visible`-gated rings** in a tool whose audit-trail-visible doctrine prizes "you can always see what's happening." The minor mouse-UX cost is acceptable; the keyboard-debugging benefit is real.
6. **Writing down the Radix contract** prevents the future bug where someone ships a custom listbox without arrow-key navigation and "it looks like a Radix menu so it should work like one" turns out to be wrong.

### Alternatives considered

- **Ship `g + <letter>` two-key navigation sequences (Gmail/GitHub-style).** Rejected for v1 — the persona may be technically curious, but two-key sequences add cognitive load and require teaching; the top-nav is already one click. Revisit if user research shows the navigation is high-frequency enough to warrant it.
- **Ship Cmd-K from v1 with a thin command catalog.** Rejected — see rationale #4. Revisit when the catalog and entity index justify it.
- **Use `:focus-visible` so focus rings only appear on keyboard navigation.** Rejected for now; always-on rings match the tool's auditability doctrine and make keyboard debugging simpler. Reversible if the visual cost becomes a complaint.
- **Customizable keybindings in settings.** Rejected as v1 over-scope; revisit only if multiple users request it. The cheat-sheet plus a small fixed map is the right surface area for now.
- **`?` opens documentation instead of cheat-sheet.** Rejected — there's no docs site yet, and `?` for the shortcut sheet is the universal convention.

### Consequences

- A `KEY_MAP` constant is the single source of truth for the global keys; the cheat-sheet modal renders from it, and the keybinding handlers register from it. Drift-proof by construction.
- A `<KeyboardShortcuts>` cheat-sheet modal component is required at build-out, triggered by `?` (suppressed when focus is inside an input/textarea/contenteditable so users can type literal `?`).
- A small global keyboard handler (likely a `useGlobalKeys` hook mounted once at the app root) is required to wire `/`, `Esc`, and `?`. Per-page search inputs register a focus handler against `/` via the same dispatch.
- The Radix default contract is written down in this DES; no separate doc needed. When custom composites are built (e.g. a custom row-grouped table), they must conform — call this out in component PRs.
- Pencil mocks already render the `/` chip; no mock changes needed.
- A `--ring-width: 2px` and `--ring-color: var(--accent)` token pair will be added to `styles/globals.css` `@theme` when focus styles are first wired (deferred to component build-out, not blocking).
- Cmd-K is on the queue for revisit; the routing and entity-search layers should be designed to make adding it cheap (one search index, one command registry — natural shape regardless).
- A11y screen-reader patterns are _not_ covered by this DES; they belong with the WCAG-AA accessibility-floor decision in the open-questions queue.

### Implementation addendum (2026-08-28, M25/5, [#537](https://github.com/juggernog20/OpenLaw/issues/537))

The `/` consequence is complete for global search. The key focuses the header combobox, typing 2 characters opens its ranked results, and a page-level search input still wins while it is mounted. The results list owns Arrow keys, Enter, and `Esc` locally. `Esc` closes only the list, stops propagation, and leaves the query in the input. `KEY_MAP` remains the source of the `Focus search` cheat-sheet entry and the header's `/` chip.

---

## DES-011: Accessibility floor — WCAG 2.2 Level AA contract; AAA aspirational on text; no formal audit in v1

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

The themes, geometry, typography, and keyboard contract are all locked. Before component build-out begins, the accessibility contract those components must satisfy needs to be a stated commitment, not an implicit one — otherwise it gets retrofitted later at much higher cost. WCAG 2.2 (the current ratified version, October 2023) is the natural reference; the choice is the conformance level (A / AA / AAA), how aggressively we verify it, and whether v1 commits to a third-party audit.

### Decision

**WCAG 2.2 Level AA** is the conformance contract for v1. AAA is aspirational on text-contrast pairs where the palette can hit it, but never a release blocker. No formal third-party audit, VPAT, or Section 508 conformance statement in v1 — we design to AA, self-test, and revisit certification when there's a concrete sales reason for it.

#### What v1 commits to (the AA contract)

1. **Color contrast** meets WCAG 2.2 AA for every text-on-background pair we actually use, in all three themes — 4.5:1 for body text (`<18px`, or `<14px bold`), 3:1 for large text and UI components / graphical objects. The token system is the enforcement point: every `--text-*` × `--bg-*` and `--status-*-fg` × `--status-*-bg` pair in DES-005 must satisfy this.
2. **All interactive elements are keyboard-operable** (locked by DES-010).
3. **Visible focus indicators** on every focusable element (locked by DES-010 — always-on 2px outline using `--accent`).
4. **Touch targets ≥ 24×24 CSS px** per SC 2.5.8 — already satisfied by DES-007's geometry (48px nav, 32px chips); needs a per-component check at build-out for any new control.
5. **Form fields have programmatically-associated labels** (`<label for>`, `aria-label`, or `aria-labelledby`); Radix primitives provide this by default.
6. **No information conveyed by color alone.** Status pills pair color with text; the activity feed pairs status color with author/timestamp text; the confidentiality affordance pairs color with a `Lock` icon and "CONFI"/"Confidential" text. Stated as a rule for all future components.
7. **Document language declared** (`<html lang="en">`); page titles uniquely identify each screen.
8. **Skip-to-content link** as the first focusable element on every page — visually hidden until focused, jumps past the 174px of top chrome (62 header + 48 nav + 64 sub-bar) to `<main>`.
9. **`prefers-reduced-motion: reduce` honored** by every animation; degrades to instant transitions.
10. **Screen-reader patterns** for the activity feed (`role="feed"` + `aria-busy` during loads + each entry as `<article>` with `aria-labelledby` to its header) and modals (Radix-default `role="dialog"` + focus trap + `aria-labelledby`).

#### What v1 explicitly does _not_ commit to

- No formal third-party audit / VPAT / Section 508 conformance statement.
- No screen-reader certification matrix as a release gate (NVDA + JAWS + VoiceOver).
- No dedicated high-contrast theme beyond the three already shipping.
- No AAA contrast as a universal target (Light and Warm hit AAA on most text pairs, but AAA constrains future palette work for negligible real-world benefit at this stage).

#### Verification stack

- **Contrast lint at build time.** A small script reads `styles/themes/*.css`, computes contrast ratios for every meaningful token pair, and fails CI if any drops below the AA threshold for its category. Catches palette regressions automatically.
- **`axe-core` in CI** against representative pages (login, dashboard, matter detail, settings). Triage signal — not initially a release gate, but new violations are surfaced immediately and tracked.
- **Manual keyboard pass** before each release: tab through every screen, confirm reachability and operability.
- **VoiceOver/NVDA smoke test** on activity feed and modal-heavy flows before each release.

### Rationale

1. **AA is the industry-standard procurement floor** and the level most US/EU regulations target. It's enforceable, testable, and well-understood.
2. **AAA across the board is the wrong constraint for a small OSS team** — it would force palette compromises (some brand colors don't survive AAA) for a benefit that doesn't materially help the named persona.
3. **Token-system enforcement is the cheap path to durable contrast compliance.** Lint the token files; every component that uses tokens correctly inherits compliance. Components that violate contrast via hard-coded colors (which they shouldn't, per DES-005) are caught by `axe`.
4. **Deferring formal audit avoids a six-figure bill** for certification of a v1 product that's still moving fast. Revisit when (a) a customer requires a VPAT, or (b) the surface area stops moving every week.
5. **Most of the AA contract is already implicit** in DES-005 / DES-007 / DES-008 / DES-010 — this DES exists to make it an explicit, verifiable contract rather than a vague intent.

### Alternatives considered

- **WCAG 2.2 AAA across the board.** Rejected — palette cost too high for the persona's benefit.
- **WCAG 2.1 AA only.** Rejected — 2.2 adds SC 2.5.8 (Target Size, Minimum) and SC 2.4.11 (Focus Not Obscured) that are easy to satisfy and meaningfully improve mobile/keyboard ergonomics.
- **Formal third-party audit + VPAT in v1.** Rejected — premature; revisit when the product stops shape-shifting weekly or when procurement requires it.
- **Skip the contrast lint script (manual contrast checks only).** Rejected — token files will change; humans forget; lint is the durable path.
- **Drop the skip-to-content link.** Rejected — 174px of top chrome makes it an obvious AA expectation, and it costs almost nothing to add.

### Consequences

- **Contrast pass on the DES-005 token table is required before v1 build-out.** Specifically check: `--text-subtle: #A8A294` on `--bg-canvas: #FBFAF7` in Warm (likely AA-borderline for body); `--status-warning-fg: #9A6700` on `--status-warning-bg: #FFF8C5` in Light (small-text on tinted bg is the most common AA-fail spot); `--status-onhold-fg` × `--status-onhold-bg` in all themes; the file-type icon colors against canvas. Failures are fixed by adjusting the failing token, not the contract.
- **DES-006 11px `--text-xs` is metadata-only, not body text.** This belongs as an explicit clarification on DES-006 — 11px is allowed for non-essential supporting text (timestamps, badge counts) but never for primary content.
- **A contrast-lint script is required tooling** at the styles/ layer. Lives next to the theme files; runs in CI. Output naming: `npm run lint:contrast` or equivalent.
- **`axe-core` is added as a dev/CI dependency** (compatible with AGPL — `axe-core` is MPL-2.0; per DD-011 this is fine for build/test tooling).
- **A `<SkipToContent>` component is required at build-out**, mounted as the first child of the layout shell on every page.
- **A reduced-motion override file** (likely `styles/reduced-motion.css` or a single `@media (prefers-reduced-motion: reduce)` block in `globals.css`) sets the contract; per-component animations inherit from it. Specifics deferred to component build-out.
- **A `<html lang="en">` requirement** lands in the root layout; trivial.
- **Activity feed and modal screen-reader patterns** become a checklist for those component PRs — this DES is the source for the checklist.
- **Smoke-testing matrix** (VoiceOver on macOS Safari, NVDA on Windows Firefox) becomes a pre-release manual check, not yet a release blocker.

**Implementation clarification (2026-08-10, #42):** the contrast lint gate is `styles/lint-contrast.mjs`, run as `pnpm lint:contrast` and inside the aggregate `pnpm check` (so it gates CI). It checks every text/surface and status bg/fg pair from DES-005, the DES-018 severe/neutral families, the DES-019 chrome text pairs, the badge, confidentiality, and avatar pairs, and the file-type colors against canvas — 123 pairs across the three themes. Category calls made when the pair table was built:

- `--text-subtle` is held to the 3:1 floor, not 4.5:1. Its only roles are placeholder and disabled text (DES-005); WCAG 1.4.3 exempts disabled text, and placeholders are held to the non-text floor instead of exempted. It is never body copy. Holding it to 4.5:1 would collapse it into `--text-muted` and erase the text tier in Warm.
- Avatar initials and the file-type icon squares are graphical objects at 3:1. The user's name accompanies the avatar in accessible contexts; DES-019's Warm terracotta avatar reads 3.1:1.
- `--text-on-accent` × `--accent` is **not** checked yet. Nothing renders on the accent fill today and the pair reads 2.5:1 in Light/Dark. It must be fixed and added to the gate when mention chips land.

Running the gate resolved the suspect list: onhold passes in all themes (6.9–7.9:1), Light warning passes at 4.52:1, and the file-type colors pass at the graphical floor. But Warm `--text-subtle` was 2.44:1 (not borderline), and the gate surfaced failures the suspect list missed. Per the rule above, the tokens were adjusted, not the check — each darkened or lightened one step on its own hue:

- Light: `--status-success-fg` #1F883D → #1A7F37 (4.06 → 4.56); `--badge-count-fg` #656D76 → #636A73 (4.4996 → 4.69).
- Warm: `--text-muted` and `--chrome-nav-muted` #7A7264 → #6F6759; `--text-subtle` #A8A294 → #928B78; `--text-link` and `--confidential-fg` #9B6B3A → #855A2E; `--status-success-fg` #5C7A4A → #527040; `--status-warning-fg` #8A6B1F → #7E6119; `--status-info-fg` #3A6E94 → #35658A; `--status-danger-fg` #A05540 → #944C38.
- Dark: `--text-muted` and `--badge-count-fg` #7D8590 → #8B949E; `--text-link` #2F81F7 → #4493F8.

The adjusted values should be back-ported to `designs/final-themes.pen` and the .pen library's theme frames when those mocks next get touched.

**Implementation clarification (2026-08-10, #48):** the remaining floor commitments landed as follows.

- **`axe-core` scan (verification stack):** `e2e/tests/08-accessibility.spec.ts` runs `@axe-core/playwright` against the login and home pages in the browser suite. It is advisory, as decided: violations are printed to the runner output, emitted as GitHub warning annotations in CI, and attached to the Playwright report, but they do not fail the run — the e2e job gates merges, so a failing assertion would have turned the triage signal into a build gate. The scan was clean on both pages when #48 closed; anything it reports is new. Matter detail and settings join the scan when those screens exist. Starting clean took one fix: the page sub-bar sat outside every landmark, so it became a `<section>` labeled by its own h1 — it cannot move inside `<main>`, because the skip link (commitment 8) deliberately jumps past it.
- **Reduced motion (commitment 9):** one unlayered `@media (prefers-reduced-motion: reduce)` block at the end of `styles/globals.css` forces every animation and transition to a near-zero duration (0.01ms, not 0ms, so `transitionend`/`animationend` still fire). Unlayered so it outranks any layered or utility declaration.
- **Page titles (commitment 7):** every screen mounts `apps/web/src/components/page-title.tsx`, which renders a React-19-hoisted `<title>` as `{screen} · OpenLaw` (the "·" separator matches the GitHub-shaped brand, DES-003). The screen name is the screen's own localized title; the template itself is the ICU message `app.pageTitle`. The two-factor enrollment screen titles itself "Two-factor enrollment" to stay distinct from the challenge screen's "Two-factor authentication".
- **Document language (commitment 7):** `<html lang="en">` was already declared in `apps/web/index.html`; the e2e spec now asserts it. When DES-013's stored locale ships server-rendering of the attribute, the assertion is the regression net.

---

## DES-012: Responsive layout primitives — container queries for content, single 768px viewport breakpoint for the mobile shell

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

The mocks in `designs/final-themes.pen` are all desktop-width (~1440px). DES-007 locked the chrome geometry (62 header / 48 nav / 64 sub-bar / 320 right rail) at desktop, but said nothing about narrower viewports. OpenLaw is a desktop-class B2B tool — no one reviews a 30-page MSA on a phone — but the application still needs to behave reasonably at the laptop-window-split (around 1024px), tablet portrait, and "user resized aggressively" sizes. The decision to make is _what primitive_ the responsive behavior is built on. As of 2026, container queries (CSS Container Queries Level 1, ~95% global support since 2023) and intrinsic-layout primitives (`grid-template-columns: repeat(auto-fit, minmax(N, 1fr))`) are first-class in Tailwind v4 and have largely displaced viewport-only breakpoint thinking for application UIs.

### Decision

The responsive system is built primarily on **container queries and intrinsic layout primitives**, with **a single viewport breakpoint at `768px` (Tailwind `md`)** governing the mobile shell. The split is: **chrome is viewport-responsive; content is container-responsive.**

#### Rules

| Region                                                                                                | Mechanism                                                   | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top nav, sub-bar, header                                                                              | Viewport                                                    | Below 768px: top nav collapses to hamburger; sub-bar simplifies to title + primary action; filter chips collapse into a "Filters" sheet. At 768px and above: full chrome as in mocks.                                                                                                                                                                                                                                                                                                                                                                                               |
| Side panel (`--width-panel: 320px` per **DES-016**; the 48px `--width-activitybar` is always visible) | Flex sibling of the record content                          | **Applet panel: always docked** (DES-016 2026-08-17 clarification) — opening it takes a 320px column and the record content shrinks; overlay-below-1100px is superseded. **Doc panel: docked above 1400px of record-content width, overlaying below it** (DES-016 2026-08-18 second pass) — at `--width-docpanel` (720px) it has nowhere to dock on a narrow window without squeezing the section behind it. It covers the record content only; the applet panel and the activity bar sit outside that box, so the two panels are never hidden by it and an open applet narrows it. |
| Tables                                                                                                | **Container query** on the table's wrapper                  | Card-stack rendering when wrapper `< ~640px`; row rendering above. Decoupled from viewport entirely so tables don't break inside narrow modal bodies.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Two-pane detail layouts                                                                               | **Container query** on the layout shell                     | Single-pane below ~1024px-of-shell; two-pane above. Secondary pane reachable via a back-button-driven sub-route in single-pane mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Card grids, chip rows                                                                                 | `grid-template-columns: repeat(auto-fit, minmax(Npx, 1fr))` | Auto-reflow; no breakpoint code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Modals                                                                                                | Viewport                                                    | Full-screen below 768px; centered overlay above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

#### What this commits to

- A single named viewport breakpoint at **`768px` (Tailwind `md`)** is the only viewport-driven cliff. Everything else uses container queries or intrinsic sizing.
- Mobile shell is preserved as a **graceful floor**, not a design target — the iPad-portrait-during-a-meeting and the laptop-split-with-a-PDF cases work, but the product is not designed for phones.
- No native mobile app.
- No dedicated tablet design tier — tablets in landscape get desktop chrome; tablets in portrait fall into the mobile shell.
- No print stylesheet (separate concern, deferred).

### Rationale

1. **Container queries are the modern primitive** for application UIs. All evergreen browsers since 2023; ~95% global support. Tailwind v4 ships first-class `@container`/`@md:`/`@lg:` modifiers. Adopting them now is the conservative path; doing it later means refactoring component-level responsive rules.
2. **Right-rail collapse should depend on content-area width, not window width.** A user with a 1440px viewport who opens a side panel that narrows the main area to 900px should have the rail collapse; viewport queries can't see this. Container queries handle it natively.
3. **Tables shouldn't break inside narrow modal bodies.** The card-stack switch is a function of the table's wrapper width, not the viewport — a recurring bug pattern with viewport-only responsive design.
4. **Fewer viewport breakpoints = less to reason about.** B2B SaaS tools (Linear, Vercel, Retool, Cursor, Modal) have largely converged on one or two viewport breakpoints + intrinsic layouts; the proliferation of `sm`/`md`/`lg`/`xl`/`2xl` cascades is a 2018-era pattern that aged poorly.
5. **The chrome / content split is the right semantic line.** Chrome (header, nav, sub-bar) is a property of the application window; content (tables, panels, grids) is a property of the space available to it. Different mechanisms, different boundaries.
6. **Linear-shaped, not Notion-shaped.** OpenLaw's procurement-tool register doesn't justify mobile-first investment; the graceful-floor approach matches the actual primary surface.

### Alternatives considered

- **Three-tier viewport breakpoints (`<768`/`768–1279`/`≥1280`).** Rejected — the original recommendation in this grill session, but stale by 2026 standards. The middle "compact" tier specifically is what container queries replace more elegantly.
- **Refuse to render below 768px (show "use a wider window" message).** Rejected — kills the iPad-portrait and split-window cases, reads as user-hostile.
- **Native mobile app or mobile-first design.** Rejected — wrong product positioning.
- **Viewport-only responsive (no container queries).** Rejected — see rationale #2 and #3; container queries solve specific problems viewport queries cannot.
- **Add a `2xl` (`≥1536px`) tier for ultra-wide layouts.** Rejected as premature; revisit only if a real ultra-wide use case appears.
- **Fluid type with `clamp()` across the size ramp.** Rejected for v1 — DES-006's stepped size ramp is the right register for a utility tool; fluid type can read as mushy at body sizes. Reversible later if the product moves toward a more marketing-page surface.

### Consequences

- A `<Container>` or equivalent layout primitive is required at build-out: a wrapper that establishes a `container-type: inline-size` context for its children, so descendants can use `@container` queries against it. Likely added as a base-layer pattern, not a Tailwind utility.
- The page-content area, the table wrapper, and the layout shell are the three named container contexts. Each is wired up at the layout-shell level.
- The table's card-stack threshold (~640px wrapper width) is a tuning value; it lands as a named constant in the styles layer (e.g. `--container-table-stack-threshold`) and is revisited once real content lands. The applet panel's former ~1100px overlay threshold is retired (DES-016 2026-08-17 clarification). The doc panel's 1400px dock/overlay threshold is a fourth named container context — the record-content region, which `RecordApplets` establishes with the applet panel and the activity bar outside it (DES-016 2026-08-18 second pass).
- Tailwind v4's `@container` modifier is used directly in component classes. Naming convention: container-scoped breakpoints use the `@`-prefixed Tailwind syntax to make the distinction from viewport breakpoints obvious in the source.
- A single viewport breakpoint at `md` (768px) governs the mobile shell. No `sm`/`lg`/`xl` viewport modifiers should appear in the codebase for content responsiveness — flag in PR review if they do.
- The mobile shell requires: a hamburger drawer for the top-nav items, a "Filters" sheet for sub-bar filter collapse, a stacked-card rendering for tables, and full-screen modal variants. These are concrete component-build-out items.
- Pencil mocks for narrower viewports are not produced in v1; container queries make most of the responsive behavior auto-derivable from the desktop mocks. Mobile-shell screens (hamburger drawer, Filters sheet, stacked-card table) are the small set of mocks worth producing if the mobile floor becomes a complaint vector.
- The "right rail content reachable via a 'More' affordance when collapsed" pattern needs a per-page convention; deferred to component build-out.

---

## DES-013: Internationalization architecture — every string wrapped in ICU MessageFormat from day one, `Intl.*` for formatting, en-US the only v1 locale

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

OpenLaw v1 ships in en-US only. The design-level question isn't whether we translate the app — it's whether we wire the i18n primitives in from the start so a future translation effort is a content task, not a refactor. Retrofitting i18n onto an app that hard-coded English strings, used JS `Date`/`toLocaleString` ad hoc, and used physical CSS properties (`ml-*`, `mr-*`) is the most expensive path; doing it from the start is nearly free per string but compounds into a real cost if deferred. This decision is architectural; it does not commit to a translation vendor, additional locales, or RTL support.

### Decision

Wire ICU MessageFormat-based string wrapping, `Intl.*` browser-native formatting, server-rendered locale, and Tailwind logical properties **from day one**, even though only en-US ships in v1.

#### Concrete contract

1. **Every user-facing string lives in a message catalog** with a stable string ID (`action.save`, `matter.empty.title`, `confidential.banner.body`) — never hard-coded in JSX. Renaming the English copy never breaks the catalog.
2. **ICU MessageFormat** is the message syntax. Handles plurals, gender, select, and interpolation (`"{count, plural, =0 {No matters} one {1 matter} other {# matters}}"`) without per-locale code branches.
3. **`Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat` for all date / number / currency formatting.** No `date-fns` / `dayjs` / `moment` / `numeral.js` for formatting. (Date _math_ is a separate concern — a math lib is fine if needed.)
4. **Locale stored on the user record**, defaulting to `en-US`. Server-rendered into `<html lang>` (which DES-011 already requires) so initial paint formatting is correct without a client-side flicker. _(2026-08-28, high-level review: TECH-003 chose a SPA with no SSR, so nothing server-renders `<html lang>`. `index.html` carries `lang="en"` as the pre-hydration default and the SPA sets `document.documentElement.lang` from the signed-in user's locale on boot. The flicker this item guarded against cannot occur while en-US is the only locale.)_
5. **Build-time extraction** walks the codebase, harvests message IDs + default English text, emits `messages/en-US.json`. Future locales are sibling files (`messages/de-DE.json` etc.); the JSON is the artifact translators receive.
6. **No locale switcher in v1 UI** — the mechanism is wired, but only one locale exists to choose. When a second locale ships, the switcher slots into account settings.
7. **Tailwind logical properties from day one** (`ms-*`, `me-*`, `ps-*`, `pe-*` instead of `ml-*`, `mr-*`, `pl-*`, `pr-*`). RTL is kept open without being promised; physical-property utilities are flagged in PR review.

#### Library choice

**Recommendation: `react-intl` (FormatJS).** Rationale: mature, ICU MessageFormat native, integrates `Intl.*` cleanly, well-documented translator workflow, BSD-3 (AGPL-compatible per DD-011). `@lingui` is a defensible substitute if bundle weight matters more than ecosystem maturity. Rolling our own is rejected — pluralization and message format are subtle and easy to get wrong.

The architectural decision (every string wrapped, ICU MessageFormat, `Intl.*` for formatting, build-time extraction, locale on user) is the same regardless of library; the lib choice is implementation detail and reversible.

### Rationale

1. **Wrapping cost is ~10 keystrokes per string today, ~10 minutes per string later.** Retrofitting requires touching every component and reviewers can't tell if a string was "translatable" or "intentionally left in English." Same principle as DES-001's "wire CSS variables from the first component."
2. **`Intl.*` APIs are zero-dep, locale-aware, and built into every modern browser.** Choosing a third-party formatter creates a coupling with no payoff.
3. **ICU MessageFormat is the industry standard** for application i18n; translators understand it; tooling supports it; it handles the language-specific rules (Russian's three plural forms, Polish's plural categories) we'd otherwise have to special-case.
4. **Server-rendered `<html lang>` and locale** prevents the formatting-flicker bug where the page paints in one locale's number format and then re-renders in another.
5. **Logical properties cost nothing today.** Tailwind v4 ships them; they work identically to physical properties in LTR; they correctly mirror in RTL. Future RTL becomes a QA pass instead of a refactor.
6. **Not promising RTL or additional locales avoids over-commitment.** The wiring leaves room without making promises we can't keep in v1.

### Alternatives considered

- **Skip the wrapper layer; hard-code English in JSX for v1; wrap later.** Rejected — see rationale #1; retrofitting i18n is the most expensive path.
- **`@lingui` instead of `react-intl`.** Defensible — smaller runtime, modern macro DX. Recorded as a substitute; the architectural decision doesn't depend on it.
- **Roll our own `t(id, defaults, vars)` function.** Rejected — reinvents pluralization and ICU; not worth the dep removal.
- **Use `date-fns` / `dayjs` for formatting.** Rejected — `Intl.*` covers it, locale-aware, zero-dep. Date math libs are a separate decision and may still be useful.
- **Commit to a translation vendor (Crowdin / Lokalise / Phrase) in v1.** Rejected as v1 scope creep; the JSON catalog is universal.
- **Commit to RTL support in v1.** Rejected — adds real complexity (mirrored layouts, bidirectional text); we don't preclude it (logical properties leave the door open) but we don't promise it works.
- **Per-user locale override of system locale for date/number formatting only.** Deferred — v1 derives all formatting from the user's account locale; reversible later.

### Consequences

- A `messages/` directory at the repo root holds locale JSON catalogs; `messages/en-US.json` is the v1 artifact.
- Build-time extraction tooling required (the chosen library — react-intl or lingui — provides this).
- A translation-primitive component (likely `<FormattedMessage>` from react-intl, or equivalent) and a hook/function for non-JSX contexts (`intl.formatMessage(...)`) are required at the component layer. Every `<Button>`, every label, every error message, every empty state uses it.
- A `formatDate(date, options?)`, `formatNumber(value, options?)`, `formatCurrency(value, currency, options?)` thin wrapper around `Intl.*` is added at the styles/utils layer so component code doesn't reach into `Intl` directly. Centralizes the `locale` argument and lets DES-014 (date/time/currency display) be about _conventions_ rather than _plumbing_.
- The user record needs a `locale` field with default `en-US`. Backend concern; flagged here.
- Server-side rendering must read the user's locale and render `<html lang>` accordingly; integrates with the same SSR layer that emits `data-theme` from DES-002.
- **Tailwind logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`) are required**; physical properties (`ml-*`, `mr-*`, `pl-*`, `pr-*`) are flagged in PR review. Add to lint config when component build-out begins.
- A "Translation contributor guide" document becomes a v1.x artifact for OSS contributors who want to add a locale; not blocking v1.
- The `axe-core` / accessibility setup from DES-011 should also lint for missing `<html lang>`.
- No locale switcher in account settings until a second locale exists; the user record schema accepts the field today regardless.

---

## DES-014: Date / time / currency display conventions — relative-then-short-absolute, UTC-stored / browser-detected display, ISO 4217 currency, no compact-number abbreviations

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

DES-013 plumbed the `Intl.*` formatting APIs and locale-on-user. The remaining design-level decision is _what conventions_ those formatters output, where users see different forms (timestamps in activity feeds vs deadlines vs audit logs), and how timezone display is handled. Ad-hoc per-component formatting is the failure mode this DES prevents — every formatter call should resolve to one of a small set of named conventions.

### Decision

#### Date / time display rules

| Context                                                               | Format                                                                      | Example (en-US)                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Activity feed timestamps**                                          | Relative if `≤ 7 days ago`, short absolute thereafter                       | `12 minutes ago` / `3 hours ago` / `Yesterday` / `Apr 28` / `Apr 28, 2025` (year only when not current year) |
| **Document upload / created-at columns**                              | Short absolute                                                              | `May 3, 2026`                                                                                                |
| **Deadlines / due dates**                                             | Short absolute + relative qualifier when relevant                           | `May 10, 2026 (in 7 days)` / `May 1 (3 days overdue)`                                                        |
| **Detail-screen authoritative timestamps** (audit log, file metadata) | Long absolute with time + zone, **no seconds**                              | `May 3, 2026, 2:34 PM PDT`                                                                                   |
| **Tooltip on any displayed time**                                     | Same as detail-screen format (long absolute, hours+minutes, timezone label) | `May 3, 2026, 2:34 PM PDT`                                                                                   |
| **Date inputs**                                                       | Calendar popover (`DatePicker`); display via `formatFullDate`               | `May 3, 2026`                                                                                                |
| **Time inputs**                                                       | Browser-native `<input type="time">`                                        | (locale-aware by default)                                                                                    |

Tooltip and authoritative-timestamp formats are intentionally identical — one canonical "human-readable absolute time" and one canonical "compact display." No ISO 8601 in the UI; ISO is for storage and APIs only.

#### Timezone rules

- **Storage:** all timestamps as UTC ISO 8601. Non-negotiable.
- **Display:** rendered in the user's timezone. Resolution order: explicit user-record `timezone` field if set → browser's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) → UTC fallback.
- **Per-user override:** `timezone` field on user record, defaulting to `null` (= "use browser-detected"). Settings exposes a timezone picker; most users won't touch it.
- **SSR:** server renders in the user's _stored_ timezone if set, otherwise UTC. Client hydration re-renders in browser-detected timezone if no stored override. Acceptable one-time hydration adjustment.
- **Tooltips always include the rendered timezone abbreviation** (`PDT`, `EST`, `UTC`) so cross-region readers know what they're looking at.

#### Currency display rules

- **Storage:** integer-cents (or smallest-unit equivalent for non-decimal currencies) + ISO 4217 currency code. No floats.
- **Display:** `Intl.NumberFormat(locale, { style: 'currency', currency: <iso-4217> })`. Renders `$10,000.00` in `en-US` with `USD`, `10.000,00 €` in `de-DE` with `EUR`.
- **Currency code visibility:** when displaying values alongside other currencies (multi-currency contracts), append the ISO code: `$10,000.00 USD`. Single-currency screens omit the trailing code.
- **Sub-cent precision:** not displayed in v1; backend may store sub-cent for accruals; UI rounds to display precision.
- **No compact-number abbreviations** ("K" / "M" / "B"). Legal/contract values benefit from precision; `$1.2M` hides whether that's `1,200,000` or `1,234,567`. Reversible if a future analytics surface needs compact notation.

#### Number display rules (non-currency)

- **Counts:** `Intl.NumberFormat(locale).format(count)` → `1,234` in en-US, `1.234` in de-DE.
- **Percentages:** `Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)` → `42.5%`. Default 1 fraction digit; context-overridable.
- **File sizes:** `Intl.NumberFormat` `unit` style with `kilobyte`/`megabyte`/`gigabyte` where browser support is reliable; otherwise hand-rolled `KB / MB / GB` with `Intl.NumberFormat` for the numeric part.

#### Helper layer

The `formatDate(date, options?)` / `formatNumber(value, options?)` / `formatCurrency(value, currency, options?)` wrappers from DES-013 grow named variants matching the rules above:

- `formatRelativeOrShort(date)` → activity-feed rule
- `formatShortDate(date)` → upload-column rule
- `formatFullDate(date)` → date-input rule (always the year)
- `formatLongDateTime(date)` → audit-log + tooltip rule (same convention)
- `formatDeadline(date)` → due-date rule with relative qualifier
- `formatCount(n)`, `formatPercent(n)`, `formatFileSize(bytes)` → number variants

Component code stays declarative (`<span>{formatRelativeOrShort(comment.createdAt)}</span>`); changing a convention is a one-file change.

### Rationale

1. **Relative-then-short-absolute is the right register for legal-tool timestamps.** Recent activity benefits from `3 hours ago` (matches the user's mental model of "what just happened"); older items benefit from absolute dates because "3 months ago" loses precision people actually want.
2. **No ISO in the UI.** ISO 8601 with seconds and offsets is for machines, not humans. `2026-05-03T14:34:21-07:00` reads as engineering-ish in a tool meant for legal counsel and procurement; `May 3, 2026, 2:34 PM PDT` carries the same information, more readably, without the seconds nobody needs.
3. **Tooltip ≡ detail-screen format** because there's no scenario where an authoritative timestamp needs _more_ precision in one place than another. Two formats not three.
4. **Timezone in tooltips solves the cross-region collaboration friction.** US legal counsel + India contractor + UK in-house is a common shape; "is that 2pm my time or theirs?" is a real, recurring question.
5. **`Intl.NumberFormat` for currency is locale-correct out of the box** (symbol placement, decimal separator, grouping). Building a custom currency formatter is a recipe for regression bugs.
6. **No compact-number abbreviations** because legal precision matters; if analytics ever needs them, that's a per-context override, not a default.
7. **24h vs 12h is a locale concern, not a brand concern.** `Intl.DateTimeFormat` derives this from the user's locale; we don't override.

### Alternatives considered

- **Full ISO 8601 in tooltips** (`2026-05-03T14:34:21-07:00`). Rejected — too engineering-flavored for the intended audience; the seconds and T-separator add noise without information value.
- **Relative time everywhere with absolute-on-tooltip** (Twitter/Slack model). Rejected — legal-tool timestamps frequently span months and "3 months ago" loses precision people actually want.
- **Drop the timezone label from tooltips.** Rejected — see rationale #4.
- **Always-show currency code (`$10,000.00 USD`).** Defensible alternative; rejected as default because most orgs are single-currency and the trailing code reads as redundant. Multi-currency contexts get it automatically via the conditional rule.
- **Use 24-hour clock by default.** Rejected — `Intl.DateTimeFormat` derives this from locale (en-US → 12h; en-GB / most non-US → 24h). Don't override; trust locale.
- **Compact-number abbreviations by default** (`$1.2M`). Rejected — legal precision matters; reversible if a specific analytics surface needs them.
- **Multi-timezone displays** (same timestamp shown in two zones side-by-side). Rejected as v1 scope creep; rare need; reversible.

### Consequences

- The `formatDate` / `formatNumber` / `formatCurrency` helpers from DES-013 grow the named variants listed in the helper-layer section above. Single source of truth for every formatting decision.
- A `<TimeStamp value={iso} format="relative-or-short" />` component wraps the most common case: renders the configured format inline, attaches the long-format tooltip via Radix Tooltip (per DES-004). Avoids per-component tooltip plumbing.
- The user record needs a `timezone` field (nullable, IANA string like `America/Los_Angeles`). Backend concern; flagged here.
- A timezone picker lands in `Settings → Account` when the settings surface is built. Defaults to "Use browser timezone" with a search-narrowed IANA list.
- SSR layer reads the user's stored timezone (or UTC fallback) for server-rendered timestamps; client re-renders on hydration if browser-detected differs. The flicker is acceptable for users who haven't set an explicit override.
- Activity-feed list items use `formatRelativeOrShort`; the activity-feed component is responsible for re-computing relative time on a slow timer (e.g. once a minute) so "12 minutes ago" doesn't go stale on a long-open page.
- Currency-bearing components (e.g. matter value, contract amount) accept `{ amount, currency }` pairs, never bare numbers. Backend response shapes follow.
- The "Documents" tab's file size column uses `formatFileSize`. File-type icon colors come from DES-005 (`--color-file-*`).
- A small set of unit tests covers each helper against representative locales (en-US, en-GB, de-DE) to lock in the expected output strings.

**Implementation clarification (2026-08-10, #43):** the helper layer is `apps/web/src/lib/format.ts`; its tests lock the literal output strings for en-US, en-GB, and de-DE. Calls made where the decision text left room:

- **Inputs.** Date helpers accept the stored ISO 8601 string or a `Date`. Currency takes a `Money` pair — integer amount in the currency's smallest unit plus the ISO 4217 code — and derives the unit's precision from the code itself (`resolvedOptions().maximumFractionDigits`), so JPY (0 digits) and BHD (3 digits) divide correctly. `showCode: true` appends the trailing code for multi-currency surfaces.
- **Session seam.** `configureFormatting({ locale, timeZone })` is where the stored user preference lands when a session loads; per-call options override it, then browser detection, then UTC — the DES resolution order. Tests inject `locale`, `timeZone`, and `now` for determinism.
- **Sub-minute activity.** Renders as ICU's own "this minute" (`RelativeTimeFormat` with `numeric: "auto"`), not an invented "just now" string. Casing throughout follows ICU ("yesterday" lowercase — the decision table's "Yesterday" was illustrative).
- **Day math.** The relative-or-short window uses truncated 24-hour units (feed precision); `formatDeadline` uses calendar days in the display timezone, because deadlines are dates. Year elision likewise compares calendar years in the display timezone.
- **Deadline qualifier window.** The "(in 7 days)" / "(3 days overdue)" qualifier shows within ±30 calendar days and drops beyond, where the absolute date alone reads better. The "overdue" wording is helper-owned ICU copy (`format.deadline.overdue`); future and today qualifiers come from `RelativeTimeFormat` directly.
- **File sizes.** Intl `unit` style with SI decimal steps (1 kB = 1000 bytes) — the labels ICU renders are SI units, so the math matches them.
- **The `<TimeStamp>` component** from the consequences waits for its first consumer; this ticket shipped the pure library only (#43).

---

## DES-015: Content tone register — terse, direct, second-person imperative ("GitHub voice, not Mailchimp voice")

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Component-default copy strings — button verbs, validation messages, default placeholders, error states, the `?` cheat-sheet from DES-010, the skip-to-content link from DES-011, settings labels, system toasts — need a consistent voice. Without an explicit register, individual contributors will drift, and the app will end up with a mix of "Sorry, something went wrong" and "Save changes" and "Got it" and "We'll save your changes" that read as inconsistent and unprofessional. The persona (senior in-house counsel, operations manager) is competent and busy; the brand (utility-tool with character per DES-003) is GitHub-shaped. The voice needs to match.

### Decision

The voice register for all component-default and system-generated copy is **terse, direct, second-person imperative; no apologies; no first-person plural; functional confirmations not celebratory ones; technical-but-readable error copy.** The shorthand: **GitHub voice, not Mailchimp voice.**

#### Rules

1. **Verbs, not phrases, on buttons.** `Save` / `Cancel` / `Delete` / `Add member` / `Approve` / `Send for review`. Not `Save changes` / `Got it` / `Yes, delete` / `Maybe later`.
2. **Second-person imperative for instructions.** `Add at least one reviewer.` / `Choose a template to continue.` / `Set your timezone in account settings.` Not `We need at least one reviewer.` / `Let's pick a template.` / `You'll need to set your timezone.`
3. **State the consequence; don't apologize.** `Couldn't connect to server. Retry?` / `Document not found.` / `You don't have access to this matter.` Not `Sorry, we had a problem connecting...` / `Oops! This document doesn't exist.` / `Hmm, you don't seem to have access.`
4. **Functional confirmations, not celebratory ones.** `Saved.` / `Comment posted.` / `Status changed to Approved.` Not `🎉 Great job! Saved successfully!` / `You're all set!`.
5. **No emoji in component-default copy.** Reserved for user-generated content and (eventually) emoji-reactions. Glyphs come via Lucide per DES-008.
6. **Sentence case, not Title Case**, for everything except proper nouns and brand names. `Add member` / `Account settings` / `Recently uploaded`. Not `Add Member` / `Account Settings`.
7. **End sentences with periods. End fragments without.** Validation messages and explanations get periods; button labels, table headers, chip labels do not.
8. **Error copy names what failed in plain language.** `Couldn't upload file — file size exceeds 25 MB limit.` Not stack traces, not error codes (those go to dev console), not abstract "an error occurred" copy.
9. **Numbers as digits, not words.** `3 reviewers required` / `1 unread`. Not `Three reviewers required`.
10. **Avoid "please."** The instruction itself carries the request. `Add a comment to continue.` Not `Please add a comment to continue.`

#### Where this register applies

- All component-default copy (button labels in shadcn primitives, validation messages, error states, empty-state defaults, tooltip text, the cheat-sheet modal from DES-010, the skip-to-content link from DES-011, settings labels)
- All system-generated copy (toasts, banners, confirmations)
- The onboarding flow's static per-step user guidance

#### Where this register does _not_ apply

- **User-generated content** (comments, request descriptions, document titles) — users write however they write.
- **Feature-level marketing copy** (landing page, docs site if/when produced) — different audience, register decided per-surface.
- ~~**Email digest copy** (deferred with the notifications-surface decision) — separate register decision when that ships.~~ _Closed 2026-08-18 by **DES-051**, which is that separate decision. It turned out to be owed for **every** message this system sends and not only the digest, so DES-051 states the register for all of them: this one, plus a message names its reader and points somewhere, and a message is a sentence rather than a summary. Email copy is therefore **in scope** for this register from here on — the exception is gone, not narrowed._
- **Pre-login chrome** (login screen tagline, signup screen) — narrow exception where first-person plural ("We help legal teams...") may be appropriate; revisit if it becomes a pattern, not a one-off.

#### Reference exemplars and anti-exemplars

- **Exemplars:** GitHub (closest match — sentence case, terse verbs, no apologies, technical-but-readable errors); Linear (slightly warmer but acceptable secondary reference).
- **Anti-exemplars:** Mailchimp / Slack onboarding (too playful for the persona); older AWS console (too corporate-bureaucratic); Notion (too friend-shaped — "Nothing here yet — let's add something!" reads as condescending in a procurement-tool register).

### Rationale

1. **Voice should match the persona, not the designer's preference.** Senior in-house counsel and operations managers respond to terse competence. Chumminess registers as wasted time at best, condescension at worst.
2. **The visual brand (Warm theme, character via DES-001) carries enough warmth.** The copy doesn't need to. Pairing a warm visual with cool copy lands closer to "tool with character" than pairing warm visuals with chatty copy, which over-shoots into "tool that wants to be your friend."
3. **GitHub voice is the established convention for the persona's daily software.** Matching it lowers cognitive cost; users already know how to read this register.
4. **Sentence case is more readable at small sizes** (the 11–14px range we live in per DES-006) than Title Case, and matches modern macOS/iOS convention. The few apps that do Title Case in 2026 are the dated ones.
5. **No-emoji-in-defaults preserves emoji as a meaningful signal** when it does appear — in user content. A toast that says `🎉 Saved!` desensitizes the user to celebration; a comment that says `🎉 thanks team!` from a colleague carries actual emotional weight.
6. **"Please" is empty padding.** Removing it doesn't make the app rude; it makes it efficient.
7. **A written voice rule prevents drift.** Twenty contributors over two years will write hundreds of strings; without a stated register they'll drift toward whatever register their last job used.

### Alternatives considered

- **Notion-shaped friendly voice** ("Nothing here yet — let's add something!"). Rejected — wrong register for the persona; reads as condescending in a procurement tool.
- **Title Case for buttons** (matches some current GitHub UI). Defensible; rejected as default because sentence case reads better at small sizes and is the modern convention.
- **Allow "please" for softening errors.** Rejected — instructions read as instructions whether or not they say please; "please" adds nothing.
- **Permit first-person plural ("we") in error states for warmth.** Rejected — see rationale #1; the persona doesn't want a friend.
- **Allow celebratory confirmations on milestone events** (first matter created, first contract approved). Rejected for v1 — milestones can carry a different register if/when an onboarding-celebration feature ships, but the _default_ is functional.
- **Explicit "voice and tone" guide as a separate document.** Rejected — the rule list above is small enough to live in this DES; a separate doc adds maintenance overhead without commensurate benefit at v1 scale. If contributor count grows, promote to its own doc.

### Consequences

- **All shadcn primitives copied into the repo get a copy pass** to align their default labels with these rules. shadcn ships with sensible defaults already; deltas should be small.
- **A small "voice rules" reference** (the 10 rules above) belongs somewhere contributors will see it — either in the repo's `CONTRIBUTING.md` (when one exists) or as a comment header in the central message catalog file (`messages/en-US.json` per DES-013). Implementation detail; either works.
- **PR review checks for voice drift.** New strings that violate the rules (Title Case button labels, "please," apologies, first-person plural, emoji in defaults) get flagged. Not automatable cheaply; relies on reviewer attention.
- **The cheat-sheet modal from DES-010 and the skip-to-content link from DES-011** get copy that conforms (`Keyboard shortcuts` not `Keyboard Shortcuts`; `Skip to content` not `Skip to Content`).
- **The timezone picker label from DES-014** conforms: `Use browser timezone` not `Use Browser Timezone` not `We'll use your browser's timezone`.
- **The pre-login chrome carve-out** is intentionally narrow; if it expands beyond a one-line tagline, revisit and decide whether marketing-adjacent surfaces deserve their own register decision.
- **No separate "tone guide" document is produced** for v1; the rules in this DES are the source of truth.

### Addendum list

- **2026-08-28, M25/5, [#537](https://github.com/juggernog20/OpenLaw/issues/537):** the staff header placeholder changes from `Type / to search` to `Search contracts, matters, documents…`. The separate `/` chip remains. The existing `shell.search.placeholder` message keeps its `{key}` interpolation, with the chip rendering the visible key from `SEARCH_KEY`.

---

## DES-016: Record-page right side — VS Code-style activity bar with page-scoped applets (amends DES-007's rail)

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

The contract-details mocks carried two competing right-side systems: a module chip row (E) and a V13 icon bar + panel (J) — flagged as duplication (X.8) and as a conflict with DES-007's single 320px `--width-rail`. The screen-batch grill resolved it; Blair named the reference model: "VS code activity bar style where it's a single activity bar with vertical icons available 'applets' for that page as icons when you expand the side bar."

### Decision

- **One right-side system: the activity bar** — a persistent 48px vertical icon strip on record pages, VS Code-style. Each icon is an **applet available on that page**; clicking expands the side panel hosting that applet (one applet visible at a time; clicking the active icon collapses).
- **Applet set is page-scoped.** Contract details: team (DES-047, Lucide `User`), chat (CMT-004 comment panel), history (DD-017 activity feed), settings deep-link (SET-001, below a divider). The document panel (K) opens as a wider sibling layer per the doc-panel spec, not inside the applet panel.
- **The module chip row is removed** from record pages (E.0 remove — chips duplicated applet/section jobs).
- **DES-007 amendment:** the record-page right side is `--width-activitybar: 48px` + `--width-panel: 320px` (the panel reuses the old rail width; `--width-rail` is renamed/retired in favor of these two tokens). The applet panel always docks as a flex sibling (2026-08-17 clarification); the doc panel docks above 1400px and overlays the record content below it (2026-08-18 second pass); the bar remains.
- Active applet gets the V13 indicator strip (J.0); only chat carries a badge (CMT-004; J.X2).

### Rationale

One expandable surface resolves the chip/rail duplication, matches a pattern every developer-adjacent user already knows, and preserves CMT-004's conversation-beside-content requirement. The 48px bar cost is small and always predictable.

### Alternatives considered

Chips only (no side-by-side panels — breaks CMT-004); both trimmed (the X.8 duplication); DES-007's plain 320px rail with no bar (no affordance to switch applets).

### Consequences

Layout-shell change: `--width-activitybar` + `--width-panel` tokens replace `--width-rail`. The pattern generalizes to matter/entity/knowledge record pages (same bar, page-appropriate applets). Mocks: delete chip row, add bar to V12.

### Implementation clarification (2026-08-10, #47)

Components: `ActivityBar` + `AppletPanel`, composed by `RecordApplets`. Six points the decision left open:

Take geometry from the ActivityBar and panel frames of the matter-detail screens in `designs/matters.pen` (M2 closed, M3 comments open, M13 history open) — the newest mock suite and the only artifact drawing the decided applet set (chat, history, settings). Where the older `initial-contract-details.pen` V12/V13 strips disagree (48px slots, 24px Material glyphs, settings pinned to the bar's bottom edge), matters.pen wins: 48px bar with 12px vertical padding, 32px slots on an 8px gap, 18px Lucide glyphs, a 24px divider, and the settings slot flowing directly below the divider. Do not pin the below-divider group to the bar's bottom edge.

1. **Style the bar with body surface tokens, not the DES-019 chrome group.** The chrome group exists because the header/nav/sub-bar slab restructures per theme; the bar sits inside the body region, and the matters.pen bar is body tokens verbatim: `#FFFFFF` fill, `#D0D7DE` leading border, `#D8DEE4` divider, `#656D76` glyphs — `bg-raised` / `border-default` / `border-muted` / `text-muted` in Light values. Add no `--chrome-activitybar-*` variables. Extend the chrome group only if a later theme pass shows the bar diverging.
2. **Fill the badge with the new `--badge-alert-bg` / `--badge-alert-fg` pair.** matters.pen fills the chat badge `#CF222E` with white text — Light's danger red — but the badge is an attention count, not a danger status, so do not borrow `status-danger-fg` (in Dark it is too light to carry white text). Per-theme values: Light `#CF222E` on `#FFFFFF` (5.4:1), Warm `#A05540` on `#FBFAF7` (5.2:1, warm's own red), Dark `#DA3633` on `#FFFFFF` (4.6:1). Keep `--badge-count-*` as the neutral counter.
3. **Set the badge count in `text-xs` (11px) where the frames draw 9px** — DES-006's ramp floors at 11px — making the badge a 16px pill rather than the frames' 14px. Render glyphs at the 20px Lucide step where the frames draw 18px — DES-008's ramp is 16/20/24, and DES-019 already normalized the brand glyph 18→20.
4. **Mark the active applet with DES-016's accent indicator strip (3×48px, `--width-activitybar-indicator`) and a `text-primary` glyph.** Do not copy matters.pen's active treatment: it draws no strip and tints the glyph `#51B3D6`, but that is the avatar token, not an interactive one, and it reads 2.4:1 on white, under DES-011's 3:1 affordance floor. The strip is what DES-016 decided (J.0); the V13 frame draws it in the accent. Back-port to matters.pen when those mocks next get touched. (The `CONTRACT-DETAILS-INVENTORY.md` J.0 row called the strip a green pill; corrected — the frame draws a square-ended accent bar.)
5. **Give the panel a 44px header: the applet's title (13px semibold) and a close X (16px glyph), over a `border-muted` rule.** Both M3 and M13 draw it. Keep the close control even though it duplicates the bar toggle — it is the near-hand collapse. Treat the M3 header's count pill ("4", total comments) as applet content, not panel chrome; it lands with the chat applet (M8/M9). Focus the panel container when it opens — not its close control, which reads as "you probably want to leave" — then close on `Esc` and return focus to the applet's bar icon. DES-010's overlay rules, wired by hand because the panel is a plain `aside`, not a Radix overlay. The same open-focus rule covers a fragment that expands the panel (DES-047): without it, `Esc` does nothing until the user tabs in.
6. **Type a slot as either a panel or a link.** DES-016 names settings as a deep link, so the applet type is a union: `render` opens the panel, `href` navigates. Only `render` slots own the panel, and only they toggle. Group link slots below the divider.

Dock via a container query at 1100px of record-region width per DES-012. Write the threshold literally into the class list: Tailwind scans source text, and container conditions cannot read a CSS variable. **Superseded 2026-08-17** for the applet panel, which always docks. The doc panel keeps a threshold of its own at 1400px (the M12/2 clarification below, as amended by the 2026-08-18 second pass), and the rule about writing it literally still holds.

### Implementation clarification (2026-08-17): applet panel always docks

The overlay-below-1100px behaviour (DES-012's side-panel row, and the dock sentence above) is superseded for the **applet panel**. Opening an applet always takes a `--width-panel` (320px) flex column beside the record content; the content shrinks. Overlaying covered the record rather than sharing the row with it, which is the opposite of the VS Code activity-bar model this decision named. The close X in the panel header stays.

The column opens and closes on a 200ms `width` transition (`ease-out`), so the record flexes with it rather than snapping. The aside stays mounted through the close so the slide has something to clip; it is `inert` the moment closing starts (focus already restored to the bar). `prefers-reduced-motion` already collapses the duration (DES-011). This is chrome motion, not a hover/focus state — the one exception on this surface to DES-003's animation floor.

### Implementation clarification (2026-08-18): doc panel always docks too

**Superseded the same day** by the clarification that follows. The diagnosis was right and the remedy was wrong: the applet was covered by the overlay's reach, not by the fact that it overlaid. Held for the record.

The overlay-below-1400px rule (point 2 of the M12/2 clarification below) is superseded. Overlaying pinned the document to the inner edge of the activity bar at `z-20`, so an applet that opened in the same row was covered and appeared not to open. The doc panel is now a flex sibling like the applet: content · doc panel · applet panel · activity bar. Opening an applet pushes the document column the same way it pushes the record content.

On the **Documents** section the list yields to the viewer: it is the index of the file being read, and showing it beside the viewer was the overlay the docking pass removed. The panel then grows (`flex-1`) into that column. Other sections stay beside the viewer at `--width-docpanel` (720px) — chatting about a clause while looking at Fields is still the point of a third column. The overlay-closes-on-tab-change fix that follows is also superseded — that close existed only because the overlay hid the section the tab had just revealed.

### Implementation clarification (2026-08-18, second pass): the doc panel docks or overlays, and its overlay covers the record content only

The **applet panel** still always docks — the 2026-08-17 clarification above stands. This one is about the **doc panel**, and it withdraws the "always docks" clarification above it. Overlay-below-1400px is reinstated for that panel, and so is the tab-change close that follows.

**Why the dock alone did not work.** `--width-docpanel` is 720px and the activity bar is 48px. On a 1038px window that leaves 270px for the section behind the panel — the record's own fields, drawn in a sliver too narrow to read or to edit. Covering a section is recoverable in one click; squeezing it to nothing is not. So the panel keeps its threshold: above 1400px of room it is the 720px column, below it covers the section instead.

**What the real defect was.** Not the overlay — its reach. The panel spanned the whole record row to the inner edge of the activity bar, so anything else in that row went under it, and an applet opened behind the document and read as not opening at all. That is what the "always docks" pass was chasing.

**The fix is a containing block, not a layout mode.** `RecordApplets` now draws the record content and the layer inside their own positioned region, with the applet panel and the activity bar as siblings **outside** it. That one region is both the box an overlaying layer is positioned against and the box the docking threshold measures. Three things follow, and they are the whole of this clarification:

1. **A document never covers an applet**, docked or overlaying. Reading a clause while discussing it in chat — the case point 1 of the M12/2 clarification names — works at every width.
2. **Opening an applet narrows the document, not the record.** The region loses 320px; the overlay inside it narrows with it.
3. **The threshold is spent by whatever is in the row.** A window that fits three columns docks. The same window with an applet open may fall under 1400px and hand the dock back, which is the same trade a narrower window makes.

**The Documents list stops yielding.** `hideContent` and `fill` are withdrawn. The list docks beside the viewer above the threshold and is covered below it, exactly like Fields or Approvals — "beside the record it lives on" is what DOC2 draws, and hiding the index of the thing being read was a workaround for a fixed column that no longer exists.

### Implementation clarification (2026-08-14, M12/2 #185): the doc panel, the wider sibling layer

DES-016 said the document panel (K) "opens as a wider sibling layer per the doc-panel spec, not inside the applet panel", and left the layer itself to that spec. M12/2 builds it, so this is what "wider sibling layer" means in the code. The reference frames are `designs/documents.pen` **DOC2 — Document detail** (the viewer card: its toolbar and its well) and **DOC6 — Email document**; the older `initial-contract-details.pen` K strip is the naming source (K.H1–H6, K.T1–T9) and loses to DOC2 wherever the two disagree.

1. **The doc panel is a third column, not a second panel.** Docked, the record region reads content · doc panel · applet panel · activity bar. Both panels open together and neither closes the other: they answer different questions, and a reader who is discussing a clause in the chat applet is exactly the reader who wants the clause on screen. It is rendered by `RecordApplets`, through a `layer` slot beside the applet panel — a layer drawn inside the page's own content would sit inside the record's scroll and could not hold a column.

2. **`--width-docpanel: 720px` when sharing the row, and an overlay when there is no room to share it.** The width comes from the mock: DOC2 draws a 640px page, and 720 carries it with the well's own padding either side. Below 1400px of record-content width the panel covers that content rather than squeezing it — see the 2026-08-18 second-pass clarification for what the covered box is and what stays outside it. Every section is treated the same way, Documents included.

3. **A 44px header, then a 40px toolbar.** The header is the applet panel's chrome verbatim — the document's title at 13px semibold and a close X at 16px — plus a file glyph and the version pill K.H3 draws, in the neutral `badge-count` pair, because the round on screen is a structural fact and not a status. The toolbar under it is DOC2's: `bg-canvas`, the filename at 12px muted on the leading edge, and the download (K.T8) on the trailing one. The title and the filename are two different strings and both are drawn — the record renames a document freely (DOC-007) and the Document Version keeps the name it arrived under.

4. **Reading controls belong to the surface that has them, not to the toolbar.** K.T1–T6 draw page navigation and zoom in the panel toolbar. They are drawn inside the PDF surface instead, because a PNG in the same panel has no pages and no zoom and a toolbar of dead controls is worse than none. K.T7 (search) and K.T9 (overflow) are not built: search inside a document is M25's, and there is nothing yet for an overflow to hold. Cross-cutting observation 15 in `CONTRACT-DETAILS-INVENTORY.md` — "nine controls for a preview; can collapse some behind more-vert" — is answered this way rather than by a menu.

5. **The well is `bg-canvas` and the page floats on it in `bg-raised`**, as DOC2 draws it. A PDF page is rasterized at the device's pixel density and sized back down in CSS; a page drawn at 1x on a retina screen reads as a photocopy.

6. **Esc closes it and focus comes back to the row that opened it.** The panel is a plain `aside`, not a Radix overlay, so DES-010's rules are wired by hand exactly as the applet panel's are: focus moves to the panel container when it opens — not to its close control, which reads as "you probably want to leave" — and the record puts focus back on the control that opened it when it closes.

7. **The document's name is the control that opens it.** A Document Version the panel can read is a `button`; one it cannot is the download link M11 shipped. That split is not cosmetic: a link that opened a panel would break everything a link promises, and a button that downloaded would lose the right-click, the middle-click, and the `download` attribute that names the saved file. Which one a row draws is read off the family the server routed the version to (DOC-004) — the web holds no list of file types. The version being read is marked `aria-current`.

8. **A Document Version outside the render set gets a card, never an empty well.** It states the filename, its size, one sentence saying why it is not on screen, and its download. The sentence is per family, because "not yet" (Word, PowerPoint, email — M12/3 and M12/4) is a different fact from "not ever" (the long tail).

### Implementation clarification (2026-08-18, bug fix): overlaying the doc panel closes on a section-tab change

**Withdrawn and reinstated the same day.** The "doc panel always docks too" clarification retired this close, and the second-pass clarification above put the overlay back and this close with it. It applies whenever the panel overlays, and never when it docks.

Below the 1400px docking threshold the doc panel overlays the record's content column rather than sharing the row with it (point 2, above). Before this fix, that overlay stayed open across a section-tab change: a reader who opened a document from Documents and then clicked Fields, Approvals, Key dates, or Tasks saw the tab strip's active tab move but the screen never changed — the panel covered the new section exactly as it had covered Documents, which read as the tab strip having stopped working. Only Overview and Documents were ever covered by a test, and both happen to be the two sections a reader is most likely to check with a document already open, so the gap went unnoticed.

The fix: `DocPanel` watches its own `ResizeObserver`-reported width and tells its caller whether it is currently docked. `ContractRecord` keeps the answer in a ref and, only when its `tab` param actually changes, closes the panel if that ref says it is overlaying. Docked, a tab change leaves the panel open — the same "beside, not instead" behavior point 1 already named, now actually reachable from every section rather than just two of them.

### Addendum (2026-08-28, M25/6, [#538](https://github.com/juggernog20/OpenLaw/issues/538)): K.T7 built

K.T7 now lives with the other PDF reading controls. Its compact button opens C35's find bar; a search landing carrying `?find=` opens that bar already filled. The browser reads pdf.js's text content across the whole file, highlights the matching runs in each rendered text layer, reports the current ordinal and total, and moves through them with the previous/next controls or Enter/Shift+Enter. Moving the current answer scrolls its page into the well.

The control belongs to the PDF surface, so a stored PDF and a converted Word or PowerPoint rendition both have it. A raster image, an email surface (including the message's attachment reader), and a download card do not. No global key joins DES-010's map; the find input owns Enter, Shift+Enter, and its close behavior locally. This supersedes only point 4's statement that K.T7 was not built; K.T9 remains absent.

## DES-017: Editing model — per-field inline commit, no page edit mode

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

Autosave vs explicit save (grill-plan X.5, C.6/C.7) was undecided anywhere in the docs.

### Decision

Record fields edit **inline and commit individually** on blur/Enter; Esc reverts the in-progress edit. Each write is activity-logged per DD-017. **No page-level edit mode, no dirty state, no Cancel/Save chrome** (C.6/C.7 removed from the sub-bar). Multi-field compound edits (e.g. the CTR-006 renewal confirmation, conversion flows) use purpose-built dialogs with their own explicit confirm — the inline rule governs ordinary field editing.

### Rationale

Per-field commits give finer audit granularity than page saves; one editing model across records and settings (SET-003 immediate-apply) keeps the product coherent; a mode toggle taxes every small correction.

### Alternatives considered

Explicit edit mode + atomic save: batches log entries, but mode-juggling on every typo fix.

### Consequences

Field components need saving/saved/error micro-states (design-system addition). C.6/C.7 deleted from mocks. Bulk edits, if ever needed, are a list-surface feature, not a record-page mode.

_(2026-08-28, high-level review, [#552](https://github.com/juggernog20/OpenLaw/issues/552): the micro-states shipped as `StatusNote` plus eleven hand-written copies of the state machine behind it, which had already diverged. The design-system addition this clause promised is now built: `useFieldCommit` in `apps/web/src/lib/field-commit.ts` is the implementation of the micro-states clause, with `useRowCommit` for row-keyed settings lists. The hook owns the saving/saved/error note per field, the Enter-then-blur double-submit guard, the unchanged-value no-op, and the empty-required revert. It answers every commit with a `CommitOutcome` (the refusal's `detail` and TECH-020 `type`), so a screen can act on a refusal without reading the note. `StatusNote` draws what the hook says. A new per-field surface uses the hook, never a local copy. `entity-record.tsx` is the canonical example; the other ten copies migrate one route per touch, not in a sweep.)_

## DES-018: Chromatic discipline — status families kept, one severity ramp for ordinal scales, uniform avatars

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

The first full mock suite (matters.pen) surfaced "birthday sprinkles": a single list row could carry five unrelated hues — status, priority, and risk each pulled freely from the five status families, and avatars used arbitrary per-person colors. DES-005 defines the tokens but never constrained when each may appear.

### Decision

1. **Status pills keep their per-family colors** (Open = success, In progress = info, On hold = warning, etc.) — the current scheme stands.
2. **Ordinal severity scales (priority, risk, and any future low→critical enum) share one fixed ramp:** `low` = neutral grey, `medium` = warning yellow, `high` = severe orange, `critical` = danger red. This adds a **severe** family to the token set: `--status-severe-bg: #FFF1E5`, `--status-severe-fg: #BC4C00` (Primer orange), themed like the other four families. Priority's canonical seed levels are renamed to `low / medium / high / critical` (previously urgent/high/normal/low), aligning with risk.
3. **Avatars are uniform:** default is initials on the light-blue avatar accent (`--avatar-bg: #51B3D6`, `--avatar-fg: #0D1117`); a user with an uploaded photo shows the photo. No per-person hue hashing (the parked globals.css idea is now rejected, not just deferred).

### Rationale

Color should be information, not decoration: statuses are nominal categories (families help recognition), severity is ordinal (one ramp makes "how bad" legible at a glance across columns), and people are neither (uniform treatment keeps rows calm; photos carry identity better than hue ever did).

### Alternatives considered

Linear-style dot+text for statuses (rejected — tinted status pills are established and liked); hash-based avatar colors (rejected — reintroduces multi-hue rows).

### Consequences

`status-severe-*` and `avatar-*` tokens added to the registry and every theme file. Pill components consume the ramp by value, not per-callsite choice. matters.pen and openlaw.lib.pen updated; future module mocks inherit via the library.

**Implementation clarification (2026-08-08):** the ramp's `low` step requires a light-grey pill family that DES-005's set lacked (badge-count is a counter, onhold is the dark inverted pill), so `status-neutral-*` — already present in the .pen library — was added to the CSS registry as a seventh status family. The decision specifies Light values only; Warm/Dark values for `severe` and `neutral` were derived per-theme in `styles/themes/` and contrast-checked ≥ 4.5:1 (Warm's severe fg is `#935425`, darkened from the first candidate to pass). The derived values should be back-ported to the .pen library's theme frames when those mocks next get touched. **Back-ported (2026-08-10, #49):** `openlaw.lib.pen`'s `status-severe-*` / `status-neutral-*` variables now carry themed light/warm/dark values, previewed in the library's "Theme values — DES-018 severe/neutral" frames.

## DES-019: Shell chrome color variables — per-theme chrome mapping, Warm terracotta avatar (amends DES-018)

- **Status:** Accepted
- **Date:** 2026-08-10

### Context

Building theme switching (#44) against the Warm and Dark frames of `designs/final-themes.pen` showed that the shell chrome does not map onto DES-005's semantic tokens uniformly across themes. The nav surface is `#0D1117` in Light (= that theme's inverted surface) but `#F4F1EB` in Warm (= that theme's section-header tint) and `#0D1117` in Dark (= that theme's canvas, one step lighter than its header). Borders and secondary chrome text diverge the same way. Reusing body tokens for the chrome therefore leaks one theme's mapping into another. The .pen component library models this layer with its own `chrome-*` variables, confirming the chrome is a distinct token group.

### Decision

Eight chrome color variables join the theme files, one value per theme, consumed only by shell chrome components (referenced as bare variables, the DES-007 chrome-dimension pattern):

| Variable                 | Light         | Warm      | Dark          |
| ------------------------ | ------------- | --------- | ------------- |
| `--chrome-header-border` | `transparent` | `#D8D0C0` | `#21262D`     |
| `--chrome-search-bg`     | `#0D1117`     | `#FBFAF7` | `#0D1117`     |
| `--chrome-brand-chip`    | `transparent` | `#3A332A` | `transparent` |
| `--chrome-brand-fg`      | `#F0F6FC`     | `#F4F1EB` | `#F0F6FC`     |
| `--chrome-nav-bg`        | `#0D1117`     | `#F4F1EB` | `#0D1117`     |
| `--chrome-nav-border`    | `#30363D`     | `#EAE5DC` | `#21262D`     |
| `--chrome-nav-muted`     | `#7D8590`     | `#7A7264` | `#7D8590`     |
| `--chrome-subbar-border` | `#D0D7DE`     | `#EAE5DC` | `#21262D`     |

The Light column is exactly what the shell rendered before this record, so Light is unchanged.

**Warm avatar (amends DES-018 point 3):** Warm's avatar is terracotta (`--avatar-bg: #C97B5C`, `--avatar-fg: #FBFAF7`) per the updated mock — blue is the one hue Warm's palette refuses. Light and Dark keep the light-blue treatment; the "no per-person hue hashing" rule is untouched.

### Recorded normalization points (mock deviations accepted)

1. Nav labels stay 14px in every theme (DES-001 theme-invariant typography); the Warm frame's 13px labels are treated as frame noise.
2. Search placeholder, crumb slash, and the `/` key hint stay `--text-subtle` in every theme; Dark renders `#6E7681` where its frame shows `#7D8590`, and Warm's key hint renders `#A8A294` where its frame shows `#7A7264`.
3. The Dark sub-bar title stays `--text-primary` (`#E6EDF3`) where its frame shows `#F0F6FC`.
4. Warm's brand chip is 32px (the shell's icon slot) where its frame draws 30px, and the brand glyph stays the 20px Lucide scale in every theme (the Warm frame shows an 18px glyph).
5. The search placeholder is "Type / to search" in every theme, as the Light and Dark frames draw it. The Warm frame's longer "Type / to search matters, contracts, entities…" copy describes the M25 cross-module search scope, not the M4 shell. (Added during the #49 acceptance comparison.) _Superseded for M25 by DES-015's 2026-08-28 addendum: the placeholder now names Contracts, Matters, and Documents while the separate `/` chip keeps the shortcut visible._
6. The nav is 48px and the sub-bar 64px tall in every theme (the DES-007 contract, drawn by the Light and Dark frames). The Warm frame draws them 46px and 62px — the same 13px-label frame noise as point 1. (Added during the #49 acceptance comparison.)

### Rationale

The chrome is the one region where themes deliberately restructure (Light: single dark slab; Warm: layered light paper; Dark: near-black strips on canvas). Forcing it through body tokens would either distort body surfaces or leave the chrome mis-themed; a small named group keeps both honest, and mirrors the vocabulary the design library already uses.

### Consequences

Theme files each carry the chrome block; shell components reference only chrome variables plus the tokens that do hold across themes (`bg-inverted`, `text-on-inverted`, `--accent`, avatar pair). Future chrome surfaces (activity bar, panel — DES-016) should extend this group rather than borrow body tokens.

## DES-020: List-editor pattern — the shared anatomy for taxonomy settings panes

- **Status:** Accepted
- **Date:** 2026-08-11

### Context

SET-001 and SET-003 both reference a "list-editor pattern per DES" that no record had written; the SET-003 addendum schedules it for M6, where the first taxonomy list-editor ships (Contracts → Types, #81). Every taxonomy surface after it — matter types, statuses, request types, the field catalog, approver groups — reuses this one anatomy, so the contract is written once, against the ratified mocks: frame ST6 (the types list) and frame ST8 (the archive-guard modal) in `designs/settings.pen`, with the archived-row treatment inherited from ST5 (Users). The M5 panes were not taxonomy lists; this record does not restyle them.

### Decision

A list-editor is a settings card that edits one ordered taxonomy. Its parts:

**Card anatomy.** The DES-004 settings card: `bg-raised`, `rounded-card`, `border-default`. The `bg-section-header` header strip carries the list title (13px semibold), a row-count caption (12px `text-secondary`, ICU plural), and the primary "Add [thing]" CTA. A help caption (12px `text-secondary`) sits below the card and names the two non-obvious behaviors: reorder by drag, and the archive guard.

**Row anatomy.** Rows are 44px tall, separated by `border-muted`, in four columns: a 36px reorder-handle column (16px `grip-vertical` glyph, `text-secondary`); the display name (13px medium `text-primary`), followed inline by any qualifier pills; a right-aligned usage-count caption (12px `text-secondary`, ICU plural of the owning record noun); and a 44px trailing-action column holding one icon button (16px `archive` glyph). Rows never grow a second line — description and anything richer belong to the type-editor screen (frames ST15/ST16), not the list.

**Lock treatment.** System-protected rows (CTR-002 / MTR-001 `other`, and any row a decision marks unarchivable) swap the trailing archive action for a 16px `lock` glyph — presentational, not a button, with an accessible name stating why ("[Name] is system-protected and can't be archived"). Protection removes archive and hard-delete only; locked rows still rename and reorder. The server refuses the operations regardless of what the client draws.

**Reorder affordance.** The grip is a real button, keyboard-focusable, with an accessible name naming the row. Pointer: native HTML5 drag of the row, commit once on drop. Keyboard: Arrow Up / Arrow Down on the focused grip moves the row one position and commits immediately; moves are announced via a polite live region. Order changes apply immediately on save (SET-003) — no reorder mode, no save button. No drag library; the affordance is small enough to own.

**In-place rename.** The display name is a click-to-edit field per DES-017: activating it swaps in a text input; Enter or blur commits, Escape reverts, empty reverts. Renaming changes the display name only — slugs are derived at creation, immutable, and never rendered in the list-editor.

**Add.** The "Add [thing]" CTA appends an inline draft row at the end of the list with a focused name input: Enter creates (the server derives the slug and appends the display order), Escape discards. No add dialog — creation is one field, and the row _is_ the form.

**Archive guard (the SET-003 modal, frame ST8).** Archiving always goes through the modal: title "Archive [name]"; a `status-warning` strip stating the live-usage count; a reassignment select labeled "Reassign [count] [records] to", required when the count is positive and disabled at zero; the audit caption (11px `text-secondary`, `history` glyph) "The change applies immediately and is recorded in the audit log."; footer with secondary Cancel and a danger "Archive [thing]" CTA. Surfaces with structural minimums (statuses) block instead of reassigning, per SET-003.

**Archived rows.** Archived rows leave the default view. A "Show archived" toggle in the header strip reveals them appended below the live rows in the ST5 archived treatment — identity at 50% opacity, a neutral "Archived" pill, and a restore action in the trailing column. Restore re-activates the row at the end of the display order. Nothing is deleted.

### Recorded normalization points (mock deviations accepted)

1. Buttons render through the shipped Button component (13px text, h-8/h-7, DES-004's contracts.pen normalization); the ST6/ST8 frames' 12px, 25px-tall buttons are frame noise.
2. ST6's "Default" qualifier pill and its second locked row draw the matters _default-type_ machinery (MTR-001); no decision defines a default contract type, so the Contracts → Types pane renders neither. The pill slot in the row anatomy is what carries over.
3. ST6 draws no archived-row treatment; the "Show archived" toggle and restore action are inherited from ST5 (Users), which the SET-001 amendment already ratified as the drawn-on archived pattern.
4. ST8's select renders through the shared form-control treatment (`bg-raised`, DES-004) at the shipped 32px control height, matching the frame.

### Rationale

One written contract keeps five later panes from re-deriving the pattern by eye. The mock alone can't carry it: ST6 draws one state of one pane, while the pattern has to answer rename, add, keyboard reorder, protection, and archived recovery — exactly the questions each later builder would otherwise answer differently.

### Consequences

The Contracts → Types pane (#81) is the reference implementation. Later taxonomy panes (matter types, statuses, fields, request types, approver groups) build to this record and extend it — a statuses pane adds its stage column and blocking guard without reopening the row anatomy. The reassignment select inside the guard modal is the shared bulk-reassign affordance SET-003 promised. When a later surface genuinely can't fit this anatomy, that's a new DES record, not a local deviation.

### Amendments (2026-08-12, #86 acceptance sweep)

The M6 build diverged from four clauses above. The build stands; the superseded wording is marked here, not rewritten.

1. **Trailing actions.** The row-anatomy clause "a 44px trailing-action column holding one icon button" is superseded. As shipped, the trailing slot is a cluster: the row's SET-003 save micro-state, then any pane-supplied edit action — the pencil that opens the DES-021 editor dialog (fields) or navigates to the DES-022 editor screen (types) — then archive, restore, or the lock. 44px stands as the slot's minimum, not its fixed width.
2. **Inline add.** The Add clause's "creation is one field" is superseded. The inline draft row carries the name plus at most one creation-time dimension — the statuses pane's stage select (CTR-001) rides the row. Creation richer than that opens the DES-021 editor dialog.
3. **Archive guard.** A third guard outcome shipped beside reassign and block. The policy is SET-003's, not new here — an in-use archive requires a reassignment target, so with no other live row to take the records the archive cannot proceed. This record covers only how the modal draws that state: select and danger CTA disabled, with an explanatory line ("No other active type can take its contracts. Add or restore another type first."). At a zero count the select stays drawn and disabled with a "No reassignment" placeholder, as written.
4. **Show archived.** The header-strip toggle renders only when archived rows exist. A taxonomy with nothing archived draws no toggle.

### Amendment (2026-08-20, [#354](https://github.com/juggernog20/OpenLaw/issues/354)) — the two-line row, for a pane whose rows carry columns

The row-anatomy clause above says "Rows never grow a second line — description and anything richer belong to the type-editor screen", and DES-021's third normalization point repeats it. **That clause is superseded for panes that declare columns**, and stands everywhere else. The request types pane (frame ST12) is the surface that reversed it, and this is the rule it establishes.

**A pane that declares columns gets the header strip, the cells, and the second line together.** These three are one decision, not three: the moment a taxonomy has something to say about a row beyond its name, the right-aligned in-use caption is the wrong shape for it, and once the row is a table row the name column has room the one-line row did not have. Request types declare one column today (Target) and a second with the form definition (Form fields). Rows with a caption are **52px**; rows without stay at 44px. The caption is the row's description, 12px `text-secondary`, truncated to one line.

**Why the description moved back onto the list here, when DES-020 sent it to the editor.** A contract type's description explains an internal taxonomy to the Administrator who maintains it, and the editor is where they are. A request type's description is **requester-facing copy** — it is what a business user reads in the portal picker to choose between "Contract review" and "Legal question" (INT-002). An Administrator auditing their front door needs to read the list the way a requester will, and opening three editors to do it is the same failure the Target column exists to prevent.

**The three type taxonomies declare no columns and are unchanged** — one line, the in-use caption, 44px. This is the shape of the whole extension: the mount asks, and a mount that does not ask gets what it always had.

**Sanctioned extension points, added to DES-021's list.** A column is a header, an sr-only cell prefix (DES-021's rule — a row named "Contract review" whose Target cell reads "Contract" is two different facts), a width shared by the header and the cell, and the cell itself. The cells sit between the name column and the trailing actions, where the in-use caption sits on a pane with none. A pane never declares both.

### Recorded normalization points (ST12 deviations accepted)

1. ST12 draws archive alone in the trailing slot. The pencil that opens the DES-022 editor screen joins it, per the #86 amendment's trailing-action cluster — the editor is where the target and the form live, and a list with no way into it is a dead end.
2. ST12 and ST14 draw 25px-tall 12px buttons; they render through the shipped Button component, as DES-020's first normalization point already settled for ST6/ST8.
3. ST14's left card draws Display name, Description, and Target and no Slug row. The slug row stays: it is DES-022's identity anatomy, the slug is real for request types (it keys the portal form and the API), and a mock omission is not a decision to drop it.
4. ST14 draws no in-use caption, and none renders — `requests` land in M20, so the count would read "0 requests" on every type. The caption's slot in DES-022's identity card is optional for the same reason the pane's is.

## DES-021: List-editor table variant and the field-editor dialog (extends DES-020)

- **Status:** Accepted
- **Date:** 2026-08-12

### Context

DES-020's consequences clause: a taxonomy surface that genuinely can't fit the written anatomy gets a new DES record, not a local deviation. The Fields catalog pane (#83, frame ST11 in `designs/settings.pen`) is that surface, twice over. Its rows carry four data dimensions beyond the name (type, scope, tag, AI-prompt marker) where DES-020's row holds one qualifier pill; its catalog is unordered (`fields` has no display order — per-type attachment order rules rendering, CTR-016), so the reorder affordance has no meaning; and creating a field sets seven dimensions, two of them immutable, which DES-020's one-input inline add row cannot carry. This record writes down how the anatomy stretches, once, for every later multi-dimension taxonomy (request types, approver groups if they grow columns).

### Decision

The ListEditor component (extracted at this pane, the rule-of-three moment) is the one implementation of DES-020, and these are its sanctioned extension points:

**Table variant.** A pane whose rows carry several data dimensions renders them as fixed-width cells after a flexible name cell, under a column-header strip (11px semibold `text-secondary`, `border-default` rule) sitting above the row list. Cells carrying plain values render 12px `text-secondary` text; enum-like standing (the scope) renders as a pill. Each cell text carries an sr-only column prefix ("Type:", "Scope:", "Tag:") — the #82 stage-badge rule generalized: a field named like a cell value stays unambiguous to a reader.

**Unordered lists.** A catalog with no display order renders no grip and no reorder affordance; rows keep creation order. The grip column collapses; the name cell starts at the card padding.

**Dialog-based create and edit.** When creation sets more than a name plus one dimension, the Add CTA opens an editor dialog instead of an inline row — creation is a form, so the form gets a surface. The same dialog edits the row's non-name dimensions, opened from a pencil icon button in the trailing column (before archive). Immutable dimensions render in the dialog as facts with an explanatory caption ("The field type is immutable after creation."), never as disabled controls. In-place rename on the name cell stays — the dialog complements DES-017, it does not replace it.

**Guard without reassignment or blocking.** Surfaces whose removal semantics are "hide and retain" (fields: MTR-014 value retention) run the DES-020 archive modal with the warning strip stating the retention rule and the live-usage count — no reassignment select, no structural block.

### Recorded normalization points (ST11 deviations accepted)

1. The scope pill maps to the paired status families: `status-neutral` for module scopes, `status-info` for `global` (the frame's `#EFF1F3/#57606A` and `#DDF4FF/#0969DA` are those tokens' Light values).
2. The AI-prompt sparkle renders the Lucide `sparkles` glyph at 16px in `status-info-fg` where the frame draws 14px — DES-008's size ramp floors at 16. Fields without a prompt draw an em dash with an sr-only "No AI prompt".
3. ST11 draws no edit affordance; the trailing pencil button is this record's addition — the seeded prompts and the options lists are editable (CTR-008/CTR-016), and ~~the list row deliberately never grows a second line (DES-020)~~ _(the second-line clause is amended by DES-020's M19/4 amendment: a pane that declares columns may draw the row's description under its name. The fields catalog declares columns and no caption, so this pane is unchanged.)_

### Rationale

The alternative was forcing the catalog into the plain anatomy (losing the type/scope/tag columns that make the catalog scannable) or a bespoke pane outside the pattern (a fourth implementation to keep aligned by eye). Extending the one component keeps DES-020's guarantees — row height, rename, archive treatment, protection semantics — while the extension points absorb the real variation.

### Consequences

`apps/web/src/components/list-editor.tsx` carries the pattern; the Types (#81) and Statuses (#82) panes were refactored onto it with their test suites unchanged. Later taxonomy panes choose: plain anatomy (inline add, optional reorder) or the table variant (columns, dialog editor) — both are this one component. M22 mounted Matters → Fields on the table variant and widened the scope picker to `matter`.

### Amendment (2026-08-12, #86 acceptance sweep)

The shipped dialog carries the name field too: create names the field, and edit commits a changed name alongside the other dimensions. The "non-name dimensions" wording above is superseded on that point only — in-place rename on the name cell stands, and the dialog is a second path to the name, not the only one.

## DES-022: The type-editor screen — identity card plus attachment table (extends DES-020)

- **Status:** Accepted
- **Date:** 2026-08-12

### Context

DES-020 pins the taxonomy list row to one line and sends "description and anything richer" to the type-editor screen (frames ST15/ST16 in `designs/settings.pen`). #84 builds the first one — Contracts → Types → a type's own screen, where CTR-016 field attachments live. Like DES-021, this record writes the screen's anatomy down once: the matters type editor (ST15, M22) and the request-type editor (ST14, M19) are the same shape.

### Decision

A type editor is its own routed URL under its list pane (`…/types/:id`), keeping the section tab strip, with a breadcrumb return — a 16px `arrow-left` glyph and "All [things]" (12px medium, `text-secondary`) — linking back to the list. Below it, two cards side by side, wrapping to a stack when the slot is narrow (intrinsic wrap, no viewport breakpoint — DES-012):

**The identity card** (fixed 560px): a DES-004 settings card titled with the display name. Display name and description are DES-017 commit-on-confirm inputs — blur/Enter commits, Escape reverts, micro-states beside the field. The slug renders as a read-only input in `text-secondary` with an 11px caption stating why it never changes. A 12px usage caption ("N [records] use this type.") closes the card.

**The attachment card** (flexible): a flush DES-004 card in the DES-021 table variant — an 11px semibold column-header strip ("Field", "Required"), then DES-020's 44px rows: the reorder grip (per-type order is real order — CTR-016), the field's display name (13px medium) with its type as an inline 12px `text-secondary` caption, the scope riding the caption only when it is `global` ("Single select · global"), a 16px checkbox in the Required column, and a 16px `x` detach button in the trailing column. Detach runs no guard modal: the removal semantics are detach-and-retain (values keyed by slug survive, MTR-014), which the help caption below the card states — "Drag to reorder. Required fields are enforced at creation and re-type; detaching a field keeps stored values."

**The required checkbox** is the CTA-filled 16px box the frame draws (checked: `cta` fill, white check; unchecked: `bg-raised`, default border), a Radix checkbox with its hit area expanded to DES-011's 24px floor without growing the drawn box.

**Attach** is a footer-row secondary button ("Attach field", `plus` glyph) opening a menu of the catalog's live, unattached fields for this module's scopes, each with the same name-plus-caption line as the rows. Choosing one attaches immediately (SET-003), optional by default.

### Recorded normalization points (ST16 deviations accepted)

1. The frame's 14px glyphs (grip, arrow, plus) render at 16 — DES-008's ramp floors at 16. The 12px check inside the 16px checkbox stays: control-internal, not a standalone icon.
2. Buttons render through the shipped Button component (DES-004's normalization), not the frame's 12px text.
3. ST16 draws no attach picker; the menu is this record's addition — creation here is one choice, so a menu, not a dialog (DES-021's dialog rule is for multi-dimension creation).
4. ST16 draws no empty state; an empty attachment list renders one quiet caption row.

### Rationale

The list row stays one line only because this screen exists; writing its anatomy with the first implementation keeps ST14/ST15 from re-deriving it — the same bet DES-020 and DES-021 made, one screen shape later.

### Consequences

`/settings/contracts/types/:id` (#84) is the reference implementation, reached from a pencil icon button in the list row's trailing actions (the DES-021 slot; here it navigates instead of opening a dialog, because the editor is a screen). The M19 Request editor and M22 Matter editor reused this shape with their own vocabulary.

### Amendment (2026-08-20, [#354](https://github.com/juggernog20/OpenLaw/issues/354)) — both cards are optional slots, not fixed furniture

The request-type editor (frame ST14) mounts this screen and diverges from it twice, in both directions. Neither is a new shape; both are this shape with a slot filled or left empty.

**The right card is optional.** A mount with no form definition ships as the identity card alone; ST14 has one, so it draws the Form fields card. A screen with one card is not a broken two-card screen: it is the same layout with nothing in the second slot, and the card lands when the mount has something to put there.

**The identity card takes one more control.** ST14 draws a Target select and its help line under the slug — one native select, options grouped by module ("No target"; Matter, then each live matter type; Contract, then each live contract type), an 11px `text-secondary` help line stating what conversion will do with the chosen state, and a `status-warning` line flagging a target whose type has since been archived. It commits on pick (SET-003) with its own micro-state beside the control, because it writes the mount's own column rather than the shared identity.

**The usage caption is optional too**, for the reason DES-020's is: a mount whose records do not exist yet has nothing but a zero to print. Request types draw none until `requests` land in M20.

## DES-023: The comment surface — tier badges, the Legal Only row wash, and the segmented composer

- **Status:** Accepted
- **Date:** 2026-08-13

### Context

CMT-003 decided the comment surface's treatments in words. Every row wears a tier badge. Legal Only rows get "tinted background + the DES-009 lock glyph". The composer is a three-segment control. CMT-003 also named the design-system addition those treatments need, and this doc has carried "comment-tier UI per DD-016" on its out-of-scope list ever since, to be answered "when the comment composer / thread screens are mocked". They are mocked, and M9/2 (#128) builds them. This record is that answer.

DES-016's implementation clarification governs the bar and the panel chrome, taken from the matter-detail frames (M3, comments open). What sits **inside** the panel is not in that clarification. The frame that draws it for this module is `designs/contracts.pen` **C3 — Contract detail · Comments panel**: the thread rows, the tier badge, and the composer. C3 is the reference below. Where C3 and M3 disagree about the 44px header or the 48px bar, M3 still wins.

### Decision

The panel is the DES-016 chat applet, and its content is three parts.

**The header accessory.** The 44px panel header is chrome (DES-016). What sits beside its title belongs to the applet. The chat applet puts a neutral count pill there: `bg-badge-count-bg` / `text-badge-count-fg`, 11px semibold, `rounded-pill`. It counts the rows on screen. It can never count a row the viewer may not see. That row was filtered out at query time and is not in the client at all (DD-016).

**The comment row.** 12px vertical and 16px horizontal padding, with a `border-muted` rule between rows. Two lines. The header carries a 24px avatar, the author's name (12px semibold), the tier badge, and the timestamp (11px, `text-muted`) pushed to the trailing edge. The body follows at 12px in `text-primary`, with newlines preserved, because they are the author's.

**The tier badge.** Every row wears one. Three tiers, two treatments. Working Team and Full Thread take the neutral counter pair on a `rounded-chip`. **Legal Only takes DES-009's own pair**, `bg-confidential-bg` / `text-confidential`, with the DES-009 `Lock` glyph ahead of the label.

**The Legal Only row wash — a new token, `--legal-only-bg`.** The row itself is tinted, so the tier reads peripherally. That is the whole point of CMT-003. The wash cannot borrow `--confidential-bg`: that is the banner surface, and the badge on the row already uses it, so the two would cancel. It takes its own value instead, one step lighter than the banner and in the same per-theme hue family — soft lavender in Light and Dark, soft tan in Warm, following DES-009's per-theme divergence. Light `#FAF3FE`, Warm `#F6EFE3`, Dark `#1E1826`. The DES-011 gate covers `--text-primary` and `--text-muted` on it in all three themes.

**The composer.** A segmented tier control, then the box, then the audience line, then the action:

- **The segments** are native radios in a `fieldset` labelled "Audience". That makes them one group, arrow-key navigable for free. They are drawn as a `bg-control` track with a 2px inset, each segment `rounded-chip` at 11px. The selected segment lifts onto `bg-raised` with a `border-muted` hairline and goes semibold. The rest are `text-muted` medium. The Legal Only segment carries the same lock glyph its badge does.
- **The segment set is the viewer's rooms, not all three.** A Contributor's composer has two segments; Legal Only is absent, not disabled — the convention the nav and the settings rail already follow. The seam refuses the tier regardless.
- **The preset is Working Team on a record page** (DD-016). The request thread's composer presets to Full Thread and lands with the portal.
- **The audience line** sits under the box in 11px `text-muted`. It names, in words, who the selected segment means. It changes with the selection, and it is there before the post. DD-016's failure mode is saying something in the wrong room, and that safety must not depend on reading a badge afterwards.
- **The action** is the shipped primary Button, labelled with the verb "Comment", disabled while the box is empty or a post is in flight.

### Recorded normalization points (C3 deviations accepted)

1. **The lock renders at 12px**, not DES-008's 16/20/24 ramp. DES-009 sets its own 12–14px range for this glyph, and inside an 11px badge a 16px lock is taller than the text it marks. The frame draws 9–10px; 12 is the floor of DES-009's range.
2. **The composer draws two segments in C3** ("Everyone" / "Legal only"). Three is what DD-016 decided, and the labels are DD-016's own audience names: "Legal only", "Working team", "Full thread".
3. **The frame's audience line carries an `eye` glyph.** It is dropped — a 12px eye is off both ramps, and the line reads as a sentence without it.
4. **The frame tints Legal Only rows `#FFF8F6`,** a warm wash unrelated to the confidentiality family. The token above is in the family instead, so the two Legal-Only-ish markers in the product rhyme rather than clash.
5. **The frame's green submit** is the shipped Button's `cta-primary`, per DES-004's normalization.
6. **Vertical padding of 3px in the segments rounds to 4** (DES-007's scale).

**Mock sweep (2026-08-13, #134):** the milestone close swept the shipped panel against both comment frames — `designs/matters.pen` **M3** and `designs/contracts.pen` **C3**. The Pencil canvas moved between files this time, so both were read rather than one. The two frames agree with each other everywhere this record touches, and points 1 to 6 hold against M3 exactly as they were written against C3, including the `#FFF8F6` wash, which is a named `legal-only-bg` variable in both files. Six further deviations came out of the sweep, all accepted:

7. **Both frames badge only the Legal Only rows.** The other two authors carry a name and a timestamp and no tier at all. Every row wears a badge in the build, which is CMT-003's own wording. A thread that marks only the restricted rows leaves the other two indistinguishable, and Working Team and Full Thread are different rooms.
8. **Both frames name the author's role beside their name** — "Dana Cruz · requester", 11px `text-muted`. It is dropped. A role is a fact about the person and it changes; the tier badge is the fact about the comment and it cannot. Two muted strings between the name and the timestamp also crowd a 320px row that now carries a tier label on every line rather than on some.
9. **Both frames put the audience line and the submit on one foot row**, the sentence at the leading edge and the button at the trailing one. The build stacks them: the audience line runs full width under the box, then the mention chips, then the button on its own row. "Visible to everyone on this record, including the requester" does not fit beside a button in 320px, and DD-016 wants that line read rather than truncated.
10. **The count pill is `control` / `text-secondary` in both frames.** The build uses the `badge-count` pair, per the Decision above. One counter pair serves every count in the product, and the pill in a panel header is not a different kind of number from the one on a nav item.
11. **Neither frame's selected segment carries a border.** The build adds the `border-muted` hairline: `bg-raised` (`#FFFFFF`) on `bg-control` (`#F6F8FA`) is a three-percent step in Light and does not read as a lift on its own.
12. **The badge label is 10px in both frames**, and 11px (`text-xs`) in the build — DES-006's floor, the same normalization DES-016 took for the activity bar's count.

### Rationale

CMT-003 already judged the tier badge alone insufficient. The reason is the whole DD-016 risk: a Legal Only comment read as a Working Team one is a leak of legal strategy. A wash is read without being looked at. A badge is not. Giving the wash its own token, rather than borrowing the banner's, is the argument DES-009 made for not borrowing a status pill's — one token per role, so a later shift in one does not silently move the other.

Native radios cost nothing to make keyboard-accessible, because DES-010 leans on built-ins. They also announce as one choice rather than as three buttons. A handrolled toolbar would buy neither.

### Alternatives considered

- **Borrow `--confidential-bg` for the row.** Rejected: the badge on the row already uses it, and `--text-muted` on it misses 4.5:1 in Light and Warm.
- **Legal Only badge on `bg-raised`, row on `--confidential-bg`.** Works, but inverts the frame — a chip lighter than its row — and still leaves the row heavier than a wash should be.
- **A leading-edge stripe instead of a wash.** Rejected for the reason DES-009 rejected it for the banner: it reads as decoration rather than restriction.
- **A `select` for the tier.** Rejected: DD-016 wants one deliberate act with all the options visible; a closed select hides two of the three rooms behind a click.

### Consequences

`--legal-only-bg` joins the DES-005 token system. It is registered in `styles/globals.css` `@theme` as `--color-legal-only-bg`, valued in all three theme files, and gated in `styles/lint-contrast.mjs` against `--text-primary` and `--text-muted`. `PanelApplet` gains an optional `accessory` slot, so an applet can put content in the panel header. DES-016's implementation clarification, point 5, anticipated exactly that. The panel is entity-generic: matters (M22) and documents (M11) mount the same component. The mention chips (M9/3) and the edited marker and tombstone (M9/4) extend this anatomy rather than replacing it.

## DES-024: The mention affordances — typeahead, chip, and the promotion confirmation (extends DES-023)

- **Status:** Accepted
- **Date:** 2026-08-13

### Context

DES-023 drew the comment surface from `designs/contracts.pen` **C3 — Contract detail · Comments panel**. C3 draws no mention affordance at all: the composer is a two-segment control, a box, an audience line, and a submit. M9/3 (#129) adds the `@`-typeahead, the mention chip, and the promotion confirmation, and none of them has a frame. This record supplies the anatomy, in DES-023's own terms.

### Decision

**The typeahead is a listbox the composer's box drives, not a combobox.** The counterparty picker and the DES-014 timezone picker are hand-rolled comboboxes on an `input`. This one cannot be: ARIA in HTML permits no role on a `textarea` other than its implicit `textbox`, so `role="combobox"` and `aria-expanded` are both out. The inline-mention pattern uses what `textbox` does support.

- The composer's textarea keeps its own role and takes `aria-autocomplete="list"`, `aria-controls`, and `aria-activedescendant` — all three are supported on `textbox`. The list is a sibling `ul role="listbox"`, labelled "People you can mention".
- **A polite live region replaces `aria-expanded`.** With the list open it says how many people match and that the arrow keys choose one. Without it, a screen-reader user typing `@` would get the active-row announcements with no account of where they came from.
- The list **opens above the box**, not below it. The composer sits at the foot of the panel, so a list drawn downward would leave the panel.
- The list is DES-020's option chrome: `rounded-card` on `bg-raised` with the default border, rows at 12px `text-primary`, the active row on `bg-control`. Each row carries a 20px avatar (DES-018) ahead of the name.
- Keys: Arrow walks, Enter and Tab pick, Escape closes locally (DES-010). Enter with the list open never posts a half-written comment.

**The mention chip** is the neutral counter pair, `bg-badge-count-bg` / `text-badge-count-fg`, on a `rounded-chip`. It carries the person's name and nothing else — no avatar, no `@`-prefixed style, and no link colour, because a mention is a person and not a destination.

- **In a posted comment** the chip is inline in the body, drawn wherever a name on the comment's mention list appears in the text (CMT-007). The rest of the sentence is the author's plain text.
- **In the composer** the picked people sit in their own chip row under the box, labelled "Mentioned". Each chip carries a remove control: a 12px Lucide `X` on a 24×24 hit target, which is DES-011's floor, so the glyph carries padding rather than being the target itself. The lock in DES-023's badge is the precedent for a sub-16px glyph inside a chip.

**The promotion confirmation** is the shipped Dialog (DES-004), not a popover or an inline banner. It has a title, the sentence that names who cannot hear the comment and the tier that would reach them, the audience line for that tier in the composer's own words, and two buttons: "Cancel" (secondary) and "Widen and post" (primary).

- The title is a question — "Widen the audience?" — because the dialog asks for a decision rather than reports a fact.
- The tier names inside the sentence are the DD-016 audience labels, lowercased into the prose. The button says what the confirm does, not which tier it does it at; the sentence above it already said the tier.
- Cancelling restores nothing, because nothing was taken: the composer keeps its text, its mentions, and its selected segment.

### Recorded normalization points

1. **C3 draws none of this.** Every element above is an addition, built from the components DES-023 already named rather than from a frame.
2. **The typeahead is not the app's combobox pattern**, for the ARIA reason above. It keeps that pattern's keyboard model — Arrow, Enter, Tab, Escape — and swaps `aria-expanded` for a live region. The box's accessible name stays "New comment", and its role stays `textbox`.

### Rationale

The mention is the one place in the comment surface where the composer has to offer a choice while the author is mid-sentence. Everything else about the panel is a control you touch before you write. Keeping the combobox pattern's keyboard model means the keys are ones the app already teaches, even though the role is not the same one; the list-above placement is forced by where the composer sits.

The chip is neutral rather than accented for the same reason the tier badge's two wider tiers are: an accented chip would compete with the Legal Only pair that DES-023 reserved for the one thing that must be read peripherally.

The dialog is the modal because the question stops a post. DD-016's failure mode is saying something in the wrong room; a dismissible popover next to a submit button is not the shape of a question you must answer.

### Alternatives considered

- **A `contenteditable` composer with real inline chips.** Rejected: it buys a truer chip and costs the plain-text body (CMT-007), the textarea's native keyboard model, and a large accessibility surface with no frame to build it against.
- **An inline warning strip instead of a dialog.** Rejected: the post is stopped either way, and a strip that stops a submit without taking focus reads as a bug.
- **Naming the promoted tier on the confirm button** ("Post at working team"). Rejected as a phrase where DES-015 wants a verb; the sentence above the button already names the tier.
- **Loading the candidate list on the first `@`.** Rejected: the list is one working group, so it rides down with the thread and the typeahead is instant at the moment somebody is being addressed.

### Consequences

The composer's box stays a textbox, so nothing that finds it today stops finding it. The chip row is a derived view of the draft: a name deleted from the box drops its mention, and a chip removed deletes the name, so the text and the list can never disagree. Matters (M22) and documents (M11) inherit all of this by mounting the same panel. M9/4's edited marker and tombstone extend the row anatomy DES-023 set, beside the chips this record adds.

## DES-025: The corrected comment row — the edited marker, the two tombstones, and the row's overflow menu (extends DES-023)

- **Status:** Accepted
- **Date:** 2026-08-13

### Context

DES-023 drew the comment row from `designs/contracts.pen` **C3 — Contract detail · Comments panel**: avatar, name, tier badge, timestamp, then the body. DES-024's consequences already flagged what comes next — "M9/4's edited marker and tombstone extend the row anatomy DES-023 set". M9/4 (#130) builds the three corrections CMT-005 and CMT-008 name, and C3 draws none of them: no edited marker, no tombstone, and no affordance for edit, delete, or redact. This record supplies that anatomy, in DES-023's own terms.

### Decision

**The edited marker rides beside the timestamp**, at the row header's trailing edge. It is the word "edited" at 11px `text-muted`, matching the timestamp it sits next to, with the edit time as its `title`. It is metadata about the row, so it takes the row's metadata treatment rather than a badge of its own — a second pill beside the tier badge would compete with the one thing DES-023 reserved for peripheral reading. It is drawn only while there is text to have been edited; a tombstone saying "edited" reports on nothing.

**The trailing group.** The header's trailing edge becomes one `ms-auto` flex group at `gap-1.5`: the edited marker, then the timestamp, then the overflow trigger. Everything ahead of it — avatar, name, badge — is unchanged.

**Two tombstones, and they say which hand removed the comment.** A removed row keeps its place in the thread and swaps its body for one sentence at 12px `text-muted` italic:

- Deleted by its author — "Comment deleted by its author."
- Removed by an Administrator — "Comment removed by an Administrator."

Italic and `text-muted` because the sentence is the surface's, not the author's; every other body in the panel is somebody's own words in `text-primary`. Where both happened, the redaction sentence wins: it is the later act and the one that took the text away for good. A tombstone keeps its tier badge and its wash, because it is still the comment it stands for and it reaches the audience that comment reached (CMT-008).

**The overflow menu** is the shipped DropdownMenu (DES-004) on a `ghost` `icon` Button carrying the 16px Lucide `MoreHorizontal`, accessible name "Comment actions". Items are 16px glyph plus verb: `Pencil` "Edit", `Trash2` "Delete", `Eraser` "Redact".

- **The menu offers what this viewer may do and nothing else** — absent, not disabled, the convention the nav, the settings rail, and DES-023's composer segments already follow. A row with nothing on offer draws no trigger at all, so a Contributor reading somebody else's comment sees a clean row. The seam refuses each action regardless; the menu is a courtesy.
- Edit and Delete appear for the author of a live comment. Redact appears for an Administrator on any comment not already redacted — including one the author soft-deleted, which is the case the redact exists for.

**The edit box replaces the body in place.** The row's own textarea (the composer's `TEXTAREA_CLASS`), seeded with the text as it stands, accessible name "Edit comment", focused on open because the viewer just asked to type. Under it, "Cancel" (secondary) and "Save" (primary), both `sm`. Escape cancels locally, as DES-010 reserves the key for. Cancel restores nothing, because nothing was taken. It carries no mention typeahead: an edit changes the text and not who the comment addressed (CMT-008).

**Both removals take the shipped Dialog** (DES-004), following DES-024's promotion confirmation. Each has a question for a title, one sentence of consequence, then "Cancel" (secondary) and the verb on a `danger` Button. Neither can be undone and each says so. A refusal closes the dialog and puts the reason on the row, where the unchanged text is still on screen.

### Recorded normalization points

1. **C3 draws none of this.** Every element above is an addition, built from components DES-023 and DES-024 already named rather than from a frame.
2. **No typed confirmation.** DOC-010's hard-delete pattern asks the Administrator to type the name of what they are destroying. That is proportionate to a whole document with all its versions; it is not proportionate to one comment. The dialog names the consequence and takes one click.
3. **The tombstone is italic**, which no other body text in the product is. It is the one place the panel speaks in its own voice inside a row of somebody else's words.

### Rationale

The row already carries three pieces of metadata at its trailing edge before anything is added, so the marker joins them rather than opening a fourth region. The two tombstones are two sentences because they are two facts, and after a redact the row is the only place either fact can be read — the body is gone. The overflow menu is the pattern because three actions on a dense 12px row have nowhere to sit inline, and Radix carries the keyboard model for free.

### Alternatives considered

- **Inline Edit and Delete links on hover.** Rejected: a hover-only affordance is not reachable by keyboard without extra work the menu already does, and the row is 12px dense with the trailing group already occupied.
- **One tombstone sentence for both removals.** Rejected: it reads an Administrator's removal as the author's own, which CMT-008 rejects for the same reason.
- **Keeping the tier badge off a tombstone.** Rejected: the row still reaches exactly the audience the comment reached, and dropping the badge would suggest otherwise.
- **A typed confirmation on redact**, per DOC-010. Rejected as disproportionate for a single comment; see the normalization point above.

### Consequences

The row anatomy is now complete for M9. Matters (M22) and documents (M11) inherit it by mounting the same panel. The applet takes the viewer's id alongside their role, because "is this yours" is a per-row question the panel cannot answer from a role. M9/6's activity feed renders a redacted comment's entry as a redacted comment (CMT-006), and it will need the same two-sentence distinction the row draws here.

## DES-026: The history panel interior — the narrated row, the medallion, and the load-more foot (extends DES-016)

- **Status:** Accepted
- **Date:** 2026-08-13

### Context

DES-016's implementation clarification governs the activity bar and the 44px panel header, taken from the matter-detail frames. What sits **inside** the history panel is not in that clarification, and DES-023 answered the same question for the chat panel. M9/6 (#132) builds the history applet, so this record is the other half of that answer.

The clarification names `designs/matters.pen` **M13 (history open)** as the interior reference. The Pencil canvas would not move off `designs/contracts.pen`, exactly as it would not for DES-023. The frame that draws this panel for this module is `designs/contracts.pen` **C15 — Contract detail · History panel open**, and C15 is the reference below. Where C15 and M13 disagree about the 44px header or the 48px bar, M13 still wins — the same substitution DES-023 recorded, for the same reason.

### Decision

The panel is the DES-016 history applet, and its content is two parts.

**The entry row.** 10px vertical and 16px horizontal padding, with a `border-muted` rule between rows and none under the last. A 10px gap between the medallion and the text. Two parts side by side.

- **The medallion** is a 24px `rounded-pill` on `bg-control`, carrying the action family's Lucide glyph in `text-muted`. The glyph is the family's, not the entry's: people for a team change, a commit mark for a status move, a pencil for an edit, a message for the conversation, a box for an archive. A slug the narration does not recognise takes the neutral `Activity` glyph rather than none.
- **The text column** is the sentence, then any change lines, then the timestamp. The sentence is 12px `text-primary` at a 1.4 line height, and it wraps rather than truncating — an account of what happened is not a label. Change lines and the timestamp are 11px `text-muted`.

**The change line.** A field edit says what the value was and what it became, as `from → to`, rendered through the same formatters the record page uses (DES-014). One change is already named by the sentence above it, so its line is the pair alone; several are counted in the sentence and carry their labels on their own lines, because that is the only thing telling them apart.

**The load-more foot.** The feed is paged (DD-017's implementation clarification), so the list ends in a secondary Button labelled "Show older" whenever a further page exists, and in nothing when it does not. The panel scrolls; the foot scrolls with it.

**No badge and no header accessory.** Chat is the only applet that carries a badge (CMT-004), and a count of entries on screen would say nothing a reader wants — the feed is read, not counted.

### Recorded normalization points (C15 deviations accepted)

1. **The reference frame is C15, not M13.** The canvas would not switch files. C15 draws this module's own history panel with the same anatomy; M13 still governs the bar and the header.
2. **The medallion glyph renders at 16px**, not C15's 12px. DES-008's ramp floors at 16, and 16 inside a 24px circle still leaves 4px on each side. DES-009's 12–14px carve-out is for the lock alone, and this is not that glyph.
3. **The timestamp is the DES-014 activity-feed rule**, not C15's "Aug 3, 10:12 AM". The frame draws one fixed short-absolute-with-time format; DES-014 decided relative inside a week and short absolute after, with the long absolute and its timezone in the tooltip. The decision wins over the frame's illustrative label.
4. **The sentences are the narration layer's, not the frame's.** C15 illustrates with actions this milestone does not have — a document upload, an AI analysis, a linked record. The rows drawn are the anatomy; the copy for each action family lives in `apps/web/src/lib/activity.ts`.
5. **The frame draws no load-more foot**, because it draws a short feed. Paging is DD-017's decision, and the foot is what it needs.
6. **Rows carry no tier badge.** The comment row wears one because a reader has to know which room a comment was said in (CMT-003). A feed entry's tier is the record's own policy rather than a choice its actor made, so a badge on every row would be noise repeated down the panel.

**Mock sweep (2026-08-13, #134):** the milestone close opened `designs/matters.pen` and swept the shipped panel against **M13** directly. The substitution recorded in point 1 was harmless: M13 draws the same anatomy C15 does, medallion included — a 24px frame on `control` at radius 12, carrying a 12px `text-secondary` glyph, then a text column of sentence over timestamp. Points 2 to 6 hold against M13 word for word, including the 12px glyph, the fixed absolute timestamp, and the absence of both a tier badge and a load-more foot. **Point 1 is confirmed rather than superseded:** the canvas does move between files, so the reason it gives is wrong, but the frame it substituted was the right one and nothing built on it needs changing. No further deviation came out of the sweep.

### Rationale

The medallion is what makes the feed scannable without reading it: the eye finds the status moves in a column of sentences by their glyph, which is the whole reason C15 draws one. Giving the change its own line, rather than folding it into the sentence, is what lets one entry carry several changes — the record's PATCH commits per field (DES-017), but a re-type moves several at once, and a sentence cannot hold them all and stay a sentence.

Naming a single change in the sentence and dropping its label from the line below avoids the one thing a uniform rule would produce: "Nadia Counsel changed the status" over "Status: Draft → Internal review", which says "status" twice in nine words.

### Alternatives considered

- **One sentence per entry, changes folded in** (C15's own "changed status Draft → Internal review"). Works for one change; breaks for three, which the record's re-type path produces routinely.
- **A tier badge on every row**, as DES-023 puts one on every comment. Rejected — see normalization point 6.
- **Infinite scroll instead of a foot.** Rejected: DES-010 wants keyboard-reachable affordances, and a scroll sentinel is not one.
- **A count pill in the panel header**, mirroring chat's. Rejected: the feed is paged, so the number would count the pages read rather than the record's history, and a number that means "what you have loaded" is worse than none.

### Consequences

No new tokens: the row is `bg-control`, `border-muted`, `text-primary`, and `text-muted`, all already valued and gated. The applet is `apps/web/src/components/activity/activity-applet.tsx`, entity-generic and keyed by an entity reference, so matters (M22) and documents (M11) mount it rather than reimplementing it. It takes two catalogs from its mount, because the log carries neither: the type's attached fields, because a `field.<slug>` change key is a slug and not a name, and display names for the ids CTR-016's `user` and `entity` kinds store. The record's own Owner and signing entity need no lookup — M8 wrote those into the payload as names precisely so this layer would not have to. Everything the catalogs do not cover falls back to what the log stored, which is the honest rendering for a field since detached or a person since deleted. The Administrator's audit log (M9/7) draws its own table but narrates through the same layer, so a slug reads the same in both surfaces.

## DES-027: The audit-log pane — the filter bar, the narrated table row, and the export foot (extends DES-021, DES-026)

- **Status:** Accepted
- **Date:** 2026-08-13

### Context

DES-026 drew the record's history panel: a narrated row on a medallion, change lines under the sentence, and a load-more foot. M9/7 (#133) builds the second reader of the same table — the Administrator's audit log in the Security group of `/settings` (DD-017, SET-002). It is not a panel beside a record. It is a settings pane that reads the whole log, filters it five ways, pages it, and exports it, so it needs anatomy the panel does not have: a filter bar, columns, and an export.

The reference is the settings frames in `designs/settings.pen`. The Pencil canvas would not move off `designs/contracts.pen`, exactly as it would not for DES-023 and DES-026. This record is therefore built from the written pattern rather than from a frame: DES-021's table variant for the columns, the Users pane (ST5, shipped) for a settings table's chrome, DES-026 for what one entry looks like, and DES-023 for the audience badge.

### Decision

The pane is one flush settings card with three parts.

**The filter bar** sits inside the card, above the column strip, on a `border-default` rule at 12px vertical and 16px horizontal padding. It is a `role="search"` region named "Narrow the audit log", holding six labelled controls that wrap: Person (a select of every user), Action (a select of the slugs the log actually holds), Record (a select of the entity types), From and To (native date inputs), and Search (a `type="search"` input). Each label is visible at 11px semibold `text-muted` above its control — six controls in a row have to be named, and a placeholder disappears the moment somebody uses it. A ghost "Clear filters" closes the row.

- **The filters compose, and the pane never layers them by hand.** Every read carries the whole set. What is on screen is the answer to one question.
- **Search is debounced; the rest apply immediately.** Typing a word is one request; picking from a select is one gesture and one answer.
- **The action vocabulary comes from the table, not from the code.** The log outlives the code that wrote it, so the filter offers the slugs that are in there.
- **Dates are the reader's own days.** A date input answers a calendar date; the pane converts it to the first and last instants of that day in the reader's timezone (DES-014), so "August" is their August.

**The entry row** is a table row under DES-021's column strip: Event, Record, Audience, When.

- **Event** is DES-026's narrated row, unchanged in substance: a 24px `rounded-pill` medallion on `bg-control` carrying the action family's 16px glyph, then the sentence at 12px `text-primary`, then the change lines at 11px `text-muted`. Every change line carries its label here, where the panel drops it for a single change — a table row is scanned in a column of unrelated actions, so "Role: Contributor → Legal team member" has to say which key it is about.
- **Record** names the entity type and, under it, the entity id at 11px `text-muted`. The id is what an auditor quotes back, so it is on screen and not only in the export.
- **Audience** carries a badge, where DES-026 deliberately carries none. The reason DES-026 dropped it does not hold here: on a record feed the tier is the record's own policy repeated down the panel, but this surface shows four tiers at once and the tier is one of the things being audited.
- **When** is DES-014's activity-feed rule, as the panel uses it: relative inside a week, short absolute after, long absolute with its timezone in the tooltip.

**The audience badge** extends DES-023's rule by one tier. The two restricted rooms — Legal Only and Administrators — take DES-009's `bg-confidential-bg` / `text-confidential` pair with the 12px `Lock` ahead of the label; the two wider ones take the neutral counter pair. The label is what tells the restricted two apart; the treatment is what makes either read as restricted without being looked at.

**The export is a link, not a button.** It streams a set of unknown length, so the browser's own download is the right client for it. It sits in the card's header strip as a secondary Button rendered as an `<a download>` carrying the 16px `Download` glyph, and its href carries the filters on screen — what downloads is what is being looked at.

**The foot** is DES-026's: a secondary "Show older" whenever a further page exists, and nothing when it does not. No total anywhere, for the reason the record feed has none — one paging convention, not two.

### Recorded normalization points

1. **The reference frames could not be opened.** `designs/settings.pen` is not the active Pencil canvas and the canvas would not switch files — the third time this milestone (DES-023, DES-026). The pane is built from DES-021's table variant, DES-026's row, DES-023's badge, and the shipped Users pane, all of which are ratified against those frames already. A frame for this pane, when one can be opened, governs the chrome; the anatomy above is the decision.
2. **Change lines always carry their label.** DES-026 drops the label for a single change, because the sentence above it already named the key. In a table of every action in the system, the sentence often does not — "changed the organization settings" names no field — so the label stays.
3. **The row wears an audience badge**, against DES-026's normalization point 6. See the Audience clause above for why the reason does not carry over.
4. **The filter controls are native `select` and `input`**, through the shared `CONTROL_CLASS` treatment (the C10 field spec), not hand-rolled comboboxes. A picker over a fixed list of a dozen options is what a native select is for, and DES-010 leans on built-ins.

**Mock sweep (2026-08-13, #134):** the milestone close opened `designs/settings.pen` and swept it for the frames this record was waiting on. ~~Point 1's reason is wrong~~ — **superseded**: the canvas does move between files. The right reason is simpler and it does not expire. **`designs/settings.pen` holds no audit-log frame.** Its eighteen screens run from ST1 to ST19, and the Security group appears only in ST17 (Authentication) and ST18 (OIDC); ST17 draws the rail with Authentication alone under Security, so the pane's own rail item is unmocked too. The pane is therefore built from the written pattern by necessity and not by workaround, exactly as the Context says: DES-021's table variant, DES-026's row, DES-023's badge, and ST5's settings-table chrome, which was read in the same sweep and which the pane follows apart from the filter bar the Rationale already accounts for. Points 2 to 4 are unaffected. A frame drawn for this pane later governs its chrome; the anatomy above remains the decision.

### Rationale

The audit log and the record feed read one table and must say the same thing about a row, which is why they share the narration layer and not the surface. What differs is the question each answers: a feed answers "what happened to this record", and its reader already knows the record, the room, and roughly when. An auditor knows none of those, which is exactly what the three columns after the sentence supply.

Putting the filter bar inside the card rather than in its header strip is the one place this pane leaves the Users pane's shape. Six controls do not fit a 44px strip, and a filter bar floating above the card would read as page furniture rather than as part of the table it narrows.

### Alternatives considered

- **A list, as the history panel draws one.** Rejected: without columns, the entity type, the tier, and the timestamp all have to go into the sentence or under it, and the row stops being scannable at exactly the volume this surface exists for.
- **Filters in the URL**, so a narrowed log is a link. Attractive, and deferred rather than rejected — it wants the loader to own the filters, which is a larger change than this ticket, and nothing else in settings is deep-linkable past its pane.
- **A distinct treatment for the Administrators tier**, separate from Legal Only's. Rejected: that is a third badge treatment and a token to go with it, where the label already distinguishes them and the shared treatment carries the thing a reader must not miss.
- **Fetching the export and offering a blob.** Rejected: it holds the whole export in memory on the client, which is the one thing streaming it was for.

### Consequences

`apps/web/src/routes/settings-audit-log.tsx` is the pane. No new tokens: the row is `bg-control`, `border-muted`, `border-default`, `text-primary`, and `text-muted`, and the badge reuses the confidential and counter pairs, all already valued and gated. `lib/format.ts` gains `dayBounds`, which turns a civil date into the two instants it covers in the reader's timezone — the first surface to filter on a date range, and not the last. `lib/roles.ts` gains the role wording that the Users pane, the wizard, and the Profile pane each held a copy of, because the narration is the fourth reader of it. The narration layer's entry type is now structural rather than the record feed's response shape, so both surfaces narrate the same rows without either converting for the other.

## DES-028: The confidential record page — the Tier 2 banner and the flag control (extends DES-009)

- **Status:** Accepted
- **Date:** 2026-08-14

### Context

DES-009 committed to three affordance tiers for a confidential record and drew Tier 2 in words: a 36px persistent banner between the top nav and the sub-bar, on the `--confidential-bg` / `--confidential-fg` pair, carrying the `Lock` glyph, its copy, and a trailing "Manage team →" link for the people who may change the audience. M10/4 (#148) builds it, and builds the control that sets and clears the flag on the record.

Two frames of `designs/contracts.pen` cover the work. **C8 — Contract detail · Confidential** draws the banner as `S8 ConfBanner`, stacked exactly where DES-009 puts it. **C10 — Create contract modal** draws the flag control as `S10 ConfToggle`: a switch, a lock, a label, and a caption. Neither frame draws a flag control on the record page itself, so that surface takes C10's anatomy and DES-017's commit rule.

The mocks predate two decisions that changed what is true about a confidential contract. CTR-022 put the Owner in the access set and the actor set; CMT-007 superseded DES-009's Tier-3 add-as-watcher grant. The copy below is written against the product as decided, not as first drawn.

### Decision

**The banner is a slot on the application shell**, between the nav and the sub-bar, filled by the page that knows the record is confidential. It is chrome: the component takes no dismiss prop, so a caller cannot add one, and nothing on the strip is a button.

- Height `--height-confidential-banner`, background `bg-confidential-bg`, foreground `text-confidential`, a bottom rule in `border-default` to match the sub-bar's separation, and `px-page-x` gutters. _(The height token was renamed `--height-record-banner` with M16/4, when DES-043 put a second banner in the same strip. Same 36px measure, one name.)_
- A 16px `Lock`, then the statement at 12px medium, left-aligned; the trailing link at 12px semibold, right-aligned.
- It is a labelled region, so the statement stays reachable from the landmark list after half an hour inside the record — the same persistence the strip gives a sighted reader.

**The trailing link is gated to the three actors** — an Administrator, the `creator` team row, and the Owner (DD-014, CTR-022) — and it is a fragment that opens the Team applet (DES-047). Changing the audience is changing the roster, so "one step from the reminder" is one anchor, not a route that does not exist.

**The flag control is a field of the record**, in the Contract card, spanning both columns and closing it: it is the record's audience rather than one of its business facts.

- It commits on the switch's own change. A switch has no blur to wait for, and DES-017 commits when the person is done deciding — which for a two-state control is the moment they flip it, the same rule the record's selects already follow. The field's micro-state sits beside the label.
- **Inert is a real state, and on this control it is the common one.** Every included viewer reads the audience; only the three actors may change it. The switch, its label, and its caption all stay when it is inert. A control that vanished would leave the reader unable to tell a confidential record from an open one on this card, which is the opposite of what DES-009 exists for.
- The gate is the client-side twin of the API's `confidentialityWrite`, read from the two facts the record already answers — the roster and the Owner. The server is the authority; this only keeps a control from offering a dead end.

**One component serves both surfaces.** The create dialog and the record's Contract card ask the same question, and they ask it in the same words from the same component, so the second cannot drift from the first.

### Recorded normalization points

1. **The trailing link reads "Manage team", not the mock's "Manage access".** DES-009, the M10 spec, and CONTEXT.md all call the thing a team; "access" names no surface in this product.
2. **The arrow is a 16px Lucide `ArrowRight`, not the "→" character.** DES-009 writes the arrow into the copy and DES-008 forbids character glyphs; a Lucide arrow satisfies both. The C8 frame draws no arrow at all.
3. **The banner's lock is 16px** where the C8 frame draws 14. DES-009's own banner layout says 16, and DES-008's ramp floors there. The 12px carve-out is for the badges and the inline marker, where a 16px lock is taller than the text it marks; a 36px strip has the room.
4. **The banner carries a bottom rule** in `border-default`, which the C8 frame omits and DES-009 specifies.
5. **The banner copy names the whole audience**: "Confidential contract — the contract team, the Owner, and Administrators see it." The frame's "visible to the contract team only" was true when it was drawn and is not now — CTR-022 put the Owner in the access set, and DD-014 always kept Administrators there. A reminder that misstates who can see the record is worse than none.
6. **The control's caption is rewritten** from the C10 frame's "Hidden from shared lists and reports." There are no reports, and the caption has to say what setting the flag actually does: the record, its comments, and its history leave everyone outside the team.
7. **No confidential chip is drawn beside the record's own title**, where the C8 frame draws `S8 ConfChip` in the sub-bar. DES-009 scopes Tier 1 to "wherever the title appears **outside** the record's own detail page", and the banner 36px above already carries the statement. The list row's marker is unaffected and lands with M10/5.

### Rationale

Putting the banner in the shell rather than at the top of the page body is what makes it chrome. The record's body scrolls; the strip must not, and a component that lives above the scroll container cannot be scrolled off by accident.

Making the flag a field of the record, rather than an action in the sub-bar or an item in an overflow menu, follows from DES-017: it is one column of the record, it commits on its own, and it is logged like every other field commit. It also puts the audience on the same card as the facts it governs, where somebody reading the record meets it without going looking.

Keeping the control visible-but-inert for the viewers who may not use it is the one place this record departs from the "absent, not disabled" convention the nav, the settings rail, and the archive action follow. The reason those are absent is that they are doors: an affordance nobody may use is a dead end. This is not a door — it is a statement of fact that happens to be adjustable by three people. Hiding it would remove the fact along with the affordance.

### Alternatives considered

- **The banner as the first element of the page body.** Rejected: it scrolls away, which is the failure mode DES-009 rationale 2 is entirely about.
- **The flag as a sub-bar action beside Archive.** Rejected: the sub-bar holds record-level lifecycle actions, and the flag is a field with a stored value that the card must be able to state. A toggle in a strip of buttons also has nowhere to put the caption.
- **Hiding the control from viewers who may not change it.** Rejected: see the Rationale. It would leave the Contract card silent about the record's audience for everyone but three people.
- **"Manage team" as a route.** Rejected: there is no team-management route; the roster is an applet on this page (DES-047), and inventing a destination for it is a product decision this ticket has no mandate for.
- **A dismiss control that only hides the banner for the session.** Rejected by DES-009 itself, and worth restating: a banner that can be closed is a banner that is closed.

### Consequences

`apps/web/src/components/confidential-banner.tsx` is Tier 2, and `confidential-toggle.tsx` is the shared control; DES-009's `<ConfidentialMarker>` (Tier 1) lands beside them with M10/5. `AppShell` gains one optional `banner` slot between the nav and the sub-bar — the only chrome that sits there today. No new tokens: the height and the colour pair were added with DES-009 and are already contrast-linted in all three themes. The Team applet (DES-047) takes a stable `id`, because the banner's link is a fragment that opens it.

## DES-029: The confidential marker and the composer notice — DES-009's Tier 1 and Tier 3

- **Status:** Accepted
- **Date:** 2026-08-14

### Context

DES-028 built Tier 2, the banner that says a record is confidential while somebody is looking at it. M10/5 (#149) builds the two tiers that work where the banner is not: **Tier 1**, the marker that rides beside a contract title in a list of thirty and beside every comment and activity entry a reader might copy out; and **Tier 3**, the line the composer says at the moment content is handed to an audience.

One frame covers part of the work. **C1 — Contracts list** draws the marker on row C-55 as `C-55 conf`: a 12px Lucide lock and a label, on a lavender wash. **C8 — Contract detail · Confidential** draws the same anatomy again as `S8 ConfChip`, beside the record's own title. No frame draws the micro-marker on a comment or an activity entry, and no frame draws the composer notice — **C3 — Contract detail · Comments panel** is an open record, so its composer says only which tier it is posting at.

DES-009 wrote both tiers in words, and two decisions have moved under them since. CTR-022 put the Owner in the access set, so any copy that names the audience has to name three parties, not one. CTR-022 also superseded DES-009's Tier-3 add-as-watcher grant, following CMT-007: the typeahead offers only people the record can reach, so there is nobody to offer to add.

### Decision

**One component, two variants** — `apps/web/src/components/confidential-marker.tsx`, as DES-009's consequences call for.

- **Inline.** A 12px `Lock` and the literal "CONFI", uppercase at `0.4px` letter-spacing, at `text-xs` semibold in `text-confidential`. The 12px is DES-009's own carve-out from DES-008's 16/20/24 ramp, taken for this glyph and no other — the same carve-out DES-023 §1 and DES-028 §3 already record, and for the same reason: beside an 11px label a 16px lock is taller than the text it marks. It rides beside a contract title **rendered outside the record's own page**. In this build that is one surface: the contract list row. The audit log names an entity by type and id, the activity narration says "this contract" rather than its title, and there is no search, dashboard, or link surface yet — each of those inherits the marker when it arrives.
- **Micro.** The lock alone, same size, same token, beside the timestamp on every comment and every activity entry inside a confidential record.

**The marker marks records, never absences.** It takes no "hidden" state and no caller can give it one. A viewer who cannot reach a confidential record is answered no row, no entry, and no count (DD-014, CTR-021), so there is nothing for a placeholder to attach to.

**Tier 3 is one added line under the composer**, below the tier's own audience line and in `text-confidential` with the micro-marker ahead of it: _"Confidential contract — whichever audience you pick, only the contract team, the Owner, and Administrators can read it."_ The tier line still answers "which room does this comment go to"; the notice answers "and all of those rooms are inside a wall". Nothing offers to widen the record's audience from the composer.

### Recorded normalization points

1. **The marker's label is "CONFI", not the frames' "Confidential".** Both frames draw the full word; DES-009 names the abbreviation, and the M10 spec and #149 restate it. The full word is what the marker is _called_ — it is the accessible name — and "CONFI" is what is drawn.
2. **The marker takes no background wash.** The C1 and C8 frames draw the label on `#FBEFFF`. DES-009 gives Tier 1 a foreground and no surface, and the token registry says so in as many words: `confidential` is the inline marker and the banner foreground, `confidential-bg` is the banner background. A second lavender surface beside a title would also read as a status pill, which is the coupling DES-009 rationale 5 rejected.
3. **The letter-spacing is an explicit `0.4px`.** DES-006 tightens tracking on `<h1>` and nowhere else, and there is no widened step on the ramp. This is the one exception, and DES-009 gives the number, so it is written as the number rather than approximated by a Tailwind step.
4. **The micro-marker is drawn from the DES-009 text, not from a frame.** No frame draws a comment or an activity entry inside a confidential record. It takes the inline variant's glyph and token at the inline variant's size, and drops the label: beside an 11px timestamp there is no room for a word, and the banner 36px above is already saying it.
5. **The micro-marker is decorative; the inline marker is not.** The inline one carries the accessible name "Confidential", because a list row has no other statement of the restriction. The micro one carries none: it lives inside a record whose banner is a labelled landmark saying the same thing, and announcing "Confidential" on thirty consecutive rows is noise rather than information.
6. **The composer notice is drawn from the DES-009 text, not from a frame**, and its copy names the whole audience in the banner's own words. DES-028 point 5 applies unchanged: a reminder that misstates who can see the record is worse than none.
7. **DES-028 point 7 stands: no confidential chip beside the record's own title**, where C8 draws `S8 ConfChip`. Tier 1 is scoped to titles rendered outside the record page, and the banner 36px above is Tier 2's whole job. Two statements in the same colour pair, 36px apart, saying the same thing, dilute rather than reinforce — and the sub-bar already carries a reference, a truncating title, a status pill, and an archived pill.

### Rationale

Tier 1 and Tier 2 fail in opposite places, which is why DES-009 has both. A banner cannot help somebody scanning a list, and a marker beside a title cannot help somebody who has been inside one record for half an hour. The micro variant exists for a third failure the other two miss entirely: text leaves the product by being copied, and a lock rendered next to it is the only part of the restriction that travels with a screenshot.

"CONFI" over "Confidential" is a density argument. The marker sits between a title and an archived pill in a row that already carries seven columns; an abbreviation at 11px reads as a mark, and a full word reads as another column. The accessible name keeps the whole word for the reader who is listening rather than scanning.

Tier 3 is the leak-prevention surface DES-009 rationale 3 describes, minus the mechanism CMT-007 took away. What is left is worth keeping on its own: the composer is the moment content is handed to an audience, and it is the last place a statement of the bound can still change what somebody types.

### Alternatives considered

- **Following the frames' full-word chip on the wash.** Rejected: it duplicates DES-023's tier badge treatment at a glance, and the token registry reserves `confidential-bg` for the banner.
- **A `tracking-wide` or `tracking-wider` step instead of the literal `0.4px`.** Rejected: neither Tailwind step lands on DES-009's number at 11px, and approximating a figure the decision states is drift with extra steps.
- **The "CONFI" text spoken as written.** Rejected: read letter by letter it says nothing. The marker is drawn as an abbreviation and named as a word.
- **Giving every micro-marker an accessible name.** Rejected: see normalization point 5.
- **A wash on the comment row inside a confidential record, the way DES-023 washes a Legal Only row.** Rejected: the wash is the tier's, and a second one would say the record's restriction in the tier's own language. Confidentiality narrows who reaches the record; the tiers answer for whoever is left, and the two must not be read as one scale.
- **Putting the Tier 3 notice above the tier segments.** Rejected: the reading order runs from the narrow fact to the wide one — this comment goes to that room, and every room here is inside the wall.

### Consequences

`apps/web/src/components/confidential-marker.tsx` is Tier 1. The contract list row renders the inline variant; the comment applet and the history applet render the micro variant and take one new option each, so the record page passes the saved flag rather than the loaded one and the panels follow a commit exactly as the banner does. The comment composer renders the Tier 3 notice. No new tokens: the foreground pair was added with DES-009 and is contrast-linted in all three themes. The CTR-018 link rows shipped this treatment in M17 and M23. The remaining future surfaces that render a contract title outside the record page — search (M25) and the dashboard (M29) — inherit the same obligation.

_M11/6 adds the inline variant's second surface: a **document** row in the contract record's Documents section, where DD-014's per-document flag is set. It is Tier 1 unchanged rather than a new pattern — the row is a list row, and the thing it marks is not the record the page is about, so DES-028 point 7 does not reach it and the record's own banner says nothing about one file inside an open contract. The marker still marks nothing absent: a viewer outside a confidential document's audience is answered no row, so the section has no hidden state to draw. Setting and clearing the flag is a verb in the row's overflow menu rather than a switch on the row, following the same DES-025 pattern the section's other five acts already follow, and drawn for DD-014's three actors alone — absent, not disabled._

## DES-030: The shell scroll model — one viewport tall, and `main` owns the scroll

- **Status:** Accepted
- **Date:** 2026-08-14

### Context

The shell has never had a scroll model. `app-shell.tsx` was `flex min-h-screen flex-col` with `main` as `flex-1`. Nothing was `position: sticky`, and nothing owned a scroll container, so the **document** scrolled and all four strips — header, top nav, banner slot, sub-bar — left the screen together on a long page. A search of this file for "scroll" or "sticky" returned nothing about the shell.

Two accepted decisions already depend on a model that was never built. DES-009's whole reason for having a Tier 2 banner is that a marker beside a title cannot help somebody who has been inside one record for half an hour. DES-028 states it outright: "the record's body scrolls; the strip must not, and a component that lives above the scroll container cannot be scrolled off by accident." Both describe a scroll container that did not exist.

DES-016 has the same shape. The activity bar is drawn on the trailing edge of the record page and is meant to stay there; `RecordApplets` and `AppletPanel` were built with `min-h-0 flex-1 overflow-y-auto` on their bodies, which is exactly right and did nothing, because no ancestor bounded their height.

M12 forces the question. The document panel will be the tallest record surface built so far, and a preview pane wants its own scroll independent of the page around it.

### Decision

**1. The shell column is exactly one viewport tall and never scrolls.** `h-dvh flex flex-col overflow-hidden`. `dvh` and not `vh`: on a phone the usable viewport is the one the browser's own bars leave behind, and `vh` measures the one before they arrive.

**2. `main` is the one scroll container the shell makes.** `min-h-0 flex-1 overflow-y-auto`. The `min-h-0` is load-bearing — a flex item's floor is its content, so without it the region grows past the column and hands the scroll back to the document.

**3. The four chrome strips hold their own height.** Each already carries `shrink-0` and a fixed height token. Nothing is `position: sticky` and nothing is `position: fixed`; they stay because there is no scroll left for them to ride.

**4. A page that wants a finer split says `flush` and builds its own containers inside a bounded `main`.** This is how the record body scrolls under a fixed activity bar (DES-016): `RecordApplets` fills the region, its body scrolls, and the bar and the panel do not. A page never reaches for the document scroll, because there is none to reach for.

**5. Fragment links and `scrollIntoView` need no offset compensation.** The browser scrolls the nearest scrollable ancestor, which is the page's own container, and the chrome is outside it. `scroll-mt-*` on a jump target — DES-028's "Manage team →" into the Team card — is breathing room so the card's top edge does not sit flush against the container's, not clearance for a strip that could otherwise cover it.

**6. DES-028's rationale stands as written, unamended.** It was a correct statement about an unbuilt model, and it is now a correct statement about a built one.

### Rationale

The shell is chrome, and chrome that can be scrolled away is not chrome. Every persistence claim in this file — the banner that survives half an hour inside a record, the activity bar that is always on the trailing edge, the sub-bar that says which record you are on — is a claim about something that stays. One bounded column is the cheapest way to make all of them true at once, and it makes them true for surfaces not built yet without those tickets having to remember.

Giving the scroll to `main` rather than to each page keeps the decision in one file. A page opts into more structure by asking for `flush`; it cannot opt out of the model, because the model is the column above it.

`overflow-hidden` on the column rather than `overflow-clip` or nothing at all: it is the declaration that says the document has no scroll, and it also stops a mis-sized child from quietly restoring one.

### Alternatives considered

- **Making the four strips `position: sticky`.** Rejected. Sticky chrome still scrolls when its container runs out, it stacks badly with three strips of different heights, and it leaves the document as the scroll container — so a record page still cannot give its panel an independent scroll. It treats the symptom the banner has and leaves DES-016 unserved.
- **Making only the banner sticky.** Rejected in the ticket, and correctly: it would glue the confidentiality statement under a header that had already scrolled away.
- **Amending DES-028's rationale to describe what the shell did.** Rejected. DES-009 rationale 2 is the entire reason Tier 2 exists; rewriting the claim to match the defect turns a safety statement into a description of a bug.
- **`position: fixed` chrome with matching top padding on `main`.** Rejected: the padding is a copy of four height tokens kept in a second place, and it drifts the first time one of them changes.
- **`h-screen` instead of `h-dvh`.** Rejected: on mobile Safari and Chrome it is taller than the visible viewport, so the bottom of `main` sits under the browser's own bar.
- **Leaving the model to each page.** Rejected: it is the same decision made once per route, and a route that forgets it silently gives the chrome back to the document scroll — which is exactly how this defect survived eleven milestones.

### Consequences

`apps/web/src/components/shell/app-shell.tsx` carries the whole model in two class lists. No page changed: `RecordApplets`, `AppletPanel`, the comment and activity panels, and the settings rail were all already written for a bounded height and simply start working. The record page's `scroll-mt-4` on the Team card stays, with its comment corrected to say what it is now for.

The scroll model is proved in `e2e/tests/05-app-shell.spec.ts`, at the layer where layout exists: overflow is forced into `main`, and the test asserts that the document cannot scroll, that the region can, and that the three strips have not moved a pixel. The M10 demo spec's "Manage team →" leg now asserts the Team card is in the viewport after the jump rather than merely visible, which is what makes it a check of the fragment behaviour.

M12's document panel gets its own scroll container inside the record body and inherits this contract rather than negotiating one. Any future full-height surface — a split view, a preview pane, a board — does the same: bound your own height from `main`, and never reach for the window.

## DES-031: The paging foot — where it goes on a table, on a thread, and where focus lands (extends DES-026)

- **Status:** Accepted
- **Date:** 2026-08-14

### Context

CTR-024 bounds three lists that had no ceiling: the contract list, one record's comment thread, and one record's documents. Each now answers one page and says where the next one starts, so each needs a way to ask for the rest.

DES-026 already decided that shape for the history panel: "the list ends in a secondary Button labelled 'Show older' whenever a further page exists, and in nothing when it does not", and rejected infinite scroll because a scroll sentinel is not keyboard-reachable and DES-010 requires that it be. That rejection was written about the feed, but nothing in the reasoning is feed-specific, and it holds here unchanged.

What the feed's version does not answer is what these three surfaces need: a foot on a **table** rather than inside a panel, a **thread that reads oldest-first** and therefore grows at the wrong end for a foot, and **where focus goes** once fifty rows have appeared — DES-010 territory that a panel of twenty-five entries never made urgent.

### Decision

**1. The control is DES-026's, unchanged.** A secondary `Button`, drawn only while a further page exists, and absent — not disabled, not replaced by an end-of-list line — when the list is complete. There is no infinite scroll on any of these surfaces, for DES-026's reason.

**2. On a table, the foot goes inside the card and under the table's last rule.** It is a strip with `border-t border-border-default` and the card's own `px-4 py-3`, so the table's bottom rule becomes the foot's top rule and no second rule appears. The card keeps its rounded corners; the strip is what the corner now rounds. **The horizontal scroll moves off the card and onto the table**, because a foot that could slide sideways out of view is a control the reader has to hunt for.

**3. On the comment thread the control goes at the head, and the words are "Show older".** The thread reads oldest to newest (CMT-002) and pages backwards from the newest end (CTR-024), so the older conversation belongs above what is on screen — and a control belongs where what it fetches will land. It takes the same strip treatment, with `border-b` instead of `border-t`.

**4. Focus moves to the first row of the page just brought.** On a table that is the first appended `tr`; on the thread it is the oldest prepended `li`. The row takes `tabIndex={-1}` **only while it is the landing row**, so a list of fifty never becomes fifty tab stops.

- It is one rule for both directions and it never drops focus, which keeping focus on the button cannot claim: the button is absent on the press that ends the list, and focus on a removed element falls to the body.
- It is also the honest answer to what the press did. The reader asked for rows; the rows are the answer; focus goes where the answer starts. On the thread it is load-bearing rather than merely tidy — the conversation grew _above_ the reader, and without the move nothing tells them so.

**5. A polite live region says how many arrived and how many are on screen** — "1 more contract. 2 shown." It is `sr-only` and it sits outside the list, because a reader who cannot see the rows appear gets the count from nowhere else. The thread needs none: focus lands on the oldest new comment and reading continues from there.

**6. A failed page is said beside the control, and the control stays.** DES-026's rule for the feed's two failure states, applied unchanged: the retry is the button already under the reader's hand.

**7. The list's count says what is on screen whenever that is not the whole list.** The contracts sub-bar reads "50 contracts shown" while a cursor remains, and "N contracts" when the page is the list. There is no total to state (CTR-024), and a bare "50 contracts" over a list of three hundred is a number the page cannot stand behind.

**8. The empty state is untouched.** A list with nothing in it has no page to ask for, so no foot is drawn and the module's own empty state is what the reader sees.

### Rationale

Putting the foot inside the card is what makes it read as part of the list rather than as a page action. A button floating below the card would sit in the same place a "Create contract" or a "Save" would, and the reader has to tell "there is more of this list" from "do something to this list" at a glance.

The focus rule is the one part of this that is not simply DES-026 restated, and it is the part that decides whether the surface is usable without a mouse. A keyboard user who presses "Show more" and is left where they were has no way to know anything happened, and a screen-reader user gets silence. Moving focus and announcing the count answer the same question in the two modalities, so both are here.

Naming the thread's control "Show older" rather than "Show more" is not cosmetic: it is the feed's own word for the same act, and on a thread the direction is the fact the reader needs.

### Alternatives considered

- **Infinite scroll.** Rejected, in DES-026's own words: a scroll sentinel is not keyboard-reachable, and DES-010 requires that affordances are.
- **Keeping focus on the button.** Rejected: it is fine until the press that ends the list, where the button unmounts and focus falls to the body. Two rules where one will do, and the one that fails is the last press of every list.
- **Replacing the button with an "That is all" end line and moving focus there.** Rejected: it contradicts DES-026's absent end state, and it adds a line whose only content is the absence of a control.
- **A foot on the thread as well, matching the tables.** Rejected: the thread pages backwards, so a foot would fetch content that lands above it and scroll the reader away from the press.
- **Numbered pages.** Rejected upstream — CTR-024 answers no total, and numbered pages need one.
- **Stating a total beside "shown".** Rejected: the same number CTR-024 refuses, wearing a different label.

### Consequences

`ContractsTable` takes a `foot` slot and a landing row; the Documents section and the comment thread carry their own. _(DES-046 replaced `ContractsTable` with `ManagedTable`, which carries the `foot` slot and the landing row unchanged.)_ Three new messages per surface — the control, the failure, and the live-region sentence — and one new plural form for the contracts count. No new tokens: the strip is `border-border-default` on the card's own surface, and the control is the shipped secondary `Button`.

Every list bounded after this inherits the foot rather than inventing one, and any surface that pages backwards inherits the head placement with it. M12's document panel is the first that will.

## DES-032: The record-page section strip — routed tabs under the breadcrumb (extends DES-016, DES-030)

- **Status:** Accepted
- **Date:** 2026-08-15

### Context

The contract record shipped as one scroll: the Contract card, the Description card, the CTR-016 Fields card, and the M11 Documents section, stacked in the main column with the Team card beside them. The build said so in as many words — "this page is one scroll, not a tab strip" — and noted at the same time that the C4 mock puts the documents behind a tab.

One scroll was the right call while the record held two cards. It is the wrong one now. A reader who opens C-42 to check its paper scrolls past every field on the record to reach it, and a reader who opens it to fix the Owner scrolls past nothing but still pays the render cost of a document list they did not ask for. The three jobs the page does — read the record, fill the type's fields, work the paper — are asked one at a time.

No DES covered a record-page tab strip. `SettingsSectionTabs` (ST10) draws one for settings panes, but that record is SET-001's and is about settings; nothing said whether a record may have sections, where the strip sits, or what a section costs the address bar.

### Decision

**1. A record may divide its body into named sections, drawn as one horizontal strip.** The contract record's are **Overview** (the Contract card and the Description card), **Fields** (the CTR-016 card), and **Documents** (the M11 section). One section is on screen at a time.

**2. Each section is its own URL, and the tabs are links.** The bare record address is the first section — `/contracts/42` is the Overview — and each other section takes one trailing segment: `/contracts/42/fields`, `/contracts/42/documents`. A section the record does not have is not an error; it redirects to the bare address, because the record exists and only the section does not.

The strip is therefore a `nav` of `NavLink`s, not a Radix `Tabs`. An ARIA tablist promises arrow-key semantics that a set of links does not have, and a link promises an address that a tablist does not. Sections are the kind of thing people quote to each other — "the Documents tab of C-42" — so the address is what they must be.

**3. The strip sits in the shell's sub-bar slot, under the breadcrumb, and inside the chrome.** It carries the sub-bar's own `--chrome-subbar-border` as its bottom edge, and the sub-bar drops its border, so the two read as one chrome slab rather than as two stacked strips. A tab strip that scrolled away with the record would be no tab strip at all: DES-030 gives `main` the scroll, and section navigation is not part of what scrolls.

**4. The tab treatment is the settings strip's, verbatim.** 36px-tall links, `px-3`, `text-base`; the active one is `font-semibold text-primary` over a `-mb-px border-b-2 border-accent`; the rest are `text-muted` with a `hover:text-primary`. One tab look in the app. The shared component is `RecordTabs`, a sibling of `RecordApplets` under `components/shell/`.

**5. What is chrome stays chrome, and the roster is not a section.** The breadcrumb, the reference, the title, the status pill, the archived pill, and archive/restore belong to the record and are drawn above the strip on every section. So do DES-028's Tier 2 banner and DES-016's activity bar. The Team roster lives in that activity bar (DES-047) rather than in one of the sections: who is on a contract is context for reading any part of it, and DES-028's "Manage team" link is a fragment that opens the applet from any section — a fragment that only resolved on one section would be a link that sometimes goes nowhere. The record-level notices (archived, read-only) sit above the section for the same reason: they explain inert controls wherever the controls are.

**6. The chrome budget takes the 36px, and this is the ceiling.** Header 62 + nav 48 + sub-bar 64 + strip 36 is 210px of fixed chrome, and 246px with DES-009's Tier 2 banner. On a 768px-tall viewport that is 32% — over the 25% guardrail DES-011's reflow reading implies, which the banner already breached at 28%. It is accepted here because the strip buys back far more body than it costs: a reader on the Documents section is no longer scrolling three sections of record to reach the paper. **No further permanent strip may be added to a record page.** A fifth one is a restructure, not an increment, and needs its own record.

### Rationale

The tab is what the mock always drew. The build's own note said so, and deferred it only because the page had two cards at the time and a strip over two cards is chrome for nothing.

Routing the sections rather than holding them in state is the part worth arguing, and the argument is the same one SET-001 made for settings panes: a section that cannot be linked to is a section nobody can point at. It also costs nothing here — the loader already reads the whole record in one round trip, so a section change is a re-render and not a fetch.

Keeping the Team roster out of the sections is the other real choice. It could have been a fourth tab, and it is not, because the roster answers a question a reader has _while_ reading something else. A field's Owner, a document's uploader, and a comment's author are all names, and the applet is what turns them into people. DES-047 moved that roster from a side column into the activity bar; the reason it is not a tab did not move.

### Alternatives considered

- **Stateful tabs (`useState`, no URL).** Rejected: no shareable address, no back button, and a re-mount loses the section. The record page is the one surface people quote by link.
- **Radix `Tabs`.** Rejected: an ARIA tablist and a set of routed links are two different contracts, and mixing them gives a widget that announces arrow-key navigation it does not have.
- **A section per child route with its own loader.** Rejected as premature: one read answers the whole record today, and splitting it would trade one round trip for three plus a shared-state problem.
- **Team as a fourth tab.** Rejected — see the rationale; it also breaks DES-028's fragment link.
- **Putting the strip at the top of the scrolling body.** Rejected: it stays under the 25% guardrail and loses the thing a tab strip is for. Tabs that scroll off screen are a table of contents.
- **Folding the tabs into the 64px sub-bar as a second row.** Rejected: it saves nothing real — the strip's height is the strip's height — and it makes the breadcrumb row and the section row one landmark when they are two different navigations.

### Consequences

`RecordTabs` is the shared component; the contract record is the reference mount. The matter, entity, and knowledge record pages inherit it as they grow past two cards, with their own section sets — the same way DES-016's activity bar generalizes.

Three new messages per record (the nav's accessible name and one label per tab). No new tokens: the strip reuses `--chrome-subbar-border` and the accent, and the tab treatment is already shipped in `SettingsSectionTabs`.

Any surface that reads across sections must now say which section it means. A test that archives the record and checks that the type's fields froze has to cross to the Fields section to see them — which is the correct check, because the freeze is the record's state and not the section's.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the Matter detail is the second record mount

The Matter detail uses the record shell rather than inventing another anatomy: permanent M-### and title in the sub-bar, DES-009's confidential banner above it, routed Overview / Documents sections, and DES-016's Team, Comments, and History applets beside every section. Overview uses DES-017's one-field commits for title, description, type, Matter Manager, priority, risk, and attached custom fields; status, confidentiality, archive, restore, re-type, and team edits keep their compound controls. A Contributor sees the same record anatomy with unavailable writes absent or inert under the record's archived state.

Two `designs/matters.pen` **M8** deviations are normalized here rather than left as accidents. First, M8 draws `Manager *`; the build draws **Matter Manager** without the asterisk and offers **Unassigned**, because MTR-003 makes `manager_id` nullable and Request conversion must not invent an owner. Second, M8 draws a **Template** row; the M22 create dialog omits it because template entities and their task instantiation belong to M24. The type, required custom fields, priority, risk, description, and Confidential control are live now; adding a dead Template picker would make an unbuilt option look selectable.

## DES-033: The folder tree and the record-scoped batch drop (extends DES-032, DES-025)

- **Status:** Accepted
- **Date:** 2026-08-15

### Context

M13 gives a contract's Documents section two things it never had. Its paper can be filed into folders, and a drop onto it becomes a bulk import rather than one upload. The section itself is the one DES-032 just moved onto its own routed tab.

The mocks answered half of this and only half. `designs/documents.pen` **DOC4 — Upload modal** and **DOC5 — Folder import** already draw a good import confirmation: an indented tree summary, per-row meta, OCR-queued badges on scanned files, a truncation row, an OCR note, and a `Cancel` / `Import 128 files` foot. But both are mounted on the **global Documents repository**, and both collect an owning record — an `Import into` picker, a `Where does this live?` control, a `Record` field. On a record there is nothing to pick. M13 also puts that repository out of scope: it stays flat, and folder becomes a filter facet there [M26].

**C4 — Contract detail · Documents** is the frame this record is really about, and it drew none of the anatomy. It was a flat table — Name, Kind, Version, Size, Modified, uploader — with a toolbar, a drop hint, and a note row. No folder row, no indentation, no expand or collapse, no count.

C4's drop hint also said the wrong thing. It read "Drop a file to add a version to the chain — attachments stay outside the chain". M13 decides the opposite for the drop gesture: a dropped file is always a new document at version 1. Two drop meanings cannot sit on one surface, so this record settles it.

### Decision

This record decides how the surface is drawn and worded. The behaviour it draws is M13's, decided in the module records it cites — folder scope and deletion [DOC-006], batch semantics [DOC-011], silent omission [DD-014], and the record-reach gate [DOC-008]. Where a rule appears below, it is here because the surface has to say it, not because this record settles it.

**1. A folder is a row of the documents table, not a second surface.** Its anatomy lives in the Name cell: the indent spacer, a disclosure chevron, the folder glyph, the name at 13px `font-semibold`, then the count at 11px `text-muted`. Kind, Version, Size and Modified are empty on a folder row — a folder has none of them, and inventing an em dash for each would be four pieces of nothing. The trailing cell carries the row's overflow menu.

**2. Indentation is 18px per level, drawn as a spacer at the head of the Name cell.** A document row carries a 14px spacer where a folder's chevron would be, so a filed document's file glyph lines up with the folder glyphs of its siblings. One rule for both row kinds; nothing is positioned by eye.

**3. The chevron is the expand control, and the folder glyph follows it.** `ChevronRight` plus `Folder` when closed, `ChevronDown` plus `FolderOpen` when open. The chevron is what takes the click and the key; the glyph is a second reading of the same fact for people who scan shapes rather than arrows.

**4. Folders sort before documents, and siblings sort by name, case-insensitively.** The record root follows the same rule: its folders first, then the documents filed nowhere. This is how a file manager lists a directory, and `display_order` is deferred with the reorder surface that would read it.

**5. The count is viewer-scoped, and its zero reads "Empty".** The message is `{count, plural, =0 {Empty} one {# document} other {# documents}}`. A Confidential document outside this viewer's audience is omitted from the folder's listing and from its count, by the one predicate every document read already passes through [DD-014]. **An "Empty" folder may therefore be a folder whose contents this viewer cannot see, and nothing on the surface distinguishes the two.** Nothing may be added that does — no hidden-item count, no "some documents are not shown" line. Both would report the existence of what DD-014 promises to keep silent.

**6. Every row carries DES-025's overflow menu, in the trailing cell.** The shipped `DropdownMenu` on a `ghost` `icon` Button with the 16px `MoreHorizontal`. A folder's items are Rename, Move, New folder inside, and Delete; a document's gain Move to folder alongside what M11 already offers. DES-025's rule holds unchanged: the menu offers what this viewer may do and nothing else, absent rather than disabled, and a row with nothing on offer draws no trigger at all.

**Delete is offered on any folder, full or empty, and its dialog says where the contents go.** M13 dissolves a folder rather than destroying it: its documents and its child folders are re-filed into its parent, or into the record root when it has none, and no document is deleted [DOC-006]. So the confirmation is DES-025's one-click shape, not DOC-010's typed one — it names the folder, states in one sentence where the contents will land, and offers `Cancel` plus `Delete` on a `danger` Button. A refused delete — an archived contract, a folder the viewer may not write — keeps the dialog open and says the reason inside it, with the tree unchanged; normalization point 7 records why this differs from DES-025's own placement. Destroying a document stays DOC-010's job, reached from that document.

**7. The drop targets are the section and each folder row.** A drop on the section files at the record root. A drop on a folder row files into that folder. Every drop capability keeps a pointer-free twin — a multi-select file input, a directory picker, New folder, and Move — so the M4 keyboard contract holds on the new surface.

**8. One drop meaning, and the surface says which one.** M13 decides that a dropped file is always a new document at version 1 [DOC-011]; C4 said the opposite, so C4's hint is rewritten, in two lines:

- "Drop files or folders here — each file becomes a new document at version 1"
- "Folder structure is kept. To add a round to an existing chain, use Upload version on that document."

Appending a round stays a deliberate act on a named document, reached from that document. The old sentence is gone, not softened.

**9. The batch confirmation is DOC5's tree summary, moved onto the record and stripped of its pickers.** The head names the count. The body is, in order: the **destination readout**, the **tree summary**, the **version-kind control**, and the **OCR note**. The foot is a note, `Cancel`, and the verb carrying the count — "Import 128 files".

- The **destination readout is static**, a strip carrying the folder glyph, the folder's name, the record it belongs to, and the words "Set by the drop" at its trailing edge. It states where the files will land and offers no way to change it, because the drop already answered that.
- The **tree summary** is DOC5's, unchanged in anatomy: indented rows, a bold root with `3 folders · 128 files`, per-row meta, an OCR-queued badge on each scanned file, and a `…and 126 more files` truncation row.

**10. The kind is collected once, by one select, defaulting to Draft · ours.** One batch takes one kind and no note [DOC-011], so the dialog draws one `Select` over the version kinds with the helper line "Applied to every file in this import. Notes are not collected in bulk." There is no per-file kind control and no note field to draw.

**11. Progress and failure are the same dialog, not new ones.** The confirmation becomes a progress list on confirm: an overall count and bar, then per-file rows carrying the file's folder path in muted text, its name, and its state — Done, a per-file bar with a percentage, or Queued. A failed file states its reason on its own row in `text-danger`. **Retry appears only on a failure a retry could fix.** A refusal the file itself earned — over the deployment's size ceiling, a folder path or a name or a version kind the seam will not take — names the reason and offers no Retry, because the same file earns the same answer. Retry is offered when the seam gave up waiting, when it is being asked too often, when it had a bad minute, and when the connection dropped: those are answers about the moment, not about the file. The batch never aborts for one refusal, and the foot says how many files are already on the contract.

**Retry is per file, and the dialog stays open while it runs.** Pressing Retry on a row re-uploads that file and nothing else; a file that already landed is never sent again, so a retry cannot duplicate a document. The row returns to its uploading state, the head's "Imported N of M" and the foot's count move as files land, and the foot's "Retry N files" repeats the same act over every retryable row. The dialog closes only on `Done` or on the close control, so a reader who retries can see whether the second attempt worked.

**12. The empty state and the loading state.**

- **Empty** replaces the table with the section's own panel — glyph, "No paper on this contract yet", and the drop sentence — with no table header and no separate drop hint, because the panel is the drop target. A Contributor's empty panel keeps the glyph and the headline and swaps the drop sentence for the read-only notice, since offering a drop to somebody who may not drop is a control drawn for nobody.
- **Loading** is two different loads, and only one of them is new. The folder set arrives with the section, in one read. A folder's documents load when it is opened, drawn as skeleton rows at the opened folder's depth, so the tree around them stays readable while they arrive.

**13. The Contributor's view removes controls rather than disabling them.** The toolbar's buttons are absent, every overflow trigger is absent, and the drop hint is replaced by a read-only notice above the table. This is DES-025's convention applied to a whole section: what a viewer may not do is not drawn.

**14. The global repository's own modals stay exactly as they are.** DOC4 and DOC5 keep their target pickers, because on the repository there genuinely is a target to pick. This record covers the record-scoped surface only. The repository is M26's, and nothing here pre-empts it.

### Recorded normalization points

1. **C4 drew none of this.** Every element above is drawn into C4 by this record, and C4 is now the reference frame for the tree. C24–C29 carry the empty state, the folder load, the Contributor view, and the three states of the batch dialog.
2. **The table's trailing cell grows from 48px to 76px**, so the uploader avatar and the row menu sit together. Every documents table on a record takes the wider cell.
3. **The zero count reads "Empty", not "0 documents"** — a plural form, not a special case in code.
4. **The record dialog drops DOC5's `Import into`, `Where does this live?`, and `Record` controls entirely.** They are not hidden or pre-filled; they are not there.
5. **C4's drop hint is replaced.** The version-to-the-chain sentence does not survive anywhere on the section.
6. **The mock names one folder in lower case on purpose.** "correspondence" is drawn between "Amendments" and "Executed", so the case-insensitive order is a thing the mock shows rather than a thing this record only asserts.
7. **A refused folder Delete stays inside the open dialog, carrying the server's own sentence** — it does not close the dialog and mark the row, which is what DES-025's removal dialogs do. §6 above states the rule; this is why it departs. The consequence sentence and the one-click shape are unchanged, and only where the refusal is said moves. It is said in the dialog because that is where the reader is looking and because every refusal here is one they can act on — a name already taken, a delete that would put two folders of one name in one place — so they can read why and then cancel or fix. It is the DOC-010 erasure dialog's own precedent on this same surface. The same rule holds for a refused document Move.

8. **The batch dialog draws a per-file state, not a per-file percentage, and badges no file "OCR queued."** §9 and §11 draw both, from DOC5's mock, and the build ships neither — for the same reason in two places: the client does not know the fact the mock states.

   - **The percentage.** An upload is one `fetch` of one multipart body, and `fetch` reports nothing about how much of that body has gone. So each row says where the file got to — Queued, Uploading, Done, or the failure and its sentence — and the head and the bar carry the count that _is_ known: how many files of the batch have landed. A per-file percentage drawn anyway would be a number nobody measured, and the batch's whole claim is that it is honest about what it is doing. §11's shape is otherwise unchanged: one dialog, per-file rows, retry only where a retry could succeed, and the foot saying how many files are already on the contract.
   - **The OCR-queued badge and the scanned-file count.** Whether a PDF is a scan is decided by reading its own text layer, on the server, after the file has landed (DOC-005) — a file that says `.pdf` and a file that is a photograph of a page are the same file to a browser. So no row is badged and no strip counts scans. The strip stays, saying what is true of every file: text extraction and OCR run in the background after each one lands.

   Both are worth revisiting only if the upload seam changes. Real per-file progress needs `XMLHttpRequest`, which would fork the upload path away from the one call every other upload makes; that is a bigger cost than a percentage is worth today.

9. **The surface says nothing about folders until the drop can carry one.** §8, §9 and §11 each draw a fact only a directory drop produces, and M13/4 takes no directory — the drop handler reads the dropped entries and leaves anything that is not a file alone, which is M13/5's to recreate. So four things ship shorter than they are drawn, and all four come back with M13/5:

   - **§8's hint loses its folder clause.** The two lines ship as "Drop files here — each file becomes a new document at version 1" and "To add a round to an existing chain, use Add version on that document." A hint that promises a gesture the surface refuses is worse than a shorter one.
   - **§8's second line names the control that exists.** The row menu offers **Add version**, not "Upload version". The copy follows the menu rather than the other way round.
   - **§11's per-file rows carry no folder path.** Every file of a batch lands at the record root, so a path on each row would repeat one value down the list.
   - **§9's tree summary is a flat file list.** There is no tree to indent and no `3 folders · 128 files` root line to draw, so the body lists the files directly, still with the truncation row. The destination readout stays, reading "Record root", because stating where the files land is what it is for.

   Nothing above is reversed. The anatomy §9 and §11 fix is what M13/5 builds back onto.

10. **M13/5 built all four back, and two of them changed shape on the way.** Point 9 was a deferral, and it is now spent: the hint carries its folder clause, the per-file rows carry their folder path, the summary is a tree, and the destination readout names the folder a drop landed on. Two details of §9 and §11 ship differently from the mock, for the reason point 8 gives about both of its own:

    - **The tree summary draws every folder and truncates only the files.** C27 draws one truncation row, "…and 126 more files", after a tree. The structure is what the reader is confirming, so a truncated structure would be a confirmation of something else — the folder lines are all drawn, however many there are, and the truncation row counts the files it cut.
    - **The OCR-queued badges and the scanned-file strip stay absent**, exactly as point 8 records: the client still has not read any file's text layer, and a folder drop does not change that.

    One thing the mock has and the build does not, deliberately: C29's failure sentence reads "The other 126 are on the contract, filed where you dropped them." The shipped sentence stops at "on the contract", because the clause is only true when the drop carried a structure and a batch does not always. Worth revisiting if the sentence is ever made conditional on the drop's shape.

11. **The drop targets are the section and each folder row, and only one of them lights up.** §7 names both targets and stops there. The row that will take the drop takes the section's own outline treatment, and the section keeps its own — the drop is still on the section, filed one level in. Two lit rows would promise a drop that lands twice, so one folder is marked at a time.

12. **The page is the target too, and §8's hint is gone.** Two changes, one reason. §7 made the section the drop target; the Documents tab now takes a drop anywhere in the window and files it at the record root, exactly as a drop on the section does. Somebody dragging a file into the window has already said what they want, and the cost of missing a small rectangle is not nothing: the browser's own default for a dropped file is to open it and leave the record. The section and each folder row keep their own handlers, so a drop inside the section still decides between root and folder the way point 11 says; the page answers only for what lands outside. A drag over an open dialog is left alone — the batch confirmation is itself the answer to a drop, and the composer has its own file control.

    §8's two hint lines come off with it. A hint that names one rectangle is wrong once the whole page is the target, and the sentence it was left saying — where a drop lands, and that a round goes on the document — is what the batch confirmation already says at the moment it matters, with the destination readout point 9 kept. The section's outline stays the only drag affordance. Worth revisiting if the outline proves too quiet for a drag that starts far down a long page; a page-level affordance would need its own decision.

### Rationale

Drawing folders as rows of the existing table is the whole reason this stays cheap. The columns, the row height, the paging foot, the pills, and the doc panel are all M11's and all unchanged; a folder is a row that fills fewer of them. A separate tree pane would have been a second surface to keep in step with the first, and DES-032 has just spent the record page's remaining chrome budget.

The count rule is the part that carries a promise rather than a preference. DD-014's whole claim is that a viewer outside an audience cannot tell a hidden record from one that was never created. A folder that said "3 documents" and listed one would break that claim inside folders, so the count is scoped to the reader and its zero is left ambiguous on purpose.

Settling the drop meaning was forced. A gesture that sometimes appends a round and sometimes creates a document is a gesture nobody can use without checking first, and the check is the ceremony the drop exists to remove. Making the drop mean one thing puts the other act where it belongs: on a named document, behind its own control.

Keeping Retry off a refusal the file earned is a small honesty. A control that cannot succeed is worse than no control, because it reads as "try again" when the answer will not change.

### Alternatives considered

- **A folder pane beside the table**, file-manager style. Rejected: two surfaces to keep in step, and the record page has no width or chrome budget left after DES-032.
- **Drill-in listings with a breadcrumb** instead of an in-place tree. Rejected: it hides where a document sits, and it loses the root's mix of folders and unfiled documents — which is the honest shape of a record part way through being organized.
- **A per-file kind in the batch dialog.** Rejected by DOC-011: 200 decisions is exactly the ceremony bulk intake exists to remove.
- **A target picker on the record dialog**, carried over from DOC5. Rejected: the drop already said where. A picker would let the confirmation contradict the gesture that opened it.
- **Keeping the old drop meaning behind a modifier key.** Rejected: one gesture, one meaning. A modifier is undiscoverable, it has no keyboard twin, and DES-010 has no key to spare.
- **Distinguishing an empty folder from one whose contents are hidden.** Rejected: it is DD-014's failure mode wearing a helpful face.
- **Dragging documents and folders within the tree to re-file them.** Out of scope for M13 — Move ships as a menu item, and pointer drag stays an intake gesture only.
- **A separate dialog for progress and for failures.** Rejected: the reader confirmed one thing and is watching one thing. Three dialogs for one import is three places to look.
- **A typed confirmation on folder Delete**, per DOC-010's hard-delete pattern. Rejected: nothing is destroyed — the contents are re-filed into the parent — so the ceremony is out of proportion, exactly as DES-025 found for a single comment.
- **Offering Retry on a size refusal**, greyed out. Rejected: a control that cannot succeed reads as "try again" when the answer will not change.

### Consequences

The Documents section grows a tree renderer, a folder row, and the batch dialog with its three states. The folder machinery is built against the owning record rather than against contracts, so Matters inherited the surface in M22 by gaining an owner column; Entities do the same in M27 rather than forking it.

New messages: the folder count plural, the two drop-hint lines, the read-only notice, the folder and document menu items, the folder-delete dialog's title and consequence sentence, and the batch dialog's strings — title, destination, tree meta, version-kind label and helper, OCR note, the per-file states, the failure reasons, the retry controls, and the two feet. No new tokens: the tree reuses the table's own surfaces, the status families already shipped, and DES-008's Lucide set.

Every documents table on a record takes the 76px trailing cell, whether or not that record has folders yet.

`designs/contracts.pen` is the reference: C4 rebuilt, and C24–C29 added. `designs/documents.pen` DOC4 and DOC5 are untouched and stay that way until M26.

## DES-034: The stage pipeline — six fixed steps beside the status pill (extends DES-005, DES-032)

- **Status:** Accepted
- **Date:** 2026-08-15

### Context

CTR-001 gave contracts a two-layer lifecycle: renameable statuses over a fixed six-stage backbone — `draft → review → approval → signature → active → ended`. The record has drawn the status half since M8, as the sub-bar pill. It has never drawn the stage half. Grill-plan row D.8 says it must: "renders the derived stage (6-step pipeline per CTR-001), same datum as C.5 at coarser zoom".

Every contract-record frame in `designs/contracts.pen` already draws it, as `S2 StagePipe` on the sub-bar. No DES named its anatomy, said what a stage that a contract has moved back past should look like, or said what happens to six steps in a slot too narrow for them. DES-032 closed the obvious escape route in advance: a record page may gain no further permanent strip.

### Decision

**1. The anatomy is the mock's.** One bordered strip — `bg-control`, `border-border-default`, `rounded-card`, `px-3 py-1.5`, `gap-1.5` — holding the six stages in canonical order, each pair separated by a Lucide `chevron-right` in `text-border-default`. Three item states:

- **Behind the marker** — a Lucide `check` in `text-status-success-fg`, then the stage name in `text-xs text-primary`.
- **The marker** — the stage name in the DES-005 pill its stage family names (`STAGE_PILL`), drawn exactly as the sub-bar's status pill is drawn: `rounded-pill px-2 py-0.5 text-xs font-medium`.
- **Ahead of the marker** — the stage name in `text-xs text-muted`, nothing else.

**2. It renders position, never progress.** Transitions are unrestricted (CTR-001) — deals collapse, redlines reopen after approval — so the marker moves backwards as readily as forwards. The check on the stages behind it is recomputed from the current stage on every render and means "behind the current position", not "achieved". A regression takes those checks away again. Nothing in the strip may accumulate.

**3. It sits in the sub-bar, beside the status pill.** The two are one datum at two zooms and are read together: the pill takes the label an Administrator may rename, the pipeline takes the fixed stage that label maps to. The strip is the sub-bar's middle group, between the breadcrumb group and the record actions, as every C-frame draws it. It costs no chrome height — the row is already 64px.

**4. Under a 1024px shell the sub-bar row wraps; it never becomes a strip.** Six stages, a breadcrumb, a title, and a pill do not fit one 64px line under about 1024px — the title truncates to nothing and the pill goes under the pipeline. So the sub-bar section drops its fixed height and wraps: the breadcrumb group takes the first line, and the pipeline and the record actions share the second. The gate is the shell container (`@5xl/shell`), not the viewport — DES-012's rule, because the sub-bar reflows against its own slot, and 1024 is where this bar runs out of room rather than where the shell changes shape.

This is not a fifth strip under DES-032: it is the same strip, reflowed, and only where the alternative is an unreadable one. On a phone it costs nothing against DES-032's accepted stack — the 48px top nav is hidden below 768px, so header 62 + a two-line sub-bar + the 36px section strip still comes in under the 210px desktop chrome DES-032 clause 6 computes.

**5. The pipeline claims no width of its own on a narrow slot, and its full width on a wide one.** Narrow, it is `grow basis-0`, so it shares its line with the record actions instead of pushing them onto a third row, and scrolls inside whatever is left. Wide, it is `shrink-0`, so a long title truncates before six stages start sliding out of view.

**6. Where the strip still does not fit, it scrolls sideways and never wraps.** A chevron at a line break reads as a broken sequence. The strip takes `max-w-full overflow-x-auto` and is focusable, which is what makes that scroll reachable from the keyboard (WCAG 2.2 SC 2.1.1); it is a named list, so the tab stop announces itself.

**7. Three states, none of them carried by colour alone (DES-011).** The check glyph, the pill fill, and the muted plain text differ in shape and weight as well as hue. For assistive technology the marker carries `aria-current="step"` and the stages behind it carry a screen-reader-only "done" — the word the check glyph says visually. The stages ahead carry nothing: a bare label after a marked one already reads as not reached, and three repetitions of "not started" is noise.

**8. Two normalizations off the mock.** The glyphs are 12px rather than the mock's 12 and 10 — one sub-16 step, the size the checkbox indicator already uses for a glyph inside a control (DES-008 governs standalone icons, and these are interior to a compact metadata strip). The marker pill takes the shipped status pill's `px-2 py-0.5` and `font-medium` rather than the mock's raw 3/10 padding and 600 weight, because the two pills sit side by side on the same row and a half-pixel disagreement between them would read as a mistake.

**9. On a wide shell the breadcrumb group takes the row's slack, so the strip is pinned against the record actions.** The three groups sit on one line and the free space has to go somewhere. Giving it to the breadcrumb group — `flex-1` from `@5xl/shell` up — parks the strip a fixed distance from the right edge. Sizing that group to its own content instead, which is what the row did first, hung the strip off the title and the status label: the label is renameable (CTR-001), so the strip moved when an Administrator renamed a status, and it moved again on every record the reader opened. The strip is the one thing on this row a reader returns to across records, so it is the one thing that may not wander. This governs the wide row only — under `@5xl/shell` the row wraps by clause 4 and the strip takes clause 5's `grow basis-0` on its own line.

### Rationale

The pipeline is the reason CTR-001 has a fixed backbone at all. A reader who does not know that "Redlining with counterparty" is a review-stage status cannot read the pill; the pipeline is what turns a team's private vocabulary back into the six words every contract shares.

Position-not-progress is the whole design constraint, and it is why this is a marked list rather than a progress bar, a stepper with connectors that fill, or anything else that implies a ratchet. CTR-001 allows any transition. A control that draws four filled segments and then has to unfill three of them is lying on the way in or on the way out.

Wrapping the sub-bar on mobile rather than adding a strip is the choice DES-032 forced, and it is the right one anyway: the pipeline belongs beside the pill, and a strip of its own would have separated the two things that mean the same.

### Alternatives considered

- **A filled progress bar or connector-stepper.** Rejected: it promises one-way travel that CTR-001 explicitly refuses.
- **Putting the pipeline at the top of the scrolling body.** Rejected: it leaves the pill alone in the chrome, so the coarse and fine readings of one datum end up in two different layers, and the coarse one scrolls away.
- **A fifth chrome strip for the pipeline on a narrow shell.** Rejected by DES-032's ceiling clause.
- **Hiding the pipeline on a narrow shell.** Rejected: the stage is the one thing on the record a phone reader is most likely to have opened it for.
- **Keeping the one-line sub-bar all the way down and letting everything shrink.** Rejected on sight of it: under about 1024px the title truncates to nothing and the pipeline slides over the status pill.
- **Letting the strip wrap to two lines instead of scrolling.** Rejected: a chevron stranded at the end of a line reads as a sequence that broke, not as one that continued.
- **Showing the status label inside the marker pill instead of the stage name.** Rejected: the pill next to it already says the label, and the pipeline's job is to name the stage.
- **A viewport `md:` breakpoint for the wrap.** Rejected: DES-012 reserves the viewport breakpoint for the shell's own desktop/mobile switch, and the sub-bar has a container to query. The bar also runs out of room at 1024, not at 768.

### Consequences

`StagePipeline` is the component; the contract record's sub-bar is the reference mount. It takes the derived stage and nothing else, so any surface that can answer a stage can draw it.

Three new messages: the strip's accessible name, the stage-name select, and the "done" word. No new tokens — the strip reuses `bg-control`, `border-border-default`, `text-status-success-fg`, and the `STAGE_PILL` families DES-005 already ships.

Anything reading the record's sub-bar by text now finds stage names there as well as the status label, and must say which of the two it means. The pipeline is the named list; the pill is what is outside it.

`designs/contracts.pen` is the reference: `S2 StagePipe` in every C-frame, C2 and C22 being the clearest.

## DES-035: The record's Approvals section — the roster table and its row actions (extends DES-032, DES-020, DES-005)

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

CTR-012 gave contracts manual approvals: a Member+ user asks named colleagues to sign a record off, each of them answers with an approval or a rejection plus an optional note, and the roster is what the record shows. Grill-plan section H is the surface — the Events card, renamed "Approvals & signing", auto-derived rows only, decision pills per DES-005 (H.H2, H.C4, H.X1, H.H4).

`designs/contracts.pen` draws it as **C5 — Contract detail · Approvals**: a toolbar with a tally on the left and `Apply group` plus `Add approver` on the right, then a five-column table — Approver, Source, Decision, Note, Decided — with an avatar, a name, and a **job title** in the Approver cell, and two informational note rows underneath.

Four things the mock draws do not exist in the product being built, and one thing the product needs is not drawn:

1. **There is no job title.** OpenLaw records a display name, an email, and a role, and CTR-004 already settled that a person on a contract is drawn "name only, no job-title suffix". The mock's secondary line has no datum behind it.
2. **The roster must say who asked.** CTR-012 records `requested_by`, and a reader of the record has to be able to answer "who asked for this" without opening the feed. The mock has no column for it.
3. **The mock draws no row action at all** — no way for the named approver to answer, and no way for anybody to withdraw an ask. Those are the two things the surface exists for.
4. **The card holds one kind of row today.** Envelope rows arrive with M15 (CTR-013) and confirmed-renewal rows with M16 (CTR-006).
5. **Both note rows describe behaviour that is not built here**: the soft gate, and the group snapshot.

DES-032 also enumerated the record's sections as three — Overview, Fields, Documents — and this is a fourth.

### Decision

**1. Approvals is a fourth section on the DES-032 strip, at `/contracts/42/approvals`.** It follows Documents, as the C5 mock's own tab order does. This is not a new strip and does not touch DES-032's chrome ceiling: the strip already exists, and a section is a link inside it. The enumeration in DES-032 clause 1 is extended, not amended — a record may divide its body into named sections, and this is one more.

**2. The section is one self-contained card, drawn as the Documents section is.** The `bg-raised` card with a `bg-section-header` head; the heading, the DES-020 count badge, the write micro-state, and the section's own control in that head; the table under it; and a plain empty line when there is nothing to draw. One section anatomy on the record, so a reader who has learnt the Documents section has learnt this one.

**3. The heading is "Approvals", not the mock's "Approvals & signing".** The card holds approval rows alone until M15 puts envelopes in it. A heading naming two things while showing one reads as a surface that is broken rather than as one that is early. The name changes when the rows do. _(The rows changed with M15/2: the card holds envelope rows, and the heading takes the two-part name — see **DES-036** clause 1.)_

**4. The mock's toolbar tally moves into the card head, and a state nobody is in is left out.** "2 approved · 1 pending" is drawn beside the count badge at `text-sm text-muted`, one message per state, with the separator drawn rather than written into a message. A zero is omitted rather than printed: three counts of which two are zero is noise on a line that has to stay readable beside a heading.

**5. The columns are the mock's five, and the Approver cell's secondary line is the requester.** Approver | Source | Decision | Note | Decided, with a trailing action cell. The secondary line under the approver's name reads "Requested by {name}" where the mock drew a job title — the drawn anatomy keeps its shape, and the line says the thing the record actually knows. A sixth column for the requester was rejected: the roster is already five columns wide on a section that shares its page with the Team card, and the requester is a fact **about the ask**, which is what the Approver cell is.

**6. Source says the group's name, or "Added manually".** The mock's own two readings. The column stays drawn while every row is manual, because the datum is on the row and the group case lands in the same milestone.

**7. Decision pills take the DES-005 paired families, keyed to the status** (H.X1): pending is `assigned`, approved is `success`, rejected is `danger`. Pending is `assigned` on purpose — it is the family `STAGE_PILL` already gives the approval **stage**, so the pipeline in the sub-bar and the roster below it say the same thing about the same contract in the same colour. The pill is drawn exactly as the sub-bar's status pill and the pipeline's marker are: `rounded-pill px-2 py-0.5 text-xs font-medium`.

**8. An undecided row prints an em dash in Note and in Decided, from one message.** Two cells with nothing to say, saying it the same way.

**9. Row actions live in one overflow menu, and every item is absent rather than disabled.** The menu is the shipped `DropdownMenu` on a `ghost` `icon` Button, labelled "Actions for {name}" — DES-025's pattern, for its reason. It holds **Approve** and **Reject** for the named approver of a pending row, and **Cancel request** for its requester, the contract's Owner, and an Administrator. A viewer who may do neither gets no trigger at all: a greyed-out control on somebody else's sign-off is an invitation to ask why, and the answer is not a permissions lesson.

**10. Deciding opens a dialog; cancelling does not.** A decision is the decision **and** an optional note, committed together — the compound edit DES-017 carves out of the inline-commit rule. The dialog says the decision is final before it asks for anything, and its confirm is the verb ("Approve" / "Reject") rather than "Save", because a decision that cannot be taken back should not be pressed by reflex. Rejecting takes the `danger` button; approving takes the primary one. Cancelling collects nothing and destroys nothing that matters — the ask goes, the activity entry keeps it (CTR-012), and asking again is one dialog away — so it takes no confirmation, exactly as archiving a document takes none.

**11. Asking is one dialog and a multi-select.** Requests run in parallel, so naming three people is one act and three requests; collecting them one at a time would be three dialogs for one decision. The picker offers Member+ only, leaves out anybody who already has a pending request, and on a confidential record offers only its audience — the same rule the seam applies, mirrored here for the reason the record's own confidentiality control gives.

**12. A refusal is printed once.** A write raised from a dialog reports in that dialog's form, where the reader's attention already is; a write with no dialog — the row's cancel — reports in the card head's micro-state. The same sentence in both places reads as two failures.

**13. The mock's two note rows are not drawn.** Each describes behaviour that lands in a later slice — the soft gate, and the group snapshot. A surface that explains a rule it does not yet apply is a surface that is wrong. _(Amended by clause 17 for the snapshot sentence and by clause 18 for the soft-gate sentence: each is drawn once its slice exists, in the dialog of the act it describes rather than under the roster.)_

**14. "Apply group" is the card head's second control, before "Add approver", and it is absent when there is no group to apply** _(added 2026-08-16 with #234)_. The C5 mock draws the pair in that order, and this is that pair. It is a `secondary` Button with the mock's own `Users` glyph at 16, beside the "Add approver" it shares a head with. When an Administrator has configured no live approver group, the control is not drawn at all. Clause 9 said the same thing about a different absence: a control whose dialog could only report that there is nothing to pick is not a control, and the Settings pane is where a group comes into existence.

**15. Applying is one dialog and a single select.** A group is already a set, so picking one is one act and picking two is two writes; a multi-select would collect two acts into one press. The select is the shipped `CONTROL_CLASS` raw `<select>` — the record's own single-choice control — with a "Pick a group" placeholder, so a group is chosen deliberately rather than defaulted into. Submitting with nothing picked prints "Pick an approver group." in the form, the same shape "Pick at least one approver." already takes.

**16. The dialog names the people it would ask, before it asks them.** One press becomes several requests, and the reader should see the set while it is still a preview: "Asks Sarah Chen and Ada Admin." under the select, with "Skips 1 person who already has a request open." beneath it when the apply would skip somebody. A group with nobody left to ask says so — "This group has nobody to ask." for an empty template, "Everybody in this group already has a request open." for a fully-skipped one. The preview mirrors the seam's two **silent** filters and nothing more: an archived member is simply not among the live people the page holds, which is exactly the member the apply leaves out. Whether what remains is empty, and therefore refused, stays the seam's call — the dialog states the case, the press carries it, and clause 12 prints the seam's sentence once. The rule lives in one place.

**17. The mock's snapshot note row is drawn in the apply dialog, not under the roster.** "Applying a group asks the people it names now. A later edit to the group leaves these requests as they are." is a fact about the **act**, and it is said where the act is taken, at `text-xs text-muted`. Under the table it would be a permanent explanation of a button most readings of the card never press. The mock's other note row — the soft gate — stays undrawn until that slice lands.

**18. The soft gate is a confirmation dialog on the status select, and it is where the mock's soft-gate note row is drawn** _(added 2026-08-16 with #235)_. Moving a contract past the approval stage while an approval is unresolved is refused once by the seam (CTR-012), and that refusal is what raises this. The dialog is the shipped `Dialog`, titled "Move past approval", and it holds three things in this order: a line counting the unresolved asks and naming the status being moved to; one row per unresolved ask with the approver's avatar, their name, and the clause 7 pill of what they answered; and the mock's own note row — "This is allowed. It is recorded on the record's activity as an override." — at `text-xs text-muted`, said where the act is taken, exactly as clause 17 says the snapshot sentence. The record's own Approvals section is where the roster lives, so the dialog reads it rather than fetching one.

**19. The soft gate's confirm is "Move anyway", and its refusal is printed in the dialog.** The verb rather than "OK", for the clause 10 reason: an act nobody can undo by pressing again should not be pressed by reflex, and "anyway" is the word that carries the deliberateness the gate exists to buy. It is the primary button, not the `danger` one — CTR-012 chose a warning over a lock precisely because pushing past is a legitimate small-team act, and dressing it in red would read as a mistake being made. The status select's own micro-state is cleared as the dialog opens and the seam's refusal is printed inside the dialog instead, which is clause 12 applied to a refusal that raised its own dialog.

### Rationale

The mock is a good drawing of a roster and a poor drawing of a workflow: it shows the state and offers no way to change it. Everything decided above that is not in the mock is one of the two acts CTR-012 is about — answering an ask, and withdrawing one — and both had to be put somewhere.

The job-title swap is the smallest honest change. The cell already reserves two lines and the eye already reads the second as "something about this person"; putting the requester there costs no width on a table that has none to spare, and it is the datum the roster is missing.

Pending being `assigned` rather than `warning` is the one colour choice worth stating. A pending approval is not a problem — it is a thing waiting on a named human, which is exactly what DES-018 spends the `assigned` family on, and it is what the stage pipeline beside it is already drawing.

### Alternatives considered

- **A sixth "Requested by" column.** Rejected: six columns plus an action cell on a section sharing its page with the Team card, to carry a fact that belongs to the ask the first cell is already about.
- **Approve and Reject as two inline buttons on the row.** Rejected: two labelled buttons on a 13px row crowd out the Note column, and the menu is where the record's other row actions already live.
- **A confirmation on cancel.** Rejected: it withdraws an ask, and the ask can be made again in one dialog. Confirmations spent on recoverable acts are confirmations nobody reads on the unrecoverable ones.
- **Keeping the mock's "Approvals & signing" heading now.** Rejected: naming M15's rows a milestone before they exist.
- **A separate dialog per approver.** Rejected: CTR-012's whole point is that approvals are parallel, and the seam creates the set or refuses the set.
- **Drawing the mock's two note rows now.** Rejected: they describe the soft gate and the group snapshot, neither of which this surface did yet. _(The snapshot row was revisited with #234 — see clause 17; the soft-gate row with #235 — see clause 18.)_
- **Drawing the soft-gate note permanently under the roster, where the mock puts it.** Rejected with clause 18, for clause 17's reason: it explains a rule that fires on the status select on another section of the record, and most readings of the Approvals card never move a status. The warning belongs where the move is made.
- **A `danger` confirm on the soft-gate dialog.** Rejected: the override is allowed, and CTR-012 spent the whole decision on that. Red would say a mistake is being made, and the mistake the gate guards against is the one where nobody was warned at all.
- **The record deciding whether to warn, from the roster it already holds.** Rejected: the gate would then exist twice, and the copy on the client would drift the first time a stage moved. The seam refuses; the record raises the dialog from the refusal.
- **A checkbox list of groups, or several groups in one apply.** Rejected with clause 15: a group is a set already, and two of them are two acts the seam creates or refuses separately.
- **Hiding a group the apply would refuse.** Rejected with clause 16: a template an Administrator configured should be findable in the picker, and "this group has nobody to ask" is a better answer than a group that has silently vanished.
- **Refusing the empty apply in the dialog rather than letting the press reach the seam.** Rejected with clause 16: the dialog would then hold a second copy of the skip rule, and a second copy is a rule that drifts.
- **Putting the roster on the Overview as a card.** Rejected: the Overview is the record's own columns, the C5 mock puts approvals behind their own tab, and DES-032 exists precisely so a job the record does one at a time gets an address.

### Consequences

`ApprovalsCard` is the component; the contract record's `approvals` section is the reference mount. _(Renamed `ApprovalsSigningCard` with M15/2, when the card took its second row family — DES-036.)_ It takes the roster, the people the record's pickers already hold, and the viewer's standing, and it answers the whole roster back on every write.

The record now has four sections. `RECORD_TABS` grows by one, and the loader reads the roster beside the record, its paper, and its folders.

No new tokens. The pills reuse the DES-005 families already shipped, the card reuses the Documents section's own surfaces, and the menu reuses DES-025's trigger.

`designs/contracts.pen` frame **C5 — Contract detail · Approvals** is the reference, with clauses 1, 3, 5, 9, 10, 13, 14, 17, and 18 above recording where the build departs from it and why. Both of the mock's note rows are now drawn, each in the dialog of the act it describes.

`SoftGateDialog` lives on the contract record beside `RetypeDialog`, because the status select it guards is on the record's Overview section rather than inside `ApprovalsCard`. It reads the roster the record already holds.

The apply picker needs the live approver groups on the record, so the Member+ contract-options answer carries them — the names alone, with the ids of the people each would ask, in the display-name order the apply asks in, so the clause 16 preview names people in the order the roster will then draw them. Managing them stays Administrator-only (SET-002); this is the list an apply reads.

## DES-036: The signing half of the record — the envelope row, the send dialog, and the sub-bar chip (extends DES-035, DES-034, DES-005)

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

CTR-013 gives a contract an **envelope**: one round of signature on one version of its primary document, sent from the record through a configured connector. M15/2 is the send. Grill row X.2 scheduled the value-to-family pill mapping as a DES addendum at build, and this is that addendum plus the three surfaces the send needs.

DES-035 clause 3 reserved the card's second name for exactly this moment: the heading reads "Approvals" while the card holds approval rows alone, and takes the two-part name when M15's envelope rows join it. They join it here.

Three mocks are the drawn reference, and each of them draws something the product being built does not have.

`designs/contracts.pen` frame **C12 — Send for signature** draws the send modal: a provider row naming DocuSign with a **Connected** chip and a "Use manual hand-off instead" link; a **Signers — in signing order** block, each signer an ordinal, an avatar, a name, an email, and a drag grip; a **Message** box; a note reading "The executed file auto-files on the contract; stage advances to Active when everyone signs."; and a footer of Cancel and **Send envelope**.

Frames **C20 — Contract detail · Signatures** and **C21 — · Manual hand-off** draw the envelope itself as an **applet panel** on the record's right side: an envelope line with a provider chip, one row per signer with a per-signer pill (**Signed**, **Viewed**), a **Remind** action beside **Void envelope**, and a note about the webhook.

What is not there to draw:

1. **There is no routing order.** CTR-013 v1 asks every signer in parallel. The ordinals and the drag grip order something that does not exist.
2. **There is no per-signer status.** The envelope carries one status; who has signed so far is provider-side detail v1 does not surface (CTR-013's own scope). **Viewed** is not a state this product holds at all.
3. **There is no reminder.** Not in the `SigningProvider` seam, and not in M15's scope.
4. **A signer is not a user of this install.** The mock's avatars imply a picker over people the product knows. The people who sign a contract are on the other side of a deal: CTR-013 collects a name and an email.
5. **The seam carries a subject and no body.** The mock's "Message" has no field behind it.
6. **The mock draws no version picker**, and CTR-013 requires one: the sender picks which round of the primary document goes out, defaulting to the current one.
7. **The Signatures applet does not exist.** The spec for M15 is explicit that there is no new Signatories section and that the signers' home is the envelope row in the record's card, with a status chip beside the sub-bar (grill row E.5). DES-016's applet bar is a closed set of page-scoped panels, and DES-032's section strip is where a record's jobs get addresses.

### Decision

**1. The card takes its two-part name: "Approvals & signing".** DES-035 clause 3 said the name changes when the rows do, and envelope rows exist from this slice on. The heading is unconditional from here: it names what the card is for, not what one record happens to hold.

**2. The card holds two blocks, each its own table, and the sub-headings appear only when both are on screen.** An approval row and an envelope row share no column — one is about a person's decision, the other about a document's journey — so merging them into DES-035's five columns would give every row cells that mean nothing on it. The signing block is drawn **first**, above the roster, and only when the record has an envelope (grill row E.5's conditional, applied to the row as well as to the chip). A record with no envelope reads exactly as it did before M15: one table, no sub-headings. Sub-headings on a card drawing one kind of row would label an absence.

**3. The envelope row is four cells: Signers | Document | Status | Sent.** Each is a fact the seam answers. **Signers** comes first, because "who was asked to sign this" is the question the row exists for, and each signer takes the two-line anatomy the Approver cell already uses — the name, and under it the address the invitation went to. **Document** names what went out with "Version {n}" beneath it, and both halves go to the DES-035 clause 8 em dash together once that version has been erased (DOC-010): the row still says an envelope was sent, which is the fact it is there for. **Sent** is the short date with "by {name}" beneath it, the Decided column's shape.

**4. There is no action cell on the envelope row in this slice.** Voiding is the next slice's act, and DES-035 clause 9's rule stands: a control is absent rather than disabled, and a control for an act that does not exist yet is neither. _(Discharged by **DES-038** clause 1 with M15/4: the void exists, so the cell is drawn.)_

**5. The envelope pill takes the DES-005 paired families** (grill row X.2): `sent` is **warning**, `signed` is **success**, `declined` is **danger**, `voided` is **neutral**. `sent` is `warning` on purpose — it is the family `STAGE_PILL` already gives the **signature** stage, so the pipeline in the sub-bar and the row below it say the same thing about the same contract in the same colour, exactly as DES-035 clause 7 pairs a pending approval with the approval stage. `voided` is `neutral` rather than `danger`: withdrawing a send is a normal act on the way to a better one, and red would read as a failure where there was only a decision. The pill is drawn as every other status pill is: `rounded-pill px-2 py-0.5 text-xs font-medium`.

**6. The card head's badge and tally stay about the approvals.** The DES-020 count badge sits beside the tally, and the tally answers "where does sign-off stand" — one question, one number. Counting envelopes into it would put two questions in one figure. Where the signature stands is answered by the envelope row and by the chip in clause 11.

**7. "Send for signature" is the card head's first control, and it is absent in three cases.** It is a `secondary` Button with Lucide's `Send` glyph at 16, before "Apply group" and "Add approver", because sending is the act the card's new half exists for. It is not drawn at all when this install has no connector, when the record has no primary document, or when an envelope is already out. All three are DES-035 clause 14's rule again — a control whose dialog could only report that there is nothing to do is not a control — and the first one is also CTR-013's promise: an install with no connector must not advertise a feature it does not have, and the manual hand-off is not a lesser path that needs explaining.

**8. Sending opens a dialog, and the dialog is C12 with everything undrawable removed.** The version select comes first (`CONTROL_CLASS`, the record's own single-choice control), listing the primary document's chain **newest first** with the current round marked and selected — a send is consequential enough to name what it is sending rather than to imply it. Then the signers, as **two text boxes per row** with an "Add signer" button and a per-row remove that is absent on the only row; the mock's ordinals, avatars, and drag grip are not drawn, because there is no routing order and no picker (context 1 and 4). Then one optional line, labelled **Subject** where the mock says "Message": the seam carries a subject and no body in v1, so a box labelled "Message" would promise a letter the envelope cannot carry. Left blank, it names the contract. The confirm is the mock's own "Send envelope", the primary button.

**9. The dialog's own note rows are not drawn in this slice.** _(Discharged in full by **DES-039** clauses 5 and 6 with M15/5.)_ C12's "The executed file auto-files on the contract; stage advances to Active when everyone signs" and C20's webhook note each describe behaviour that lands in a later M15 slice. DES-035 clause 13's rule holds: a surface that explains a rule it does not yet apply is a surface that is wrong. Each is drawn when its slice exists, in the place the act is taken, exactly as DES-035 clauses 17 and 18 drew theirs. _(Half discharged by **DES-037** clause 4 with M15/3: the true half of C20's webhook sentence is now drawn under the signing block. C12's dialog note and the rest of C20's sentence stay withheld.)_

**10. A refusal is printed once, in the dialog.** DES-035 clause 12, unchanged: the send is raised from a dialog, so its refusal reports in that dialog's form and the card head's micro-state stays clear.

**11. The envelope status chip renders in the record's sub-bar, after the status pill and the archived pill, and only when an envelope exists** (grill row E.5). It carries Lucide's `PenLine` at **12px** — DES-034's carve-out from DES-008's 16/20/24, because the glyph is interior to a pill set in 12px text and a 16px glyph would read as the larger of the two — and the clause 5 family of the newest envelope, and it says a whole sentence — "Envelope sent", "Envelope signed", "Envelope declined", "Envelope voided". The glyph and the noun are what keep two pills side by side from reading as one: the left one names the contract's **status**, this one names its **envelope**. A contract signed by hand draws nothing here, which is grill row E.5's own "hidden for manual hand-off contracts".

**12. The C20 and C21 Signatures applet panels are not built.** The signers' home is the envelope row (clause 3), the envelope's state is the chip (clause 11), and the record's paper is the Documents section. An applet panel would be a fourth place to look for facts that are already on the page, and DES-016's bar is a closed set. C21's manual hand-off panel has nothing to draw at all: the manual path is an upload, a pin, and a status change, each of which already has its own surface.

### Rationale

The mocks were drawn for a signing product with routing order, per-signer telemetry, and reminders. CTR-013 chose a narrower thing on purpose — one envelope, one status, parallel signers, the executed copy back on the chain — and every departure above is that choice, drawn.

The two-block card is the smallest honest answer to "one card, two kinds of row". Merging them would give an envelope an Approver cell; splitting them into two cards would put two answers to "where does this contract stand with people" in two places on the same page. Two tables under one heading keeps the reading in one place and the columns meaningful.

`sent` being `warning` is the one colour choice worth stating twice. It is not a warning about a problem; it is the family the signature stage already wears, and the record must not say "signature" in one colour at the top of the page and another colour six inches down.

### Alternatives considered

- **One merged table over both row families.** Rejected: an envelope has no approver and an approval has no signers, so most cells on most rows would be an em dash.
- **A separate "Signing" card beside the Approvals card.** Rejected: DES-035 already spent the card's name on holding both, and two cards would make the reader decide which one answers "is this contract signed off and out".
- **Building the C20 Signatures applet.** Rejected with clause 12: it draws per-signer states and a reminder the product does not have, and the two facts it does hold are already on the page.
- **A disabled send control with a tooltip explaining the missing connector.** Rejected: it advertises a feature the deployment does not have and turns the zero-config manual path into something that needs apologising for (CTR-013).
- **Defaulting the version silently and offering no picker.** Rejected: CTR-013 requires the choice, and the version that goes out is what comes back executed and pinned.
- **A signer picker over the install's users.** Rejected: the people who sign are on the other side of the deal and have no account here. A picker would offer exactly the wrong set.
- **Keeping the mock's "Message" label.** Rejected with clause 8: the field is the invitation's subject line, and a label promising a message body would be a promise the seam cannot keep.
- **Counting envelopes into the card head's badge.** Rejected with clause 6: the badge and the tally answer one question together, and a number that means "asks plus sends" answers neither.
- **`sent` as `info` rather than `warning`.** Rejected: the stage pipeline six inches above already draws the signature stage `warning`, and two colours for one fact is the drift DES-034 exists to prevent.
- **`voided` as `danger`.** Rejected with clause 5: a void is a decision, and the next round goes out as easily as the first.

### Consequences

`ApprovalsSigningCard` is the component — DES-035's `ApprovalsCard` renamed, because the card now holds two row families and its name should say so. The contract record's `approvals` section stays the reference mount, and the loader reads the record's signing state beside the roster.

The record's sub-bar gains one conditional chip. No new tokens: the chip and the pill reuse the DES-005 families already shipped, and the dialog reuses the record's own `CONTROL_CLASS` field and `Dialog`.

`designs/contracts.pen` frames **C12**, **C20**, and **C21** are the reference, with clauses 3, 8, 9, 11, and 12 above recording where the build departs from them and why.

Grill rows **E.5** and **X.2** are discharged for signing: the chip is conditional as E.5 decided, and the envelope value-to-family mapping is clause 5.

The later M15 slices extend this record rather than replace it: the void action joins the envelope row's action cell, the decline and void reason joins the row, the executed file joins a signed row (grill rows H.C5 and H.C6), and each of the two note rows clause 9 withheld is drawn where its act is taken. _(The reason, the ending's date, and the first half of C20's note landed with M15/3 — see **DES-037**. The action cell, the void dialog, and the note's third status landed with M15/4 — see **DES-038**. The executed file, the rest of C20's note, and C12's dialog note landed with M15/5 — see **DES-039**, which discharges this list.)_

## DES-037: The envelope's ending on the row, and the webhook note (extends DES-036, DES-035)

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

DES-036 drew the envelope row for a slice in which an envelope only ever went out. M15/3 is the slice in which one comes back, so two facts the row had nothing to say about become facts it has to draw — **when** the envelope ended, and, on a decline or a void, **why**. How the ending reaches the record is CTR-013's M15/3 addendum; this record is only what the record then draws.

DES-036 clause 3 named four cells: Signers | Document | Status | Sent. Its own closing note scheduled this: "the decline and void reason joins the row", and clause 9 withheld two mock note rows until the behaviour each describes exists. The `designs/contracts.pen` frame **C20** note — "Signed, declined, and voided status arrives by webhook. The executed file auto-files and the stage advances to Active." — is one of the two, and its first half is now true.

### Decision

**1. The row takes a fifth cell, "Completed", and it prints the em dash while the envelope is out.** It is the Decided column's shape, in the Decided column's place, for the Decided column's reason: an ending has a date, and a row that has not ended says so the way DES-035 clause 8 already says it — one message, one em dash, no guessing. The date is the short date, `formatShortDate`, like every other date on the card.

**2. The reason is drawn under the status pill, not in a column of its own.** It is the **why** of the status, and the status is what the cell is already about: reading "Declined" and then hunting two cells to the right for the sentence that explains it is a worse reading than one cell that says both. It is `text-xs text-muted`, the secondary line every other two-line cell on this card uses. A sixth column was rejected for DES-035 clause 5's reason — the table shares its page with the Team card and has no width to spend — and because five of six rows would carry an em dash in it: only a decline and a void have a reason at all.

**3. Nothing is drawn where there is no reason.** The seam answers a reason only for a decline or a void, so the row does not have to ask which status it is looking at, and it does not print an apology for an ending that arrived with no words. The pill alone is the whole answer then.

**4. The C20 webhook note is drawn under the signing block, and only its true half.** "Signed and declined status arrives by webhook." at `text-xs text-muted`, beneath the signing table. The mock's sentence also promises a void, an auto-filed executed copy, and a stage advance; each of those lands in a later slice, and DES-035 clause 13's rule holds until it does — a surface that explains a rule it does not yet apply is a surface that is wrong. Each later slice extends the sentence when its own behaviour arrives. _(Extended by **DES-038** clause 9 with M15/4: the sentence now reads "Signed, declined, and voided status arrives by webhook." The executed copy and the stage advance stay withheld.)_

**5. The note is drawn only while an envelope is out.** It answers "do I have to come back and update this by hand", which is a question only a live row raises. Under a table of endings it would be an explanation of something that has already finished, which is DES-035 clause 17's objection to a permanent note under a roster, applied to the one place the note does belong.

**6. Nothing changes in the chip.** DES-036 clause 11 already gives the sub-bar a sentence per status, and a signed envelope already draws "Envelope signed" in the `success` family. The ending needed no new chrome there — which is the point of having spent the mapping once.

### Rationale

The row was drawn for an envelope in flight and had to learn to draw one that has landed. The two new facts split cleanly along the question each answers: **when** is a date, and dates on this card live in dated columns; **why** is a gloss on a status, and it belongs against the status it glosses.

The note is the smaller decision and the more easily got wrong. Drawing the mock's whole sentence would promise three behaviours this slice does not have; drawing none of it would leave a reader of a live envelope wondering whether the record updates itself. Half the sentence, under the live row only, is the honest amount.

### Alternatives considered

- **A sixth "Reason" column.** Rejected with clause 2: the table has no width to spend, and the column would be an em dash on every row that was signed or is still out.
- **The reason as a tooltip on the pill.** Rejected: it is the datum grill row H.C5 exists for, and a fact a reader has to hover to find is a fact the row did not carry.
- **The completed date as a third line in the Sent cell.** Rejected: three lines in one cell reads as a paragraph, and the two dates answer different questions — one is an act somebody took, the other is an ending that happened.
- **Drawing the mock's whole webhook sentence now.** Rejected with clause 4: it names the void, the auto-filed executed copy, and the stage advance, none of which this slice does.
- **The note permanently under the signing block.** Rejected with clause 5: after the ending it explains nothing about the rows above it.
- **A "waiting on the provider" spinner or live badge.** Rejected: live updates without a refresh are M30's (SSE), and a spinner for a thing that may take three days is chrome pretending to be progress.

### Consequences

`EnvelopeRow` grows one cell and one secondary line, and the signing table's header grows one column. Both facts are already on the record's signing answer, so no surface asks a new question to draw them.

`designs/contracts.pen` frame **C20** is the reference for the note row, with clause 4 recording which half of it is drawn and why. DES-036 clause 9 is half discharged: the C12 dialog note and the rest of the C20 sentence stay withheld until the executed-copy and void slices land.

Grill row **H.C5** is discharged: the decline's reason is on the row.

## DES-038: The envelope row's action cell and the void dialog (extends DES-037, DES-036, DES-035)

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

CTR-013 lets a live envelope be withdrawn: a mistaken or superseded send is voided where it was made, and the contract sends again. M15/4 is that slice.

DES-036 clause 4 left the envelope row with no action cell and said why: "Voiding is the next slice's act, and DES-035 clause 9's rule stands." This is the next slice, so the cell arrives.

`designs/contracts.pen` frame **C20** draws the act as **Void envelope**, beside a **Remind** action, on an applet panel DES-036 clause 12 did not build. The label is the mock's; the placement is not, because the signers' home is the row in the "Approvals & signing" card.

C20's own note row is the other thing this slice touches. DES-037 clause 4 drew half of the mock's sentence — "Signed and declined status arrives by webhook." — and scheduled the rest: "Each later slice extends the sentence when its own behaviour arrives."

### Decision

**1. The envelope row takes a trailing action cell, and it holds one overflow menu.** The shipped `DropdownMenu` on a `ghost` `icon` Button, exactly as the approval row's actions are drawn (DES-035 clause 9, DES-025's trigger). One item today — **Void envelope**, with Lucide's `Undo2` at 16 — is still a menu rather than an inline button, because the two row families sit under one heading and a reader who has learnt where one row keeps its acts has learnt where the other keeps its own. The cell is drawn only when the card is not frozen, as the roster's is.

**2. The menu's label names the round, not the record.** "Actions for the envelope sent on {date}" — the sent date, `formatShortDate`, which is the fact already in the row's Sent cell. A record can hold several rounds, so "Actions for this envelope" would give a screen-reader user the same label several times over on the same table.

**3. The trigger is absent for a viewer who may not void, and absent on a round that has ended.** DES-035 clause 9's rule twice. The three actors are CTR-013's: the person who sent it, the contract's Owner, and an Administrator — the approvals-cancellation audience, mirrored here over the facts the page already holds. Everybody else gets no trigger at all, because a greyed-out "Void envelope" on somebody else's send is an invitation to ask why and the answer is not a permissions lesson. An ended round draws none either: there is nothing to withdraw.

**4. Voiding opens a dialog, where cancelling an approval does not.** DES-035 clause 10 refused a confirmation on cancel because the ask goes, the activity entry keeps it, and asking again is one dialog away. A void is not that act: it ends a round that is already out with people who have no account here, and it collects a datum. Both reasons point the same way, and the second is decisive — the dialog exists to ask for the reason, not to ask "are you sure".

**5. The reason is required, and it is a labelled textarea.** "Reason", the `TEXTAREA_CLASS` the decision dialog's note already uses, bounded at `MAX_ENVELOPE_REASON_LENGTH`. Under it, one help line: "The provider records this with the withdrawal, and the record keeps it on the row." — which is the whole justification for making it required, said where it is asked for. An empty submit prints "Say why this envelope is being voided." in the form, the shape "Pick at least one approver." already takes.

**6. The dialog says what the act does before it does it.** "The signers can no longer sign this round. The contract can be sent again straight after." at `text-sm text-muted`, above the field. Two facts, and both of them what somebody hesitating actually wants: the round is lost, and nothing is lost for good. It is said where the act is taken, as DES-035 clauses 17 and 18 say theirs.

**7. The confirm is the mock's own verb, "Void envelope", and it is the primary button rather than the `danger` one.** DES-036 clause 5 gave the `voided` pill the `neutral` family because withdrawing a send is a normal act on the way to a better one; a red button on the act that produces that pill would say the opposite six inches above it. The verb rather than "Save", for DES-035 clause 10's reason.

**8. A refusal is printed once, in the dialog.** DES-035 clause 12 again: the void is raised from a dialog, so its refusal reports in that dialog's form and the card head's micro-state stays clear. The form keeps what was typed, so a refused void can be reworded rather than retyped.

**9. The C20 note row takes its third status: "Signed, declined, and voided status arrives by webhook."** DES-037 clause 4 withheld `voided` until the void's own slice, and this is it. The sentence stays true of the provider's feed rather than of the record's control: a void taken in the provider's own console arrives here exactly as a decline does, and that is the question the note answers. The rest of the mock's sentence — the auto-filed executed copy and the stage advance — stays withheld until its slice. Clause 5 of DES-037 is unchanged: the note is drawn only while an envelope is out.

**10. Nothing changes in the row's five cells or in the sub-bar chip.** The ending's date and the void's reason are already drawn by DES-037 clauses 1 and 2, and DES-036 clause 11 already gives the chip a sentence per status. A void produces facts these surfaces were built to draw, which is the point of having spent the mapping once.

### Rationale

The whole slice is two decisions: where the act lives, and what the act asks for. The first is settled by the card already having a row-action convention — a second convention on the same card, for the same kind of reader, would be a difference that means nothing.

The second is the one worth stating. A dialog for a void reads at first like a confirmation, and this record deliberately refuses confirmations on recoverable acts. It is not one: the field is the reason, the provider will not take a withdrawal without words, and the row draws them afterwards. That the dialog also slows the press down is a side effect, not the argument.

The mock's **Remind** is not built, for the reason DES-036's own context gives in item 3: there is no reminder in the `SigningProvider` seam and none in M15's scope. A one-item menu today is a menu that grows, not a menu that apologises.

### Alternatives considered

- **An inline "Void" button on the row.** Rejected: the roster's rows put their acts in a menu, and two row families on one card should not disagree about where a reader looks.
- **A `danger` confirm.** Rejected with clause 7: the record draws a void `neutral` and calls the next round easy, and a red button would contradict both.
- **An optional reason, defaulted to something generic.** Rejected: the provider records what it is given, and a record full of "Voided in OpenLaw" answers nothing the status pill did not already say.
- **A plain confirmation dialog with no field, and the reason typed nowhere.** Rejected: CTR-013 requires the reason and the row draws it. A void with no words is a round that ended for reasons nobody wrote down.
- **A disabled menu with a tooltip explaining who may void.** Rejected: DES-035 clause 9's rule, and the same objection it was written for.
- **Drawing the whole C20 sentence now.** Rejected with clause 9: the executed copy and the stage advance are still later slices, and DES-035 clause 13 holds until they land.
- **Building the C20 applet's Remind beside the void.** Rejected: there is no reminder behind the seam, and a control for an act the product cannot take is worse than an absent one.

### Consequences

`EnvelopeRow` grows a conditional action cell, and the signing table's header grows a screen-reader-only Actions column — both under the same `frozen` test the roster's already uses. `VoidEnvelopeDialog` joins the card's four dialogs.

The record's activity feed gains one sentence that selects on whether a person is behind the entry: an envelope voided on the record names the voider, and one voided in the provider's console reads passively, as signed and declined always have.

`designs/contracts.pen` frame **C20** is the reference for the label and the note row, with clauses 1, 3, and 9 above recording where the build departs from it and why. DES-036 clause 4 is discharged: the row has its action cell. DES-036 clause 9 and DES-037 clause 4 are further discharged: the webhook note now names all three statuses that arrive by webhook, and only C12's dialog note and the executed-copy half of C20's sentence stay withheld. _(Both landed with M15/5 — see **DES-039** clauses 5 and 6. Nothing of clause 9 stays withheld.)_

No new tokens.

## DES-039: The executed copy on the row, and the last two withheld notes (extends DES-038, DES-037, DES-036, DES-035)

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

M15/5 is the slice in which the signed file comes back on its own: the executed PDF is fetched, filed on the primary chain, and pinned, without anybody downloading anything (CTR-013, CTR-014). Two surfaces have been waiting for it.

DES-036's closing note scheduled the first: "the executed file joins a signed row (grill rows H.C5 and H.C6)". H.C5 landed with DES-037; H.C6 is this record.

DES-036 clause 9 withheld two mock note rows until the behaviour each describes existed, and DES-037 clause 4 and DES-038 clause 9 discharged them a status at a time. What is left is the executed-copy half of the `designs/contracts.pen` **C20** sentence and the whole of the **C12** dialog note — and this is the slice that makes both true.

### Decision

**1. The executed copy is drawn in the Completed cell, under the date, as a download.** The cell already answers "this round ended"; the signed file is what the ending produced, so the two facts belong together. It takes the two-line anatomy every other cell on this card uses — the date on top, the file under it — rather than a sixth column, for DES-037 clause 2's reason: the table shares its page with the Team card and has no width to spend, and the cell would be an em dash on every row that is still out, declined, or voided.

**2. It is a link, not a label.** "Shows the executed file" means a reader can open it, so the cell is an anchor to `documentDownloadHref` with the `download` attribute set to the file's own name — the anatomy the document panel's toolbar already uses. Lucide's `Download` at 16, `text-xs text-link`, and a truncating label: "Executed copy". The name of the file is not repeated in the label, because the chain already draws it and the row has no width for it.

**3. A signed row whose copy has not landed says so, in one of two sentences.** The fetch is a background job with the M12 derived-artifact states, so there are two honest answers besides the link. While it runs: "Filing the executed copy…". When it gave up: "The executed copy could not be filed. Upload it to the record instead." Both are `text-xs text-muted`, the secondary line every two-line cell on this card uses. The second one points at the path that still works — CTR-013's manual hand-off — rather than apologising, because DES-015 forbids the apology and the reader's next act is the upload.

**4. Nothing is drawn on a round that never owed a copy.** A live envelope, a decline, and a void draw the date cell alone. An executed copy was never coming for any of them, and a line about one would answer a question nobody asked — DES-037 clause 3's rule, said for the other cell.

**5. The C20 note takes its last half: "Signed, declined, and voided status arrives by webhook. The executed file auto-files and the stage advances to Active."** DES-037 clause 4 drew the first sentence and scheduled the rest; every behaviour it names now exists. DES-037 clause 5 is unchanged — the note is drawn only while an envelope is out, because it answers "do I have to come back and update this by hand", and that is a question only a live row raises.

**6. The C12 dialog note is drawn in the send dialog, above the form.** "When everyone signs, the executed file lands on this contract and the status moves to the active stage." at `text-sm text-muted`, under the title — the place and the shape DES-038 clause 6 gave the void dialog's own sentence, for its reason: a dialog says what its act does where the act is taken. DES-036 clause 9 is discharged in full.

**7. The note names the stage, not a status label.** The mock says "Active", and a team renames its statuses freely — the stage behind them is the fixed one (CTR-001). Promising a label an install may not have is the drift DES-035 clause 13 exists to prevent, so the sentence says "the active stage" and stays true of every configuration.

**8. Nothing changes in the pill families, the chip, or the row's other cells.** A signed envelope already draws `success` on the row and "Envelope signed" in the sub-bar (DES-036 clauses 5 and 11). The executed copy produces facts these surfaces were built to draw.

### Rationale

The whole record is one question — where does the file go — and the answer follows from what each cell is already about. The Document cell says what went out; the Completed cell says the round ended; the file is what the ending produced, so it goes under the ending. Putting it under the Document cell was the other candidate and it reads worse: that cell is about the round that was sent, and a third line under it would make one cell answer two rounds.

The two non-link states are the part worth stating. A background fetch means "signed" and "the file is here" are not the same moment, and a row that drew nothing in between would look broken to somebody refreshing. Saying which of the three states the record is in costs one muted line and removes the only reason to go and look in DocuSign.

### Alternatives considered

- **A sixth "Files" column.** Rejected with clause 1: DES-037 already refused a sixth column for the reason this one would also fail — no width, and an em dash on most rows.
- **A third line in the Document cell.** Rejected with the rationale: that cell is about the round that went out, and the executed copy is a different round.
- **Drawing the file name as the link label.** Rejected: the chain draws it, and on a cell this narrow it would truncate to nothing useful. "Executed copy" says what the file is, which is what the reader is looking for.
- **A `danger`-coloured failure line.** Rejected: a fetch that did not land is not an error on the record, and the manual hand-off is a first-class path (CTR-013). Colour would say something went wrong with the contract.
- **Silence when the fetch failed.** Rejected: the record would then hold a signed envelope and no signed file with nothing saying why, which is exactly the state the milestone exists to end.
- **A spinner while the fetch runs.** Rejected for DES-037's reason: chrome pretending to be progress, for work measured in seconds and hidden behind a refresh anyway. Live updates without a refresh are M30's.
- **Drawing the executed copy from the document's pin.** Rejected: a chain can hold two rounds both called `executed`, and a team that moves the pin by hand would change what an older row says it filed. The row draws its own round.

### Consequences

`EnvelopeRow` grows one secondary line in the Completed cell, drawn by a small `ExecutedFile` component with three branches. The signing answer carries the two facts it needs — the round's fetch state and its own executed version — so no surface asks a new question to draw them.

`SendEnvelopeDialog` grows one note under its title. The card's note row grows one sentence.

`designs/contracts.pen` frames **C20** and **C12** are the reference for the two notes, and both are now drawn whole. DES-036 clause 9 is discharged in full, and DES-036's closing note is discharged: every later-slice extension it scheduled has landed. Grill row **H.C6** is discharged: the executed file is on the signed row.

No new tokens.

## DES-040: The term on the Contract card — five fields, and the blanks the type forces (extends DES-017, DES-032)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

M16/1 puts CTR-006's term on the record: a term type, an effective date, an expiry, a renewal period in months, and a notice period in days. Grill rows **G.R3** (auto-renew), **G.R4** (notice period), and **G.R7** (days remaining) have been waiting for these columns since the contracts grill closed; **G.R6** (renewal cap) was removed there, and no such field exists to draw.

The mock draws all three inside the V12/V13 "Description" card as read-only facts — "Yes — 12-month rolling", "60 days", "248 days until expiry". That card is the one the record splits in two: DES-017 removed the page-level Edit toggle its facts were edited through, so the record's own columns became the editable **Contract** card and the free-form prose kept the **Description** name. The term goes where the rest of the record's columns went.

What the mock has no answer for is the rule between the fields. CTR-006 says an evergreen contract holds no expiry and only an auto-renewing one holds a renewal period, and the seam refuses both with named problem types (TECH-020). A surface has to decide what it draws where the record may not hold a value.

### Decision

**1. The five term fields are ordinary fields of the Contract card, in the order the term is read: type, effective date, expiry, renewal period, notice period.** They take the same anatomy every field on that card takes — a `Label`, the control, and the field's own micro-state beside it — and each commits on its own (DES-017, no carve-out). The type is a select and commits on its own change, exactly as status, priority, and risk do; the two dates are the shared `DatePicker` and commit when a day is picked (DES-048); the two counts are `Input`s that commit on blur or Enter and revert on Escape, exactly as the title does. The card grows one group; it grows no new pattern.

**2. A field the contract's type cannot hold is drawn as a fact with an em dash, not as a disabled control.** An evergreen contract draws no expiry box, and anything but an auto-renewing one draws no renewal-period box; in each place the label stays and the value is "—". This is DES-035 clause 9's rule read for a field rather than an act: a control whose every commit the seam would refuse is a dead end, and a disabled box invites somebody to work out why it is disabled. The label stays because grill row **X.6** already settled that schema-backed core fields render with an em dash rather than disappearing — the record's shape should not change under a reader when a select moves.

**3. The notice period is drawn whatever the type says.** A notice obligation sits on a fixed term as readily as on a rolling one (CTR-006), so this is the one term field with no condition on it. That it derives no deadline while there is no expiry is not the field's problem, and the field does not apologise for it.

**4. Days remaining closes the group as a fact, never a field.** It is `expiry_date − today`, derived at the seam and never stored, so the record draws the number it was given and counts nothing itself — a second copy of the rule on this page would drift the first time either half moved. It reads as an ICU plural sentence rather than a bare integer: "45 days left", "Expires today", and — for a term that has run out — "10 days past expiry". Past due counts the other way rather than clamping at zero, because a lapsed term is a fact the record has to be able to say, and it is exactly the fact the milestone's pending-confirmation banner is built on.

**5. The blank is the same em dash in all three places.** One ICU message, so a term field the type forbids and a countdown with no expiry cannot come to look like two different kinds of absence.

**6. Nothing draws a renewal cap.** Grill rows **G.R6** and **I.B7** removed it and CTR-006 kept no column for it. A surface that drew one would be drawing a field the model does not have.

**7. The derived notice deadline is answered but not yet drawn.** The seam computes it (expiry minus the notice period) from this slice on, and the surfaces that show deadlines are M16's later slices. DES-035 clause 13's rule holds: a surface that explains a rule it does not yet apply is a surface that is wrong, and a deadline drawn in isolation, away from the expiry and the key dates it belongs beside, is the same mistake in a smaller frame.

### Rationale

The term is data on the record, and the record already has one editing model. Making it a set of ordinary fields costs no new pattern, gives each write its own activity entry for free, and keeps the audit granularity DES-017 exists for — which matters more here than anywhere else on the card, because "who moved the expiry, and when" is the question a missed renewal is investigated with.

Absence is the design question this record actually answers. The three candidates were a disabled control, a hidden field, and a drawn blank. A disabled control makes the reader diagnose the product; a hidden field makes the card's shape jump when a select moves; a drawn blank says the true thing — the record holds nothing there — and holds the layout still.

### Alternatives considered

- **A Term card of its own.** Rejected for this slice: five fields do not earn a card, and the mock puts them among the record's other facts. The timeline card is a different surface with a different job, and it takes its own decision.
- **A disabled expiry box on an evergreen contract.** Rejected with clause 2.
- **Hiding the label as well as the control.** Rejected: grill row X.6 fixed the em-dash convention for core fields, and a card that reflows on a select is harder to read than one that does not.
- **Drawing the type and the renewal period as one sentence, as the mock does** ("Yes — 12-month rolling"). Rejected: they are two columns and two commits, and a composed sentence cannot be edited in place.
- **A bare integer for days remaining.** Rejected: "45" needs a unit and a direction, and a negative one would be unreadable. The plural sentence carries both, and it is locale copy rather than code (DES-013).
- **Computing days remaining in the browser.** Rejected: the seam already answers it, and two derivations of one number is one of them drifting.

### Consequences

`ContractRecord` grows one `TermField` component — a label, a date picker or number input, and its micro-state — plus one select and two `ReadOnlyField`s. The term's four typed fields hold their own drafts. A term-type commit re-seeds all four, because a type change clears what the new type cannot hold and the answer carries more empty boxes than the request did; a typed field's own commit re-seeds only its own box, so a sibling box's in-progress edit survives the answer landing beside it.

The activity narrator gains five changed-key labels and renders the term type through its own ICU message, so the feed says "Evergreen" where the column says `evergreen`.

Grill rows **G.R3**, **G.R4**, and **G.R7** are discharged. **G.R5** (last renewal) and **G.R6** stay as they were: the first waits for the confirmed roll that writes it, the second is removed for good. No new tokens.

## DES-041: The Term timeline card — the gutter, the two marks, and the open end (extends DES-040, DES-032, DES-012)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

M16/2 draws the term the record already holds (DES-040) as a picture: the V12/V13 "Timeframe" card the contracts grill kept in section I. The grill stripped it before the build reached it — no section icon (I.H1), no zoom switcher (I.H3), no renewal cap (I.B7), no risk threshold (I.B8) — and it added one mark the mock never had: the derived notice deadline, beside the today line (I.X2).

What the mock cannot answer is where the bars come from. It draws three named term bars and a last-renewal marker, and the grill's own rows I.B3–I.B5 say those are one bar per **confirmed** renewal, read from the activity log. The confirmed roll is a later slice of this milestone; nothing in the record read answers it yet. So this card has to decide what a term with rolls in it looks like when the only rolls the record can prove are the ones its dates imply.

The rest is the same question every chart asks and this one has to answer at the WCAG 2.2 AA floor (DES-011): what does a reader who cannot see the picture get.

### Decision

**1. The card's own name is "Term timeline", not the mock's "Timeframe" and not grill row I.H2's "Term".** DES-040 put the five term fields on the Contract card, so a second heading reading "Term" would name two surfaces on one page. "Timeframe" is not the word the record uses anywhere else; **term** is the word CTR-006 and `CONTEXT.md` use, and the card is that term drawn along time.

**2. The periods are the ones the record's dates imply, walked back from the expiry.** A fixed term is one period. An auto-renewing term steps back from `expiry_date` by `renewal_period_months` until the step would land on or before `effective_date`; each step is a boundary, and what is left at the front is the initial term. Backwards rather than forwards because the expiry is the date a roll advances (CTR-006): the record holds where the term stands **now** and where it started, and the boundaries between are what those two dates and the roll length say they are. Forwards from the effective date would draw a run the record has not reached and stop short of the expiry it does hold.

**3. Confirmed rolls are a different datum, and they are not drawn here.** Grill rows **I.B3**, **I.B4**, and **I.B5** read the activity log, and the log entry they read is written by the confirmed roll this milestone has not built yet. Drawing an implied period and a confirmed one in the same fill would say the record can prove something it cannot. They join the card with the slice that writes them, along with the last-renewal marker **G.R5** already waits for.

**4. Labels sit in the gutter and the bars carry none** (grill row I.X1). Each gutter row names its period — "Initial term", "Renewal 1" — and gives the two dates its bar spans, formatted through the DES-014 helpers. This is the card's readable half: the plot is a picture of text that is already on the page, so a reader who cannot see it loses the shape and keeps every fact. The bar list is `aria-hidden` for exactly that reason — announcing it would read the same term twice.

**5. Two marks cross the plot, and each says what it is where it stands.** The today line takes the mock's green rule and its pill at the plot's foot (I.X2). The derived notice deadline takes an orange rule and a pill at the plot's head carrying the date it falls on, so the two pills can never collide however close their dates are. The deadline's pill shows the date alone, because the key's swatch is what names the color; a reader who cannot see the swatch is told in place, by text only a screen reader reads.

**6. The key names the fills the plot is using, and nothing else** (grill row I.X3, three swatches). "Initial term" always; "Renewals" only when a roll is drawn; "Notice deadline" only when the record derives one. A swatch for a family the card is not drawing would describe a rule it is not applying — DES-035 clause 13's rule, applied to a legend. Today keeps no key entry: its pill already carries its own name, and a second copy would be the only duplicated string on the card.

**7. An evergreen term draws one open period that runs off the end of the plot.** The bar reaches the plot's trailing edge and ends in a chevron rather than a cap, its gutter row reads "From {date}" rather than a range, and the scale's trailing caption reads "No end date". The plot's scale is widened past the last date the record holds so the open bar has somewhere to run; that room is scale and never a date, and the card prints it nowhere.

**8. A term the record cannot draw gets the section's own empty line, and the line names the date that is missing.** "No effective date on this contract yet.", "No expiry date on this contract yet.", or "No term dates on this contract yet." — the `documents.empty` and `approvals.empty` anatomy, one `<p>` in the card's body. A period needs a start, and every period but an evergreen one needs an end; with either missing there is no honest shape, and a chart of one date is a broken chart with a scale.

**9. Nothing draws a renewal cap** (grill rows **G.R6** and **I.B7**). The card walks at most sixty rolls before it stops counting, and that guard is a render limit and not a cap: it exists because a one-month roll across a mistyped century implies thousands of bars, and past it the initial term simply absorbs what is left — the same shape a record with no renewal period draws. No column backs it, nothing marks it, and no reader is told a term has a limit.

**10. Today is placed by the reader's own calendar; the count beside it stays the seam's.** DES-040 clause 4 keeps days remaining at the seam because it is one number two places could disagree about. A line's position is not that number — it is a place on a scale this card owns — and the day it is placed on is the reader's, resolved through the same stored-override → browser-detected → UTC seam every date on the page reads (DES-014). The accepted tension: a reader whose calendar day differs from the server's sees a line one day off the count above it. One day, on a mark whose whole job is "roughly here", against a picture that would otherwise need a clock shipped down the wire.

**11. The scale is fit-to-term and widened to hold every mark** (grill row I.H3 removed the zoom switcher). A contract whose term ran out last year still shows where today is, rather than clipping it off the end. The scale's two ends are captioned with their dates under the plot.

**12. The two columns hold at every width** (DES-012). The gutter narrows on a small container and the plot takes the rest; neither stacks, because the marks are positioned across the plot and a stacked layout would cut them from the rows they cross. The bars are geometry, so their offsets are inline percentages — the only numbers on this card that are not a spacing token.

### Rationale

The card exists to answer one question — where in the term do we stand — and the two marks are that answer. Everything else on it is context for reading them.

Deriving the periods rather than storing them is the same call DES-040 made for days remaining, one level up: a shape held anywhere would be a second copy of the term, and the first edit to the expiry would put the two out of step. Nothing here is seeded, so nothing here can go stale.

The gutter is what makes the card pass its accessibility floor without a parallel description of itself. A chart whose only readable content is a caption saying "chart" has to be described twice and drifts between the two. This one has its content in the DOM as text, and the picture is a second reading of it.

### Alternatives considered

- **Bars stepped forward from the effective date.** Rejected with clause 2: it ends where the roll length says rather than where the record's expiry says, so the drawn term contradicts the field above it.
- **One segmented track instead of a row per period.** Rejected: the gutter is where the labels live (I.X1), and a single track has one gutter row for N periods.
- **A generic "Markers" swatch, as the mock's third swatch is generic.** Rejected: two marks, two colors, two facts. One swatch standing for both would be the only place on the card where a color means more than one thing.
- **A quarter-tick axis, as both mocks draw.** Rejected: the ticks are fabricated dates, and every date the card holds is already printed in the gutter. The scale's two ends are captioned instead.
- **A "renewal pending confirmation" treatment on a term that has run out.** Rejected here: that is a derived state with a banner and a call to action of its own, and it belongs to the slice that builds it. This card draws the same past-expiry term it draws any other.
- **Deriving today from the expiry minus days remaining**, which would put the line on the seam's clock exactly. Rejected: it works only where an expiry exists, so an evergreen contract would need a second rule, and two rules for one mark is worse than the one-day tension clause 10 accepts.
- **A disclosure that collapses the card.** Rejected: the mock's caret is the V12 card chrome grill row X.1 already stripped from the record's cards.

### Consequences

`ContractRecord` grows one `TermTimelineCard`, mounted last on the Overview — the mock's own order, where the Timeframe card closes the section. It takes the saved row and holds no state.

`termPeriods()` joins the contracts vocabulary in `apps/web/src/lib/contracts.ts`, and `civilToday()` joins the DES-014 helper layer, which is where any surface placing today among stored civil dates now reads it from.

Thirteen ICU messages, all new. No new tokens: the bars and marks are fills from four existing status families — info for the initial term, assigned for the rolls, success for today, severe for the notice deadline — used as fills on `bg-control` rather than as paired text, each clearing the 3:1 non-text floor in all three themes. Color is never the sole carrier: every fill is named in the gutter or the key.

Grill rows **I.H1**, **I.H2**, **I.H3**, **I.X1**, **I.X2**, **I.X3**, **I.B1**, **I.B2**, **I.B6**, **I.B7**, and **I.B8** are discharged. **I.B3**, **I.B4**, and **I.B5** stay open, waiting on the confirmed roll — the same wait **G.R5** is in.

### Addendum (2026-08-21, [#390](https://github.com/juggernog20/OpenLaw/issues/390)) — the second `shiftMonths` is deliberate, and two is the ceiling

`termPeriods()` needs whole-month arithmetic to walk the roll boundaries backwards from the saved expiry, so `apps/web/src/lib/contracts.ts` carries a private `shiftMonths`. The API carries one too, exported from `apps/api/src/lib/contract-term.ts`. They are the same fourteen lines with the same month-end clamp, and the API-and-domain-core review asked whether that is drift waiting to happen. **It is not, and this clause is why.**

**The two answer different questions, and only one of them is a promise.** The API's `shiftMonths` computes the roll date the record will actually take — the value CTR-006 writes and CTR-007 confirms. That number is the seam's, it is stored, and the web app reads it rather than deriving it. **No confirmable date on this card is computed in the browser.** The timeline's copy walks _backwards_ from a date the API already gave, to place marks on a gutter. If the two implementations ever disagreed by a day, the record would still renew on the API's date; the timeline would draw one bar boundary a day out, on a card whose own clause 10 already accepts a one-day tension about where "today" sits.

**Hoisting it to `packages/shared` was rejected.** The shared package holds the wire vocabulary — strings and bounds both ends must say identically (TECH-016, TECH-020). Calendar arithmetic is not vocabulary, and moving it there would make a fourteen-line pure function a published contract with a version and a consumer list, to save a duplication that costs nothing when it drifts. It would also invite the mistake this clause exists to prevent: a surface computing a confirmable date locally because the helper was conveniently to hand.

**Two is the ceiling.** A third surface needing month arithmetic is the trigger to reopen this and hoist all three into one home. Until then, each copy stays where its caller is, and each carries a comment saying the other exists.

## DES-042: The Key dates section — one union, one Source chip, and the order as the answer (extends DES-035, DES-032, DES-040)

- **Status:** Accepted
- **Date:** 2026-08-17
- **Amended:** 2026-08-19 — the Due column is withdrawn (clauses 5, 9, 10)

### Context

CTR-009 gives a contract free-form **key dates**: a date, a label, an optional note, added by the team beside CTR-006's typed term. It also commits the surface they land on — "deadline surfaces show the union of term-derived dates and key dates; earliest upcoming = next deadline". M16/3 builds both.

`designs/contracts.pen` draws it as **C6 — Contract detail · Key dates**: its own tab in the record's section strip, a toolbar with "4 upcoming · 1 past" on the left and an "Add date" button on the right, then a six-column table — Date, Event, Source, Reminders, Due, Owner — with a two-line date cell, a `Derived` / `Key date` chip in Source, a relative pill in Due, and an avatar in Owner. A note row under the table reads "Term-derived dates update automatically when term fields change. All dates land in the daily digest and notify at the configured offsets."

Three of the things the mock draws have no datum behind them, and one thing the union needs is not drawn:

1. **There is no owner on a key date.** CTR-009 modelled `date + label + note` and #285 settled the open question the matters grill left: the Owner column is stripped, not adopted.
2. **There is no per-date reminder schedule.** **NOT-004** fixed a single global admin-configurable offset list applied to every tracked date and explicitly rejected per-date schedules. The mock's "7d · 1d · same day" cell is that global contract drawn per row.
3. **Nothing fires yet.** Reminders, the bell, and the daily digest are M18 (NOT-003). The note row's second sentence describes delivery this milestone does not build.
4. **A key date carries a note, and the mock has no cell for it.**

DES-035 clause 1 made Approvals a fourth section on the DES-032 strip. This is a fifth.

### Decision

**1. Key dates is a fifth section on the DES-032 strip, at `/contracts/42/key-dates`.** It follows Approvals, as the C6 mock's own tab order does. DES-032 clause 1's enumeration is extended for the second time, and clause 6's ceiling is untouched: that ceiling is on permanent **strips**, and this is a link inside the strip the record already has.

**2. The section is one self-contained card, drawn as Documents and Approvals are drawn.** The `bg-raised` card with a `bg-section-header` head; the heading, the DES-020 count badge, the write micro-state, and the section's own control in that head; the table under it; and a plain empty line when there is nothing to draw. One section anatomy on the record, so a reader who has learnt the Approvals section has learnt this one.

**3. The card draws the union, not the rows.** All three CTR-009 sources land in one table — the key dates, the contract's expiry, and the derived notice deadline — because the question the surface answers is "what is the next date on this contract", and that question does not care which column a date came out of. A separate list of key dates with the term's two dates printed above it would make the reader do the merge the decision exists to do for them.

**4. Order, the day counts, and which date is next are the seam's answer, and the card recomputes none of them.** DES-040 clause 4 kept days remaining at the seam for one number; this keeps a whole ordering there for the same reason. The union arrives ordered — what is still ahead nearest-first, then what has gone by most-recently-first, which is the C6 mock's own row order — with `daysAway` on every entry and exactly one entry marked as next. A second copy of that rule on this page is the copy that drifts the first time a date moves.

**5. The columns are the mock's, minus the two with nothing behind them: Date, Event, Source, Due, and a trailing action cell.** Owner goes (clause context 1) and Reminders goes (context 2). Neither leaves a blank: a column drawn empty asks the reader to work out what is missing, and the answer here is "nothing — the product does not have this".

_Amended 2026-08-19._ **Due goes too, and the columns are Date, Event, Source, and the action cell.** It is the third of the mock's six to be dropped, and the first dropped for a reason the mock could not have known: the column held no datum of its own. Owner and Reminders were cut because the product has nothing to put in them; Due is cut because everything in it was the Date cell said a second way. See clauses 9 and 10, both withdrawn.

**6. The Date cell is one line through the DES-014 short-date helper, not the mock's two.** The mock splits "Oct 2" over "2026" because it always prints the year. The standing helper already decides when a year is needed — it grows one exactly when the date is not in the current year — and a second rule for this one cell would be a second rule to keep true.

**7. The Event cell names the row, and the note is its second line.** A key date says what the team called it. The two derived rows are named here in the record's own copy, because the seam holds no label for a date it did not store (DES-013): "Current term expires", and "Renewal notice deadline — 90 days before expiry", which is the mock's own sentence with the record's own notice period in it. The note sits under the name at `text-xs text-muted` — the secondary line DES-035 clause 5 already spends on "a fact about this row", rather than a sixth column on a table that has no width for one.

**8. Source is the mock's chip and answers one question: did the team write this down, or did the term produce it.** `Key date` takes `bg-control` with a `border-border-muted` hairline; `Derived` takes the neutral status family. Both derived rows share the one word — telling the expiry from the notice deadline is the Event cell's job, and a third chip reading would make the column answer two questions at once.

**9. Due carries the distance, and past is one word.** An upcoming row reads the seam's `daysAway` through `formatDayDistance` — "in 3 days", "in 8 weeks", "in 5 months" — which steps the unit up as the distance grows, so a date most of a year out never reads as "in 291 days". A row behind us reads "Past", the mock's own word: how far behind is the Date cell's answer, and this column exists to say what is coming.

_Withdrawn 2026-08-19._ **Neither half survived its own sentence.** "Past" was already answered by the Date cell, as the clause itself admits, and by the row order clause 4 fixes — past rows come after upcoming ones. The distance was the same date in a second unit, under a header that read as a second date column: a table with **Date** and **Due** side by side asks the reader which one is the deadline, and the answer is that both are. A reader who can see "12 Mar" can see that it is coming. The column is gone; `formatDayDistance` goes with it, having no other caller.

**10. Exactly one row is the next deadline, it takes the `warning` pill, and it says so in words.** The pill families are `warning` for the next date and `neutral` for every other, which is what the C6 mock paints. Colour is never the sole carrier (DES-011), so "Next deadline" is drawn under the pill at `text-xs text-muted` on the one row that has it. `warning` rather than `danger` because a date that is coming is not a failure — CTR-006's engine is notify-only, and nothing on this surface asserts that a lapse happened.

_Withdrawn 2026-08-19._ **The order already names the next deadline, so the surface stops naming it twice.** CTR-009 commits that the earliest upcoming date is the next deadline, and clause 4 makes the seam sort on exactly that: the next deadline is the first row. A mark on the row a reader's eye lands on first adds a word, not a fact. The seam still answers `isNext` — no contract changes, and a surface that needs the mark out of table order can still take it — but this table does not draw it, and DES-011 has nothing left to police here because no colour is carrying a meaning any more.

**11. Row actions live in one overflow menu, and the two derived rows have none at all.** The menu is DES-035 clause 9's — the shipped `DropdownMenu` on a `ghost` `icon` Button labelled "Actions for {label}" — holding **Edit date** and **Remove date**. The expiry is edited on the Overview's Contract card (DES-040) and the notice deadline is a subtraction rather than a field, so neither offers a trigger. Absent, never disabled: a greyed-out "Edit" on the notice deadline is an invitation to work out why, and the answer is a lesson about derivation.

**12. Adding and editing are one dialog; removing is one press.** A date, a label, and a note are one act — a date nobody named is a date nobody can act on — so they commit together in the compound edit DES-017 carves out of the inline rule, and the same form does both jobs with its title and its confirm changing. Removing collects nothing and destroys nothing that matters: the row goes, the activity entry keeps it (DD-017), and putting the date back is one dialog away. That is DES-035 clause 10's reasoning, applied to the same kind of act.

**13. The mock's note row is not drawn at all.** Its first sentence — term-derived dates move when the term does — is what the Source chip already says, permanently, on every row. Its second describes M18's digest and offsets, which nothing here does yet: DES-035 clause 13's rule holds.

_Amended 2026-08-17._ This clause first kept half the note, in the dialog: "Every tracked date uses the same reminder offsets, set once in Settings." — NOT-004 said where the absence is felt. The sentence is withdrawn, because it named a screen that does not exist. M16 ships no reminder and no offset control, so a reader who went looking for Settings found nothing there, and the note that was meant to answer a question created a worse one. It is the same rule this record applies to the mock's Remind cell and DES-043 clause 11 applies to the Renew dialog's foot note: copy about a delivery arrives with the delivery. NOT-004's one-list rule is said again, in the dialog, when M18 gives it somewhere to point.

**14. The empty line names both absences at once.** "No key dates on this contract yet, and no term dates to show beside them." — the `documents.empty` and `approvals.empty` anatomy, one `<p>` in the card's body. It is drawn only when the whole union is empty, because a record with an expiry and no key dates has a table to draw.

### Rationale

The union is the decision. CTR-009's own sentence puts three sources on one surface, and every alternative shape makes the reader merge them: a key-dates table with the term above it, a "next deadline" callout over a list, a section per source. One ordered table answers the question in one read, and the Source chip is the whole cost of mixing them.

Stripping the Owner and Reminders columns is the mock's largest departure and the easiest to defend: both were drawn before the decisions that removed them, and drawing a column whose values the product cannot produce is worse than a narrower table.

The next deadline being the seam's is the same call DES-040 clause 4 made one level down. Ordering, counting, and marking are one rule, and the surface that draws them is not where the rule should live — particularly here, where the order is the answer.

### Alternatives considered

- **Key dates as a card on the Overview.** Rejected: the C6 mock gives them a tab, the Overview already holds three cards, and a deadline list is a job somebody opens the record to do rather than something they read past.
- **A separate list of key dates with the expiry and the notice deadline stated above it.** Rejected with clause 3: the reader would merge them, and the "next deadline" would then be a fourth thing to state.
- **Keeping the Owner column with the record's Owner in it.** Rejected: it would draw one name on every row of every contract, which says nothing, and it would read as the per-date owner CTR-009 does not have.
- **Keeping the Reminders column, drawn from the global offset list.** Rejected: identical content on every row of every contract is not a column, and the setting it renders lives in Settings (NOT-004). The dialog says it once instead.
- **A `danger` pill on a date that has passed.** Rejected with clause 10: CTR-006's engine is notify-only and never asserts a lapse. A past date is a fact, not an alarm, and a record with three old milestones on it would read as three failures.
- **Sorting the whole union by date, past dates included.** Rejected: it buries what is coming under what is done, which is the opposite of the surface's job, and it contradicts the C6 mock's own row order.
- **A confirmation on remove.** Rejected: the entry keeps the date (DD-017) and re-adding it is one dialog. Confirmations spent on recoverable acts are confirmations nobody reads on the unrecoverable ones.
- **Editing a key date inline, cell by cell.** Rejected: a label is meaningless without its date, and DES-017 carves the compound edit out for exactly this pairing.
- **Deriving the day counts in the browser from each date.** Rejected with clause 4: the seam already answers them and it is the seam that ordered the list.
- **Keeping the distance, folded under the date as a second line** (considered 2026-08-19, with the Due column's withdrawal). Rejected: it moves the duplication rather than removing it, and clause 6 already spent the Date cell's second line question once. If a reader is found who needs the distance, the place to put it is that second line — but nobody has asked for it, and a row that repeats itself is not made shorter by stacking.
- **Renaming Due to "In" or "Countdown" and keeping the column** (same date). Rejected: a better header does not give the column a datum. The problem was never the word.

### Consequences

`KeyDatesCard` is the component and the contract record's `key-dates` section is the reference mount. `RECORD_TABS` grows by one and the loader reads the union beside the record, its paper, its folders, and its roster.

A term commit on the Overview — the term type, the expiry, or the notice period — re-reads the union, because two of its three rows are the term. It re-reads rather than patching, for clause 4's reason.

`formatDayDistance()` joins the DES-014 helper layer: a day count in, the largest unit that still reads out. It takes a count rather than a date precisely because the count is the seam's.

_Amended 2026-08-19._ `formatDayDistance()` is **removed** with the Due column. It had one caller, and a helper layer that keeps a formatter nothing formats with is a layer that has to be read before it can be ignored. `formatDeadline()` is the surviving relative-date helper, and a surface that later wants a distance can bring the function back with its caller.

The record now has five sections. `designs/contracts.pen` frame **C6 — Contract detail · Key dates** is the reference, with clauses 5, 6, 7, 8, 9, 11, and 13 recording where the build departs from it and why.

Thirty-four ICU messages, all new — thirty on the card and its dialog, three on the activity narrator's new verbs, and one on the tab. No new tokens: the pills and chips reuse the DES-005 families already shipped, and the card reuses the Approvals section's own surfaces and its menu trigger.

_Amended 2026-08-19._ Three of those messages go with the column — `keyDates.column.due`, `keyDates.past`, and `keyDates.next` — leaving thirty-one. `DEADLINE_PILL` goes too: the neutral and warning families are still shipped, but this surface no longer distinguishes rows by colour at all.

The activity narrator gains three verbs — added, edited, removed — and three changed-key labels (`date`, `label`, `note`). Each sentence names the date it is about, because a removal deletes the row and the entry is then all that is left of it.

## DES-043: The renewal-pending banner, the Renew dialog, and the confirmed-renewal row (extends DES-035, DES-040, DES-017, DES-009)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

M16/4 builds CTR-006's one waiting state and CTR-007's first renewal vehicle. An auto-renewing contract that passes its expiry un-actioned says so rather than silently advancing — the engine is notify-only, so the record waits for a person. A Member+ user with reach opens the Renew dialog, confirms the roll, and the same record's expiry moves. What the roll leaves behind is one activity entry, and that entry is the whole of the record's renewal history: the confirmed-renewal row **DES-035 clause 4 reserved for this milestone**, and the "Last renewal" fact grill row **G.R5** has been waiting for since the contracts grill closed.

`designs/contracts.pen` draws it as **C9 — Contract detail · Renewal pending confirmation**: `S9 RenewBanner`, a 36px `status-warning` strip between the top nav and the sub-bar, carrying a `rotate-cw` glyph, the sentence "Renewal date passed — pending confirmation. The term does not advance until a human confirms.", and a trailing "Review renewal"; and `S9 Overlay`, a "Confirm renewal" dialog whose body is a four-option radio list — confirm the roll, paper as amendment, create child contract, new successor contract — over a foot reading "Logged to history. Reminders stop once confirmed."

Three things about the mock do not match what this slice can honestly draw, and one thing the slice needs is not drawn:

1. **Three of the four vehicles do not exist yet.** The routing that builds the amendment, the child contract, and the successor is the next slice.
2. **Nothing fires.** "Reminders stop once confirmed" describes M18's delivery (NOT-003), which this milestone ships no part of.
3. **The mock has no way to change the proposed date**, and CTR-007 requires one: a roll whose dates shifted in negotiation is recorded as it really landed.
4. **A record may carry two banners at once.** DES-009 already owns this strip, and a confidential contract can be pending a roll.

### Decision

**1. The pending state is drawn as a banner and nothing else, because it is a reading of the record's own dates.** CTR-006 says it in as many words: a derived state, not a status. No pill is drawn beside the status, the stage pipeline does not move, and no list column reports it in this slice. The predicate is the seam's — auto-renewing, not archived, expiry behind us — and the record draws the boolean it was given, exactly as DES-040 clause 4 has it draw days remaining. A second copy of the rule on this page would be the copy that drifts the first time either date moved.

**2. The banner takes DES-009's strip and its whole anatomy, in the `warning` family.** The same 36px height, the same `px-page-x` gutters, the same bottom rule, the same leading glyph plus statement and trailing call to action, and the same named region so the statement is reachable from the landmark list after half an hour inside the record. `warning` rather than `danger`: a term that ran out un-actioned is a thing to attend to, not a failure that has already happened, and CTR-006's engine asserts nothing about a lapse. `status-warning-fg` on `status-warning-bg` is a pair the contrast gate already checks at the body floor in all three themes.

**3. There is no dismiss, and the component takes no prop that could add one.** DES-028's rule for the same strip, and it is stronger here: the missed auto-renewal is the failure the whole milestone exists to stop, and a banner that can be closed is a banner that is closed.

**4. Both banners are drawn when a record carries both, and confidentiality leads.** Confidentiality governs who may read the page at all; this one is about one date on it, so it reads second. The strip's height is one token — `--height-record-banner`, renamed from `--height-confidential-banner` — because two banners of one strip must not be able to disagree about how tall it is.

**5. The banner's call to action is the mock's own word, "Review renewal", and it is absent for a viewer who may not write.** "Review" is accurate of what the dialog does even with one exit: it proposes a date, lets the reader change it, and takes a confirmation or a cancel. A read-only viewer gets the statement and no control at all — DES-035 clause 9's rule, and DES-028's for the same strip.

**6. The Renew act is also a control in the Approvals & signing card's head, and that is the record's permanent way in.** A roll writes a renewal row, so the control that raises it sits where those rows land — exactly as "Send for signature" sits beside the envelopes it makes (DES-036 clause 7). It is absent, never disabled, on a record that cannot roll: a contract that does not auto-renew, or records no expiry to advance, has no term for a roll to move. Whether the term has **lapsed** is deliberately not one of those conditions — confirming a roll before the notice deadline is a normal act, and the banner is the reminder rather than the gate.

**7. The dialog lives on the record, not inside that card.** The banner is chrome and is on screen in every section, so the dialog it raises cannot live in a card that only the Approvals section mounts. `SoftGateDialog` already makes this move for the same reason, and it sits beside it.

**8. The mock's radio list is not drawn, and the one vehicle's own sentence is drawn instead.** A group of one radio is a control that decides nothing, and three options that cannot be picked would advertise acts the product does not have (DES-035 clauses 9 and 13). What the selected option says — same record, the expiry advances — becomes the dialog's own statement of what pressing the button does. The list returns with the slice that builds the other three. _(Discharged by **DES-044** (2026-08-17, M16/5): the other three exist, so the list is drawn.)_

**9. The dialog collects one thing the mock does not draw: the new expiry.** A date `Input`, labelled "New expiry date", seeded with the expiry the **seam** proposes and editable before the press. The proposal is answered rather than computed here for DES-040 clause 4's reason, applied to a date instead of a count: the month arithmetic a roll needs — a term ending on the 31st rolled into February lands on the 28th — is one rule, and a dialog holding a second copy of it is the copy that drifts. Under the box, at `text-xs text-muted`, the term as it stands: "The term currently runs to {date}." That is what the person is moving from, said where they are moving it.

**10. The confirm carries the saved expiry beside the new one, and the seam refuses on it.** This is the whole of "exactly once under concurrent confirms": the request states the expiry it was raised against, the seam compares it under the contract's row lock, and the loser of a race is refused by name rather than rolling the term a second time. The dialog therefore sends the record's own saved value and never the draft in any box on the page.

**11. The dialog says what the act does, and only the true half of the mock's foot note.** "Recorded on the record's activity. The contract's status and stage do not change." at `text-xs text-muted` beside a `History` glyph — two facts, and both of them what somebody hesitating actually wants (DES-038 clause 6's pair). The mock's second sentence, that reminders stop once confirmed, describes M18's delivery and stays withheld until that slice exists; DES-035 clause 13's rule holds.

**12. The confirm is the verb, "Confirm renewal", and it is the primary button.** DES-035 clause 10: an assertion that a term renewed should not be pressed by reflex, so the button says what it does rather than "Save". Primary rather than `danger` — a renewal is a normal act, and red would say a mistake was being made (DES-038 clause 7's reading).

**13. A refusal is printed once, in the dialog, and the form keeps what was typed.** DES-035 clause 12. The two checks the dialog makes itself — an empty box, and a date that does not move the term forward — are said before the press so nobody has to press a button to find out a box is empty; everything else is the seam's to refuse, which keeps the rule in one place.

**14. The confirmed-renewal rows are the card's third family, and they are drawn last.** DES-035 clause 4 reserved the slot and DES-036 filled the second. The first two families say where the contract is **going** — who still has to sign it off, and what paper is out — and this one says where it has **been**, so history reads under current state. The card's sub-headings now appear whenever more than one family is on screen, which is the DES-036 clause 2 rule with a third block in it.

**15. The renewal row is three cells — Renewal, Confirmed by, Confirmed — and it has no action cell at all.** The first takes the two-line anatomy the Approver and Signers cells already use: "Term advanced to {date}", and under it "From {date}". The two dates **are** the roll, and the row has to carry both because an adjusted roll landed somewhere other than the record proposed. Confirmed by is the roster's avatar-and-name cell; Confirmed is the Decided column's shape and its short date. No action cell, because **a confirmed roll is a fact and not a thing to change**: nothing undoes an assertion that a term renewed, and a date somebody typed wrong is corrected by editing the expiry on the Contract card, which narrates as the edit it is. DES-035 clause 9's rule — a control for an act that does not exist is not drawn as a disabled one.

**16. A record with no confirmed roll draws no renewal block at all — not an empty line.** DES-041 clause 8 and DES-042 clause 14 both spend an empty line on a surface whose whole job is the thing that is missing. This is not that surface: the roster's own empty line already tells the reader the card holds nothing, and a second line under it would announce the absence of a history most contracts never have.

**17. "Last renewal" closes the Contract card's term group as a fact, never a field** (grill row **G.R5**). It is the newest confirmed roll's own confirmation date — "when did we last renew this" is answered by when somebody said so — read from the same list the rows are drawn from, because nothing stores a renewal. A record where no roll has been confirmed prints the em dash DES-040 clause 5 fixed for every absence on this card. It sits after Days remaining because both are facts derived from the record rather than fields of it, and the two close the group together.

**18. The rolls are still not drawn on the Term timeline card.** DES-041 clause 3 said confirmed rolls join it "with the slice that writes them", and this is that slice — but the card's implied periods and a confirmed roll are two different datums drawn in one plot, and telling them apart needs a fill family, a key entry, and a rule for a record whose log and dates disagree. That is its own decision and its own surface. Grill rows **I.B3**, **I.B4**, and **I.B5** stay open, and the datum they need now exists.

### Rationale

The banner is the milestone's whole argument in one strip. CTR-006 chose notify-only over auto-advance because a legal-state fact must trace to a person, and the visible consequence of that choice is a record that says "this date passed and nobody has said what happened". Everything about the strip follows from it being a **reading**: no dismiss, no status pill, no stored state, and no schedule anywhere behind it.

Shipping the dialog with one exit is the departure worth defending. The alternative was to draw the mock's four options with three of them inert, which is DES-035 clause 13's mistake — a surface explaining a rule it does not apply — with the extra cost that the three inert ones name acts a reader would then go looking for. One exit drawn honestly reads as an early product; four exits with three dead ends reads as a broken one.

The `fromExpiry` precondition is a design decision as much as a seam one, because it is what the dialog is allowed to promise. Without it, two people confirming one roll advance a term two periods, and the record ends up asserting a renewal nobody made. With it, the second confirm is told the record moved and the reader looks again.

### Alternatives considered

- **A pill beside the status, or a stage the pending state moves to.** Rejected: CTR-006 settled it. The contract stays on the status and stage it had, and a pill would put the lifecycle's own vocabulary on a derived reading.
- **Drawing the mock's four options with three disabled.** Rejected with clause 8, for DES-035 clause 9's reason twice: the three would be dead ends, and each names an act a reader would then hunt for.
- **A single radio, pre-selected, so the list's shape survives the slice.** Rejected: a control with one option decides nothing, and it would be the only control on the record that cannot change anything.
- **Proposing the new expiry in the browser.** Rejected with clause 9: the seam already answers it, the month-end clamp is a real rule, and two derivations of one date is one of them drifting.
- **A dismissable banner, or one that hides once somebody has seen it.** Rejected with clause 3: DD-014's banner made the same call for the same failure mode, and this one guards the failure the milestone was built for.
- **`danger` for the banner's family.** Rejected: nothing here asserts that a lapse happened, and a record whose renewal is simply due would read as a record in trouble. DES-042 clause 10 refused a `danger` pill on a past date for the same reason.
- **A confirmation on the confirm.** Rejected: the dialog **is** the confirmation, and it already collects the date rather than only asking "are you sure".
- **A row action to undo a confirmed roll.** Rejected with clause 15: the record's activity is append-only (DD-017), and the honest correction is an edit of the expiry, which the record already narrates.
- **Renewal rows in a card of their own.** Rejected: DES-035 clause 4 reserved this card's third slot for exactly them, and a fourth card on the record would make a reader decide which one answers "what has happened to this contract".
- **"Last renewal" as the date the term rolled to, rather than the date somebody confirmed it.** Rejected: the date the term runs to is the Expiry field three rows above, and printing it twice under two names would be the card's only duplicated fact.
- **Drawing the pending state on the contracts list as well.** Rejected for this slice: a cross-record view of what is coming up is M18's digest and M29's dashboards, and CTR-006's own out-of-scope list puts it there.

### Consequences

`RenewalBanner` and `ConfirmRenewalDialog` are the two new components, both under `components/contracts/`. The banner mounts in the `AppShell` banner slot beside `ConfidentialBanner`; the dialog mounts on `ContractRecord` beside `SoftGateDialog` and `RetypeDialog`, and both the banner's call to action and the card's head control open it.

`ApprovalsSigningCard` grows a `RenewalRow`, a third block, and a `Renew` control in its head. Its two-block predicate becomes a many-block one, so the sub-headings appear for either conditional family.

`ContractRecord` holds the renewal history as state, because the confirm answers the whole of it, and the Contract card's new "Last renewal" fact reads its first entry. `lib/renewals.ts` carries the row type and the one write, and derives nothing.

`--height-confidential-banner` is renamed `--height-record-banner` in `styles/globals.css`; DES-009's and DES-028's references to the old name read as the same 36px measure under its new name.

Twenty-two ICU messages, all new — five on the banner and the record's new fact, sixteen on the dialog and the renewal block, and one on the activity narrator's new verb. No new tokens and no new contrast pairs: the banner reuses the `warning` family's own paired fg/bg, which the gate already checks at the body floor in all three themes.

The activity narrator gains one verb. It keeps its own sentence rather than reading as an edit of the expiry, because the act is what the record has to prove, and the sentence carries both dates — an adjusted roll moved the term somewhere other than the record proposed.

Grill row **G.R5** is discharged. **I.B3**, **I.B4**, and **I.B5** stay open with clause 18, no longer waiting on a datum.

## DES-044: The Renew dialog's four exits, and the prefilled create (extends DES-043, DES-035, DES-033, DES-017)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

M16/5 builds CTR-007's other three renewal vehicles, so the Renew dialog stops being a form with one button and becomes what the C9 mock always drew: a chooser. `designs/contracts.pen`'s `S9 Overlay` lists four options — **Confirm the roll** ("Same record — expiry advances to Jun 30, 2027."), **Paper as amendment** ("Renewal recorded as an amendment on this contract."), **Create child contract** ("New record parented to this one."), and **New successor contract** ("Standalone record linked as the renewal.") — over a foot reading "Logged to history. Reminders stop once confirmed."

DES-043 clause 8 left that list out while three of the four could not be picked, and said it would return with the slice that built them. This is that slice. Three things the mock does not settle have to be settled here:

1. **Three of the four do not commit anything.** Only the roll writes in this dialog. The other three take the person somewhere else — to the record's own paper, or to the create flow — and a button that says "Confirm renewal" before navigating would be lying about what it does.
2. **The prefilled create has no drawn design.** C10 is the create modal and it draws no prefilled state, because M8 had nothing to prefill from.
3. **Two of the three routed vehicles need a surface that already exists**, and reusing it is a decision with consequences for both.

### Decision

**1. The mock's radio list is drawn, one option per vehicle, in the mock's own order and words.** Titles and blurbs are the mock's; the glyphs are Lucide's (DES-008), one per vehicle, so the list reads before it is read. A radio group rather than four buttons: picking a vehicle is a decision about **what to record**, taken before the act, and the reader should see all four at once and reach them with the arrow keys. The chosen option takes the `status-info` family's paired fill and border, which is the mock's own treatment and a pair the contrast gate already checks.

**2. Confirming the roll stays the default and keeps everything DES-043 gave it.** It is the vehicle an auto-renewing contract most often takes, and the only one that records the renewal here rather than somewhere else. Its date box, its "The term currently runs to {date}." line, its two client-side refusals, and its `fromExpiry` precondition are unchanged.

**3. The date box belongs to the roll and is drawn only while the roll is chosen.** The other three vehicles record their new term on the record they are about to open, so a box here would collect a date nothing would do anything with — and a form that keeps a control for a path it is not on is DES-035 clause 13's mistake in miniature.

**4. The button says the chosen vehicle's verb, and the foot note says what that vehicle leaves behind.** "Confirm renewal", "File the amendment", "Open the child contract", "Open the successor" — DES-035 clause 10 applied per exit. The note beside the `History` glyph follows: the roll keeps DES-043 clause 11's sentence, and each routed vehicle says where it is about to take the reader and, for the two that create a record, what does **not** come across. A button that navigates should say so before it is pressed.

**5. The amendment option is absent, never disabled, on a record with no primary document.** DES-035 clause 9. Filing an amendment means appending a version to the record's instrument (CTR-014), and a record with no instrument has no chain to append to — so the act does not exist and no control for it is drawn. The other three are always on offer, because the Renew control is already drawn only on a record that can roll (DES-043 clause 6).

**6. The amendment vehicle routes to the Documents section and opens its composer, seeded with the `amendment` kind.** No second upload form, and no amendment-shaped variant of the one that exists: the file, the note, and the write are the M11 upload path exactly as they are. What the routing contributes is the two things a person would otherwise have to do by hand — get to the right section, and set the kind. The seed is a **seed and not a lock**: the kind picker still offers all five, because a person who changed their mind between the dialog and the file should not have to start again.

**7. The composer is opened once and the request is then spent.** Returning to the Documents section later must not re-open it, so the section answers the record as soon as it has taken the request up — including when there was no chain to open it on, so a request can never sit unanswered behind a page of paper.

**8. The child and successor vehicles open the Contracts list's own create dialog, from the record.** Routing a renewal makes an ordinary contract, and a create form that behaved differently for renewals would be a second set of rules to keep in step with the first. The dialog moves to `components/contracts/` and gains one optional prop; nothing about its ordinary use changes.

**9. It says which act it is, in its title and in one sentence above the boxes.** "Create child contract" or "Create successor contract" rather than "Create contract", and under it what came across and what did not: the counterparties, our entity, the value, and the term did; the team, the status, and the Confidential flag did not. CTR-015's no-inheritance stance is invisible in a form whose boxes are already full, so the dialog states it rather than letting a reader discover it on the record afterwards.

**10. The two fields the dialog draws are seeded and stay editable; everything else is copied at the seam.** The title and the type are seeded from the record the renewal was routed from and whatever is in the boxes when Create is pressed is what the record is born with. The business facts the dialog does not draw are the seam's to copy, because it is the only place that can and the only place worth asserting it at. This is DES-040 clause 4's rule again — one derivation, at the end that owns it — applied to a copy instead of a count.

**11. The Confidential toggle starts off, whatever the predecessor is flagged.** It is drawn exactly as it is on an ordinary create, so a person routing a renewal of a walled record can wall the successor in the same breath. It is a decision they take, not one inherited (DD-014, CTR-018). CTR-018's link-time "make this confidential too?" nudge is **not** drawn here: it belongs with M17's manual linking, where a link is made between two records that already exist.

**12. Creating lands the person on the record that was just born.** It is where the renewal is finished — the dates the prefill brought across are the first thing anybody will move — and the ordinary create, which stays on the list it was raised from, is a different act with a different next step.

**13. The two dialogs never overlap, and the second waits a frame for the first to leave.** Two modal layers swapped inside one commit leave the page inert: the outgoing layer tears itself down after the incoming one has decided whether it has to opt itself back in to pointer events, and the create dialog mounts unclickable. Deferring the second by a tick is the whole of the fix and costs a frame nobody sees. Recorded because it is invisible in the code and the failure it prevents is total.

**14. Nothing about relations is drawn.** No relations panel, no hierarchy breadcrumb, no "renews C-42" line on either record, no manual linking, and no restricted-relative placeholder. This slice writes links and narrates the writes; every surface that reads one is M17's (CTR-015). The only place a reader meets a relation in M16 is the activity feed's own sentence.

### Rationale

The dialog's shape follows from a fact about the four vehicles that the mock's uniform list hides: one of them is a write and three of them are journeys. Drawing them as four equal options is right — the person is choosing what to record, and at that moment they are equal — but everything after the choice has to admit the difference, which is why the button, the foot note, and the date box all follow the selection rather than sitting still.

Reusing the create dialog is the decision most worth defending. A dedicated "renewal contract" form would have let every field be prefilled and edited in one place, which is the stronger reading of "everything prefilled stays editable before create". It was rejected because it would fork creation: two forms, two required-field rules, two confidentiality toggles, and a second place for MTR-014 to be enforced. One form with a prefilled mode keeps creation one thing, and the fields it does not draw are editable on the record a moment later — which is where M8 always put them (DES-017).

The prefill's split is therefore not a compromise but the same rule stated twice: whoever draws a value owns seeding it, and whoever owns the write owns copying the rest. The seam is also the only place the promise can be _tested_, which is what makes it the right owner of the part nobody can see.

### Alternatives considered

- **A dedicated renewal-create form with every business fact drawn.** Rejected above: it forks creation and duplicates MTR-014's enforcement point.
- **Four buttons instead of a radio group.** Rejected: a button is a verb and these are nouns, and four verbs would ask the reader to decide and act in one motion with no way to look at the options first.
- **Keeping one button label ("Continue") for all four.** Rejected with clause 4: DES-035 clause 10 exists because an act should say what it does, and "Continue" is the word that says least.
- **Drawing the amendment option disabled with an explanation on a record with no paper.** Rejected with clause 5, DES-035 clause 9's rule: a control for an act that does not exist is not drawn as a disabled one.
- **Routing the amendment to a fresh upload rather than the primary chain.** Rejected: CTR-007 says the renewal stays on the record it amends, and CTR-014 says the instrument is one document with one chain. A loose attachment would be paper the record does not treat as its own.
- **Writing an `amends` relation for the amendment vehicle.** Rejected: no second record exists for it to point at. `amends` is for a contract that amends another contract, which is M17's manual linking and the child-contract case a team chooses to call an amendment.
- **Prefilling the Confidential flag from the predecessor.** Rejected with clause 11: CTR-015 forbids it, and DD-014 makes walling a record an act somebody takes.
- **Copying the predecessor's team so the successor opens with the same people.** Rejected for the same reason, and it is the copy that would have looked most helpful: a team is who is working _this_ paper, and a renewal is often worked by somebody else.
- **Showing the new record's link on the predecessor immediately.** Rejected: it is a relations read surface and belongs to M17 whole, rather than half of it arriving here for one case.
- **Leaving the Renew dialog open behind the create dialog so Cancel returns to the chooser.** Rejected with clause 13, and independently: a person who cancels a create has changed their mind about the renewal, not about the vehicle.

### Consequences

`ConfirmRenewalDialog` gains the radio list, a `canAmend` prop, and an `onRoute` callback; its date box, its refusals, and its `fromExpiry` precondition are untouched.

`CreateContractDialog` moves from `routes/contracts.tsx` to `components/contracts/create-contract-dialog.tsx` and gains one optional `renewalOf` prop carrying the predecessor's number, the vehicle, and the two seeded fields. Its two control ids are namespaced (`contract-new-title`, `contract-new-type`) because the record page draws a Title box and a type picker of its own, and two elements sharing an id break the label association a screen reader follows.

`DocumentsCard` gains an `amending` request and the answer to it, and its composer takes an optional seed kind. `ContractRecord` holds both requests, beside the Renew dialog it already held.

Twenty-three new ICU messages — twelve on the dialog's four options, its group label, and their verbs, three on its foot notes, four on the create dialog's titles and prefill sentences, and four on the activity narrator's two new verbs and the far record they name. No new tokens and no new contrast pairs: the chosen option reuses the `info` family's paired fg/bg and its fg on `bg-raised`, both of which the gate already checks.

The activity narrator gains two verbs. `contract.relation_added` is one sentence with an arm per relation type rather than three verbs, because the act is the same act and only the word in the middle differs; an unknown type falls into a generic arm, because the log is append-only and a row written by a later build still has to read as a sentence.

DES-043 clause 8 is discharged. Clause 18 is unchanged: confirmed rolls are still not drawn on the Term timeline card.

## DES-045: The link dialog, the picker, the refusal rendering, and the confidentiality nudge (extends DES-032, DES-024, DES-009)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

M17/4 adds manual link management to the contract record's Overview section. A Legal Team Member links two contracts by hand, puts a contract under a parent, removes either kind of connection, and encounters the CTR-018 confidentiality nudge when exactly one side of a new link is confidential.

### Decision

**1. The dialog anatomy is a centered modal (DES-012) with three zones: a picker, a type selector (link mode only), and a foot.**

The picker follows the mention-candidates precedent (DES-024): a text input that searches by number or title against only the contracts the viewer can reach, with a bounded dropdown. A selected candidate shows as a compact chip with a dismiss cross; the dropdown dismisses on blur. The link type selector is a native `<select>` among the three values (`related`, `renews`, `amends`); omitted in parent mode.

**2. Refusals are rendered as inline alerts.** The three named problem types — `relation-exists`, `parent-cycle`, `self-link` — each map to a dedicated ICU message. Any unnamed refusal falls through to the generic error. The alert uses `text-status-danger-fg` on the form, the same placement as the renewal dialog's error (DES-043).

**3. Remove actions sit inline on each reachable entry.** A "Remove link" text button on each reachable link row; a "Remove parent" text button on the immediate parent only (never on ancestors further up the chain). Restricted contracts carry no action. Children have no removal action — removal of the parent is the act.

**4. The CTR-018 nudge is a second modal that replaces the link dialog after a link is created when exactly one side is confidential.** It names the confidential side and the open side by contract reference, and offers two buttons: "Flag as confidential" (primary) and "No, leave it open" (secondary). Accepting calls the ordinary confidentiality PATCH; when that write is refused — the ordinary actor rule can refuse it — the refusal is said as an inline alert and the nudge stays open rather than closing as if the flag were set. Dismissing does nothing. Unlinking never un-flags. The nudge appears once per link creation and never on unlink.

**5. "Add link" and "Set parent" are ghost buttons in the card header.** "Set parent" hides when a parent already exists. Both are absent when the viewer is not Member+ or the contract is archived.

### Consequences

One new dialog component (`link-dialog.tsx`), one updated card component (`related-contracts-card.tsx`), and some two dozen new ICU messages. No new tokens and no new contrast pairs.

The picker reuses the mention-candidates API pattern at a different endpoint (`/link-candidates`), bounded to what the viewer can reach. It searches rather than listing all, so a workspace with thousands of contracts never loads them in one shot. The trade-off is that the actor must know part of the number or title before the candidate appears.

The native `<select>` for link type is the smallest control that covers three values; a radio group or a combobox would add weight the three-item list does not justify.

The nudge is the first instance of a post-write dialog in the product — a second modal that replaces the link dialog. This means the dialog component holds a two-phase state machine (form then nudge). A toast or an inline prompt after close would avoid the two-phase flow, but neither gives the nudge enough weight to match CTR-018's intent.

## DES-046: The managed list table — the width floor, the resize handle, the column menu, and the views control (extends DES-031, DES-021, DES-007)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

DD-019 makes a destination list's columns the reader's to choose, and its layout something they can save. Nothing in this document draws a destination list's column strip: DES-021 covers the settings list-editor's table, DES-027 the audit log's, and DES-031 the paging foot under either — but the contracts list was built as a bespoke `<table>` with per-column width hints in the JSX.

That build has a concrete defect worth naming, because the fix is structural rather than a number to tune. Six of its seven `<th>` cells carry a width hint. They sum to 928px. On a 1030px table there is nothing left for the Title column, so the one column that carries the record's name collapses to its own longest word and wraps, while every fixed column sits in slack it cannot give back. A table with width hints, no floor, and no sideways escape has no way to be anything but cramped.

Matters, Documents, and Entities all land the same surface later, so this is one primitive, not a contracts fix.

### Decision

**1. Widths are real, and the table has a floor.** The table renders `table-layout: fixed` with a `<colgroup>`, one `<col>` per shown column carrying the width from the view config in px. The table's `min-width` is the sum of those widths. Below that the card's existing horizontal scroll (DES-031's `overflow-x-auto`, which belongs to the table and not to the card, so the paging foot never slides out of reach) does the rest.

This is the whole cure for the cramp. A column can be narrow because a reader dragged it there, and never because the table ran out of room.

**Where the card's spare width goes is the layout's choice, and every column is resizable.** A fixed-layout table has three places to put spare width, and only one of them is any good. Sharing it out over all the columns proportionally is what a browser does by default, and it is the option that breaks resizing: every stored width becomes a ratio, so dragging one column moves all of them. Giving it to one designated column is what the first draft of this clause did, and it is the option that cannot be resized: a column absorbing the spare width can never be dragged narrower than that width makes it, whichever column it is. So the layout carries a **`flexKey`** — which shown column stretches, or `null` for none — and:

- The catalogue names the column that stretches in the built-in layout: the one whose content is longest and least predictable, Title on contracts. That preserves the cramp fix, because a wide window goes to the record's name rather than to nothing.
- **Dragging the stretching column pins it**, at the width it was rendering at plus the drag. The spare width then becomes trailing space. This is the one rule that makes every column resizable, and it is the reader saying they want the number instead of the stretch.
- A trailing **filler column** absorbs the spare width whenever no real column does. It is what lets a pinned column keep exactly the width it says it has, and it is also what gives the last real column something on its trailing side — without it, the last column has no edge to drag. It carries no padding, is `aria-hidden`, and is given a hard `0` while a real column is stretching, because a fixed-layout table splits spare width equally between every column that has none.
- **"Fill the width"** in the column menu hands the stretch back to the catalogue's column, and is offered only while some other arrangement is in force.

Every column therefore has a real `defaultWidth` in the catalogue, the stretching one included: stretching is a layout's state, not a column's nature, and the number is what the column takes the moment it is pinned. The table's `min-width` counts the stretching column's floor rather than its width, so widening a neighbour scrolls the card rather than crushing the record's name.

**2. Cells truncate; they never wrap.** Every cell is single-line with `truncate`, and any cell whose text can outrun its column carries the full text as a `title`. A row is one line tall at DES-007's density (`py-2.5`), so thirty rows scan as thirty rows. Wrapping is what made one short title look like a defect.

**A cell that draws a shape clips instead, because the ellipsis belongs to text.** A status pill is the case: it is a coloured shape with a rounded end, and an ellipsis inside it has to eat that end to make room for itself. The result reads as a broken pill rather than as a long status name, which is the opposite of what the mark is for. So a column may declare itself `clip`, and its cell is cut on a clean vertical edge at the column boundary — the shape is whole as far as it goes, and clause 1's sideways scroll reaches the rest.

This is a carve-out for shapes, not a second option for text. A text run in a narrow column still ellipsizes: there the mark sits at the end of a line and says the one thing it is good at saying. Two columns cannot make the same content clip in one list and ellipsize in another, because the flag belongs to the catalogue's column and not to a layout.

The pill also has to be held at its intrinsic width for the cut to land in the right place. An inline shape is shrink-to-fit by default, so a narrow cell squeezes it to its longest word and lets the remainder of the name spill out past its own background — loose text beside a coloured shape, which is worse than either the ellipsis or the cut. The shape takes `width: max-content`, and the cell clips shape and text on the same edge.

A status name is whatever an Administrator called it (CTR-001), so no column floor can promise the pill fits. That is why this is a rendering rule and not a wider `minWidth` on the Status column.

**The `title` is measured on hover, and it carries the spoken text rather than the drawn text.** Two refinements this clause needed once it was built. A `title` on every cell pops a tooltip repeating text the reader can already read, which is noise in a strip they are scanning thirty rows of — only a clipped cell has anything to add, and whether a cell is clipped changes with every column drag. So it is measured when the pointer arrives: no observer per cell, and nothing to re-sync when a column moves. And the text is the cell's accessible name, not its `textContent`. A cell can draw text nobody should hear — the initials on an avatar abbreviate the name beside them — and can mean text it never draws, which is what the `aria-label` on DES-009's "CONFI" marker is. The reader hovering is asking what the cell says, not what it drew.

Headings take the same treatment, and need it because clause 1's floors deliberately sit under them. A column dragged narrow truncates its own name rather than stopping at a width the heading chose, so the heading is a clipped text run like any other.

`title` is a pointer affordance and this clause only ever asked for one. It is not reachable from the keyboard and does not appear on touch, and it is not the sole route to the text: a cell is clipped here by a width the reader chose, and clause 1's sideways scroll and the drag that narrowed it both reach the whole value.

**3. The resize handle is a keyboard control that also takes a drag, and it shows.** On the trailing edge of each resizable header cell sits a 9px-wide, full-height strip with `cursor: col-resize`, straddling the column boundary. It draws a 1px rule on that boundary at rest, in `border-default` — the colour of every other rule in the table — and firms up to `border-strong` under the pointer, on focus, and for the length of a drag. A draggable edge has to look like an edge before anyone reaches for it, and a hover-only affordance in a header strip is one nobody discovers.

**The rule belongs to the boundary, not to the handle**, and since clause 1 makes every column resizable, every column carries both. Only the filler goes without, because the card's own border is its edge.

**The strip straddles its boundary everywhere except the table's own trailing edge.** Straddling puts half the grab area in the next column, which is that column's business and costs nothing. At the table's edge it is nothing's business: the overhang becomes scrollable overflow, and the card grows a sideways scrollbar for a table that fits inside it — which is exactly what "Fill the width" produced, since a stretching column collapses the filler to nothing and puts the last boundary on the table's edge. There the strip takes its 9px from the inner side and carries the rule at its end instead of its centre. The target does not shrink; only the side it takes its width from changes.

A handle on a stretching column reports its pinned number in `aria-valuenow` and overrides the announcement with `aria-valuetext` — "Fills the remaining width" — because that column has no width of its own to report until an adjustment pins it. A drag or a nudge on it starts from the cell's measured width, so the first keypress moves the column by one step rather than snapping it to a number it has not been using.

It is a focusable `role="separator"` with `aria-orientation="vertical"`, an `aria-label` naming its column, and `aria-valuenow` / `aria-valuemin` carrying the width in px. Left and right arrows move the width by 16px, Shift with them by 64px, and Home returns the column to its catalogue default. A drag does the same thing continuously, floored at the column's `minWidth`.

The 9px pointer target is a deliberate, recorded exception to DES-011's 24×24 minimum. A 24px strip would swallow the sort click on the same cell, and the accessible path here is not a bigger target — it is the keyboard control the same element already is.

**4. Show, hide, and reorder live in one menu, off a `Columns3` glyph.** A ghost icon button in the sub-bar's `actions` slot opens a dropdown listing every column in the catalogue in current order. Each is a `menuitemcheckbox`; the catalogue's required columns are checked and disabled, because a contracts list with no Title is not a shorter list, it is a broken one. Each row carries `ChevronUp` / `ChevronDown` 16px icon buttons that move it one place, disabled at the ends. Under them sit "Fill the width" — clause 1's way back to a stretching column, present only while no column is stretching — and "Reset columns", which restores the built-in columns and their stretch while keeping the sort and the filters. Both close the menu. The menu does **not** close on a toggle, so a reader hiding four columns visits once.

Reorder is by menu rather than by dragging a header. A header drag is the familiar affordance and is a reasonable later addition; it is not the one shipped first, because the menu is the version that works from the keyboard without inventing a drag-and-drop keyboard protocol this document has not drawn.

**5. Sorting is on the header cell's own label, and it has three states.** A sortable column's header text is a full-width `button`. Presses cycle ascending → descending → off, and off means the list's natural order — newest reference first on contracts (CTR-024) — which is a meaningful state and so must be reachable. The `<th>` carries `aria-sort`. The glyph is `ArrowUp` or `ArrowDown` at 16px when sorted, and `ChevronsUpDown` at `text-subtle` on hover or focus when sortable and unsorted. Unsortable headers are plain text.

**6. The views control is a labelled ghost button, not an icon.** It sits in the sub-bar's `actions` slot before the column menu, and its label is the active view's name, or "Default view" when none is active, with a trailing `ChevronDown`. When the layout on screen differs from what is stored, the label takes a second line — "Modified" at `text-xs text-muted` — because DD-019 clause 5 makes that difference the thing the reader has to be able to see before they press Save.

The menu holds the person's views as `menuitemradio` rows, then the acts, in this order: Save (present only while modified), Save as…, Rename…, Set as default (absent when it already is), and Delete. Save as, Rename, and Delete each open a small centered dialog; the other two write directly. Delete's dialog names the view and its confirm button is `variant="danger"`.

**7. Both menus are absent, not disabled, when there is nothing to manage.** A list rendering its empty state has no column strip to arrange, so neither control is drawn.

### Consequences

Three new components under `apps/web/src/components/table/` — `managed-table.tsx`, `column-menu.tsx`, `views-menu.tsx` — plus a `DropdownMenuCheckboxItem` added to the owned `dropdown-menu.tsx` primitive, which had only Item and RadioItem. No new radii, no new type sizes.

One new color token: `border-strong`, the rule the handle firms up to. `text-subtle` already existed, but `border-strong` did not — the first draft of this clause named it as though it did, which is how it shipped as a class that resolved to nothing. It is now in the `@theme` registry and in all three themes, one step past `border-default` on each theme's own ramp: `#afb8c1` in Light and `#484f58` in Dark from Primer's grey scale, `#d3c9b6` in Warm from its cream ramp. Being a boundary rule rather than the sole identifier of a control — the handle also carries a focus ring, a `col-resize` cursor, and a name and role — it is held to DES-011's non-text-contrast exemption for decorative separators, the same as the table's row rules.

Each surface adopting this supplies a **column catalogue**: per column a key, a header message, a default width, a floor, whether it is required, whether it sorts and under which API sort key, and a render function. DD-019 clause 7's read-past-unknown-keys rule resolves against that catalogue, which makes the catalogue the surface's contract with its own saved views rather than an incidental ordering of JSX.

Clause 1 changes what a column width means everywhere it appears: the widths in the contracts JSX today are Tailwind `w-*` hints on `<th>` elements that a browser is free to ignore, and they become px numbers in a config that a `<col>` obeys. The contracts list's current seven-column look is preserved as the built-in default layout, with the numbers chosen so the sum clears a 1280px viewport without scrolling.

The layout config gains `flexKey` alongside its columns, so it rides in DD-019's single `jsonb` and is compared by the "Modified" marker like everything else — pinning a column is a change worth saving. The field is optional at the seam and read past when it names a column that is not shown, both under DD-019 clause 7: a config stored before it existed reads as "nothing stretches", which is the reading that cannot surprise anybody by moving a column they did not touch.

Clause 2 costs the counterparty cell its bespoke `w-44 truncate` span, which existed only because an auto-layout cell grows to fit and had nothing to truncate against. With a `<colgroup>` the column is the width, and the span goes.

The mobile floor is untouched and not improved: DES-012 already parks a stacked-card table rendering for below 768px, and a column strip nobody can see is not the thing that unparks it. Below md the two menus stay in the `actions` slot, which that decision already hides.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — Matters adopt the managed list whole

The Matters destination is DES-046's second catalogue and the first proof that the primitive is not contract-shaped. Its required columns are M-### and Title; Type, Status, Priority, Risk, Matter Manager, and Opened complete the built-in layout, each with a server sort key. Status, type, priority, Manager (including `me`), and Incomplete join the layout's saved filters; closed and archived are explicit toggles. The team-scope predicate sits in the paged query, and the sub-bar states only the loaded open/on-hold counts, so hidden confidential rows cannot leak through a total. Column widths, resize, ordering, sorting, saved views, keyset foot, and row truncation are the shared components unchanged.

### Addendum (2026-08-29, M26 close, [#560](https://github.com/juggernog20/OpenLaw/issues/560)): Documents is the third managed-list catalogue

The Documents destination adopts the managed table whole. Title is its required flex column. Owning record, current Version kind, format, size, Version count, uploader, and uploaded time complete the built-in layout. The filter state joins the saved layout config, and Uploaded descending is the natural order. Resize, reorder, show and hide, sort, saved views, row truncation, horizontal escape, and the paging foot use the shared components unchanged.

### Addendum (2026-08-30, M27/9, [#581](https://github.com/juggernog20/OpenLaw/issues/581)): Entities is the fourth managed-list catalogue

The Entity registry adopts the managed table whole under the Calendar/List/Chart destination switch. Legal name is its required flex column; Type, Jurisdiction, Registration no., Status, and Next obligation complete the built-in layout, with Created available from the column menu. Type, Status, Jurisdiction, Majority owner, and Show archived are the saved filter row. The shared resize, reorder, sort, saved-view, truncation, horizontal escape, archived row action, and keyset foot behaviours are unchanged.

## DES-047: The Team roster is an activity-bar applet (amends DES-016, DES-032, DES-028)

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

DES-032 clause 5 put the Team card in a side column beside every contract section, so who is on a contract stayed in view while reading any part of it, and DES-028's "Manage team" fragment had a stable target. That column cost ~320px on every section — Overview, Fields, Documents, Approvals, Key dates, Tasks — on a page that already docks an applet panel of the same width.

The activity bar is the record's right-side system (DES-016). A persistent side column next to it is a second right-side system, which is the duplication DES-016 already refused for chips.

### Decision

**1. The Team roster is a panel applet**, first in the contract record's bar, with Lucide's `User` glyph at the bar's 20px step. Clicking it expands the side panel. The roster is not a section, not a fourth tab, and not a card in the main column.

**2. The panel is the surface.** The applet label is the title; the add control sits in the header accessory slot (the same slot the chat applet's count pill uses). The body is the Owner row, then one row per `contract_team` role. No nested card chrome — the panel is already `bg-raised`.

**3. DES-028's "Manage team" fragment opens the applet.** The link stays a link (`#contract-team`), not a button, because nothing on the confidentiality banner is a button. The panel takes that id while it is open. `RecordApplets` listens for the hash — native fragment navigation would miss, because the panel is not in the DOM until it is expanded. Opening it — from the bar or from the fragment — moves focus onto the panel container, not its Close control, so `Esc` from the banner path works without an extra Tab (DES-016 / DES-010).

**4. Every section inherits the width.** The main column is the full record region minus the 48px bar (and minus the 320px panel only while an applet is open). Approvals, Documents, and the rest are no longer sharing the page with a second 320px column.

### Rationale

Who is on a contract is still context for reading any part of it — that is why it is not a tab. The activity bar is already that kind of context: comments and history sit beside every section for the same reason. Putting the roster in a fourth slot there answers DES-032's question without a column that every section pays for whether anyone is looking at the roster or not.

The `User` glyph is the one the request named. `Users` would have named the group more literally; the single-person mark is the conventional "people" slot on a VS Code-style bar, and DES-008 has no second size to spend on making the two distinguishable at 20px.

### Alternatives considered

- **Keep the side column.** Rejected: it is a second right-side system, and it is the width every section was short of.
- **Team as a fourth tab.** Rejected by DES-032; a fragment that only resolved on one section would be a link that sometimes goes nowhere.
- **Open the team panel by default.** Rejected: DES-016's bar starts collapsed. The roster is one click, not a permanent 320px.

### Consequences

`useTeamApplet` in `apps/web/src/components/contracts/team-applet.tsx` is the slot, mounted first in the contract record's applet set. `PanelApplet` gains an optional `hash` so a fragment can open an applet; the team slot is the first user. DES-016's applet set, DES-032 clause 5, and DES-028's fragment destination are amended above. No new tokens.

## DES-048: Date inputs are a calendar popover (amends DES-014, DES-040)

- **Status:** Accepted
- **Date:** 2026-08-18

### Context

DES-014 originally picked the browser-native `<input type="date">` so locale chrome came for free. In practice that chrome is the empty `dd/mm/yyyy` placeholder, a picker that differs by browser, and a year control that is awkward for contract dates years from now. The Contract card's effective date and expiry are the first fields that make that cost obvious.

### Decision

**1. A date field is the shared `DatePicker`:** a C10-shaped control showing `formatFullDate` (always the year), opening a month calendar in a Popover. Empty shows "Select a date". The value it holds and writes is still a bare `YYYY-MM-DD`.

**2. Month and year are dropdowns,** so a date years out is one pick, not twelve next-month clicks. The range is 1970 through fifty years ahead.

**3. Picking a day commits immediately,** the same DES-017 rule a select already follows. Clearing is a "Clear" verb in the popover. Escape on the closed trigger reverts a refused or uncommitted draft; Escape on the open calendar dismisses it without writing.

**4. First consumers are the two term dates on the Contract card.** Other native date inputs (key dates, the renewal dialog, custom fields, filters) migrate as those surfaces are touched. Time inputs stay native.

**5. Previous and next sit still while the month changes, and the popover stays in view.** The calendar's width is the seven day columns, not the month caption, so a longer name cannot shove the chrome. The grid always draws six weeks, so paging months cannot resize the box either. Collision still places the popover above or below the field — and shifts it if needed — so the whole calendar stays on screen; a short viewport can scroll inside the popover.

### Rationale

The native control answered locale for free and cost no component. It also answered with chrome nobody asked for, and it made a date five years out harder to type than a title. A calendar that jumps by month and year, showing the same `May 3, 2026` the rest of the page already prints, is the control the dates were always going to need. Commit-on-pick keeps DES-017: a day is a decision, not a draft.

### Alternatives considered

- **Keep the native input.** Rejected: the empty `dd/mm/yyyy` chrome is the complaint this decision answers.
- **A typed text field plus a calendar button.** Rejected for v1: two ways to enter one civil date, and a parse to own. Revisit if people ask to type.
- **Hand-rolled month grid, no `react-day-picker`.** Rejected: keyboard and screen-reader month navigation is what the library is for; DES-004 already pointed at shadcn's Calendar.

### Consequences

`apps/web/src/components/date-picker.tsx` is the control; `calendar.tsx` and `popover.tsx` are the owned shadcn pieces under `components/ui/`. `formatFullDate` joins the DES-014 helper layer. `react-day-picker` and `@radix-ui/react-popover` are web-app dependencies. DES-014's Date inputs row and DES-040 clause 1 are amended above. The month grid uses `fixedWeeks` so collision can place the popover without a later resize moving previous/next. No new tokens.

## DES-049: The notification centre — the header bell, its counter badge, and the panel behind it (extends DES-026, DES-031, DES-016)

- **Status:** Accepted
- **Date:** 2026-08-18

### Context

NOT-001 puts one notification system on two surfaces, and the staff surface is a bell in the top nav. NOT-005 settles its semantics — unread count, capped at "9+", opening the centre marks the visible items read, a mark-all-read affordance, items deep-link, no per-item read ceremony. M18/2 (#317) builds it.

**The bell is mocked; the panel behind it is not.** The `AppHeader` component in `designs/final-themes.pen` draws the glyph and an overhanging red count badge in the trailing cluster, between the create menu and the avatar. A sweep of every frame file that carries screens — `contracts.pen` (C1–C29), `matters.pen` (M1–M23), `settings.pen` (ST1–ST19), `intake.pen` (I1–I8), `documents.pen` (DOC1–DOC7), `entities.pen` (EN1–EN8), and `knowledge.pen` (KN1–KN6) — found no frame of the centre open. `settings.pen` **ST3** draws the Notification _preferences_ pane, which is a different surface and a different slice. So the trigger below is the frame's, and the panel below is built from the written pattern, exactly as DES-027 was: DES-016's panel head, DES-026's row and foot, DES-031's focus rule.

Notification-surface UX is feature-level by this record's own scope line, so the anatomy lands here rather than the feature spec carrying it silently in code — the M15/M16/M17 precedent. Two things in it are reusable and are normalized as such: the counter badge on an icon control, and the header popover panel.

### Decision

**1. The trigger is an icon control in the header's trailing cluster**, before the avatar, at the frame's 16px gap. Lucide `Bell` at DES-008's 20px control step, in the chrome's muted foreground, inside a 24×24 target (DES-011's floor). The frame draws the glyph at 18px, which is off DES-008's ramp; 20 is the step it rounds to and the size every other header glyph already uses.

**2. The badge is the existing alert counter, unchanged.** `bg-badge-alert-bg` / `text-badge-alert-fg`, `rounded-pill`, `h-4 min-w-4`, `text-xs` semibold, overhanging the glyph's trailing top corner. That token pair is already the activity bar's unread chat badge (DES-016, CMT-004), and its Light value is `#cf222e` — the exact fill the frame draws. **This is the normalization point:** one counter badge on an icon control, drawn one way, wherever a count sits on a glyph. The frame's 9px numeral is off the type ramp; `text-xs` (11px) is its floor and the only metadata size there is.

**3. The badge is drawn capped and named uncapped.** "9+" above nine, per NOT-005. The numeral is `aria-hidden`; the count lives in the trigger's accessible name — "Notifications, 3 unread" / "Notifications, none unread" — with the **whole** number, never the cap. The cap is a nudge for the eye, and hiding the real count from a screen reader would make it a nudge that costs information. No badge is drawn at zero.

**4. The centre is a popover panel, not a menu.** A menu's rows are commands with roving focus and every one of them closes it; this panel has a paging control in its foot, a command in its head, and a list of links between them. It is the shared `Popover` DES-048 landed for the calendar (`apps/web/src/components/ui/popover.tsx`), unforked — card chrome, `bg-raised`, `border-border-default`, `rounded-card` — aligned to the trigger's trailing edge and with the shared inset dropped, because this panel's head and rows carry their own and the head's rule has to reach both edges. **This is the second normalization point:** a header affordance whose contents are a panel takes the popover; one whose contents are commands takes the dropdown menu.

**5. It is one panel width.** `--width-panel` (320px), the applet panel's own token, bounded by Radix's available width and height so a phone gets the panel the viewport leaves rather than one that overflows it (DES-012). The list scrolls inside; the head does not.

**6. The head is DES-016's panel head.** 44px, `border-b border-border-muted`, 16px inset, the title at 13px semibold. "Mark all read" is a ghost `Button` on the trailing edge, **drawn only while something is unread** — a control that can only ever do nothing is chrome, not an affordance.

**7. A row is DES-026's row, and the whole row is the link.** 10px vertical / 16px horizontal padding, `border-muted` between rows and none under the last, a 10px gap after a 24px `rounded-pill` medallion on `bg-control` carrying the event family's Lucide glyph at 16px. Then the sentence at 12px `text-primary`, wrapping rather than truncating, then the timestamp at 11px `text-muted` on DES-014's activity-feed rule with the long absolute in the tooltip. The `<a>` wraps all of it: the item carries exactly one action, so a link inside the row would be a smaller target for the same destination.

**8. Rows carry no unread marker.** Opening the centre reads everything it draws (NOT-005), so a per-item dot would go out while the reader watched it. The badge is where unread is said, and it is the only place.

**9. The item's address is a record section, not a record.** An approval request opens Approvals, a task opens Tasks, paper opens Documents, a date opens Key dates, and everything else opens the record (DES-032's routed tabs). Landing a reader on the overview and making them find the thing they were just told about is one click short of the promise, and the sections are addresses precisely so a prompt can name one.

**10. The foot is DES-026's, and the focus rule is DES-031's.** A secondary "Show older" while a further page exists and nothing when it does not; on press, focus lands on the first row of the page just brought. No live-region count: DES-031 clause 5 exempts a surface where focus lands on the new content, which this one does.

**11. Both failures are DES-026's.** A first page that fails says so and leaves no stale list, with reopening as the way back; a failed "Show older" keeps the list and the control, because the retry is already under the reader's hand.

**12. The empty state is the panel's own line** — "Nothing to catch up on. News about your records shows up here." — in the row's own inset, with no foot and no mark-all-read beside it. It says "news", not "anything that needs you": NOT-002's ambient group is here too, and a comment posted on your record is news that needs nothing from you.

### Recorded normalization points (frame deviations accepted)

1. **The glyph renders at 20px**, not the frame's 18. DES-008's ramp has no 18, and 20 is the header's own control step.
2. **The numeral renders at 11px**, not the frame's 9. `text-xs` is DES-006's floor and the metadata size; 9px is under the ramp and under legibility.
3. **The badge takes the shipped alert-counter treatment**, not a bespoke pill. The frame's fill is already the token's Light value, so this is a naming change and not a visual one.
4. **The panel has no frame at all.** Built from DES-016's head, DES-026's row and foot, and DES-031's focus rule — all of them already ratified against frames. A frame drawn for this panel later governs its chrome; the anatomy above is the decision.

### Rationale

Reusing the activity bar's counter badge rather than drawing a second one is the whole of point 2: two counters in one product that disagree about height, radius, or red is the kind of drift nobody reports and everybody sees. The mock's fill turning out to be the token's own value is the evidence that they were always the same badge.

Point 4 is the one that decides whether the surface works. The dropdown menu was on hand and would have looked identical; it would also have closed itself the moment somebody pressed "Show older", because that is what a menu item does. Reaching for the panel primitive is not a preference — it is the only one of the two that can hold a list and a control at once.

Point 8 is NOT-005 restated where it is easy to forget: the read model has exactly one write per page shown, so anything per-item would be a control for a state the reader can never be in.

### Alternatives considered

- **The bell as a route** (`/notifications`), with the centre as a page. Rejected: it makes the prompt a destination, and NOT-005's read-on-open would then mean "navigating away from your work reads your bell". The activity feed is the durable surface; the bell is a glance.
- **A dropdown menu instead of a popover.** Rejected — see the Rationale.
- **An unread dot on each row.** Rejected — see point 8.
- **A per-item dismiss.** Rejected upstream in NOT-005's rationale, and it would need a write this API deliberately does not have.
- **Infinite scroll in the panel.** Rejected in DES-026's own words: a scroll sentinel is not keyboard-reachable and DES-010 requires that affordances are.
- **Showing a total, or "3 of 12".** Rejected for DES-026's reason and M10's: a count over rows the reader cannot see would announce them, and the wall's whole property here is that an omission leaves no gap to notice.

### Consequences

No new tokens and no new primitive: the badge is `badge-alert-*`, the panel is `bg-raised` / `border-border-default`, the row is DES-026's `bg-control` / `border-muted` / `text-primary` / `text-muted`, and `ui/popover.tsx` is DES-048's, reused as it stands. The surface is `apps/web/src/components/notification-bell.tsx` _(moved out of `components/shell/` by the M20/9 addendum below, when it stopped being the staff shell's alone)_, mounted in `AppHeader`; the sentence and the address for each catalog slug are `apps/web/src/lib/notifications.ts`, which is `lib/activity.ts`'s narration layer applied to a second table and takes the same three properties — defensive payload reads, own-key-only lookup, and an explicit fallback arm. The portal bell (M20) renders the same anatomy against the portal's own chrome; if it needs a second popover panel or a second counter badge, points 2 and 4 are already the answer.

### Addendum (2026-08-21, M20/9, [#383](https://github.com/juggernog20/OpenLaw/issues/383)) — the portal bell is this component, not a second one

The Consequences above said the portal bell renders the same anatomy. It turned out to render the same **code**, and the component moved from `components/shell/` to `components/` to say so — it is no longer the staff shell's.

**One prop is the whole difference, and it is the surface.** `surface="staff" | "portal"` selects which four API routes are asked, what the empty panel says, and the trigger's foreground pair. Everything the twelve points above settle — the 24×24 target, the 20px glyph, the capped badge with the uncapped name, the 320px panel, the 44px head, DES-026's row and foot, DES-031's focus landing, both failure states — is one implementation, because it is one decision.

**Only the trigger's colour moves with the chrome.** The staff header is the dark chrome strip and takes `--chrome-nav-muted` / `text-on-inverted`; the portal header is a `bg-raised` strip and takes `text-muted` / `text-primary`. The geometry is identical, so the two bells are the same control in two rooms rather than two controls.

**Point 12's empty line is written twice, once per surface.** "News about your records" is the staff sentence and "News about your requests" is the portal's: the panel names the news it carries, and a requester has no records.

**Point 9 has one exception, and it is a Request.** A contract's prompt opens the section it is about because a contract record has routed tabs; a Request's detail is one page with nothing to name, so every group-5 item lands on `/portal/requests/{number}`.

**The trigger sits in a two-glyph cluster on the portal**, before the gear that opens the portal's notification settings (the INT-001 M20/9 addendum). No frame draws it: `intake.pen`'s I5–I7 carry no bell, and the anatomy above is the decision.

## DES-050: The notification preferences pane — one row per event group, two switch columns (extends DES-017, DES-012, DES-011)

- **Status:** Accepted
- **Date:** 2026-08-18

### Context

NOT-001 gives every person channel toggles over NOT-002's event groups, and the settings inventory has carried the pane as row **ST3** since M5, where it was deferred because the engine behind it did not exist. M18/5 (#320) builds it.

**The frame exists, and it disagrees with the decision it draws.** `settings.pen` **ST3** draws a 720px card titled "Notification preferences" over a three-column table — Event group, In-app, Email — with a 34px column head and 56px rows. Between the head and the rows it draws **seven** rows for **four** groups: "Assigned to you" as one row, then a group header for "Activity on your records" with four indented sub-rows under it (Status changes, Comments, Documents, Signatures), then "Dates approaching" and "New requests" as one row each. NOT-002 keys a preference on the **group** — "a person turns email off for activity on my records, never for one verb" — so four of the frame's rows are controls for a state the model cannot hold.

The frame also draws every In-app switch at 55% opacity, which reads as a locked column. M18's own spec asks for the opposite in its own words: "_As a user, I want to turn bell items on or off per event group, so that even the feed is mine to tune._"

This record settles the pane's anatomy and both deviations. It is a settings pane, so most of it is already decided — DES-017's per-field micro-states, the settings card, the switch DES-004 landed. What is new is the **grid**: a row of controls repeated down a list, which no settings pane before this one has had.

### Decision

**1. The pane is one settings card, flush.** `SettingsCard` at `--width-settings-card` (720px, the frame's own width), the section-header strip carrying "Notification preferences", and an edge-to-edge body — the table owns its gutters, as every flush settings body does.

**2. A row is an event group.** Four rows, in NOT-002's order: Assigned to you, Activity on your records, Dates approaching, New requests. The group's name at 13px `font-medium text-primary`, its coverage under it at 12px `text-muted`, `border-border-muted` between rows and none under the last. The frame's group-header-plus-sub-rows treatment is not built (normalization 1).

**3. The staff pane draws the staff groups.** `requester_events` is the portal audience's own group (NOT-001) and is not drawn here; the API answers all five, so M20 renders it against the portal's chrome. `new_requests` **is** drawn, dormant: nothing fires it until the Inbox lands (M21), and an opinion can be held about a group before anything in it has happened — which is why the group value shipped with the engine.

**4. Two switch columns, both live.** `In-app` then `Email`, 90px each, the shared `Switch` unforked. Neither column is locked (normalization 2). Turning **email** off leaves the group's bell items flowing; turning **in-app** off silences the group entirely, because the email hangs off the bell row — that is the engine's shape, and the pane says so in a caption rather than pretending otherwise.

**5. The state is the effective answer, and there is no third state.** `notification_preferences` holds overrides, so somebody who has never opened the pane has no rows; the API answers what they effectively get and the switches draw it. A switch is on or off — never indeterminate, never "default" as a visible third value. A default a person can see but not name is a state they cannot reason about, and every switch here is theirs to set anyway.

**6. Saving is DES-017's immediate-on-save, with one status for the card.** The switch moves at once, the write goes, and one `StatusNote` in the card's header strip says saving / saved / the refusal — the Appearance pane's arrangement, for its reason: a note per switch would put eight live regions on one card. A refused save snaps the switch back to the server's answer, and the write answers the whole grid so the pane can never drift from what the fan-out will honour.

**7. Below `@lg` of the card's own container, the row stacks** (DES-012 — the card's container, not the viewport). The group and its description on top, the two switches in a row under it. The column heads are for a state where the switches are in columns, so they are `aria-hidden` chrome and drawn only at the wide state.

**8. Every switch is named by its group and its channel.** `aria-labelledby` points at the row's group label and the cell's own channel label, so the control announces "Activity on your records, Email, switch"; `aria-describedby` points at the group's description. The channel label is **visible** in the stacked state and `sr-only` in the columned one — the same element in both, so the accessible name does not change with the width. The column heads are `aria-hidden` precisely because that name already carries the column.

### Recorded normalization points (frame deviations accepted)

1. **Group 2 is one row, not a header and four sub-rows.** NOT-002 keys a preference on the group; a per-event switch would be a control with nothing behind it. The four families are named in the group's description instead, so the frame's information survives without its four controls.
2. **The In-app column is interactive**, not the frame's 55%-opacity locked treatment. M18's story 18 says the feed is the person's to tune, and `notification_preferences` has always held an `in_app` row.
3. **The pane carries a caption the frame does not draw**, under the table: email off keeps the bell items, in-app off turns the group off entirely. Point 4's asymmetry is real, and a switch that silently changes what another switch means has to say so.
4. **The stacked layout has no frame.** ST3 is drawn at 1440×940 only, like every frame in the file. Point 7 is built from DES-012's rule, as every other settings pane's narrow state is.

### Rationale

Point 2 is the whole record. The frame is a faithful drawing of a plausible pane, and it was drawn before NOT-002 fixed the unit a preference is expressed in; building it as drawn would have meant either four rows that write nothing or a fifth preference key nothing reads. Folding the four families into the group's sentence keeps what the frame was communicating — _what does this group actually cover_ — and drops only the controls the model cannot honour.

Point 5 is where a preferences grid usually goes wrong. A tri-state switch that distinguishes "default on" from "explicitly on" is honest about the table and useless to the reader: the difference only shows itself the day somebody changes a default, and the person setting the toggle is not thinking about that day.

Point 8 is the accessibility floor doing real work. A grid of unlabelled switches is the classic screen-reader failure — eight controls all announcing "switch, on" — and the fix is not a `title`, it is naming each control by the two things that identify it.

### Alternatives considered

- **Build ST3 as drawn, with per-event rows.** Rejected: it needs a preference key NOT-002 does not have, and it would ship four switches whose saves nothing reads.
- **Keep the In-app column locked on, as the frame draws it.** Rejected: M18 story 18 and the `in_app` column both say otherwise, and a locked control that looks like a switch is worse than no control.
- **A checkbox grid rather than switches.** Rejected: checkboxes propose and a form disposes; this pane saves on the flip (DES-017), which is exactly what a switch means.
- **One `StatusNote` per switch.** Rejected — see point 6.
- **A "reset to defaults" affordance.** Rejected for now: the defaults are visible as the state of a pane with four rows, and re-flipping four switches is not a workflow worth a control. It becomes worth revisiting if the group list grows.
- **A tri-state switch showing "default".** Rejected — see the Rationale.

### Consequences

No new tokens and no new primitive: the card is `SettingsCard`, the control is `ui/switch.tsx` as DES-004 landed it, the micro-state is `StatusNote`. The surface is `apps/web/src/routes/settings-notifications.tsx`, behind `/settings/notifications`, and the rail entry it needs is the one the M5 close recorded as _omitted rather than disabled_ — SETTINGS-INVENTORY amendment 5, now closed. The portal's own preferences surface (M20) renders group 5 on this anatomy; if it needs a second grid of switches, points 2, 4, and 8 are already the answer.

### Addendum (2026-08-21, M20/9, [#383](https://github.com/juggernog20/OpenLaw/issues/383)) — the portal pane is this grid, and the card around it is the portal's

Point 3 said the staff pane draws the staff groups and that the portal would render group 5 on this anatomy. It renders it on this **grid**, which moved to `apps/web/src/components/notification-preferences.tsx` so that two panes could share one table.

**The pane passes which groups it draws, and nothing else.** The staff route passes four in NOT-002's order, the portal route passes `requester_events` alone, and the column heads, the row, the two switches, the naming in point 8, the stacking in point 7, and the caption in normalization 3 are the same code on both. So is the save chain — the ordered write queue and the snap-back of point 6.

**The card is the surface's, not the grid's.** The staff pane keeps `SettingsCard` at 720px with the status note in the header strip; the portal pane uses the portal's own section chrome at the portal column's width, with the status note in the same place. A 720px card floating in an 880px column would be the one block on that surface that did not line up.

**Point 5 holds harder than before.** `notification_preferences` now **removes** a row saved back to the group's own default (the NOT-001 M20/9 addendum), so "no opinion" and "an opinion that matches the default" are the same stored state as well as the same drawn one. A switch is on or off; there was never a third value for the pane to draw, and now there is not one in the table either.

**Group 5's row is named "Request updates".** Not "Your requests": on the portal everything is theirs, and the row has to name what the two switches turn on rather than repeat whose they are. Its sentence names the four events INT-003 promised — receipts, replies, status changes, and decisions.

## DES-051: The email copy register (closes DES-015's deferral)

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amended:** 2026-08-18 — the digest's anatomy and its delivery rules moved to **NOT-006**. This record keeps the register: the voice every message is written in, where that copy lives, and how it prints a date.

### Context

DES-015 fixed the voice for every string this product renders and named one exception it could not settle: **"Email digest copy (deferred with the notifications-surface decision) — separate register decision when that ships."** NOT-003 then decided that group 3's mail is one morning briefing rather than one message per reminder, and M18/6 (#321) writes it. That is the deferral's own trigger, so this record closes it.

**It closes more than the digest.** Five slices of M18 had already written email copy — the approval request, the three other group-1 events, and group 2's five arms — all of them in `apps/api/src/lib/notifications/email.ts`, all of them composed against no stated register at all. The deferral was written when the only mail this product sent was a set-password link and a magic link, and "email digest copy" was the whole of what was foreseen. What was actually owed is a register for **every message this system sends**.

**Email is the one surface DES-013 and DES-014 do not reach.** The message catalog lives in the web app (DES-013) and the date helpers live beside it (DES-014); a scheduled job in the API has neither, and it has no browser to take a locale or a timezone from. So this record has to say what the API does instead, rather than pointing at two decisions that cannot apply.

### Decision

**1. The register is DES-015's, with two additions email forces.** Terse, second-person, sentence case, digits, no apologies, no "please", no emoji, no celebration. The two additions:

- **A message opens by naming its reader and closes by pointing somewhere.** `Hello {name},` then the sentence, then the link. In the app a person already knows where they are; in an inbox they do not, and an unaddressed message from a system is what a spam filter is shaped like.
- **A sentence, not a summary.** One line says what happened, and the record says the rest. This is why no arm carries a comment's words, a document's bytes, or an approval's note: mail leaves the building, and DD-016's tier and CMT-006's redact both stop at the door.

**2. The copy is authored in English at the call site, not in the message catalog.** DES-013 governs what a browser renders; this is server-composed copy in a process the catalog does not run in, and it is the same class of string as the invite email that predates all of this. Localised email is a real want and it is a **separate** decision, because it needs a per-user locale that SET-006 does not yet store.

**3. Dates in email are formatted by the message, in UTC, in `en-US`.** `Mar 12, 2026`. DES-014's helpers are the browser's and take the reader's own zone from it; a scheduled round has no browser. Every date this layer prints is a **civil date** (CTR-006, CTR-009) — a day and not a moment — so rendering it in UTC is what stops it moving a day, and shifting it into any zone at all would be the bug.

**4. What a message _says_ is this record's; what the round _sends_ is NOT-006's.** The morning digest's anatomy — its subject, its blocks, its order, when a distance is counted, and the rule that no empty briefing leaves — is a delivery decision and lives in `DECISIONS-NOTIFICATIONS.md` as **NOT-006**. Both records govern the same file; this one says how a sentence is written, that one says which sentences go and in what order.

### Recorded normalization points (frame deviations accepted)

1. **There is no frame, and there will not be one.** No `.pen` file draws an email, because an email is not a screen this product renders. The register above is the decision, and it is DES-015's voice plus the two additions an inbox forces.
2. **The body is plain text.** `MailMessage` carries `text` alone; an HTML alternative is TECH-011's to add, and adding it now would put two copies of every sentence in one file.
3. **`→` and other decorative glyphs are not used**, even though a plain-text message has no Lucide to reach for. DES-008's substance is that glyphs are a system, and a message with no glyph system uses words.

### Rationale

Point 1's second addition is the one that matters most. Five of the six sentences this layer already writes end with a version of "the rest is on the record", and that reads like restraint until you notice it is the only thing holding two other decisions up: DD-016's tier is enforced on the thread, and CMT-006's redact cannot reach an inbox. A register that let one arm quote a comment would quietly repeal both.

Point 4 is why this record was split. DECISIONS-DESIGN.md is front-end design — visual system, layout, interaction, formatting — and a rule about _when_ a round may send, or which rows it orders first, is none of those. Left here, the next reader looking for what the morning round sends would read the notifications record and not find it, and a change to a send rule would land in a design file.

### Alternatives considered

- **Leave the deferral open and record only the digest.** Rejected: five slices had already written email copy against no register, which is the drift DES-015 exists to prevent. The exception has to close, not narrow.
- **Put the email strings in `messages/en-US.json`.** Rejected — see point 2. The catalog is loaded by the web app; the sender is a worker process.
- **Render the date in the reader's profile zone.** Rejected: a civil date has no zone, and shifting it into one is what moves "1 March" onto 28 February for half the world.
- **An HTML digest with a table.** Rejected for now — see normalization 2. It is TECH-011's to add, and the copy is the same copy either way.
- **Keep the anatomy here, as one record.** Rejected — see the Rationale for point 4. One record was easier to write and puts delivery rules where nobody would look for them.

### Consequences

DES-015's "Where this register does _not_ apply" loses its email bullet: this record is the separate register it pointed at. The surface is `apps/api/src/lib/notifications/email.ts` — `renderNotificationMail` for the immediate arms and `renderDigestMail` for the briefing — and every future event adds an arm there rather than a second place that knows how an OpenLaw email is laid out. The portal's requester mail (M20, group 5) is written to this register too. Localised email and an HTML alternative are the two things this record deliberately leaves open, each with its own reason above. **The digest's own shape is NOT-006's**, and a change to what the round sends belongs there.

## DES-052: The value-list editor — the list-editor anatomy for a list of values (extends DES-020, DES-021)

- **Status:** Accepted
- **Date:** 2026-08-18

### Context

NOT-004 gives an install one reminder-offset list — seeded 7 days / 1 day / day-of, applied to every tracked date — and M18/6 (#321) built the column and the round that reads it live. M18/7 (#322) builds the pane that edits it, in Settings → Organization → Notifications.

**There is no frame for it.** `settings.pen` carries nineteen frames and none of them is this pane; the file's only notification frame is **ST3**, the Personal preferences grid DES-050 already settled. What the file _does_ draw is the rail entry: ST4's Organization group lists **Notifications** between Intake and Integrations, wearing the Lucide `bell-ring` glyph to the Personal entry's `bell`. So the rail is spec'd and the pane body is not.

**The anatomy it should follow is DES-020's, and DES-020 does not quite fit.** The list-editor was written for a _taxonomy_: rows records point at, renamed in place, archived rather than deleted so the records that reference them keep their meaning. A reminder lead time is none of those things. Nothing points at "7 days before"; there is no name to rename, because the number **is** the row; and archiving it would be retaining a value that has no history to retain. DES-020's own consequences clause says a surface that genuinely cannot fit the anatomy gets a record rather than a local deviation, and DES-021 already stretched the one `ListEditor` component once for the fields catalog. This record is the second stretch, written the same way.

### Decision

The `ListEditor` component stays the one implementation of DES-020. A **value list** is a second sanctioned variant beside DES-021's table variant, and these are its parts:

**1. The card, the rows, and the grip are DES-020's, unchanged.** `SettingsCard` at `--width-settings-card`, flush; the `bg-section-header` strip carrying the title, the ICU-plural count caption, the save note, and the Add CTA; 44px rows separated by `border-border-muted`; the 36px grip column with the 16px `grip-vertical` glyph; the help caption below the card. Nothing about the geometry changes, because nothing about it was taxonomy-specific.

**2. A row is a value, and it is not renamed.** The name cell renders as static 13px `font-medium text-primary` text rather than DES-017's click-to-edit button. A value has no display name to correct — changing "7 days before" to "8 days before" is not a rename, it is a different lead time — so the list is edited by adding and removing, and the in-place editor would be an affordance with nothing behind it.

**3. The trailing action is remove, not archive.** A 16px Lucide `x` glyph in the trailing slot, named "Remove [value]". DES-020's archive exists so records pointing at a taxonomy row keep their meaning; nothing points at a value, so there is nothing to retain, nothing to reassign, and no archived tier. The "Show archived" toggle and the archived-row treatment do not render.

**4. A structural minimum wears DES-020's lock.** Where emptying the list would be a state nobody may reach by accident — an offset list with nothing in it is silence for every reminder in the install — the **last remaining row** renders the 16px `lock` glyph in place of remove, with an accessible name saying why ("[value] is the only lead time and can't be removed"). This is DES-020's protection treatment applied to a floor rather than to a seed row: protection is a fact about the state, not a disabled button, and the server refuses regardless of what the pane draws.

**5. The list is the unit of save.** Adding, removing, and rearranging are all one write — the whole list, sent the moment the change is made (SET-003 immediate apply). It follows that there is one save note for the card rather than one per row, in the header strip beside the count: a per-row note would claim a row saved when what saved was the list. It also follows that **one write is in the air at a time**, which is the rule DES-020's grip already follows; the Add CTA and every trailing action stand down while a save is in flight, so a press the pane would refuse cannot be made in the first place.

**6. The order is the reader's, not the machine's.** A value list is ordered because a person reads a ladder in an order and expects to find it where they left it, so the saved order is what the pane draws and what the next reader sees. It carries no behaviour: the round matches each lead time on its own, so no arrangement of the list can change which day fires. Rearranging is still a save, and still narrated, because the stored list is the canonical one.

**7. Reorder is keyboard-operable, per DES-020.** The grip is a real button; Arrow Up / Arrow Down on the focused grip moves the row one position and commits immediately; the move is announced through the polite live region ("[value] moved to position 2 of 3"). Drag is the pointer path, never the only path.

**8. The inline add row is DES-020's, with the unit as the label.** The Add CTA opens a draft row at the end of the list carrying one focused input; Enter creates, Escape discards. Where the value has a unit, the unit is drawn beside the input as visible text **and** is what names the input (`aria-labelledby`), so a reader hears "days before the date, spin button" rather than a bare number box and nobody has to guess what the number counts. A value the list already holds is refused in the draft row without a request, because the list is a set.

### Recorded normalization points

1. **The pane has no frame.** ST3 is the Personal grid; nothing in `settings.pen` draws the Organization pane. It is built from this record and DES-020's geometry, and the file is not redrawn — for the ST7 reason recorded in the M15 inventory amendment: a frame is added when the surface it would draw is settled, and the M19 Intake pass owns the next sweep of this file.
2. **The rail entry ships as drawn.** Organization → Notifications, `bell-ring`, positioned as ST4 draws it — after the module sections and before Integrations, with Entities taking the place the mock's unshipped Intake entry holds.
3. **The screen title is not the rail label.** The rail says "Notifications", as the mock draws it; the browser title says "Reminder lead times", because DES-011 commitment 7 asks every screen for a title of its own and the Personal pane is already "Notifications". The URL is `/settings/reminders` for the same reason — two panes cannot share an address.
4. **Two rail sections now share a label**, so each rail group is an ARIA `group` named by its own heading. The headings were already drawn and already `hidden` in the phone strip; `aria-labelledby` reads a hidden element regardless, so "Organization, Notifications" is what distinguishes the two at every width.

### Rationale

Points 2 and 3 are the record. The alternative was to draw a value list _as_ a taxonomy — a renameable name, an archive glyph, an archived tier — which would have offered three affordances that write nothing and would have taught the next builder that archive is what the trailing slot always holds. Naming the variant is what keeps `ListEditor` one component with two honest shapes instead of one component with a growing set of props nobody can tell apart.

Point 4 is where a settings list usually goes wrong. "Remove the last one and the feature silently stops" is a state a person reaches by pressing a button they had every reason to press. DES-020 already had the right treatment for a row that may not go — the lock, with a name saying why — and a floor is that same fact stated about the list rather than about a seed.

Point 5 is the #320 lesson said once more. That pane's three race conditions all came from one shape: a write that answers more state than it changed. Every write here answers the _whole_ list, so two of them racing would let the slower reply land last and undo the faster press. One at a time, with the controls visibly standing down, is the smaller and more explicable rule — and it is the rule the grip has followed since DES-020.

Point 6 is stated because the honest answer is unusual. It would be easy to imply the order means something and easier still to hide the control because it does not; the truth is that a person tuning a lead-time ladder wants to see it in an order and the round does not care, so the pane keeps the order and the record says plainly that it is presentation.

### Alternatives considered

- **A bespoke pane outside `ListEditor`.** Rejected: a second anatomy to keep aligned by eye, which is the drift DES-021 already declined once.
- **Reuse the taxonomy shape as-is — rename the value, archive the row.** Rejected: three affordances with nothing behind them, and an "archived lead time" is not a thing NOT-004 has.
- **Draw the list sorted furthest-first and offer no reorder.** Rejected: #322 asks for reorder, and a saved order is what a person expects to find again. The round still sorts its own read, which is where sorting belongs.
- **Let the list be emptied, and treat empty as "no reminders".** Rejected upstream: NOT-004's read falls back to the seed on an unusable list, so an empty list could not be told from a corrupt one. Silence is chosen per event group on the DES-050 pane, where it is a choice with a name.
- **Edit the value in place, DES-017 style.** Rejected: a number typed over another number is a remove and an add, and treating it as a rename would make the audit entry say a lead time was renamed when the schedule changed.
- **A note per row rather than one for the card.** Rejected — see point 5. The row is not what saved.
- **Drag-only reorder.** Rejected: DES-011, and DES-020 answered it already.

### Consequences

`apps/web/src/components/list-editor.tsx` gains three optional inputs — the remove pair, and a `busy` flag for a save that covers the whole list — and its rename and archive pairs become optional. Every existing caller passes what it always passed and renders identically. The surface is `apps/web/src/routes/settings-reminders.tsx` behind `/settings/reminders`, and `apps/api/src/modules/org/routes.ts` carries the `GET`/`PUT` pair the pane reads and writes. The next value list — a digest send hour, a retention window, any admin-tuned ladder — builds to this record rather than re-deriving it; if it needs the value to be editable in place rather than removed and re-added, that is a third variant and a fourth record, not a local deviation here.

### Amendment (2026-08-20, [#356](https://github.com/juggernog20/OpenLaw/issues/356)) — the second mount: a value that has parts

The deflection links pane (frame **ST13** in `settings.pen`, INT-004) is the second value list, and it is the one this record's point 2 did not picture: a reminder lead time is one number, and a deflection link is a label, an address, and a placement. Points 1 and 3 through 7 stand exactly as written — the card, the geometry, the grip, the keyboard reorder, the announcement, and remove-not-archive are what ST13 draws. Three clauses stretch, and this is how far.

**A value may have parts, and then the row has two lines and a cell.** The row is 52px, not 44px: the label reads as the name in 13px `font-medium text-primary`, and the address sits under it as the row's second line in 12px, wearing `--text-link` because it is a web address. It renders **without its scheme** — every row would repeat the same `https://`, and a scheme tells a browser how to fetch rather than telling a person where they are going; what is stored and what a requester follows keeps it. Beside the name cell sits **one fixed-width cell** carrying the placement chip: DES-021's chip anatomy, `status-neutral`, with its sr-only `Placement:` prefix, because a link labelled "Portal home" whose chip reads "Portal home" is two different facts.

**One cell is a qualifier, not a table.** DES-020's M19/4 amendment binds the header strip, the cells, and the second line together for a pane that declares _columns_ — a taxonomy with several dimensions to say about a row. ST13 declares one, and draws no header strip: a single chip in a fixed slot reads as DES-020's original qualifier-pill slot given a width so the chips line up, and a one-column header would be a rule across the card labelling nothing the chip does not already say. The binding holds from two cells up; below that the pane draws the chip and no strip.

**Creation is a dialog, and so is the edit.** Point 8's inline draft row carries one input; three fields is DES-021's dialog threshold, so Add opens the DES-021 editor dialog — Label, Address, Placement, each with its help caption — and the trailing slot gains the DES-021 pencil that reopens the same dialog on a row. The in-place rename stays absent, as point 2 says: the label is edited in the dialog beside the address it belongs with, not on its own.

**Recorded ST13 normalization points.** (1) The frame draws `trash-2` in the trailing slot; it ships as this record's point 3 `x`, because that glyph is the variant's and this is its second mount rather than a new one. (2) The frame draws no edit affordance; the pencil is this amendment's addition, for DES-021's reason at ST11 — a row with three editable dimensions and no way into them is a dead end. (3) The frame's chip sits on `$control`; it ships through the `status-neutral` pair, the chip token pairing DES-021's first normalization point fixed. (4) The frame draws the address in `$status-info-fg`, which is `--text-link`'s Light value; it ships as `--text-link`, the token the DES-011 contrast gate holds against every surface. (5) The frame sets its description line inside the card above the rows; it ships as DES-020's help caption below the card, where every other list-editor pane puts the same sentence.

## DES-053: The status moves from the strip — the current stage is the trigger (extends DES-034, DES-017, DES-032)

- **Status:** Accepted
- **Date:** 2026-08-19

### Context

Issue `#325` asks for a control that makes a status change feel like the deliberate step it is, and names what it replaces: a plain `<select>` in the Contract card, indistinguishable from the four other selects beside it. A status change is not like setting a priority. It is the sentence the whole record is read through, and CTR-012 already treats one class of it as worth stopping for.

Three constraints were fixed before the first sketch.

**Movement is free** (CTR-001). Any status to any status — forwards, backwards, and skipping — because deals collapse and redlines reopen after sign-off. So nothing here may fill up, ratchet, or lock; the six stages are a position, never a progress bar.

**The chrome is spent** (DES-032, DES-034). The record already carries a 48px nav, a ~64px sub-bar that wraps to two lines under 1024px, and a 36px section strip. DES-032 closed the door on a new permanent horizontal band, so a "next step" ribbon across the top of the body was never available.

**The record already says where the contract is, twice.** The sub-bar pill takes the renameable status label; the six-stage strip beside it takes the fixed stage that label maps to (CTR-001, one datum at two zooms). Both were readings. Neither did anything.

Six iterations are drawn in `designs/stage-component-design.pen` — a command palette, a status card of its own, a move panel carrying the whole flow, a 400px phone sheet with the soft gate as its second page, a history applet in the DES-016 rail, and frame **06 — Current stage opens the menu**. Frame 06 is the one this record builds.

### Decision

**1. The strip stays a reading, and exactly one of its six items is pressable.** The item is the one the contract is on. Every other stage is what it always was: a name, a check where the marker has been past, and no affordance. One pressable stage rather than six, because a stage is not what commits — see point 3 — so five of the six presses would have been a guess about which status was meant.

**2. The trigger is the current stage's pill, wearing a border and a chevron.** It keeps its DES-005 stage family, so the strip still reads as one sequence at a glance. What says it can be pressed is a `border-border-default` outline and a 12px `chevron-down` — never colour alone (DES-011) — and it carries the strip's own 12px interior glyph size that DES-034 records. It takes a `min-h-6` floor so a pressable row of an 11px strip still offers DES-011's 24px target, the standard focus ring, and the button vocabulary's own hover.

**3. The menu offers statuses, and names each one's stage.** A status is what commits; a stage is derived from it, and two statuses may share one (CTR-001, and the seeds prove it — "Internal review" and "With counterparty" are both `review`). So the trigger is labelled with a stage and the list under it is not, and every row carries its stage on the right in muted 11px text. Without that column the two `review` rows would read as an unexplained pair.

**4. The list is flat, in the seam's own order, and every status is one press away.** No grouping, no distance ordering, no greying of what is "backwards". CTR-001's rule is that movement is free, and a menu that ranked its rows would be the first surface to imply otherwise.

**5. The status the record holds is checked, and picking it again commits nothing.** The rows are a `menuitemradio` group, because the record holds exactly one status: the check says where the contract is, in the menu as well as on the strip. Re-picking the checked row is not a move, and sending it would write an activity entry saying a contract moved to where it already was (DD-017).

**6. The status leaves the Contract card.** One datum gets one control. The card keeps every other inline field; the status commits from the strip, which is on screen in all six sections rather than on the Overview alone.

**7. The move prints the refusal alone, and the control carries the rest.** The seam's own refusal is printed beside the strip, where the press was made — a refusal has nowhere else to go, and the soft gate's own is still cleared as its dialog opens so the two never speak at once (DES-035 clause 12). "Saving…" and "Saved" are not printed. The trigger is disabled while the write is out, and it redraws on the new stage the moment the write answers, so the strip is already both the progress and the receipt; a word beside it would say a second time what the reader is looking at, and on a write this short the two would only flash past.

This is the one carve-out from DES-017's micro-state trio, and it is available only because this control both blocks and redraws itself. A field whose control looks the same after its write keeps all three states — the pane and the card fields are unchanged.

**8. The soft gate is untouched** (CTR-012). The browser does not work out whether a move crosses the approval line; it sends the commit, and the seam's refusal is what raises the shipped dialog. The gate warns and never blocks, and it now warns about a press made in a different place — which is exactly why the rule stayed at the seam.

**9. A viewer who may not move the contract gets no trigger at all.** Absent, not disabled. An archived record and a Contributor (CTR-021) both read the strip exactly as it read before this record: where the contract sits is a fact about it, not an affordance. Nothing greys out, so nobody has to work out why.

### Recorded normalization points

1. **The mock redraws the strip as a segmented control**, on a 32px track with 3px of padding and a 4px-radius chip. The build keeps DES-034's strip geometry and its `rounded-pill` current item, and adds the border and chevron to it. The change under test is the affordance, not the chrome, and a second geometry for the same strip would be a second thing to keep true.
2. **The mock draws a stage dot on every menu row.** The build does not. The stage is named in words on each row, which is the carrier DES-011 asks for, and a dot would need a colour map of its own — the `onhold` family inverts its pair, so `ended` alone would need a second rule.
3. **The mock pins a "suggested next" row at the top of the menu.** Not built: there is no flow in the product. CTR-001 has an order of stages, not a configured graph over statuses, so the only suggestion available would be a guess dressed as a recommendation. This is the first thing to add to the menu if a flow ever lands.
4. **The mock draws the soft gate as a popover in the menu's place.** The build keeps CTR-012's shipped dialog. The gate is a decision with two named people on it, and it already reads well; redrawing it was not what #325 asked for.
5. **A stage the build cannot place leaves no trigger.** `CONTRACT_STAGES` is checked exhaustively against the generated API union, so this needs a server newer than its own schema. The strip already drew that case as "not placed"; the move control is absent with it, and the seam stays the authority.

### Rationale

Point 1 is the whole record. The reader's eye is already on the strip — it is the only thing on the sub-bar that answers "where is this?" — so the act costs no search. Fusing a CTA to the strip instead (Salesforce's Path) was measured on the real chrome and rejected: at 1024px DES-034 already wraps this row, and a button wide enough to name its target truncates the contract's title to nothing.

Point 3 is the vocabulary, enforced. It would have been easy to draw six pressable stages and call it a stage picker, and it would have been wrong the first time a team kept two `review` statuses — which the seeds already do. The record commits a status; the strip is a reading of the stage that status maps to; the menu is the only place where the difference has to be drawn, and it is drawn as words.

Point 5 is the smallest rule with the largest effect on the activity feed. Radix answers a pick on the checked row, and without the guard the feed would fill with moves to where the contract already was.

Point 9 follows the convention the nav, the settings rail, and the archive action already keep. A disabled control is a question — a reader has to work out whether it is their role, the record's state, or a bug — and the answer here is never actionable by the person asking.

### Alternatives considered

- **A primary "Move to [next status]" button in the sub-bar**, which is #325's own first idea. Rejected: naming the next status needs a flow, and there is not one. Without it the button names a guess, and a guess in a CTA is worse than no CTA. Revisit with the flow.
- **Every stage in the strip pressable.** Rejected with point 3: two statuses may share a stage, so half the presses could not be answered without a second question.
- **Redrawing the strip to show statuses rather than stages.** Rejected: eight configurable labels, some of them sentences, in a slot the sub-bar cannot grow. The strip is fixed and short precisely because the stage list is.
- **Keeping the card's select as well.** Rejected: two controls for one datum, and DES-017's inline rule does not ask for a field to be editable twice.
- **A move panel in the DES-016 activity rail** (frame 05), which would also have carried the contract's history through the flow. Rejected for now: it puts the act one press further away and behind an applet toggle, and the rail is already three applets deep. Worth revisiting when the history it would show exists as a surface.
- **A command palette move** (frame 01) and **a phone sheet** (frame 04). Rejected as the primary path, not as paths: the trigger is a real button in the tab order and the menu is arrow-key operable, which is the keyboard story this surface owes. On a narrow shell the strip wraps to the sub-bar's second line (DES-034) and the trigger wraps with it.
- **A confirmation on every move.** Rejected: CTR-012 already spends the one confirmation this act gets, on the one crossing that earns it. A second would be the confirmation nobody reads.

### Consequences

`apps/web/src/components/stage-pipeline.tsx` gains one optional `move` input and the `MoveMenu` it draws. Without it the component renders exactly as before, which is what every read-only mount gets.

The Contract card loses its Status field. `contracts.form.status` goes; `contracts.stage.move` and `contracts.stage.moveTo` arrive. The trigger's accessible name is `{stage} — move contract`, which leads with the visible word so speech input can still ask for it by what it says (WCAG 2.5.3).

Six e2e specs drove the status through `getByLabel("Status")`. They now open the menu and pick a row, and the two that asserted which status was held read the menu's checked row instead — the sub-bar pill cannot answer it, because a status label and a stage name are often the same word.

The seeded `redlining` status is renamed to **"With counterparty"** by `0056_redlining_status_rename.sql`, guarded on the old text so an install that renamed it keeps its own name. `0009` seeded it as "Redlining with counterparty", which names the act; a status says where the contract sits, so the label says who holds it. Drawing the status list in a menu is where the wrong word showed.

## DES-054: The collapsible settings card — the header is the disclosure (extends DES-020, DES-011)

- **Status:** Accepted
- **Date:** 2026-08-19

### Context

The Integrations pane is a credential form and nothing else. `SETTINGS-INVENTORY.md`'s M15 amendment recorded why: ST7 draws a **summary row** for DocuSign — logo, name, a "Connected" pill, a Configure button — and the build replaced it with the form itself, because the button implied a second screen the pane does not have.

That trade landed the pane on the other extreme. Five credential fields, two of them write-only, a read-only webhook URL, a switch, and a remove button are on screen at all times on an install where the connector was set up once and has worked ever since. The AI-analysis card joins the same pane in M31 (SET-007), so the pane's steady state is two full credential forms stacked.

There is a disclosure in Settings already: `RailSubgroup` collapses the Security group in the rail (SET-001 amendment). Nothing yet collapses a card.

### Decision

**1. A settings card can be a disclosure, and it is opt-in.** `SettingsCard` gains `collapsible`; without it the card renders exactly as it did, which is what all thirty existing call sites get.

**2. The card's own title is the button.** Not a caret at the far end, not a second control beside the name. The button takes the header strip's free width, so the target is the header rather than the six letters in it — and the header still holds its `actions` slot, which stays outside the button, because a control inside a button is not a control.

**3. The anatomy is the rail's disclosure, one level up.** A 16px `ChevronRight` closed and `ChevronDown` open, `text-muted`, before the name; `aria-expanded` and `aria-controls` on the button; the body **conditionally rendered, not hidden with CSS**, which is what `RailSubgroup` does and what keeps a closed card out of the tab order without an `inert` of its own.

**4. A closed card carries the card's own bottom edge.** The header strip drops its bottom rule and takes `rounded-b-card`, so a closed card is a header and not a header with a line under it and a border under that.

**5. The state is the card's own, and it does not persist.** Local state, reset by navigation, the same as the rail's groups. Nothing about which cards a person left open is worth a row.

**6. The E-signature card opens on an install with no connector and starts closed once one is stored.** The setup is the only thing the pane is for until it is done; after that the credentials are reference. This is the rule any Integrations card follows — closed once it holds a working configuration.

**7. A closed card says what it is, on the header, in one chip.** `bg-status-neutral-bg` "Not connected", `bg-status-success-bg` "Connected", `bg-status-onhold-bg` "Turned off" — the three states the connector row can be in, on the `rounded-pill` 11px chip anatomy the entities list already uses. Without it, closing the card would hide the one fact somebody opens this pane to check.

### Rationale

This is ST7's summary row, reconciled with the build rather than against it. The mock was right that the steady state of an integration is a name and a status; the build was right that Configure must not open a second screen. A disclosure is both: the summary is the header, and the form is behind it, in place.

The title-as-button is what makes it cheap. A card that grows a caret grows a control; a card whose heading is already the button grows nothing, and the reader who wants the form clicks the word they were already reading.

The rail's disclosure is reused rather than re-decided because two disclosures in Settings that behave differently is worse than either behaviour. Conditional rendering, not CSS, is the part worth naming: a `hidden` body keeps five focusable credential fields in the tab order of a card that is visibly shut.

### Alternatives considered

- **A caret at the trailing end of the strip, as V12's card chrome drew it.** Rejected: DES-041 already declined that caret for the record's cards, and it makes the target an icon where the whole header could be one.
- **Every settings card collapsible.** Rejected: a list-editor pane is one card and the pane's whole reason for existing; collapsing it hides the pane behind itself. The Integrations pane is the case where a card is a stored configuration rather than the destination.
- **Closed by default, always.** Rejected with clause 6: on an install with no connector that hides the only thing to do behind a click, on the one visit where the pane has a job.
- **Persisting open cards per user.** Rejected: a preference row for something a click restores.
- **`hidden` or `max-height` on the body instead of unmounting it.** Rejected with clause 3 — and an animated height would be chrome motion on a surface DES-003 gives no motion budget.

### Consequences

`SettingsCard` gains `collapsible` and `defaultOpen`, a `useId` for `aria-controls`, and a `display: contents` wrapper around the body so a plain card lays out exactly as before and a `flush` body still reaches both edges.

`SettingsESignaturePage` sets `collapsible`, `defaultOpen={!connector.configured}`, and a `ConnectionChip` in the header's `actions` slot. Three ICU messages arrive: `settings.eSignature.chip.connected`, `.notConnected`, `.turnedOff`. No new tokens — the chip uses three existing status families.

`SETTINGS-INVENTORY.md`'s M15 delta 1 is **partly discharged**: the pane now has ST7's collapsed summary treatment, without ST7's Configure button and without a second screen. The M31 redraw it schedules is still owed, and it now has two collapsed cards to draw rather than one row and one form.

The M15 e2e spec opens the card before it fills the form, because a rerun inherits whichever state the last run left.

### Amendment (2026-08-19): closed by default, always

**Clause 6 is superseded.** An Integrations card starts **closed**, connector or no connector. `SettingsESignaturePage` passes `defaultOpen={false}`.

The clause traded the pane's steady state for its first visit. That first visit happens once per install; every visit after it opens on a credential form nobody asked for. The chip on the header already says "Not connected", which is the same instruction the open form was there to give, and the form is one click behind the name.

This also makes the pane one shape rather than two. With the AI card joining in M31 (SET-007), a pane whose cards open or not depending on what is stored reads as a pane that lost track of itself. Closed, it is a list of integrations and their states — which is what ST7 drew.

The "Closed by default, always" alternative above is therefore **accepted**, not rejected.

## DES-055: The record's overflow menu — the acts that belong to the whole contract (extends DES-034, DES-017, DES-053)

- **Status:** Accepted
- **Date:** 2026-08-19

### Context

The contract record's sub-bar ends in one control: an Archive button, secondary variant, sitting where DES-034 clause 3 puts the record actions. It has been the only member of that group since M8.

A single naked button in a slot named "the record actions" is a slot that cannot grow. The next act that belongs to the contract rather than to one of its fields has nowhere to go but beside it, and DES-034 clause 4 already wraps this row at 1024px with one button on it.

The button also has the wrong weight. Archiving is a soft delete — the seam calls it that, and says "nothing is deleted, and restore is the way back" — but a permanent button in the chrome reads as the record's primary act, which it is not. What a reader does with a contract record is read it and edit its fields; archiving it is the rare last thing.

### Decision

**1. The record actions become one overflow menu.** The trigger is the house pattern the key-dates and tasks rows already use: a `ghost` `size="icon"` button carrying Lucide's `MoreHorizontal` at 16px, opening a `DropdownMenu` aligned to its end. It is the last thing in the sub-bar, where the Archive button stood.

A fixed-width trigger is also what DES-034 clause 9 needs. The strip is pinned against this group, so a group whose width changes with its contents would unpin it — which is exactly what a button that says "Archive" on one record and "Restore" on the next was doing.

**2. A row a reader may not act on is absent, not disabled** — the convention the nav, the settings rail, and DES-053 clause 9 already keep. So the menu is not all-or-nothing: **copying a link is not a change to the record**, and a Contributor gets that row where they get no other. A Contributor's menu holds one row; an archived record's holds two.

**3. Rename opens no editor.** The title has exactly one editor — the field on the Contract card (DES-017) — and DES-053 already refused a second control for one datum. So the row is a way to that field, not a way around it: it takes the reader to the Overview section if they are on another one, scrolls the field to the middle of the viewport, focuses it, and selects its text so the next keystroke is the new name. The commit is the field's own, on blur or Enter, in one PATCH. An archived record has no editable title, so it has no rename row.

Centring rather than merely revealing is deliberate: the sub-bar and the section strip are sticky, and `scrollIntoView` alone can leave the field under them. The scroll is instant — DES-003 spends the motion budget on hover and focus, and this is neither.

**4. Copying says so in the row, and the menu stays open to let it.** The row swaps to a `check` glyph and "Copied" for 2 seconds — the same pattern and the same 2 seconds the e-signature pane's copy button already spends — and its `onSelect` prevents the default close. Closing the menu on the press would take the only confirmation with it, and a note in the chrome for a clipboard write is chrome for something that changed nothing.

The link is the record's own address, `/contracts/{number}`, not the reader's current one. A link copied from the Documents section should open the record, not a section the person receiving it may not be looking for.

**5. Archive keeps DES-053 clause 7's treatment: the refusal prints, the progress and the receipt do not.** The trigger is inert while the write is out, and the record answers in full when it lands — the row flips to "Restore", the Archived pill appears in this same row, the archived note appears over the body, and every field freezes. "Saving…" and "Saved" beside all of that would be the flash DES-053 clause 7 removed, on the other act that commits from this bar.

**6. There is no Delete.** Archive **is** the soft delete for a contract, there is no route that destroys one, and the activity log (DD-017) is the reason. A menu is the surface where a Delete row would look natural and cost nothing to add, which is precisely why this record says it does not exist: the absence is a decision, not an omission. It is the first thing to revisit if a retention policy ever lands.

### Recorded normalization points

1. **The ask was a hamburger.** The build uses `MoreHorizontal`. In this system a hamburger means navigation, and every overflow menu already shipped — the tasks row, the key-dates row, the documents row, the column menu — uses the ellipsis. A second glyph for one meaning is the drift DES-008 exists to prevent.

### Rationale

Clause 2 is the clause worth defending. It would have been simpler to keep the whole menu behind `canEdit` and match the button it replaces exactly. But the button was only ever mutations, and the menu is not — the moment it holds one row that changes nothing, "who may see this menu" and "who may act in it" stop being the same question. Answering them separately is what lets the record offer a Contributor something useful in the chrome for the first time.

Clause 3 is where a menu earns its keep without earning a second editor. "Rename" is what a reader looks for when the title is wrong; the field is what actually renames it. Pointing one at the other costs no new state, no dialog, and no second commit path — and it keeps the audit entry identical to the one an inline rename has always written.

Clause 6 is the shortest clause and the one most likely to be reopened. Recording it as an absence with a reason means the next person to ask finds an answer rather than a gap.

### Alternatives considered

- **Keeping the Archive button and adding the menu beside it.** Rejected: two controls in the slot DES-034 gives one group, on a row that already wraps at 1024px.
- **A menu behind `canEdit`, matching the button it replaces.** Rejected with clause 2 — it would hide the copy row from the readers most likely to be sent a link rather than to find one.
- **Rename in a dialog.** Rejected: it is a second editor for a datum that has one, which is DES-053's own rejected alternative wearing a different hat.
- **A toast for the copy.** Rejected: this system has no toast, and DES-017's micro-state is for writes to the record. A clipboard write is neither.
- **"Duplicate contract" and "Export".** Not built: neither has a route behind it. They are the two rows to add first if they get one.
- **A Delete row that archives.** Rejected outright: a row labelled Delete that does not delete is the worst of both, and the audit trail is the reason the act is a soft delete in the first place.

### Consequences

`apps/web/src/components/contracts/record-actions-menu.tsx` is the component; the contract record's sub-bar is its only mount. The record gains `renaming` state and a `focusTitle` helper; it loses the `Archive`/`ArchiveRestore` imports and the button they dressed.

Three ICU messages arrive — `contracts.record.actions`, `.copyLink`, `.rename`. `contracts.record.archive` and `.restore` stay, on menu rows now. No new tokens.

Anything that drove the record by pressing an "Archive" button now opens the menu first. The M8 e2e spec's Contributor check asserts the menu's rows rather than the absence of a button, which is the stronger assertion — it proves what the reader _is_ offered, not only what they are not.

## DES-056: The Inbox — a fixed list, not a curated one (extends DES-018, DES-031, DES-046)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

The Inbox is the first destination a Legal Team Member opens, and the first list in the product that is not a module registry. `designs/intake.pen` I1 draws it as a wide table under a filter row: Type and Urgency chips, a "Show triaged" control, and the Filter and Columns buttons the Contracts destination now carries for real (DES-046).

Two of those things are the same shape and only one of them is this screen's. The Contracts list is a **curated destination list** — DD-019 gives a reader columns, filters, a sort, and a saved view over it. The Inbox is **fixed**: INT-006 fixes its order and INT-007 fixes its contents, and both are product decisions rather than reader preferences. A reader who could sort the Inbox by Requester could take away the one thing the Inbox promises.

### Decision

**1. The Inbox draws I1's seven columns and no column machinery.** Ref, Summary, Type, Requester, Urgency, Age, and the row's Assign button. There is no Columns menu, no Filter menu, and no saved views: DES-046's managed table is for a destination list, and this is the Inbox. The chips I1 draws for Type and Urgency are not built for the same reason — a filter over a fixed list is a curation control, and the ones worth having are the ones the Inbox's own order already gives.

**2. Show triaged is the one control, and it is the house switch.** A `Switch` with its `Label`, right-aligned in a row above the table, where the Entities registry's Show archived and the Contracts list's Show ended already sit. I1 puts the words among its filter chips; the chips are not built, and an isolated left-aligned control in an otherwise empty row would be a third position for a control this system has already placed twice.

**3. Turning it on grows an Outcome column, at the end of the row.** The default Inbox is all `new` — INT-007 took the Status column out for exactly that reason — so a column that said "New" on every row would be the column INT-007 removed. Under the toggle there is something to say, and the column says it: the DES-005 status pill for the Request's arm, plus the C-### link when the Request converted into a record this reader can reach. A row whose link the server withheld draws the pill alone (DD-014).

**4. Urgency is the DES-018 ramp, by value.** Low is neutral, medium is warning, high is severe, critical is danger — the ramp a contract's priority and risk already wear, now shared by a Request's urgency through one `SEVERITY_PILL` map rather than a per-callsite choice, which is what DES-018 asks for.

**5. The foot states the order.** "Ordered by urgency, then age" sits under the table, beside the Show more button. The order is a product decision (INT-006), and a reader who has to infer it from a column of pills is a reader who will mistake it for a default.

**6. The sub-bar counts what is waiting, not what is loaded.** "N awaiting triage" counts the `new` rows on screen — so the number stays true when the toggle draws triaged rows beside them — and becomes "N awaiting triage shown" while a next page exists, the Contracts list's rule: there is no total to state over a keyset-paged list, and a bare count over a longer one is a number the page cannot stand behind.

**7. Zero is the good news, and the empty state says so.** "Nothing is waiting", with the Lucide `inbox` glyph and one line under it. The house empty state's anatomy (the Entities registry's) minus its action: there is no "create a Request" for staff, because a Request is something a Business User asks for.

### Recorded normalization points

1. **The nav badge is not built.** I1 draws a count badge on the Inbox nav item. Nothing in the destination registry has a badge today and nothing counts the Inbox outside the list's own read, so a badge would be a second count with its own staleness. The arrival signal M21 does ship is NOT-002's group 4 on the existing bell (#415).
2. **Age is the house relative stamp.** I1 writes "1h ago" and "2d ago"; the build uses `formatRelativeOrShort`, which says "1 hour ago" and "2 days ago" in the reader's own locale. One relative-time formatter across the product beats a compact form that only exists in one mock.
3. **Urgency labels are DES-018's ramp, not I1's words.** I1 predates DES-018 and writes Urgent / High / Normal / Low. The ramp is Low / Medium / High / Critical, and the pill families follow it.
4. **The Type cell carries two lines.** I1 draws the request type's name alone. The row also states the target the Administrator bound to that type — "Contract · NDA", "Contract", or "No target" — as a muted second line, because DD-018 makes triage confirm a routing rather than choose one, and how much of the routing is already decided is what a triager weighs before opening anything.

### Rationale

Clause 1 is the clause that matters. The managed table exists and it would have been cheap to point it at this list. Doing so would have made the Inbox's order a preference, and the whole value of the Inbox is that its order is not one — the hottest and oldest Request surfaces first for everybody, or it surfaces first for nobody.

Clause 3 is the honest version of "no Status column". INT-007 removed the column because it could only say one thing; it did not say the outcome should be unreadable once there is one to read.

### Alternatives considered

- **The managed table with sorting disabled.** Rejected: a table that draws sort affordances and refuses them is worse than one that never offers them.
- **Two lists — the Inbox and a triaged archive.** Rejected: INT-007 asks for a toggle, and two lists would need two orderings and two empty states to say the same two things.
- **A Status column always on.** Rejected by INT-007, and clause 3 is why the removal costs nothing.
- **Keeping I1's compact ages.** Rejected as normalization point 2 — a second relative-time format for one screen.

### Consequences

`apps/web/src/routes/inbox.tsx` is the screen and `/inbox` its address; the staff Request detail lands under it at `/inbox/{number}` (M21/3). `SEVERITY_PILL` joins `severityLabel` in `apps/web/src/lib/contracts.ts`, because every ordinal scale in the product shares both. The destination registry gains the Inbox at index 0 — the slot its comment has reserved for intake since M4 — and the shell suites now expect four destinations for Member+.

No new tokens. The Inbox is the first surface to draw `status-severe-*` in a pill rather than on a timeline.

## DES-057: The staff request detail — a record page for something that is not a record (extends DES-032, DES-016, DES-034)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

`designs/intake.pen` I2 is the screen a Legal Team Member opens out of the Inbox. It draws record-page chrome — a sub-bar with a back chevron and a status pill, a meta hero, a two-column body, and an activity bar — over something that is not a record. A Request is an envelope (INT-001): nothing on this page is editable, there is no Owner, no team, no confidentiality flag, and no sections to route between.

I2 also predates INT-007. Its Triage card holds a Status and an Urgency that the sub-bar and the hero already say, and its Outcome card says what the Request _would_ convert to while it is still `new`. The three disposition buttons it draws are the whole triage surface INT-007 asks for, and they land with their own tickets (M21/7–9).

### Decision

**1. The page wears the record chrome, minus the parts a record has and a Request does not.** `AppShell` flush, a sub-bar section, and `RecordApplets` around the body — the contract record's own frame. It carries **no section strip** (DES-032), because a Request has one screen's worth of content and a tab strip with one tab is not a strip; **no stage pipeline** (DES-034), because `new → converted | resolved | declined` is a disposition rather than a pipeline and nothing on this page moves it; and **no overflow menu** (DES-055), because there is nothing to rename and nothing to archive.

**2. The sub-bar is the trail, the reference, the ask, and the status.** "Inbox › R-45 · _summary_ · New", in the record sub-bar's own row and at its own sizes. The status pill is the DES-005 pair for the Request's arm, the one the Inbox's Outcome column and the portal's own pill already wear.

**3. The hero is a card, and it scrolls.** I2 draws it as a second fixed band under the sub-bar. What it says — who asked, the front door, the routing, the urgency, the age — is a fact about the Request rather than a control that must stay in reach, and a second chrome slab pushes the sticky bars past DES-011's 25% bound on a short window. So it is the first card in the body: a `bg-raised` strip of label-over-value pairs, the label at `text-xs` semibold `text-muted` and the value at `text-base`, exactly as I2 draws them.

**4. The body is two columns that collapse against the record box, not the page.** `minmax(0,1fr)` and a 20rem side column, switched by an `@4xl` container query over the box `RecordApplets` establishes — so opening the thread reflows the columns instead of squeezing them. The main column carries Description, Form responses, and Attachments; the side column carries Requester and, once there is one, Outcome. Every one of them is the house section card: `rounded-card border-border-default bg-raised` with an `h-section-header` `bg-section-header` strip.

**5. The Outcome card draws only when there is an outcome.** I2 draws it on a `new` Request, saying what the Request would convert to — that is the routing, which the hero already states as "Converts to". Here the card says what actually happened: the status pill, the C-### link when the server gave one (DD-014), and, on a decline, the recorded reason itself. So the promise and the fact are never two cards saying the same thing.

**6. I2's Triage card is not drawn.** Status is in the sub-bar and Urgency is in the hero. The card's remaining content under INT-007 would be nothing: there is no assignment and no parked state.

**7. The activity bar carries the thread alone.** The chat applet (DES-023), keyed by the Request's entity pair. A Member+ is in every room on a Request, so the panel draws all three tiers and the composer offers all three segments — no surface change, because the applet is entity-generic. I2's history slot is not built: the activity read is a contract's read today, and what would narrate on a Request is its disposition.

### Recorded normalization points

1. ~~**The sub-bar draws no Convert / Resolve / Decline.**~~ They are INT-007's disposition surface and they land with M21/7–9. A control that opens nothing is worse than no control. _(Superseded by **DES-058**, which puts the slot in the sub-bar and lands Decline in it; Resolve and Convert are still absent rather than disabled.)_
2. **An attachment row carries no size and no uploader.** I2 writes "412 KB · Tom Iwu" under each filename. A Request's attachment stores neither — INT-002 calls them lightweight — and every file on a Request was put there by its Requester, whom the hero and the side card already name. The filename is the link that downloads it, the portal detail's rule.
3. **The Requester card carries the name and the email.** I2 writes "Operations · 3 previous requests" under them. A user has no department on this model, and a count of somebody's other asks is a claim about their history that nothing has decided to make.
4. **The Description card names its source.** I2's header carries "From the portal form" beside the title, and it is kept: on a page where every other card holds something a person typed into a box, saying which box is worth one line.
5. **An empty Form responses card and an empty Attachments card each say so.** I2 draws both full. A Request whose type attaches no fields, and one that carried no paper, are both ordinary; a card that vanished would leave the reader wondering whether it failed to load.

### Rationale

Clause 1 is the shape of the whole decision: the record chrome is the right frame because the reader arrives from a list and needs the trail, the reference, and the conversation — and the parts of that chrome that exist for _editing_ a record have nothing to act on here. Copying the frame whole would have shipped a tab strip with one tab and a pipeline that moves nothing.

Clause 5 is the INT-007 correction. I2 drew the conversion target twice because, before disposition-at-pickup, "what this will become" was the page's standing claim. It is now the routing (which the hero states) and the outcome (which only exists once somebody decided), and they are different sentences.

### Alternatives considered

- **A portal-shaped page** — the `PortalShell` column with a banner, as the requester's detail draws. Rejected: the staff reader arrives from the Inbox and goes back to it, and the thread is an applet on this side (DD-016 gives them three rooms, which the portal's card cannot draw).
- **The hero in the chrome, as I2 draws it.** Rejected under clause 3: DES-011's sticky bound, for a strip that is content.
- **Keeping I2's Triage card with Status and Urgency.** Rejected: two statements of the same fact within one screen of each other, which DES-028 point 7 already rejected on the contract record.
- **Adding a history applet now.** Rejected: the activity read has no `request` arm, and an applet that opens on a refusal is worse than an absent one.

### Consequences

`apps/web/src/routes/inbox-request.tsx` is the screen and `/inbox/{number}` its address — the one the Inbox row and its Assign button have linked to since #413. No new tokens and no new components: the page is composed from `AppShell`, `RecordApplets`, `Avatar`, the section-card anatomy, and the DES-005 status and DES-018 severity pills the Inbox already uses.

The disposition tickets (M21/7–9) add the sub-bar's three actions and their dialogs; this decision is what they extend. **DES-058** is the first of them, and it is where the sub-bar's action slot and the Decline dialog are specified.

### Addendum (2026-08-22, M21/12, [#423](https://github.com/juggernog20/OpenLaw/issues/423)) — the Description card is the one that vanishes, and clause 5 does not cover it

Read back at the M21 close. Clause 5 says an empty Form responses card and an empty Attachments card each say so, because a card that vanished would leave the reader wondering whether it failed to load. The Description card, in the same column, does the opposite: an empty description draws no card at all.

That is deliberate and clause 5 should have named it. The two cards clause 5 covers are about the **form**: a Request whose type attaches no fields, and one that carried no paper, are both ordinary, and the empty card is what says the form asked and got nothing. Description is a fixed basic and it is required on every submission (INT-002's M19/4 addendum), so an empty one is not an ordinary state a reader has to be told about — it is a Request submitted before the requirement, or a value cleared by hand. A card headed "Description" over nothing would be a page reserving room for a fact this Request does not have.

**The rule, stated once: a card whose content the form could legitimately have collected nothing for stays and says so; a card over a fixed basic that is always answered is drawn only when it is.** The portal's own detail wears the same rule from the other side, drawing the description row only when there is one.

## DES-058: The disposition sub-bar and the Decline dialog (extends DES-057, DES-035, DES-005)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

DES-057 built the staff request detail and left its sub-bar without INT-007's three actions, because none of them opened anything yet. `designs/intake.pen` I2 draws all three — Decline, Resolve, and Convert to contract — and I4 is the Decline dialog behind the first of them. M21/7 (#418) builds Decline; Resolve and Convert land with M21/8 and M21/9.

### Decision

**1. The disposition lives in the sub-bar's trailing slot, and only while the Request is undecided.** The three actions sit at the end of the sub-bar row, in the record page's own trailing-actions group (`flex shrink-0 items-center gap-2`) — where the contract record's overflow menu sits. They are drawn only on a `new` Request: INT-007 says a Request's fate is decided once, the Outcome card is what states the decision afterwards, and a disabled button that says "already declined" would be a second sentence about a fact the page already carries twice.

**2. I2's chromatic order is kept, and each button lands as its family.** Decline is a secondary button with the danger foreground — the act is destructive but it is not the page's call to action. Resolve is a plain secondary. Convert is the primary CTA, because it is the outcome the Inbox exists to reach. Only Decline is drawn today; the other two are absent rather than disabled, the house rule a control that opens nothing already follows.

**3. The Decline dialog is I4, whole.** The house dialog (DES-004), with I4's own copy in its own order: the title quotes the reference ("Decline R-45"); one sentence says what declining does and that the reason is required and shared; the Reason box is a `TEXTAREA_CLASS` textarea with the house required marker (asterisk for the eye, `(required)` for the screen reader); a `Mail`-glyphed note under it names the two places the words land; and the foot is Cancel beside a danger-variant "Decline request".

**4. The reason is refused in the dialog before the seam is asked.** An empty box is answered "Write why. The requester is sent this." on the box (`aria-invalid` plus a described-by alert line), because nobody should press a button to learn a box is empty. Every other refusal is the seam's and prints as the seam's own sentence, belonging to no control — the renewal and key-date dialogs' split, unchanged.

**5. A lost race ends the dialog in a statement.** When the seam answers `urn:openlaw:problem:request-dispositioned` (INT-007, TECH-020), the dialog replaces its form with two lines — what somebody else recorded, and that closing this reads it — and one Close button. The form does not stay pressable: there is nothing left to decide, and a button that invited a second press would invite somebody to try to overwrite a decision already made. The page re-reads behind the dialog, so it already states the other triager's outcome by the time it closes.

**6. The native `required` attribute is not used.** The label carries the requirement and the dialog writes the refusal. A browser's own validation bubble would speak over that sentence in the browser's words, which are not this product's.

### Recorded normalization points

1. **The sub-bar draws Decline alone, for now.** I4's own sub-bar draws all three. Resolve and Convert arrive with M21/8 and M21/9; DES-057's normalization point 1 is superseded by this clause rather than deleted. _Amended by the M21/8 addendum below: the slot draws Decline and Resolve, and Convert alone waits for M21/9. Closed by **DES-059**: the slot draws all three._
2. **The dialog's Reason box has no character counter.** I4 draws none. The bound is the seam's (`MAX_DECLINE_REASON_LENGTH`), restated on the box as `maxLength`, and a counter on a box nobody fills to 2000 characters is chrome.

### Rationale

Clause 1 is the whole shape: the disposition is the page's one act, so it goes where the page's acts go, and it goes away when there is nothing to act on. Clause 5 is INT-007's no-claim trade-off paid at the surface — the decision to skip a claim mechanism is only honest if the loser of the resulting race is told what happened, and a generic error would not have told them.

### Alternatives considered

- **All three buttons now, two of them disabled.** Rejected: a disabled control promises a feature the build does not have, and there is nothing to say in a tooltip that is not "wait for the next ticket".
- **Keeping the buttons on a decided Request, disabled.** Rejected under clause 1: three inert controls above an Outcome card that already states the decision.
- **A confirmation step rather than a dialog.** Rejected: the reason is required, so there is a form either way, and INT-006 makes the reason the point of the act rather than a decoration on a confirmation.
- **Closing the dialog on a lost race and letting the page speak.** Rejected: the page would flip from New to somebody else's outcome with no explanation of why the press did nothing.

### Consequences

`apps/web/src/components/intake/decline-dialog.tsx` is the dialog and `apps/web/src/routes/inbox-request.tsx` grows the sub-bar slot. No new tokens and no new components: the dialog is `Dialog`, `Label`, `Button`, and the shared `TEXTAREA_CLASS`.

The catalogue gains the dialog's own copy under a `decline.*` prefix — the sub-bar's verb, the title, the opening sentence, the box's label, the note, the button, the empty-box refusal, the generic failure, and the two lines a lost race prints — plus two ids that are not this dialog's alone: `action.close`, which joins `action.cancel` in the shared action family, and `intake.field.requiredMark`, which joins the two module-scoped required markers already in the catalogue.

M21/8 and M21/9 add their buttons to the same slot and their dialogs beside this one; clause 5 is the arm all three share, because the refusal is the scaffold's rather than Decline's.

### Addendum (2026-08-22, M21/8, [#419](https://github.com/juggernog20/OpenLaw/issues/419)) — the Resolve dialog, and the slot's second button

DES-058 clause 3 built the Decline dialog from I4 and said M21/8 and M21/9 add their buttons to the same slot and their dialogs beside it. This is the first of the two.

**The sub-bar's second button is I2's own.** Resolve is a plain secondary with the `Check` glyph, drawn after Decline, exactly as I2 draws it. Clause 2's chromatic order is unchanged and the CTA slot stays empty until Convert lands: Resolve is an honest ending, but it is not the outcome the Inbox exists to reach.

**`designs/intake.pen` draws no Resolve dialog.** I4 is Decline's and I3 is Convert's; I2's Resolve button opens nothing in the mocks. So the dialog is I4's anatomy with Resolve's content — the house dialog, the reference in the title, one sentence saying what the act does, one box, a glyphed note under it naming where the words land, and Cancel beside the verb. That is a **new normalization point**, recorded here rather than left as an undocumented invention.

**The box says optional in the label, and there is no refusal to write.** Decline's box carries the required marker and a refusal the dialog holds before the seam is asked; Resolve's carries `(optional)` inside the label, the way every other optional box in the product says it, and pressing the button with an empty box is a resolution with no closing reply. Clause 4's split still holds: the dialog checks nothing, so every refusal on this dialog is the seam's and prints as the seam's own sentence.

**The note names a different destination, because the words go somewhere different.** Decline's `Mail` note says the requester is emailed the reason and sees it on their request, because the reason is stored on the Request. Resolve's `MessageSquare` note says the reply is posted on the thread and emailed, because it is a comment. Somebody about to type into one of the two boxes needs to know which they are doing.

**Clause 5 is reused whole.** A lost race replaces the form with the same two lines and the same Close button, from the same catalogue ids — `decline.alreadyDecided` and `decline.alreadyDecidedRead` are the scaffold's copy rather than Decline's, as clause 5 said they would be, and Convert reads them too.

**One dialog is open at a time.** The page holds which disposition is open rather than a flag per dialog. A Request has one fate, and two open dialogs would be two answers to it.

The catalogue gains the dialog's copy under a `resolve.*` prefix: the sub-bar's verb, the title, the opening sentence, the box's label, the note, the button, and the generic failure. There is no `resolve.needReply`, because there is nothing to need.

## DES-059: The Convert dialog — a prefilled contract create (extends DES-058, DES-057, DES-044)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

DES-058 put INT-007's disposition in the staff request detail's sub-bar and said M21/8 and M21/9 would add their buttons to the same slot and their dialogs beside Decline's. Resolve was the first. Convert is the second and last, and it is the outcome the Inbox exists to reach. `designs/intake.pen` I3 is its mock — the only one of the three dispositions the mocks draw a dialog for besides Decline.

### Decision

**1. The third button takes the CTA slot.** DES-058 clause 2 reserved it: Decline is a secondary with the danger foreground, Resolve is a plain secondary, and Convert is the primary, with I2's `FilePen` glyph and I2's own verb, "Convert to contract". Clause 1's rule is unchanged — all three are drawn only while the Request is `new`.

**2. The dialog is I3's anatomy in I3's order.** The house dialog (DES-004) with the reference in the title ("Convert R-45 to a contract", DES-058 clause 3's rule); then one muted line naming the front door and the requester; then I3's blue information callout, whole and word for word — "Form responses carry into the contract — nothing is re-keyed"; then the Title box; then the target; then the priority; then what carries and what does not; then the boxes for the gaps; then Cancel beside the verb. A triager reads what is already decided before they are asked for anything.

**3. Where the request type bound a live contract type, the type is stated and no picker is drawn.** DD-018: triage confirms the routing rather than choosing it, so there is nothing to pick and a select would invite the one act the decision takes away. A caption says so in one line. The picker appears only where there is a genuine choice — a module-only target, a target type the taxonomy has archived (which the API reads as no type), or a Request that targets a Matter or nothing. The last two carry an extra line naming the act a **re-target**, so nobody takes DD-018's exception for its rule.

**4. Only the target type's hard-required gaps are boxes.** The create dialog's own rule (DES-044's prefilled create, CTR-016/MTR-014): creation grows the fields the picked type demands and nothing else, because everything optional is set inline on the record afterwards (DES-017). A carried value therefore has no control at all — it is **stated** under "Carries into the contract", with the value it will land as. That is what "nothing is re-keyed" means on a screen: the words are already there, so there is no box to re-type them into.

**5. What will not carry gets its own block, and says nothing is lost.** The INT-002 M19/7 addendum's out-of-scope collected value, named where somebody can see it before they press: the field names in a list, then one line saying this contract type has no field for them, nothing is deleted, and they stay on the request. Two facts, because the reader needs both — that the value is not coming, and that it is not gone.

**6. Priority is stated and risk is absent.** The urgency's own DES-018 severity pill under a "Priority" label, with one line saying it came from the requester's urgency and that risk stays the triager's to set on the record (MTR-012). Stated rather than offered, for clause 3's reason: it is a 1:1 map, not a decision.

**7. DES-058 clause 5 is reused whole, plus one line.** A lost race replaces the form with the same two sentences and the same Close button, from the same catalogue ids. Convert adds one line between them when the seam named a record — "It became C-51." — because the recorded outcome alone does not tell the loser where to look.

### Recorded normalization points (I3 deviations accepted)

1. **There was no "Convert to matter instead" in the M21 footer.** I3 draws it as a left-aligned link, but the door then offered only what the build could create and drew no stubbed or disabled Matter choice. M22/8 superseded this normalization: both Re-target directions now appear, one at a time, and the footer remains a single right-aligned action row.
2. **The carried values are not editable boxes.** I3 draws Counterparty, Value, and Needed by as prefilled inputs with a "· from the form" caption. Under clause 4 they are stated instead. Two of the three are contract columns rather than catalog fields on this build anyway, and the record's own inline editing (DES-017) is where any of them is corrected.
3. **The reference is in the title rather than in the body line.** I3's body opens "From R-45 · Contract review · submitted by Tom Iwu". DES-058 clause 3 already puts the reference in the title, so the body line keeps the front door and the requester and drops the repeat.
4. **The footer is one right-aligned action row.** I3 splits it, with the re-target link on the left. With normalization point 1 there is nothing on the left, and the house dialog's foot is Cancel beside the verb.
5. **The gaps carry the field's own help text where it has any**, and a line saying the type requires it and the form did not collect it where it has none. I3's single red "Required on contracts — collect it now to convert" is written for a field it knows; this has to work for any field an Administrator attaches.

### Rationale

Clause 4 is the whole shape. The temptation with a prefilled create is to draw every field full and let somebody correct them, which is what I3 does — and it produces a form whose boxes are mostly a re-statement of a screen the reader just left, with a real risk that an accidental edit silently rewrites what the requester said. Stating the carry and boxing only the gaps makes the dialog exactly as long as the work left to do, and it makes clause 5 legible: the two lists sit beside each other and the difference between them is the point.

Clause 3 is DD-018 drawn rather than described. A disabled select would say "you may not choose this", which is a rule about the control; stating the type says "this is already decided", which is a fact about the request type.

### Alternatives considered

- **I3's editable prefilled boxes.** Rejected under clause 4's rationale.
- **A disabled select on a confirmed target.** Rejected: a disabled control invites a reader to look for how to enable it, and there is no way and no reason.
- **A greyed "Convert to matter" option.** Rejected outright by the no-stubbed-demos rule and by INT-006's own note that the dialog offers only what the build can create.
- **Fetching the contract taxonomy when the dialog opens.** Rejected: it would put a loading state inside a dialog that INT-007 requires to be instant and to write nothing, and the two reads are ordinary Member+ reads the page's loader can make.

### Consequences

`apps/web/src/components/intake/convert-dialog.tsx` is the dialog and `apps/web/src/routes/inbox-request.tsx` grows the CTA and two loader reads — the live contract types with the fields each attaches, and the Entity registry, which are what a required `user` or `entity` gap field offers. No new tokens and no new components: the dialog is `Dialog`, `Label`, `Input`, `Button`, the shared `CONTROL_CLASS` select, and the `CustomFieldControl` the create dialog already uses.

The staff detail's value renderer moves into `apps/web/src/components/intake/custom-field-value.tsx`. The Form responses card and the dialog's carry list now draw the same values one dialog apart, and a second formatter would let one value read two ways.

The catalogue gains the dialog's copy under a `convert.*` prefix, plus the sub-bar's verb. Three ids are reused rather than copied: `decline.alreadyDecided` and `decline.alreadyDecidedRead`, which DES-058 clause 5 already called the scaffold's, and `contracts.form.fieldMissing`, which is the create dialog's own refusal for the same rule.

DES-058's normalization point 1 is closed by this record: the sub-bar now draws all three of I2's actions.

### Addendum (2026-08-22, the M21 review, [#440](https://github.com/juggernog20/OpenLaw/pull/440)) — where M21's policy is written, and two names corrected

Speaks for **DES-056 through DES-059** together, because the review that prompted it read them together.

**These four records cite policy; they do not own any of it.** DES-056–059 quote Request states, Inbox membership, thread tiers, notification behaviour, race outcomes, and conversion semantics, because a design decision that did not say what it is designing for would be a shape with no argument. None of it is decided here. A reader who wants the rule rather than its drawing takes it from the owning record:

| What                                                                                            | Where it is decided                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The lifecycle `new → converted \| resolved \| declined`, and that a disposition is chosen once  | INT-007, and its M21/7 addendum                                   |
| Inbox membership and its order, the triaged toggle, and the converted link's two absences       | INT-006, and its M21/2, M21/3 and M21/12 addenda                  |
| The race and what the loser is answered                                                         | INT-007's M21/7 addendum                                          |
| Conversion semantics — the confirmed target, the carry, the gaps, Re-target, the promoted paper | INT-002 and its M21/10 addendum, INT-007's M21/9 addendum, DD-018 |
| Who is in which room on a Request thread, and what the move does                                | CMT-001 and its M21/11 addendum, CMT-010, DD-016                  |
| What reaches a Requester, and in whose words                                                    | INT-003 and its M21/6 addendum, NOT-002                           |

Checked against those records before this was written: every rule the four design records restate is already written in one of them, so nothing had to move. What was missing was the pointer, and this is it. **The rule going forward: a DES record names the owning record and stops.** Restating a rule in a second place is how two places come to say different things.

**DES-056's title and body drop the word "queue".** `CONTEXT.md` fixes **Inbox** and lists `queue` among the words to avoid for it, and the record used it eleven times, starting in its own title. The decision is unchanged — a fixed list whose order is a product decision rather than a reader preference — and only the word is. The index is updated to match. The same pass capitalised `Requester` and `Request` where the glossary's terms were meant.

**The already-decided copy is `disposition.*`, not `decline.*`.** DES-058 clause 5 and DES-059's consequences both name `decline.alreadyDecided` and `decline.alreadyDecidedRead` as the scaffold's copy that all three dialogs read. The ids now say so: they are `disposition.alreadyDecided` and `disposition.alreadyDecidedRead`. The clause text above is left as it was written, as a shipped decision is; this addendum is where the current ids are.

## DES-060: The archived carried reference marker and repair box (extends DES-057, DES-059)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

The INT-002 #437 addendum owns the product rule. A `user` or `entity` value collected on a Request can name a row that was archived before triage. DES-057 draws the value as plain text, so the archived name looks live. DES-059 states every carried value and draws boxes only for required fields the form did not answer, so Convert offers no way to replace the archived reference.

This record decides how the staff detail marks that value and how the existing Convert dialog control handles the repair. It does not change which values qualify for repair. INT-002 #437 owns that rule.

### Decision

**1. The marker sits on the value.** The Form responses row keeps the archived person's display name or the Entity's legal name. A neutral `Archived` pill follows the name inside the value cell. It uses the existing neutral status pair, the list editor's archived word, and the pill anatomy already used for archived rows. The field label stays unchanged. A live reference draws the name alone.

**2. Convert replaces the static carry line with a control for that value.** The archived reference does not appear under "Carries into the contract". It appears in the target type's field order as the same labelled `CustomFieldControl` DES-059 uses for a required gap. The label carries the required marker because Convert cannot land while the archived value remains. The picker offers live rows only.

**3. The help line names both facts.** It keeps the archived name visible and says to pick a live person or Entity to convert. This lets the triager compare the old answer with the replacement without making the dead value look selectable. An empty press says `Pick a live value for {field}.` on the dialog's error line.

**4. No repair control appears for a live carried reference.** It stays in DES-059's carry list as a name and value. This clause points to INT-002 #437 for the rule and only states its visual result.

### Rationale

The marker belongs beside the archived name because that is the first place a triager reads the answer. A banner would separate the warning from the value it describes. Removing the dead value from the carry list avoids saying it will land unchanged while a box below asks for a replacement.

Reusing the gap control keeps one visual grammar for the work Convert still needs. The help line explains why this answered field has become work without adding a second warning component or a new dialog section.

### Alternatives considered

- **A warning banner above Form responses.** Rejected because several archived values would need a list that repeats their field names, while the rows already provide the exact anchor.
- **Keeping the archived value in the carry list and adding a box below it.** Rejected because the same dialog would state that one value both carries and must be replaced.
- **A disabled option holding the archived row.** Rejected because the old name belongs in explanatory text, not in the list of choices Convert can post.

### Consequences

`apps/web/src/components/intake/custom-field-value.tsx` owns the inline marker. `apps/web/src/components/intake/convert-dialog.tsx` derives the repair boxes from the staff detail's archived state and posts their selections in the existing `customFields` body. No new component and no new token lands. The catalogue gains `inbox.request.archivedReference`, `convert.archivedReferenceNote`, and `convert.archivedReferenceMissing`.

## DES-061: Chosen comment files are removable chips (extends DES-023, DES-024)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

CMT-011 lets both comment composers carry up to five files. The control has to show what will travel before the comment is posted, state the bound, and let one mistaken choice be removed without clearing the draft or reopening the picker.

### Decision

The existing composer gains one secondary `Attach files` button with a Paperclip glyph and the persistent caption `Up to 5 files.` The native picker is multiple. Every chosen file appears below the control as a neutral rounded chip carrying its full arriving name and a 24px remove button; a long name truncates visually but remains the button's accessible name. Removing a chip removes that file only. At five files the picker is disabled. A refused post keeps the draft and every chip; a successful post clears both.

The portal and staff surfaces use the same component. The portal does not gain an audience control: its comment and every chosen file remain Full Thread by the Request audience rule.

### Rationale

Chips make the pending upload set scannable in the same compact grammar as mentions while keeping the two lists semantically separate. A persistent bound prevents the sixth-file refusal from being the first time a person learns the limit.

### Consequences

The chip list is labelled `Files attached to this comment`; each remove control is `Remove {filename}`. Selection is pointer-free through the ordinary file input. No progress treatment appears: one post is one multipart request and the composer measures no per-file progress.

## DES-062: Comment paper is a download row under the body (extends DES-023)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

A reader needs to see the paper as part of the comment whose tier governs it, without making a lightweight attachment look like a Document row or separating it from the words that introduced it.

### Decision

Every live comment with paper draws a compact list directly under its body. One attachment is one row: a 14px Paperclip glyph followed by the arriving filename as an underlined-on-hover download link. The row adds no size, kind, uploader, filed marker, or File action; the last two belong to M21A/3, and the lightweight row stores none of the first three. Rows retain arrival order.

A soft-delete or redact tombstone draws no attachment rows. The portal uses the same row and derives its download through the Request thread address, so the visual does not change after conversion.

### Rationale

Placement under the body makes the tier relationship visible without another badge. Keeping the row smaller than a Document row preserves DOC-008's distinction: this is what arrived with a remark, not yet record paper.

### Consequences

The list is labelled `Comment attachments`; the filename is the link's accessible name and the browser download uses that same filename. No attachment count is added to the thread header, because hidden-tier paper must contribute no number a narrower reader can compare.

## DES-063: The version kind pill is a picker for Member+ (extends DES-017)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

CTR-014's M21A addendum owns the rule that a Member+ user can correct a Document Version's kind and no other part of the round. The Contract Documents card already draws that kind as a coloured pill in the C4 version row. This record decides how that pill becomes the write control without adding a dialog or another row action.

### Decision

**1. The pill itself becomes a native select for Member+.** It keeps the current kind's colour pair, type size, rounded shape, and place in C4's Kind column. Pressing it opens the browser's option list. A correction commits on selection, following DES-017's immediate per-field save. The section header shows Saving, Saved, or the seam's refusal through its existing micro-state.

**2. The picker offers the six hand-set kinds in negotiation order.** Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Amendment, Executed. The order matches the upload composer. `generated_redline` is never an option because it records how the file was made rather than a person's judgement about the round.

**3. A generated redline stays a read-only pill for every role.** Its label is `Generated redline` and it uses the neutral pair. Member+ cannot open a picker on it. This draws CTR-014's source refusal rather than offering a control that the seam will reject.

**4. A Contributor sees the existing pill.** The Documents card draws no kind select for them, just as it draws no upload or row-action controls. An archived Contract also keeps the read-only pill because all record writes are frozen there, and so does a Document that is archived on its own (DOC-010), because the seam refuses every edit to it until it is restored.

**5. Every picker names its round.** Its accessible name is `Kind of version {number} of {document title}`. The visible value alone stays short enough for C4's Kind column, while the control's name distinguishes several version rows that show the same kind.

### Rationale

The kind already has a compact, well-understood place on every version row. Turning that value into its own control keeps the correction on the fact it changes. A dialog or an overflow item would make a one-field correction take more steps and would separate the action from the value.

### Alternatives considered

- **A Change kind item in each row menu.** Rejected because the value is already visible and DES-017 commits one field where it is read.
- **A dialog opened from the pill.** Rejected because the correction collects one fixed value and needs no confirmation.
- **Offering Generated redline as a disabled option.** Rejected because it is not a hand-set choice. The option must be absent, not advertised as unavailable.

### Consequences

`apps/web/src/components/documents/documents-card.tsx` owns the picker and uses the existing hand-set kind catalogue. The current value colours the closed select. A successful PATCH replaces the document row with the seam's read-back, so current and superseded rounds use the same control and update path. No new component or token lands.

## DES-064: Comment paper files through one destination dialog (extends DES-062, DES-023)

- **Status:** Accepted
- **Date:** 2026-08-22

### Context

CMT-011 lets Member+ turn one comment attachment into record paper exactly once. The act has two shapes: start a Document at the record root, or add the next round to a chain already there. The row has to make both the available act and its permanent destination legible without turning the attachment into a second Document row.

### Decision

**1. An unfiled row ends with a small `File` action for Member+ on a thread whose record owns Documents.** It is absent, not disabled, for Contributors, Business Users, Requesters, and Request threads that have not converted. The download name and Paperclip stay where DES-062 put them.

**2. `File` opens one modal for both destinations.** The first C10-shaped select chooses `New Document` or `New Version on an existing Document`. The dialog names the source filename above the fields and uses the upload composer's Kind catalogue and negotiation order. New Document asks for Document name and the DD-014 Confidential switch. New Version asks for the target Document and the upload composer's optional Note. The primary action is `File`; Cancel, Esc, and the overlay dismiss without writing.

**3. Defaults come from what the filer is looking at.** Destination starts on New Document, the name starts on the arriving filename, and Kind starts on Draft · ours. A Legal Only comment proposes Confidential on; every other tier proposes it off. The switch remains editable because the tier is the source attachment's audience, not a permanent instruction about the Document's audience.

**4. Success replaces the action with one permanent marker.** A 16px FileCheck glyph and `Filed to {Document}, version {number}` sit on a muted second line under the download. The destination phrase is a link: it opens that exact Version in the record's document panel, with the Documents route as its ordinary-link fallback. No second File action remains. A refusal stays in the open dialog so the filer can read it and repair or cancel.

### Rationale

One discriminated dialog keeps the shared facts shared and reveals only the controls the chosen destination needs. The marker is deliberately smaller than the attachment name: it records what happened to this comment paper without pretending the lightweight source and the resulting Document are the same row.

### Consequences

`apps/web/src/components/comments/comment-attachments.tsx` owns the row action, marker, and dialog. The Contract record supplies the visible Document choices and the exact-version opener; the generic comment applet receives no filing context on other record arms. The dialog reuses existing form controls, Confidential toggle, Document kind catalogue, and semantic tokens. No new token or component primitive lands.

## DES-065: A dispositioned Request points paper at its composer (extends DES-062, DES-057)

- **Status:** Accepted
- **Date:** 2026-08-23

### Context

CMT-011 leaves two ways for paper to enter: with the submission form before the Request exists, or with a comment afterwards. INT-002's #438 addendum closes the Request attachment route after any disposition. The portal detail therefore has to say where a new file goes without introducing the second Request upload control CMT-011 rejected. The asynchronous uploads that follow a successful submission can also race a fast disposition, so the confirmation can meet the same refusal before the Request detail is open.

### Decision

**1. A dispositioned banner points to the existing composer.** On `converted`, `resolved`, and `declined`, the status banner ends with the link `Attach new files to a reply`. It targets the Full Thread composer in the Conversation card on the same page. The link is absent on `new`: the thread control already sits immediately below the banner, and repeating directions before a disposition would make the exceptional routing look like a standing warning.

**2. There is no Request attachment control on the detail.** The submission form's `Choose files` remains the only Request attachment control, before the Request exists. The detail carries only the comment composer's `Attach files`, on every status. Hiding after a disposition therefore means the rejected third path is never drawn; the pointer distinguishes the comment control by naming a reply.

**3. A submission upload that loses the race links to the same place.** The typed 409 carries the Request number. The confirmation keeps naming every file that did not attach and replaces its generic send-another-way sentence with `Add it to a reply on R-###`, linked directly to that Request's composer. The Request remains submitted and the confirmation remains a success surface.

### Rationale

The composer is the door CMT-011 built, so the banner should point at it rather than restating its controls or adding another picker. Keeping the instruction inside the status banner places the changed paper rule beside the disposition that caused it. The stable Request URL remains the portal address after conversion, which lets one link work for all three outcomes without exposing a Contract reference a Business User cannot open.

### Consequences

`apps/web/src/routes/portal-request.tsx` owns the banner link, and the shared portal composer exposes the in-page target. `apps/web/src/routes/portal-request-form.tsx` reads the named refusal's Request extension and links a raced file to the same target. The catalogue gains `portal.request.paperOnThread` and `portal.form.attachmentsMovedToThread`. No new control, token, or component primitive lands.

## DES-066: The Documents destination is one flat managed list across records (extends DES-046, DES-018, DES-009)

- **Status:** Accepted
- **Date:** 2026-08-29

### Context

DOC-002 promises one place to find a Document without first knowing its owning record. The original `designs/documents.pen` DOC1 predates the managed-list machinery in DES-046 and the filter row now used by Contracts. It draws useful repository content, but its facet chips, list-local search, upload action, and narrow table no longer describe the destination M26 will build.

### Decision

**1. Documents uses the current S1 destination chrome and DES-046 table controls.** Documents is active in the staff nav between Contracts and Entities. The sub-bar carries the shown count, Saved views, and Columns. It carries no upload action: a Document still begins on its owning record (DOC-008).

**2. Facets use the Contracts filter-row pattern.** Owner is a segmented `All / Contracts / Matters` control. Record is the reached-record picker. Counterparty, format, current Version kind, uploaded range, and uploader are compact filter controls in the same row. Folder joins them only after a record is picked; it is a facet over that record's folders, never a global tree (DOC-006). Active values repeat below as removable chips with one `Clear all` action.

**3. Recent is a five-row list, not a card strip.** One bordered list carries the five most recently uploaded reachable Documents. Each row names the Document, its owning record, uploader, and upload time. The rows share dividers and one list boundary; they are not five independent cards.

**4. The repository answer is one flat managed table.** Title is the flex column. Owning record carries both the `C-` or `M-` reference and the record title in the same cell. The remaining columns are current Version kind, format, size, Version count, uploader, and uploaded time. Headings carry the DES-046 resize affordance, Uploaded shows the default descending sort, text stays on one line, and paging remains in the fixed foot. A Confidential row carries DES-009's inline `CONFI` marker. An email row uses the parsed subject as its title.

**5. Empty and archived answers stay inside the same chrome.** A fresh install says `Paper lives on Contracts and Matters. Upload to a record and it appears here.` A filtered zero says the filters matched nothing and offers `Clear all`. `Show archived` changes the switch in place; an archived row is visually subdued, marked `Archived`, and ends with `Restore`.

**6. The destination uses DES-018's disciplined color roles.** Uploader avatars use the uniform Light-theme avatar pair. Version kind pills use the families the record page already assigns: `theirs` rounds are `warning`, `ours` rounds are `info`, `executed` is `success`, and `amendment` and `generated_redline` are `neutral`. The label is the record page's wording (`Draft · theirs`). `CONFI` keeps its confidentiality pair. Color adds state or meaning and never differentiates people.

### Recorded normalization points

1. DOC1's facet chips become the Contracts filter-row pattern plus a separate active-filter chip strip.
2. DOC1's Recent content remains, but becomes one five-row list rather than cards.
3. The owning-record cell, not a separate reference column, carries the `C-` or `M-` reference.
4. DOC4 and DOC5 stay untouched. Their owning-record pickers still belong to those repository upload/import dialogs; this destination redraw does not revise or pre-empt them.

### Rationale

The destination is another reader-owned list, so giving it a bespoke filter grammar or table would make the same operation feel different only because the rows happen to be Documents. Keeping the owning reference with the record title answers where the paper lives without spending another narrow column. A list makes Recent scan like the table below it and avoids promoting five transient rows into five cards.

### Consequences

`designs/documents.pen` redraws DOC1 on the current S1 chrome and adds DOC8–DOC10 for the fresh-install, filtered-empty, and archived states. M26's web work can reuse the existing managed-table, saved-view, column, filter, empty-state, and archived-row primitives without translating an older mock. DOC2–DOC7 remain the references for their existing surfaces.

## DES-067: The Entities destination uses the managed-list and record-shell patterns (extends DES-046, DES-032, DES-016, DES-018)

- **Status:** Accepted
- **Date:** 2026-08-29

### Context

ENT-001 through ENT-007 fix the Entity registry, ownership graph, compliance calendar, confidentiality rule, and linked-record roll-ups. The original `designs/entities.pen` screens describe those capabilities, but they predate the managed-table destination, routed record strip, activity-bar applets, and current confidentiality treatment. M27 needs one visual source of truth before those surfaces are built.

### Decision

**1. The registry is a DES-046 managed list with three sibling views.** The sub-bar switch is `Calendar / List / Chart`. List is the managed-table answer: Saved views and Columns stay in the sub-bar, the filter row carries Type, Status, Jurisdiction, and Majority owner, and the table includes `Next obligation`. Calendar keeps List and Month forms under the Calendar destination view.

**2. An Entity is a DES-032 record page with the DES-016 activity bar.** Its routed strip is `Overview / Ownership / Obligations / Documents / Contracts / Matters`. Overview shows Identity, Share capital, Custom Fields, current and former officers, and registrations. The right-side Activity applet is an ordinary page-scoped applet opened from the activity bar.

**3. Ownership and roll-ups stay inside that strip.** Ownership shows both owners and owned Entities with percentages. A total above 100% is a warning, not a write blocker, preserving ENT-003. A confidential neighbour is a `Restricted Entity` row. Contracts and Matters are query-backed roll-up tables whose labels carry their counts, preserving ENT-007 rather than introducing stored counters.

**4. Confidentiality has one banner and one grant-list dialog.** A confidential Entity uses DES-009's record banner and names the people with explicit access in the `entity_grants` grant list. The chart keeps the topology visible but replaces an unreachable Entity with one muted restricted card. It never discloses the Entity name or other record facts.

**5. Calendar zeroes distinguish absence from filtering.** A blank organization says that no obligations exist yet and offers `Add obligation`. A filtered zero says that no obligations match and offers `Clear all`. Both remain in the current calendar chrome, so filtering never turns into a second empty-page pattern.

### Recorded normalization points

1. Chips follow the Contracts filter row; Entities does not introduce a destination-specific facet grammar.
2. Overdue uses the DES-018 severe token.
3. The chart node is a card, not a bubble.
4. `Restricted Entity` joins the MTR-015 convention.

### Alternatives considered

- **An Entity-specific facet grammar.** Rejected. The original mocks carried their own chips. One more filter vocabulary costs a reader a second set of habits for the same operation.
- **Stored roll-up counters on the Entity.** Rejected. ENT-007 keeps the Contract and Matter counts query-derived. The cost is one count query per record open, which is cheaper than a counter that drifts.
- **A write blocker when ownership totals pass 100%.** Rejected. ENT-003 keeps the graph writable during a transfer. The cost is that a wrong total stays visible as a warning until someone fixes it.
- **Hiding a confidential neighbour from the chart.** Rejected. A hole in the graph misreads as a missing holding. The cost of the muted restricted card is that a viewer learns a confidential Entity exists at that position, though not its name or facts.
- **A bubble chart node.** Rejected. The card matches the list row and the record header. The cost is a wider node, so a deep graph scrolls sooner.
- **A second empty page for a filtered calendar.** Rejected. Two empty patterns would make a filter look like an empty organization.

### Rationale

Entities combines a destination catalogue, a record, a calendar, and a graph, but none needs private chrome. Reusing the established list, strip, applet, severity, confidentiality, and restricted-row conventions makes the module legible on first contact and gives the M27 build exact answers at the seams where the older mocks drifted.

### Consequences

`designs/entities.pen` carries EN1–EN16 on the current S1 chrome: the refreshed original eight screens plus Ownership, Contracts and Matters roll-ups, Confidential and grant-list states, a restricted chart node, and both calendar-empty states. M27's implementation can reuse the managed-table, record-strip, activity-bar, banner, dialog, empty-state, and restricted-placeholder primitives without translating the former Entity-specific treatments.

### Built addendum (2026-08-30, M27 close, [#582](https://github.com/juggernog20/OpenLaw/issues/582))

The Entities destination ships the Calendar, List, and Chart switch, with Calendar as its default. The List view is DES-046's fourth catalogue. The Entity record ships all six routed tabs and its Activity applet. Confidential banners, Grant maintenance, Restricted Entity rows and chart nodes, calendar empty states, overdue severity, and the ownership warning use the shared patterns named above. The M27 close journey and axe sweep cover the three destination views and every record tab on fresh Compose images.

## DES-068: Knowledge is a file-first managed library (extends DES-046, DES-032, DES-016, DES-055, DES-020)

- **Status:** Accepted
- **Date:** 2026-08-30

### Context

KNW-001 makes a Knowledge Item a governed set of files with an optional guidance body, not a body-first article with attachments. The original KN1–KN6 frames predate the managed-list destination, the record strip rule, the record overflow menu, and the current portal and Settings chrome. M28 needs one visual answer before those surfaces are built.

### Decision

The Knowledge destination and its record, portal, and Settings surfaces reuse the current shared chrome. The library is a managed table beside its folder tree. A Knowledge Item has one record section because its identity, primary paper, other Documents, and optional guidance are one reading sequence. Portal readers meet the same content in file-first order, while deflection links distinguish internal Knowledge targets from external URLs.

### Recorded normalization points

1. **Managed list.** The destination mounts DES-046 with `Default view`, `Columns`, and a `New` menu whose actions are `New from files` and `New knowledge item`. The left column remains the folder tree. The filter row is Type, State, Audience, Author, and Format, and Format is a table column.
2. **One-section record with no tab strip.** DES-032's strip appears only when a record has multiple named sections, so the Knowledge record has none. Its one section carries the identity card, Documents, optional guidance, DES-055 overflow, and the DES-016 activity bar.
3. **Primary document row.** Identity names the title, type, folder, state, audience, and optional replacement, then gives the primary Document its own `Open preview` row. The Documents card marks that row and offers `Set as primary` on every other Document.
4. **Portal article chrome.** The article opens under `Your requests`; the primary file is first, other files follow, and the optional guidance body is last. A file-first item therefore remains useful when no guidance body exists.
5. **Internal link rendering.** ST13 names a Knowledge target as `Knowledge item · opens in this portal`, with a book glyph instead of a URL. The portal panel renders that target as an internal article row without an external-link glyph or domain; external targets keep both.

### Rationale

Knowledge contains governed paper, so its destination should scan like the other managed catalogues and its reading order should privilege the file the organization designated as primary. Omitting a one-item tab strip keeps the record hierarchy honest. Distinct internal-link treatment tells a requester whether navigation stays inside the portal before they activate it.

### Consequences

`designs/knowledge.pen` carries KN1–KN10 on the current S1 chrome: the managed library, both record-body states, creation flows, archive dialog, portal article and deflection panel, and both library zeroes. `designs/settings.pen` amends ST13 with an internal Knowledge row and adds ST22, which mounts the DES-020 taxonomy anatomy for the four Knowledge types. M28 can reuse the managed-list, record card, activity bar, overflow, empty-state, taxonomy, and portal-link primitives without translating the older Knowledge-only patterns.

## Index of decisions

| #       | Decision                                                                                                                                                             | Status                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| DES-001 | Ship three themes (Light / Warm / Dark) as user-selectable from v1                                                                                                   | Accepted                                                                                                   |
| DES-002 | Light is the default theme; Warm and Dark are user-selectable                                                                                                        | Accepted                                                                                                   |
| DES-003 | Design language anchor — "utility-tool with character," GitHub-Primer-shaped                                                                                         | Accepted                                                                                                   |
| DES-004 | Component substrate — shadcn/ui + Tailwind + CSS variables + Radix primitives                                                                                        | Accepted                                                                                                   |
| DES-005 | Color tokens — semantic, theme-aware, four surface tiers, paired status pills                                                                                        | Accepted                                                                                                   |
| DES-006 | Typography ramp — Inter, 8-step size scale, 3 weights, reserved mono                                                                                                 | Accepted                                                                                                   |
| DES-007 | Spacing scale + density target — Tailwind default + 5 layout tokens + 4 chrome dimensions, normalized to 48/8/16                                                     | Accepted                                                                                                   |
| DES-008 | Iconography — Lucide as the v1 icon library, sizes 16/20/24, currentColor inheritance                                                                                | Accepted                                                                                                   |
| DES-009 | Confidentiality affordance — 3-tier pattern (inline marker / detail banner / composer warning)                                                                       | Accepted                                                                                                   |
| DES-010 | Keyboard contract — `/`, `Esc`, `?` global keys; Radix component defaults; Cmd-K deferred                                                                            | Accepted                                                                                                   |
| DES-011 | Accessibility floor — WCAG 2.2 AA contract; AAA aspirational on text; no formal audit in v1                                                                          | Accepted                                                                                                   |
| DES-012 | Responsive layout primitives — container queries for content, single 768px viewport breakpoint for the mobile shell                                                  | Accepted                                                                                                   |
| DES-013 | Internationalization architecture — every string wrapped in ICU MessageFormat from day one; `Intl.*` for formatting; en-US the only v1 locale                        | Accepted                                                                                                   |
| DES-014 | Date / time / currency display conventions — relative-then-short-absolute; UTC-stored / browser-detected display; ISO 4217 currency; no compact-number abbreviations | Accepted                                                                                                   |
| DES-015 | Content tone register — terse, direct, second-person imperative ("GitHub voice, not Mailchimp voice")                                                                | Accepted                                                                                                   |
| DES-016 | Record-page right side — VS Code-style activity bar with page-scoped applets                                                                                         | Accepted                                                                                                   |
| DES-017 | Editing model — per-field inline commit, no page edit mode                                                                                                           | Accepted                                                                                                   |
| DES-018 | Chromatic discipline — status families kept, one severity ramp (grey/yellow/orange/red), uniform light-blue avatars with photo override                              | Accepted                                                                                                   |
| DES-019 | Shell chrome color variables — per-theme chrome mapping, Warm terracotta avatar (amends DES-018)                                                                     | Accepted                                                                                                   |
| DES-020 | List-editor pattern — the shared anatomy for taxonomy settings panes                                                                                                 | Accepted; two-line row amended in M19/4                                                                    |
| DES-021 | List-editor table variant and the field-editor dialog (extends DES-020)                                                                                              | Accepted                                                                                                   |
| DES-022 | The type-editor screen — identity card plus attachment table (extends DES-020)                                                                                       | Accepted; optional slots amended in M19/4                                                                  |
| DES-023 | The comment surface — tier badges, the Legal Only row wash, and the segmented composer                                                                               | Accepted                                                                                                   |
| DES-024 | The mention affordances — typeahead, chip, and the promotion confirmation (extends DES-023)                                                                          | Accepted                                                                                                   |
| DES-025 | The corrected comment row — edited marker, two tombstones, and the overflow menu (extends DES-023)                                                                   | Accepted                                                                                                   |
| DES-026 | The history panel interior — narrated row, medallion, and load-more foot (extends DES-016)                                                                           | Accepted                                                                                                   |
| DES-027 | The audit-log pane — filter bar, narrated table row, and the export foot (extends DES-021, DES-026)                                                                  | Accepted                                                                                                   |
| DES-028 | The confidential record page — the Tier 2 banner and the flag control (extends DES-009)                                                                              | Accepted                                                                                                   |
| DES-029 | The confidential marker and the composer notice — DES-009's Tier 1 and Tier 3                                                                                        | Accepted                                                                                                   |
| DES-030 | The shell scroll model — one viewport tall, and `main` owns the scroll                                                                                               | Accepted                                                                                                   |
| DES-031 | The paging foot — table placement, the thread's head control, and where focus lands (extends DES-026)                                                                | Accepted                                                                                                   |
| DES-032 | The record-page section strip — routed tabs under the breadcrumb (extends DES-016, DES-030)                                                                          | Accepted                                                                                                   |
| DES-033 | The folder tree and the record-scoped batch drop (extends DES-032, DES-025)                                                                                          | Accepted                                                                                                   |
| DES-034 | The stage pipeline — six fixed steps beside the status pill (extends DES-005, DES-032)                                                                               | Accepted                                                                                                   |
| DES-035 | The record's Approvals section — the roster table and its row actions (extends DES-032, DES-020, DES-005)                                                            | Accepted                                                                                                   |
| DES-036 | The signing half of the record — the envelope row, the send dialog, and the sub-bar chip (extends DES-035, DES-034, DES-005)                                         | Accepted                                                                                                   |
| DES-037 | The envelope's ending on the row, and the webhook note (extends DES-036, DES-035)                                                                                    | Accepted                                                                                                   |
| DES-038 | The envelope row's action cell and the void dialog (extends DES-037, DES-036, DES-035)                                                                               | Accepted                                                                                                   |
| DES-039 | The executed copy on the row, and the last two withheld notes (extends DES-038, DES-037, DES-036, DES-035)                                                           | Accepted                                                                                                   |
| DES-040 | The term on the Contract card — five fields, and the blanks the type forces (extends DES-017, DES-032)                                                               | Accepted                                                                                                   |
| DES-041 | The Term timeline card — the gutter, the two marks, and the open end (extends DES-040, DES-032, DES-012)                                                             | Accepted                                                                                                   |
| DES-042 | The Key dates section — one union, one Source chip, and the next deadline named (extends DES-035, DES-032, DES-040)                                                  | Accepted                                                                                                   |
| DES-043 | The renewal-pending banner, the Renew dialog, and the confirmed-renewal row (extends DES-035, DES-040, DES-017, DES-009)                                             | Accepted                                                                                                   |
| DES-044 | The Renew dialog's four exits, and the prefilled create (extends DES-043, DES-035, DES-033, DES-017)                                                                 | Accepted                                                                                                   |
| DES-045 | The link dialog, the picker, the refusal rendering, and the confidentiality nudge (extends DES-032, DES-024, DES-009)                                                | Accepted                                                                                                   |
| DES-046 | The managed list table — the width floor, the resize handle, the column menu, and the views control (extends DES-031, DES-021, DES-007)                              | Accepted                                                                                                   |
| DES-047 | The Team roster is an activity-bar applet (amends DES-016, DES-032, DES-028)                                                                                         | Accepted                                                                                                   |
| DES-048 | Date inputs are a calendar popover (amends DES-014, DES-040)                                                                                                         | Accepted                                                                                                   |
| DES-049 | The notification centre — the header bell, its counter badge, and the panel behind it (extends DES-026, DES-031, DES-016)                                            | Accepted                                                                                                   |
| DES-050 | The notification preferences pane — one row per event group, two switch columns (extends DES-017, DES-012, DES-011)                                                  | Accepted                                                                                                   |
| DES-051 | The email copy register (closes DES-015's deferral)                                                                                                                  | Accepted                                                                                                   |
| DES-052 | The value-list editor — the list-editor anatomy for a list of values (extends DES-020, DES-021)                                                                      | Accepted                                                                                                   |
| DES-053 | The status moves from the strip — the current stage is the trigger (extends DES-034, DES-017, DES-032)                                                               | Accepted                                                                                                   |
| DES-054 | The collapsible settings card — the header is the disclosure (extends DES-020, DES-011)                                                                              | Accepted                                                                                                   |
| DES-055 | The record's overflow menu — the acts that belong to the whole contract (extends DES-034, DES-017, DES-053)                                                          | Accepted                                                                                                   |
| DES-056 | The Inbox — a fixed list, not a curated one (extends DES-018, DES-031, DES-046)                                                                                      | Accepted                                                                                                   |
| DES-057 | The staff request detail — a record page for something that is not a record (extends DES-032, DES-016, DES-034)                                                      | Accepted; sub-bar actions added by DES-058; the Description card's absence recorded by the M21/12 addendum |
| DES-058 | The disposition sub-bar and the Decline dialog (extends DES-057, DES-035, DES-005)                                                                                   | Accepted; the Resolve dialog added by the M21/8 addendum; the slot's third button closed by DES-059        |
| DES-059 | The Convert dialog — a prefilled contract create (extends DES-058, DES-057, DES-044)                                                                                 | Accepted                                                                                                   |
| DES-060 | The archived carried reference marker and repair box (extends DES-057, DES-059)                                                                                      | Accepted                                                                                                   |
| DES-061 | Chosen comment files are removable chips (extends DES-023, DES-024)                                                                                                  | Accepted                                                                                                   |
| DES-062 | Comment paper is a download row under the body (extends DES-023)                                                                                                     | Accepted                                                                                                   |
| DES-063 | The version kind pill is a picker for Member+ (extends DES-017)                                                                                                      | Accepted                                                                                                   |
| DES-064 | Comment paper files through one destination dialog (extends DES-062, DES-023)                                                                                        | Accepted                                                                                                   |
| DES-065 | A dispositioned Request points paper at its composer (extends DES-062, DES-057)                                                                                      | Accepted                                                                                                   |
| DES-066 | The Documents destination is one flat managed list across records (extends DES-046, DES-018, DES-009)                                                                | Accepted                                                                                                   |
| DES-067 | The Entities destination uses the managed-list and record-shell patterns (extends DES-046, DES-032, DES-016, DES-018)                                                | Accepted                                                                                                   |
| DES-068 | Knowledge is a file-first managed library (extends DES-046, DES-032, DES-016, DES-055, DES-020)                                                                      | Accepted                                                                                                   |
