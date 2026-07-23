# Backlog de task-uri

Registrul de lucru pentru agent și om. Respectă regula generală a proiectului:
task-urile LEAGĂ faptele (OQ, R, FEAT, ADR), nu le restează.

## Format

Un fișier per task: `TASK-NNNN-<slug>.md` (4 cifre, kebab-case), după `TASK-template.md`.

## Statusuri

| Status | Înseamnă |
|---|---|
| `ready` | Poate fi luat de agent acum. `blocked_by` gol, DoD verificabilă. |
| `blocked` | Așteaptă un OQ, un task în amonte sau o decizie umană. |
| `in-progress` | Are branch deschis. Un singur task in-progress per agent. |
| `review` | PR deschis, așteaptă omul. |
| `done` | PR merged. Fișierul rămâne ca istoric. |

## Reguli

- Doar omul mută un task din `blocked` în `ready` (pentru că doar omul rezolvă OQ-uri).
- Agentul mută `ready → in-progress → review` și `done` după merge.
- `blocked_by` conține DOAR identificatori: OQ-xxx, TASK-xxxx, ADR-xxxx, FEAT-xxx.
  Motivul detaliat trăiește în documentul-sursă al identificatorului, nu aici.
- Un task care crește peste ~1 zi de lucru se sparge în task-uri mai mici.

## Index

Indexul NU se ține aici manual (ar restata statusuri și ar putrezi).
Listarea la zi: `pnpm tasks` (vezi scripts/list-tasks.mjs).
