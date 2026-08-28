// SPDX-License-Identifier: AGPL-3.0-only
import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/", "**/.turbo/", "**/node_modules/"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // The Rules of Hooks, on the one package that has any (TECH-001).
  // Nothing else in the monorepo renders, so the plugin is scoped rather
  // than global: it would cost every other package a parse for rules
  // that can never fire.
  //
  // A broken Rule of Hooks is not a style problem. A hook called
  // conditionally makes React read the wrong slot, so state belonging to
  // one field arrives in another — which in a legal tool means the
  // confidential flag from one record rendering on the next. The
  // compiler could not tell you that, and neither could a test that
  // happens to take the branch that works.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
    rules: {
      // Everything the plugin ships, at `error`.
      //
      // Version 7 of the plugin is two things at once: the two classic
      // hook rules, and a dozen React Compiler rules about purity,
      // immutability and state written during an effect. When the
      // plugin landed (2026-08-16) the compiler rules found fifteen real
      // things and sat at `warn` so each could be fixed with its own
      // judgement. Twelve days later there were nineteen, because a
      // warning that never fails the build is a comment. They were fixed
      // in one pass (2026-08-28, #554) and the rules went to `error` so
      // the count stays at zero.
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.flat.recommended.rules).map((rule) => [rule, "error"]),
      ),
      // Named on its own because it is the rule with teeth: conditional
      // or looped hook calls make React read the wrong state slot, and
      // the failure shows up as one record's data rendering under
      // another rather than as a crash.
      "react-hooks/rules-of-hooks": "error",
    },
  },
  // The web app's package boundary, as a rule rather than as a habit
  // (#390).
  //
  // The SPA reaches the server through exactly two packages: the
  // generated typed client (`@openlaw/api-client`) and the wire
  // vocabulary both ends must agree on (`@openlaw/shared`). It must
  // never import `@openlaw/api` or `@openlaw/db` for values. Server
  // code pulled into the bundle is not a style problem: `@openlaw/db`
  // reaches a connection string, and `@openlaw/api` reaches the auth
  // instance and every credential the sealed columns hold (TECH-022).
  // A bundler that resolved either would ship them to a browser.
  //
  // Nothing enforced this before. `@openlaw/api` is not even in
  // `apps/web/package.json`, so the one import below resolves through
  // the workspace rather than through a declared dependency — which is
  // to say the boundary was held by everybody remembering it.
  //
  // **The one blessed exception is type-only.** better-auth infers the
  // client's user fields from the server instance's type
  // (`inferAdditionalFields<Auth>`), which is the vendor's own pattern
  // and the reason `apps/web/src/lib/auth-client.ts` imports
  // `@openlaw/api/auth`. A `import type` is erased before the bundler
  // sees it, so it costs nothing at runtime. `allowTypeImports` is what
  // says that out loud: drop the `type` keyword and the rule fires.
  //
  // How the two patterns divide the work: a type-only import of
  // `@openlaw/api/auth` is let through because one matching pattern
  // allows type imports, and that clearance holds against every
  // pattern. A *value* import of it is reported by both — the boundary
  // message and the type-only one. The first group carries no
  // `!@openlaw/api/auth` exclusion because it would be dead: the
  // gitignore semantics these groups use cannot re-include a path
  // under an excluded parent, and `@openlaw/**` excludes
  // `@openlaw/api` whole.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@openlaw/**", "!@openlaw/api-client", "!@openlaw/shared"],
              message:
                "The web app reaches the server through @openlaw/api-client and @openlaw/shared only. Server packages must never enter the browser bundle.",
            },
            {
              group: ["@openlaw/api/auth"],
              allowTypeImports: true,
              message:
                "@openlaw/api/auth is type-only here — better-auth's inferAdditionalFields pattern. Use `import type`; a value import would pull the server's auth instance into the bundle.",
            },
          ],
        },
      ],
    },
  },
  // DES-012: content is container-responsive; only chrome and modals
  // follow the viewport (#553).
  //
  // A `sm:` or `lg:` on a card inside the page region reacts to the
  // window, not to the space the card has. Open the applet panel on a
  // 1440px window and the record content is 1072px wide, but a
  // `lg:grid-cols-3` still sees 1440 and keeps three columns. The
  // container form (`@lg/record:grid-cols-3`) sees 1072. So content uses
  // `@sm:`, `@md:`, `@lg:` against the nearest named container
  // (`@container/page`, `/record`, `/dialog`, ...).
  //
  // The two selectors below read every string literal and template
  // chunk under a JSX `className`. A viewport modifier is a word that
  // starts with `sm:`, `md:`, `lg:`, `xl:` or `2xl:`; `(^|\s)` is what
  // keeps `@lg:` and `@2xl/form:` clear of the rule. Strings passed to
  // `cn()` outside a `className` are not covered. That is on purpose,
  // the rule stays small and readable.
  //
  // The three files that own the viewport cliff are exempt: the dialog
  // (full-screen below md), and the app and portal shells (chrome).
  {
    files: ["apps/web/src/**/*.tsx"],
    ignores: [
      "apps/web/src/components/ui/dialog.tsx",
      "apps/web/src/components/shell/**",
      "apps/web/src/components/portal/portal-shell.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(sm|md|lg|xl|2xl):/]",
          message:
            "Viewport modifiers (sm:, md:, lg:, xl:, 2xl:) belong to chrome and modals only. Content uses container modifiers (@sm:, @md:, @lg:) against the nearest named container (DES-012).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)(sm|md|lg|xl|2xl):/]",
          message:
            "Viewport modifiers (sm:, md:, lg:, xl:, 2xl:) belong to chrome and modals only. Content uses container modifiers (@sm:, @md:, @lg:) against the nearest named container (DES-012).",
        },
      ],
    },
  },
);
