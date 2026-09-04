/* Fills a dev instance with a fully developed organisation.
 *
 *   pnpm seed:demo
 *
 * What it produces is Helix Software Group: a legal team of twelve, a
 * group of thirty companies, a contract pipeline of a couple of hundred
 * across every stage, matters, an intake queue with history behind it, a
 * knowledge library, and the configuration a team builds up over a year.
 * The point is a UX review: screens with real quantities of real-looking
 * work on them, where empty states, pagination, long names, overdue
 * dates and every record state are all on screen somewhere.
 *
 * Everything goes through the HTTP API as the person who would have done
 * it, so the instance has the activity log, the notifications, the
 * numbering and the derived documents a real one has.
 *
 * ## Before you run it
 *
 * Point it at a dev loop that is up (`pnpm dev:hot`). It writes a lot,
 * and it does not clean up after itself, so run it against an empty
 * database. To start from nothing:
 *
 *   docker compose -f compose.yml -f compose.dev.yml down -v
 *   pnpm dev:hot
 *
 * ## Options
 *
 *   --scale heavy|medium|light   how much to write (default: heavy)
 *   --seed <number>              the random seed (default: 1)
 *   --skip-ai                    do not run the extraction stand-in
 *   --with-signing               also send e-signature envelopes, which
 *                                needs the loop started with
 *                                SIGNING_STANDIN=true and
 *                                DOCUSIGN_BASE_URL=http://127.0.0.1:8129
 *
 * Environment: SEED_BASE_URL (default http://localhost:3000),
 * SEED_MAILPIT_URL (default http://localhost:8025).
 */

import { DEFAULT_BASE_URL, Session, pool } from "./client.mjs";
import { createRandom } from "./random.mjs";
import { clearMailbox, mailpitIsUp } from "./mailpit.mjs";
import { ADMIN, ORG } from "./data.mjs";
import {
  archiveLeavers,
  establishAdministrator,
  openThePortal,
  provisionEveryone,
} from "./people.mjs";
import {
  configureAiConnector,
  configureApproverGroups,
  configureEmail,
  configureFields,
  configureIntakeLinks,
  configureListViews,
  configureOrganisation,
  configureTaxonomy,
  configureTemplates,
  disableAiConnector,
} from "./config.mjs";
import { readAttachments } from "./custom-fields.mjs";
import { seedEntities } from "./entities.mjs";
import { seedKnowledge } from "./knowledge.mjs";
import { planContracts, seedComparisons, seedContracts } from "./contracts.mjs";
import { seedEnvelopes } from "./envelopes.mjs";
import { planMatters, seedMatters } from "./matters.mjs";
import { planRequests, seedRequests } from "./requests.mjs";
import { startAiStub } from "./ai-stub.mjs";

/** How much work each profile writes. */
const SCALES = {
  light: { contracts: 30, matters: 18, requests: 15 },
  medium: { contracts: 70, matters: 36, requests: 28 },
  heavy: { contracts: 180, matters: 90, requests: 70 },
};

function readOptions(argv) {
  const options = { scale: "heavy", seed: 1, skipAi: false, withSigning: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--scale") options.scale = argv[++index];
    else if (argument === "--seed") options.seed = Number(argv[++index]);
    else if (argument === "--skip-ai") options.skipAi = true;
    else if (argument === "--with-signing") options.withSigning = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
  }
  return options;
}

const started = Date.now();
function stamp() {
  const seconds = Math.round((Date.now() - started) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function makeLogger() {
  let phase = "";
  return {
    phase(name) {
      phase = name;
      process.stdout.write(`\n[${stamp()}] ${name}\n`);
    },
    log(message) {
      process.stdout.write(`[${stamp()}] ${phase ? "  " : ""}${message}\n`);
    },
  };
}

/** Refuses to start against something that is not a reachable, migrated API. */
async function preflight(log) {
  const probe = new Session("preflight");
  let setup;
  try {
    ({ body: setup } = await probe.get("/api/v1/auth/setup"));
  } catch (error) {
    throw new Error(
      `No API at ${DEFAULT_BASE_URL}. Start the dev loop with \`pnpm dev:hot\` first. (${error.message})`,
    );
  }
  if (!(await mailpitIsUp())) {
    throw new Error(
      "Mailpit is not answering. Staff activation and portal sign-in both read the mailbox, so the seed cannot run without it.",
    );
  }
  log(
    `api at ${DEFAULT_BASE_URL}, mail catcher up, first-run setup ${setup.needsSetup ? "open" : "already done"}`,
  );
  return setup.needsSetup;
}

/**
 * Marks some of the noise read, and gives a few people a theme.
 *
 * Everything the seed did raised notifications, and an instance where
 * every single one is unread is not one anybody's inbox looks like.
 */
async function settlePeople(people, random, log) {
  let read = 0;
  await pool([...people.values()], 4, async (person) => {
    if (!person.session) return;
    const { body } = await person.session.get("/api/v1/notifications?limit=50");
    const rows = body.notifications ?? [];
    // Most people have read most of it and are behind on the rest.
    const toRead = rows.slice(Math.floor(rows.length * random.float(0.15, 0.4)));
    if (toRead.length > 0) {
      await person.session.post("/api/v1/notifications/read", { ids: toRead.map((row) => row.id) });
      read += toRead.length;
    }
    // Not the Administrator: that is the account the instance gets
    // reviewed from, and having its theme change under you on every
    // reseed is a surprise nobody asked for.
    if (person.email !== ADMIN.email && random.chance(0.35)) {
      await person.session.patch("/api/v1/me/preferences", {
        theme: random.pick(["light", "warm", "dark"]),
      });
    }
  });
  log(`${read} notifications marked read`);
}

/**
 * Ties a slice of the Contracts to the Matters they came out of
 * (CTR-017), so the cross-links between the two modules are populated.
 */
async function linkContractsToMatters(contracts, matters, random, log) {
  // Only open matters that everybody can reach: a confidential Matter
  // reads as absent to somebody who is not on it, so a link from a
  // contract owned by an outsider is a 404 rather than a mistake.
  const reachable = matters.filter((matter) => !matter.plan.isConfidential);
  const candidates = random.sample(contracts, Math.min(30, contracts.length));
  let linked = 0;
  for (const contract of candidates) {
    const matter = random.pick(reachable);
    if (!matter) continue;
    const { status } = await contract.author.request("POST", `${contract.at}/matter`, {
      json: { matterNumber: matter.number },
      expect: [200, 201, 404, 409, 422],
    });
    if (status < 300) linked += 1;
  }
  log(`${linked} contracts linked to matters`);
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "pnpm seed:demo [--scale heavy|medium|light] [--seed <number>] [--skip-ai] [--with-signing]\n",
    );
    return;
  }
  const scale = SCALES[options.scale];
  if (!scale) throw new Error(`Unknown scale "${options.scale}". Use heavy, medium or light.`);

  const { phase, log } = makeLogger();
  phase("preflight");
  const fresh = await preflight(log);
  if (!fresh) {
    log(
      "warning: this instance already has an Administrator, so the seed is adding to what is there.",
    );
  }
  // A previous run's links must never be redeemed by this one.
  await clearMailbox();
  log("mail catcher emptied");

  const random = createRandom(options.seed >>> 0 || 1);
  const stub = options.skipAi ? null : await startAiStub();
  if (stub) log(`extraction stand-in listening on ${stub.baseUrl}`);

  try {
    phase("the administrator");
    const admin = await establishAdministrator(log);

    phase("the organisation");
    await configureOrganisation(admin, log);
    await configureEmail(admin, log);
    await openThePortal(admin, log);

    phase("people");
    const people = await provisionEveryone(admin, log);

    phase("configuration");
    const taxonomy = await configureTaxonomy(admin, log);
    const fields = await configureFields(admin, taxonomy, log);
    const templates = await configureTemplates(admin, taxonomy, log);
    const attached = await readAttachments(admin, taxonomy);
    await configureApproverGroups(admin, people, log);
    if (stub) await configureAiConnector(admin, stub, log);

    phase("entities");
    const entities = await seedEntities(admin, { random, taxonomy, people, fields, attached }, log);

    phase("knowledge");
    const knowledge = await seedKnowledge(admin, { random, taxonomy, people }, log);
    await configureIntakeLinks(admin, knowledge, log);

    phase(`contracts (${scale.contracts})`);
    const contractPlans = planContracts({ random, scale });
    const contracts = await seedContracts(
      admin,
      { random, taxonomy, people, fields, attached, entities, plans: contractPlans },
      log,
    );

    phase(`matters (${scale.matters})`);
    const matterPlans = planMatters({ random, scale });
    const matters = await seedMatters(
      admin,
      { random, taxonomy, people, fields, attached, templates, plans: matterPlans },
      log,
    );
    await linkContractsToMatters(contracts, matters, random, log);

    phase(`intake (${scale.requests})`);
    const requestPlans = planRequests({ random, scale });
    await seedRequests(
      admin,
      { random, taxonomy, people, fields, attached, templates, plans: requestPlans },
      log,
    );

    phase("comparisons");
    await seedComparisons(contracts, random, log);

    if (options.withSigning) {
      phase("signature");
      await seedEnvelopes(admin, contracts, random, log);
    }

    phase("finishing");
    await configureListViews(people, log);
    await settlePeople(people, random, log);
    await archiveLeavers(admin, people, log);
    if (stub) {
      log(
        `extraction stand-in answered ${stub.stats.extractions} runs and ${stub.stats.probes} probes`,
      );
      await disableAiConnector(admin, log);
    }

    phase("done");
    log(`${ORG.name} is seeded.`);
    log(`sign in at http://localhost:5173 as ${ADMIN.email} / ${ADMIN.password}`);
    log("every seeded person shares that password; business users sign in with a magic link.");
  } finally {
    if (stub) await stub.close();
  }
}

main().catch((error) => {
  process.stderr.write(`\nseed failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
