---
id: TASK-0007
title: Normalizează line endings la LF și fă scripturile independente de checkout
status: done
blocked_by: []
refs: []
owner: agent
---

## Scope

Două soluții complementare pentru bug-ul „`pnpm tasks` iese gol pe un checkout Windows"
(working copy CRLF, parser cu `\n`):

1. `.gitattributes` la rădăcină cu `eol=lf` pentru `*.md`, `*.mjs`, `*.json`, `*.yml`,
   `*.yaml`, `*.sql`. LF este adevărul repo-ului; CI rulează pe Linux.
2. Parsare tolerantă la `\r\n` în `scripts/list-tasks.mjs` și `scripts/check-migrations.mjs`
   — apărare în adâncime: scripturile nu depind de configurația de checkout a mașinii.

## Out of scope

- Re-normalizarea copiilor de lucru existente (working tree) în acest PR — ar produce un
  diff masiv. Omul o rulează local după merge (`git add --renormalize .` sau re-clone).
- Alte tipuri de fișiere decât cele enumerate.

## Definition of Done

- [x] `.gitattributes` există cu `eol=lf` pentru extensiile enumerate
- [x] `scripts/list-tasks.mjs` și `scripts/check-migrations.mjs` parsează identic pe CRLF și LF
- [x] `pnpm tasks` afișează corect task-urile pe un checkout Windows (CRLF)
- [x] `pnpm verify` verde
- [x] Diff-ul NU conține renormalizare masivă — doar fișiere noi + cele două scripturi editate

## Note de execuție

- Cauza confirmată: `git ls-files --eol` arăta `i/lf w/crlf` — fișierele sunt LF în git,
  dar checkout-ul pe Windows le face CRLF. Regex-ul `/^---\n.../ ` din list-tasks.mjs nu
  potrivea `---\r\n`, deci frontmatter-ul ieșea gol → 0 task-uri afișate.
- list-tasks.mjs: frontmatter regex tolerant la `\r?\n`.
- check-migrations.mjs: matching-ul era deja CRLF-safe; adăugat normalizare CRLF→LF la
  citire ca belt-and-suspenders, ca să fie provabil independent de checkout.
- PR #30 — merged. Status review → done.
