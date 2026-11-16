# REG.RU backend hosting plan

**Status:** implementation plan only. No REG.RU resource, paid service, DNS record, database, secret, or deployment has been created.

**Repository baseline reviewed:** `main`, commit `8bdf0e099441a75a80c25072c9f3d83b85889fb7` (2026-11-16).

## 1. Hosting decision

Use REG.RU Cloud VPS as the initial backend runtime target, subject to confirmation that the foundation's existing REG.RU account can access this product and to explicit owner approval of any charge.

Do not use ordinary shared hosting for this backend. The project requires Node.js 22+, a long-running HTTP process, Docker, and controlled PostgreSQL connectivity. REG.RU's own guidance states that Docker containers require a server/platform with Docker support and are not supported on ordinary virtual hosting.

Keep the public website and its current GitHub Pages deployment unchanged.

## 2. Minimum initial topology

Start with one VPS rather than buying separate application and database servers immediately:

- One supported Linux VPS running Docker Engine and the Compose plugin.
- Backend API container built from the repository's existing `backend/Dockerfile`.
- PostgreSQL in a separate container on the same VPS, attached only to a private Docker network; never publish port 5432 to the public interface.
- Reverse proxy (Caddy or Nginx) terminates HTTPS and forwards only to the API container.
- Host firewall permits HTTPS (443), HTTP (80 only for certificate issuance/redirect), and SSH only from an owner-approved administrative IP range. Do not expose database or Docker daemon ports.
- SSH key authentication; disable password-based SSH after access is verified. Use a non-root administrative account and sudo.
- Keep the VPS region and contractual data-location terms in Russia if required for the foundation's personal-data processing. Confirm the exact region and applicable legal basis before any real personal data is stored.

This single-host topology is a controlled initial deployment, not a claim of high availability. Reassess separation of PostgreSQL, managed database service, replicas, and disaster recovery when real load, availability requirements, or the threat model justify the added cost.

## 3. Application configuration and secrets

The backend source already expects Node.js 22+, listens on the provider-configured `PORT` (default 8080), and exposes:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`

Provide runtime settings only on the server, never in Git:

- `DATABASE_URL` — private PostgreSQL endpoint.
- `ALLOWED_ORIGIN=https://xn--d1abbl2ben.online` — exact public website origin.
- `LOGIN_RATE_LIMIT_HMAC_KEY` — independently generated random secret, at least 32 bytes.
- `RECOVERY_RATE_LIMIT_HMAC_KEY` — a different independently generated random secret, at least 32 bytes.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `RECOVERY_URL=https://xn--d1abbl2ben.online/reset-password.html` only after sender verification and controlled end-to-end testing.

Until a managed secret store is selected, keep the runtime environment file outside the repository, owned by root, readable only by the deployment account/root as operationally required (target mode 0600), and excluded from backups that are accessible without encryption. Never send secrets through chat or commit them to GitHub.

Do not set a production API origin in the public website until the API is deployed, HTTPS is verified, and the acceptance checks below pass.

## 4. Database controls

- Use a new, empty staging database first; do not connect the initial deployment to beneficiary, donor, employee, or partner records.
- Use separate PostgreSQL roles: a migration/schema-owner role used only for the explicit migration CLI, and a least-privilege non-owner runtime role used by the API.
- Apply migrations 001–014 only to a new empty staging database using the documented explicit migration command. Do not baseline or migrate any existing database without a separate reviewed reconciliation plan.
- Keep PostgreSQL bound to the private container network only.
- Require verified TLS for any database connection that leaves the VPS.
- Do not use real personal data in staging.

## 5. Backup and recovery

Before any production data is accepted:

1. Define recovery point and recovery time objectives with the foundation.
2. Enable provider-level backups/snapshots only after checking retention, access controls, location, and cost.
3. Add encrypted database backups with keys stored separately from the VPS.
4. Restrict backup access and document retention/deletion.
5. Perform and record a restore rehearsal into an isolated environment.
6. Document recovery access, incident contacts, and rollback procedure.

A successful backup job is not proof of recoverability; only a restore test is.

## 6. Deployment sequence

1. Confirm the existing REG.RU account's active services and whether Cloud VPS is available. Do not ask the owner to share passwords, PINs, API keys, or session cookies.
2. Compare the smallest suitable VPS configurations and disclose recurring costs before requesting approval.
3. After explicit approval, provision one VPS in the agreed Russian region; record OS image, region, IP, resource size, and owner.
4. Harden SSH and host firewall before exposing the service.
5. Install Docker Engine/Compose from trusted official repositories.
6. Deploy the API and isolated staging PostgreSQL with synthetic data only.
7. Run the migration CLI against the new empty staging database with separate migration/runtime roles.
8. Verify TLS, health endpoints, origin enforcement, logs, rate limits, database isolation, and container non-root execution.
9. Verify Resend sender identity and perform a controlled recovery request/reset test using a synthetic account.
10. Only after owner acceptance, consider connecting the public recovery pages to the API. Keep all other public UI workflows disabled until separately reviewed.

## 7. Acceptance gates

- [ ] VPS region and data-location terms confirmed.
- [ ] No public PostgreSQL, Docker socket, or administrative panel exposure.
- [ ] SSH key access verified; password SSH disabled.
- [ ] HTTPS certificate valid; HTTP redirects to HTTPS.
- [ ] API runs as the unprivileged `node` user.
- [ ] Liveness succeeds; readiness fails closed when PostgreSQL is unavailable.
- [ ] Migrations 001–014 applied only to a new empty staging database and recorded with checksums.
- [ ] Runtime DB role is not a schema owner and has only required privileges.
- [ ] Exact-origin checks reject foreign/null/missing origins on state-changing requests.
- [ ] Secrets absent from Git, image layers, logs, and public website.
- [ ] Resend sender verified; recovery delivery/reset tested end-to-end with synthetic account.
- [ ] Encrypted backup restored successfully in an isolated environment.
- [ ] Deployed commit, host URL, test date, operator, rollback, and recovery procedure recorded.

## 8. Explicit non-actions

Until the foundation owner approves the resource and budget, do not:

- create or resize paid VPS/database resources;
- alter domain DNS, MX, or mail records;
- publish an API hostname or change GitHub Pages;
- connect real personal data;
- enable live account recovery or login for public users;
- place credentials, tokens, or private keys in GitHub.

## 9. Official REG.RU references

- Hosting selection and Docker/shared-hosting distinction: https://help.reg.ru/support/hosting/razmeshcheniye-sayta-otobrazheniye-v-brauzere/kak-razmestit-gotovyy-sayt-v-internete
- Cloud VPS management: https://help.reg.ru/support/servery-vps/oblachnyye-servery/zakaz-i-upravleniye-uslugoy-oblachnyye-servery/upravleniye-uslugoy-oblachnyye-servery
- Cloud PostgreSQL overview: https://help.reg.ru/support/servery-vps/oblachnyye-bazy-dannykh/postgresql/kak-rabotayet-postgresql-v-oblake

