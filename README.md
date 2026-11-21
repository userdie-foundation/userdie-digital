# userdie-digital
Digital platform of USERDIE Foundation

## Project continuity

- [Digital Continuity Record](docs/PROJECT_CONTINUITY.md) — single source of truth for the current checkpoint, decisions, evidence, open work, acceptance criteria and handover instructions.
- [Post-merge operational acceptance plan](docs/POST_MERGE_OPERATIONAL_ACCEPTANCE_2026-11-21.md) — verified PR #29 checkpoint, staging/database acceptance gates, valuation workflow tests, privacy-consent controls and deployment restrictions.
- [Public prototype design audit](docs/PUBLIC_PROTOTYPE_DESIGN_AUDIT_2026-11-09.md) — current UI findings, visual direction and delivery order for the public prototype.
- [Public content register](docs/PUBLIC_CONTENT_REGISTER.md) — source-backed map of the foundation's charter, public aid directions, programme/project statuses and editorial boundaries.

## Platform architecture and governance

- [Platform architecture](docs/PLATFORM_ARCHITECTURE.md) — organizational contours, functional domains, roles, AI controls, separation of USERDIE Digital / BFU / ZHAKIN Points, security boundaries and implementation stages.
- [Platform recovery and backup plan](docs/RECOVERY_PLAN.md) — planned safeguards and recovery steps. Backup storage, alternate publication, and automatic failover are not considered operational until separately configured and tested.
- [Security readiness review](docs/SECURITY_READINESS_REVIEW.md) — current production blockers, required access-control tests and release gates. This is a design review, not a penetration test or production certification.
- [Secure cabinet blueprint](docs/CABINET_SECURITY_BLUEPRINT.md) — applicant/partner journeys, proposed role boundaries, API/data separation and release acceptance gates.

## Legal compliance

- [Legal compliance register](docs/LEGAL_COMPLIANCE_REGISTER_2026-11-19.md) — Russian legal-document inventory, processing obligations, publication gates and official sources.
- [Russian legal drafts](docs/LEGAL_DRAFTS_RU_2026-11-19.md) — draft privacy policy, website terms, standalone consent templates, image/story release and donation/volunteer/partner requirements.
- [International legal framework](docs/INTERNATIONAL_LEGAL_FRAMEWORK_2026-11-19.md) — GDPR/UK GDPR applicability, EU SCC, Convention 108, UN disability and child-rights instruments, and country-by-country contract controls.
- [International agreement templates](docs/INTERNATIONAL_AGREEMENT_TEMPLATES_2026-11-19.md) — MoU, DPA, controller-to-controller sharing, restricted grants/donations, volunteer agreement, image/story release and country clearance checklist.
- [Internal legal controls](docs/LEGAL_INTERNAL_CONTROLS_2026-11-19.md) — draft orders, processing register, subject-request and incident forms, DPA clauses, international MoU and safeguarding controls.

## Public website source

GitHub Pages is deployed from the `website/` directory by `.github/workflows/deploy-website.yml`. Edit `website/index.html`, `website/styles.css`, and the pages under `website/prototype/` for changes to the published website. The root-level `index.html` is not included in that deployment workflow and must not be treated as the live page source.

After changing public website files, verify the **Deploy public website** workflow result before reporting that the live site has been updated. DNS/HTTPS readiness is checked separately and must not block ordinary repository work.
