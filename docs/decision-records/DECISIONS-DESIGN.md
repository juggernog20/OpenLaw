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
- shadcn updates are pulled by re-copying components or by reading the upstream diff and applying it manually — not by `npm update`. This is the trade-off of owning the source.
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
- The record-page right side defers to **DES-016**: `--width-activitybar: 48px` + `--width-panel: 320px` are the layout contract (`--width-rail` is retired). Below the width threshold the panel overlays instead of docking while the activity bar remains visible. Future pages that opt out (e.g. full-bleed editors, focus mode) override at the layout-shell level rather than via per-page padding math.
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

**Superseded for contracts by CMT-007, recorded in CTR-022 and built in DES-029.** There is nobody to offer. The mention typeahead offers only people the record already reaches, so on a confidential contract it never names somebody outside the audience — the warning has no case to fire on, and the membership grant it confirmed is one CMT-007 rejected for every record. Tier 3 survives as the composer's confidential notice, which states the flag and names the bounded audience instead of offering to widen it. The clause above stands for matters until M22 answers for them.

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

| Region                                                                                                | Mechanism                                                   | Behavior                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top nav, sub-bar, header                                                                              | Viewport                                                    | Below 768px: top nav collapses to hamburger; sub-bar simplifies to title + primary action; filter chips collapse into a "Filters" sheet. At 768px and above: full chrome as in mocks.                                 |
| Side panel (`--width-panel: 320px` per **DES-016**; the 48px `--width-activitybar` is always visible) | **Container query** on the page-content container           | Docked when content container ≥ ~1100px wide; below the threshold the panel **overlays** instead of docking, opened from the activity bar. The panel is supplementary by design; pages must remain useful without it. |
| Tables                                                                                                | **Container query** on the table's wrapper                  | Card-stack rendering when wrapper `< ~640px`; row rendering above. Decoupled from viewport entirely so tables don't break inside narrow modal bodies.                                                                 |
| Two-pane detail layouts                                                                               | **Container query** on the layout shell                     | Single-pane below ~1024px-of-shell; two-pane above. Secondary pane reachable via a back-button-driven sub-route in single-pane mode.                                                                                  |
| Card grids, chip rows                                                                                 | `grid-template-columns: repeat(auto-fit, minmax(Npx, 1fr))` | Auto-reflow; no breakpoint code.                                                                                                                                                                                      |
| Modals                                                                                                | Viewport                                                    | Full-screen below 768px; centered overlay above.                                                                                                                                                                      |

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
- The right rail's collapse threshold (~1100px container width) and the table's card-stack threshold (~640px wrapper width) are tuning values; they land as named constants in the styles layer (e.g. `--container-rail-threshold`, `--container-table-stack-threshold`) and are revisited once real content lands.
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
4. **Locale stored on the user record**, defaulting to `en-US`. Server-rendered into `<html lang>` (which DES-011 already requires) so initial paint formatting is correct without a client-side flicker.
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
| **Date inputs**                                                       | Browser-native `<input type="date">`                                        | (locale-aware by default)                                                                                    |
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
- **Email digest copy** (deferred with the notifications-surface decision) — separate register decision when that ships.
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

---

## DES-016: Record-page right side — VS Code-style activity bar with page-scoped applets (amends DES-007's rail)

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

The contract-details mocks carried two competing right-side systems: a module chip row (E) and a V13 icon bar + panel (J) — flagged as duplication (X.8) and as a conflict with DES-007's single 320px `--width-rail`. The screen-batch grill resolved it; Blair named the reference model: "VS code activity bar style where it's a single activity bar with vertical icons available 'applets' for that page as icons when you expand the side bar."

### Decision

- **One right-side system: the activity bar** — a persistent 48px vertical icon strip on record pages, VS Code-style. Each icon is an **applet available on that page**; clicking expands the side panel hosting that applet (one applet visible at a time; clicking the active icon collapses).
- **Applet set is page-scoped.** Contract details: chat (CMT-004 comment panel), history (DD-017 activity feed), settings deep-link (SET-001, below a divider). The document panel (K) opens as a wider sibling layer per the doc-panel spec, not inside the applet panel.
- **The module chip row is removed** from record pages (E.0 remove — chips duplicated applet/section jobs).
- **DES-007 amendment:** the record-page right side is `--width-activitybar: 48px` + `--width-panel: 320px` (the panel reuses the old rail width; `--width-rail` is renamed/retired in favor of these two tokens). Container-query behavior carries over: below the width threshold the panel overlays instead of docking; the bar remains.
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
5. **Give the panel a 44px header: the applet's title (13px semibold) and a close X (16px glyph), over a `border-muted` rule.** Both M3 and M13 draw it. Keep the close control even though it duplicates the bar toggle — the panel can overlay below the container threshold, where the collapse affordance must not be 320px away on the far side of the panel. Treat the M3 header's count pill ("4", total comments) as applet content, not panel chrome; it lands with the chat applet (M8/M9). Close the panel on `Esc` and return focus to the applet's bar icon on close — DES-010's overlay rules, wired by hand because the panel is a plain `aside`, not a Radix overlay.
6. **Type a slot as either a panel or a link.** DES-016 names settings as a deep link, so the applet type is a union: `render` opens the panel, `href` navigates. Only `render` slots own the panel, and only they toggle. Group link slots below the divider.

Dock via a container query at 1100px of record-region width per DES-012. Write the threshold literally into the class list: Tailwind scans source text, and container conditions cannot read a CSS variable.

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
5. The search placeholder is "Type / to search" in every theme, as the Light and Dark frames draw it. The Warm frame's longer "Type / to search matters, contracts, entities…" copy describes the M25 cross-module search scope, not the M4 shell. (Added during the #49 acceptance comparison.)
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
3. ST11 draws no edit affordance; the trailing pencil button is this record's addition — the seeded prompts and the options lists are editable (CTR-008/CTR-016), and the list row deliberately never grows a second line (DES-020).

### Rationale

The alternative was forcing the catalog into the plain anatomy (losing the type/scope/tag columns that make the catalog scannable) or a bespoke pane outside the pattern (a fourth implementation to keep aligned by eye). Extending the one component keeps DES-020's guarantees — row height, rename, archive treatment, protection semantics — while the extension points absorb the real variation.

### Consequences

`apps/web/src/components/list-editor.tsx` carries the pattern; the Types (#81) and Statuses (#82) panes were refactored onto it with their test suites unchanged. Later taxonomy panes choose: plain anatomy (inline add, optional reorder) or the table variant (columns, dialog editor) — both are this one component. The M22 Matters → Fields pane reuses the fields pane's table variant with the scope picker widened to `matter`.

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

`/settings/contracts/types/:id` (#84) is the reference implementation, reached from a pencil icon button in the list row's trailing actions (the DES-021 slot; here it navigates instead of opening a dialog, because the editor is a screen). The M22 matters editor and M19 request-type editor reuse this shape with their own vocabulary.

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

- Height `--height-confidential-banner`, background `bg-confidential-bg`, foreground `text-confidential`, a bottom rule in `border-default` to match the sub-bar's separation, and `px-page-x` gutters.
- A 16px `Lock`, then the statement at 12px medium, left-aligned; the trailing link at 12px semibold, right-aligned.
- It is a labelled region, so the statement stays reachable from the landmark list after half an hour inside the record — the same persistence the strip gives a sighted reader.

**The trailing link is gated to the three actors** — an Administrator, the `creator` team row, and the Owner (DD-014, CTR-022) — and it is a fragment to the record's own Team card. Changing the audience is changing the roster, so "one step from the reminder" is one anchor, not a route that does not exist.

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
- **"Manage team" as a route.** Rejected: there is no team-management route; the roster is a card on this page, and inventing a destination for it is a product decision this ticket has no mandate for.
- **A dismiss control that only hides the banner for the session.** Rejected by DES-009 itself, and worth restating: a banner that can be closed is a banner that is closed.

### Consequences

`apps/web/src/components/confidential-banner.tsx` is Tier 2, and `confidential-toggle.tsx` is the shared control; DES-009's `<ConfidentialMarker>` (Tier 1) lands beside them with M10/5. `AppShell` gains one optional `banner` slot between the nav and the sub-bar — the only chrome that sits there today. No new tokens: the height and the colour pair were added with DES-009 and are already contrast-linted in all three themes. The record's Team card gains a stable `id`, because the banner's link is a fragment to it.

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

`apps/web/src/components/confidential-marker.tsx` is Tier 1. The contract list row renders the inline variant; the comment applet and the history applet render the micro variant and take one new option each, so the record page passes the saved flag rather than the loaded one and the panels follow a commit exactly as the banner does. The comment composer renders the Tier 3 notice. No new tokens: the foreground pair was added with DES-009 and is contrast-linted in all three themes. Every future surface that renders a contract title outside the record page — search (M25), the dashboard (M29), the CTR-018 link rows (M17/M23) — renders the inline variant there; that obligation belongs to those tickets.

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

## Index of decisions

| #       | Decision                                                                                                                                                             | Status   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| DES-001 | Ship three themes (Light / Warm / Dark) as user-selectable from v1                                                                                                   | Accepted |
| DES-002 | Light is the default theme; Warm and Dark are user-selectable                                                                                                        | Accepted |
| DES-003 | Design language anchor — "utility-tool with character," GitHub-Primer-shaped                                                                                         | Accepted |
| DES-004 | Component substrate — shadcn/ui + Tailwind + CSS variables + Radix primitives                                                                                        | Accepted |
| DES-005 | Color tokens — semantic, theme-aware, four surface tiers, paired status pills                                                                                        | Accepted |
| DES-006 | Typography ramp — Inter, 8-step size scale, 3 weights, reserved mono                                                                                                 | Accepted |
| DES-007 | Spacing scale + density target — Tailwind default + 5 layout tokens + 4 chrome dimensions, normalized to 48/8/16                                                     | Accepted |
| DES-008 | Iconography — Lucide as the v1 icon library, sizes 16/20/24, currentColor inheritance                                                                                | Accepted |
| DES-009 | Confidentiality affordance — 3-tier pattern (inline marker / detail banner / composer warning)                                                                       | Accepted |
| DES-010 | Keyboard contract — `/`, `Esc`, `?` global keys; Radix component defaults; Cmd-K deferred                                                                            | Accepted |
| DES-011 | Accessibility floor — WCAG 2.2 AA contract; AAA aspirational on text; no formal audit in v1                                                                          | Accepted |
| DES-012 | Responsive layout primitives — container queries for content, single 768px viewport breakpoint for the mobile shell                                                  | Accepted |
| DES-013 | Internationalization architecture — every string wrapped in ICU MessageFormat from day one; `Intl.*` for formatting; en-US the only v1 locale                        | Accepted |
| DES-014 | Date / time / currency display conventions — relative-then-short-absolute; UTC-stored / browser-detected display; ISO 4217 currency; no compact-number abbreviations | Accepted |
| DES-015 | Content tone register — terse, direct, second-person imperative ("GitHub voice, not Mailchimp voice")                                                                | Accepted |
| DES-016 | Record-page right side — VS Code-style activity bar with page-scoped applets                                                                                         | Accepted |
| DES-017 | Editing model — per-field inline commit, no page edit mode                                                                                                           | Accepted |
| DES-018 | Chromatic discipline — status families kept, one severity ramp (grey/yellow/orange/red), uniform light-blue avatars with photo override                              | Accepted |
| DES-019 | Shell chrome color variables — per-theme chrome mapping, Warm terracotta avatar (amends DES-018)                                                                     | Accepted |
| DES-020 | List-editor pattern — the shared anatomy for taxonomy settings panes                                                                                                 | Accepted |
| DES-021 | List-editor table variant and the field-editor dialog (extends DES-020)                                                                                              | Accepted |
| DES-022 | The type-editor screen — identity card plus attachment table (extends DES-020)                                                                                       | Accepted |
| DES-023 | The comment surface — tier badges, the Legal Only row wash, and the segmented composer                                                                               | Accepted |
| DES-024 | The mention affordances — typeahead, chip, and the promotion confirmation (extends DES-023)                                                                          | Accepted |
| DES-025 | The corrected comment row — edited marker, two tombstones, and the overflow menu (extends DES-023)                                                                   | Accepted |
| DES-026 | The history panel interior — narrated row, medallion, and load-more foot (extends DES-016)                                                                           | Accepted |
| DES-027 | The audit-log pane — filter bar, narrated table row, and the export foot (extends DES-021, DES-026)                                                                  | Accepted |
| DES-028 | The confidential record page — the Tier 2 banner and the flag control (extends DES-009)                                                                              | Accepted |
| DES-029 | The confidential marker and the composer notice — DES-009's Tier 1 and Tier 3                                                                                        | Accepted |
| DES-030 | The shell scroll model — one viewport tall, and `main` owns the scroll                                                                                               | Accepted |
