// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Saved list views (DD-019) at the HTTP seam through the real-Postgres
 * harness.
 *
 * Four subjects, in the order they matter.
 *
 * Privacy first. A view is one person's (DD-019 clause 1), and the seam
 * holds that by answering 404 for somebody else's view id, with the same
 * body as an id that was never issued, never a 403. A named test asserts
 * the refusal cannot be told apart from absence, because a 403 here
 * would confirm that a view exists and who has one.
 *
 * The default is exclusive. At most one view per person per surface
 * opens the list. The partial unique index behind it makes a second one
 * a constraint violation rather than a row that quietly wins. The tests
 * drive the flag through create, patch, re-point, and delete.
 *
 * Names are unique per person, case-insensitively, and two people may
 * both have a "My contracts".
 *
 * The config is held, not interpreted. A view naming a column this build
 * does not draw is stored and returned intact. DD-019 clause 7 makes
 * reading past it the page's job, so a seam that rejected it would make
 * an unshippable view out of a droppable column.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { MAX_LIST_VIEWS_PER_SURFACE } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "views-member@example.com",
  displayName: "Vera Counsel",
  password: "correct-horse-battery",
} as const;
const OTHER = {
  email: "views-other@example.com",
  displayName: "Otto Other",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "views-business@example.com",
  displayName: "Bea Business",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let otherCookies: Record<string, string>;
let businessCookies: Record<string, string>;

interface View {
  id: string;
  surface: string;
  name: string;
  isDefault: boolean;
  config: {
    columns: { key: string; width: number | null }[];
    sort: { key: string; dir: string } | null;
    filters: Record<string, boolean | string>;
  };
}

/** A minimal well-formed config. The seam bounds this shape and reads
 * nothing out of it. */
const CONFIG = {
  columns: [
    { key: "reference", width: 96 },
    { key: "title", width: null },
    { key: "status", width: 160 },
  ],
  sort: { key: "expiryDate", dir: "asc" },
  filters: { includeEnded: true, includeArchived: false },
} as const;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const other = await provisionUser(harness.app.auth, OTHER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, other.id));
  otherCookies = await signInCookies(harness.app, OTHER.email, OTHER.password);

  const business = await provisionUser(harness.app.auth, BUSINESS);
  await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, business.id));
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);
});

afterAll(async () => {
  await harness.stop();
});

const createRaw = (payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "POST", url: "/api/v1/list-views", cookies, payload });

async function create(payload: Record<string, unknown>, cookies = memberCookies): Promise<View[]> {
  const res = await createRaw(payload, cookies);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().views as View[];
}

async function read(cookies = memberCookies, surface = "contracts"): Promise<View[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/list-views?surface=${surface}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().views as View[];
}

const patchRaw = (viewId: string, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "PATCH", url: `/api/v1/list-views/${viewId}`, cookies, payload });

const deleteRaw = (viewId: string, cookies = memberCookies) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/list-views/${viewId}`, cookies });

/** Clear this person's views, so each block starts from nothing. */
async function reset(cookies = memberCookies) {
  for (const view of await read(cookies)) {
    const res = await deleteRaw(view.id, cookies);
    expect(res.statusCode, res.body).toBe(200);
  }
}

describe("saving and reading a view", () => {
  it("persists the Matters surface independently", async () => {
    const views = await create({ surface: "matters", name: "My matters", config: CONFIG });
    expect(views).toHaveLength(1);
    expect(views[0]!.surface).toBe("matters");
    expect((await read(memberCookies, "matters")).map((view) => view.name)).toEqual(["My matters"]);
  });

  it("saves a named view and answers the whole list back", async () => {
    await reset();
    const views = await create({ surface: "contracts", name: "Renewals", config: CONFIG });
    expect(views).toHaveLength(1);
    expect(views[0]!.name).toBe("Renewals");
    expect(views[0]!.isDefault).toBe(false);
    expect(views[0]!.config).toEqual(CONFIG);
  });

  it("orders the list by name, folding case, the way the menu draws it", async () => {
    await reset();
    for (const name of ["zeta", "Alpha", "middle"]) {
      await create({ surface: "contracts", name, config: CONFIG });
    }
    expect((await read()).map((view) => view.name)).toEqual(["Alpha", "middle", "zeta"]);
  });

  it("holds a config naming a column this build does not draw, and gives it back intact", async () => {
    await reset();
    // DD-019 clause 7: the page drops what it cannot render. The seam
    // storing it is what makes that possible.
    const config = {
      ...CONFIG,
      columns: [...CONFIG.columns, { key: "a_column_from_the_future", width: 120 }],
      sort: { key: "a_sort_from_the_future", dir: "desc" },
    };
    const [view] = await create({ surface: "contracts", name: "Forward", config });
    expect(view!.config).toEqual(config);
  });

  it("refuses a surface it does not know", async () => {
    const res = await createRaw({ surface: "spaceships", name: "Nope", config: CONFIG });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a config with no columns, because that is not a table", async () => {
    const res = await createRaw({
      surface: "contracts",
      name: "Empty",
      config: { ...CONFIG, columns: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a blank name and a name past the ceiling", async () => {
    expect(
      (await createRaw({ surface: "contracts", name: "   ", config: CONFIG })).statusCode,
    ).toBe(400);
    expect(
      (await createRaw({ surface: "contracts", name: "n".repeat(61), config: CONFIG })).statusCode,
    ).toBe(400);
  });

  it("stops at the ceiling on how many views one list holds", async () => {
    await reset();
    for (let index = 0; index < MAX_LIST_VIEWS_PER_SURFACE; index += 1) {
      await create({ surface: "contracts", name: `View ${String(index)}`, config: CONFIG });
    }
    const res = await createRaw({ surface: "contracts", name: "One too many", config: CONFIG });
    expect(res.statusCode, res.body).toBe(409);
    await reset();
  });
});

describe("names are one person's, and unique to them", () => {
  it("refuses a name this person already uses, whatever the case", async () => {
    await reset();
    await create({ surface: "contracts", name: "Renewals", config: CONFIG });
    const res = await createRaw({ surface: "contracts", name: "renewals", config: CONFIG });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("lets two people hold the same name", async () => {
    await reset();
    await reset(otherCookies);
    await create({ surface: "contracts", name: "My contracts", config: CONFIG });
    const theirs = await create(
      { surface: "contracts", name: "My contracts", config: CONFIG },
      otherCookies,
    );
    expect(theirs).toHaveLength(1);
    expect(await read()).toHaveLength(1);
  });

  it("refuses a rename onto a name this person already uses", async () => {
    await reset();
    await create({ surface: "contracts", name: "Renewals", config: CONFIG });
    const views = await create({ surface: "contracts", name: "Triage", config: CONFIG });
    const triage = views.find((view) => view.name === "Triage")!;
    const res = await patchRaw(triage.id, { name: "RENEWALS" });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("the default view", () => {
  it("takes the flag on creation", async () => {
    await reset();
    const views = await create({
      surface: "contracts",
      name: "Opens here",
      config: CONFIG,
      isDefault: true,
    });
    expect(views[0]!.isDefault).toBe(true);
  });

  it("moves rather than multiplies when a second view takes it", async () => {
    await reset();
    await create({ surface: "contracts", name: "First", config: CONFIG, isDefault: true });
    const views = await create({
      surface: "contracts",
      name: "Second",
      config: CONFIG,
      isDefault: true,
    });
    expect(views.filter((view) => view.isDefault).map((view) => view.name)).toEqual(["Second"]);
  });

  it("moves when an existing view is pointed at", async () => {
    await reset();
    await create({ surface: "contracts", name: "First", config: CONFIG, isDefault: true });
    const created = await create({ surface: "contracts", name: "Second", config: CONFIG });
    const second = created.find((view) => view.name === "Second")!;
    const res = await patchRaw(second.id, { isDefault: true });
    expect(res.statusCode, res.body).toBe(200);
    const views = res.json().views as View[];
    expect(views.filter((view) => view.isDefault).map((view) => view.name)).toEqual(["Second"]);
  });

  it("can be given up, leaving the list on its built-in layout", async () => {
    await reset();
    const [only] = await create({
      surface: "contracts",
      name: "Only",
      config: CONFIG,
      isDefault: true,
    });
    const res = await patchRaw(only!.id, { isDefault: false });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().views as View[]).some((view) => view.isDefault)).toBe(false);
  });

  it("leaves no default behind when the default is deleted", async () => {
    await reset();
    await create({ surface: "contracts", name: "Keeper", config: CONFIG });
    const created = await create({
      surface: "contracts",
      name: "Doomed",
      config: CONFIG,
      isDefault: true,
    });
    const doomed = created.find((view) => view.name === "Doomed")!;
    const res = await deleteRaw(doomed.id);
    expect(res.statusCode, res.body).toBe(200);
    const views = res.json().views as View[];
    expect(views.map((view) => view.name)).toEqual(["Keeper"]);
    expect(views.some((view) => view.isDefault)).toBe(false);
  });
});

describe("overwriting a view", () => {
  it("replaces the config with the list on screen", async () => {
    await reset();
    const [view] = await create({ surface: "contracts", name: "Working", config: CONFIG });
    const next = {
      columns: [{ key: "title", width: null }],
      sort: null,
      filters: {},
    };
    const res = await patchRaw(view!.id, { config: next });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().views as View[])[0]!.config).toEqual(next);
  });

  it("leaves an omitted field alone", async () => {
    await reset();
    const [view] = await create({ surface: "contracts", name: "Working", config: CONFIG });
    const res = await patchRaw(view!.id, { name: "Renamed" });
    expect(res.statusCode, res.body).toBe(200);
    const [after] = res.json().views as View[];
    expect(after!.name).toBe("Renamed");
    expect(after!.config).toEqual(CONFIG);
  });

  it("refuses a patch that names nothing to change", async () => {
    await reset();
    const [view] = await create({ surface: "contracts", name: "Working", config: CONFIG });
    expect((await patchRaw(view!.id, {})).statusCode).toBe(400);
  });
});

describe("a view is private, and access is not advertised", () => {
  it("keeps one person's views out of another's list", async () => {
    await reset();
    await reset(otherCookies);
    await create({ surface: "contracts", name: "Mine", config: CONFIG });
    expect(await read(otherCookies)).toEqual([]);
  });

  it("answers 404 — not 403 — for somebody else's view id", async () => {
    await reset();
    const [mine] = await create({ surface: "contracts", name: "Mine", config: CONFIG });

    const read404 = await patchRaw(mine!.id, { name: "Theirs now" }, otherCookies);
    expect(read404.statusCode).toBe(404);
    const delete404 = await deleteRaw(mine!.id, otherCookies);
    expect(delete404.statusCode).toBe(404);

    // The refusal for a real id somebody else owns and the refusal for an
    // id that was never issued say the same thing. A 403 on the first
    // would confirm the view exists.
    //
    // `instance` is left out of the comparison: RFC 9457 has it echo the
    // request path, so it differs by the id that was asked for and cannot
    // do otherwise. What must not differ is the status and the words.
    const missing = await deleteRaw("01960000-0000-7000-8000-000000000000", otherCookies);
    expect(missing.statusCode).toBe(404);
    const said = (res: { json: () => Record<string, unknown> }) => {
      const body = { ...res.json() };
      delete body.instance;
      return body;
    };
    expect(said(delete404)).toEqual(said(missing));
  });

  it("leaves the owner's view untouched after somebody else is refused", async () => {
    const views = await read();
    expect(views.map((view) => view.name)).toEqual(["Mine"]);
  });
});

describe("who may hold a view", () => {
  it("takes any signed-in person, including a Business User with no contracts list", async () => {
    // The guard is authentication and nothing more: a view says nothing
    // about a record, and the destination enforces its own reach.
    const views = await create(
      { surface: "contracts", name: "Bea's", config: CONFIG },
      businessCookies,
    );
    expect(views).toHaveLength(1);
  });

  it("refuses a caller with no session", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/list-views?surface=contracts",
    });
    expect(res.statusCode).toBe(401);
  });
});
