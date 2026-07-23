---
id: TASK-0001
title: Deschide PR-uri pentru cele două branch-uri docs nemergeate
status: done
blocked_by: []
refs: [FEAT-001, OQ-016]
owner: agent
---

## Scope

Deschide PR pentru `docs/oq-regim-sesizari` (rezolvarea OQ-016) și apoi, după merge-ul lui,
PR pentru `docs/feature-brief-sesizari` (FEAT-001). Ordinea contează: brief-ul depinde de
regimul juridic decis în OQ-016.

## Out of scope

Orice modificare de conținut în cele două documente. Doar PR + descriere.

## Definition of Done

- [x] Ambele PR-uri deschise, cu titlu convențional și referință la OQ-016 / FEAT-001
- [x] CI verde pe ambele
- [x] Merge-ul rămâne la om

## Note de execuție

- OQ-016: PR #25 (`docs/oq-regim-sesizari`) — merged.
- FEAT-001: PR #24 (`docs/feature-brief-sesizari`) — merged, după #25 (ordinea cerută respectată).
- Merge-ul a fost făcut de om; agentul doar a deschis PR-urile.
