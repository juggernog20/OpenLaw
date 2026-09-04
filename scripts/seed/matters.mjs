/* Matters: the legal work whose deliverable is not a signed document
 * (DD-018, MTR-001 onward).
 *
 * A Matter reviews well or badly on the strength of what hangs off it:
 * a manager, a deadline that is either near or past, a task list part
 * done, a thread with somebody waiting on an answer. So most of this
 * file is about the children rather than the record.
 *
 * A slice of the Matters are started from a Template (MTR-009), which is
 * the only way to see a record that arrives with its tasks and key dates
 * already on it.
 */

import { pool } from "./client.mjs";
import { ALL_COUNTERPARTIES } from "./data.mjs";
import { EMPLOYEE_NAMES, MATTER_KEY_DATES, MATTER_KINDS, MATTER_TASKS } from "./catalog.mjs";
import { customFields } from "./custom-fields.mjs";
import { contributors, memberPlus } from "./people.mjs";
import { COMMENT_LINES, matterNote } from "./prose.mjs";
import { postComment, uploadDocument } from "./uploads.mjs";
import { daysFromToday } from "./time.mjs";

/** How often each kind of Matter turns up. */
const KIND_WEIGHTS = {
  commercial: 16,
  privacy: 14,
  employment: 13,
  corporate: 12,
  advisory: 10,
  ip: 9,
  regulatory: 8,
  litigation: 7,
  product_counsel: 7,
  ma: 4,
};

const MATTER_BACKGROUND = [
  "The business asked for a view before committing to anything. Nothing has been signed and no money has moved.",
  "This came in through the portal and was converted after a call with the requester. The papers they attached are on the record.",
  "External counsel have been instructed on the local law point only. Everything else stays in house.",
  "The counterparty has been slow to respond. We have set a date by which we will escalate.",
  "This follows on from an earlier piece of work on the same subject; the related matter is linked.",
  "The facts are agreed. What is not agreed is whether the clause covers this situation.",
];

export function planMatters(context) {
  const { random, scale } = context;
  const weighted = MATTER_KINDS.map((kind) => [kind, KIND_WEIGHTS[kind.typeSlug] ?? 5]);
  const plans = [];

  for (let index = 0; index < scale.matters; index++) {
    const kind = random.weighted(weighted);
    const counterparty = random.pick(ALL_COUNTERPARTIES);
    const title = random
      .pick(kind.titles)
      .replace("{cp}", counterparty)
      .replace("{person}", random.pick(EMPLOYEE_NAMES));

    plans.push({
      kind,
      title,
      category: random.weighted([
        ["open", 7],
        ["closed", 3],
      ]),
      priority: random.weighted([
        ["low", 3],
        ["medium", 8],
        ["high", 4],
        ["critical", 1],
      ]),
      risk: random.weighted([
        ["low", 5],
        ["medium", 6],
        ["high", 3],
        ["critical", 1],
        [null, 2],
      ]),
      description: random.pick(MATTER_BACKGROUND),
      isConfidential: random.chance(0.09),
      fromTemplate: random.chance(0.18),
      hasTasks: random.chance(0.6),
      hasKeyDates: random.chance(0.5),
      hasDocuments: random.chance(0.55),
      hasComments: random.chance(0.6),
      archived: random.chance(0.04),
    });
  }
  return plans;
}

function statusFor(category, taxonomy, random) {
  const candidates = taxonomy.matterStatuses.rows.filter(
    (status) => status.category === category && !status.archivedAt,
  );
  return random.pick(candidates) ?? taxonomy.matterStatuses.rows[0];
}

function customFieldsFor(plan, fields, attached, random) {
  const collector = customFields(fields, attached, "matter", plan.kind.typeSlug);
  const set = (name, value) => collector.set(name, value);
  set(
    "Business unit",
    random.pick(["Platform", "Analytics", "Sales", "People", "Finance", "Group"]),
  );
  set(
    "External counsel",
    random.chance(0.5)
      ? random.pick(["Meyer and Roth LLP", "Ashworth Bell Solicitors", "Whitcombe Employment Law"])
      : null,
  );
  if (random.chance(0.4)) set("Budget approved", random.int(5, 180) * 1000);
  // Required on regulatory matters, so it always has to be answered there.
  if (["regulatory", "privacy"].includes(plan.kind.typeSlug)) {
    set(
      "Regulator",
      random.pick(["ICO", "CNIL", "Datatilsynet", "FTC", "EU Commission", "Not applicable"]),
    );
  }
  set("Region", random.pick(["EMEA", "Americas", "APAC"]));
  return collector.values;
}

export async function seedMatters(admin, context, log) {
  const { random, taxonomy, people, fields, attached, templates, plans } = context;
  const staff = memberPlus(people);
  const helpers = contributors(people);
  const matters = [];

  await pool(plans, 4, async (plan, index) => {
    const manager = random.pick(staff);
    const author = manager.session;
    const type = taxonomy.matterTypes.bySlug.get(plan.kind.typeSlug);
    if (!type) return;

    // A templated Matter takes the Template's type, priority and risk, so
    // only the ones whose type matches are started that way.
    const template = plan.fromTemplate
      ? random.pick(templates.filter((row) => row.matterTypeId === type.id))
      : null;

    const { body: made } = await author.post("/api/v1/matters", {
      title: plan.title,
      matterTypeId: type.id,
      managerId: manager.id,
      priority: plan.priority,
      risk: plan.risk,
      description: plan.description,
      customFields: customFieldsFor(plan, fields, attached, random),
      isConfidential: plan.isConfidential,
      ...(template ? { templateId: template.id } : {}),
    });
    const matter = made.matter;
    const at = `/api/v1/matters/${matter.number}`;

    await author.patch(at, { statusId: statusFor(plan.category, taxonomy, random).id });

    // A task can only be assigned to somebody on the Matter (MTR-005), so
    // the team is remembered as it is built and the assignees come from it.
    const team = [manager];
    for (const member of random.sample(
      staff.filter((person) => person.id !== manager.id),
      random.int(1, 3),
    )) {
      const role = random.weighted([
        ["member", 4],
        ["watcher", 2],
      ]);
      await author.post(`${at}/team`, { userId: member.id, role });
      team.push(member);
    }
    if (random.chance(0.2) && helpers.length > 0) {
      const helper = random.pick(helpers);
      await author.post(`${at}/team`, { userId: helper.id, role: "contributor" });
      team.push(helper);
    }

    matters.push({ ...matter, plan, manager, author, at, team, templated: Boolean(template) });
    if ((index + 1) % 20 === 0) log(`  ${index + 1} of ${plans.length} matters created`);
  });
  log(
    `${matters.length} matters created (${matters.filter((m) => m.templated).length} from templates)`,
  );

  let tasks = 0;
  let keyDates = 0;
  let documents = 0;
  let comments = 0;
  await pool(matters, 4, async (matter) => {
    const { plan, author, at } = matter;

    if (plan.hasTasks) {
      for (const title of random.sample(MATTER_TASKS, random.int(1, 4))) {
        const { body } = await author.post(`${at}/tasks`, {
          title,
          assigneeId: random.chance(0.7) ? random.pick(matter.team).id : null,
          dueDate: random.chance(0.8) ? daysFromToday(random.int(-21, 45)) : null,
        });
        tasks += 1;
        const made = (body.tasks ?? []).find((task) => task.title === title);
        if (made && random.chance(0.45))
          await author.post(`/api/v1/matter-tasks/${made.id}/toggle`);
      }
    }
    // A closed matter with open tasks reads as a mistake, so tick the
    // template's tasks off on the ones that are done.
    if (plan.category === "closed" && matter.templated) {
      const { body } = await author.get(`${at}/tasks`);
      for (const task of body.tasks ?? []) {
        if (!task.isDone) await author.post(`/api/v1/matter-tasks/${task.id}/toggle`);
      }
    }

    if (plan.hasKeyDates) {
      for (const label of random.sample(MATTER_KEY_DATES, random.int(1, 2))) {
        await author.post(`${at}/key-dates`, {
          label,
          date: daysFromToday(random.int(-15, 120)),
          note: random.chance(0.35) ? "Confirmed with the business sponsor." : null,
        });
        keyDates += 1;
      }
    }

    if (plan.hasDocuments) {
      const note = matterNote(`Advice note - ${matter.title}`, matter.manager.displayName, [
        plan.description,
        "",
        "Analysis",
        "",
        "The position turns on the wording of the clause rather than on the facts, which are not in dispute. On the better view, the obligation is qualified by reasonableness, and a court would read it that way.",
        "",
        "There is a second question about which entity is on the hook. The contracting company is the one named on the signature page, and that is the one to deal with.",
      ]);
      await uploadDocument(author, `${at}/documents`, note, {
        format: random.chance(0.3) ? "docx" : "pdf",
        folderPath: random.chance(0.4) ? "Advice" : undefined,
      });
      documents += 1;
      if (random.chance(0.35)) {
        await uploadDocument(
          author,
          `${at}/documents`,
          matterNote(`Background pack - ${matter.title}`, matter.manager.displayName, [
            "The documents the business sent through, collected into one pack.",
            "",
            "Nothing here is privileged. It can be shared with the counterparty if that becomes useful.",
          ]),
          { folderPath: "Background", format: random.chance(0.4) ? "txt" : "pdf" },
        );
        documents += 1;
      }
    }

    if (plan.hasComments) {
      // Member+ only: a Contributor on the team cannot post to the
      // legal-only tier, and most of what gets said here is legal-only.
      const speakers = random.sample(
        matter.team.filter((person) => person.role !== "contributor"),
        random.int(1, 3),
      );
      for (const speaker of speakers) {
        const visibility = random.weighted([
          ["working_team", 5],
          ["legal_only", 4],
          ["full_thread", 1],
        ]);
        await postComment(speaker.session, {
          entityType: "matter",
          entityId: matter.id,
          body: random.pick(COMMENT_LINES[visibility]),
          visibility,
          mentions: [],
        });
        comments += 1;
      }
    }
  });
  log(`${tasks} matter tasks, ${keyDates} key dates, ${documents} documents, ${comments} comments`);

  // Related work and the odd sub-matter, so the relations panel and the
  // parent chain both have something to draw.
  // Same reach rule as the contracts: link only what everybody can see.
  const open = matters.filter((matter) => !matter.plan.isConfidential);
  let relations = 0;
  for (const matter of random.sample(open, Math.min(20, open.length))) {
    const other = random.pick(open.filter((row) => row.number !== matter.number));
    if (!other) continue;
    const { status } = await matter.author.request("POST", `${matter.at}/relations`, {
      json: { relatedMatterNumber: other.number },
      expect: [200, 201, 404, 409, 422],
    });
    if (status < 300) relations += 1;
  }
  let children = 0;
  for (const matter of random.sample(open, Math.min(10, open.length))) {
    const parent = random.pick(open.filter((row) => row.number !== matter.number));
    if (!parent) continue;
    const { status } = await matter.author.request("PUT", `${matter.at}/parent`, {
      json: { parentMatterNumber: parent.number },
      expect: [200, 204, 404, 409, 422],
    });
    if (status < 300) children += 1;
  }
  log(`${relations} matter relations, ${children} sub-matters`);

  let archived = 0;
  for (const matter of matters.filter((row) => row.plan.archived)) {
    await matter.author.request("POST", `${matter.at}/archive`, { expect: [200, 204, 409] });
    archived += 1;
  }
  log(`${archived} matters archived`);

  return matters;
}
