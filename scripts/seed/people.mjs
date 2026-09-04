/* Filling the instance with people.
 *
 * Three kinds of account come into existence three different ways, and
 * the seed walks each one the way a person would (DD-010):
 *
 *   Administrator   first-run setup, then the onboarding wizard closes
 *   staff           an invite, then the set-password link in the email
 *   Business User   a magic link, redeemed; the account is born on redemption
 *
 * Nothing is written straight into `users`, so every account has the
 * account rows, the verification history and the activity a real one has.
 * That matters more than it sounds: a Business User with no `accounts`
 * row is exactly how the users list tells a requester from a pending
 * invite, and a seed that faked one would put the settings screen in a
 * state the app can never reach.
 */

import { Session, pool } from "./client.mjs";
import { extractLink, waitForMail } from "./mailpit.mjs";
import { ADMIN, BUSINESS_USERS, ORG, STAFF } from "./data.mjs";

/** A shared password, because this instance is a review sandbox. */
export const PASSWORD = "correct-horse-battery";

/**
 * better-auth refuses a request that carries a session cookie and no
 * Origin as a forgery, so every call on its own mount names one.
 */
function authHeaders(session) {
  return { origin: session.baseUrl };
}

/** Signs in with a password, into a jar of its own. */
export async function signIn(email, password = PASSWORD, label = email) {
  const session = new Session(label);
  await session.request("POST", "/api/auth/sign-in/email", {
    json: { email, password },
    headers: { origin: session.baseUrl },
  });
  const me = await session.json("GET", "/api/v1/me");
  session.user = me.user ?? me;
  return session;
}

/**
 * The Administrator, and the instance's first-run state behind them.
 *
 * Idempotent on purpose. A seed run against an instance that already has
 * an Administrator signs in instead of failing, which is what makes the
 * script safe to re-run while it is being written.
 */
export async function establishAdministrator(log) {
  const anonymous = new Session("setup");
  const { body: probe } = await anonymous.get("/api/v1/auth/setup");
  if (probe.needsSetup) {
    log(`first-run setup as ${ADMIN.email}`);
    await anonymous.request("POST", "/api/v1/auth/setup", {
      json: { email: ADMIN.email, displayName: ADMIN.displayName, password: ADMIN.password },
      expect: [201, 409],
    });
  } else {
    log("an Administrator already exists; signing in");
  }

  const admin = await signIn(ADMIN.email, ADMIN.password, ADMIN.displayName);
  await admin.post("/api/v1/onboarding/complete");
  return admin;
}

/**
 * Opens the portal to the company's own domain.
 *
 * This has to happen before any Business User is invented: magic-link
 * redemption only creates an account for an address on the allowlist, and
 * only while the toggle is on.
 */
export async function openThePortal(admin, log) {
  const domains = [ORG.domain];
  await admin.put("/api/v1/auth/allowed-domains", { domains });
  await admin.patch("/api/v1/auth/portal", { magicLinkEnabled: true });
  log(`portal open to ${domains.join(", ")}`);
}

/**
 * Invites one staff member and activates them through the emailed link.
 *
 * The token is read out of the mail and spent against the API rather than
 * through the browser: same endpoint, same single use, no page to drive.
 */
async function activateStaff(admin, person, log) {
  const { status } = await admin.request("POST", "/api/v1/auth/invites", {
    json: { email: person.email, displayName: person.displayName, role: person.role },
    expect: [201, 409],
  });
  if (status === 409) {
    log(`  ${person.displayName} already has an account`);
    return signIn(person.email, PASSWORD, person.displayName);
  }

  const mail = await waitForMail(person.email, /password/i);
  const link = extractLink(mail.text, "/auth/set-password");
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error(`The set-password link for ${person.email} carries no token.`);

  const activation = new Session(person.displayName);
  await activation.request("POST", "/api/auth/reset-password", {
    json: { newPassword: PASSWORD, token },
    headers: authHeaders(activation),
  });
  log(`  ${person.displayName} (${person.role}) activated`);
  return signIn(person.email, PASSWORD, person.displayName);
}

/**
 * Brings one Business User into existence by redeeming a magic link.
 *
 * The account does not exist until the link is followed. That is the
 * whole of the JIT rule, so the display name can only be set afterwards,
 * by the person themselves, which is also the only way the app allows it.
 */
async function redeemMagicLink(person, log) {
  const session = new Session(person.displayName);
  await session.request("POST", "/api/v1/auth/magic-link", { json: { email: person.email } });
  const mail = await waitForMail(person.email, /sign in/i);
  const link = extractLink(mail.text, "/api/auth/magic-link/verify");

  await session.request("GET", link, { expect: [200, 302, 303] });
  await session.request("POST", "/api/auth/update-user", {
    json: { name: person.displayName },
    headers: authHeaders(session),
  });
  const me = await session.json("GET", "/api/v1/me");
  session.user = me.user ?? me;
  log(`  ${person.displayName} (business user) signed in`);
  return session;
}

/**
 * Every person in the instance, signed in and ready to author records.
 *
 * Staff are activated a few at a time. Each activation is four round
 * trips and a wait on the mailer, and a dozen at once buys nothing on a
 * single-process API.
 */
export async function provisionEveryone(admin, log) {
  log("inviting the legal team");
  const staffSessions = await pool(STAFF, 3, (person) => activateStaff(admin, person, log));

  log("signing in the business");
  const businessSessions = await pool(BUSINESS_USERS, 3, (person) => redeemMagicLink(person, log));

  const { body: listed } = await admin.get("/api/v1/users");
  const byEmail = new Map((listed.users ?? []).map((user) => [user.email.toLowerCase(), user]));

  const people = new Map();
  const remember = (person, session) => {
    const record = byEmail.get(person.email.toLowerCase());
    people.set(person.displayName, {
      ...person,
      id: session.user?.id ?? record?.id,
      session,
      role: record?.role ?? person.role ?? "business_user",
    });
  };

  remember({ ...ADMIN, role: "administrator" }, admin);
  STAFF.forEach((person, index) => remember(person, staffSessions[index]));
  BUSINESS_USERS.forEach((person, index) =>
    remember({ ...person, role: "business_user" }, businessSessions[index]),
  );

  for (const [name, person] of people) {
    if (!person.id) throw new Error(`${name} was provisioned without an id.`);
  }
  log(`${people.size} people in the instance`);
  return people;
}

/** Everyone who can be a Matter Manager or Contract Owner (Member+). */
export function memberPlus(people) {
  return [...people.values()].filter(
    (person) => person.role === "administrator" || person.role === "legal_team_member",
  );
}

/** The Contributors, who reach only the records they are added to. */
export function contributors(people) {
  return [...people.values()].filter((person) => person.role === "contributor");
}

/** The Business Users, who submit through the portal. */
export function businessUsers(people) {
  return [...people.values()].filter((person) => person.role === "business_user");
}

/**
 * Retires the people the corpus marks as gone.
 *
 * Left until the end so an archived person has still authored things:
 * a leaver whose name appears on nothing tells you nothing about how the
 * app draws one.
 */
export async function archiveLeavers(admin, people, log) {
  for (const person of people.values()) {
    if (!person.archived) continue;
    await admin.post(`/api/v1/users/${person.id}/archive`);
    log(`  ${person.displayName} archived`);
  }
}
