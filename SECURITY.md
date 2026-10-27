# Security policy — USERDIE DIGITAL

## Reporting a vulnerability
Do not publish credentials, exploit details, or personal data in a public issue. Use the repository owner's private security-reporting channel or GitHub's private vulnerability reporting if enabled for this repository. If neither is available, contact the repository maintainers privately through an already verified channel.

## Automated controls
The `USERDIE security guard` workflow runs on changes to `main`, pull requests targeting `main`, daily, and on manual request. It performs:
- a conservative pattern scan of tracked files for likely exposed credentials (matched values are not printed);
- CodeQL analysis for JavaScript/TypeScript;
- a job summary with the result of each control.

Dependabot is configured in `.github/dependabot.yml` to propose weekly updates to GitHub Actions dependencies. Review and merge dependency updates deliberately; automated updates are not a substitute for release validation.

These checks are detection aids, not a guarantee of security. Pattern scanning can produce false positives and miss secrets, and scanning the current checkout does not audit the complete Git history. Review GitHub's Security tab and repository settings for native secret scanning, push protection, Dependabot alerts, and private vulnerability reporting availability.

## DDoS and live-site protection
GitHub Actions does not mitigate DDoS traffic. Confirm that the public domain is served through a provider with suitable network-layer DDoS mitigation, rate limiting, and, where supported, a web application firewall (WAF). Do not change DNS or enable a proxy without checking existing DNS records and mail-related MX records first. The current workflow does not perform load tests, attack simulations, or active probing.

## Incident response
1. Preserve timestamps, workflow links, and relevant logs; do not publish secret values or beneficiary information.
2. If a credential may be exposed, revoke/rotate it at the issuing provider and remove it from active configuration; history cleanup alone does not revoke it.
3. Review recent commits, repository collaborators, workflow changes, deployment history, and provider security events.
4. If the site is under attack, use the hosting/DNS provider's incident controls and support channel. Avoid unapproved DNS changes.
5. Record the issue, mitigation, owner, and verification evidence in a restricted channel or issue without sensitive payloads.

## Data handling
Never commit real beneficiary, donor, employee, identity, financial-account, or case-file data. Use synthetic test fixtures only. Least privilege, review before production changes, and verified recovery backups are required.
