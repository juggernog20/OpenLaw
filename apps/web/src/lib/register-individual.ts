// SPDX-License-Identifier: AGPL-3.0-only

/** Match register individuals under ENT-003's 2026-10-02 amendment. */

import { defineMessage } from "react-intl";

export const duplicateIndividualMessage = defineMessage({
  id: "entities.register.duplicateIndividual",
  defaultMessage:
    "An individual with this name is already in the register. Select the existing individual.",
});

type Party =
  | { restricted: true; id: string }
  | {
      restricted: false;
      id: string;
      kind: string;
      name: string;
      userId?: string | null;
    };

export function registerIndividualMatch(
  parties: readonly Party[],
  name: string,
  userId: string | null,
) {
  const known = userId ? parties.find((p) => !p.restricted && p.userId === userId) : undefined;
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return {
    known,
    duplicate:
      !known &&
      parties.some(
        (p) => !p.restricted && p.kind === "individual" && normalize(p.name) === normalize(name),
      ),
  };
}
