// Local OpenID Connect fixture for the DOC-032 admin-org walkthrough, adapted
// from DOC-030/admin-org/oidc-fixture.mjs. oauth2-mock-server 9.2.0 (the API
// test dependency, read from the worktree mounted at /repo) runs two issuers so
// the walk can check email-domain routing between several identity providers:
//   port 8080, issuer http://oidc:8080 (first provider)
//   port 8082, issuer http://oidc:8082 (second provider)
// Port 8081 is a fixture control: POST /identity {sub,email,name} selects the
// fictional identity that the next token and userinfo assert, on either issuer.
// GET /identity also reports which issuer served the last authorization request.
// Port 8083 is a stand-in OpenAI-compatible model list (GET /v1/models) for the
// first-run AI analysis step. It counts requests so a refresh is observable.
import http from "node:http";

const { OAuth2Server } =
  await import("/repo/node_modules/.pnpm/oauth2-mock-server@9.2.0/node_modules/oauth2-mock-server/dist/index.mjs");
let identity = { sub: "doc032-none", email: "nobody@example.invalid", name: "" };
let lastIssuer = null;
async function issuer(port) {
  const idp = new OAuth2Server();
  await idp.issuer.keys.generate("RS256");
  await idp.start(port, "0.0.0.0");
  idp.issuer.url = `http://oidc:${port}`;
  idp.service.on("beforeAuthorizeRedirect", () => {
    lastIssuer = idp.issuer.url;
  });
  idp.service.on("beforeUserinfo", (response) => {
    response.body = {
      sub: identity.sub,
      email: identity.email,
      email_verified: true,
      name: identity.name,
    };
  });
  idp.service.on("beforeTokenSigning", (token) => {
    token.payload.sub = identity.sub;
    token.payload.email = identity.email;
    token.payload.email_verified = true;
    token.payload.name = identity.name;
  });
}
await issuer(8080);
await issuer(8082);
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/identity") {
        identity = JSON.parse(body);
        lastIssuer = null;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ...identity, lastIssuer }));
    });
  })
  .listen(8081, "0.0.0.0");
let modelRequests = 0;
http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/count") return res.end(JSON.stringify({ modelRequests }));
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      modelRequests += 1;
      const data = [{ id: "doc032-model-a" }, { id: "doc032-model-b" }];
      if (modelRequests > 1) data.push({ id: `doc032-model-refreshed-${modelRequests}` });
      return res.end(JSON.stringify({ object: "list", data }));
    }
    res.statusCode = 404;
    res.end("{}");
  })
  .listen(8083, "0.0.0.0");
console.log("oidc fixture ready");
