---
id: TASK-0004
title: Specificație tehnică pentru nucleul FEAT-001 (depunere, urmărire, inbox)
status: review
blocked_by: []
refs: [FEAT-001, ADR-0002, ADR-0003, OQ-016]
owner: agent
---

## Scope

Prin agentul eg-solution-architect, spec tehnic DOAR pentru părțile pe care FEAT-001
le declară avansabile în paralel: depunerea sesizării, urmărirea statusului de către
cetățean, inbox-ul staff cu filtre, istoricul append-only al tranzițiilor.
Include: schema tabelelor (cu tenant_id), politici RLS propuse, tranziții de stare,
contractul de storage pentru fotografii marcat explicit ca blocat de B2/OQ-007.

## Out of scope

Promisiuni de termen către cetățean (B1), publicarea fotografiilor (B2), retenția (OQ-007),
dashboard (FUP-9), export PDF/spreadsheet, notificări. Toate rămân în spec ca secțiuni
„blocat de", nu se proiectează.

## Definition of Done

- [x] Spec la docs/architecture/specs/sesizari-cetatenesti.md conform skill-ului eg-technical-spec
- [x] Fiecare blocant B1/B2/B3 apare ca secțiune explicită cu referință la OQ-ul sursă
- [x] Zero cod scris (SQL-ul din spec e ilustrativ, în stilul ADR-urilor — contract, nu implementare)

## Note de execuție

- Rutat la `eg-solution-architect` (skill `eg-technical-spec`), conform tabelului de rutare din autonomy.md.
- Spec: [`docs/architecture/specs/sesizari-cetatenesti.md`](../architecture/specs/sesizari-cetatenesti.md) — 26 secțiuni. Tabele noi: `issue_categories`, `issues`, `issue_status_history`, `issue_assignment_history` (toate cu `tenant_id`, index conform C6). Tranziții `primit → în lucru → rezolvat` cu istoric append-only separat de statusul curent. RLS tenant+rol, T* noi (T45+).
- **Decizie:** ready-with-accepted-risks pentru coloana vertebrală; părți explicit `Blocked`.
- **Descoperire care afectează TASK-0005:** mutările de status/atribuire (`change_issue_status`, `assign_issue`) cer funcții `SECURITY DEFINER` → stop condition #3 din autonomy.md → **necesită ADR-0004** (identificat, NEscris — în afara scope-ului TASK-0004). TASK-0005 va fi blocat de ADR-0004, nu doar de TASK-0004.
- Fără domain review (docs/product/domain/ gol) → comportamentul dependent de domeniu tratat ca blocat. Niciun OQ rezolvat, nicio procedură/retenție inventată.
