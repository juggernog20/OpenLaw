// Browser helpers for the DOC-032 mcp walkthrough, copied from the DOC-030 mcp phase-m40
// helpers. Each one follows the labels the guides name.
import { expectThat, flat, pause, PEOPLE, secret, until } from "./lib.mjs";

export function ui(BASE) {
  const main = async (page) => flat(await page.locator("main").innerText());
  const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
  async function openSettings(page, name) {
    if (!page.url().startsWith(BASE)) await page.goto(`${BASE}/`);
    await page.getByRole("banner").getByRole("button", { name }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page.waitForURL(/\/settings/);
    await page.waitForLoadState("networkidle").catch(() => {});
    return page.getByRole("navigation", { name: "Settings sections" });
  }
  async function gotoMcp(page, name = PEOPLE.administrator.name) {
    const nav = await openSettings(page, name);
    await nav.getByRole("link", { name: "MCP", exact: true }).first().click();
    await page.waitForURL(/\/settings\/mcp$/);
    await page.getByText(/^MCP is (on|off)$/).waitFor();
    return nav;
  }
  async function saved(page, action) {
    const response = page.waitForResponse(
      (r) =>
        /\/api\/v1\/mcp-settings(\/allowed-clients\/[^/]+)?$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "PATCH",
    );
    await action();
    const r = await response;
    // Allowed Client switches save without a status message; the MCP policy shows Settings saved.
    if (!r.url().includes("/allowed-clients/"))
      await page
        .getByRole("status")
        .filter({ hasText: "Settings saved." })
        .first()
        .waitFor({ timeout: 10000 });
    return r.status();
  }
  async function toggle(page, label, want) {
    const sw = page.getByRole("switch", { name: label, exact: true });
    const now = (await sw.getAttribute("aria-checked")) === "true";
    if (now === want) return `${label} already ${want ? "on" : "off"}`;
    const status = await saved(page, () => sw.click());
    expectThat(status === 200, `${label} PATCH answered ${status}`);
    await until(
      async () => ((await sw.getAttribute("aria-checked")) === "true") === want,
      `${label} did not change`,
    );
    return `${label} turned ${want ? "on" : "off"}${/^Enable (?!MCP$)/.test(label) ? " (PATCH 200)" : "; Settings saved."}`;
  }
  async function checkbox(page, label, want) {
    const box = page.getByRole("checkbox", { name: label, exact: true });
    const state = async () =>
      (await box.getAttribute("aria-checked")) === "true" ||
      (await box.getAttribute("data-state")) === "checked";
    if ((await state()) === want) return `${label} already ${want ? "selected" : "clear"}`;
    const status = await saved(page, () => box.click());
    expectThat(status === 200, `${label} PATCH answered ${status}`);
    await until(async () => (await state()) === want, `${label} did not change`);
    return `${label} ${want ? "selected" : "cleared"}; Settings saved.`;
  }
  async function expandCard(page, title) {
    const button = page.getByRole("button", { name: title, exact: true });
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    return button;
  }
  async function ceilingState(page) {
    await expandCard(page, "Toolset ceiling");
    return page.getByRole("checkbox").evaluateAll((els) =>
      els
        .filter((e) => e.closest("label"))
        .map((e) => ({
          name: e.getAttribute("aria-label") ?? e.closest("label")?.textContent?.trim(),
          checked: e.getAttribute("aria-checked") === "true" || e.dataset.state === "checked",
          caption: e.getAttribute("aria-describedby")
            ? document.getElementById(e.getAttribute("aria-describedby"))?.textContent?.trim()
            : null,
        })),
    );
  }
  async function apiKeysPane(page, role) {
    if (role === "business_user") {
      await page.goto(`${BASE}/portal`);
      await page.getByRole("link", { name: "Notification settings" }).click();
      await page.waitForURL(/\/portal\/settings$/);
      await page.getByRole("link", { name: "API keys", exact: true }).click();
      await page.waitForURL(/\/portal\/settings\/api-keys/);
    } else {
      const nav = await openSettings(page, PEOPLE[role].name);
      await nav.getByRole("link", { name: "API keys", exact: true }).click();
      await page.waitForURL(/\/settings\/api-keys/);
    }
    await page.getByRole("heading", { name: "API keys" }).first().waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  /** Opens Request a key and reads the form without sending it. */
  async function readRequestForm(page) {
    await page.getByRole("button", { name: "Request a key", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Request an API key" });
    await dialog.waitFor();
    const text = flat(await dialog.innerText());
    const boxes = await dialog.getByRole("checkbox").evaluateAll((els) =>
      els.map((e) => ({
        name: e.getAttribute("aria-label") ?? e.closest("label")?.textContent?.trim(),
        checked: e.getAttribute("aria-checked") === "true" || e.dataset.state === "checked",
      })),
    );
    const radios = await dialog.getByRole("radio").evaluateAll((els) =>
      els.map((e) => ({
        name: e.closest("label")?.textContent?.trim().slice(0, 60),
        checked: e.getAttribute("aria-checked") === "true" || e.dataset.state === "checked",
      })),
    );
    return { dialog, text, boxes, radios };
  }
  async function requestKey(page, { name, toolsets, scope, note }) {
    const form = await readRequestForm(page);
    const { dialog } = form;
    const send = dialog.getByRole("button", { name: "Send request" });
    const disabledBefore = await send.isDisabled();
    await dialog.getByLabel("Client name").fill(name);
    for (const t of toolsets) await dialog.getByRole("checkbox", { name: t, exact: true }).check();
    const writeShown = (await dialog.getByRole("radio", { name: /^Write\./ }).count()) > 0;
    await dialog.getByRole("radio", { name: scope === "write" ? /^Write\./ : /^Read\./ }).check();
    if (note) await dialog.getByLabel("Note (Optional)").fill(note);
    const posted = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/api-key-requests") && r.request().method() === "POST",
    );
    await send.click();
    const response = await posted;
    const body = await response.json();
    if (body.key) secret(body.key);
    return {
      id: body.id,
      status: response.status(),
      dialogText: form.text,
      disabledBefore,
      writeShown,
      offered: form.boxes.map((b) => b.name),
      preselected: form.boxes.filter((b) => b.checked).map((b) => b.name),
      radios: form.radios,
    };
  }
  async function readyDialog(page) {
    const ready = page.getByRole("dialog", { name: "Your key is ready" });
    await ready.waitFor({ timeout: 20000 });
    return ready;
  }
  async function collect(page, ready, { closeWith = "Done" } = {}) {
    const text = flat(await ready.innerText());
    await page.mouse.click(5, 5);
    await pause(400);
    const survivedOutside = await ready.isVisible();
    await ready.getByRole("button", { name: "Copy", exact: true }).click();
    await ready.getByRole("button", { name: "Copied", exact: true }).waitFor();
    const key = secret((await clip(page)).trim());
    const link = ready.getByRole("link", { name: /Connect a headless Client/ });
    const href = await link.getAttribute("href").catch(() => null);
    const target = await link.getAttribute("target").catch(() => null);
    if (closeWith === "Esc") await page.keyboard.press("Escape");
    else await ready.getByRole("button", { name: "Done", exact: true }).click();
    await ready.waitFor({ state: "detached", timeout: 10000 });
    return { key, text, survivedOutside, href, target };
  }
  function rowText(page, name) {
    return page.getByRole("row").filter({ hasText: name }).first().innerText().then(flat);
  }
  async function bellApprovals(page) {
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const region = page.getByRole("region", { name: "Your approvals" });
    await region.waitFor({ timeout: 15000 });
    return region;
  }
  async function closeBell(page) {
    await page.keyboard.press("Escape");
    await pause(300);
  }
  /** Approves a request from the bell as the Administrator. */
  async function approveInBell(page, clientName) {
    await page.goto(`${BASE}/settings/profile`);
    const region = await bellApprovals(page);
    const item = region.getByRole("listitem").filter({ hasText: clientName });
    await item.waitFor({ timeout: 20000 });
    const text = flat(await item.innerText());
    await item.getByRole("button", { name: "Approve", exact: true }).click();
    await item.waitFor({ state: "detached", timeout: 15000 });
    await closeBell(page);
    return text;
  }
  /** The requester reloads API keys and copies the key once. */
  async function collectAfterApproval(page, requestId, api) {
    await until(
      async () =>
        (await api(page, BASE, "GET", "/api/v1/api-key-requests")).body?.requests?.find(
          (q) => q.id === requestId,
        )?.keyAvailable,
      "approval not stored",
      20000,
    );
    await page.reload();
    return collect(page, await readyDialog(page), { closeWith: "Done" });
  }
  return {
    main,
    clip,
    openSettings,
    gotoMcp,
    saved,
    toggle,
    checkbox,
    expandCard,
    ceilingState,
    apiKeysPane,
    readRequestForm,
    requestKey,
    readyDialog,
    collect,
    rowText,
    bellApprovals,
    closeBell,
    approveInBell,
    collectAfterApproval,
  };
}
