---
id: TASK-0004
title: Specificație tehnică pentru nucleul FEAT-001 (depunere, urmărire, inbox)
status: blocked
blocked_by: [TASK-0001]
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

- [ ] Spec la docs/architecture/specs/sesizari-cetatenesti.md conform skill-ului eg-technical-spec
- [ ] Fiecare blocant B1/B2/B3 apare ca secțiune explicită cu referință la OQ-ul sursă
- [ ] Zero cod scris

## Note de execuție
