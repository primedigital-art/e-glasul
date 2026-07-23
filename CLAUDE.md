# e-glasul — Project Instructions

## Product mission

e-glasul is a multi-tenant civic platform that helps citizens communicate with local public administrations and helps municipal staff manage requests transparently and efficiently.

The product must feel simple enough to use without training, while its internal architecture, security, auditability, and data isolation must be production-grade.

## Current delivery phase

We are currently designing and building **Phase 1 — MVP**.

### Citizen experience

- Submit a public-space issue with photo, category, description, and map location.
- Track status: `received -> in_progress -> resolved`.
- View before/after evidence where appropriate.
- Receive public announcements and optional push notifications.
- View useful municipal information.
- Submit simple online requests with document upload.
- Receive a registration number by email.

### Municipality administration

- Review and filter incoming issues.
- Assign an issue to a responsible person or department.
- Change status with a traceable history.
- Publish and schedule announcements.
- Export issue lists to PDF and spreadsheet formats.

### Management dashboard

- Show verifiable operational metrics.
- Every metric must have a written definition and reproducible calculation.
- Do not design political persuasion or election-campaign functionality.

## Explicitly deferred

Do not implement Phase 2 or Phase 3 unless the user explicitly approves a scope change.

Deferred examples:

- Ghiseul.ro integration
- appointment scheduling
- transparency portal
- surveys
- AI assistant / RAG
- complex external integrations
- native mobile applications
- microservices

## Delivery principles

1. Prefer a modular monolith for Phase 1 unless an approved ADR justifies otherwise.
2. Design multi-tenancy and tenant isolation from the beginning.
3. Do not over-engineer speculative future requirements.
4. Do not trade away security, accessibility, auditability, or data integrity for speed.
5. Keep workflows understandable to municipal staff with limited digital experience.
6. Use plain Romanian for citizen-facing content.
7. Separate facts, assumptions, decisions, and unresolved questions.
8. Never invent legal requirements or municipal procedures.
9. Never expose secrets, service keys, personal data, or cross-tenant data.
10. Never claim a feature is complete without verification evidence.

## Required workflow for material features

Before implementation:

1. Create or update a feature brief.
2. Review domain and public-sector implications.
3. Create a technical specification.
4. Record material architectural decisions in an ADR.
5. Define acceptance criteria and edge cases.
6. Identify security, privacy, accessibility, data, and tenant-isolation impact.

Implementation may start only when critical unknowns are resolved or explicitly recorded as accepted risks.

## Documentation locations

- Product briefs: `docs/product/features/`
- Domain notes: `docs/product/domain/`
- Technical specifications: `docs/architecture/specs/`
- Architecture diagrams and system views: `docs/architecture/`
- Architecture decisions: `docs/decisions/`
- Open questions and risks: `docs/project/`

## Agent delegation

Use project subagents proactively:

- `eg-civic-product-strategist` for scope, outcomes, users, priorities, and acceptance framing.
- `eg-public-sector-domain-expert` for municipal workflows, terminology, domain assumptions, and official-source research.
- `eg-solution-architect` for boundaries, data flows, non-functional requirements, technical specifications, and ADRs.

The main agent remains responsible for integrating their outputs and resolving conflicts.

## Language

- Code, identifiers, schemas, commits, and technical file names: English.
- Citizen-facing UI copy: Romanian.
- Project documentation: Romanian by default, unless the user requests English.
- Preserve Romanian diacritics in UI and documentation.

## Technology decisions

The application stack is not locked by this package.

Do not initialize frameworks or databases until the architecture baseline and first ADRs are approved. Technology choices must be justified against:

- multi-tenancy
- security
- maintainability
- deployment cost
- team capability
- PWA requirements
- map/GIS needs
- file handling
- auditability
- operational simplicity

## Definition of done for planning artifacts

A planning artifact is complete only when it contains:

- purpose and scope
- users and roles
- assumptions
- out-of-scope items
- functional requirements
- non-functional requirements where relevant
- acceptance criteria
- edge cases
- dependencies
- risks
- open questions
- owner or next action for unresolved items

## Autonomous work

Autonomous or semi-autonomous work follows `.claude/rules/autonomy.md` without exception.
Work items live in `docs/tasks/` (see `docs/tasks/README.md`). The agent only picks tasks
with status `ready`. Open questions are resolved by the human, never by the agent.
