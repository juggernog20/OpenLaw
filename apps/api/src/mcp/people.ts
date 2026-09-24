// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { listAssignableUsers } from "../lib/assignable-users.js";
import { departmentOptions } from "../modules/departments/references.js";
import { UserOptionSchema, toPerson } from "../modules/contracts/record.js";
import { bounded, boundedPage, pageInput } from "./results.js";
import { readTool } from "./workspace.js";
import { ToolError, type ToolDefinition } from "./tool.js";

const inputSchema = z.strictObject({
  ...pageInput,
  kind: z.enum(["users", "departments"]).optional(),
});
export const peopleTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    businessUser: "off",
    toolset: "people",
    name: "openlaw_people_list",
    title: "List people and Departments",
    description:
      "Read active assignable users and live Departments, with ids and display names for assignment by name. Users include account roles: Request assignment and record Owner or Matter Manager require a Legal User; teams may include Business Users. Omit kind for both lists. To page either list, set kind to users or departments and pass nextCursor with the same kind. Legal Users only.",
    inputSchema,
    outputSchema: z.object({
      users: z.array(UserOptionSchema),
      departments: z.array(z.object({ id: z.string(), displayName: z.string() })),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db }) => {
      const { kind, cursor, limit } = inputSchema.parse(input);
      if (cursor && !kind)
        throw new ToolError("validation_error", "Choose kind users or departments when paging.");
      const [users, departments] = await Promise.all([
        kind === "departments"
          ? []
          : listAssignableUsers(db).then((rows) =>
              rows.map((person) => ({ ...toPerson(person), role: person.role })),
            ),
        kind === "users" ? [] : departmentOptions(db),
      ]);
      if (!kind) return bounded({ users, departments, nextCursor: null });
      const rows = kind === "users" ? users : departments;
      const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      if (cursor && start === 0)
        throw new ToolError("validation_error", "That cursor is not in this list.");
      const page = boundedPage(rows.slice(start), limit, (row) => row.id);
      return bounded({
        users: kind === "users" ? page.items : [],
        departments: kind === "departments" ? page.items : [],
        nextCursor: page.nextCursor,
      });
    },
  },
];
