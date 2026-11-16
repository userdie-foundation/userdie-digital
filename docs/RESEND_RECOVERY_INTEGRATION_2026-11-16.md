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


## Recovery pages and API preflight — implementation update

- Added `website/recovery.html` for requesting a recovery email and `website/reset-password.html` for setting a new password.
- Added shared `website/auth-recovery.js` and `website/auth-recovery.css`.
- Pages are marked `noindex,nofollow`, set `no-referrer`, use native field validation, enforce matching passwords and a 12-character minimum, do not persist credentials in browser storage, and clear the one-time token from the address bar immediately.
- The reset page calls `POST /api/v1/auth/recovery/complete`; the request page calls `POST /api/v1/auth/recovery/request`. Both use the configured HTTPS API origin and fail closed when it is blank.
- Added narrow CORS preflight handling in `backend/src/server.mjs`: only the exact configured origin, JSON POST, and `Content-Type` header are accepted. Added tests for allowed and rejected preflight cases.
- Added a website workflow step to syntax-check the external recovery JavaScript.
- Confirmed reset-page URL for runtime configuration: `https://xn--d1abbl2ben.online/reset-password.html`. This is the public Pages URL from the repository's configured domain. The API origin is still unknown and intentionally remains blank in both pages' `userdie-api-base` meta tags.
- The new pages are not added to the sitemap and are excluded from search indexing. No homepage CTA was added until the backend is operational, avoiding a public promise of an unavailable service.
- No production API host, Resend sender verification, runtime secrets, real delivery, or end-to-end reset has been confirmed. Do not enable the form until the confirmed API origin is inserted and the runtime gates are met.


## Additional security review and CI evidence

- Fixed an account-enumeration edge case: a Resend/provider or account-specific recovery-service failure now returns the same generic `202 {accepted:true}` response as a non-matching account. A fixed operational log message is emitted without email, token, or provider response details. Rate-limiter infrastructure failure still fails closed.
- Resend sender configuration now rejects CR/LF header injection, and the API key is trimmed before constructing the Authorization header. Added regression tests for CR/LF injection.
- Website quality gate run `43947797239` on commit `d2755435d86c80bbd2d77f5b54e5664653710ac5`: **SUCCESS**. Confirmed internal links, accessibility baseline, external recovery JS syntax, mobile navigation, visual assets, and 404 checks.
- Public website deployment run `43947797267` on the same commit: **SUCCESS**; both build and deploy jobs completed successfully.
- Backend checks run `43947950959` on commit `d1a5e55730c71d0c7532d81cd4b89ca835de824c`: **SUCCESS**, including automated tests, container build, and smoke test.
- Backend checks run `43948121242` on commit `f925edbdc7c9aa29409311b88be5b43fbf3a91aa`: **SUCCESS**, including the sender-validation hardening.
- Final regression-test run `43948200067` on commit `9d54c10b5a1729df34f5eeed6ea4739d4444efba` was **PENDING/QUEUED** at the time of this checkpoint; it is intended to include the new CR/LF regression cases. Do not report that final run as passed until GitHub marks it successful.
- A previous website quality run failed because the two new HTML pages lacked document titles; titles were added and the subsequent quality gate passed. This defect is corrected.


## Latest release-gate update

- Recovery pages now hide the entire form while the API origin meta value is blank; users cannot enter an email or password into an inactive form. The one-time token is still removed from the URL before the readiness check.
- CORS preflight is now scoped not only to the exact allowed origin, POST and Content-Type, but also exclusively to `/api/v1/auth/recovery/request` and `/api/v1/auth/recovery/complete`.
- Website quality gate run `43948452900` on commit `1d3ef41535654b9af6ec90573cc66f2b813b4cba`: **SUCCESS**.
- Deploy public website run `43948452904` on the same commit: **SUCCESS**. The latest recovery-page UI guard is included in the successful deployment.
- Backend checks run `43948200067` on commit `9d54c10b5a1729df34f5eeed6ea4739d4444efba`: **SUCCESS**, including automated tests and production-container smoke test. This run includes the CR/LF sender regression tests.
- Backend checks run `43948429499` on commit `5a80d7372560c106b73696ff3642a56475a24706` — still **QUEUED/PENDING** at the time of this update. It includes the final regression test that rejects CORS preflight on non-recovery endpoints; wait for this result before declaring that last change CI-verified.
