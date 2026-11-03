# USERDIE DIGITAL — security readiness review

**Review date:** 2026-11-03  
**Repository:** `userdie-foundation/userdie-digital`  
**Branch:** `main`  
**Reviewed revision:** `0d24afef849f9e86015242bafeb8a4c85ea64a05`  
**Status:** design and repository review; not a penetration test or production certification.

## Executive finding

The repository contains a useful draft API contract and documented case-workflow concepts, including task assignment, SLA state, escalation and append-only event history. The reviewed API contract explicitly states that production authentication is not wired and uses a placeholder server URL. Therefore, the presence of route descriptions, UI screens or access-control wording must not be interpreted as a production-secure service.

The public website and prototype screens must remain demonstrational. Do not collect or enter real beneficiary, donor, employee or partner personal data through static demo pages.

## Evidence reviewed

- `README.md`: public deployment is built from `website/`; the root-level `index.html` is not the live deployment source. A successful deployment must be checked separately after public-site changes.
- `website/index.html`: the public page distinguishes published information, demo workspaces and functionality that still requires implementation.
- `website/prototype/api/openapi.yaml`: draft API contract; server URL is `https://api.example.invalid/v1`; the document states that production authentication is not wired.
- The API contract describes scoped case access, internal workflow visibility, aggregate-only analytics and separately permissioned audit access.
- Latest reviewed commit aligns the workflow API path to `/applications/{application_id}/workflow`.

## Release blockers before any real personal data is processed

1. **Identity and authentication**
   - Select and document the identity provider and token issuer.
   - Validate token signature, issuer, audience, expiry and permitted algorithms server-side.
   - Define MFA requirements for privileged roles, session expiry, revocation and key rotation.
   - Never trust a role, owner, program or user identifier supplied only by the browser.

2. **Authorization and data isolation**
   - Enforce deny-by-default authorization on every server request.
   - Apply record-level scope checks on the server, not in client-side navigation.
   - Test cross-user, cross-program and cross-role access, including direct object-ID substitution.
   - Keep internal task assignments, escalation details and audit records unavailable to applicants and partners.

3. **Personal and sensitive information**
   - Approve the legal basis, privacy notice, retention schedule and deletion/archiving procedure before collection.
   - Minimize fields; prohibit sensitive personal data and free text in analytics and general event payloads unless separately justified and protected.
   - Encrypt transport and stored data; define backup encryption and controlled restoration.
   - Keep production secrets out of Git, static assets, browser bundles and workflow logs.

4. **Audit integrity**
   - Record actor, action, target, timestamp and correlation identifier on security-relevant changes.
   - Prevent ordinary application roles from modifying or deleting audit history.
   - Restrict audit access and log access to the audit log itself.
   - Test append-only behavior, ordering, duplicate/idempotency handling and failure behavior.

5. **Operational readiness**
   - Replace placeholder API endpoints only after infrastructure and ownership approval.
   - Configure secret management, monitoring, alerting, backup and tested recovery.
   - Define incident response contacts and a process for credential/key compromise.
   - Complete dependency and static-analysis checks; review third-party workflow actions and pinning policy.

## Required acceptance tests

- Unauthenticated requests receive no protected data.
- Expired, malformed, wrong-issuer and wrong-audience tokens are rejected.
- An applicant cannot read another applicant's record or internal workflow.
- A partner cannot read internal case tasks, escalations or unrelated partner material.
- A program manager cannot access a program outside the manager's assigned scope.
- Client-supplied role/owner filters cannot widen server-authorized scope.
- Small-cohort analytics are suppressed and direct identifiers/free text are absent.
- Audit records cannot be changed or deleted by ordinary application roles.
- Secrets and personal data do not appear in repository history, static bundles or CI logs.
- Backup restoration is demonstrated in a non-production environment.

## Immediate implementation sequence

1. Approve the role matrix and data classification with the foundation's responsible persons.
2. Select the production identity and backend architecture; document trust boundaries.
3. Implement authentication and server-side authorization before connecting real case data.
4. Add automated negative authorization tests for applicant, partner, case worker, program manager and auditor roles.
5. Run security and privacy acceptance checks using synthetic data only.
6. Only then authorize a limited pilot, with documented approval and rollback criteria.

## Publication and reporting rule

A Git commit is not a deployment. A green static check is not proof of secure production authentication. Report the public website as updated only after the GitHub Pages workflow succeeds and the deployed URL is checked. Report authentication or data processing as production-ready only after the acceptance tests above have passed in the actual deployed environment.
