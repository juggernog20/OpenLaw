// DOC-030 mcp group: independent walkthrough of docs/user-guides/configure-mcp.md
// (V-M40-MCP, V-M41-MCP) and docs/user-guides/connect-headless-client.md (V-M40-CLIENT)
// against labs built from app commit 067c1646829df85e62b809ee9157921e867c84e7.
// Written by the DOC-030 independent walkthrough agent (mcp) from the guide text.
//
// Run from the worktree root with the seed demo password in the environment:
//   LAB_PASSWORD=... PHASE=m40 node docs/documentation/batches/DOC-030/mcp/walkthrough.mjs
// PHASE is one of:
//   m40       shared work2 lab: V-M40-MCP (Administrator) and V-M40-CLIENT (all three roles)
//   lan       owned mcplan lab: operator pins, Instance address changes, plain-HTTP LAN refusals
//   m40r      shared work2 lab: re-run of the m40 revoke and Audit log steps only
//   m41       owned mcplan lab: V-M41-MCP OAuth Clients, Allowed Clients, grants, lifetime restart
// Every phase replaces its own steps in walkthrough.json. API keys, Client secrets,
// sign-in links, cookies and raw mail are never written to a file.
const phase = process.env.PHASE;
if (!["m40", "m40r", "lan", "m41"].includes(phase))
  throw new Error("Set PHASE to m40, m40r, lan or m41.");
await import(`./phase-${phase}.mjs`);
