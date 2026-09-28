# Security policy

OpenLaw holds contracts, legal advice and personal data. A security problem in OpenLaw can expose all three, so report it privately first.

## Supported versions

Security fixes go into the latest release line only.

| Version        | Supported |
| -------------- | --------- |
| 0.1.x          | Yes       |
| Older than 0.1 | No        |

## Report a vulnerability

Do not open a public issue for a security problem.

Use GitHub private vulnerability reporting. Open the repository's **Security** tab and select **Report a vulnerability**. Only the maintainer can read the report.

Include these items:

- The OpenLaw version or commit, and how you run it.
- The steps to reproduce the problem, with a proof of concept if you have one.
- What an attacker gets, and which role they need first. For example, an unauthenticated visitor, a Business User on the Portal, or a Legal Team Member.
- Any configuration the problem depends on.

Use fictional data. Do not send real client records, credentials or personal data.

## What happens next

The maintainer acknowledges each report within seven days. The maintainer then confirms or rejects the problem and keeps you informed. For a confirmed problem, the aim is to release a fix before any public disclosure. The maintainer agrees the disclosure date with you. You get credit in the advisory unless you ask to stay anonymous.

OpenLaw is a volunteer project. There is no bug bounty.

## Scope

OpenLaw is self-hosted. The operator owns the deployment. That includes the host, the reverse proxy, TLS, the firewall, backups, and the secrets in `.env`.

Report problems in these areas:

- The OpenLaw source code in this repository.
- The published container images, `ghcr.io/juggernog20/openlaw` and `ghcr.io/juggernog20/openlaw-doc-engine`.
- The default configuration in `compose.yml` and `.env.example`.

These are out of scope:

- A deployment that ignores the hardening in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). That guide covers the reverse proxy contract, trusted proxies, security response headers, rate limits, the doc engine's network isolation, and the credential encryption key.
- Problems in third-party services that OpenLaw connects to, such as DocuSign, an AI provider or an identity provider. Report those to the vendor.
- Findings from automated scanners with no demonstrated impact.
