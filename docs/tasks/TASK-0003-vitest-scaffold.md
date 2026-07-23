---
id: TASK-0003
title: Scaffold Vitest în apps/app (fără teste de produs încă)
status: review
blocked_by: []
refs: [TASK-0002]
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

- [x] `pnpm --filter @e-glasul/app test` trece (1 smoke test: App randează titlul)
- [x] `pnpm verify` include testele unit (`pnpm test` rulează înainte de build)
- [x] CI verde (pas nou „Unit tests (Vitest)" în jobul `verify`)

## Note de execuție

- Vitest `^4`, `@testing-library/react` `^16` + `@testing-library/dom` (peer), `jsdom`. Config
  în `vite.config.ts` (`test.environment: "jsdom"`), fără fișier separat.
- Smoke test: `apps/app/src/App.test.tsx` — aserțiune vitest pură (fără `jest-dom`, ca să rămână
  minimal: am scos `@testing-library/jest-dom` adăugat inițial).
- Scripturi: `test` în apps/app (`vitest run`); rădăcină `pnpm test` = testele app (unit).
  `test:db` rămâne separat (cere Supabase; rulat de jobul CI `isolation`, nu de `verify`).
- Stivuit peste TASK-0002 (ambele ating `scripts`/`verify` din `package.json`). Base PR =
  `task/TASK-0002-...`; GitHub re-targetează pe main la merge-ul #33.
