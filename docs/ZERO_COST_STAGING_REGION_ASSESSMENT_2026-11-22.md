# USERDIE Digital — zero-cost staging architecture and region assessment

**Decision date:** 2026-11-22  
**Approved budget ceiling:** EUR 0/month  
**Scope:** non-production staging only; preparation and provider comparison.  
**Provisioning status:** NOT APPROVED / NOT CREATED. No account, resource, database, bucket, secret, billing method, DNS record or deployment is created by this document.

## 1. Owner decision recorded

- Budget is strictly EUR 0/month.
- Only genuinely free plans/quotas are eligible. Paid trials, expiring credits, automatic upgrades, usage-based overages and paid add-ons are excluded.
- Compare Europe, United States, Russia and Asia-Pacific.
- No production traffic, real beneficiary/donor/employee/partner data, or live intake in this staging environment.
- Do not change DNS/MX or the existing GitHub Pages deployment.
- Do not enable consent collection. Migration 021 remains opt-in and disabled by default.
- Do not connect the public workspace to a remote API until the security and acceptance gates in the backend runbook pass.

## 2. Current technical fit

The backend is a Node.js 22+ service packaged as a Docker image and expects PostgreSQL through the pg driver. It exposes liveness/readiness endpoints and has an explicit migration CLI. The analytical-document workflow expects PDF artifacts outside the public web root in private persistent storage. The workspace adapter remains demo-only while the userdie-api-origin setting is empty.

The current runtime is not a drop-in Cloudflare Worker or generic edge function: `backend/src/index.mjs` starts a Node HTTP server and `pg` connection pool; PDF generation uses PDFKit plus Node filesystem/crypto APIs; migrations read SQL files from disk and require PostgreSQL advisory locks. Moving this unchanged to a serverless edge runtime is not a configuration-only task. It requires a separately designed adapter/runtime, storage API and database connection strategy, with regression tests for authentication, transaction boundaries, PDF immutability and private delivery.

A hosted free-tier service is not automatically suitable for reliable staging:
- the API process may sleep or restart;
- a free database may pause due to inactivity;
- free database tiers may have no managed backups;
- ephemeral application filesystems cannot hold issued PDFs;
- some providers bill overages (or have no enforceable account-level hard stop);
- free-plan quota restrictions may make the service unavailable until the next billing cycle.

Therefore, the only permissible initial data is synthetic test data. Any hosted free-tier deployment is a temporary integration sandbox, not a durable staging or production service. The EUR 0 ceiling takes precedence over convenience: a provider that can bill beyond the free allowance is excluded unless a verifiable hard stop is available and active.

## 3. Provider / service comparison

| Candidate | Free capability relevant to USERDIE | Material limits / risks | Assessment |
|---|---|---|---|
| Supabase Free — PostgreSQL + private Storage | Managed PostgreSQL; 500 MB database per project; 1 GB file storage; 5 GB uncached + 5 GB cached egress; up to two active free projects. PostgreSQL connection string is compatible with the existing pg backend. Private Storage buckets can support protected PDF objects. | Free projects may pause after 7 days of low activity. No automatic backups or PITR on Free. Quota overages lead to notices and service restrictions after a grace period rather than usage overage billing while the project remains on Free; paid add-ons/upgrades must remain disabled. | Suitable as a candidate DB + private PDF object store for synthetic-data tests only. It does not host the existing Node.js API and is not a complete staging environment. |
| Render Free — Node.js web service | Runs the current Node.js service; 750 free instance-hours per workspace/month. | Free service sleeps after 15 minutes idle, may restart, has no persistent disk/SSH/private inbound networking. Outbound bandwidth overage is billable; free Postgres expires after 30 days and has no backups. No verified hard stop prevents overage charges. | EXCLUDED under the strict EUR 0 decision. Do not deploy USERDIE API here. |
| Neon Free — PostgreSQL | PostgreSQL-compatible service; current free plan advertises per-project compute/storage quotas and scale-to-zero. Useful as a DB-only alternative. | No Node API host or private PDF object store as a complete solution. Free compute/storage quotas and regions must be rechecked at account creation; scale-to-zero adds cold starts. | Viable alternative to Supabase for DB-only tests, but creates a second provider for PDF storage and more operational pieces. |
| Cloudflare Workers Free + R2 | Workers Free: 100,000 requests/day and 10 ms CPU per invocation. R2 Standard free allowance: 10 GB-month, 1 million Class A requests, 10 million Class B requests, no egress fee. R2 supports EU and US jurisdiction restrictions. | Current backend is a Node.js Docker service, not a Cloudflare Worker; adoption requires a reviewed runtime/architecture adaptation. R2 is object storage, not PostgreSQL. R2 usage beyond free allowances is billed; no verified hard stop is available for this use case. | EXCLUDED as a hosted API + PDF solution under the strict EUR 0 decision. Revisit only after a separate adapter design and verified zero-billing controls. |
| Yandex Cloud — Russia | Monthly free quotas include Cloud Functions, Serverless Containers, API Gateway, Object Storage and YDB. Russia region is available. | Once the free quota is exhausted, charges apply. No verified hard stop prevents billing. YDB is not PostgreSQL; current backend expects PostgreSQL. Managed PostgreSQL/VM capacity is not established as a permanent zero-cost option. | EXCLUDED under the strict EUR 0 decision unless a hard billing stop and PostgreSQL-compatible service are independently verified. |

Provider limits are subject to change. Before any account/resource creation, re-check the linked official pricing and limitations pages and capture the exact plan, region, quotas, payment requirements and overage behavior.

## 4. Geographic comparison

### Europe — Frankfurt (eu-central-1)
- Supabase lists Central EU (Frankfurt) as an exact region; the selected region holds the primary Postgres, Auth and Storage data.
- Cloudflare R2 supports an EU jurisdiction bucket, which guarantees storage/processing within that jurisdiction; ordinary location hints are best-effort only.
- Good technical default for a Europe-facing test environment and EU data-residency planning.
- A region selection alone is not a GDPR compliance determination. DPA, subprocessors, transfer terms, access controls and retention still require review.

**Assessment:** preferred region for a future synthetic-data integration sandbox. Region selection is approved provisionally, but resource creation remains blocked because no hosted API service has yet met the zero-billing condition.

### United States — North Virginia (us-east-1)
- Supabase lists East US (North Virginia) as an exact region.
- Cloudflare R2 supports a US jurisdiction bucket.
- Suitable if the primary user base, operating team and future hosting strategy are US-centered.
- If EU/UK personal data is later processed, assess transfer mechanisms, processor terms and applicable privacy requirements before use.

**Assessment:** technically viable alternative; not preferred absent a US-centered audience or operational reason.

### Russia — ru-central1
- Yandex Cloud provides a Russia region and quota-based free allowances for serverless compute, object storage and YDB.
- The current backend requires PostgreSQL. YDB is not a drop-in PostgreSQL replacement; moving to it would be a separate architecture decision and code change.
- The free tier is usage-limited and can become billable after quota exhaustion. It is not accepted as a guaranteed EUR 0 service without an enforceable billing stop and verified account eligibility.
- Under Article 18(5) of Russian Federal Law 152-FZ, when collecting personal data of Russian citizens, the listed operations must use databases located in Russia, subject to statutory exceptions. This needs legal review for the Foundation's actual data flows.

**Assessment:** reserve as a separate compliance-led track if the platform will collect/process personal data of Russian citizens. Do not send such data to an EU/US sandbox. At present, no zero-cost, PostgreSQL-compatible, persistent Russian hosting stack has been verified.

### Asia-Pacific — Singapore (ap-southeast-1)
- Supabase lists Singapore as an exact region.
- Appropriate if the first operational audience or partner network is concentrated in APAC.
- Adds no clear advantage for the current Foundation use case without a defined APAC user/data-residency requirement.

**Assessment:** technically viable, but not preferred at this stage.

## 5. Recommended zero-cost sequence

### Phase A — no-cloud baseline (can proceed without external account creation)
1. Keep using GitHub Actions' disposable PostgreSQL 16 service for integration tests.
2. Run migration sequence validation through 021 in CI; do not apply migrations to production.
3. Run the Docker build and container smoke test from the current reviewed main revision.
4. Add automated checks for private PDF path handling, file permissions, checksum verification and rejection of public/static paths.
5. Keep all fixtures synthetic; keep account recovery and consent collection fail-closed.
6. Record the deployed commit and every test result. CI success is not a hosted staging deployment.

### Phase B — optional hosted sandbox, only after separate approval
Proposed candidate architecture for evaluation:
- API: Render Free Node.js web service.
- Database: Supabase Free PostgreSQL, exact region Frankfurt (eu-central-1) for the first synthetic-data trial.
- PDF artifacts: Supabase private Storage bucket in the same project/region, with server-side authorization and short-lived signed downloads; never store PDFs on the Render filesystem.
- Secrets: provider protected environment settings only; no secrets in GitHub source or public Pages.
- Data: synthetic test accounts/documents only.
- Email recovery: remain disabled until a free delivery path, verified sender, secret handling and full end-to-end reset test are proven without charge.
- Backups: export encrypted synthetic DB fixtures and test restore outside the provider; do not claim provider-managed backup coverage on Free.

This is a candidate for a disposable integration sandbox, not a final production architecture. Render free service sleep/restart and Supabase free-project pausing mean it cannot be treated as continuously available.

Before creating it, verify:
- no payment card or auto-upgrade is required; if a card is required, stop and return for approval;
- usage can be hard-stopped at zero rather than billed on overage;
- selected API and DB regions are available on the exact free plans;
- private bucket policies prevent public listing and anonymous access;
- account ownership, MFA and recovery contacts are under Foundation control;
- no cross-region copy or telemetry of personal data is enabled.

If any provider cannot guarantee a hard EUR 0 boundary, do not create resources there.

## 6. Region recommendation and decision gate

**Technical recommendation for synthetic-data testing:** Europe / Frankfurt.

**Legal/data-residency override:** if the staging environment ever receives personal data of Russian citizens, stop the EU/US plan and obtain a Russia-localized architecture and legal review first. Staging should remain synthetic-only until that review is complete.

**No deployment authorization is implied by this assessment.** A separate approval is required for the exact provider accounts, service names, regions, billing posture and creation of each resource.

## 7. Official references checked on 2026-11-22

- Supabase Free plan and quotas: https://supabase.com/pricing
- Supabase inactivity pause: https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase available regions / data residency: https://supabase.com/docs/guides/platform/regions
- Render Free services, disk and Postgres limitations: https://render.com/docs/free
- Neon Free plan overview: https://neon.com/blog/how-to-make-the-most-of-neons-free-plan
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare R2 pricing/free tier: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 jurisdiction and data location: https://developers.cloudflare.com/r2/reference/data-location/
- Yandex Cloud free tier: https://yandex.cloud/ru/docs/billing/concepts/serverless-free-tier
- Yandex Cloud regions: https://yandex.cloud/en/docs/overview/concepts/region
- Russian Federal Law 152-FZ, Article 18: https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/

## 8. Acceptance status

- [x] EUR 0/month ceiling recorded.
- [x] EU, US, Russia and APAC compared.
- [x] Existing backend's PostgreSQL and private PDF requirements considered.
- [x] Free-tier pause, storage, backup and overage risks identified.
- [x] No production, DNS/MX or real personal data changes authorized.
- [x] Frankfurt selected as provisional preferred region, not as provisioning authorization.
- [x] Render Free excluded because outbound bandwidth overage is billable.
- [x] Yandex Cloud excluded until a hard billing stop is demonstrated.
- [x] Supabase Free assessed as DB/private-storage candidate only, not a full API host.
- [ ] A complete hosted API + PostgreSQL + private-storage stack with a verifiable hard EUR 0 limit identified.
- [ ] Provider/account and payment requirements independently verified.
- [ ] Separate approval to create exact resources received.
- [ ] Hosted staging provisioned and independently tested.
