# USERDIE Digital MFA implementation design

## Status and scope

This document defines the security and delivery requirements for multi-factor authentication (MFA). It is a design checkpoint, not an implementation or a production activation notice. The current password login issues a normal session immediately after password verification; MFA is not yet enforced. Do not treat a user as MFA-protected until the server-side challenge flow and privileged-role policy are implemented, tested, deployed, and verified.

## Decisions required before implementation

1. **Privileged-role policy:** require MFA for `administrator`, `auditor`, `case_worker`, and `program_manager` accounts before granting privileged access. Applicant and partner policy may be staged separately, but must be explicit.
2. **Factor strategy:** support TOTP as an initial interoperable factor; evaluate WebAuthn/passkeys as the preferred phishing-resistant factor, especially for administrators. Do not describe TOTP as phishing-resistant.
3. **Key custody:** encrypt TOTP seeds using envelope encryption backed by a managed KMS or equivalent secret-management service. The database stores ciphertext, nonce, authentication tag, key version/identifier and lifecycle metadata only. Never store or log plaintext seeds, provisioning URIs, QR payloads, or one-time codes.
4. **Recovery:** recovery codes are high-entropy, single-use credentials. Store only a strong one-way verifier (for example, a keyed HMAC with a separately managed secret, or a password-hash verifier); never store recoverable plaintext codes. Display each code only once at generation.
5. **Fail-closed operation:** if encryption keys, factor verification, policy lookup, or challenge persistence are unavailable, do not issue an authenticated session for an account requiring MFA.

## Required authentication state machine

- Password accepted: do not create an ordinary `auth_sessions` row yet.
- Create a short-lived, single-use pending authentication challenge bound to the browser by a high-entropy opaque cookie. Persist only its digest; record user, expiry, attempt count, creation context, and consumed state.
- Determine MFA policy from trusted database roles, never from client-supplied role fields.
- If MFA is required, verify a registered factor before session issuance. A successful factor challenge consumes the pending challenge atomically and creates the normal session plus audit event in one transaction.
- If MFA is not required by policy, preserve the approved password-only flow only for explicitly exempt account classes.
- Expired, consumed, malformed, or over-attempt challenges fail closed. A pending challenge must never resolve into an authenticated principal or access protected API routes.

## TOTP controls

- Use a vetted standards-compliant TOTP implementation (RFC 6238) with constant-time comparison where applicable.
- Restrict accepted time drift; rate-limit by account and network; enforce attempt ceilings and cooldowns.
- Prevent replay by recording the last accepted time-step per enrolled factor and atomically requiring a strictly newer step.
- Enrollment begins only after recent password re-authentication and an authenticated session. Keep the factor pending until the user confirms a valid code; only then activate it.
- Re-enrollment, replacement, and removal require recent re-authentication, an existing factor or a separately reviewed recovery process, and an audit event.
- Do not reveal whether a supplied code was close, expired, or belonged to another account.

## Recovery and privileged-account controls

- Generate multiple independent high-entropy recovery codes; show them once and encourage secure offline storage.
- Consume a recovery code atomically and permanently on use. Never permit replay.
- Regeneration invalidates all prior codes and requires recent strong authentication.
- Factor reset after loss must use a separately reviewed identity-verification procedure; email-only password recovery must not silently remove MFA.
- Factor disablement, reset, recovery-code use, and privileged-policy exceptions must generate append-only audit events and notify the account through a trusted channel.
- A reset or suspected compromise must revoke active sessions and pending challenges. Consider revoking API credentials as well if introduced later.

## Data model and migration requirements

Before adding schema, inspect current migration ordering and integration fixtures. The proposed model needs:
- enrolled factors with user FK, factor type, encrypted secret material, key version, status, created/confirmed/disabled timestamps, last accepted TOTP step, and rotation metadata;
- pending authentication challenges with hashed opaque token, user FK, expiry, attempt count, consumed timestamp and minimal risk metadata;
- recovery-code verifier rows with user FK, one-time consumed timestamp and creation metadata;
- explicit policy source or role-based policy mapping with a documented default-deny behavior.

Add appropriate uniqueness, FK, expiry and state constraints plus indexes for active factors and pending challenge lookups. Do not put raw secrets, codes, or provisioning data in audit metadata.

## Required tests and release gates

- Password success for an MFA-required account does not create a normal session.
- A valid factor challenge creates exactly one session and a matching audit event transactionally.
- Invalid, expired, replayed, consumed, malformed and over-attempt challenges never create a session.
- TOTP replay is rejected, including concurrent duplicate submissions.
- Enrollment remains pending until confirmation; failed confirmation never activates the factor.
- Recovery codes are one-time, non-replayable, and atomically consumed.
- MFA reset/disable revokes active sessions and pending challenges and is audited.
- Missing KMS/key version, database failure, or verifier outage fails closed.
- Client-supplied roles, MFA flags, factor IDs, and account IDs cannot bypass server-side policy.
- HTTP, PostgreSQL integration, concurrency, rate-limit, audit, and migration tests pass in CI.
- Production KMS configuration, backup/restore, key rotation, alerting, incident response, support recovery procedure, and proxy/browser behavior receive independent review before activation.

## Current limitations

- No MFA factor enrollment, challenge verification, recovery codes, MFA-specific schema, or enforcement is implemented.
- Current login issues a normal session after password verification.
- Account recovery service core exists, but HTTP routes and trusted production email delivery are not connected. Password recovery must not be treated as MFA recovery.
- No production database migration, KMS configuration, CI success, or production activation is confirmed.

## Implementation order

1. Approve privileged-role policy and factor strategy.
2. Establish managed key custody and operational key-rotation process.
3. Implement migration and repository layer with integration tests.
4. Implement pending-challenge state machine and role-policy enforcement before ordinary session issuance.
5. Implement enrollment, TOTP verification/replay prevention, recovery codes and audited reset controls.
6. Add HTTP routes, rate limits, user-facing enrollment/recovery UX and operational alerts.
7. Complete independent security review and controlled staging verification before production enablement.
