# USERDIE Digital — security implementation checkpoint

**Review date:** 2026-11-16  
**Repository:** `userdie-foundation/userdie-digital`  
**Branch:** `main`  
**Reviewed HEAD:** `cd84c8280d382b97efeb49ea89380e77cc3c2109`  
**Scope:** source-level review of account recovery, authentication runtime wiring, MFA persistence/design, and current CI evidence.  
**Status:** review checkpoint only; no application code, production configuration, database, or deployment was changed.

## 1. Current verified source state

### Account recovery

- `backend/src/security/account-recovery.mjs` implements a recovery service factory requiring a PostgreSQL pool and an explicitly supplied `sendRecoveryMessage` adapter.
- Request flow normalizes email, returns a generic accepted result for invalid/unknown accounts, generates a high-entropy 32-byte token, persists only its SHA-256 digest, invalidates prior unconsumed recovery tokens under a per-user row lock, and writes an audit event.
- Raw token is passed only to the trusted delivery adapter and is not returned by the service.
- Consume flow checks token format/expiry/single-use state, updates the password, consumes the token, revokes all active sessions, and writes an audit event in one transaction.
- `backend/src/server.mjs` contains request and completion HTTP handlers. Route-level tests exist in `backend/test/server.test.mjs`.
- **Activation blocker:** `backend/src/index.mjs` creates and injects `recoveryRateLimiter`, but does not import/create/inject `createAccountRecoveryService`. The handlers therefore remain fail-closed with `503 recovery_unavailable`.
- **Delivery blocker:** no approved email provider/adapter or its production secret configuration is present. Do not invent a provider or activate a placeholder sender.

### MFA

- Migration `backend/migrations/012_mfa_persistence.sql` exists. It defines storage for encrypted TOTP factor metadata, pending challenges and one-time recovery-code verifiers.
- The migration explicitly leaves key custody, enrollment, verification, challenge consumption and enforcement to application code.
- `docs/MFA_IMPLEMENTATION_DESIGN.md` defines the required state machine, fail-closed behavior, TOTP replay prevention, one-time recovery codes, privileged-role policy and release tests.
- No MFA runtime module, enrollment flow, challenge verification, managed KMS integration, or session gating is implemented.
- Current password login can issue a normal session without MFA. Privileged accounts must not be described as MFA-protected.

### Runtime and delivery

- `backend/src/config.mjs` currently validates database URL, origin, pool size, TLS boolean, and HMAC keys for login/recovery rate limiting. It does not configure an email delivery adapter or managed encryption-key service.
- No production/staging backend host, database migration execution, managed secret store, KMS, mail delivery, or live backup/restore is confirmed by this review.
- The current public website workflow is separate from backend deployment; a GitHub Pages publish does not deploy the API.

## 2. CI evidence at this checkpoint

- Latest observed `main` commit: `cd84c8280d382b97efeb49ea89380e77cc3c2109` (mobile navigation test coverage).
- Combined commit status returned an empty status list.
- The workflow-runs connector query for this SHA returned no runs; its wrapper is limited to pull-request-triggered runs. This result does **not** establish that push-triggered checks passed or failed.
- No local test execution was performed during this review.
- Therefore CI is **not confirmed** for this checkpoint. Do not report a green build.

## 3. Risks and implementation constraints

1. Do not activate recovery with a fake, log-only, or untrusted email sender.
2. Recovery email delivery must not disclose whether an account exists; route responses remain generic and throttling must stay enabled.
3. Review delivery-failure behavior: the recovery token is committed before the adapter is called. A failed delivery must be observable without logging the raw token; retries and token invalidation must remain safe.
4. Password recovery must not silently remove or bypass MFA once MFA is introduced.
5. MFA-required roles must not receive an ordinary session after password verification alone. Role policy must come from trusted server-side grants.
6. TOTP seed encryption requires managed key custody, rotation and recovery procedures; database columns alone are not key management.
7. Do not process real beneficiary, donor, employee or partner personal data until deployment and security acceptance gates are passed.

## 4. Next implementation sequence

### Gate A — delivery decision
Obtain explicit approval for the foundation's email provider and sender identity, operational owner, and budget/plan. Then implement a provider adapter behind configuration, with TLS, timeouts, safe error handling, and no secret/token logging. Until then, keep recovery unavailable.

### Gate B — recovery integration
After Gate A:
- wire `createAccountRecoveryService` into `backend/src/index.mjs`;
- pass the configured trusted delivery adapter and existing PostgreSQL pool;
- preserve fail-closed startup/route behavior when configuration is absent;
- test unknown/existing email response parity, throttling, provider failure, expiry, replay, concurrent requests, single-use consumption, session revocation and audit behavior;
- run backend unit and PostgreSQL integration suites in CI using synthetic accounts only.

### Gate C — MFA implementation
Before coding MFA enforcement:
- approve the privileged-role policy;
- select TOTP and/or WebAuthn/passkeys;
- select managed KMS/HSM or equivalent key custody and key-rotation owner;
- implement pending challenge/session gating, factor enrollment, replay-safe verification, recovery codes, reset controls, audit events and negative authorization tests;
- prove that MFA-required roles cannot obtain a session without a valid factor.

### Gate D — production readiness
Verify reviewed migrations on staging, managed secrets, TLS/proxy/Origin behavior, backups and restore, monitoring, incident response, independent security review and rollback. Production activation requires explicit owner approval.

## 5. Acceptance and reporting rule

A source-level implementation, passing CI, a GitHub Pages deployment, and a live backend deployment are four different claims. Report each only with its own evidence. Until the above gates pass, recovery and MFA remain **not operational**, and demo cabinets remain unsuitable for real personal data.
