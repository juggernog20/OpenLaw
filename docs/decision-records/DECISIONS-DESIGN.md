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
- Comment-tier UI per DD-016 (visual treatment for "Legal Only" / "Working Team" / "Full Thread" — revisit when the comment composer / thread screens are mocked)
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

#### Counter badge (neutral count)

- `--badge-count-bg` / `--badge-count-fg` — small pill inside section headers showing a count (e.g. "15"); intentionally neutral (gray) so it doesn't compete with status semantics.

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

| Token                 | px  | Role                                                                                         |
| --------------------- | --- | -------------------------------------------------------------------------------------------- |
| `--height-header`     | 62  | top header strip                                                                             |
| `--height-nav`        | 48  | top navigation row                                                                           |
| `--height-subbar`     | 64  | per-page sub-bar (page title + page actions)                                                 |
| `--width-activitybar` | 48  | record-page activity bar _(amended by **DES-016**; originally a single `--width-rail: 320`)_ |
| `--width-panel`       | 320 | record-page side panel hosting the active applet _(amended by **DES-016**)_                  |

**Density normalization.** When Light/Dark disagree with Warm in the existing Pencil mocks, **the implementation follows Light/Dark**: nav height 48px, nav gap 8px, header padding 16px. Warm's slightly tighter mock values were Pencil-time tweaks, not a deliberate brand-density signal. Per DES-001's geometry-invariance contract, the Warm mocks will be normalized to match in a follow-up Pencil pass; until then the implementation is the source of truth.

### Rationale

1. **Tailwind v4's default scale already covers every value the mocks use.** Replacing or extending the scale would create two parallel vocabularies (custom + default) without removing any. The discipline is "use what's there"; the scale is fine as-is.
2. **The 5 layout tokens earn their names.** `px-page-x` (which resolves to 32px) appears in the body, sub-bar, and every future detail page — making the body gutter a one-line change is worth a token. Pure Tailwind utilities (`px-8`) would scatter the value across files; renaming becomes a hunt-and-replace.
3. **Chrome dimensions don't need to be Tailwind utilities.** The header, nav, sub-bar, and rail show up in exactly one place each (the layout shell). Generating utilities for them would clutter the namespace; CSS-variable references (`style={{ height: "var(--height-nav)" }}` or `h-[--height-nav]`) are sufficient and cleaner.
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

**Tier 3 — Composer @-mention warning.** When the comment composer or the document-upload share-list inside a confidential matter receives an @-mention (or named-share) targeting a user who is not currently on the matter team, a non-blocking inline warning renders below the composer: _"@Sara Kim isn't on this confidential matter. They will be added as a watcher if you confirm."_ The submit action confirms the membership grant _and_ posts. No hard-block. The grant is recorded in the audit log per DD-014.

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

**Implementation clarification (2026-08-08):** the ramp's `low` step requires a light-grey pill family that DES-005's set lacked (badge-count is a counter, onhold is the dark inverted pill), so `status-neutral-*` — already present in the .pen library — was added to the CSS registry as a seventh status family. The decision specifies Light values only; Warm/Dark values for `severe` and `neutral` were derived per-theme in `styles/themes/` and contrast-checked ≥ 4.5:1 (Warm's severe fg is `#935425`, darkened from the first candidate to pass). The derived values should be back-ported to the .pen library's theme frames when those mocks next get touched.

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
