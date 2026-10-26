# userdie-digital
Digital platform of USERDIE Foundation

## Operations and resilience

- [Platform recovery and backup plan](docs/RECOVERY_PLAN.md) — planned safeguards and recovery steps. Backup storage, alternate publication, and automatic failover are not considered operational until separately configured and tested.

## Public website source

GitHub Pages is deployed from the `website/` directory by `.github/workflows/deploy-website.yml`. Edit `website/index.html`, `website/styles.css`, and the pages under `website/prototype/` for changes to the published website. The root-level `index.html` is not included in that deployment workflow and must not be treated as the live page source.

After changing public website files, verify the **Deploy public website** workflow result before reporting that the live site has been updated. DNS/HTTPS readiness is checked separately and must not block ordinary repository work.
