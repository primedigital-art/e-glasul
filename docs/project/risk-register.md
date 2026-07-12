# Registru de riscuri

| ID | Risc | Probabilitate | Impact | Măsură | Owner | Status |
|---|---|---|---|---|---|---|
| R-001 | Extinderea necontrolată a Phase 1 | Medium | High | Feature briefs și phase classification | Product | Open |
| R-002 | Izolare multi-tenant incompletă | Medium | Critical | Politici RLS + V1 (teste cross-tenant) + V2 (scanare de secrete în bundle-ul de build) ca porți de CI blocante — [ADR-0001](../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md). Rămâne `Open` până la FUP-1 (model de tenancy) și până când V1/V2 sunt verzi pe schema reală. | Architecture/Security | Open |
| R-003 | Proceduri municipale presupuse greșit | Medium | High | Domain review și validare cu primăria pilot | Domain | Open |
| R-004 | Aplicație prea complicată pentru personalul local | Medium | High | UX simplu, teste cu utilizatori reali | Product/UX | Open |
