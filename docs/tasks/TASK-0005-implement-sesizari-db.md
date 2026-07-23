---
id: TASK-0005
title: Migrații + porți de izolare pentru tabelele de sesizări
status: blocked
blocked_by: [ADR-0004]
refs: [FEAT-001, ADR-0002, ADR-0003, ADR-0004]
owner: agent
---

## Scope

Implementarea schemei din specul aprobat în TASK-0004: tabelele de sesizări + istoric
tranziții, politici RLS, extinderea C*/T* cu teste negative cross-tenant pentru fiecare
tabel nou. Numele exacte ale tabelelor se preiau din spec la momentul deblocării.

## Out of scope

UI. Storage de fotografii (blocat de OQ-007/B2). Orice tabel neprevăzut în spec.

## Definition of Done

- [ ] `pnpm db:reset && pnpm test:db` verde, cu teste T* NOI pentru tabelele noi
- [ ] `pnpm guard:migrations` trece (fără pattern-uri periculoase)
- [ ] R-002 rămâne Mitigated: suprafața nouă are teste de frontieră în același PR

## Note de execuție

- TASK-0004 (spec) este `done`. Blocajul real acum este **acceptarea ADR-0004** (funcțiile
  `SECURITY DEFINER` pentru tranziții/atribuiri) — fără ea, migrația nu poate purta markerul
  `-- guard-approved: ADR-0004` cerut de `scripts/check-migrations.mjs`. De aceea `blocked_by`
  este `[ADR-0004]`, nu `[TASK-0004]`. Doar omul acceptă ADR-ul și mută acest task în `ready`.
