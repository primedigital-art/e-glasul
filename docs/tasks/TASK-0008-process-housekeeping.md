---
id: TASK-0008
title: Housekeeping de proces — contract de livrare PR + închidere TASK-0005
status: review
blocked_by: []
refs: [TASK-0005, ADR-0004]
owner: agent
---

## Scope

Curățenie de proces, fără cod de aplicație. Într-un singur PR:

1. **`autonomy.md`, „Contract de livrare per task"**: după `gh pr create`, se confirmă cu
   `gh pr view` și se include URL-ul REAL al PR-ului în raport (nu unul presupus).
2. **`autonomy.md`, tot acolo**: PR-uri stivuite (stacked) doar când e strict necesar; după
   ce baza e merge-uită, se face rebase imediat pe `main` proaspăt.
3. **TASK-0005 → `done`**: PR #37 este merged (`9b6c76d`, 2026-07-23), deci statusul e acum
   adevărat, nu anticipat.
4. **Consemnarea abaterii ADR-0004**: pseudocodul deciziei folosește `errcode 40001`, iar
   implementarea reală folosește `P0001` (din motiv de retry PostgREST pe clasa 40). Se
   consemnează ca **amendament/apendice** în ADR-0004, fără a rescrie textul deciziei.

## Out of scope

Orice cod de aplicație, migrație sau test. Nu se schimbă statusul niciunui OQ sau risc. Nu se
schimbă statusul ADR-0004 (rămâne `Accepted`). Nu se modifică alte reguli din `.claude/` în
afara secțiunii „Contract de livrare per task" din `autonomy.md`.

## Definition of Done

- [x] `.claude/rules/autonomy.md` conține, în „Contract de livrare per task", regula
      `gh pr view` + URL real și regula despre PR-uri stivuite + rebase imediat după merge-ul bazei
- [x] `docs/tasks/TASK-0005-implement-sesizari-db.md` are `status: done`
- [x] ADR-0004 are o secțiune de amendament/notă care consemnează `40001 → P0001` fără a
      rescrie secțiunea „Decizie"; statusul ADR rămâne `Accepted`
- [x] `pnpm verify` trece local
- [x] PR deschis, titlul citează `(TASK-0008)`, iar raportul include URL-ul confirmat cu `gh pr view`

## Note de execuție

- Task deschis și rezolvat în aceeași sesiune, la cererea directă a omului (housekeeping de
  proces). Nu atinge cod, deci nu declanșează ciclul `pnpm db:reset && pnpm test:db`.
- Amendamentul ADR-0004 a fost redactat de `eg-solution-architect` (rutare obligatorie pentru
  ADR-uri, `autonomy.md`), integrat de agentul principal. Istoria deciziei rămâne intactă.
- Regula nouă despre `gh pr view` este chiar cea care lipsea când, într-o sesiune anterioară,
  s-a raportat un URL înainte de a-l confirma — acest PR o aplică pe el însuși.
