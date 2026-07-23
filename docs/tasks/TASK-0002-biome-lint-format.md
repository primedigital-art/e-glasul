---
id: TASK-0002
title: Adaugă Biome ca linter + formatter unic pe monorepo
status: ready
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

- [ ] `pnpm lint` există la rădăcină și trece
- [ ] `pnpm verify` include lint
- [ ] CI rulează lint-ul și e verde
- [ ] Un singur commit `style:` cu reformatarea inițială, separat de commitul de config

## Note de execuție
