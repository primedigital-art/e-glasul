---
id: TASK-0005
title: Migrații + porți de izolare pentru tabelele de sesizări
status: blocked
blocked_by: [TASK-0004]
refs: [FEAT-001, ADR-0002]
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
