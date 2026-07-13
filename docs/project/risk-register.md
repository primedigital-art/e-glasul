# Registru de riscuri

| ID | Risc | Probabilitate | Impact | Măsură | Owner | Status |
|---|---|---|---|---|---|---|
| R-001 | Extinderea necontrolată a Phase 1 | Medium | High | Feature briefs și phase classification | Product | Open |
| R-002 | Izolare multi-tenant incompletă | Medium | Critical | Model și politici RLS: [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md). Porți de CI blocante: **C1–C7** (verificări de catalog — C1 face din „tabel nou fără RLS" un build roșu) și **T1–T18** (teste cross-tenant executate cu cheia anon), definite în ADR-0002; **V2** (scanare de secrete în bundle-ul de build) din [ADR-0001](../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md). Rămâne `Open` până când C1–C7 și T1–T18 sunt verzi pe o schemă reală. | Architecture/Security | Open |
| R-003 | Proceduri municipale presupuse greșit | Medium | High | Domain review și validare cu primăria pilot | Domain | Open |
| R-004 | Aplicație prea complicată pentru personalul local | Medium | High | UX simplu, teste cu utilizatori reali | Product/UX | Open |
