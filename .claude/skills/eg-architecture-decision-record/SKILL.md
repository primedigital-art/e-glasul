---
name: eg-architecture-decision-record
description: Creates an e-glasul Architecture Decision Record for a material technical decision with alternatives, consequences, and status. Use when a decision affects architecture, security, tenancy, data, integrations, or long-term maintainability.
argument-hint: "[decision title]"
allowed-tools: Read Grep Glob Write Edit
---

Create an ADR for: **$ARGUMENTS**

Read existing ADRs in `docs/decisions/` and relevant specifications.

Use `template.md` in this skill directory.

## Numbering

- Determine the next available four-digit number.
- File name: `ADR-<NNNN>-<kebab-case-title>.md`.
- Save under `docs/decisions/`.

## Rules

- Write in Romanian.
- Record the context, decision drivers, viable options, decision, and consequences.
- Include security, multi-tenancy, operations, cost, and migration impact where relevant.
- Do not present the preferred option as inevitable.
- Do not use an ADR to hide an unresolved product or legal decision.
- Default status is `Proposed`.
- Do not implement code.

Report the file path and any follow-up decisions required.
