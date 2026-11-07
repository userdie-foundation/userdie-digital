# USERDIE Digital authentication operations

## Current activation gate

The password-login and logout handlers are implemented, but production activation is not confirmed. Login remains unavailable unless the deployment environment has all required settings and the production database has the reviewed migrations applied. Do not place real beneficiary or staff credentials into test environments.

Required runtime configuration:

- `DATABASE_URL`: PostgreSQL connection URL.
- `DATABASE_SSL=true` when the database provider requires TLS.
- `ALLOWED_ORIGIN`: one exact HTTPS origin, with no path (for example, `https://example.org`).
- `LOGIN_RATE_LIMIT_HMAC_KEY`: a randomly generated secret containing at least 32 UTF-8 bytes. Store it only in the deployment platform's secret manager; never commit it or print it in logs.

If `LOGIN_RATE_LIMIT_HMAC_KEY` is absent, the API deliberately does not instantiate the authentication service and `POST /api/v1/auth/login` returns 503. This is a fail-closed state, not a successful login deployment.

## Login contract

- Method and route: `POST /api/v1/auth/login`.
- Requires exact `Origin` match and `application/json`.
- Accepts only `email` and `password`; unknown fields are rejected.
- Uses the direct socket peer address for network throttling. Forwarded headers are not trusted.
- Returns a generic 401 for invalid credentials, 429 for an active throttle block, and 503 for unavailable authentication dependencies.
- On success, issues an opaque token in a Secure, HttpOnly, SameSite=Lax, host-only `__Host-userdie_session` cookie. The token is never returned in JSON.
- Sessions and audit records are committed in one PostgreSQL transaction. Only the SHA-256 token digest is persisted.
- Current session lifetime is eight hours. Logout revokes the server-side session before clearing the cookie.

## Account recovery status

The repository contains migrations 010–012 and an account-recovery service core. Migration 011 adds database triggers that block UPDATE, DELETE and TRUNCATE on the audit log for ordinary SQL operations; database ownership and DDL permissions remain separate operational controls. Migration 012 adds persistence tables for encrypted TOTP-factor metadata, short-lived challenge digests and one-time recovery-code verifiers. It does not implement or activate the corresponding application flows. The service normalizes email addresses, returns a generic request result, stores only a SHA-256 digest of a high-entropy single-use token, expires tokens after a bounded interval, and invalidates active sessions after a successful password reset. The raw token is passed only to a caller-supplied delivery adapter.

The recovery service is not connected to HTTP request/reset routes or a production email provider. Do not describe account recovery as operational for users until route-level validation, delivery, abuse throttling, expiry/replay behavior, session revocation, audit behavior, and operational failure handling have been integrated and tested.

## MFA status

MFA is not implemented or enforced. The current password login issues a normal session immediately after password verification. Migration 012 now provides schema groundwork for encrypted TOTP-factor metadata, challenge digests and one-time recovery-code verifiers; it does not provide enrollment, challenge issuance/consumption, TOTP verification, replay-safe factor updates, recovery-code consumption, KMS integration or session gating. The design checkpoint in [MFA_IMPLEMENTATION_DESIGN.md](MFA_IMPLEMENTATION_DESIGN.md) remains the application-level implementation plan. Do not treat accounts as MFA-protected.

## Pre-activation checklist

1. Review and apply migrations 001–012 using the approved migration process against the intended database; migration 011 protects audit rows against ordinary UPDATE/DELETE/TRUNCATE, while migration 012 is MFA schema groundwork only.
2. Configure the runtime settings above in the deployment secret/configuration store; generate the HMAC key outside the repository.
3. Confirm HTTPS is active because the session cookie is Secure and uses the `__Host-` prefix.
4. Verify login, logout, rate-limit, audit, session-expiry and session-rotation tests in CI.
5. Complete and verify the recovery HTTP routes, trusted delivery adapter, one-time-token expiry/replay tests, and session revocation.
6. Review and approve `MFA_IMPLEMENTATION_DESIGN.md`; implement and independently verify its privileged-role policy, factor lifecycle, recovery and enforcement requirements.
7. Verify the central exact-Origin guard for all state-changing methods against the real proxy/TLS topology; this is a CSRF defense-in-depth control, not a substitute for a complete CSRF threat-model review. Review operational monitoring and retention before enabling real user accounts.
8. Keep protected cabinets unavailable until the full authorization and deployment review is signed off.

This document describes implementation and activation requirements. It does not claim that production secrets are configured, migrations are applied to production, or login/recovery/MFA are enabled for real users.
