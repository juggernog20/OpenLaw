// Entity helpers for the DOC-032 records walkthrough (entity-records and
// entity-structure-and-access). Ported from the DOC-030 entities walkthrough.mjs helpers.
// API calls here only prepare fixtures, make a second actor's competing write, or read back
// a result that the browser step already showed.
import { BASE, tidy, q, sleep } from "./lib.mjs";

export const wait = sleep;
export function expect(condition, message) {
  if (!condition) throw new Error(message);
}
export { q, tidy };

/** A signed-in identity with a bound API helper. Keys follow the driver's session keys. */
export async function sessionFor(ctx, key) {
  const s = await ctx.session(key);
  if (!s.page.__watched) {
    s.page.__watched = true;
    s.page.__bad = [];
    s.page.on("response", (r) => {
      if (r.status() >= 400)
        s.page.__bad.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    s.page.on("pageerror", (e) =>
      s.page.__bad.push(`pageerror: ${String(e.message).slice(0, 300)}`),
    );
  }
  const { PEOPLE } = await import("./lib.mjs");
  return {
    ...s,
    key,
    person: PEOPLE[key],
    api: (method, url, body) => ctx.api(s.page, method, url, body),
  };
}

export async function go(page, url) {
  page.__bad = [];
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await checkErrorScreen(page);
}
/** Error screens seen on the shared lab, with what the page logged. Reported in the walkthrough log. */
export const errorScreens = [];
async function checkErrorScreen(page) {
  for (let i = 0; i < 3; i++) {
    const shown = await page
      .getByText("Something went wrong.")
      .isVisible()
      .catch(() => false);
    if (!shown) return;
    const seen = {
      at: new Date().toISOString(),
      url: new URL(page.url()).pathname,
      logged: [...(page.__bad ?? [])],
    };
    errorScreens.push(seen);
    console.log(`    error screen on ${seen.url}: ${seen.logged.join(" | ")}`);
    page.__bad = [];
    await wait(1500);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}
export async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(700);
  await checkErrorScreen(page);
}
export async function reload(page) {
  await page.reload();
  await settle(page);
}
export async function blurTo(page, heading) {
  await page.getByRole("heading", { name: heading, exact: true }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(700);
}
export async function sectionText(page, heading) {
  const h = page.getByRole("heading", { name: heading, exact: true }).first();
  if (!(await h.count())) return null;
  return tidy(await h.locator("xpath=ancestor::section[1]").innerText());
}
export function section(page, heading) {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .first()
    .locator("xpath=ancestor::section[1]");
}
/** Share-capital inputs show grouped digits until focused: click, select all, type. */
export async function typeInto(locator, text) {
  await locator.click();
  await locator.press("Control+A");
  await locator.press("Backspace");
  if (text) await locator.pressSequentially(text);
}
export const plain = (v) => v.replace(/,/g, "");
export const req = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\*?$`);

/** The shared filter bar: Filter, pick a property, pick one value, Apply. */
export async function applyFilter(page, scope, property, choice) {
  await scope.getByRole("button", { name: /^Filter/ }).click();
  const pop = page.getByRole("dialog", { name: "Filter" });
  await pop.waitFor();
  await pop.getByRole("button", { name: new RegExp(`^${property}`) }).click();
  if (choice === undefined) {
    await pop.waitFor({ state: "hidden" }).catch(() => {});
    await settle(page);
    return;
  }
  const search = pop.getByLabel("Search choices");
  if (await search.count()) await search.fill(choice);
  const radio = pop.getByRole("radio", { name: choice, exact: true });
  if (await radio.count()) await radio.check();
  else await pop.getByRole("checkbox", { name: choice, exact: true }).click();
  await pop.getByRole("button", { name: "Apply" }).click();
  await settle(page);
}
export async function pickDate(page, trigger, iso) {
  await trigger.click();
  const pop = page.getByRole("dialog", { name: "Choose a date" });
  await pop.waitFor();
  const [y, m] = iso.split("-").map(Number);
  await pop.getByRole("combobox", { name: "Year" }).selectOption(String(y));
  await pop.getByRole("combobox", { name: "Month" }).selectOption(String(m - 1));
  await pop.locator(`[data-day="${iso}"]:not([data-outside]) button`).click();
  await pop.waitFor({ state: "hidden" }).catch(() => {});
}

let corporationId = null;
export async function fixtureEntity(ctx, s, legalName, extra = {}) {
  if (!corporationId) {
    const r = await s.api("GET", "/entities/types");
    corporationId = r.json.entityTypes.find((t) => t.displayName === "Corporation").id;
  }
  const r = await s.api("POST", "/entities", { legalName, entityTypeId: corporationId, ...extra });
  expect(r.status === 201, `fixture Entity ${legalName} refused ${r.status} ${q(r.json)}`);
  await ctx.record({
    what: `Entity ${legalName}`,
    how: `POST /entities as ${s.person.name}`,
    cleanup: "kept, named for the run",
  });
  return r.json.entity;
}
let contractTypeId = null;
export async function fixtureContract(ctx, s, title, extra = {}) {
  if (!contractTypeId) {
    // /contracts/options serves every staff role; /contract-types is Administrator-only.
    const r = await s.api("GET", "/contracts/options");
    contractTypeId = (r.json.contractTypes ?? []).find(
      (t) => t.displayName === "NDA" && !t.archivedAt,
    )?.id;
    expect(contractTypeId, "no NDA contract type");
  }
  const r = await s.api("POST", "/contracts", {
    title,
    contractTypeId,
    customFields: {},
    isConfidential: Boolean(extra.isConfidential),
    managerId: null,
    ...(extra.body ?? {}),
  });
  expect(r.status === 201, `fixture Contract ${title} refused ${r.status} ${q(r.json)}`);
  if (!extra.quiet)
    await ctx.record({
      what: `Contract ${title}`,
      how: `POST /contracts as ${s.person.name}`,
      cleanup: "kept, named for the run",
    });
  return r.json.contract;
}

export async function addHolding(page, { relationship, entity, percent }) {
  await page.getByRole("button", { name: "Add Holding" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Holding" });
  await dialog.getByLabel("Relationship").selectOption({ label: relationship });
  await dialog.getByRole("combobox", { name: "Entity" }).fill(entity);
  await dialog.getByRole("option", { name: entity, exact: true }).click();
  await dialog.getByLabel("Ownership percent").fill(percent);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await settle(page);
}
export async function addIndividual(page, name, percent) {
  await page.getByRole("button", { name: "Add Holding" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Holding" });
  await dialog.getByRole("radio", { name: "Individual" }).check();
  await dialog.getByLabel("Full name").fill(name);
  await dialog.getByLabel("Ownership percent").fill(percent);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await settle(page);
}
