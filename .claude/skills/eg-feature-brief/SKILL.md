---
name: eg-feature-brief
description: Creates or updates a structured e-glasul feature brief before design or implementation. Use for a new material feature, a major behavior change, or when scope and acceptance criteria are unclear.
argument-hint: "[feature name]"
allowed-tools: Read Grep Glob Write Edit
---

Create or update a feature brief for: **$ARGUMENTS**

Read:

- `CLAUDE.md`
- `.claude/rules/product-scope.md`
- existing related files under `docs/product/`

Use `template.md` in this skill directory as the required structure.

## Rules

- Write in Romanian.
- Use a lowercase kebab-case slug.
- Save to `docs/product/features/<slug>-brief.md`.
- Separate facts, assumptions, and open questions.
- Classify the feature against the active phase.
- Keep acceptance criteria observable and testable.
- Include negative and edge cases.
- Do not make technology decisions.
- Do not implement code.
- Do not invent legal or municipal requirements.
- If critical information is unavailable, document the gap and mark the brief `Draft` rather than guessing.

At the end, report:

- output path
- status
- unresolved blockers
- recommended next agent
