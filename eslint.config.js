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
);
