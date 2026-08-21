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
      // Everything the plugin ships, at `warn`, except the one rule
      // below.
      //
      // Version 7 of the plugin is two things at once: the two classic
      // hook rules, and a dozen React Compiler rules about purity,
      // immutability and state written during an effect. The compiler
      // rules find fifteen real things in this codebase. Fixing fifteen
      // components inside a hardening change would make it unreviewable,
      // and each one wants its own judgement about what the component is
      // for — so they are recorded rather than silenced or rushed. The
      // `lint` script does not fail on warnings, so nothing that passes
      // today starts failing.
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.flat.recommended.rules).map((rule) => [rule, "warn"]),
      ),
      // The exception, at `error`, because the codebase has no
      // violations of it and this is what keeps it that way. It is also
      // the rule with teeth: conditional or looped hook calls make React
      // read the wrong state slot, and the failure shows up as one
      // record's data rendering under another rather than as a crash.
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
);
