# Registru de riscuri

| ID | Risc | Probabilitate | Impact | Măsură | Owner | Status |
|---|---|---|---|---|---|---|
| R-001 | Extinderea necontrolată a Phase 1 | Medium | High | Feature briefs și phase classification | Product | Open |
| R-002 | Izolare multi-tenant incompletă | Medium | Critical | Model și politici: [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md) + [ADR-0003](../decisions/ADR-0003-authentication-and-role-model.md). Mecanismul de workflow care ocolește controlat RLS: [ADR-0004](../decisions/ADR-0004-workflow-functions-security-definer-contract.md) (porțile lui — C15, T64–T66 — devin verzi doar odată cu TASK-0005; vezi nota, pct. 4). Porți executabile în CI: [`packages/db-tests`](../../packages/db-tests), rulate pe un Supabase local proaspăt, cu migrațiile rejucate de la zero, **exclusiv cu cheia anon**. Verzi pe `main`. **Vezi [ce NU înseamnă `Mitigated`](#r-002--ce-nu-înseamnă-mitigated).** | Architecture/Security | Mitigated |
| R-003 | Proceduri municipale presupuse greșit | Medium | High | Domain review și validare cu primăria pilot | Domain | Open |
| R-004 | Aplicație prea complicată pentru personalul local | Medium | High | UX simplu, teste cu utilizatori reali | Product/UX | Open |
| R-005 | Rolul retras rămâne activ în JWT-ul deja emis (fereastră de revocare) | High | Medium | Consecință asumată a rolurilor cumulative — vezi „Consecințe negative" în [ADR-0003](../decisions/ADR-0003-authentication-and-role-model.md). **T42** demonstrează gaura; **T43** verifică mitigarea (revocarea sesiunilor). Fereastra este determinată de durata token-ului, nedecisă încă ([OQ-012](./open-questions.md)). **Nu este risc de izolare cross-tenant — nu se topește în R-002.** | Architecture/Security | Open |
| R-006 | Ambiguitatea de audit când funcționarul acționează ca cetățean | Medium | Medium | `actor_role` + `acting_as` (determinat de acțiune, nu de un comutator din UI) — [ADR-0003](../decisions/ADR-0003-authentication-and-role-model.md). Auto-procesarea este **înregistrată, nu blocată**; blocarea ei este decizie de produs ([OQ-013](./open-questions.md)). Cost direct al respingerii conturilor separate. | Product/Architecture | Open |
| R-007 | Primăria rămâne fără administrator dacă unicul `tenant_admin` pierde accesul | Medium | High | Consecință directă a interdicției super-adminului ([ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md), [ADR-0003](../decisions/ADR-0003-authentication-and-role-model.md)). Recuperarea este **intervenție manuală prin consola Supabase**, nu funcționalitate în aplicație. Mitigare operațională: minimum doi `tenant_admin` per primărie la onboarding — **de confirmat ca procedură** ([OQ-014](./open-questions.md)). | Operations | Open |

## R-002 — ce NU înseamnă `Mitigated`

R-002 a fost `Open`, la impact `Critical`, din prima zi. A trecut în `Mitigated` pentru că **există dovadă executabilă, verde pe `main`**, nu pentru că am terminat.

`Mitigated` **NU înseamnă `Closed`.** Concret:

1. **Tabelele viitoare nu sunt încă acoperite — dar nu pot scăpa tăcut.** Fiecare tabel nou deținut de tenant trebuie să respecte același tipar: `tenant_id`, RLS + `FORCE`, politici cu predicatul de rol legat prin `AND` de cel de tenant, `WITH CHECK` pe fiecare `UPDATE`. **C1 este ce impune asta**: un tabel cu `tenant_id` fără RLS face build-ul roșu. Nimeni nu trebuie să-și amintească.

2. **Storage, exporturi, notificări și joburi de fundal NU sunt acoperite.** [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md) **afirmă** că frontiera de tenant ține și acolo. **Nimic nu o testează**, pentru că funcționalitățile respective **nu există încă**. Afirmația rămâne neverificată, nu confirmată.

3. **Ce este efectiv impus azi**: schema de tenancy (`tenants`, `tenant_users`), hook-ul de token și politicile RLS pe cele două tabele. Atât. Suita e în [`packages/db-tests`](../../packages/db-tests); porțile sunt **dovedite că pot cădea** — o încălcare injectată (tabel fără RLS, `super_admin` în enum) face suita roșie.

4. **Funcțiile de workflow `SECURITY DEFINER` (ADR-0004) sunt o suprafață nouă, definită dar încă neimplementată.** [ADR-0004](../decisions/ADR-0004-workflow-functions-security-definer-contract.md) este `Accepted`, dar acceptarea unui contract **nu** este o suprafață testată. Aici izolarea este deosebit de delicată: `SECURITY DEFINER` **ocolește RLS**, deci frontiera de tenant pentru `change_issue_status` / `assign_issue` **nu mai vine din RLS**, ci din predicatele scrise în corpul funcției. Porțile care o dovedesc — **C15** (orice `SECURITY DEFINER` din `public` cu `search_path` fixat și neexecutabil de `anon`) și **T64/T65/T66** (izolare cross-tenant prin funcție, `anon` respins, concurență) — se scriu **în același PR cu funcțiile**, în TASK-0005 (regula DB din `autonomy.md`). Până atunci, suprafața **nu există în cod și nu e testată**.

Riscul revine la `Open` dacă apare o suprafață nouă (Storage, export, job, **funcțiile de workflow**) **fără** teste de frontieră care să o acopere. `Mitigated` descrie ce e demonstrat, nu ce e promis.
