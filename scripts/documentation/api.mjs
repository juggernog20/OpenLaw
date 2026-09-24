// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileWorkspace, repository } from "./build.mjs";

// Match Vite's ordinary development/release selection and retain its edition metadata.
const { bundle } = compileWorkspace({ development: true });
for (const warning of bundle.warnings) console.warn(`[documentation] ${warning}`);
const target = join(repository, "apps/api/dist");
mkdirSync(target, { recursive: true });
writeFileSync(join(target, "documentation.json"), JSON.stringify(bundle));
