// SPDX-License-Identifier: AGPL-3.0-only

/** DD-029 T33 and T34 reuse team services and inherit the calling Client attribution. */
import { z } from "zod";
import { addToContractTeam, removeContractTeamMember } from "../lib/contract-team.js";
import { addToMatterTeam, removeMatterTeamMember } from "../lib/matter-team.js";
import { lockedContract, TeamEnvelope } from "../modules/contracts/record.js";
import { lockedMatter } from "../modules/matters/record.js";
import { bounded, serviceResult } from "./results.js";
import { writeTool } from "./workspace.js";
import type { ToolDefinition } from "./tool.js";

const inputSchema = z
  .strictObject({
    record: z.enum(["contract", "matter"]),
    number: z.number().int().positive(),
    userId: z.string().min(1).optional(),
    email: z.email().optional(),
  })
  .refine((input) => (input.userId !== undefined) !== (input.email !== undefined), {
    message: "Provide either userId or email, but not both.",
  });

export const teamTools: readonly ToolDefinition[] = (["add", "remove"] as const).map(
  (operation) => ({
    ...writeTool,
    toolset: "team",
    name: `openlaw_team_${operation}`,
    title: operation === "add" ? "Add a person to a team" : "Remove a person from a team",
    description:
      operation === "add"
        ? "Add an existing person to a contract or matter team by record number and either userId or email. Requires a live person and an editable record. Confidential records require an Administrator, the creator, or the Legal Owner or Matter Manager. An existing membership is a conflict. Returns the team after the change. Legal Users only."
        : "Remove a person from a contract or matter team by record number and either userId or email. Requires an editable record. Confidential records require an Administrator, the creator, or the Legal Owner or Matter Manager. Change or clear the current Business Owner before removing them. A missing membership is not found. Returns the team after the change. Legal Users only.",
    kind: operation === "remove" ? "destr" : "write",
    annotations: {
      ...writeTool.annotations,
      destructiveHint: operation === "remove",
      idempotentHint: false,
    },
    inputSchema,
    outputSchema: TeamEnvelope,
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { record, number, userId, email } = inputSchema.parse(input);
        const target = userId !== undefined ? { userId } : { email: email! };
        if (record === "contract") {
          if (operation === "add")
            return notifier.notifying(async (tx) => {
              const current = await lockedContract(tx, number, user);
              return bounded({
                team: await addToContractTeam(tx, notifier, current, user, target),
              });
            });
          return db.transaction(async (tx) => {
            const current = await lockedContract(tx, number, user);
            return bounded({ team: await removeContractTeamMember(tx, current, user, target) });
          });
        }
        return db.transaction(async (tx) => {
          const current = await lockedMatter(tx, number, user);
          return bounded({
            team: await (operation === "add" ? addToMatterTeam : removeMatterTeamMember)(
              tx,
              current,
              user,
              target,
            ),
          });
        });
      }),
  }),
);
