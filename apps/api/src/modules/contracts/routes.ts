// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record routes (M8): list, create, the record read, the
 * DES-017 per-field update, archive, restore, and the contract team,
 * plus the Member+ picker read the create dialog and the record's
 * pickers need (the contract-types and contract-statuses settings
 * surfaces stay Administrator-only per SET-002).
 *
 * The people are CTR-004's. The Owner is a field — one nullable FK,
 * `manager_id`, labelled "Owner" on every surface — so it commits
 * through the same per-field PATCH as the rest and rides
 * `contract.updated`. The team is a compound-key join on (contract,
 * person, role), so one person may hold two roles at once, and it has
 * its own routes and its own audit verbs.
 *
 * Our side of the contract is CTR-011's: `entity_id`, one nullable FK
 * into the M7 registry, naming which of our own Entities signs. It is a
 * field like any other, so it commits through the same per-field PATCH
 * and rides `contract.updated`. The picker reads the registry's own
 * Member+ list, which already leaves archived entities out; the write
 * refuses one, so nothing new is signed by an entity that has left.
 *
 * Their side is CTR-011's `contract_counterparties` join: N parties on
 * one contract, exactly one of them primary. That invariant is this
 * file's to keep, and it holds in one direction only — a contract with
 * counterparties always has a primary. The first party added takes the
 * flag; removing the holder passes it to the next; the last one out
 * takes it with them. Every one of those paths runs under the contract
 * row's lock, so two Legal Team Members cannot both promote. A name
 * with no record behind it becomes one in the same transaction that
 * puts it on the contract, which is what keeps intake friction near
 * zero — and the same transaction refuses to make a second record for a
 * name we already hold.
 *
 * Every route is addressed by the contract's CTR-003 number, not its
 * id: the number is the reference a Legal Team Member speaks, links,
 * and emails, so it is what the URL carries. The database assigns it
 * from a dedicated identity sequence and refuses every attempt to write
 * it, so nothing here has to defend its immutability.
 *
 * The contract stores `status_id` only. `stage` rides out on every row
 * derived from the status (CTR-001) — the client branches on the stage
 * and renders the label. Any status may follow any other: real deals
 * collapse and reopen, so there is no transition matrix.
 *
 * The value is CTR-010's, and it is the first field here that is not a
 * scalar: an amount, its ISO 4217 currency, and the cadence the amount
 * is per are three columns that behave as one field. They commit
 * together, clear together, and appear in the audit map as one entry —
 * an amount with no currency is a number nobody can read, so the seam
 * refuses it and the database check refuses it again. The amount is an
 * integer count of the currency's smallest unit; no total is stored,
 * because every total (annual × term) is derivable from what is.
 *
 * Access is Member+ throughout — Administrators and Legal Team Members
 * equally. Contributor record-level access waits for the DD-015 grid.
 * Every mutation appends to the activity log in the same transaction
 * (DD-017); the feed and audit surfaces read it in M9.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractCounterparties,
  contractStatuses,
  contracts,
  contractTeam,
  contractTypes,
  counterparties,
  CONTRACT_STAGES,
  CONTRACT_TEAM_ROLES,
  desc,
  entities,
  eq,
  isNull,
  ne,
  SEVERITY_LEVELS,
  sql,
  users,
  USER_ROLES,
  VALUE_CADENCES,
  type Contract,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** Contracts are Member+ everywhere, read and write. */
const requireMember = requireRole("administrator", "legal_team_member");

/** The protected CTR-001 seed every contract is born on. */
const DRAFT_STATUS_SLUG = "draft";

/** Contract surfaces are Member+ (DD-013), so only a Member+ user can
 * be the Owner: an Owner who cannot open the record cannot run it. */
const OWNER_ROLES = ["administrator", "legal_team_member"] as const;

/** The `creator` row is provenance, not membership: the server writes it
 * once at creation, and nothing after that adds or drops it. */
const CREATOR_ROLE = "creator";

const SeveritySchema = z.enum(SEVERITY_LEVELS);

/**
 * The ISO 4217 codes this instance accepts, taken from the runtime's own
 * CU/ICU tables rather than a list checked into the repository: a
 * hand-kept list is a list that goes stale, and picking a shorter one
 * would be an unrecorded product decision about which currencies a
 * self-hoster may trade in.
 */
const ISO_4217 = new Set(Intl.supportedValuesOf("currency"));

/**
 * CTR-010's value, as every surface reads it: the amount as an integer
 * count of the currency's smallest unit (cents for USD, yen for JPY),
 * the ISO 4217 code that says which unit that is, and what the amount
 * is per. Null as a whole — no value recorded is normal, which is what
 * an NDA looks like — never null in part.
 */
const ContractValueSchema = z.object({
  amount: z.int().nonnegative(),
  currency: z.string(),
  cadence: z.enum(VALUE_CADENCES),
});

/**
 * The same trio on the way in. All three are required together, so the
 * seam cannot be handed an amount with no currency; `null` in place of
 * the object is how the whole value is cleared. Case is normalized, so
 * "usd" and "USD" are one currency and never two rows that disagree.
 */
const ContractValueInput = z.strictObject({
  amount: z.int().nonnegative(),
  currency: z
    .string()
    .trim()
    .transform((code) => code.toUpperCase())
    .refine((code) => ISO_4217.has(code), {
      message: "Use a three-letter ISO 4217 currency code.",
    }),
  cadence: z.enum(VALUE_CADENCES),
});

/** A person as every contract surface renders them: name and face, plus
 * the SET-005 archived flag the shared identity component greys on. */
const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

/** One `contract_team` row, read back as the person plus their role.
 * The compound key means the same person can appear twice, under two
 * roles — that is membership, not a duplicate. */
const TeamMemberSchema = PersonSchema.extend({ role: z.enum(CONTRACT_TEAM_ROLES) });

/** One of our own Entities as the contract record names it (CTR-011):
 * the id the picker commits and the legal name that goes on the paper.
 * Archiving an entity later never touches the record — the contract
 * keeps naming who signed it, and the registry is where its standing is
 * read. Nothing more of the identity card is joined in: the record
 * renders a name, not a card. */
const SigningEntitySchema = z.object({
  id: z.string(),
  legalName: z.string(),
});

/** Their side, as a list needs it (CTR-011): one name per contract. The
 * primary is the party the contracts list column and the record name
 * first. NULL means nobody is recorded on the other side yet. */
const PrimaryCounterpartySchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** One party on the record, with the jurisdiction that tells two
 * same-named organizations apart and the flag that says which one the
 * list shows. */
const CounterpartySchema = PrimaryCounterpartySchema.extend({
  jurisdiction: z.string().nullable(),
  isPrimary: z.boolean(),
});

const ContractRowSchema = z.object({
  id: z.string(),
  /** CTR-003's immutable global reference, rendered C-###. */
  number: z.number().int(),
  title: z.string(),
  contractTypeId: z.string(),
  /** The type's display name, joined in — the list renders it directly. */
  contractTypeName: z.string(),
  statusId: z.string(),
  /** The status's configurable label (CTR-001) — presentation only. */
  statusName: z.string(),
  /** Derived from the status, never stored; code branches on this. */
  stage: z.enum(CONTRACT_STAGES),
  /** CTR-004's single accountable person, labelled "Owner" in the UI.
   * NULL = unassigned, which reads as triage, not as missing data. */
  manager: PersonSchema.nullable(),
  /** CTR-011's our side: which of our Entities signs. NULL until known.
   * The list does not draw it (the C1 mock has no such column), but it
   * is a field of the record, and a field rides the row the per-field
   * PATCH answers with — the same place `description` sits. */
  entity: SigningEntitySchema.nullable(),
  /** CTR-011's their side, reduced to the one name a row can show: the
   * primary counterparty. The C1 mock draws it as a list column, so it
   * rides the row every route answers with. The full party list is the
   * record's, and rides the record envelope. */
  primaryCounterparty: PrimaryCounterpartySchema.nullable(),
  priority: SeveritySchema,
  /** NULL = not yet assessed, which is not the same as low (CTR-005). */
  risk: SeveritySchema.nullable(),
  /** CTR-010's amount, currency, and cadence as one field. NULL = no
   * value is recorded, which is normal — an NDA is worth nothing and
   * says nothing about money. The C1 mock draws it as a list column, so
   * it rides every row, not just the record's. */
  value: ContractValueSchema.nullable(),
  description: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const ContractEnvelope = z.object({ contract: ContractRowSchema });
/** The record page's read: the contract, its working group, and every
 * party on the other side. Both lists ride here rather than on the row,
 * because only the record renders them — the list would carry joins it
 * never draws. */
const ContractRecordEnvelope = ContractEnvelope.extend({
  team: z.array(TeamMemberSchema),
  counterparties: z.array(CounterpartySchema),
});
const TeamEnvelope = z.object({ team: z.array(TeamMemberSchema) });
/** What every counterparty write answers with. The contract rides along
 * because the party list decides the row's `primaryCounterparty`, and a
 * caller that only got the list back would have to guess it. */
const CounterpartiesEnvelope = ContractEnvelope.extend({
  counterparties: z.array(CounterpartySchema),
});

/** The Member+ readable slice of a contract type. */
const TypeOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

/** The Member+ readable slice of a contract status: the label to show
 * and the fixed stage behind it. */
const StatusOptionSchema = TypeOptionSchema.extend({ stage: z.enum(CONTRACT_STAGES) });

/** The Member+ readable slice of a person: enough to draw a picker
 * entry, plus the role the Owner filter reads. Archived people are left
 * out entirely — this list exists to be assigned from. */
const UserOptionSchema = PersonSchema.extend({ role: z.enum(USER_ROLES) });

const TitleSchema = z.string().trim().min(1).max(200);
/** CTR-011's inline creation writes exactly this and nothing else. */
const CounterpartyNameSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(10_000);
/** The number is the path, so it is an integer or it is not a contract. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** A user row as the person shape, or null when nobody is joined. */
interface JoinedPerson {
  id: string;
  displayName: string;
  image: string | null;
  archivedAt: Date | null;
}

function toPerson(person: JoinedPerson) {
  return {
    id: person.id,
    displayName: person.displayName,
    image: person.image,
    // SET-005: an archived person stays on the record and renders greyed
    // — removing them would rewrite history to hide a departure.
    archived: person.archivedAt !== null,
  };
}

/** `toPerson` for the outer join, where nobody is a real answer. */
function toPersonOrNull(person: JoinedPerson | null) {
  return person ? toPerson(person) : null;
}

/** An entity row as the outer join answers it, where no entity yet is a
 * real answer (CTR-011). */
interface JoinedEntity {
  id: string;
  legalName: string;
}

/** The primary counterparty as the outer join answers it, where nobody
 * recorded yet is a real answer (CTR-011). */
interface JoinedCounterparty {
  id: string;
  name: string;
}

/** One party on the record, ordered and flagged as the record draws it. */
interface RecordCounterparty extends JoinedCounterparty {
  jurisdiction: string | null;
  isPrimary: boolean;
}

/** The joined shape every route answers with — the stored row plus the
 * two display names, the derived stage, the Owner, the entity that
 * signs, and the party the other side is named by. */
interface ContractContext {
  row: Contract;
  contractTypeName: string;
  statusName: string;
  stage: (typeof CONTRACT_STAGES)[number];
  manager: JoinedPerson | null;
  entity: JoinedEntity | null;
  primaryCounterparty: JoinedCounterparty | null;
}

/** The three stored columns read back as the one field they are. The
 * database's group check is what lets this test a single column and
 * trust the rest; the other two are tested anyway, because a type that
 * admits the partial state should be narrowed by the code that reads
 * it, not by a comment. */
function toValue(row: Contract) {
  return row.valueAmount === null || row.valueCurrency === null || row.valueCadence === null
    ? null
    : { amount: row.valueAmount, currency: row.valueCurrency, cadence: row.valueCadence };
}

/** One value equals another when all three parts match, and no value
 * equals no value. A field that commits as a group compares as a group
 * — otherwise a re-sent identical value would write an audit row saying
 * something changed when nothing did. */
function sameValue(
  left: z.infer<typeof ContractValueSchema> | null,
  right: z.infer<typeof ContractValueSchema> | null,
) {
  if (left === null || right === null) return left === right;
  return (
    left.amount === right.amount &&
    left.currency === right.currency &&
    left.cadence === right.cadence
  );
}

function toRow(context: ContractContext) {
  const { row } = context;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    contractTypeId: row.contractTypeId,
    contractTypeName: context.contractTypeName,
    statusId: row.statusId,
    statusName: context.statusName,
    stage: context.stage,
    manager: toPersonOrNull(context.manager),
    entity: context.entity,
    primaryCounterparty: context.primaryCounterparty,
    priority: row.priority,
    risk: row.risk,
    value: toValue(row),
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const contractsRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];
  type Executor = typeof app.db | Tx;

  /** The one read shape: the contract with its type name, status label,
   * derived stage, Owner, signing entity, and primary counterparty. All
   * three people-and-parties joins go outward — unassigned (CTR-004),
   * not-yet-known, and nobody-recorded-yet (CTR-011) are real states, so
   * a contract missing any of them still reads. The primary join is
   * keyed on the flag as well as the contract, so at most one party row
   * can meet each contract row: that is the one-primary invariant read
   * back out. */
  const selectContracts = (db: Executor) =>
    db
      .select({
        row: contracts,
        contractTypeName: contractTypes.displayName,
        statusName: contractStatuses.displayName,
        stage: contractStatuses.stage,
        manager: {
          id: users.id,
          displayName: users.displayName,
          image: users.image,
          archivedAt: users.archivedAt,
        },
        entity: {
          id: entities.id,
          legalName: entities.legalName,
        },
        primaryCounterparty: {
          id: counterparties.id,
          name: counterparties.name,
        },
      })
      .from(contracts)
      .innerJoin(contractTypes, eq(contracts.contractTypeId, contractTypes.id))
      .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
      .leftJoin(users, eq(contracts.managerId, users.id))
      .leftJoin(entities, eq(contracts.entityId, entities.id))
      .leftJoin(
        contractCounterparties,
        and(
          eq(contractCounterparties.contractId, contracts.id),
          eq(contractCounterparties.isPrimary, true),
        ),
      )
      .leftJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id));

  /** The working group on one contract, alphabetical by name so the
   * roster reads the same on every visit; a person holding two roles
   * appears once per role. */
  const selectTeam = async (db: Executor, contractId: string) => {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
        role: contractTeam.role,
      })
      .from(contractTeam)
      .innerJoin(users, eq(contractTeam.userId, users.id))
      .where(eq(contractTeam.contractId, contractId))
      .orderBy(asc(sql`lower(${users.displayName})`), asc(contractTeam.role));
    return rows.map((row) => ({ ...toPerson(row), role: row.role }));
  };

  /**
   * The other side of one contract (CTR-011), primary first and then
   * alphabetical. The primary leads because it is the party the record
   * and the list name, and a reader should not have to hunt for it.
   * Archived counterparties stay in the answer: a party that signed is
   * a fact of the contract, and leaving the typeahead does not undo it.
   */
  const selectCounterparties = async (
    db: Executor,
    contractId: string,
  ): Promise<RecordCounterparty[]> =>
    db
      .select({
        id: counterparties.id,
        name: counterparties.name,
        jurisdiction: counterparties.jurisdiction,
        isPrimary: contractCounterparties.isPrimary,
      })
      .from(contractCounterparties)
      .innerJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id))
      .where(eq(contractCounterparties.contractId, contractId))
      .orderBy(desc(contractCounterparties.isPrimary), asc(sql`lower(${counterparties.name})`));

  /** The row's `primaryCounterparty` derived from the party list a write
   * path just produced — the same answer the list query's flag-keyed
   * join gives the read paths, without a second round trip. */
  function primaryOf(parties: readonly RecordCounterparty[]): JoinedCounterparty | null {
    const primary = parties.find((party) => party.isPrimary);
    return primary ? { id: primary.id, name: primary.name } : null;
  }

  /**
   * Reads the parties back and answers the whole envelope, so a write
   * path never has to assemble the row and the list itself. Called at
   * the end of every counterparty mutation, inside its transaction.
   */
  async function counterpartiesEnvelope(tx: Tx, context: ContractContext) {
    const parties = await selectCounterparties(tx, context.row.id);
    return {
      contract: toRow({ ...context, primaryCounterparty: primaryOf(parties) }),
      counterparties: parties,
    };
  }

  /**
   * CTR-011's inline creation: a typed name becomes a counterparty
   * record. It answers the record we already hold under that name
   * before it makes a new one, so the typeahead cannot leave two rows
   * behind for one organization — the client filters the same names out
   * of its create affordance, and this is the refusal that holds when
   * two clients disagree.
   *
   * The advisory lock is transaction-scoped and keyed on the name, so
   * two Legal Team Members typing the same unknown name onto two
   * different contracts at the same moment take turns: the first
   * creates, the second finds. Locking the contract row cannot do this
   * — they are on different contracts — and a unique constraint on the
   * name would be a permanent ruling that two organizations may never
   * share one, which is not ours to make here.
   */
  async function findOrCreateCounterparty(tx: Tx, rawName: string) {
    const name = rawName.trim();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(${name})))`);
    const [existing] = await tx
      .select({ id: counterparties.id, name: counterparties.name })
      .from(counterparties)
      .where(
        and(
          isNull(counterparties.archivedAt),
          // Matched case-insensitively on the name index's own
          // expression: "helix labs gmbh" is the organization already
          // filed as "Helix Labs GmbH", not a second one.
          sql`lower(${counterparties.name}) = lower(${name})`,
        ),
      )
      .orderBy(asc(counterparties.createdAt))
      .limit(1);
    if (existing) return { party: existing, born: false };

    const [created] = await tx
      .insert(counterparties)
      .values({ name })
      .returning({ id: counterparties.id, name: counterparties.name });
    return { party: created!, born: true };
  }

  /**
   * Moves the primary flag onto one party of one contract: demote the
   * holder, then promote the named row. The order is not a style — the
   * partial unique index behind the invariant refuses a second primary,
   * so promoting first would be refused by the database.
   *
   * The caller holds the contract row's lock, which is what makes the
   * two statements one decision (CTR-011: the application enforces this).
   */
  async function promotePrimary(tx: Tx, contractId: string, counterpartyId: string) {
    await tx
      .update(contractCounterparties)
      .set({ isPrimary: false })
      .where(
        and(
          eq(contractCounterparties.contractId, contractId),
          eq(contractCounterparties.isPrimary, true),
          ne(contractCounterparties.counterpartyId, counterpartyId),
        ),
      );
    await tx
      .update(contractCounterparties)
      .set({ isPrimary: true })
      .where(
        and(
          eq(contractCounterparties.contractId, contractId),
          eq(contractCounterparties.counterpartyId, counterpartyId),
        ),
      );
  }

  /**
   * Locks one live user by id and returns them, or refuses. `roles`
   * narrows the answer — the Owner must be Member+, a team member may be
   * anyone, including the Contributor who is external counsel (MTR-006).
   * The lock stops a concurrent archive slipping between check and write.
   */
  async function lockedUser(tx: Tx, userId: string, roles: readonly string[], refusal: string) {
    const [person] = await tx
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!person || person.archivedAt || !roles.includes(person.role)) throw httpError(400, refusal);
    return person;
  }

  /**
   * Locks one contract by number and returns it with its display
   * names, or 404s — every mutation starts here. One query, the same
   * join the reads use; `of: contracts` locks the contract row alone,
   * because the joined taxonomy rows are only read here.
   */
  async function lockedContract(tx: Tx, number: number): Promise<ContractContext> {
    const [target] = await selectContracts(tx)
      .where(eq(contracts.number, number))
      .limit(1)
      .for("update", { of: contracts });
    if (!target) throw httpError(404, "No contract exists with this number.");
    return target;
  }

  /** `lockedContract` for the write paths that refuse a frozen record —
   * an archived contract reads as facts until it is restored. */
  async function editableContract(tx: Tx, number: number): Promise<ContractContext> {
    const current = await lockedContract(tx, number);
    if (current.row.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before editing.");
    }
    return current;
  }

  app.get(
    "/contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listContracts",
        summary:
          "The contract list, newest reference first: number, title, " +
          "type, and status; archived contracts only with includeArchived=true",
        tags: ["contracts"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: {
          200: z.object({ contracts: z.array(ContractRowSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await selectContracts(app.db)
        .where(request.query.includeArchived === "true" ? undefined : isNull(contracts.archivedAt))
        // The reference is monotonic, so newest-first is the number
        // descending — no second sort key can tie.
        .orderBy(desc(contracts.number));
      return { contracts: rows.map(toRow) };
    },
  );

  app.get(
    "/contracts/options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listContractOptions",
        summary:
          "The live contract types and statuses in display order, and " +
          "the live people the Owner and team pickers offer — the create " +
          "dialog's and the record's Member+ picker source (the settings " +
          "surfaces stay Administrator-only per SET-002)",
        tags: ["contracts"],
        response: {
          200: z.object({
            contractTypes: z.array(TypeOptionSchema),
            contractStatuses: z.array(StatusOptionSchema),
            users: z.array(UserOptionSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const [types, statuses, people] = await Promise.all([
        app.db
          .select({
            id: contractTypes.id,
            slug: contractTypes.slug,
            displayName: contractTypes.displayName,
          })
          .from(contractTypes)
          .where(isNull(contractTypes.archivedAt))
          .orderBy(asc(contractTypes.displayOrder), asc(contractTypes.createdAt)),
        app.db
          .select({
            id: contractStatuses.id,
            slug: contractStatuses.slug,
            displayName: contractStatuses.displayName,
            stage: contractStatuses.stage,
          })
          .from(contractStatuses)
          .where(isNull(contractStatuses.archivedAt))
          .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt)),
        // Everyone assignable to a team; the client narrows the Owner
        // pick to Member+, and the write guard is the real refusal.
        app.db
          .select({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
            role: users.role,
          })
          .from(users)
          .where(isNull(users.archivedAt))
          .orderBy(asc(sql`lower(${users.displayName})`)),
      ]);
      return {
        contractTypes: types,
        contractStatuses: statuses,
        users: people.map((person) => ({ ...toPerson(person), role: person.role })),
      };
    },
  );

  app.get(
    "/contracts/:number",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getContract",
        summary:
          "One contract by its CTR-003 number, with its Owner, its " +
          "signing entity, its counterparties, and its working group — " +
          "the record page's read; archived contracts answer too, so " +
          "restore stays reachable",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractRecordEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const [row] = await selectContracts(app.db)
        .where(eq(contracts.number, request.params.number))
        .limit(1);
      if (!row) throw httpError(404, "No contract exists with this number.");
      const [team, parties] = await Promise.all([
        selectTeam(app.db, row.row.id),
        selectCounterparties(app.db, row.row.id),
      ]);
      return { contract: toRow(row), team, counterparties: parties };
    },
  );

  app.post(
    "/contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createContract",
        summary:
          "Create a contract from a title and a live type; the status " +
          "starts on the protected draft seed (CTR-001) and the number " +
          "comes from the CTR-003 sequence. Everything else is set inline " +
          "on the record afterward",
        tags: ["contracts"],
        // Strict: the number is the sequence's to give, so a body
        // carrying one is refused rather than silently ignored.
        body: z.strictObject({ title: TitleSchema, contractTypeId: z.string() }),
        response: { 201: ContractEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { title, contractTypeId } = request.body;
      const created = await app.db.transaction(async (tx) => {
        // Lock the type row so a concurrent archive can't slip between
        // the check and the insert.
        const [contractType] = await tx
          .select({
            id: contractTypes.id,
            displayName: contractTypes.displayName,
            archivedAt: contractTypes.archivedAt,
          })
          .from(contractTypes)
          .where(eq(contractTypes.id, contractTypeId))
          .limit(1)
          .for("update");
        if (!contractType || contractType.archivedAt) {
          throw httpError(400, "The contract type must be a live contract type.");
        }

        // The draft seed is system-protected — no archive, no delete —
        // so it is always there to be born on. The live filter states
        // that invariant rather than assuming it: a contract must never
        // start on a status the pickers refuse to show.
        const [draft] = await tx
          .select({
            id: contractStatuses.id,
            displayName: contractStatuses.displayName,
            stage: contractStatuses.stage,
          })
          .from(contractStatuses)
          .where(
            and(eq(contractStatuses.slug, DRAFT_STATUS_SLUG), isNull(contractStatuses.archivedAt)),
          )
          .limit(1);
        if (!draft) throw httpError(500, "The draft contract status is missing.");

        const [row] = await tx
          .insert(contracts)
          .values({ title: title.trim(), contractTypeId: contractType.id, statusId: draft.id })
          .returning();
        // Provenance, written once and never again (CTR-004): who made
        // this record survives every later owner change. It is part of
        // creation, so `contract.created` records it — no separate team
        // row for something nobody chose.
        await tx.insert(contractTeam).values({
          contractId: row!.id,
          userId: request.user.id,
          role: CREATOR_ROLE,
        });
        await recordActivity(tx, {
          entityType: "contract",
          entityId: row!.id,
          actorId: request.user.id,
          action: "contract.created",
          visibility: "legal_only",
          payload: {
            number: row!.number,
            title: row!.title,
            contractType: contractType.displayName,
            status: draft.displayName,
          },
        });
        return {
          row: row!,
          contractTypeName: contractType.displayName,
          statusName: draft.displayName,
          stage: draft.stage,
          // A new contract is unassigned, which of ours signs is not
          // known yet, and nobody is recorded on the other side; all
          // three are set on the record afterwards.
          manager: null,
          entity: null,
          primaryCounterparty: null,
        };
      });
      return reply.status(201).send({ contract: toRow(created) });
    },
  );

  app.patch(
    "/contracts/:number",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContract",
        summary:
          "Commit one field of a contract in place (DES-017 per-field " +
          "commits): title, description, the Owner, the signing entity, " +
          "priority, risk, the value, or the status — any live status " +
          "may follow any other (CTR-001). The value is one field in " +
          "three parts: amount, currency, and cadence commit together " +
          "and clear together. Never on an archived contract",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          title: TitleSchema.optional(),
          description: DescriptionSchema.nullable().optional(),
          /** CTR-004's Owner. `null` clears it back to unassigned —
           * a real state (triage), not an absent field. */
          managerId: z.string().nullable().optional(),
          /** CTR-011's our side. `null` clears it back to not known,
           * which is where every contract starts. */
          entityId: z.string().nullable().optional(),
          priority: SeveritySchema.optional(),
          risk: SeveritySchema.nullable().optional(),
          /** CTR-010's value, committed as one field. `null` clears all
           * three parts — a contract that never had a value and one
           * whose value was taken off read the same, because both are
           * "no value is recorded". */
          value: ContractValueInput.nullable().optional(),
          statusId: z.string().optional(),
        }),
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const body = request.body;
      const updated = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number);
        const target = current.row;

        const patch: Partial<Contract> = {};
        /** The DD-017 changed map — old and new values per edited
         * field, feeding the M9 viewer's narration. */
        const changed: Record<string, { from: unknown; to: unknown }> = {};

        const title = body.title?.trim();
        if (title !== undefined && title !== target.title) {
          patch.title = title;
          changed.title = { from: target.title, to: title };
        }

        if (body.description !== undefined) {
          // Blank normalizes to NULL; null clears deliberately.
          const next = body.description?.trim() || null;
          if (next !== target.description) {
            patch.description = next;
            changed.description = { from: target.description, to: next };
          }
        }

        // The Owner is a person, so the audit map carries names, not
        // ids — the M9 viewer narrates "Owner changed from X to Y".
        let manager = current.manager;
        if (body.managerId !== undefined && body.managerId !== target.managerId) {
          manager =
            body.managerId === null
              ? null
              : await lockedUser(
                  tx,
                  body.managerId,
                  OWNER_ROLES,
                  "The Owner must be a live Administrator or Legal Team Member.",
                );
          patch.managerId = manager?.id ?? null;
          changed.owner = {
            from: current.manager?.displayName ?? null,
            to: manager?.displayName ?? null,
          };
        }

        // Our side of the contract (CTR-011). The picker offers live
        // entities only, so the write refuses an archived one: nothing
        // new gets signed by an entity that has left the registry. An
        // entity archived after the fact stays on the record untouched.
        let entity = current.entity;
        if (body.entityId !== undefined && body.entityId !== target.entityId) {
          if (body.entityId === null) {
            entity = null;
          } else {
            // Lock the entity row so a concurrent archive can't slip
            // between the check and the update.
            const [signatory] = await tx
              .select({
                id: entities.id,
                legalName: entities.legalName,
                archivedAt: entities.archivedAt,
              })
              .from(entities)
              .where(eq(entities.id, body.entityId))
              .limit(1)
              .for("update");
            if (!signatory || signatory.archivedAt) {
              throw httpError(400, "The signing entity must be a live entity.");
            }
            entity = { id: signatory.id, legalName: signatory.legalName };
          }
          patch.entityId = entity?.id ?? null;
          // The audit map carries legal names, not ids — the M9 viewer
          // narrates "Entity changed from X to Y".
          changed.entity = {
            from: current.entity?.legalName ?? null,
            to: entity?.legalName ?? null,
          };
        }

        if (body.priority !== undefined && body.priority !== target.priority) {
          patch.priority = body.priority;
          changed.priority = { from: target.priority, to: body.priority };
        }

        if (body.risk !== undefined && body.risk !== target.risk) {
          patch.risk = body.risk;
          changed.risk = { from: target.risk, to: body.risk };
        }

        // CTR-010's value: three columns, one field. They are written as
        // a group and compared as a group, so changing the currency
        // alone is one change to "the value", not a change to a column
        // nobody edits on its own. The audit map carries the whole trio
        // on both sides — "$120,000 /year" only reads as a change from
        // something if the something is there to read.
        if (body.value !== undefined) {
          const before = toValue(target);
          const next = body.value;
          if (!sameValue(before, next)) {
            patch.valueAmount = next?.amount ?? null;
            patch.valueCurrency = next?.currency ?? null;
            patch.valueCadence = next?.cadence ?? null;
            changed.value = { from: before, to: next };
          }
        }

        // The status keeps its own audit verb — surfaces branch on the
        // stage behind it (CTR-001) — so it rides the same UPDATE but
        // stays out of the changed map.
        let statusChange:
          { from: string; to: string; fromStage: string; toStage: string } | undefined;
        let statusName = current.statusName;
        let stage = current.stage;
        if (body.statusId !== undefined && body.statusId !== target.statusId) {
          // Lock the status row so a concurrent archive can't slip
          // between the check and the update.
          const [status] = await tx
            .select({
              id: contractStatuses.id,
              displayName: contractStatuses.displayName,
              stage: contractStatuses.stage,
              archivedAt: contractStatuses.archivedAt,
            })
            .from(contractStatuses)
            .where(eq(contractStatuses.id, body.statusId))
            .limit(1)
            .for("update");
          if (!status || status.archivedAt) {
            throw httpError(400, "The status must be a live contract status.");
          }
          patch.statusId = status.id;
          statusChange = {
            from: current.statusName,
            to: status.displayName,
            fromStage: current.stage,
            toStage: status.stage,
          };
          statusName = status.displayName;
          stage = status.stage;
        }

        // Nothing changed: answer with the row and write no misleading
        // from==to audit entry.
        if (Object.keys(patch).length === 0) return current;

        const [row] = await tx
          .update(contracts)
          .set(patch)
          .where(eq(contracts.id, target.id))
          .returning();
        if (Object.keys(changed).length > 0) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: "contract.updated",
            visibility: "legal_only",
            payload: { number: row!.number, title: row!.title, changed },
          });
        }
        if (statusChange) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: "contract.status_changed",
            visibility: "legal_only",
            payload: { number: row!.number, title: row!.title, ...statusChange },
          });
        }
        return {
          row: row!,
          contractTypeName: current.contractTypeName,
          statusName,
          stage,
          manager,
          entity,
          // No field of this PATCH touches the other side — the
          // counterparties have their own routes.
          primaryCounterparty: current.primaryCounterparty,
        };
      });
      return { contract: toRow(updated) };
    },
  );

  app.post(
    "/contracts/:number/team",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractTeamMember",
        summary:
          "Put a person on the contract team under a role (CTR-004). The " +
          "key is contract + person + role, so the same person may hold " +
          "two roles; the `creator` role is the server's to write",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          userId: z.string(),
          role: z.enum(CONTRACT_TEAM_ROLES),
        }),
        response: { 201: TeamEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { userId, role } = request.body;
      const team = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number);
        if (role === CREATOR_ROLE) {
          throw httpError(400, "The creator is recorded when the contract is created.");
        }
        // Anyone live may join a team — external counsel participate as
        // `contributor` (MTR-006), and a Business User can be a watcher.
        const person = await lockedUser(tx, userId, USER_ROLES, "That is not a person we can add.");

        // The compound key is the check: an insert that conflicts wrote
        // nothing, so an empty return is "they already hold that role" —
        // one statement, and two concurrent adds cannot both land.
        const inserted = await tx
          .insert(contractTeam)
          .values({ contractId: current.row.id, userId: person.id, role })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) throw httpError(409, "This person already holds that role.");
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.team_added",
          visibility: "legal_only",
          payload: {
            number: current.row.number,
            title: current.row.title,
            member: person.displayName,
            role,
          },
        });
        return selectTeam(tx, current.row.id);
      });
      return reply.status(201).send({ team });
    },
  );

  app.delete(
    "/contracts/:number/team/:userId/:role",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractTeamMember",
        summary:
          "Take one role off the contract team (CTR-004). The role is " +
          "part of the address, so dropping a watcher leaves that same " +
          "person's member row standing; `creator` is provenance and stays",
        tags: ["contracts"],
        params: NumberParams.extend({
          userId: z.string(),
          role: z.enum(CONTRACT_TEAM_ROLES),
        }),
        response: { 200: TeamEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { userId, role } = request.params;
      const team = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number);
        if (role === CREATOR_ROLE) {
          throw httpError(409, "The creator stays on the record — it is who made it.");
        }
        const [removed] = await tx
          .delete(contractTeam)
          .where(
            and(
              eq(contractTeam.contractId, current.row.id),
              eq(contractTeam.userId, userId),
              eq(contractTeam.role, role),
            ),
          )
          .returning();
        if (!removed) throw httpError(404, "Nobody holds that role on this contract.");

        const [person] = await tx
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.team_removed",
          visibility: "legal_only",
          payload: {
            number: current.row.number,
            title: current.row.title,
            member: person?.displayName ?? userId,
            role,
          },
        });
        return selectTeam(tx, current.row.id);
      });
      return { team };
    },
  );

  app.post(
    "/contracts/:number/counterparties",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractCounterparty",
        summary:
          "Put a counterparty on the contract (CTR-011) — either one we " +
          "already hold, by id, or an unknown name, which is created " +
          "with just that name in the same transaction. A name we " +
          "already hold is reused, never duplicated. The first party on " +
          "a contract becomes its primary",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z
          .strictObject({
            counterpartyId: z.string().optional(),
            /** CTR-011's inline creation: a name and nothing else. */
            name: CounterpartyNameSchema.optional(),
          })
          // One or the other. Both together is a client that has not
          // decided whether it is picking or creating, and neither is a
          // request with no counterparty in it.
          .refine(
            (body) => (body.counterpartyId === undefined) !== (body.name === undefined),
            "Name a counterparty by id or by name, not both.",
          ),
        response: { 201: CounterpartiesEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { counterpartyId, name } = request.body;
      const result = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number);

        let party: JoinedCounterparty;
        let born = false;
        if (counterpartyId !== undefined) {
          // Lock the counterparty row so a concurrent archive cannot
          // slip between the check and the insert.
          const [existing] = await tx
            .select({
              id: counterparties.id,
              name: counterparties.name,
              archivedAt: counterparties.archivedAt,
            })
            .from(counterparties)
            .where(eq(counterparties.id, counterpartyId))
            .limit(1)
            .for("update");
          if (!existing || existing.archivedAt) {
            throw httpError(400, "The counterparty must be a live counterparty.");
          }
          party = { id: existing.id, name: existing.name };
        } else {
          const found = await findOrCreateCounterparty(tx, name!);
          party = found.party;
          born = found.born;
        }

        // Under the contract row's lock, so this read and the insert
        // that follows are one decision: two Legal Team Members adding
        // the first party at once cannot both see an empty contract.
        const held = await tx
          .select({
            counterpartyId: contractCounterparties.counterpartyId,
          })
          .from(contractCounterparties)
          .where(eq(contractCounterparties.contractId, current.row.id));
        if (held.some((row) => row.counterpartyId === party.id)) {
          throw httpError(409, "That counterparty is already on this contract.");
        }

        // CTR-011's invariant, in its simplest half: the first party on
        // a contract is its primary, because a contract with parties
        // and no primary is a contract no list can draw.
        const isPrimary = held.length === 0;
        await tx.insert(contractCounterparties).values({
          contractId: current.row.id,
          counterpartyId: party.id,
          isPrimary,
        });
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.counterparty_added",
          visibility: "legal_only",
          payload: {
            number: current.row.number,
            title: current.row.title,
            counterparty: party.name,
            isPrimary,
            // Whether the organization itself was born here — the M9
            // viewer says "added Helix Labs GmbH (new)" only for this.
            created: born,
          },
        });
        return counterpartiesEnvelope(tx, current);
      });
      return reply.status(201).send(result);
    },
  );

  app.delete(
    "/contracts/:number/counterparties/:counterpartyId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractCounterparty",
        summary:
          "Take a counterparty off the contract (CTR-011). Removing the " +
          "primary passes the flag to the party who joined next, so a " +
          "contract with counterparties always has one; the counterparty " +
          "record itself is untouched and stays on its other contracts",
        tags: ["contracts"],
        params: NumberParams.extend({ counterpartyId: z.string() }),
        response: { 200: CounterpartiesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { counterpartyId } = request.params;
      const result = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number);
        const [removed] = await tx
          .delete(contractCounterparties)
          .where(
            and(
              eq(contractCounterparties.contractId, current.row.id),
              eq(contractCounterparties.counterpartyId, counterpartyId),
            ),
          )
          .returning();
        if (!removed) throw httpError(404, "That counterparty is not on this contract.");

        const [party] = await tx
          .select({ name: counterparties.name })
          .from(counterparties)
          .where(eq(counterparties.id, counterpartyId))
          .limit(1);
        const removedName = party?.name ?? counterpartyId;

        // The other half of CTR-011's invariant: the primary leaving
        // must hand the flag on, never drop it. The party who joined
        // next takes it — the record's own order, not an arbitrary one.
        // The last party out takes the flag with them, which is the one
        // state with no primary and no parties either.
        let promotedName: string | undefined;
        if (removed.isPrimary) {
          const [next] = await tx
            .select({ id: counterparties.id, name: counterparties.name })
            .from(contractCounterparties)
            .innerJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id))
            .where(eq(contractCounterparties.contractId, current.row.id))
            .orderBy(asc(contractCounterparties.createdAt), asc(sql`lower(${counterparties.name})`))
            .limit(1);
          if (next) {
            await promotePrimary(tx, current.row.id, next.id);
            promotedName = next.name;
          }
        }

        const audit = { number: current.row.number, title: current.row.title };
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.counterparty_removed",
          visibility: "legal_only",
          payload: { ...audit, counterparty: removedName, wasPrimary: removed.isPrimary },
        });
        // The promotion is its own entry: nobody asked for it, so the
        // log has to say it happened rather than leave it implied by a
        // removal two lines above.
        if (promotedName !== undefined) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: current.row.id,
            actorId: request.user.id,
            action: "contract.counterparty_primary_changed",
            visibility: "legal_only",
            payload: { ...audit, from: removedName, to: promotedName },
          });
        }
        return counterpartiesEnvelope(tx, current);
      });
      return result;
    },
  );

  app.post(
    "/contracts/:number/counterparties/:counterpartyId/primary",
    {
      preHandler: requireMember,
      schema: {
        operationId: "setPrimaryContractCounterparty",
        summary:
          "Name which counterparty the contract is listed under " +
          "(CTR-011). There is no route to clear the flag: the primary " +
          "moves to another party or it stays where it is",
        tags: ["contracts"],
        params: NumberParams.extend({ counterpartyId: z.string() }),
        response: { 200: CounterpartiesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { counterpartyId } = request.params;
      const result = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number);
        const [target] = await tx
          .select({
            id: counterparties.id,
            name: counterparties.name,
            isPrimary: contractCounterparties.isPrimary,
          })
          .from(contractCounterparties)
          .innerJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id))
          .where(
            and(
              eq(contractCounterparties.contractId, current.row.id),
              eq(contractCounterparties.counterpartyId, counterpartyId),
            ),
          )
          .limit(1);
        if (!target) throw httpError(404, "That counterparty is not on this contract.");
        if (target.isPrimary) throw httpError(409, "That counterparty is already the primary.");

        await promotePrimary(tx, current.row.id, target.id);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.counterparty_primary_changed",
          visibility: "legal_only",
          payload: {
            number: current.row.number,
            title: current.row.title,
            from: current.primaryCounterparty?.name ?? null,
            to: target.name,
          },
        });
        return counterpartiesEnvelope(tx, current);
      });
      return result;
    },
  );

  app.post(
    "/contracts/:number/archive",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveContract",
        summary:
          "Archive a contract (soft delete, for mistakes and imports — " +
          "not the same as ending it): it leaves the default list and " +
          "freezes; nothing is deleted, and restore is the way back",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const archived = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number);
        if (current.row.archivedAt) throw httpError(409, "This contract is already archived.");

        const [row] = await tx
          .update(contracts)
          .set({ archivedAt: new Date() })
          .where(eq(contracts.id, current.row.id))
          .returning();
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.archived",
          visibility: "legal_only",
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      return { contract: toRow(archived) };
    },
  );

  app.post(
    "/contracts/:number/restore",
    {
      preHandler: requireMember,
      schema: {
        operationId: "restoreContract",
        summary:
          "Restore an archived contract (archive's recovery story): it " +
          "rejoins the list and becomes editable again",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const restored = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number);
        if (!current.row.archivedAt) throw httpError(409, "This contract is not archived.");

        const [row] = await tx
          .update(contracts)
          .set({ archivedAt: null })
          .where(eq(contracts.id, current.row.id))
          .returning();
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.restored",
          visibility: "legal_only",
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      return { contract: toRow(restored) };
    },
  );
};
