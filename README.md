# userdie-digital
Digital platform of USERDIE Foundation

## Project continuity

- [Digital Continuity Record](docs/PROJECT_CONTINUITY.md) — single source of truth for the current checkpoint, decisions, evidence, open work, acceptance criteria and handover instructions.
- [Public prototype design audit](docs/PUBLIC_PROTOTYPE_DESIGN_AUDIT_2026-11-09.md) — current UI findings, visual direction and delivery order for the public prototype.
- [Public content register](docs/PUBLIC_CONTENT_REGISTER.md) — source-backed map of the foundation's charter, public aid directions, programme/project statuses and editorial boundaries.

## Platform architecture and governance

- [Platform architecture](docs/PLATFORM_ARCHITECTURE.md) — organizational contours, functional domains, roles, AI controls, separation of USERDIE Digital / BFU / ZHAKIN Points, security boundaries and implementation stages.
- [Platform recovery and backup plan](docs/RECOVERY_PLAN.md) — planned safeguards and recovery steps. Backup storage, alternate publication, and automatic failover are not considered operational until separately configured and tested.
- [Security readiness review](docs/SECURITY_READINESS_REVIEW.md) — current production blockers, required access-control tests and release gates. This is a design review, not a penetration test or production certification.
- [Secure cabinet blueprint](docs/CABINET_SECURITY_BLUEPRINT.md) — applicant/partner journeys, proposed role boundaries, API/data separation and release acceptance gates.

## Public website source

GitHub Pages is deployed from the `website/` directory by `.github/workflows/deploy-website.yml`. Edit `website/index.html`, `website/styles.css`, and the pages under `website/prototype/` for changes to the published website. The root-level `index.html` is not included in that deployment workflow and must not be treated as the live page source.

After changing public website files, verify the **Deploy public website** workflow result before reporting that the live site has been updated. DNS/HTTPS readiness is checked separately and must not block ordinary repository work.
