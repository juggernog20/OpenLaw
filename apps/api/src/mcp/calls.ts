// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-035 call accounting, described in SCHEMA.md's mcp_tool_calls section.
 * Each call reserves a row under a credential lock before execution, then records
 * its outcome. The database clock defines the hour shared by all API processes.
 */

import { and, eq, gte, lt, mcpToolCalls, ne, sql } from "@openlaw/db";
import type { ToolContext, ToolDefinition } from "./register.js";
import { ToolError, toolRefusal } from "./register.js";
import { defaults, type Environment } from "../modules/advanced-settings/config.js";

/** Reserve a ledger row under a database lock so concurrent API processes share the limit. */
async function reserveCall(
  context: ToolContext,
  name: string,
  requestId: string,
  active: Environment,
) {
  const configured = Number(active.MCP_RATE_LIMIT_PER_HOUR);
  const limit =
    Number.isSafeInteger(configured) && configured > 0
      ? configured
      : Number(defaults.MCP_RATE_LIMIT_PER_HOUR);
  return context.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${context.credentialId}, 0))`,
    );
    const time = await tx.execute<{ start: string; reset: string; now: string }>(
      sql`select date_trunc('hour', observed_at) as start, date_trunc('hour', observed_at) + interval '1 hour' as reset, observed_at as now from (select clock_timestamp() as observed_at) as clock`,
    );
    const rowTime = time.rows[0]!;
    const window = {
      start: new Date(rowTime.start),
      reset: new Date(rowTime.reset),
      now: new Date(rowTime.now),
    };
    const [count] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(mcpToolCalls)
      .where(
        and(
          eq(mcpToolCalls.credentialId, context.credentialId),
          gte(mcpToolCalls.createdAt, window.start),
          lt(mcpToolCalls.createdAt, window.reset),
          ne(mcpToolCalls.outcome, "rate_limited"),
        ),
      );
    const limited = count!.value >= limit;
    const [row] = await tx
      .insert(mcpToolCalls)
      .values({
        personId: context.user.id,
        credentialId: context.credentialId,
        clientName: context.clientName,
        tool: /^[a-zA-Z0-9_-]{1,64}$/.test(name) ? name : "unknown_tool",
        outcome: limited ? "rate_limited" : "pending",
        requestId,
        createdAt: window.now,
      })
      .returning({ id: mcpToolCalls.id });
    return {
      id: row!.id,
      refusal: limited
        ? new ToolError(
            "rate_limited",
            `The limit is ${limit} Tool calls per hour per credential. It resets at ${window.reset.toISOString()}.`,
          )
        : undefined,
    };
  });
}

export async function callTool(
  tools: readonly ToolDefinition[],
  name: string,
  input: unknown,
  context: ToolContext,
  requestId: string,
  active: Environment,
) {
  const started = performance.now();
  const reservation = await reserveCall(context, name, requestId, active);
  let outcome = "internal_error";
  try {
    if (reservation.refusal) throw reservation.refusal;
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new ToolError("unknown_tool", "This Tool is not in the OpenLaw register.");
    const refusal = toolRefusal(tool, context.grant);
    if (refusal) throw refusal;
    const parsed = tool.inputSchema.safeParse(input ?? {});
    if (!parsed.success)
      throw new ToolError(
        "invalid_arguments",
        `${tool.name} arguments do not match its input schema.`,
      );
    const output = await tool.run(parsed.data, context);
    const structuredContent = tool.outputSchema.parse(output);
    outcome = "success";
    return {
      content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  } catch (error) {
    outcome = error instanceof ToolError ? error.code : "internal_error";
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `${outcome}: ${error instanceof ToolError ? error.message : "The Tool call failed."}`,
        },
      ],
    };
  } finally {
    await context.db
      .update(mcpToolCalls)
      .set({ outcome, durationMs: Math.round(performance.now() - started) })
      .where(eq(mcpToolCalls.id, reservation.id));
  }
}
