# USERDIE Digital authentication operations

## Current activation gate

The password-login endpoint is implemented, but it is not operational until the deployment environment has all required settings and the production database has the reviewed migrations applied. Do not place real beneficiary or staff credentials into test environments.

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

## Pre-activation checklist

1. Review and apply migrations 001–009 using the approved migration process against the intended database.
2. Configure the four runtime settings above in the deployment secret/configuration store; generate the HMAC key outside the repository.
3. Confirm HTTPS is active because the session cookie is Secure and uses the `__Host-` prefix.
4. Verify the login, logout, rate-limit, audit, session-expiry and session-rotation tests in CI.
5. Conduct a security review of proxy topology, account recovery, MFA policy, password reset, operational monitoring and retention before enabling real user accounts.
6. Keep protected cabinets unavailable until the full authorization and deployment review is signed off.

This document describes implementation and activation requirements. It does not claim that production secrets are configured, migrations are applied to production, or login is enabled for real users.
