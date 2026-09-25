// DOC-030 claude-live, phase "passwords": before the Funnel exposes the lab, every account
// with a password moves off the published seed password to one fresh random value. Each
// person changes their own password through the app's change-password endpoint, the one the
// Profile page's Change password form calls (authClient.changePassword, revokeOtherSessions).
// SEED_PASSWORD and LAB_PASSWORD come from the environment only.
import { createLog, expectThat, LAB, PUBLIC } from "./lib.mjs";

const SEED = process.env.SEED_PASSWORD;
const NEW = process.env.LAB_PASSWORD;
if (!SEED || !NEW || SEED === NEW) throw new Error("Set SEED_PASSWORD and a different LAB_PASSWORD.");
const { save, step } = createLog("passwords", { lab: LAB.name });
const S = { article: "connect-claude", scenario: "V-M41-C59", role: "operator", method: "container-operation", page: "/api/auth (loopback, before exposure)", secrets: [SEED, NEW] };

// Accounts with a password, read from the lab (the seed's Administrator and invited staff).
const ACCOUNTS = [
  "blair@helix.example",
  "daniel.okafor@helix.example",
  "gabriel.santos@helix.example",
  "ines.duarte@helix.example",
  "marcus.oyelaran@helix.example",
  "nadia.haddad@helix.example",
  "priya.raman@helix.example",
  "sofia.lindqvist@helix.example",
  "tom.iwu@helix.example",
];
const headers = (cookie) => ({ "content-type": "application/json", origin: PUBLIC, ...(cookie ? { cookie } : {}) });
async function signIn(email, password) {
  const r = await fetch(`${LAB.loopback}/api/auth/sign-in/email`, { method: "POST", headers: headers(), body: JSON.stringify({ email, password }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await r.text();
  return { status: r.status, cookie };
}

async function adminSession() {
  const a = await signIn("daniel.okafor@helix.example", NEW);
  if (a.status !== 200) throw new Error(`Daniel Okafor sign-in ${a.status}`);
  return a.cookie;
}
async function adminCall(cookie, method, url) {
  const r = await fetch(`${LAB.loopback}${url}`, { method, headers: headers(cookie), ...(method === "POST" ? { body: "{}" } : {}) });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
}
async function changeOwn(email) {
  const s = await signIn(email, SEED);
  if (s.status !== 200) return `seed sign-in ${s.status}`;
  const r = await fetch(`${LAB.loopback}/api/auth/change-password`, {
    method: "POST",
    headers: headers(s.cookie),
    body: JSON.stringify({ currentPassword: SEED, newPassword: NEW, revokeOtherSessions: true }),
  });
  await r.text();
  return String(r.status);
}

await step(S, "Change every password account's password to one fresh random value through the app's change-password endpoint", "9 of 9 changed with 200 (an archived account is restored, changed and archived again by the Administrator)", async () => {
  const out = [];
  for (const email of ACCOUNTS) {
    if ((await signIn(email, NEW)).status === 200) {
      out.push(`${email}: already changed in an earlier run (new password 200)`);
      continue;
    }
    const first = await changeOwn(email);
    if (first !== "seed sign-in 403") {
      out.push(`${email}: ${first}`);
      continue;
    }
    // Archived (USER_ARCHIVED): the seed password is still stored and a restore would revive it.
    const cookie = await adminSession();
    const users = (await adminCall(cookie, "GET", "/api/v1/users")).body;
    const list = users?.users ?? users?.items ?? users;
    const target = list.find((u) => u.email === email);
    const un = await adminCall(cookie, "POST", `/api/v1/users/${target.id}/unarchive`);
    const changed = await changeOwn(email);
    const ar = await adminCall(cookie, "POST", `/api/v1/users/${target.id}/archive`);
    out.push(`${email}: archived (seed sign-in 403 USER_ARCHIVED); Daniel Okafor unarchive ${un.status}, own change-password ${changed}, archive again ${ar.status}`);
  }
  expectThat(out.every((l) => / 200$|new password 200\)$/.test(l)), out.join("; "));
  return `Each person signed in with the seed password and called POST /api/auth/change-password (currentPassword, newPassword, revokeOtherSessions true), the endpoint behind Settings → Personal → Profile → Change password. Results: ${out.join("; ")}. The new value is kept only in ~/.cache/openlaw-doc030/claudelive.env (mode 600) as LAB_PASSWORD.`;
});

await step(S, "Confirm the published seed password signs in no one, and the new one signs in everyone", "Seed password 401 for all 9; new password 200 for the 8 active accounts and 403 USER_ARCHIVED for archived Gabriel Santos", async () => {
  const seed = [];
  const fresh = [];
  for (const email of ACCOUNTS) {
    const r = await signIn(email, SEED);
    seed.push(r.status);
    fresh.push((await signIn(email, NEW)).status);
  }
  expectThat(seed.every((s) => s === 401) && fresh.filter((s, i) => ACCOUNTS[i] !== "gabriel.santos@helix.example").every((s) => s === 200) && fresh[2] === 403, JSON.stringify({ seed, fresh }));
  return `POST /api/auth/sign-in/email with the seed password: ${JSON.stringify(seed)}. With the new password: ${JSON.stringify(fresh)} (Gabriel Santos stays archived, so 403 USER_ARCHIVED; a wrong password for him answers 401, so the seed password no longer matches). Business Users (Jonas Weber and the other Portal accounts) have no password; they sign in by magic link.`;
});
save();
