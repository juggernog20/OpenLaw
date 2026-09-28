// DOC-032 compatibility replay (set compat-a, seat "DOC-032 compatibility reviewer (compat-a)"),
// articles triage-requests and convert-request. Copy of docs/documentation/batches/DOC-030/inbox/setup-ai.mjs.
// Changes: helper paths (./inbox-replay/) and root depth; default lab "work" (app 43340, Mailpit 48440)
// instead of work2; the AI phase runs on the reviewer's own lab compataai (app 43396, Mailpit 48496)
// instead of inboxai, so the AI-only guards name port 43396; fixture names "DOC-032 compat compat-a inbox"
// and files "doc032-compata-inbox-*" instead of the DOC-030 prefix; the stand-in host
// doc032-compata-inbox-provider; task, issue and reviewer label; log path inbox-replay*.json (split
// per article afterwards into triage-requests-replay.json and convert-request-replay.json); generated
// PDFs and screenshots go under /tmp. No step, check or expected text changed.
// DOC-032 compat compat-a inbox: AI connector for the separate inboxai lab only. Points the connector at the
// local stand-in (provider-standin.mjs) on that lab's backend network and sets the three
// Request conversion switches. Never run against the shared work2 lab.
// Run: LAB_APP_URL=http://127.0.0.1:43396 LAB_PASSWORD=... STANDIN_API_KEY=... \
//      node docs/documentation/batches/DOC-030/inbox/setup-ai.mjs [matter=on] [contract=off] [fill=on]
import { apiSignIn, BASE, PEOPLE } from "./api.mjs";

if (!BASE.endsWith(":43396")) throw new Error(`setup-ai runs only on the inboxai lab, not ${BASE}`);
const key = process.env.STANDIN_API_KEY;
if (!key) throw new Error("STANDIN_API_KEY is required");
const flag = (name, fallback) => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return arg ? arg.endsWith("=on") : fallback;
};
const admin = await apiSignIn(PEOPLE.administrator.email);
const { body } = await admin.put("/api/v1/ai-connector", {
  preset: "custom",
  protocol: "openai_chat_completions",
  baseUrl: "http://doc032-compata-inbox-provider:8080/v1",
  apiKey: key,
  model: "doc032-compata-inbox-standin-model",
});
if (!body.connector.enabled) await admin.post("/api/v1/ai-connector/enable", {});
const saved = await admin.request("PATCH", "/api/v1/ai-connector/workflows", {
  json: {
    matterPreparation: flag("matter", true),
    contractPreparation: flag("contract", false),
    contractConversionAnalysis: flag("fill", true),
  },
});
const c = saved.body.connector;
console.log(
  JSON.stringify({
    enabled: c.enabled,
    baseUrl: c.baseUrl,
    model: c.model,
    matterPreparation: c.matterPreparation,
    contractPreparation: c.contractPreparation,
    contractConversionAnalysis: c.contractConversionAnalysis,
  }),
);
