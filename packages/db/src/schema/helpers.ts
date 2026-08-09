// SPDX-License-Identifier: AGPL-3.0-only

/** Column helpers shared by every schema file (SCHEMA.md conventions). */

import { text } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/** UUID v7 primary key (TECH-004). */
export const uuidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
