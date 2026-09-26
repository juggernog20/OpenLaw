// State reads for the DOC-030 mcp walkthrough (fixture checks only).
import { Session } from "../../../../../scripts/seed/client.mjs";
const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
const s = new Session("daniel.okafor@helix.example", BASE);
await s.request("POST", "/api/auth/sign-in/email", {
  json: { email: "daniel.okafor@helix.example", password: process.env.LAB_PASSWORD },
  headers: { origin: BASE },
});
for (const p of process.argv.slice(2).length ? process.argv.slice(2) : ["/api/v1/mcp-settings"]) {
  const r = await s.get(p);
  console.log(p, JSON.stringify(r.body, null, 1).slice(0, 3000));
}
