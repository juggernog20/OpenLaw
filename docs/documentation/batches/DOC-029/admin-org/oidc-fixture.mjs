// Local OpenID Connect fixture for the DOC-029 admin-org V-C37 walkthrough.
// oauth2-mock-server 9.2.0 (the API test dependency) serves discovery, authorize,
// token, JWKS and userinfo on port 8080 under the issuer http://oidc:8080.
// Port 8081 is a fixture control: POST /identity {sub,email,name} selects the
// fictional identity that the next token and userinfo assert.
import http from "node:http";
import { OAuth2Server } from "oauth2-mock-server";

let identity = { sub: "doc029-none", email: "nobody@example.invalid", name: "" };
const idp = new OAuth2Server();
await idp.issuer.keys.generate("RS256");
await idp.start(8080, "0.0.0.0");
idp.issuer.url = "http://oidc:8080";
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
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/identity") identity = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(identity));
    });
  })
  .listen(8081, "0.0.0.0");
console.log("oidc fixture ready");
