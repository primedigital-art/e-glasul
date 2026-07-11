# e-glasul — Pachetul 1: fundația Claude Code

Acest pachet pornește proiectul e-glasul cu:

- instrucțiuni de proiect
- reguli de produs, arhitectură și securitate
- trei subagenți specializați
- trei skills de planificare și arhitectură
- structura inițială de documentație
- setări Claude Code conservatoare

Nu conține încă aplicația Next.js, baza de date sau cod de producție.

## Instalare rapidă pe Windows

1. Extrage arhiva într-un folder numit `e-glasul`.
2. Deschide folderul în VS Code.
3. Deschide PowerShell în rădăcina folderului.
4. Rulează:

```powershell
git init
claude
```

5. Acceptă workspace trust numai după ce verifici fișierele din `.claude/`.
6. Dacă sesiunea Claude Code era deja deschisă înainte să existe `.claude/agents/` sau `.claude/skills/`, închide și pornește din nou Claude Code.

## Verificare

În Claude Code rulează:

```text
/status
```

Apoi testează:

```text
Use the eg-civic-product-strategist agent to create a feature brief for the Phase 1 citizen issue-reporting flow. Do not implement code.
```

După aceea:

```text
Use the eg-public-sector-domain-expert agent to review the new issue-reporting feature brief. Separate generic municipal workflow from assumptions that require validation.
```

Apoi:

```text
Use the eg-solution-architect agent to review the approved brief and domain note, identify the first ADRs required, and decide whether the feature is ready for technical specification. Do not initialize a framework yet.
```

Poți testa skills direct:

```text
/eg-feature-brief raportarea unei sesizări de către cetățean
```

```text
/eg-architecture-decision-record alegerea arhitecturii de bază pentru Phase 1
```

## Rezultatul așteptat

După test, ar trebui să apară documente în:

- `docs/product/features/`
- `docs/product/domain/`
- `docs/architecture/specs/`
- `docs/decisions/`

## Următorul pachet

După validarea acestei fundații urmează:

- `eg-multitenancy-architect`
- `eg-identity-access-architect`
- `eg-workflow-architect`
- `eg-records-document-architect`
- skills pentru tenant model, RBAC, audit, upload și număr de înregistrare
