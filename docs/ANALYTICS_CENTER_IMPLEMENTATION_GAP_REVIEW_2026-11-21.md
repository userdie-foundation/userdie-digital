# USERDIE Digital — аналитический центр: аудит разрыва между макетом, API и моделью доступа
**Дата:** 21.11.2026  
**Репозиторий:** `userdie-foundation/userdie-digital`  
**Ветка:** `feature/valuation-workspace-api-integration`  
**Контрольная точка до аудита:** `13929c3be5fa5f67fe0639ca539a70e3e77933f2`  
**Статус:** source-level review. Live/staging database and production deployment were not available; no real beneficiary data was accessed.

## 1. Executive finding

The repository contains three distinct layers that must not be presented as one already-operational analytics center:

1. **Management dashboard prototype** — `website/prototype/analytics-dashboard.html`; its eight records are hard-coded synthetic examples. It performs in-browser filtering and aggregation only. The page explicitly marks the sample as demo and says the registry/program integration is not connected.
2. **Analytics data contract** — `website/prototype/analytics-data-contract.html`; it defines a broader target KPI model: incoming flow, active portfolio, median decision time, SLA compliance, overdue portfolio, workload and program outcomes. These definitions are not evidence that the KPIs are implemented or backed by production data.
3. **Backend workspace/valuation APIs** — the current backend has a limited workspace summary and a protected analytical-document lifecycle. The latter supports versioning, independent review, issuance and private PDF retrieval; it is not a general analytics data mart or KPI endpoint.

**Conclusion:** the analytics center is currently at prototype/contract stage for management KPIs, while the analytical-document workflow is implemented in source but still subject to deployment, database-role and acceptance gates.

## 2. Confirmed implementation facts

### 2.1 Dashboard is synthetic, not live

The dashboard script declares a local `cases` array with eight illustrative records and computes totals, status/direction bars, role workload, data-quality counts and management signals from that array. No fetch/API request is made by this page. The dashboard text labels the sample as demo and explicitly says integration with the case/program registry is not connected.

This is the correct fail-safe state for a public static prototype. Do not replace the synthetic array with real beneficiary records or connect the static site directly to PostgreSQL.

### 2.2 KPI contract is broader than current backend summary

The data contract defines, among other things:
- unique incoming cases in a period;
- active portfolio at a dated snapshot;
- median time to first confirmed decision;
- SLA compliance against a valid SLA and complete timestamps;
- overdue active cases with pause rules;
- workload as a proxy rather than labor-time measurement;
- program outcomes with baselines, targets, periods and evidence.

The existing `GET /api/v1/workspace/summary` returns only five aggregate measures: cases total/active/overdue and tasks active/overdue. Its repository scopes data to assigned case-worker records and exact program-manager grants. It is not a substitute for the full KPI contract.

### 2.3 Authorization gap for a dedicated analytics role

The source-level authorization policy contains `analytics:read` for global administrators, global auditors and program managers with an exact program scope. The role map explicitly states that `analyst` is not an existing server role code and that analyst access should default to anonymized or aggregated information. A separate role/scope decision has not been approved.

Do not grant an analyst the administrator, auditor or asset-valuator role as a naming workaround. Do not treat a locally selected UI role as a server-side grant.

### 2.4 Protected analytical-document workflow is a separate capability

The protected `/api/v1/analytical-documents` routes implement document creation, immutable content versions, assigned independent review, decisions, issuance, event/audit records and authorized PDF retrieval. Creation is restricted to the currently implemented valuation/admin grants; independent review requires a distinct assigned reviewer. This workflow does not itself provide KPI aggregation or program-performance analytics.

## 3. Security and correctness issue fixed during this review

The PDF route previously accepted both GET and HEAD. Its handler could generate and persist a PDF artifact and append a download audit event even for a HEAD request, despite returning no response body. That made a metadata-only request capable of causing a write and misclassifying an event as a download.

Corrective change:
- PDF retrieval is now GET-only.
- The `Allow` header now reflects the actual methods for each analytical-document route instead of advertising POST/GET/HEAD indiscriminately.
- A regression test verifies that HEAD on the PDF route returns 405, advertises `Allow: GET`, and does not reach the database.
- The route-method unit assertion was updated accordingly.

Source files changed:
- `backend/src/analytical-documents.mjs`
- `backend/test/analytical-documents.test.mjs`

Commit containing the fix and regression test: `13929c3be5fa5f67fe0639ca539a70e3e77933f2`.

**Verification limitation:** the files were fetched back from GitHub and the expected guard/test were confirmed in the branch. No workflow run or combined status was returned for this SHA at the time of review; therefore the regression test is added but not yet reported as executed/green.

## 4. Required decisions before live analytics implementation

| Decision | Required evidence/owner | Why it blocks implementation |
|---|---|---|
| Dedicated analyst role and exact scope | Foundation governance + security owner | Prevents privilege escalation by reusing auditor/admin roles |
| Which organizational contours an analyst may read | Foundation process owners | A program grant must not silently grant access to the assets or foundation contours |
| Small-cell disclosure policy | Privacy/legal owner | Aggregates for very small cohorts can reveal beneficiary participation |
| Approved KPI dictionary and formulas | Analytics owner + process owners | Prevents inconsistent or misleading management numbers |
| SLA calendars, pauses and start/stop events | Operations + legal owner | Calendar comparison alone cannot establish a breach |
| Data freshness and source lineage | Data owner | Every displayed metric needs source, snapshot time and calculation version |
| Export permission and watermarking | Foundation governance + security | Read permission must not imply export permission |
| Retention and deletion rules for derived aggregates | Privacy owner | Aggregates can remain identifying in small or narrow cohorts |

## 5. Safe implementation sequence

1. Approve the analyst role, scopes and small-group disclosure policy.
2. Finalize a versioned KPI dictionary, including date boundaries, status mapping, SLA calendar, pause rules and outcome evidence.
3. Build a server-side read-only aggregate endpoint. Derive scopes exclusively from the authenticated principal; do not accept user-supplied program/contour IDs as authorization.
4. Return aggregates only — no names, email, case subjects, descriptions, beneficiary identifiers or raw application rows.
5. Include `asOf`, data freshness, source/version metadata and explicit suppression state for metrics withheld under the approved small-group policy.
6. Add positive/negative authorization tests, cross-scope tests, suppression tests, SQL query tests and PostgreSQL integration coverage.
7. Connect the dashboard only after the backend is deployed to a separately approved staging environment and the UI can distinguish live, stale, unavailable and demo data.
8. Keep the static demo dataset synthetic. Never silently blend demo records with live aggregates.

## 6. Current status

- [x] Confirmed dashboard data is synthetic and local-only.
- [x] Compared dashboard content with the KPI data contract.
- [x] Reviewed the existing workspace summary API and access policy.
- [x] Confirmed no dedicated analyst server role is currently approved/implemented.
- [x] Fixed the PDF HEAD side-effect issue and added a regression test.
- [ ] CI execution/result for the fix commit confirmed.
- [ ] Analyst role and scope approved.
- [ ] Small-group disclosure policy approved.
- [ ] KPI dictionary and SLA calendar approved.
- [ ] Read-only analytics API implemented and tested.
- [ ] Staging database and data-freshness acceptance completed.
- [ ] Dashboard connected to a live, approved aggregate endpoint.

**Release position:** do not label the analytics center as live or production-ready. Continue implementation in the feature branch; do not merge, deploy, enable data collection or expose real beneficiary data until the listed controls are accepted.
