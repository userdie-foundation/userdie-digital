# Resend recovery integration checkpoint — 2026-11-16

## Scope

Connect the existing Resend account to the already implemented USERDIE Digital account-recovery core. The work uses the existing backend and does not change the GitHub Pages publication target, DNS, MX, or mail routing.

## Changes committed to `main`

- Added `backend/src/security/resend-recovery-mailer.mjs`: sends plain-text password-recovery email through the official Resend HTTPS API endpoint.
- Added `backend/src/security/resend-recovery-mailer.test.mjs`: covers request payload, token URL construction, provider rejection, network failure, malformed tokens, and unsafe configuration.
- Extended `backend/src/config.mjs` with validation for `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `RECOVERY_URL`. Partial Resend configuration is rejected.
- Updated `backend/src/index.mjs` to instantiate and inject the existing recovery service only when the Resend settings and dedicated recovery rate-limit key are both configured.
- Extended config tests and included the adapter in the backend syntax-check script.
- Updated `backend/README.md` with runtime configuration and activation gates.

## Security properties

- The API key is read only from runtime environment configuration; no key or secret value is committed.
- The sender must be supplied as a Resend-verified sender identity.
- Recovery links are HTTPS-only and contain the opaque, short-lived, single-use token.
- The adapter sends only the token URL to the recipient; it does not log the token or expose provider response bodies.
- Network/provider failures return a generic error without leaking provider details.
- Existing generic API responses, database token-digest storage, one-time consumption, session revocation, audit events, and recovery throttling remain in place.
- No DNS or MX records were changed.

## Activation blockers — intentionally not bypassed

1. The Resend account registration/welcome message is known, but sender-domain verification and live API delivery have not been independently confirmed.
2. The current `website/` tree does not contain a password-reset page. `RECOVERY_URL` must not be guessed; it must point to a real deployed page that reads the `token` query parameter and calls `POST /api/v1/auth/recovery/complete`.
3. No production backend host or protected runtime secret store is confirmed.
4. The API key and dedicated `RECOVERY_RATE_LIMIT_HMAC_KEY` must be installed in the backend host's secret manager, never pasted into chat or committed to Git.
5. An end-to-end test must verify a real delivery to a controlled mailbox and a successful one-time password reset before enabling user-facing recovery.

## Status

The Resend adapter and backend injection are implemented in source. This is not evidence of live email delivery, a deployed backend, or operational password recovery. Do not collect real user passwords or recovery data through the static site until the complete release gate passes.

## Next steps

1. Build and review the password-reset page and connect it to the actual API origin.
2. Confirm the existing Resend account's verified sender identity without modifying DNS/MX blindly.
3. Configure runtime secrets in the confirmed backend host.
4. Run backend unit tests, PostgreSQL integration tests, CI, and an end-to-end recovery test.
5. Keep recovery fail-closed until every gate is verified.


## CI result update — 2026-11-16

- Backend checks run `43946248803` on source/config/documentation commit `0bdf544e46092a68d5abed048b154766e9dc6c35`: **SUCCESS**.
- Confirmed successful steps: dependency installation, JavaScript syntax check, automated tests, production container image build, and container smoke test.
- Public repository security check run `43946316828`: **SUCCESS**.
- Robot Team run `43946316843`: **SUCCESS**.
- Security Guard run `43946316750`: still **PENDING** at the time of this update. Do not report full CodeQL/security acceptance until it completes.
- The latest `main` commit `0a5b9fa275391a456888469e9251a5c8b6764f61` updates continuity documentation only; no application code changed after the successful backend check.
- These CI results validate source checks and the container smoke test; they do not establish production deployment, Resend account verification, real email delivery, or an end-to-end password reset.
