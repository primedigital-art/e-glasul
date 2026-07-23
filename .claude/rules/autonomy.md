# Autonomy Rules

Aceste reguli guvernează lucrul autonom sau semi-autonom al agentului pe acest repo.
Ele se adaugă la architecture.md, security.md și product-scope.md — nu le înlocuiesc.

## Sursa de lucru

Agentul lucrează EXCLUSIV pe task-uri din `docs/tasks/` cu `status: ready`.
Nu există task ready → agentul se oprește și raportează. Nu inventează de lucru.

Un task este `ready` doar dacă:
- `blocked_by` este gol (niciun OQ deschis, niciun task nefinalizat în amonte);
- are Definition of Done verificabilă prin comenzi (nu prin apreciere);
- scope-ul și out-of-scope sunt scrise.

## Stop conditions (opriri obligatorii, fără excepții)

Agentul SE OPREȘTE și raportează — nu improvizează — când:

1. **OQ deschis în cale.** Implementarea corectă depinde de răspunsul la un OQ cu status
   Open din docs/project/open-questions.md. Nu se alege „varianta plauzibilă".
   Se documentează blocajul în task (`blocked_by: [OQ-xxx]`, `status: blocked`) și se trece
   la următorul task ready.
2. **Migrație în afara scope-ului.** Task-ul cere o schimbare de schemă care nu e declarată
   explicit în secțiunea Scope a task-ului.
3. **Pattern periculos în migrație.** Orice `DROP POLICY`, `ALTER POLICY`, `DROP TABLE`,
   `DISABLE ROW LEVEL SECURITY`, `TRUNCATE`, `SECURITY DEFINER` nou — fără un ADR acceptat
   care îl justifică și fără markerul `-- guard-approved: ADR-NNNN` în fișierul de migrație.
4. **Test de izolare roșu.** Orice C*/T* care pică nu se „repară" prin modificarea testului.
   Testul e specificația. Se repară codul sau se oprește lucrul.
5. **Decizie de produs sau juridică.** Orice întrebare de tipul „ce e primăria obligată să
   facă", „cât reținem datele", „ce vede terțul" — se înregistrează ca OQ nou, nu se decide.
6. **Definition of Done neverificabilă.** Dacă în timpul lucrului reiese că DoD nu poate fi
   probată prin comenzi, task-ul se întoarce în `blocked` cu explicație.

## Contract de livrare per task

- Un task = un branch = un PR. Niciodată commit direct pe main.
- Branch: `task/TASK-NNNN-<slug>`. Commit: Conventional Commits, engleză, ca până acum.
- Înainte de a deschide PR, local trebuie să treacă: `pnpm verify`
  (typecheck ambele apps + build + guard migrații), iar dacă task-ul a atins
  `supabase/migrations/` sau `packages/db-tests/`: ciclul complet
  `pnpm db:reset && pnpm test:db`.
- PR-ul citează ID-ul task-ului în titlu: `feat(db): ... (TASK-0007)`.
- La final, agentul actualizează `status` în fișierul task-ului, în același PR.

## Reguli DB suplimentare (peste security.md)

- Fiecare migrație care creează un tabel cu `tenant_id` TREBUIE însoțită, în același PR,
  de extinderea catalogue.test.mjs / isolation.test.mjs dacă politicile lui nu sunt deja
  acoperite de C1/C1b/C2/C3/C4/C6. Regula practică: un tabel nou fără test T* nou pentru
  cel puțin un scenariu cross-tenant negativ = PR incomplet.
- `service_role` nu apare niciodată în cod de aplicație, teste sau seed-uri de test.
- Nicio migrație nu se scrie fără replay de la zero local (`pnpm db:reset`) înainte de PR.

## Rutarea către subagenți (obligatorie, nu opțională)

Delegarea nu e la latitudinea agentului principal. Se aplică tabelul:

| Tipul lucrului | Cine îl face |
|---|---|
| Feature brief nou sau modificarea unuia | eg-civic-product-strategist (cu skill-ul eg-feature-brief) |
| Orice întrebare de procedură municipală, lege, terminologie oficială | eg-public-sector-domain-expert — NICIODATĂ răspuns din memorie |
| Specificație tehnică, ADR, decizii de arhitectură | eg-solution-architect (cu skill-urile lui) |
| Implementare de cod, migrații, teste | agentul principal (subagenții nu scriu cod de aplicație) |
| Task-uri chore (config, CI, tooling) | agentul principal, fără delegare |

Regula de economie: subagentul primește în prompt DOAR calea către task și către
documentele relevante — nu conținutul lor copiat. El citește singur ce are nevoie,
în contextul lui separat, și întoarce doar livrabilul. Rezultatele lungi se salvează
ca fișier în locația din Documentation locations, nu se revarsă în conversație.

## Igienă de context (economie de tokeni fără pierdere de calitate)

Principiu: memoria de lucru trăiește în fișiere (task-uri, docs, cod), nu în conversație.
O conversație lungă nu e un avantaj — e un pasiv.

1. **Un task = o sesiune.** La începutul unui task se pornește sesiune curată
   (`/clear` sau proces nou). Tot contextul necesar vine din: CLAUDE.md + reguli +
   fișierul task-ului + fișierele din `refs`. Dacă asta nu ajunge, task-ul e prost
   scris — se repară task-ul, nu se cară istoria conversației.
2. **Notele de execuție sunt memoria.** Înainte de orice pauză sau când sesiunea se
   apropie de compactare, agentul scrie în „Note de execuție" starea exactă: ce e făcut,
   ce urmează, ce blocaje. O sesiune nouă trebuie să poată relua NUMAI din fișier.
3. **Citire chirurgicală.** Nu se citesc fișiere întregi când e nevoie de o secțiune
   (Grep/Glob întâi, Read pe zonă). Nu se re-citesc fișiere deja citite în sesiune.
   Nu se rulează comenzi cu output masiv (log-uri complete, dump-uri) fără filtrare.
4. **Compactarea nu decide.** Dacă auto-compact a avut loc, agentul verifică fișierul
   task-ului înainte de a continua — ce e scris în fișier bate ce „își amintește".
5. **Output-ul de verificare se rezumă.** După `pnpm verify` / `pnpm test:db` se
   raportează doar: verde/roșu + erorile exacte, nu tot output-ul.

## Ce NU face agentul niciodată singur

- Nu face merge. Merge-ul e al omului.
- Nu modifică fișiere din .claude/ (reguli, agenți, skills, settings).
- Nu rezolvă OQ-uri. Doar omul schimbă statusul unui OQ.
- Nu schimbă statusul unui risc R-xxx.
- Nu adaugă dependențe runtime noi fără ca task-ul să le numească explicit.
- Nu creează proiecte/branch-uri Supabase remote și nu rulează `supabase db push`.
