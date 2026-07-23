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

### Plan de execuție (3 pași) — de urmat la deblocare

Precondiție dură: **ADR-0004 `Accepted` pe `main`**. La 2026-07-23, acceptarea era încă în PR
deschis (nu pe main); `autonomy.md` stop condition #3 interzice `SECURITY DEFINER` nou fără ADR
**acceptat**. Planul e reconstruibil din [ADR-0004](../decisions/ADR-0004-workflow-functions-security-definer-contract.md)
+ [spec](../architecture/specs/sesizari-cetatenesti.md); notat aici doar ca să nu se piardă.

1. **Bază curată.** Retrage `main` proaspăt (cu acceptarea ADR-0004), pornește branch
   `task/TASK-0005-implement-sesizari-db` de la zero.
2. **Status în același PR.** Mută acest task `blocked → ready → in-progress`, iar la final
   `review`; actualizarea de status intră în PR-ul task-ului.
3. **Implementare** (nume/coloane/politici exacte din spec §7–§12, contractul funcțiilor din
   ADR-0004 §Decizie):
   - Cele 4 tabele: `issue_categories`, `issues`, `issue_status_history`,
     `issue_assignment_history` — toate cu `tenant_id` + index pe `tenant_id` (C6), RLS +
     `FORCE`, politici tenant+rol (`WITH CHECK` pe `UPDATE`). Tabelele de istoric **fără**
     `INSERT/UPDATE/DELETE` pentru `authenticated`; `status`/`assigned_to` **ne**acordate la
     nivel de coloană.
   - Funcțiile `SECURITY DEFINER` `change_issue_status` / `assign_issue` cu markerul
     `-- guard-approved: ADR-0004`, `set search_path = ''` + referințe complet calificate,
     `revoke execute ... from public, anon` + `grant ... to authenticated`, re-derivarea
     tenant+rol din `auth.jwt()` (nu din argumente), validarea tranziției (`{received→in_progress,
     in_progress→resolved}`), `FOR UPDATE` + `p_expected_status` pentru concurență, scriere
     append-only în istoric în aceeași tranzacție.
   - Teste: **C15** în `catalogue.test.mjs`; **T64/T65/T66** (+ T52–T60 din spec) în
     `isolation.test.mjs`, exclusiv cu cheia anon + JWT-uri reale.
   - Verificare: `pnpm db:reset && pnpm test:db` verde + `pnpm guard:migrations` + `pnpm verify`,
     apoi PR. R-002 rămâne `Mitigated` doar dacă suprafața nouă are teste de frontieră în
     **același** PR.
