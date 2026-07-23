---
id: TASK-0003
title: Scaffold Vitest în apps/app (fără teste de produs încă)
status: ready
blocked_by: []
refs: []
owner: agent
---

## Scope

Vitest + @testing-library/react în apps/app, cu un singur test smoke (App se randează).
Script `test` în apps/app, agregat în `pnpm test` la rădăcină alături de db-tests.
Pas CI corespunzător.

## Out of scope

Playwright/e2e (vine când există UI real). Teste pentru componente inexistente.
apps/public (Astro) — nu are logică de testat încă.

## Definition of Done

- [ ] `pnpm --filter @e-glasul/app test` trece
- [ ] `pnpm verify` include testele unit
- [ ] CI verde

## Note de execuție
