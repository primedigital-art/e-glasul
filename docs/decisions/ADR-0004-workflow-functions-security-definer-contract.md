# ADR-0004: Contractul funcțiilor de workflow pentru sesizări (`SECURITY DEFINER`)

- **Status:** Accepted
- **Data:** 2026-07-23
- **Decidenți:** Product owner, Solution architect
- **Înlocuiește:** None
- **Înlocuit de:** None

## Context

Acest ADR este cerut explicit de [specificația „Sesizări cetățenești — nucleul"](../architecture/specs/sesizari-cetatenesti.md) (§5, §9.2, §9.3, §21, §26) și de [TASK-0004](../tasks/TASK-0004-tech-spec-sesizari.md). Fără el, cele două mutări de stare din nucleu — **schimbarea de status** (`change_issue_status`) și **atribuirea** (`assign_issue`) — nu pot fi implementate: `autonomy.md` (stop condition #3) interzice orice `SECURITY DEFINER` nou în migrații fără un ADR acceptat care îl justifică și fără markerul `-- guard-approved: ADR-NNNN` în fișierul de migrație, iar [`scripts/check-migrations.mjs`](../../scripts/check-migrations.mjs) transformă interdicția într-o poartă statică.

Ce este deja fixat și **nu se relitighează aici** (preluat din ADR-0001/0002/0003 și din spec):

- **Bază unică, schemă unică, `tenant_id` + RLS deny-by-default**, `FORCE ROW LEVEL SECURITY` pe fiecare tabel cu `tenant_id`, `WITH CHECK` obligatoriu pe `UPDATE` ([ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md)).
- Tenantul efectiv și rolul vin **exclusiv** din claim-uri verificate JWT (`app_metadata`), citite prin `current_tenant_id()` și `current_app_role()`/`has_role()`; niciodată din input de client ([ADR-0003](./ADR-0003-authentication-and-role-model.md)).
- Toate funcțiile existente (`current_tenant_id`, `current_app_role`, `has_role`, `custom_access_token_hook`) sunt `security invoker` cu `set search_path = ''` ([migrația `20260713140630_tenancy_schema.sql`](../../supabase/migrations/20260713140630_tenancy_schema.sql)).
- Modelul de date al sesizărilor: `issues` (proiecția `status`, `assigned_to`), plus două tabele append-only `issue_status_history` și `issue_assignment_history`, **fără politică `INSERT/UPDATE/DELETE` pentru `authenticated`**; coloanele `status`/`assigned_to` **nu** sunt acordate la nivel de coloană rolului `authenticated` ([spec §7.4, §7.5, §11](../architecture/specs/sesizari-cetatenesti.md)).
- Setul de tranziții permise este **închis** în Faza 1: `{received→in_progress, in_progress→resolved}`. Redeschiderea (`resolved→in_progress`) este **blocată** (Î6, decizie de produs neluată — spec §8/§25). Acest ADR **nu o decide** și nu o presupune.
- Autorizarea: `change_issue_status` și `assign_issue` cer `has_role('staff')`; `leadership` și `citizen` sunt refuzați (matricea ADR-0003, spec §11).

**Golul pe care îl umple acest ADR.** Specificația a definit *comportamentul* funcțiilor (pași, autorizare, concurență, append istoric). Ce rămâne de decis, pentru că atinge o frontieră de securitate, este **mecanismul de execuție**: sub ce privilegii rulează scrierea în tabelele append-only și în coloanele nealocate, cum se previne ca acest mecanism să devină o cale de bypass generală, ce `search_path` poartă funcția, cine are voie să o execute și de ce RLS singur nu poate exprima operația. Acesta este subiectul ADR-ului.

**De ce nu se poate face „direct".** Un `UPDATE public.issues SET status = ...` trimis de client, chiar și de un `staff`, ar eșua în Faza 1 prin construcție: coloana `status` nu este acordată la nivel de coloană lui `authenticated` (spec §11), deci scrierea ei este refuzată de privilegii înainte de a ajunge la RLS. Iar `issue_status_history` nu are politică `INSERT` pentru `authenticated`, deci nimeni din aplicație nu poate scrie un rând de istoric prin PostgREST. Aceste două restricții sunt **intenționate** (fac istoricul nefalsificabil și statusul nemanipulabil direct). Consecința este că mutarea de stare are nevoie de un mecanism care să scrie *peste* aceste restricții, dar **numai** după ce validează autorizarea, tenantul, tranziția și concurența — și numai atomic, împreună cu rândul de istoric. Aceasta este exact definiția unei funcții cu privilegii ale definitorului, îngustă și verificată.

## Factori de decizie

| # | Factor | De ce contează |
|---|---|---|
| D1 | Validarea tranziției de stare este o **regulă de domeniu**, nu un filtru de rând | RLS decide *care rânduri* pot fi atinse, nu *ce succesiune de valori* este legală. `received→resolved` sau `resolved→in_progress` trebuie refuzate; RLS nu poate exprima o relație între valoarea veche și cea nouă a unei coloane. |
| D2 | Istoricul trebuie scris **atomic**, în aceeași tranzacție cu mutarea | Un status schimbat fără rând de istoric (sau invers) corupe sursa de adevăr a indicatorilor viitori (FUP-9) și a auditului (ADR-0003, pct. 15). Cele două scrieri nu au voie să poată diverge. |
| D3 | Tabelele de istoric sunt **append-only, inaccesibile clientului la scriere** | Fără politică `INSERT` pentru `authenticated`, un client nu poate fabrica istoric (spec AC-011). Dar atunci *cineva* trebuie să poată scrie acolo — un mecanism cu privilegii mai mari, controlat. |
| D4 | `SECURITY DEFINER` rulează cu privilegiile **owner-ului**, nu ale apelantului | Aceasta este exact puterea care permite scrierea, dar și pericolul: un `search_path` needeclarat sau o funcție executabilă de oricine devine o cale de escaladare. Puterea trebuie îngustată deliberat. |
| D5 | Tenantul și rolul trebuie **re-derivate din JWT în corpul funcției**, nu primite ca argumente | Sub `SECURITY DEFINER`, RLS nu mai apără automat frontiera de tenant pe rândul atins. Dacă funcția ar accepta `tenant_id`/`role` din argumente, apelantul și-ar alege singur frontiera — exact breșa pe care ADR-0002/0003 o închid pentru claim-uri. |
| D6 | Concurența pe același rând trebuie tratată **determinist** | Doi funcționari care preiau simultan aceeași sesizare nu au voie să producă două rânduri de istoric contradictorii (spec E13). |
| D7 | Suprafața de bypass trebuie să rămână **enumerabilă și testabilă** | ADR-0002 a ales modelul de tenancy tocmai pentru că *concentrează riscul într-un loc testabil*. Fiecare funcție `SECURITY DEFINER` este o gaură deliberată în acel model; numărul lor și forma lor trebuie ținute sub o poartă automată. |
| D8 | Poarta statică de migrații (`check-migrations.mjs`) este deja activă | Markerul `-- guard-approved: ADR-0004` devine valid **doar după acceptarea acestui ADR**. Decizia trebuie luată înainte, nu în paralel cu migrația. |

## Opțiuni analizate

### Opțiunea A — `UPDATE` direct sub RLS, cu trigger pentru validare și istoric

Se acordă lui `authenticated` `UPDATE` pe coloanele `status`/`assigned_to` (delimitat pe rol prin RLS: politică de `UPDATE` cu `has_role('staff')`). Un **trigger** `BEFORE/AFTER UPDATE` pe `issues` validează tranziția și scrie rândul de istoric. Clientul trimite un `UPDATE issues SET status = 'in_progress' WHERE id = ...`.

**Avantaje**

- Nicio funcție `SECURITY DEFINER` explicită în contractul de API; nimic de trecut prin poarta `check-migrations.mjs` pentru mutarea în sine.
- Modelul „RLS + trigger" este familiar și rămâne integral în planul de date.
- Triggerul rulează oricum cu privilegiile necesare pentru a scrie în tabelul de istoric (owner al triggerului), deci scrierea append-only este posibilă.

**Dezavantaje**

- **Reintroduce exact ce spec-ul a interzis:** pentru ca `UPDATE`-ul de client să treacă, coloana `status` trebuie acordată lui `authenticated`. Din acel moment, delimitarea „ce câmpuri poate scrie cetățeanul vs. funcționarul" se mută integral pe umerii RLS + al triggerului, iar `status` devine o coloană scriptibilă de client — pe care ne bazăm că triggerul o disciplinează.
- **Contractul de intrare este slab.** Un `UPDATE` nu are un „status așteptat" natural. Controlul de concurență (D6) trebuie reconstruit fie printr-o coloană de versiune, fie printr-un predicat suplimentar în `WHERE`, verificat de client — mai fragil decât un parametru explicit.
- **Triggerul care scrie istoric este el însuși cod cu privilegii**, dar ascuns. Un trigger `SECURITY DEFINER` (necesar dacă owner-ul triggerului nu poate scrie istoricul) trece prin *aceeași* poartă și *aceleași* pericole ca o funcție — fără să câștige lizibilitatea unui contract de funcție numit.
- **Ambiguitatea `200 []`.** Un `UPDATE` respins de RLS întoarce `200` cu zero rânduri, nu o eroare (MEMORY: RLS denial). Un refuz de tranziție invalidă ar trebui ridicat de trigger ca excepție, deci ajungem oricum la excepții explicite — dar mixate cu semantica tăcută a RLS pentru refuzurile de rând. Două canale de eroare pentru aceeași acțiune.

**Riscuri**

- `status` acordat lui `authenticated` este o suprafață permanentă: orice regresie în politica de `UPDATE` sau în trigger o expune. Riscul devine „coloană sensibilă scriptibilă, protejată de logică", exact tiparul pe care ADR-0003 l-a evitat scoțând coloana din `GRANT`.
- Logica de tranziție într-un trigger este invizibilă în contractul de API; ușor de ocolit accidental printr-un al doilea drum de `UPDATE` scris ulterior.

### Opțiunea B — Funcție `SECURITY INVOKER` + politici `INSERT` pe tabelele de istoric

Funcțiile rămân `SECURITY INVOKER` (privilegiile apelantului). Pentru ca scrierea să reușească, se adaugă politici `INSERT` pe `issue_status_history`/`issue_assignment_history` pentru `authenticated` (cu `has_role('staff')` + tenant) și se acordă `UPDATE (status, assigned_to)` lui `authenticated`.

**Avantaje**

- Nicio funcție cu privilegii de definitor; nimic de aprobat prin poartă.
- Autorizarea rămâne integral în RLS, uniform cu restul schemei.
- Funcția devine un simplu „ambalaj" de conveniență, fără putere proprie.

**Dezavantaje**

- **Distruge proprietatea append-only garantată de privilegii** (spec §7.4, AC-011). Din momentul în care `authenticated` are `INSERT` pe `issue_status_history`, orice client poate scrie **direct** un rând de istoric prin PostgREST — cu `from_status`/`to_status`/`actor_*` la alegere. Politica `WITH CHECK` poate constrânge tenantul și rolul, dar **nu poate garanta că rândul de istoric corespunde unei mutări reale a `issues.status`**. Istoricul devine fabricabil: un funcționar poate insera „am rezolvat la data X" fără ca statusul să se fi schimbat vreodată, sau invers.
- **Atomicitatea D2 nu mai este garantată de contract.** Nimic nu împiedică un client să scrie rândul de istoric fără `UPDATE`-ul de status, sau `UPDATE`-ul fără istoric. Consistența dintre proiecție și istoric devine o convenție a clientului, nu o proprietate a bazei.
- Coloana `status` redevine scriptibilă de client (ca la Opțiunea A), cu aceleași consecințe.

**Riscuri**

- Sursa de adevăr a indicatorilor (FUP-9) devine coruptibilă de oricine are rol `staff`, fără urmă că a fost fabricată — cel mai rău tip de eroare: invizibilă.
- C14 (append-only impus la nivel de privilegiu, spec §23.1) devine imposibil de satisfăcut: politicile de `INSERT` există prin construcție.

### Opțiunea C — Funcție `SECURITY DEFINER` îngustă, cu re-derivarea tenant+rol din JWT

Cele două operații sunt încapsulate în funcții `SECURITY DEFINER`, cu `search_path` fixat, executabile **doar** de `authenticated`, care **re-derivă** tenantul și rolul din `auth.jwt()` (prin `current_tenant_id()` / `has_role()`), validează tranziția, blochează rândul (`FOR UPDATE`), scriu istoricul și proiecția în aceeași tranzacție. Tabelele de istoric și coloanele sensibile rămân **inaccesibile direct** clientului. Funcțiile ridică **excepții explicite** la refuz.

**Avantaje**

- **Singura opțiune care păstrează append-only-ul la nivel de privilegiu** (D3): clientul nu are nici `INSERT` pe istoric, nici `UPDATE` pe `status`. Singura cale de scriere este funcția, care scrie *doar* rânduri de istoric care corespund unei mutări reale, verificate.
- **Atomicitatea este garantată de contract** (D2): proiecția și istoricul se scriu în corpul aceleiași funcții, deci în aceeași tranzacție; nu există drum prin care unul să apară fără celălalt.
- **Validarea tranziției trăiește într-un singur loc numit** (D1), verificabilă, imposibil de ocolit printr-un al doilea drum de `UPDATE` — pentru că nu există al doilea drum.
- **Contract de intrare puternic pentru concurență** (D6): parametrul `p_expected_status` + `SELECT ... FOR UPDATE` dau un refuz determinist, fără coloană de versiune și fără logică de client.
- **Un singur canal de eroare**: excepții clasificate (neautorizat / tranziție invalidă / conflict de concurență), fără ambiguitatea `200 []`.

**Dezavantaje**

- **Introduce o gaură deliberată în modelul RLS.** O funcție `SECURITY DEFINER` rulează cu privilegiile owner-ului; dacă owner-ul poate ocoli RLS, corectitudinea izolării de tenant pentru operația respectivă **nu mai vine din RLS**, ci din predicatele scrise explicit în corpul funcției (`tenant_id = current_tenant_id()`). O greșeală acolo este o breșă, iar RLS nu o mai prinde ca plasă de siguranță.
- **Fiecare astfel de funcție trebuie păzită** (search_path, EXECUTE, re-derivare) — cost de disciplină și de test, materializat în poarta `check-migrations.mjs` și în verificări C\* noi.
- Logica de domeniu (setul de tranziții) trăiește în SQL, nu într-un strat de aplicație testabil cu unelte de aplicație — acceptat, pentru că este exact locul unde trebuie să fie nefalsificabilă.

**Riscuri**

- Un `search_path` needeclarat ar permite capturarea de obiecte (un `public.now()` sau un `pg_temp.issue_status_history` ostil, rezolvat înaintea celui real), rulat cu privilegiile owner-ului. Mitigat prin `set search_path = ''` și referințe complet calificate (vezi Decizie).
- Dacă `EXECUTE` rămâne acordat lui `PUBLIC`/`anon` (implicit la crearea funcției!), un vizitator anonim ar putea invoca funcția. Mitigat prin `revoke execute ... from public, anon` explicit.
- Dacă owner-ul funcției are `BYPASSRLS`, funcția devine o cale de scriere care ignoră complet RLS; corectitudinea depinde **integral** de predicatele din corp. Mitigat prin re-derivarea obligatorie a tenantului și prin testul cross-tenant negativ prin funcție (T64).

**Opțiunile A și B nu sunt „greșite" tehnic** — sunt modele legitime în alte contexte. Sunt respinse aici pentru că amândouă cer să acordăm clientului scriere pe `status` și/sau pe tabelele de istoric, ceea ce **desface exact garanțiile pe care spec-ul le construiește la nivel de privilegiu** (append-only nefalsificabil, status nemanipulabil direct, atomicitate proiecție↔istoric). Opțiunea C plătește pentru asta cu o gaură îngustă și păzită în RLS, în locul unei suprafețe largi și permanent scriptibile.

## Decizie

Se alege **Opțiunea C**. Contractul funcțiilor `change_issue_status` și `assign_issue`:

### 1. Mecanismul de execuție și `search_path` (cerința 1)

1. Ambele funcții sunt **`SECURITY DEFINER`** și poartă **`set search_path = ''`** — identic cu funcțiile existente din `20260713140630_tenancy_schema.sql`, dar motivul este aici mai strict: o funcție `SECURITY INVOKER` cu `search_path` needeclarat este un risc; o funcție **`SECURITY DEFINER`** cu `search_path` needeclarat este o **cale de escaladare de privilegii**. Rulând cu privilegiile owner-ului, dacă rezoluția de nume ar depinde de `search_path`-ul apelantului, un apelant ostil ar putea planta în `pg_temp` (sau într-o schemă pe care o controlează) un obiect cu numele unuia referit necalificat (o funcție, un tabel), pe care funcția l-ar executa cu privilegii ridicate. `set search_path = ''` elimină rezoluția implicită.

2. **Toate referințele din corp sunt complet calificate**: `public.issues`, `public.issue_status_history`, `public.current_tenant_id()`, `public.has_role(...)`, `pg_catalog` pentru funcțiile de sistem. Cu `search_path = ''`, un nume necalificat este o eroare de compilare, nu o gaură — exact proprietatea dorită.

3. **Owner-ul funcției** este rolul care rulează migrațiile. Corectitudinea izolării **nu depinde** de faptul că owner-ul ocolește sau nu RLS: funcția verifică frontiera de tenant **explicit** în corp (pct. 6). Nu se creează un rol nou cu `BYPASSRLS`; nu se folosește `service_role`. Funcția este singura suprafață prin care aceste scrieri privilegiate sunt posibile, iar suprafața este îngustă (două operații, parametri tipați, fără SQL dinamic).

### 2. Cine poate executa (cerința 2)

4. La creare, PostgreSQL acordă implicit `EXECUTE` lui `PUBLIC`. Acest lucru se **revocă explicit**, iar `EXECUTE` se acordă **doar** lui `authenticated`:

   ```sql
   -- ilustrativ, nu migrație
   revoke execute on function public.change_issue_status(uuid, public.issue_status, public.issue_status) from public, anon;
   grant  execute on function public.change_issue_status(uuid, public.issue_status, public.issue_status) to authenticated;

   revoke execute on function public.assign_issue(uuid, uuid) from public, anon;
   grant  execute on function public.assign_issue(uuid, uuid) to authenticated;
   ```

   `anon` **nu** poate invoca funcțiile. Un vizitator neautentificat nu are ce muta. (Notă de disciplină: `check-migrations.mjs` blochează `GRANT ... TO anon`; aici nu se acordă nimic lui `anon`, dimpotrivă, i se revocă.)

5. **Tenantul și rolul se re-derivă în corp din `auth.jwt()`**, prin `public.current_tenant_id()` și `public.has_role(...)` — **niciodată din argumentele funcției**. Semnăturile nu conțin și nu vor conține `tenant_id` sau `role`:

   ```
   change_issue_status(p_issue_id uuid, p_expected_status issue_status, p_to_status issue_status) returns issue_status
   assign_issue(p_issue_id uuid, p_assignee uuid /* nullable */) returns void
   ```

   Un apelant nu își poate alege tenantul sau rolul prin parametri. Aceasta este aceeași regulă pe care ADR-0002/0003 o aplică pentru claim-uri, extinsă la funcții: contextul de autorizare vine din token, nu din cererea clientului. Sub `SECURITY DEFINER`, `auth.jwt()` rămâne disponibil (este un GUC de request, nu depinde de rolul de execuție al funcției).

### 3. De ce RLS singur nu ajunge (cerința 3)

6. RLS filtrează **rânduri**; nu poate exprima trei lucruri de care depinde această operație:

   - **(a) Validarea tranziției de stare permise.** `received→in_progress` este legal, `received→resolved` și `resolved→in_progress` nu. Aceasta este o relație între valoarea *veche* și valoarea *nouă* a coloanei `status`, plus apartenența la un set închis. O politică `USING`/`WITH CHECK` vede rândul, nu istoria valorii lui; nu poate spune „această tranziție este interzisă". Validarea trăiește deci în corpul funcției.
   - **(b) Scrierea append-only în istoric, atomic, în aceeași tranzacție.** Mutarea `issues.status` și inserarea rândului în `issue_status_history` trebuie să reușească sau să eșueze împreună. RLS nu orchestrează două scrieri; funcția o face, într-o singură tranzacție.
   - **(c) Faptul că `issue_status_history` / `issue_assignment_history` nu au politică `INSERT` pentru clienți.** Prin construcție (spec §7.4/§7.5, §11), niciun rol de aplicație nu poate scrie în tabelele de istoric prin PostgREST. Singurul scriitor legitim este funcția `SECURITY DEFINER`. Aceasta este ceea ce face istoricul **nefalsificabil**: nu există un al doilea drum către el.

7. **De ce `SECURITY DEFINER`, nu un `UPDATE` direct sub RLS.** Un `UPDATE` direct ar cere ca `authenticated` să aibă `UPDATE (status)` și `INSERT` pe istoric — adică exact Opțiunile A/B, care desfac append-only-ul și atomicitatea (vezi „Opțiuni analizate"). `SECURITY DEFINER` este mecanismul care permite scrierea *fără* a acorda clientului aceste drepturi permanente: puterea stă în funcție, îngustă și verificată, nu în rolul apelantului. Frontiera de tenant, pe care RLS nu o mai aplică automat rândului atins de definitor, este **reconstruită explicit** în corp:

   ```sql
   -- ilustrativ, nu migrație
   -- 1. autorizare pe rol, re-derivată din JWT (leadership și citizen refuzați)
   if not public.has_role('staff') then
     raise exception 'not authorized' using errcode = '42501';
   end if;

   -- 2. blocare rând ÎN tenantul apelantului — frontiera de tenant, explicit
   select status into v_current
     from public.issues
    where id = p_issue_id
      and tenant_id = public.current_tenant_id()   -- NU din argument
      for update;
   if not found then
     raise exception 'issue not found' using errcode = 'no_data_found';  -- nu dezvăluie alt tenant
   end if;

   -- 3. concurență: statusul real trebuie să fie cel așteptat
   if v_current <> p_expected_status then
     raise exception 'stale status' using errcode = '40001';
   end if;

   -- 4. tranziție în setul închis {received->in_progress, in_progress->resolved}
   if not (v_current, p_to_status) in (('received','in_progress'), ('in_progress','resolved')) then
     raise exception 'invalid transition' using errcode = '23514';
   end if;

   -- 5. append istoric + 6. proiecție, ACEEAȘI tranzacție
   insert into public.issue_status_history (tenant_id, issue_id, from_status, to_status, actor_user_id, actor_role, acting_as)
     values (public.current_tenant_id(), p_issue_id, v_current, p_to_status,
             (select auth.uid()), public.current_app_role(), 'official');
   update public.issues set status = p_to_status, updated_at = now() where id = p_issue_id;
   ```

   `assign_issue` urmează același tipar: `has_role('staff')`, `FOR UPDATE` în tenantul apelantului, verificarea că `p_assignee` (dacă nu e NULL) are un rând **activ** în `tenant_users` în **același tenant**, apoi append în `issue_assignment_history` + proiecția `assigned_to`. Atribuirea către un **departament** rămâne blocată de [OQ-011](../project/open-questions.md) — Faza 1 atribuie doar unei persoane.

8. **Refuzurile sunt excepții explicite, clasificate** (neautorizat / rând inexistent / conflict de concurență / tranziție invalidă), nu `200 []`. Astfel clientul distinge cauza fără a citi coduri HTTP ambigue (spec §16), iar log-urile pot separa clasele de eroare fără a expune detalii interne utilizatorului (spec §20). Mesajul de eroare **nu** dezvăluie existența unui rând în alt tenant (pct. 6, pasul 2).

### 4. Auto-procesarea rămâne înregistrată, nu blocată

9. Când `actor_user_id = issues.author_user_id` (funcționarul își procesează propria sesizare), faptul este **înregistrat** în istoric și derivabil din date, **nu blocat** — respectă ADR-0003 (pct. 16) și [OQ-013](../project/open-questions.md). Acest ADR **nu inventează** o blocare; nu decide OQ-013.

### Ce NU decide acest ADR

- **Redeschiderea `resolved→in_progress`** (Î6) rămâne blocată; setul de tranziții este cel din spec §8. Dacă Î6 se decide „da", se extinde setul din pct. 7 printr-o migrație additivă — nu o rescriere.
- **Contractul de storage / atașamente** (FUP-3) — funcțiile de aici nu ating fișiere.
- **Retenția** rândurilor de audit din tabelele de istoric — [OQ-007](../project/open-questions.md), nestabilită, nu se inventează.
- **Notificările** declanșate de o schimbare de status (FUP-4) — în afara scopului; funcțiile nu trimit nimic.
- **Segmentarea pe compartimente / atribuirea la departament** — [OQ-011](../project/open-questions.md) (FUP-14); dacă răspunsul e „da", `assign_issue` se schimbă structural.

## Motivație

Alegerea nu este că `SECURITY DEFINER` ar fi „mai sigur" în general — nu este; este o gaură deliberată în modelul RLS, iar ADR-0002/0003 au construit tot restul tocmai ca să *nu* avem astfel de găuri. Alegerea este că **cele două garanții pe care spec-ul le pune la nivel de privilegiu** — istoric nefalsificabil și status nemanipulabil direct — **nu pot coexista cu un client care are `UPDATE` pe `status` sau `INSERT` pe istoric**. Opțiunile A și B cer exact acel acces. Odată acordat, append-only-ul devine o convenție (respectată de codul de azi, coruptibilă de codul de mâine sau de un client rău-intenționat cu rol `staff`), iar sursa de adevăr a indicatorilor devine falsificabilă fără urmă.

Opțiunea C mută întreaga putere într-o suprafață îngustă, numită și testabilă: două funcții, fără SQL dinamic, cu parametri tipați, care își re-derivă contextul de autorizare din token. Costul este că frontiera de tenant pentru aceste două operații nu mai vine din RLS, ci din două predicate scrise de mână (`tenant_id = current_tenant_id()`). Plătim acest cost cu un test cross-tenant negativ **prin funcție** (T64) și cu o verificare structurală care ține toate funcțiile `SECURITY DEFINER` sub disciplina `search_path` + `EXECUTE` (C15). Concentrăm riscul într-un loc pe care îl putem enumera, exact criteriul pe care ADR-0002 l-a aplicat la tenancy.

`set search_path = ''` nu este cosmetic aici. La `SECURITY INVOKER`, un `search_path` ostil poate păcăli funcția să ruleze cod ales de apelant — dar cu privilegiile apelantului, deci fără câștig. La `SECURITY DEFINER`, același truc rulează codul ales cu privilegiile owner-ului. Diferența dintre un bug și o escaladare de privilegii este exact această clauză.

## Consecințe pozitive

- **ADR-0004 este închis; mutările de status și atribuirea din spec devin implementabile.** `check-migrations.mjs` acceptă markerul `-- guard-approved: ADR-0004` odată ce acest ADR este `Accepted`.
- **Istoricul rămâne nefalsificabil la nivel de privilegiu** (nu doar prin convenție): singurul scriitor este funcția, care scrie doar tranziții validate.
- **Proiecția și istoricul nu pot diverge**: atomicitate garantată de contract, nu de client.
- **Concurența are un refuz determinist** fără coloană de versiune: `p_expected_status` + `FOR UPDATE`.
- **Un singur canal de eroare, clasificat**, fără ambiguitatea `200 []`.
- **Frontiera de tenant rămâne aplicată** chiar și pentru operația care ocolește RLS, prin predicate explicite + test negativ prin funcție.
- Modelul rămâne extensibil: o tranziție nouă (dacă Î6 se decide) sau `regim = 'petitie'` (OQ-016) se adaugă additiv, fără rescriere.

## Consecințe negative

Acceptate conștient:

1. **Frontiera de tenant pentru aceste două operații nu mai este apărată de RLS**, ci de două predicate scrise de mână în corpul funcției. O greșeală acolo (un `tenant_id = current_tenant_id()` uitat pe `FOR UPDATE`) este o breșă cross-tenant pe care RLS nu o mai prinde. Mitigare: T64 (staff A încearcă să mute o sesizare a lui B prin funcție → refuz) este blocant în CI.
2. **Logica de domeniu (setul de tranziții) trăiește în SQL**, nu într-un strat de aplicație. Este mai greu de testat cu unelte de aplicație și mai ușor de trecut cu vederea la review. Acceptat, pentru că este exact locul unde trebuie să fie nefalsificabilă. Mitigare: T54/T56 verifică pe starea stocată.
3. **Fiecare funcție `SECURITY DEFINER` este o gaură deliberată** care trebuie păzită individual (search_path, EXECUTE, re-derivare din JWT). Numărul lor trebuie ținut mic; C15 le enumeră și le disciplinează, dar nu poate valida semantica corpului — aceea rămâne în sarcina testelor T\* și a review-ului.
4. **`revoke execute ... from public` este ușor de uitat** la o funcție viitoare (PostgreSQL acordă `EXECUTE` lui `PUBLIC` implicit). C15 transformă omisiunea într-un build roșu pentru funcțiile `SECURITY DEFINER`.
5. **Owner-ul funcției are privilegii de scriere pe tabelele de istoric și pe coloanele sensibile.** Dacă owner-ul este compromis la nivel de bază de date, protecția append-only cade — dar acesta este deja modelul de amenințare al oricărei baze (cine deține schema o poate rescrie). Nu introducem un rol nou cu `BYPASSRLS` și nu folosim `service_role`, deci nu lărgim această suprafață.

## Impact asupra securității și confidențialității

- **Escaladare de privilegii prin `search_path`:** eliminată prin `set search_path = ''` + referințe complet calificate (Decizie pct. 1–2).
- **Invocare de către neautentificați:** eliminată prin `revoke execute from public, anon` (pct. 4).
- **Alegerea tenantului/rolului de către apelant:** imposibilă — nu există parametri de tenant/rol; contextul vine din `auth.jwt()` (pct. 5).
- **Falsificarea istoricului:** imposibilă prin PostgREST — tabelele de istoric nu au politică `INSERT` pentru `authenticated`; singurul scriitor este funcția, care scrie doar tranziții validate (pct. 6c).
- **Scurgere de existență cross-tenant:** mesajul de refuz pentru un rând inexistent în tenantul apelantului este identic cu cel pentru un rând care există în alt tenant („issue not found") — nu confirmă existența în alt tenant (pct. 7).
- **Date personale:** funcțiile nu returnează descrieri, coordonate sau atașamente; `change_issue_status` întoarce doar noul status, `assign_issue` întoarce `void`. Auto-procesarea rămâne vizibilă în audit (pct. 9), conform ADR-0003.
- Nicio expunere de stack trace sau detaliu intern către utilizator: erorile sunt clasificate prin `errcode`, mesajele sunt scurte (spec §16, §20).

## Impact multi-tenant

- Adresează [R-002](../project/risk-register.md) pentru suprafața de scriere a workflow-ului. Frontiera de tenant este aplicată **în corpul funcției** (`tenant_id = public.current_tenant_id()` pe `FOR UPDATE`), nu de RLS, tocmai pentru că `SECURITY DEFINER` ocolește RLS pe rândul atins.
- `assign_issue` verifică suplimentar că `p_assignee` aparține **aceluiași tenant** (rând activ în `tenant_users`), prevenind atribuirea către un utilizator al altui tenant (spec T60).
- Nicio operație nu acceptă `tenant_id` de la client; hostname-ul rămâne irelevant (ADR-0002).
- Verificarea izolării pentru aceste funcții **nu** este acoperită de suita T\* generică (care rulează sub RLS): trebuie un caz negativ dedicat prin funcție (T64), pentru că exact aici RLS nu mai este plasa de siguranță.

## Impact operațional și cost

- Zero componente noi de operat. Funcțiile trăiesc în aceeași bază, în aceeași migrație cu tabelele (spec §21, C1).
- **Poarta `check-migrations.mjs`:** migrația care creează funcțiile va conține exact două pattern-uri periculoase (`SECURITY DEFINER`) și markerul `-- guard-approved: ADR-0004`. Markerul devine valid **doar după** ce acest ADR trece în `Accepted` (poarta verifică existența fișierului ADR în `docs/decisions/`, iar `autonomy.md` #3 cere ADR **acceptat**). Migrația de implementare (planificată ca **TASK-0005**) va purta markerul; până la acceptare, orice migrație cu `SECURITY DEFINER` este blocată corect.
- Cost de execuție neglijabil: două funcții scurte, un `FOR UPDATE` pe cheie primară, două scrieri. Nicio buclă, niciun SQL dinamic.

## Impact asupra migrării și compatibilității

- **Forward-only** (ADR-0001): o funcție greșită se corectează prin `create or replace` într-o migrație nouă, nu prin editare în consolă. `check-migrations.mjs` blochează `DROP FUNCTION` fără marker — de regulă nu e necesar, `create or replace` fiind suficient pentru semnătura stabilă.
- **Extensibilitate:** setul de tranziții din corp (pct. 7) se extinde additiv dacă Î6 sau stări intermediare (IP-3) se decid; `regim = 'petitie'` (OQ-016) va cere un flux propriu, nu o rescriere a acestor funcții.
- **Compatibilitate client–schemă:** semnăturile funcțiilor sunt contractul; o schimbare de semnătură este o schimbare incompatibilă și cere expand/contract (funcție nouă alături, apoi retragerea celei vechi). În Faza 1 semnăturile sunt cele din pct. 5.
- Funcțiile intră în aceeași migrație cu tabelele `issues` / `issue_status_history` / `issue_assignment_history`, după enum-uri și după `unique (tenant_id, id)` pe `issue_categories` (spec §21).

## Plan de validare

Toate verificările produc un rezultat observabil; cele blocante opresc merge-ul în `main`. Extind suitele existente (`packages/db-tests`), rulate exclusiv cu **cheia anon** + JWT de utilizator (niciodată `service_role`). AC-008/AC-009 se verifică pe **starea stocată** (status + număr de rânduri de istoric), nu pe codul HTTP.

**Structurale (C\*) — pe catalogul PostgreSQL, după replay:**

| ID | Verificare | Rezultat cerut | Poartă |
|---|---|---|---|
| C14 | `issue_status_history` și `issue_assignment_history` **nu au** `GRANT`/politici `INSERT/UPDATE/DELETE` pentru `authenticated` (append-only la nivel de privilegiu — spec §23.1) | zero potriviri | Blocantă |
| **C15 (nou)** | **Orice** funcție `SECURITY DEFINER` din schema `public` are (a) `search_path` fixat în `proconfig` **și** (b) **niciun** `EXECUTE` pentru `anon` sau `PUBLIC` (`proacl`) | fără excepție; o funcție definer fără `search_path` sau executabilă de anon **pică build-ul** | Blocantă |

C15 este pentru funcțiile `SECURITY DEFINER` ce a fost C1 pentru tabele: transformă „am uitat `set search_path` / `revoke execute`" dintr-o breșă tăcută într-un build roșu, pentru fiecare funcție definer *viitoare*, nu doar pentru cele două de acum.

**Izolare și rol (T\*) — cu client real, doi tenanți A/B, pe schema produsă de replay.** Cazurile propuse de spec §23.2 rămân valabile; cele care păzesc direct contractul acestui ADR:

| ID | Caz | Rezultat cerut | AC |
|---|---|---|---|
| T52 | `citizen` A apelează `change_issue_status` pe sesizarea proprie | refuz (`has_role('staff')` = false); status neschimbat **și** niciun rând nou de istoric | AC-008 |
| T53 | `leadership` A apelează `change_issue_status` / `assign_issue` | refuz; verificat pe starea stocată | AC-009 |
| T54 | `staff` A: `('received','in_progress')` apoi `('in_progress','resolved')` | reușesc; `issue_status_history` = exact **două** rânduri, în ordine, cu actor+moment | AC-010 |
| T55 | `staff` A: `change_issue_status` cu `p_expected_status` greșit | refuz determinist (`errcode 40001`); fără rând nou | E13 |
| T56 | `staff` A: tranziție interzisă (`received→resolved` sau `resolved→in_progress`) | refuz (`errcode 23514`); status neschimbat | FR-018 |
| T57 | orice rol: `update`/`delete` direct pe un rând din `issue_status_history` | refuz / 0 rânduri; rândul rămâne identic | AC-011 |
| T59 | `staff` A: `assign_issue` către un user activ din A | reușește; rând în `issue_assignment_history`; `assigned_to` actualizat | FR-014 |
| T60 | `staff` A: `assign_issue` către un user al lui B | refuz (assignee nu e în tenantul A) | FR-014 |
| **T64 (nou)** | `staff` A apelează `change_issue_status` / `assign_issue` pe o sesizare a tenantului **B** | refuz („issue not found"); status/atribuire ale lui B **neschimbate**, niciun rând de istoric în B — **izolare deși `SECURITY DEFINER` ocolește RLS** | R-002 |
| **T65 (nou)** | `anon` (fără JWT) încearcă să invoce `change_issue_status` / `assign_issue` | refuz de privilegiu (`EXECUTE` revocat) | Decizie pct. 4 |
| **T66 (nou)** | concurență reală: două apeluri simultane `change_issue_status(id,'received','in_progress')` pe același rând | **exact unul** reușește; celălalt e refuzat determinist; `issue_status_history` primește **un singur** rând | D6/E13 |

T64 este cazul central al acestui ADR: dovedește că gaura din RLS nu este o gaură în izolare. T66 dovedește că `FOR UPDATE` + `p_expected_status` serializează corect.

**Integrare:** funcțiile de workflow (autorizare, tranziții, concurență, atomicitate proiecție↔istoric) se testează după acceptarea acestui ADR și implementarea din TASK-0005. Poarta CI (`pnpm db:reset && pnpm test:db`) trebuie verde înainte de PR.

## Acțiuni ulterioare

- **Deblocat de acceptarea acestui ADR:** implementarea funcțiilor `change_issue_status` / `assign_issue` și a migrației care le poartă, cu markerul `-- guard-approved: ADR-0004` (planificată ca **TASK-0005**). Până la `Accepted`, această implementare rămâne **blocată** de `autonomy.md` #3.
- **Extinderea suitelor:** adăugarea C15 în [`catalogue.test.mjs`](../../packages/db-tests/tests/catalogue.test.mjs) și a T64/T65/T66 în [`isolation.test.mjs`](../../packages/db-tests/tests/isolation.test.mjs) (plus T52–T60 din spec), în același PR cu funcțiile (regula DB din `autonomy.md`: tabel/funcție nouă fără test negativ = PR incomplet).
- **Rămân blocate, independent de acest ADR** (nu le deblochează și nu le decide): FUP-3 (storage/atașamente), FUP-4 (notificări), FUP-9 (dashboard), OQ-011 (departamente → schimbă `assign_issue`), Î6 (redeschidere → extinde setul de tranziții), OQ-007 (retenția rândurilor de istoric), OQ-013 (blocarea auto-procesării — rămâne „înregistrată, nu blocată").
- **Nicio schimbare de status de OQ sau de risc** nu este făcută de acest ADR; [R-002](../project/risk-register.md) rămâne `Open`/`Mitigated` conform registrului, mutabil doar cu C\*/T\* verzi pe schema reală și doar de om.

## Surse și documente asociate

- [Specificația „Sesizări cetățenești — nucleul"](../architecture/specs/sesizari-cetatenesti.md) — §9.2, §9.3 (contractul funcțiilor), §11 (autorizare), §12 (izolare), §23 (testare), §26 (cere acest ADR).
- [ADR-0002 — Model de multi-tenancy și rezolvarea tenantului](./ADR-0002-tenancy-model-and-tenant-resolution.md) — RLS deny-by-default, `FORCE`, frontiera de tenant, interdicția `service_role` în client.
- [ADR-0003 — Model de autentificare și de roluri](./ADR-0003-authentication-and-role-model.md) — `has_role`, coloane sensibile scoase din `GRANT`, `acting_as`, referința la o funcție `SECURITY DEFINER` dedicată pentru schimbarea statusului.
- [`supabase/migrations/20260713140630_tenancy_schema.sql`](../../supabase/migrations/20260713140630_tenancy_schema.sql) — convenția `security invoker` + `set search_path = ''` pe care acest ADR o extinde la `security definer`.
- [`scripts/check-migrations.mjs`](../../scripts/check-migrations.mjs) — poarta care cere markerul `-- guard-approved: ADR-0004`.
- [`.claude/rules/autonomy.md`](../../.claude/rules/autonomy.md) — stop condition #3 (`SECURITY DEFINER` nou); [`.claude/rules/security.md`](../../.claude/rules/security.md), [`.claude/rules/architecture.md`](../../.claude/rules/architecture.md).

## Amendamente

Această secțiune consemnează abateri de **implementare** față de textul deciziei, fără a rescrie decizia. Secțiunile „Decizie" și „Plan de validare" rămân neatinse: pseudocodul lor este ilustrativ și corect ca **intenție**. Statusul ADR-ului rămâne `Accepted`.

### A1 — SQLSTATE-ul refuzului de concurență: `P0001`, nu `40001` (2026-07-24)

- **Sursa abaterii:** [TASK-0005](../tasks/TASK-0005-implement-sesizari-db.md) (secțiunea „Note de execuție", bullet „Abatere de contract"); implementarea în [`supabase/migrations/20260723120000_sesizari_schema.sql`](../../supabase/migrations/20260723120000_sesizari_schema.sql), funcția `change_issue_status`, pasul 3 „Concurență".

- **Ce spune decizia (rămâne valabil ca intenție).** Pseudocodul ilustrativ din §Decizie pct. 7 și cazul de validare T55/E13 (§Plan de validare) folosesc `errcode = '40001'` (`serialization_failure`) pentru refuzul de concurență când `v_current <> p_expected_status`. Intenția — un **refuz determinist și instantaneu** de conflict, distinct de celelalte clase de eroare — rămâne exact cea din D6/E13.

- **Ce face implementarea reală.** Refuzul de concurență folosește `errcode = 'P0001'` (`raise_exception` generic), **nu** `40001`. Restul contractului de concurență este neschimbat: `SELECT ... FOR UPDATE` în tenantul apelantului + parametrul `p_expected_status` rămân exact cele din decizie. S-a schimbat **doar** SQLSTATE-ul prin care se semnalează refuzul.

- **Motivul (de transport, nu de logică).** PostgREST reîncearcă automat erorile din clasa `40` (`serialization_failure` / `deadlock_detected`) până la timeout-ul de request (~60s → HTTP 504). Cu `40001`, refuzul determinist și instantaneu cerut de D6/E13 devine un hang de ~60s (observat empiric la T55/T66 înainte de corecție). `P0001` întoarce imediat o eroare, distinctă prin mesaj de `not-authorized` (`42501`), `not-found` (`no_data_found` / `P0002`) și `invalid-transition` (`23514`). Deviația este cerută de comportamentul stratului de transport (PostgREST), nu de logica deciziei.

- **Impact asupra planului de validare.** Cazurile T55 și T66 rămân valabile ca **intenție** (refuz determinist, un singur câștigător, fără rând nou de istoric); doar `errcode`-ul așteptat de asertarea lor este `P0001` în loc de `40001`. Nicio altă garanție a ADR-ului (append-only, atomicitate proiecție↔istoric, frontiera de tenant, un singur canal de eroare clasificat) nu este afectată.
