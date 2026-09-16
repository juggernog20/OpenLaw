// Local OpenID Connect stand-in for the DOC-029 first-run walkthrough.
// It runs in a container on the firstrun lab's backend network with the alias "oidc".
// It serves discovery and JWKS so that "Register provider" can complete. No real identity provider is involved.
import { OAuth2Server } from "/home/blairwentworth/.cache/openlaw-docs-status/node_modules/.pnpm/oauth2-mock-server@9.2.0/node_modules/oauth2-mock-server/dist/index.mjs";

const server = new OAuth2Server();
await server.issuer.keys.generate("RS256");
server.issuer.url = "http://oidc:8080";
await server.start(8080, "0.0.0.0");
console.log("oidc fixture listening", server.issuer.url);
