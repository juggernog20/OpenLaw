// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull, users, type Transaction } from "@openlaw/db";
import { httpError } from "./problem.js";

type IndividualInput = { kind: "individual"; name: string } | { kind: "user"; userId: string };
type ExistingParty = { id: string; kind: string; name: string | null; userId: string | null };

/** Called under the register write lock, so concurrent entries cannot add duplicates. */
export async function resolveRegisterIndividual(
  tx: Transaction,
  input: IndividualInput,
  existing: ExistingParty[],
) {
  let name: string;
  if (input.kind === "user") {
    const [person] = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.archivedAt)));
    if (!person) throw httpError(400, "Select an active user.");
    const known = existing.find((party) => party.userId === person.id);
    if (known) return { name: known.name!, userId: person.id, existingId: known.id };
    name = person.displayName;
  } else name = input.name;
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (
    existing.some(
      (party) =>
        party.kind === "individual" &&
        party.name !== null &&
        normalize(party.name) === normalize(name),
    )
  )
    throw httpError(
      409,
      "An individual with this name is already in the register. Select the existing individual.",
    );
  return { name, userId: input.kind === "user" ? input.userId : null, existingId: null };
}
