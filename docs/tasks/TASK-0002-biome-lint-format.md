---
id: TASK-0002
title: Adaugă Biome ca linter + formatter unic pe monorepo
status: review
blocked_by: []
refs: []
owner: agent
---

## Scope

Biome (un singur tool, fără eslint+prettier separate) la rădăcină: config unic,
script `pnpm lint` și `pnpm format`, job de lint în ci.yml (pas nou în jobul `verify`).
Reguli: recommended + import sorting. Formatarea se aplică o singură dată pe tot
repo-ul într-un commit separat `style:` ca să nu polueze diff-urile viitoare.

## Out of scope

Reguli custom stricte, husky/pre-commit hooks, modificarea logicii vreunui fișier.

## Definition of Done

- [x] `pnpm lint` există la rădăcină și trece (`biome check .`)
- [x] `pnpm verify` include lint (rulează primul, fail-fast)
- [x] CI rulează lint-ul și e verde (pas „Lint and format check (Biome)" în jobul `verify`)
- [x] Un singur commit `style:` cu reformatarea inițială, separat de commitul de config

## Note de execuție

- Biome `^2.5.5`, un singur tool (fără eslint/prettier). Config: `biome.json` — recommended +
  `organizeImports` (import sorting), format `space`/2, `lineEnding: lf` (aliniat cu `.gitattributes`).
- `pnpm lint` = `biome check .`; `pnpm format` = `biome check --write .`.
- Lint pur pe codul existent: 0 erori (2 info-uri non-blocante). Reformatarea inițială atinge
  doar wrapping/format — commit `style:` separat, ca să nu polueze diff-urile viitoare.
- Inclus în acest PR și `TASK-0005.blocked_by → [ADR-0004]` (cerut explicit).
