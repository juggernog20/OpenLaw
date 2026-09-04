/* The group structure: our own companies, and the paper that goes with
 * them (DD-008, ENT-001 to ENT-004).
 *
 * An Entity is only interesting when it carries its children: the
 * jurisdictions it is registered in, the people on the board, who owns
 * it, and what it has to file next. So the seed writes all four, and
 * spreads the filing dates so the calendar has something overdue,
 * something this week, and something next quarter.
 */

import { pool } from "./client.mjs";
import { ENTITIES, OFFICER_NAMES } from "./data.mjs";
import { ENTITY_OBLIGATIONS } from "./catalog.mjs";
import { entityDocument } from "./prose.mjs";
import { uploadDocument } from "./uploads.mjs";
import { customFields } from "./custom-fields.mjs";
import { memberPlus } from "./people.mjs";
import { daysFromToday } from "./time.mjs";

/** The folders every Entity files its paper into (DOC-006). */
const ENTITY_FOLDERS = ["Formation", "Board", "Filings"];

function registrationsFor(entity, random) {
  const registrations = [
    {
      jurisdiction: entity.jurisdiction,
      registrationNumber: entity.registrationNumber,
      registeredAgent: entity.registeredAgent,
      status: entity.status === "dissolved" ? "withdrawn" : "active",
    },
  ];
  // A few companies are also qualified somewhere else, which is what
  // makes the registrations panel worth more than one row.
  if (random.chance(0.35)) {
    registrations.push({
      jurisdiction: random.pick([
        "State of New York",
        "State of California",
        "Scotland",
        "Bavaria, Germany",
        "Catalonia, Spain",
        "Queensland, Australia",
      ]),
      registrationNumber: `FQ-${random.int(100000, 999999)}`,
      registeredAgent: random.pick([
        "Registered Agents Inc.",
        "Corporation Service Company",
        "Blueprint Corporate Services",
      ]),
      status: random.weighted([
        ["active", 6],
        ["lapsed", 2],
        ["withdrawn", 1],
      ]),
    });
  }
  return registrations;
}

function officersFor(entity, random, officerRoles, people) {
  const roles = officerRoles.rows.filter((role) => !role.archivedAt);
  const count = entity.status === "dormant" ? 2 : random.int(2, 4);
  const names = random.sample(OFFICER_NAMES, count);
  return names.map((name, index) => {
    // The first officer of each company is a director appointed at
    // formation; the rest joined later and one in six has resigned.
    const appointedOn = index === 0 ? entity.formedOn : daysFromToday(-random.int(200, 2200));
    const resigned = index > 0 && random.chance(0.18);
    // Some officers are people who also use OpenLaw; most are not
    // (ENT-001), which is the distinction the panel has to draw.
    const linked = random.chance(0.25) ? people.get(name) : null;
    return {
      name,
      officerRoleId: (random.pick(roles) ?? roles[0]).id,
      appointedOn,
      resignedOn: resigned ? daysFromToday(-random.int(10, 180)) : null,
      userId: linked?.id ?? null,
    };
  });
}

function obligationsFor(entity, random, people) {
  if (entity.status === "dissolved") return [];
  const chosen = random.sample(
    ENTITY_OBLIGATIONS,
    entity.status === "dormant" ? 2 : random.int(3, 5),
  );
  return chosen.map((obligation, index) => ({
    label: obligation.label,
    recurrenceMonths: obligation.recurrenceMonths,
    // One in six is already late, so the overdue treatment is on screen.
    nextDueOn:
      index === 0 && random.chance(0.3)
        ? daysFromToday(-random.int(3, 40))
        : daysFromToday(random.int(4, 320)),
    assigneeId: random.pick(people).id,
    note: random.chance(0.4) ? "Prepared by the local agent; legal reviews before filing." : null,
  }));
}

/**
 * Writes the whole group.
 *
 * Entities are created first and holdings second, because a Holding
 * names two Entities and both have to exist.
 */
export async function seedEntities(admin, context, log) {
  const { random, taxonomy, people, fields, attached } = context;
  const staff = memberPlus(people);
  const officerCandidates = new Map([...people].map(([name, person]) => [name, person]));

  const created = new Map();
  for (const definition of ENTITIES) {
    const type = taxonomy.entityTypes.bySlug.get(definition.type);
    const { body } = await admin.post("/api/v1/entities", {
      legalName: definition.legalName,
      entityTypeId: type.id,
      jurisdiction: definition.jurisdiction,
      formedOn: definition.formedOn,
      registrationNumber: definition.registrationNumber,
      taxId: `TAX-${random.int(1000000, 9999999)}`,
      registeredAgent: definition.registeredAgent,
      registeredAddress: definition.registeredAddress,
      status: definition.status,
    });
    created.set(definition.legalName, { ...body.entity, definition });
  }
  log(`${created.size} entities`);

  // The custom Fields the team attached to Entity Types, filled in.
  const yearEnds = ["31 December", "31 March", "30 June", "30 September"];
  await pool([...created.values()], 4, async (entity) => {
    const values = customFields(fields, attached, "entity", entity.definition.type);
    values.set("Financial year end", random.pick(yearEnds));
    values.set(
      "Statutory audit required",
      entity.definition.status === "active" && random.chance(0.5),
    );
    values.set(
      "Local counsel",
      random.pick([
        "Meyer and Roth LLP",
        "Ashworth Bell Solicitors",
        "Da Silva e Associados",
        "Ferrand Avocats AARPI",
        "Kestrel Tax Advisers LLP",
      ]),
    );
    values.set(
      "Region",
      entity.definition.jurisdiction.includes("United States") ||
        entity.definition.jurisdiction.includes("Canada") ||
        entity.definition.jurisdiction.includes("Brazil") ||
        entity.definition.jurisdiction.includes("Mexico")
        ? "Americas"
        : /Australia|Singapore|India|Japan|Korea|New Zealand/.test(entity.definition.jurisdiction)
          ? "APAC"
          : "EMEA",
    );

    await admin.patch(`/api/v1/entities/${entity.id}`, {
      customFields: values.values,
      ...(entity.definition.sharesAuthorized
        ? {
            sharesAuthorized: entity.definition.sharesAuthorized,
            sharesIssued: entity.definition.sharesIssued,
            parValue: 1,
          }
        : {}),
      // A couple of the holding companies hold sensitive structure, which
      // is what the confidential treatment is for (DD-016).
      ...(entity.definition.legalName.includes("Ventures") ||
      entity.definition.legalName.includes("Nimbus")
        ? { isConfidential: true }
        : {}),
    });
  });

  // Ownership. Recorded on the owned company, naming its owner, which is
  // the direction the group chart is read in.
  let holdings = 0;
  for (const entity of created.values()) {
    const owner = entity.definition.owner;
    if (!owner) continue;
    const parent = created.get(owner.of);
    if (!parent) continue;
    await admin.post(`/api/v1/entities/${entity.id}/holdings`, {
      direction: "owner",
      relatedEntityId: parent.id,
      ownershipPercent: owner.percent,
    });
    holdings += 1;
  }
  log(`${holdings} holdings recorded`);

  let registrations = 0;
  let officers = 0;
  let obligations = 0;
  await pool([...created.values()], 3, async (entity) => {
    for (const registration of registrationsFor(entity.definition, random)) {
      await admin.post(`/api/v1/entities/${entity.id}/registrations`, registration);
      registrations += 1;
    }
    for (const officer of officersFor(
      entity.definition,
      random,
      taxonomy.officerRoles,
      officerCandidates,
    )) {
      await admin.post(`/api/v1/entities/${entity.id}/officers`, officer);
      officers += 1;
    }
    for (const obligation of obligationsFor(entity.definition, random, staff)) {
      const { body } = await admin.post(`/api/v1/entities/${entity.id}/obligations`, obligation);
      obligations += 1;
      // A recurring obligation that has been filed once shows the panel's
      // other half: the last filing, and the next date it rolled to.
      if (random.chance(0.4) && body.obligation) {
        await admin.post(`/api/v1/entities/${entity.id}/obligations/${body.obligation.id}/file`, {
          filedOn: daysFromToday(-random.int(5, 90)),
        });
      }
    }
  });
  log(`${registrations} registrations, ${officers} officers, ${obligations} obligations`);

  // Statutory paper, filed into folders.
  let documents = 0;
  await pool([...created.values()].slice(0, 18), 3, async (entity) => {
    const folders = new Map();
    for (const name of ENTITY_FOLDERS) {
      const { body } = await admin.post(`/api/v1/entities/${entity.id}/folders`, { name });
      const folder = (body.folders ?? []).find((row) => row.name === name);
      if (folder) folders.set(name, folder.id);
    }

    const papers = [
      {
        folder: "Formation",
        document: entityDocument("Certificate of incorporation", entity.definition, [
          `This certifies that ${entity.definition.legalName} was incorporated on ${entity.definition.formedOn}.`,
          "",
          "Issued by the registrar of companies. A certified copy is held by the registered agent.",
        ]),
      },
      {
        folder: "Formation",
        document: entityDocument("Articles of association", entity.definition, [
          "1. The name of the company is set out above.",
          "2. The company's objects are unrestricted.",
          "3. The liability of the members is limited.",
          "4. The directors may issue shares of any class within the authorised limit.",
          "5. A quorum for a board meeting is two directors.",
        ]),
      },
      {
        folder: "Board",
        document: entityDocument("Board minutes - annual general meeting", entity.definition, [
          "Present: the directors recorded on the officers panel.",
          "",
          "1. The accounts for the year were approved.",
          "2. The auditors were reappointed.",
          "3. The directors confirmed no conflicts to declare.",
          "",
          "There being no further business, the meeting closed.",
        ]),
      },
    ];
    if (random.chance(0.5)) {
      papers.push({
        folder: "Filings",
        document: entityDocument("Annual return - filed copy", entity.definition, [
          "The annual return was filed with the registrar on the date stamped below.",
          "",
          "No changes to the registered office or the share capital were reported.",
        ]),
      });
    }

    for (const paper of papers) {
      await uploadDocument(admin, `/api/v1/entities/${entity.id}/documents`, paper.document, {
        folderId: folders.get(paper.folder),
        format: random.chance(0.25) ? "docx" : "pdf",
      });
      documents += 1;
    }
  });
  log(`${documents} entity documents`);

  // The two confidential companies are reachable by the Administrators
  // and by whoever was let in by name (ENT-005, DD-016). Granting a
  // couple of Legal Team Members is what puts the grant panel in a state
  // worth looking at, and what makes the confidential rule visible: a
  // member who is not on the list cannot see them at all.
  const grantees = memberPlus(people).filter(
    (person) => person.role === "legal_team_member" && !person.archived,
  );
  let grants = 0;
  for (const name of ["Helix Ventures LLC", "Nimbus Metrics, Inc."]) {
    const entity = created.get(name);
    if (!entity) continue;
    for (const person of random.sample(grantees, 2)) {
      const { status } = await admin.request("POST", `/api/v1/entities/${entity.id}/grants`, {
        json: { userId: person.id },
        expect: [200, 201, 400, 409],
      });
      if (status < 300) grants += 1;
    }
  }
  log(`${grants} entity grants on the confidential companies`);

  // One archived company, so the list's archived filter has something.
  const dissolved = created.get("Helix Software Portugal, Unipessoal Lda");
  if (dissolved) {
    await admin.post(`/api/v1/entities/${dissolved.id}/archive`);
    log("  Helix Software Portugal archived");
  }

  return created;
}
