// SPDX-License-Identifier: AGPL-3.0-only

import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export async function devSmtpMode({ forceApp, seed, explicitUrl, hasSavedRelay }) {
  if (seed && forceApp) throw new Error("SMTP setup cannot be combined with seeding.");
  if (seed) return "mailpit";
  if (forceApp) return "app";
  if (explicitUrl) return "env";
  return (await hasSavedRelay()) ? "app" : "mailpit";
}

async function hasSavedRelay() {
  const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
  const { Client } = require("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT EXISTS (SELECT 1 FROM org_settings WHERE smtp_url IS NOT NULL " +
        "AND smtp_url <> '' AND smtp_from IS NOT NULL AND smtp_from <> '') AS configured",
    );
    return result.rows[0].configured;
  } catch (error) {
    // A fresh database may not have run the SMTP settings migration yet.
    if (error.code === "42P01" || error.code === "42703") return false;
    throw new Error("Could not check saved SMTP settings. Check the development database.", {
      cause: error,
    });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      await devSmtpMode({
        forceApp: process.argv[2] === "true",
        seed: process.argv[3] === "true",
        explicitUrl: process.env.SMTP_URL,
        hasSavedRelay,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
