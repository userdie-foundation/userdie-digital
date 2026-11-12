# USERDIE Digital — secure cabinet implementation blueprint

**Prepared:** 2026-11-12  
**Scope:** applicant cabinet, partner workspace, staff workspace and their API/security boundary.  
**Status:** implementation blueprint based on repository inspection; not a production security approval.

## 1. Current verified boundary

The public pages under `website/prototype/` are static demonstrations. The applicant page explicitly states that application submission is disabled. The partner page describes a concept without authentication or data exchange. Neither page contains a working submission form, browser persistence, or a connected API client.

The separate `backend/` directory contains a Node.js HTTP service and PostgreSQL schema. Source code includes password login/session handling, server-side principal resolution, scoped role grants, protected read routes, workflow reads, a narrow task-status transition route, and partnership persistence migration 014. This is source-level capability only.

The following remain unavailable or unverified:
- No confirmed backend hosting, staging environment, production database, secret manager, or backend deployment.
- No confirmed execution of migrations 001–014 against a live database.
- The runtime entry point does not inject the account-recovery service; recovery routes fail closed with `503 recovery_unavailable`.
- MFA persistence schema exists, but enrollment, verification, managed key custody, challenge consumption, and enforcement are not implemented.
- Application intake and collection endpoints are deliberately disabled; the application collection route returns `503 applications_module_unavailable`.
- Partnership persistence exists, but partner HTTP routes and controlled evidence upload/download are not implemented.
- No file scanning, notification delivery, or operational case-management intake is deployed.

**Do not collect real applicant, beneficiary, donor, employee, or partner personal data through the static pages or an unapproved API deployment.**

## 2. Product contours

Keep three organizational contours distinct in data access and reporting:
1. Foundation «УСЕРДИЕ» — beneficiary support, case management, programmes, governance.
2. Asset Valuation Centre — asset records, evidence, valuation workpapers and approvals.
3. Analytical Centre — aggregated indicators, programme analysis and management reporting.

A user's membership in one contour must not imply access to another. BFU and ZHAKIN Points remain separate projects and are not authentication roles or automatic data-sharing domains.

## 3. Identity and role model

Roles are proposals pending formal approval and a documented access matrix. Authorization must be enforced on the server for every resource and action; hiding a UI element is not a security control.

| Role | Permitted scope (proposed) | Explicit exclusions |
|---|---|---|
| Applicant | Own profile, own submitted applications, public programme directory, own status messages | Other applicants, internal notes, staff tasks, audit log |
| Partner representative | Own organization profile, explicitly shared partnership records and approved evidence | Beneficiary case files, internal workflow, unrelated partners |
| Case worker | Assigned cases only; minimum fields needed for support | Unassigned cases, system configuration, grant administration |
| Programme manager | Exact programme scope and approved programme reporting | Other programmes and unrelated personal case details |
| Independent approver | Assigned approval packet and evidence required for that decision | Initiating and approving the same high-impact action |
| Asset valuation expert | Assigned asset dossier and valuation workpapers | Beneficiary case records unless separately authorized |
| Analyst | Aggregated or de-identified indicators by approved contour | Direct identifiers and unrestricted free text |
| Auditor | Read-only approved audit evidence and control records | Editing business data or audit history |
| Platform administrator | Technical configuration and operational health | Automatic entitlement to read beneficiary or donor content |

No role should be granted by browser input. User, role, owner, organization, programme and contour scope must come from trusted server-side records. Grant issuance and revocation must be authorized, audited and tested for immediate effect.

## 4. Applicant journey — controlled sequence

1. **Public information:** visitor reads eligibility, programme scope, contact routes, privacy notice and accessibility information without authentication.
2. **Account access:** verified identity workflow, secure login, session controls and account recovery. Do not expose whether an email address is registered.
3. **Draft preparation:** collect only the minimum fields required for a defined service. Explain purpose and legal basis before asking for sensitive information.
4. **Submission:** server validates the request, checks consent/notice acknowledgement where applicable, records an immutable receipt and assigns a non-guessable reference.
5. **Triage:** authorized staff receive the case in a restricted queue. Assignment, reassignment and priority changes are audited.
6. **Review and decision:** state transitions follow an approved workflow with deadlines, responsible roles and independent approval where required.
7. **Applicant communication:** disclose only the applicant's own status and approved messages; notifications must not expose diagnoses or case details on lock screens or email subjects.
8. **Closure and retention:** apply the approved retention schedule, legal holds, export and deletion/archiving procedure.

Until steps 2–8 are implemented and accepted in a controlled staging environment, the public page must continue to state that online submission is unavailable.

## 5. Partner journey — separate data boundary

1. Partner organization is created or matched against the organization directory by an authorized staff member.
2. A representative's authority is verified outside the public registration form before any access is granted.
3. Partnership request is recorded as pending; independent approval is required before a relationship becomes active-confirmed.
4. Evidence metadata and private object storage are separated. The public website must never host confidential agreements or uploaded identity documents.
5. Partner access is limited to its own organization and explicitly shared records. Sharing with beneficiary case records is prohibited by default.
6. Every grant, evidence access, approval and status change is audited.

Migration 014 provides persistence groundwork and a database guard for independent confirmation; it does not create these partner-facing routes or file-transfer controls.

## 6. Minimum technical architecture before intake

- **Identity:** PostgreSQL-backed users and sessions; opaque random session tokens; only token digests stored; host-only Secure, HttpOnly, SameSite cookies; session rotation and revocation.
- **Authentication:** strong password verifier, account/network throttling, generic errors, administrator bootstrap procedure and MFA for privileged roles.
- **Authorization:** deny by default; record-level checks; scoped grants loaded from trusted storage; negative tests for cross-user, cross-program, cross-organization and cross-contour access.
- **Application service:** explicit state machine, validated schemas, idempotency keys, transactional status history and audit event creation.
- **Document service:** private object storage, short-lived authorized download URLs, file size/type limits, malware scanning, content-disposition controls, encryption and retention metadata.
- **Audit:** append-only event history; restricted database ownership; actor, action, target, timestamp and correlation identifier; no sensitive free text in generic metadata.
- **Privacy:** approved purpose/legal basis, notice, minimization, retention, access/export/correction/deletion procedures and incident response.
- **Operations:** managed secrets, TLS and proxy review, database backups with tested restore, monitoring, alerting, incident runbooks and named service ownership.

## 7. API and deployment boundary

The current public website is deployed through GitHub Pages from `website/`. The backend is not part of that static deployment. Do not put database credentials, API secrets, session tokens or private documents in GitHub Pages, static JavaScript, repository fixtures or workflow logs.

Before connecting a browser client:
- choose and approve backend hosting, database hosting, TLS termination, secret management and deployment owner;
- create a non-production environment with synthetic data only;
- configure `DATABASE_URL`, exact `ALLOWED_ORIGIN`, login/recovery HMAC keys and database TLS through a secret manager;
- review the actual proxy topology and Origin/CSRF behavior;
- apply migrations through a controlled, backup-verified process;
- run unit, HTTP and PostgreSQL integration tests against that environment;
- complete independent security testing and the acceptance tests below;
- approve a limited pilot, rollback plan, monitoring and incident contacts.

## 8. Release acceptance gates

A cabinet is not ready for real data until all gates pass:

- [ ] Backend deployment and database ownership are documented and independently verified.
- [ ] Migrations 001–014 are applied in the intended environment and migration state is recorded.
- [ ] MFA is enforced for privileged roles; recovery delivery is configured and tested.
- [ ] Cross-user, cross-program, cross-organization and cross-contour negative authorization tests pass.
- [ ] Applicant cannot read another applicant's record or internal workflow.
- [ ] Partner cannot read internal case tasks, beneficiary data or unrelated partner material.
- [ ] High-impact actions enforce maker-checker separation and append-only audit.
- [ ] File upload/download controls, malware scanning and private storage pass security tests.
- [ ] Privacy notice, legal basis, data minimization and retention schedule are approved.
- [ ] Backups are restored successfully in a non-production exercise; RPO/RTO are defined.
- [ ] Monitoring, alerting, incident response and named operational ownership are in place.
- [ ] Accessibility acceptance covers keyboard, screen reader, contrast, zoom and alternative contact route.
- [ ] Human acceptance test passes using synthetic records before any limited real-data pilot.

## 9. Immediate next engineering sequence

1. Keep public applicant and partner pages informational and fail-closed.
2. Reconcile backend documentation with the actual runtime wiring and migration inventory.
3. Complete authentication lifecycle, recovery delivery and MFA in non-production.
4. Implement and test application intake as a distinct service with explicit workflow and privacy controls.
5. Implement partner routes only after representative verification and independent approval controls are agreed.
6. Add private document handling and notifications only after threat modelling and operational controls.
7. Connect the front-end to the approved API only after all release gates are signed off.

**Decision rule:** do not trade privacy or access control for a faster visual demonstration. A visible form is not a functioning or safe service.
