---
id: TASK-NNNN
title: <titlu scurt, imperativ>
status: blocked | ready | in-progress | review | done
blocked_by: []            # ex: [OQ-007, TASK-0004] — doar identificatori
refs: []                  # ex: [FEAT-001, ADR-0002] — context, fără a restata conținutul
owner: agent | human
---

## Scope

Ce se construiește, concret. Dacă atinge schema DB, tabelele/politicile se numesc AICI explicit.

## Out of scope

Ce NU se atinge, chiar dacă pare înrudit.

## Definition of Done

Doar condiții verificabile prin comenzi sau inspecție de fișier. Exemple de formă corectă:
- [ ] `pnpm verify` trece local și în CI
- [ ] `pnpm db:reset && pnpm test:db` trece (dacă s-a atins DB)
- [ ] Există test T-nou care demonstrează refuzul cross-tenant pentru <tabel>
- [ ] Fișierul X există și conține secțiunile Y, Z

## Note de execuție

(agentul completează pe parcurs: decizii mărunte, blocaje întâlnite, link PR)
