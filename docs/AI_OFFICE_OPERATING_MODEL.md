# USERDIE DIGITAL — AI Office operating model

**Date:** 2026-11-03  
**Repository:** `userdie-foundation/userdie-digital`  
**Status:** architecture baseline; not evidence that autonomous agents are deployed or running.

## 1. Purpose

Define a controlled AI-office model for the Foundation's digital platform. AI assistants may prepare drafts, classify work, detect inconsistencies, summarize evidence and recommend next actions. They do not acquire legal authority, approve payments, make beneficiary eligibility decisions, sign documents or change financial records autonomously.

The Foundation remains the accountable organization. The two internal organizational contours — Asset Valuation Center and Analytical Center — are functional units in this model, not separate legal entities unless their legal status is formally established.

## 2. Operating principles

1. **Human accountability:** every consequential decision has a named human owner.
2. **Least privilege:** each agent receives only the minimum data and actions required for its assigned task.
3. **Evidence first:** outputs distinguish verified facts, source-backed estimates, assumptions and unknowns.
4. **No hidden execution:** agents cannot send messages, publish content, move funds, change access or alter source records without explicit authorization.
5. **Traceability:** each task records its source, owner, status, evidence references, proposed action and human decision.
6. **Privacy by design:** use synthetic or minimized data during development; no real beneficiary or donor personal data in public demo pages.
7. **Fail closed:** missing identity, permissions, source evidence or approval means the task is paused, not guessed through.

## 3. Agent register

| ID | Agent role | Primary responsibility | Allowed outputs | Human approval boundary |
|---|---|---|---|---|
| AO-01 | AI Office Coordinator | Intake, routing, prioritization, status summaries and overdue-task alerts | Task cards, routing proposals, daily/weekly reports | Human confirms priority changes and assignment of sensitive cases |
| AO-02 | Technical Reliability Agent | Link checks, 404 detection, static build checks, deployment evidence review | Defect reports, test results, proposed fixes | Human approves production changes and releases |
| AO-03 | Product and Accessibility Agent | Navigation consistency, responsive UI review, accessibility checklist | UI findings, acceptance criteria, design proposals | Human approves visual/product direction |
| AO-04 | Asset Valuation Analyst | Asset register structure, valuation inputs, comparable evidence and scenario analysis | Valuation workpapers, ranges, assumptions, source register | Qualified human reviewer approves valuation conclusions |
| AO-05 | Analytical Center Agent | Aggregated indicators, program performance, trend and risk summaries | Aggregate dashboards and analytical briefs | Human validates methodology and publication |
| AO-06 | International Legal Research Agent | Comparative legal research, jurisdiction issue spotting, source-backed legal drafts | Research notes, issue lists, draft clauses and questions | Licensed/authorized human lawyer approves legal advice and documents |
| AO-07 | Security and Privacy Agent | Threat-model checklist, access-control review, privacy and data-leak checks | Risk register, test cases, remediation proposals | Security owner approves risk acceptance and production access |
| AO-08 | Finance and Treasury Control Agent | Reconciliation support, double-approval checks, BFU register consistency | Reconciliation reports, exception alerts, draft controls | Humans approve all payments, transfers, minting and treasury actions |
| AO-09 | Partnership and Grant Agent | Grant calendar, partner due diligence checklist, proposal completeness | Draft applications, partner briefs, deadline alerts | Human approves representations, commitments and submissions |
| AO-10 | Documentation and Audit Agent | Versioned records, decision logs, evidence completeness and reporting packs | Audit-ready summaries and missing-evidence alerts | Records owner approves official record closure |

## 4. Task lifecycle

Every task should follow this lifecycle:

`received → classified → assigned → evidence_gathering → draft_ready → human_review → approved_or_rejected → closed`

Additional states:

- `blocked`: a required source, permission or decision is missing.
- `escalated`: a deadline, security issue or material risk requires a responsible person's attention.
- `cancelled`: the task is withdrawn with a recorded reason.

A task is not complete merely because an agent generated text. Completion requires the defined acceptance criteria and, where applicable, a recorded human decision.

## 5. Minimum task record

Each task should carry:

- `task_id`: immutable unique identifier;
- `agent_id` and `agent_version`;
- `created_at`, `updated_at`, and due date/SLA;
- `requester_role` and accountable human owner;
- `organizational_contour`: `foundation`, `asset_valuation`, or `analytics`;
- `classification`: public, internal, confidential, or restricted;
- `objective`, `acceptance_criteria`, and `status`;
- source references and evidence timestamps;
- proposed output/action and risk level;
- approval decision, approver role, timestamp and rationale;
- audit correlation ID.

Do not place beneficiary names, identity documents, health details, bank details, credentials or unrestricted personal narratives in general task titles, analytics or agent logs.

## 6. Approval matrix

| Action | Agent may prepare | Human approval required |
|---|---:|---:|
| Draft internal report | Yes | Before official circulation |
| Classify a public technical defect | Yes | Before production modification |
| Recommend a case route or priority | Yes | Yes, by authorized case owner |
| Determine beneficiary eligibility | No autonomous decision | Always |
| Issue legal opinion or sign legal document | Draft research only | Authorized lawyer |
| Approve asset valuation | Prepare workpaper only | Qualified reviewer |
| Submit grant or partner commitment | Prepare draft only | Authorized representative |
| Change user roles or permissions | Recommend only | Security/admin owner |
| Publish public content | Prepare draft only | Communications owner |
| Move funds, mint or burn tokens | No | Explicit multi-person approval and technical controls |

## 7. Separation of organizational contours

- **Foundation:** mission, beneficiary services, programs, partnerships, governance and accountable decisions.
- **Asset Valuation Center:** valuation methodology, asset inventory, evidence and valuation workpapers.
- **Analytical Center:** aggregate indicators, program analytics, scenarios and strategic reporting.

The platform must not imply that either Center is an independent legal entity. Access should be assigned by role and task, not merely by organizational label.

## 8. BFU and financial safeguards

BFU-related functions must remain separated from ordinary platform task management:

- BFU Treasury: multisignature control; no agent-controlled signing keys.
- BFU Wallet: non-custodial interface; no private-key collection or storage by the platform.
- BFU Exchange: test environment only until legal, technical and operational approvals are complete.
- Accrual register: immutable event history, idempotency controls and dual human approval for consequential entries.

AI agents may reconcile records and flag anomalies. They must not initiate or authorize transfers, minting, burning, exchange operations or changes to treasury signers.

## 9. Technical implementation gates

Before connecting agents to real data or tools:

1. Approve a role-to-permission matrix and data classification.
2. Establish authenticated service identities and server-side authorization.
3. Create a task/event schema with immutable audit correlation.
4. Add per-agent tool allowlists and action-level approval gates.
5. Use synthetic fixtures for integration and negative authorization tests.
6. Add timeouts, retry limits, idempotency and human escalation.
7. Record model/version, prompt/configuration version and source references for reproducibility.
8. Complete privacy, security and operational review before any production pilot.

## 10. Initial implementation sequence

**Phase A — governance baseline:** approve agent register, task lifecycle, approval matrix and data classification.

**Phase B — read-only assistants:** implement task summaries, repository checks, documentation completeness and aggregate reporting against synthetic or approved low-risk data.

**Phase C — controlled workflow integration:** connect task routing and role-scoped records after authentication and authorization are deployed and tested.

**Phase D — limited pilot:** activate selected agents with named human owners, monitoring, rollback and documented acceptance criteria.

No agent should be described as active, autonomous or production-ready until its implementation, permissions, monitoring and successful tests are independently verified.

## 11. Acceptance criteria

- Every task has a human owner and an agent identity/version.
- Every consequential recommendation includes evidence and uncertainty labels.
- Agents cannot read records outside their authorized scope.
- Applicants and partners cannot access internal assignments, escalations or audit material.
- No agent can execute financial, legal-signature, eligibility, permission or publication actions autonomously.
- Approval and rejection decisions are attributable and auditable.
- Failure to obtain authorization or evidence pauses the task.
- Production readiness is reported only after tests on the deployed environment.
