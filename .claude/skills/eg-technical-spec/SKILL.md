---
name: eg-technical-spec
description: Produces an implementation-ready technical specification for an approved e-glasul feature after product and domain review. Use before application code is written or when a material technical behavior changes.
argument-hint: "[feature slug or brief path]"
allowed-tools: Read Grep Glob Write Edit
---

Create or update the technical specification for: **$ARGUMENTS**

Read:

- `CLAUDE.md`
- `.claude/rules/architecture.md`
- `.claude/rules/security.md`
- the approved feature brief
- the corresponding domain review
- related ADRs and specifications

Use `template.md` in this skill directory.

## Preconditions

Do not mark the specification implementation-ready when:

- the feature brief is not approved
- critical domain questions are unresolved
- authorization behavior is undefined
- tenant ownership is undefined
- workflow transitions are undefined
- file access is undefined where uploads exist
- important failure behavior is undefined

## Rules

- Write in Romanian; retain technical identifiers in English.
- Save to `docs/architecture/specs/<feature-slug>.md`.
- Define contracts and behavior, not line-by-line implementation.
- State security and tenant-isolation decisions explicitly.
- State migration and rollback implications.
- Include test strategy and observability.
- Identify required ADRs.
- Do not implement code.

Finish with an implementation-readiness decision and blockers.
