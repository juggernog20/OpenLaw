// DOC-032 mcp group: independent walkthrough of docs/user-guides/configure-mcp.md
// (V-M40-MCP, V-M41-MCP, V-M42-MCP), docs/user-guides/connect-headless-client.md
// (V-M40-CLIENT, V-M42-C58) and the vendor-free parts of docs/user-guides/connect-claude.md
// (V-M41-C59, V-M42-C59) against labs built from app commit
// 4ca41822b685a2a1e58a38b4f25e421cf735c54e. Written by the DOC-032 independent walkthrough
// agent (mcp) from the guide text, reusing the DOC-030 mcp pattern and MCP client code.
//
// Run from the worktree root with the seed demo password in the environment:
//   LAB_PASSWORD=... PHASE=m42up node docs/documentation/batches/DOC-032/mcp/walkthrough.mjs
// PHASE is one of:
//   m42up   owned mcpup lab: 067c1646 build, every Toolset in the ceiling, upgrade.sh to the
//           pin, then V-M42-MCP with a modern and a legacy script Client
//   m40     owned mcp42 lab: V-M40-MCP (Administrator) and V-M40-CLIENT (all three roles)
//   c58     owned mcp42 lab: V-M42-C58 resources, prompts and listen streams (all three roles)
//   lan     owned mcp42 lab: operator pins and restarts, plain-HTTP LAN refusals (V-M40/V-M41)
//   m41     owned mcp42 lab: V-M41-MCP OAuth Clients, Allowed Clients, grants, lifetime restart
//   claude  owned mcp42 lab: connect-claude consent, Toolset and scope rules, refusals,
//           Disconnect and the Guide Tools (live-provider checks recorded as blocked)
// Every phase replaces its own steps in walkthrough.json. API keys, Client secrets, tokens,
// sign-in links, cookies and raw mail are never written to a file.
const phases = ["m42up", "m40", "c58", "lan", "m41", "claude"];
const phase = process.env.PHASE;
if (!phases.includes(phase)) throw new Error(`Set PHASE to one of ${phases.join(", ")}.`);
await import(`./phase-${phase}.mjs`);
