# ADR-0002: Model de multi-tenancy și strategia de rezolvare a tenantului

- **Status:** Accepted
- **Data:** 2026-07-13
- **Decidenți:** Product owner, Solution architect
- **Înlocuiește:** None
- **Înlocuit de:** None

## Context

Acest ADR este **FUP-1** din [ADR-0001](./ADR-0001-phase-1-technology-and-deployment-baseline.md) — ADR-ul marcat acolo ca „cel mai important ADR următor", pentru că blochează scrierea politicilor RLS finale și a schemei de date.

Punctul de plecare nu este liber. Trei lucruri sunt deja fixate și **nu se relitigează aici**:

1. **Baseline-ul tehnologic** — un singur PostgreSQL gestionat de Supabase, un monorepo, două aplicații front-end (Astro public, React/Vite autentificat), monolit modular. Vezi [ADR-0001](./ADR-0001-phase-1-technology-and-deployment-baseline.md).
2. **Rezolvarea tenantului la nivel de produs** — subdomeniu per primărie, o singură aplicație, tenantul efectiv din JWT, hostname-ul niciodată frontieră de securitate. Vezi [decizia OQ-002](../project/open-questions.md#decizie-oq-002--subdomeniu-per-primărie-o-singură-aplicație).
3. **Conținutul public dinamic** — anunțurile se citesc la runtime, în browser, cu cheia anon, fără JWT. Vezi [decizia OQ-004](../project/open-questions.md#decizie-oq-004--anunțurile-se-încarcă-la-runtime-nu-la-build).

Ce lipsește — și ce fixează acest ADR:

- **Unde trăiesc datele tenanților**: aceeași schemă, scheme separate sau baze de date separate. ADR-0001 a *implicat* varianta „shared schema cu `tenant_id`" prin decizia „un singur plan de date", dar a cerut explicit ca alternativele să fie argumentate înainte de a fi eliminate. Acest ADR face acea argumentare.
- **Forma concretă a tabelului `tenants`** și convenția `tenant_id`.
- **Forma exactă a claim-ului de tenant din JWT**, cum este emis și cum este verificat.
- **Tiparul de politică RLS** pentru un tabel deținut de tenant, scris complet.
- **Excepția de citire publică** (OQ-004) și delimitarea ei exactă.
- **Frontiera de tenant dincolo de tabele**: Storage, exporturi, notificări, joburi de fundal.
- **Ce înseamnă „administrator de platformă"** într-un model fără super-admin în RLS.
- **Modelul de cont**: un cont aparține unui singur tenant; înregistrare cu email SAU telefon.

Acest ADR adresează direct riscul [R-002](../project/risk-register.md).

## Factori de decizie

| # | Factor | De ce contează |
|---|---|---|
| D1 | Izolarea între tenanți trebuie **demonstrabilă**, nu declarată | Un test automat trebuie să poată dovedi că utilizatorul tenantului A nu atinge datele tenantului B. Vezi [R-002](../project/risk-register.md). |
| D2 | Deny by default în planul de date | `.claude/rules/security.md`. Un tabel fără politică trebuie să fie **inaccesibil**, nu deschis. |
| D3 | Onboarding-ul unei primării noi = date, nu cod | Cerință explicită din [decizia OQ-002](../project/open-questions.md#decizie-oq-002--subdomeniu-per-primărie-o-singură-aplicație): un rând + o înregistrare DNS, fără deployment. |
| D4 | Suprafață de operare mică | Fără echipă de operare dedicată (ADR-0001, D3). Fiecare bază de date suplimentară este cost recurent real: backup, patching, monitorizare, migrare. |
| D5 | Migrațiile trebuie să rămână un istoric liniar unic | ADR-0001 impune migrații versionate și replay de la zero. N scheme sau N baze de date înmulțesc punctele în care schema poate diverge. |
| D6 | Cost de infrastructură aproximativ proporțional cu numărul de tenanți | Nu în trepte mari. O primărie mică nu trebuie să coste cât o bază de date dedicată. |
| D7 | Conținutul public trebuie citibil fără cont | [OQ-004](../project/open-questions.md#decizie-oq-004--anunțurile-se-încarcă-la-runtime-nu-la-build). Aceasta este singura breșă permisă în regula „tenantul vine din JWT" și trebuie delimitată explicit. |
| D8 | Operatorul platformei nu trebuie să aibă acces implicit la datele cetățenilor | Date personale, documente oficiale. Accesul trebuie să fie deliberat și urmăribil, nu o consecință a rolului. |
| D9 | Costul SMS este un vector de atac financiar | Un flux de înregistrare care trimite SMS și nu are limitare este o factură deschisă. |
| D10 | Complexitatea trebuie să rămână la nivelul Phase 1 | Un pilot, apoi câțiva tenanți. Nu proiectăm pentru 500 de primării fără dovezi. |

## Opțiuni analizate

### Opțiunea A — Bază de date unică, schemă unică, coloană `tenant_id` + RLS

Toți tenanții împart aceleași tabele. Fiecare rând deținut de un tenant poartă `tenant_id`. Izolarea se aplică prin politici Row Level Security în PostgreSQL.

**Avantaje**

- **Un singur loc de aplicat izolarea**: politicile RLS. Un singur loc de auditat, un singur loc de testat. Testul cross-tenant (V1 din ADR-0001) poate acoperi exhaustiv fiecare tabel cu o singură suită.
- **Un singur istoric de migrații**, aplicat o singură dată. Nu există „tenantul X a rămas la migrația 42".
- **Onboarding = `INSERT INTO tenants` + DNS.** Fără deployment, fără provisioning, fără migrare per tenant. Satisface direct D3.
- **Cost proporțional și mic**: un tenant nou nu adaugă o bază de date, un pool de conexiuni sau un job de backup.
- **Interogări cross-tenant pentru operatorul platformei** (număr de tenanți activi, volum agregat) sunt triviale — deși, prin decizia de mai jos, **le limităm deliberat**.
- Se potrivește nativ cu Supabase: `auth.jwt()` este disponibil în politici; Storage folosește același mecanism.

**Dezavantaje**

- **Izolarea este logică, nu fizică.** Datele tuturor primăriilor stau în aceleași pagini de disc, în același tabel. Nu există nicio barieră sub nivelul politicii RLS.
- Politicile RLS sunt cod cu semantică subtilă. O politică lipsă **blochează** (vizibil, se repară). O politică prea permisivă **expune** (invizibil, se descoperă târziu).
- **Zgomot de vecin (noisy neighbour)**: o primărie mare care încarcă mii de fotografii sau rulează exporturi grele degradează performanța pentru toate celelalte. Nu există limită de resurse per tenant.
- **Restaurarea per tenant nu există nativ.** Un backup PITR restaurează întreaga bază de date, deci toți tenanții, la același moment.
- Fiecare interogare plătește costul evaluării politicii; indexarea pe `tenant_id` devine obligatorie, nu opțională.

**Riscuri**

- **O singură politică RLS greșită = breșă cross-tenant completă.** Acesta este riscul central al opțiunii și nu poate fi eliminat, doar controlat prin teste blocante.
- **Un tabel nou creat fără RLS activat** este o breșă introdusă tăcut, la un pull request obișnuit. Necesită o verificare automată de completitudine a schemei, nu disciplină umană.
- Expunerea cheii `service_role` (care ocolește RLS prin construcție) devine echivalentă cu expunerea tuturor tenanților simultan.
- Un `WITH CHECK` uitat pe `UPDATE` permite unui utilizator să **mute** un rând în alt tenant.

### Opțiunea B — Schemă PostgreSQL per tenant, într-o singură bază de date

`tenant_botosani.issues`, `tenant_suceava.issues`, etc. Rezolvarea tenantului se face prin `search_path` sau prin nume calificat de schemă, setat pe conexiune, după autentificare.

**Avantaje**

- **Izolare structurală reală, nu doar predicat.** Datele tenantului B nu se află în tabelul interogat. O interogare care „uită" filtrul nu returnează date străine — returnează datele tenantului curent. Aceasta este o proprietate genuin mai puternică decât Opțiunea A: greșeala tipică (filtru lipsă) devine inofensivă.
- **Permisiuni PostgreSQL native ca al doilea nivel**: `GRANT`/`REVOKE` pe schemă. Nu depinzi exclusiv de corectitudinea unui predicat scris de tine.
- **Export, ștergere și migrare a unui singur tenant sunt naturale**: `pg_dump --schema=tenant_x`. Restaurarea selectivă a unui tenant, imposibilă practic în A, devine directă.
- Statistici de planificare separate per tenant → planuri de execuție mai bune când tenanții au dimensiuni foarte diferite.
- Un tenant enterprise care cere „datele mele nu stau în aceleași tabele cu ale altora" primește un răspuns real.

**Dezavantaje**

- **Migrațiile se multiplică**: fiecare schimbare de schemă trebuie aplicată de N ori, tranzacțional, cu tratarea eșecului parțial. Un tenant rămas în urmă este o bombă cu ceas. Contrazice direct D5.
- **Onboarding-ul devine provisioning**: creare de schemă, rulare a tuturor migrațiilor, acordare de permisiuni. Nu mai este „un rând". Contrazice D3.
- **Supabase nu este proiectat pentru asta.** PostgREST expune scheme configurate explicit; Supabase Auth, Storage și RLS-ul lor presupun schema `public`. Am lupta împotriva platformei alese în ADR-0001 exact în zona pe care am ales-o pentru că e gestionată.
- **Storage-ul nu se împarte pe scheme.** Fișierele rămân în același `storage.objects`, deci frontiera de fișiere ar rămâne oricum bazată pe RLS și pe cale — pierdem avantajul de izolare exact acolo unde stau datele personale (fotografii, documente).
- Numărul de tabele crește liniar cu numărul de tenanți; catalogul PostgreSQL și pool-ul de conexiuni resimt acest lucru la sute de tenanți.
- Interogările agregate ale operatorului platformei devin `UNION ALL` peste N scheme, generat dinamic.

**Riscuri**

- Divergență de schemă între tenanți, descoperită la un incident, nu în CI.
- `search_path` setat greșit = interogare în schema altui tenant. Riscul nu dispare, se **mută**: din „predicat lipsă" în „context de conexiune greșit". Într-un mediu cu pooling de conexiuni (PgBouncer, folosit de Supabase), un `search_path` care persistă între cereri pe aceeași conexiune este o clasă de bug reală și urâtă.
- Efort de construcție semnificativ în Phase 1 pentru o funcționalitate care nu este vizibilă pentru cetățean sau primărie.

### Opțiunea C — Bază de date per tenant

Fiecare primărie primește proiectul ei Supabase / baza ei de date. Aplicația rutează conexiunea în funcție de tenant.

**Avantaje**

- **Cea mai puternică izolare disponibilă.** O breșă la nivel de aplicație într-un tenant nu poate atinge datele altuia, pentru că nu există conexiune către ele. Nu depinde de corectitudinea niciunei politici scrise de noi.
- **Zgomotul de vecin dispare.** Resursele sunt separate; o primărie mare nu poate degrada o primărie mică.
- **Backup, restaurare și retenție per tenant sunt native.** Un tenant poate fi restaurat la un moment anterior fără a atinge pe nimeni altcineva. O primărie care încetează contractul primește un dump complet și o ștergere completă, verificabilă.
- **Localizarea datelor per tenant** devine posibilă (dacă o primărie ar cere o regiune anume — cerință neconfirmată, vezi ADR-0001).
- Argument comercial și de conformitate real în discuțiile cu instituții publice.

**Dezavantaje**

- **Costul crește în trepte, nu proporțional.** Fiecare primărie, oricât de mică, plătește o bază de date. Contrazice direct D6.
- **N × operare**: N seturi de migrații, N backup-uri de verificat, N configurări, N seturi de secrete, N puncte de defect. Fără echipă de operare (D4), aceasta este cea mai scumpă opțiune din ADR, măsurată în timp de om.
- **Autentificarea se fragmentează**: Supabase Auth este per proiect. Un utilizator există într-un proiect. Un „director de utilizatori" global ar trebui construit separat sau acceptat ca inexistent.
- Deployment-ul devine o orchestrare: o migrare eșuată pe tenantul 7 din 12 lasă sistemul într-o stare mixtă.
- Rutarea conexiunii per cerere devine ea însăși cod critic de securitate — riscul se mută din RLS în stratul de rutare, unde nu există nici RLS, nici teste standard.

**Riscuri**

- Efortul operațional depășește capacitatea echipei și duce, în practică, la scurtături (o singură bază „comună" pentru ceva, chei partajate) care anulează avantajul.
- Costul de pornire face pilotul necompetitiv comercial.
- Complexitate de infrastructură pe care ADR-0001 a exclus-o explicit pentru Phase 1.

**Opțiunile B și C nu sunt inferioare tehnic în privința izolării — sunt superioare.** Sunt respinse pentru Phase 1 din motive de cost operațional, compatibilitate cu platforma aleasă și viteză de livrare, nu pentru că ar fi soluții slabe. Dacă un tenant viitor impune contractual izolare fizică, Opțiunea C rămâne calea (vezi „Impact asupra migrării").

## Decizie

### 1. Modelul de tenancy

1. **Bază de date unică, schemă unică (Opțiunea A).** Fiecare tabel deținut de un tenant poartă o coloană `tenant_id`, `NOT NULL`, cheie externă către `tenants`.
2. **Izolarea se aplică prin PostgreSQL Row Level Security, deny by default.** Un tabel fără politică este **inaccesibil**, nu deschis.
3. **O aplicație, un deployment, o bază de date.** Fără fork per tenant, fără artefact de build per tenant, fără schemă per tenant, fără bază de date per tenant.

### 2. Rezolvarea tenantului

4. **Subdomeniul determină EXCLUSIV contextul de prezentare**: branding, logo, culori, date de contact, categorii active. Aceste date trăiesc în tabelul `tenants`.
5. **Tenantul efectiv pentru orice acces autentificat la date se rezolvă EXCLUSIV dintr-un claim verificat din JWT.**
6. **Hostname-ul nu este NICIODATĂ o frontieră de securitate.** Un utilizator autentificat pentru tenantul A nu poate citi date ale tenantului B nici pe subdomeniul lui B.

### 3. Utilizatori

7. **Un cont aparține exact unui tenant** — cetățean sau personal de primărie, fără excepție. Nu există cont multi-tenant în Phase 1.
8. **Înregistrarea se face cu email + parolă SAU telefon + parolă, niciodată ambele.** Canalul se alege la înregistrare.
9. **Înregistrarea prin telefon trimite UN SINGUR SMS**, pentru verificarea numărului. **Nu este login prin OTP**: autentificările ulterioare folosesc parola, fără SMS.
10. **Resetarea parolei**: conturile pe email primesc un link; conturile pe telefon primesc un cod prin SMS.

### 4. Administrarea platformei

11. **Nu există rol de super-admin în RLS.** Nicio politică nu acordă citire sau scriere cross-tenant. **Operatorul platformei nu poate citi datele unui tenant prin aplicație.**
12. **Accesul de urgență este deliberat**: prin consola Supabase, cu `service_role`, care ocolește RLS prin design și lasă urmă de audit la furnizor. Nu este o rută în aplicație și nu este o sesiune care poate fi furată.
13. **Un mecanism corect de acces de suport — bazat pe consimțământ, limitat în timp — este un ADR separat.** Nu se proiectează aici.

### 5. Conținut public

14. **Conținutul public se citește fără JWT**, de vizitatori anonimi, cu cheia anon ([OQ-004](../project/open-questions.md#decizie-oq-004--anunțurile-se-încarcă-la-runtime-nu-la-build)). Este **singurul loc din Phase 1 unde regula „tenantul vine din JWT" nu se aplică**. Delimitarea exactă este în secțiunea „Impact multi-tenant".

### 6. Abuz și cost

15. **SMS-urile se contorizează per tenant.** Costul este suportat de operator și refacturat per primărie.
16. **Endpoint-urile de înregistrare și de resetare a parolei au rate limiting per tenant și Cloudflare Turnstile.** Un flux de SMS este un atac financiar direct, nu doar spam.

### Ce NU decide acest ADR

- **Perioadele de retenție a datelor personale NU sunt stabilite aici** și nu sunt presupuse. Rămân deschise până la validare cu primăria și cu specialistul de privacy/juridic.
- **Furnizorul de SMS nu este ales aici.**
- Modelul de roluri în interiorul unui tenant (cetățean, funcționar, administrator de primărie) — ADR separat.

## Motivație

**De ce Opțiunea A, deși B și C izolează mai bine**

Argumentul nu este că RLS ar fi mai sigur decât separarea fizică. Nu este. Argumentul este că, la scara Phase 1, **A concentrează riscul într-un singur loc pe care îl putem testa exhaustiv și automat**, în timp ce B și C îl împrăștie în locuri pe care nu le putem testa la fel de bine:

- În Opțiunea A, întrebarea „poate A citi datele lui B?" are un răspuns verificabil printr-o suită de teste care rulează la fiecare pull request, împotriva schemei reale, cu un client real și o cheie anon reală.
- În Opțiunea B, riscul se mută în `search_path` și în pooling de conexiuni — un loc unde nu avem nici RLS ca plasă de siguranță, nici o metodă standard de test.
- În Opțiunea C, riscul se mută în stratul de rutare a conexiunilor și în operarea a N baze de date de către o echipă care nu are rol de operare. Riscul cel mai probabil devine unul operațional (backup neverificat, migrare parțială), nu unul de izolare.

În plus, **Storage-ul anulează o parte din avantajul lui B**: fotografiile sesizărilor și documentele cererilor — datele cele mai sensibile — stau oricum în `storage.objects`, unde frontiera este tot RLS + cale. Am plăti costul complet al schemei per tenant și am păstra totuși mecanismul RLS exact acolo unde contează cel mai mult.

**De ce claim din JWT și nu hostname**

Hostname-ul este date furnizate de client. Header-ul `Host` poate fi orice; un client poate emite cereri direct către API-ul Supabase, fără să treacă prin site. Dacă tenantul ar fi dedus din hostname sau dintr-un header, un utilizator autentificat ar putea citi datele altui tenant schimbând un șir de caractere. Claim-ul din JWT este **semnat** și emis de server pe baza unei corespondențe user → tenant stocate în baza de date; clientul nu îl poate influența.

Consecința practică: subdomeniul rămâne util (branding, SEO, memorabilitate, „primăria mea"), dar nu poartă nicio greutate de securitate. Cele două roluri sunt separate complet.

**De ce un cont = un tenant**

Un cont multi-tenant impune claim-uri de tip listă, un „tenant activ" în sesiune și politici RLS care depind de o alegere a utilizatorului. Fiecare dintre acestea este un loc unde izolarea poate ceda. Numărul de persoane care servesc simultan două primării în Phase 1 este, cel mai probabil, zero sau aproape de zero. Plătim această simplitate cu inconveniența descrisă la „Consecințe negative".

**De ce niciun super-admin în RLS**

Un rol care poate citi orice tenant, expus prin aplicație, este exact ținta unui atac: o singură sesiune compromisă a unui angajat al operatorului = toate primăriile. Îl eliminăm din model. Rămâne accesul prin consola furnizorului, care este: deliberat (cineva trebuie să se autentifice în Supabase), nefurabil prin XSS în aplicație (nu există sesiune de super-admin în browser-ul aplicației) și urmăribil la furnizor. Este mai puțin confortabil pentru suport. Acesta este exact scopul.

## Consecințe pozitive

- Politicile RLS finale și schema pot fi scrise acum; **FUP-1 din ADR-0001 este închis**.
- Izolarea are un singur punct de aplicare, deci un singur punct de audit și un singur punct de test.
- Onboarding-ul unei primării noi este un `INSERT` plus DNS. Fără deployment, fără migrare, fără intervenția echipei tehnice în cod.
- Costul crește proporțional cu utilizarea, nu în trepte.
- Un singur istoric de migrații; replay-ul de la zero din ADR-0001 rămâne valid și suficient.
- Suprafața de atac a operatorului platformei este redusă la minimum: nu există rută privilegiată în aplicație.
- Modelul de cont (un tenant, un canal de verificare) menține fluxul de înregistrare scurt și explicabil pentru cetățeni cu experiență digitală limitată.

## Consecințe negative

Acceptate conștient:

1. **O singură politică RLS greșită este o breșă cross-tenant.** Nu există al doilea nivel de apărare în planul de date. Aceasta este consecința directă a alegerii A în locul lui B/C și nu poate fi „mitigată" retoric — doar testată.
2. **Zgomot de vecin.** O primărie cu volum mare degradează performanța celorlalte. Nu există cote de resurse per tenant în Phase 1. Nu avem încă un prag la care declanșăm o acțiune; îl stabilim după primele date reale de utilizare.
3. **Nu există restaurare per tenant.** Backup-ul restaurează întreaga bază de date. Dacă o primărie își distruge datele printr-o operație greșită, recuperarea selectivă înseamnă restaurare într-un mediu separat + extragere + reimport, **o procedură care nu este scrisă și nu este testată** la data acestui ADR.
4. **Un cont = un tenant.** O persoană care servește două primării are nevoie de două conturi, cu două adrese de email sau două numere de telefon distincte. Un cetățean care se mută în altă localitate își face cont nou; nu există transfer.
5. **Conținutul public este citibil cross-tenant.** Un client cu cheia anon poate interoga tabelele public-readable pentru **orice** tenant, nu doar pentru cel al subdomeniului pe care se află. Este acceptabil **exact pentru că informația este deja publică** — dar înseamnă că cineva poate enumera lista primăriilor din platformă și toate anunțurile publicate ale tuturor. Nu pretindem altceva.
6. **Nu există „vezi ca tenantul X" pentru echipa de suport.** Diagnosticarea unei probleme raportate de o primărie se face din log-uri, din reproducere locală și, în ultimă instanță, prin consolă. Aceasta va încetini suportul. Este costul deciziei 11.
7. **Fiecare tabel nou este o oportunitate de a uita RLS.** Disciplina umană nu este suficientă; de aceea verificarea de completitudine a schemei (C1, mai jos) este blocantă în CI.

## Impact asupra securității și confidențialității

### Tabelul `tenants` (ilustrativ)

```sql
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text        not null unique,   -- 'botosani' -> botosani.e-glasul.ro
  hostname      text        not null unique,   -- 'botosani.e-glasul.ro'
  display_name  text        not null,          -- 'Primăria Municipiului Botoșani'
  status        text        not null default 'active'
                            check (status in ('active', 'suspended')),
  -- context de PREZENTARE, nu de autorizare:
  branding      jsonb       not null default '{}'::jsonb,  -- logo_url, culori
  contact       jsonb       not null default '{}'::jsonb,  -- adresă, telefon, email, program
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

### Convenția `tenant_id`

Fiecare tabel deținut de un tenant respectă, fără excepție:

```sql
tenant_id uuid not null
  references public.tenants(id) on delete restrict
  default (select public.current_tenant_id())
```

- `not null` — nu există rând „fără tenant".
- `on delete restrict` — ștergerea unui tenant nu este un accident de cascadă; este o procedură deliberată (ADR ulterior).
- `default` — clientul **nu trebuie** să trimită `tenant_id`; valoarea vine din claim. Chiar dacă îl trimite, `WITH CHECK` îl respinge dacă nu corespunde.
- **Index obligatoriu** cu `tenant_id` pe prima poziție, pentru fiecare tabel.

### Corespondența utilizator → tenant

```sql
create table public.tenant_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now()
);
```

Cheia primară pe `user_id` **impune structural** „un cont = un tenant". Nu este o convenție; este o constrângere.

### Claim-ul din JWT — forma exactă (ilustrativ)

```json
{
  "sub": "9c1f6f0e-4f2a-4f7b-9a01-2e3b7c5d8a11",
  "aud": "authenticated",
  "role": "authenticated",
  "exp": 1783000000,
  "email": "ion.popescu@example.ro",
  "app_metadata": {
    "tenant_id": "3d2b8a51-6c44-4a0e-9f3d-71b0c9e4a2f7"
  },
  "user_metadata": {}
}
```

**Cum este SETAT.** Printr-un **Custom Access Token Hook** (Supabase Auth), la emiterea token-ului. Hook-ul citește corespondența din `tenant_users` — o sursă server-side — și injectează `tenant_id` în `app_metadata`.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_claims    jsonb;
  v_tenant_id uuid;
begin
  select tu.tenant_id
    into v_tenant_id
    from public.tenant_users tu
   where tu.user_id = (event ->> 'user_id')::uuid;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_claims := jsonb_set(
    v_claims, '{app_metadata}',
    coalesce(v_claims -> 'app_metadata', '{}'::jsonb),
    true
  );

  if v_tenant_id is not null then
    v_claims := jsonb_set(
      v_claims, '{app_metadata,tenant_id}',
      to_jsonb(v_tenant_id::text),
      true
    );
  end if;
  -- Dacă utilizatorul nu are tenant, claim-ul LIPSEȘTE.
  -- Consecință: RLS îl refuză peste tot. Fără tenant nu există acces.

  return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;
```

Reguli absolute în jurul acestui mecanism:

- **`app_metadata` NU este scriptibil de client.** `user_metadata` **este** (prin `auth.updateUser`). **`tenant_id` nu are voie să apară niciodată în `user_metadata`.** Confuzia dintre cele două este o breșă completă.
- Tenantul **nu** se citește niciodată dintr-un header de request, dintr-un parametru de query, dintr-un câmp de body sau din hostname.
- Un utilizator fără rând în `tenant_users` primește un token **fără** claim de tenant și, prin urmare, nu poate citi nimic. Fail closed.
- Modificarea `tenant_users` este o operație administrativă, nu una expusă utilizatorului.

**Cum este VERIFICAT.** Exclusiv din `auth.jwt()`, în interiorul politicilor RLS:

```sql
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', ''),
    ''
  )::uuid
$$;
```

Returnează `NULL` când nu există claim. `tenant_id = NULL` este `NULL`, deci fals în `USING`/`WITH CHECK` → **acces refuzat**. Fail closed prin construcție, nu prin `if`.

### Tiparul de politică RLS pentru un tabel deținut de tenant

Exemplu pe `issues` (sesizări). Același tipar se aplică fiecărui tabel cu `tenant_id`.

```sql
alter table public.issues enable row level security;
alter table public.issues force  row level security;   -- se aplică și proprietarului tabelului

-- Deny by default: fără nicio politică, nimeni nu citește și nimeni nu scrie.
-- Politicile de mai jos DESCHID strict, nu restrâng.

create policy issues_select_own_tenant
  on public.issues
  for select
  to authenticated
  using ( tenant_id = (select public.current_tenant_id()) );

create policy issues_insert_own_tenant
  on public.issues
  for insert
  to authenticated
  with check ( tenant_id = (select public.current_tenant_id()) );

create policy issues_update_own_tenant
  on public.issues
  for update
  to authenticated
  using      ( tenant_id = (select public.current_tenant_id()) )   -- ce rânduri pot fi ATINSE
  with check ( tenant_id = (select public.current_tenant_id()) );  -- ce rânduri pot REZULTA

-- Nicio politică DELETE => DELETE este refuzat pentru toți utilizatorii aplicației.
-- Ștergerea logică (deleted_at) se face prin UPDATE, care păstrează faptele auditabile.
```

Puncte care nu sunt decorative:

- **`WITH CHECK` pe `UPDATE` este ceea ce împiedică mutarea unui rând în alt tenant.** `USING` singur ar permite unui utilizator al lui A să ia un rând al lui A și să îi seteze `tenant_id = B`. Rândul ar dispărea din vizorul lui A și ar apărea la B. `WITH CHECK` blochează exact acest lucru. **Un `UPDATE` fără `WITH CHECK` este un bug de securitate, nu o omisiune stilistică.**
- **`FORCE ROW LEVEL SECURITY`** face ca politicile să se aplice **și** proprietarului tabelului (rolul care rulează migrațiile). Fără el, cod care rulează ca proprietar ocolește politicile.
- **`FORCE` nu oprește `service_role`**, care are atributul `BYPASSRLS`. Acest lucru este **intenționat** — este exact mecanismul accesului de urgență din decizia 12 — și este exact motivul pentru care cheia `service_role` nu are voie să existe în niciun bundle de client (V2 din ADR-0001).
- **`(select public.current_tenant_id())`**, nu `public.current_tenant_id()`. Forma cu `select` este evaluată o singură dată (InitPlan), nu o dată pe rând. Diferența este de ordin de mărime pe tabele mari. Corectitudinea este identică; performanța nu.
- Politicile de tenant sunt **doar prima poartă**. Autorizarea pe rol (ce poate face un cetățean vs. un funcționar) se adaugă **în aceleași politici**, ca predicat suplimentar, în ADR-ul de roluri. Frontiera de tenant nu depinde de acel ADR și nu poate fi slăbită de el.

### Alte controale

- Cheia `service_role` nu apare niciodată într-un bundle de client, într-o variabilă `VITE_*`, într-un log sau într-un eveniment Sentry (vezi ADR-0001).
- Acțiunile relevante pentru securitate se scriu într-un audit trail append-only, purtător de `tenant_id`, în aceeași tranzacție cu acțiunea.
- **Perioadele de retenție a datelor personale nu sunt stabilite în acest ADR și nu sunt presupuse.** Rămân deschise, cu owner Product owner + specialist privacy/juridic.

## Impact multi-tenant

Adresează [R-002](../project/risk-register.md).

### Excepția de citire publică — delimitată exact

[OQ-004](../project/open-questions.md#decizie-oq-004--anunțurile-se-încarcă-la-runtime-nu-la-build) impune citirea conținutului public **fără JWT**, cu cheia anon. Prin urmare, pentru citirile publice, tenantul **nu poate** veni dintr-un claim. Acesta este singurul loc din Phase 1 unde regula nu se aplică și îl tratăm ca subiect de securitate, nu ca detaliu.

**Tabelele citibile de rolul `anon` — lista completă și închisă pentru Phase 1:**

| Tabel | Ce se expune | Delimitarea rândurilor |
|---|---|---|
| `public.tenants` | date de prezentare | doar `status = 'active'` |
| `public.announcements` | anunțuri publicate | doar publicate, intrate în vigoare, neexpirate, neșterse |
| `public.info_pages` | informații municipale utile | doar publicate, neșterse |
| `public.issue_categories` | categorii active de sesizare | doar `is_active = true` |

**Orice alt tabel rămâne deny by default pentru `anon`.** Explicit **NU** sunt citibile public: `issues`, `issue_status_history`, `requests`, `attachments`, `tenant_users`, `notifications`, `push_subscriptions`, `sms_events`, `audit_log`, `profiles`.

Tiparul politicii publice, delimitat pe **rânduri** și pe **coloane**:

```sql
alter table public.announcements enable row level security;
alter table public.announcements force  row level security;

-- 1) Delimitare pe RÂNDURI: doar conținut cu adevărat publicat.
create policy announcements_public_read
  on public.announcements
  for select
  to anon
  using (
        status       = 'published'
    and published_at <= now()                         -- programate ≠ vizibile
    and (expires_at is null or expires_at > now())
    and deleted_at is null
    and exists (
      select 1 from public.tenants t
       where t.id = announcements.tenant_id
         and t.status = 'active'
    )
  );

-- 2) Delimitare pe COLOANE: RLS nu filtrează coloane. GRANT-ul o face.
revoke all on public.announcements from anon;
grant select (id, tenant_id, title, body, published_at, expires_at, image_path)
  on public.announcements to anon;
-- created_by, internal_notes, updated_by NU sunt acordate rolului anon.

-- 3) Nicio politică INSERT/UPDATE/DELETE pentru `anon` => scrierea este refuzată.
```

**Ce poate, în consecință, să enumere un client anonim** — spus direct, fără menajamente:

- Un client cu cheia anon poate interoga aceste patru tabele **pentru orice tenant**, nu doar pentru cel al subdomeniului pe care se află. Filtrarea după `tenant_id` în site-ul public este **comoditate de prezentare, nu frontieră**.
- Poate deci obține: lista tuturor primăriilor active din platformă cu brandingul și datele lor de contact, toate anunțurile publicate ale tuturor, toate paginile de informații publicate, toate categoriile active.
- **Acest lucru este acceptabil exact pentru că această informație este deja publică**: este afișată pe site-uri publice, destinată tuturor. Nu pretindem că este protejată.
- **Ce NU poate obține**: nicio sesizare, niciun cetățean, niciun document, niciun draft, **niciun anunț programat dar nepublicat încă**, nicio notă internă, nicio urmă de audit. Delimitarea pe rânduri și pe coloane există exact pentru aceste categorii.

Nota operațională care contează: un anunț programat pentru mâine **nu este** un anunț public azi. Predicatul `published_at <= now()` este singurul lucru care îl ține ascuns. Fără el, orice cetățean cu instrumentele de dezvoltator din browser ar putea citi anunțurile viitoare ale primăriei.

### Frontiera de tenant dincolo de tabele

Izolarea în tabele nu este suficientă. Datele ies din baza de date prin patru rute; fiecare trebuie să țină frontiera.

**Storage.** Convenție de bucket și cale, cu `tenant_id` ca **primul segment**:

| Bucket | Public? | Cale |
|---|---|---|
| `issue-attachments` | privat | `{tenant_id}/{issue_id}/{uuid}.{ext}` |
| `request-documents` | privat | `{tenant_id}/{request_id}/{uuid}.{ext}` |
| `tenant-public` | citire publică | `{tenant_id}/branding/...`, `{tenant_id}/announcements/...` |
| `exports` | privat | `{tenant_id}/{user_id}/{export_id}.{ext}` |

```sql
create policy issue_attachments_read_own_tenant
  on storage.objects for select to authenticated
  using (
        bucket_id = 'issue-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
  );

create policy issue_attachments_write_own_tenant
  on storage.objects for insert to authenticated
  with check (
        bucket_id = 'issue-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
  );
```

Primul segment al căii **este** token-ul de autorizare: `WITH CHECK` face imposibilă încărcarea sub prefixul altui tenant, iar `USING` face imposibilă citirea sau listarea lui. Livrarea se face prin **URL-uri semnate cu durată scurtă**; un URL semnat este un bearer token — cine îl are, îl poate folosi până expiră. Emiterea lui trebuie autorizată, iar durata trebuie scurtă. Regulile complete de tip, dimensiune, proprietate și durată sunt în ADR-ul de storage.

**Exporturi.** Se generează **pe server**, executând interogarea **cu JWT-ul utilizatorului** (deci sub RLS), niciodată cu `service_role`. Serverul **nu acceptă niciodată `tenant_id` ca parametru de la client**: îl citește din claim. Filtrele venite de la client pot doar **restrânge** rezultatul, niciodată să îl lărgească. Fișierul rezultat se scrie sub `exports/{tenant_id}/...` și se livrează prin URL semnat cu durată scurtă. Un export generat pe client din date deja încărcate nu este o problemă de izolare (datele erau deja permise), dar nu este acceptat ca sursă de adevăr pentru rapoarte.

**Notificări.** Lista de destinatari se construiește **exclusiv** dintr-o interogare delimitată pe `tenant_id`-ul evenimentului care a declanșat notificarea. Tabelele `notifications` și `push_subscriptions` poartă `tenant_id`. O trimitere în masă este întotdeauna „pentru tenantul X", niciodată „pentru toți utilizatorii". Înainte de trimitere, jobul verifică faptul că fiecare destinatar aparține tenantului evenimentului; o nepotrivire oprește jobul, nu îl continuă.

**Joburi de fundal.** Un job **nu are voie să ruleze cu `service_role` și acces general**, „peste toate datele". Tiparul obligatoriu:

- jobul primește un **scope de tenant explicit** și iterează tenant cu tenant;
- rulează sub un rol **fără `BYPASSRLS`**, stabilind contextul de tenant pentru fiecare iterație (de exemplu prin `set_config('request.jwt.claims', ...)` în tranzacție), astfel încât `auth.jwt()` — și deci RLS — se aplică normal;
- dacă o operație nu poate fi făcută sub RLS, ea trebuie justificată individual, delimitată la un singur tenant și înregistrată în audit. Nu există „jobul are nevoie de service_role" ca justificare generală.

**Contorizarea SMS.** Fiecare SMS trimis scrie un rând append-only în `sms_events(tenant_id, purpose, provider_message_id, created_at)`. Fără `tenant_id`, refacturarea per primărie nu poate fi verificată — deci nu poate fi făcută. Furnizorul de SMS nu este ales aici.

### Cum dovedește suita cross-tenant frontiera

Extinde **V1** din [ADR-0001](./ADR-0001-phase-1-technology-and-deployment-baseline.md). Se execută cu un client Supabase real și **cheia anon** (niciodată `service_role`), cu doi tenanți de test (A și B), fiecare cu utilizatori și date proprii. Cazurile sunt enumerabile, nu ilustrative:

| # | Caz | Rezultat cerut |
|---|---|---|
| T1 | Utilizator A face `select` filtrat pe rânduri ale lui B, **pe fiecare tabel cu `tenant_id`** | 0 rânduri |
| T2 | Utilizator A face `select` nefiltrat pe fiecare tabel | strict rândurile lui A, număr egal cu cel cunoscut |
| T3 | Utilizator A face `insert` cu `tenant_id` = B | eroare (`WITH CHECK`) |
| T4 | Utilizator A face `insert` fără `tenant_id` | rândul primește `tenant_id` = A (default din claim) |
| T5 | Utilizator A face `update` pe un rând al lui A, setând `tenant_id` = B | eroare (`WITH CHECK`) — **testul care prinde politica fără `WITH CHECK`** |
| T6 | Utilizator A face `update` pe un rând al lui B | 0 rânduri afectate |
| T7 | Utilizator A face `delete` pe un rând al lui B, și pe unul al lui A | ambele refuzate (nicio politică DELETE) |
| T8 | Client **anon** face `select` pe fiecare tabel **care nu e în lista public-readable** | 0 rânduri / refuz |
| T9 | Client **anon** citește `announcements`: există un draft, un anunț programat în viitor, unul expirat, unul șters | niciunul dintre cele patru nu apare; apare doar cel publicat și în vigoare |
| T10 | Client **anon** citește coloane neacordate (`internal_notes`) | eroare de permisiune |
| T11 | Client **anon** încearcă `insert`/`update`/`delete` pe tabelele public-readable | refuzat |
| T12 | Utilizator A citește / listează / descarcă un obiect Storage sub prefixul lui B | refuzat |
| T13 | Utilizator A încarcă un fișier sub prefixul `{tenant_B}/...` | refuzat (`WITH CHECK`) |
| T14 | Utilizator A cere un export trimițând `tenant_id = B` în payload | exportul conține exclusiv date A (parametrul e ignorat) sau cererea e respinsă |
| T15 | Utilizator A autentificat, cu cererile emise către subdomeniul lui B | rezultate identice cu T1–T7: **hostname-ul nu schimbă nimic** |
| T16 | Utilizator fără rând în `tenant_users` (token fără claim) | 0 rânduri pe orice tabel; orice scriere refuzată |
| T17 | Job de fundal rulat pentru tenantul A | nu atinge niciun rând al lui B (verificat prin audit al rândurilor scrise) |
| T18 | Notificare generată de un eveniment al lui A | niciun destinatar din B |

Verificări structurale, la nivel de schemă (rulează pe catalogul PostgreSQL, nu pe date):

| # | Verificare | Rezultat cerut |
|---|---|---|
| C1 | Fiecare tabel din `public` care are coloană `tenant_id` are `rowsecurity = true`, `relforcerowsecurity = true` și **cel puțin o politică** | fără excepție; un tabel nou fără RLS **pică build-ul** |
| C2 | Nicio politică nu are `USING (true)` sau `WITH CHECK (true)` pe un tabel cu `tenant_id` | zero potriviri |
| C3 | Fiecare politică `FOR UPDATE` pe un tabel cu `tenant_id` are clauză `WITH CHECK` | fără excepție |
| C4 | Rolul `anon` nu are `INSERT`/`UPDATE`/`DELETE` pe niciun tabel | zero privilegii de scriere |
| C5 | Rolul `anon` are `SELECT` **doar** pe cele patru tabele din lista public-readable | lista din cod = lista din ADR |
| C6 | Fiecare tabel cu `tenant_id` are un index cu `tenant_id` pe prima poziție | fără excepție |
| C7 | `tenant_id` nu apare niciodată în `user_metadata` (scriptibil de client) | zero potriviri în cod și în hook |

C1 este cea mai importantă verificare din acest ADR: **transformă „am uitat RLS pe tabelul nou" dintr-o breșă tăcută într-un build roșu.**

## Impact operațional și cost

**Onboarding-ul unui tenant** (procedură, nu cod):

1. `INSERT` în `tenants` (slug, hostname, display_name, branding, contact).
2. Înregistrare DNS pentru subdomeniu (acoperită de wildcard, dacă wildcard-ul este configurat).
3. Creare cont pentru administratorul primăriei + rând în `tenant_users`.

Fără deployment, fără migrare, fără rebuild. **DNS-ul wildcard, certificatele TLS și procedura operațională completă de onboarding nu sunt rezolvate în acest ADR** — sunt un ADR separat.

**Ciclu de viață.** `status = 'suspended'` scoate tenantul din conținutul public (predicatul din politicile publice) — dar **nu** este definit aici ce se întâmplă cu accesul utilizatorilor lui, cu datele lui și cu fișierele lui. Suspendarea, ștergerea și exportul complet al unui tenant care pleacă sunt un ADR separat.

**Cost.**

- Costul bazei de date crește cu volumul agregat, nu cu numărul de tenanți. Un tenant mic costă aproape nimic.
- Costul dominant rămâne, ca în ADR-0001, **egress-ul de fișiere**.
- **SMS este un cost nou și direct**, suportat de operator și refacturat per primărie. Este singura componentă de cost pe care un atacator o poate crește direct: fiecare înregistrare prin telefon = un SMS = bani. De aceea rate limiting per tenant **și** Turnstile pe înregistrare și pe resetarea parolei sunt cerințe, nu opțiuni.
- Nu formulăm o estimare de cost în cifre; ar fi inventată. Se face după alegerea furnizorului de SMS și după primele date de utilizare.

**Zgomot de vecin.** Nu avem cote per tenant. Ce facem: monitorizăm volumul per tenant (rânduri, storage, egress, SMS). Ce nu facem: nu inventăm un prag de intervenție înainte de a avea date reale.

## Impact asupra migrării și compatibilității

Nu există sistem existent de migrat. Impactul este asupra **disciplinei de schemă**, pornind de la primul commit:

1. Tabelele `tenants` și `tenant_users`, funcția `current_tenant_id()` și hook-ul de token sunt în **primele migrații**. Nimic altceva nu se construiește înaintea lor.
2. **Nicio migrație care creează un tabel cu `tenant_id` nu are voie să fie separată de migrația care îi activează RLS și îi definește politicile.** Ele sunt aceeași schimbare. C1 pică altfel.
3. Migrațiile sunt **forward-only** (ADR-0001). O politică RLS greșită se corectează printr-o migrație nouă, nu prin editare în consolă.
4. **Calea de ieșire către Opțiunea C rămâne deschisă, dar nu gratuită.** Pentru că fiecare rând poartă `tenant_id` și fiecare fișier are `tenant_id` ca prim segment de cale, extragerea completă a unui tenant este mecanic posibilă (filtrare pe `tenant_id` în toate tabelele + copiere de prefix în Storage). Ce **nu** se transferă simplu: utilizatorii din `auth.users` și sesiunile lor — Supabase Auth este per proiect. O migrare reală a unui tenant într-un proiect propriu ar însemna re-crearea conturilor și, foarte probabil, resetarea parolelor. **Estimare onestă: zile de muncă și o întrerupere vizibilă pentru cetățeni, nu o operație transparentă.** Nu pretindem că modelul este „gata de C".
5. Trecerea de la „un cont = un tenant" la conturi multi-tenant ar fi o schimbare **incompatibilă**: cheia primară din `tenant_users`, forma claim-ului și fiecare politică RLS s-ar schimba. Nu o pregătim acum. Dacă devine cerință, este un ADR care înlocuiește acest ADR, nu o extensie a lui.

## Plan de validare

Toate verificările produc un rezultat observabil. Cele blocante opresc merge-ul în `main`.

| ID | Verificare | Cum se dovedește | Poartă |
|---|---|---|---|
| C1 | Completitudinea RLS pe schemă | Interogare pe `pg_class` / `pg_policies`: fiecare tabel cu `tenant_id` are RLS activat, `FORCE` activat și ≥1 politică. Orice excepție = build roșu. | Blocantă în CI |
| C2–C7 | Verificările structurale din secțiunea anterioară | Aceeași suită, pe catalogul PostgreSQL, după migration replay | Blocantă în CI |
| T1–T18 | Suita cross-tenant | Teste automate cu client anon real, doi tenanți, pe schema reală produsă de replay. Extinde V1 din ADR-0001. | Blocantă în CI |
| V2 (ADR-0001) | `service_role` absent din bundle-uri | Scanare a artefactului de build | Blocantă în CI |
| P1 | Planul de execuție folosește indexul pe `tenant_id` | `EXPLAIN` pe interogările principale, cu RLS activ, pe un set de date cu ≥2 tenanți; nu apare `Seq Scan` pe tabelele mari | Informativă, revizuită la fiecare release |
| P2 | Contorizarea SMS este completă | Fiecare SMS trimis are exact un rând în `sms_events` cu `tenant_id` corect; test de reconciliere față de raportul furnizorului | Blocantă înainte de activarea înregistrării prin telefon |
| P3 | Rate limiting și Turnstile pe înregistrare | Test: N cereri de înregistrare peste prag sunt refuzate; o cerere fără token Turnstile valid este refuzată | Blocantă înainte de activarea înregistrării prin telefon |
| P4 | Accesul de urgență lasă urmă | Verificare că o acțiune făcută din consola Supabase cu `service_role` apare în log-urile de audit ale furnizorului, iar procedura este documentată | Blocantă înainte de primul tenant real |

[R-002](../project/risk-register.md) nu poate fi mutat din `Open` fără C1–C7, T1–T18 și V2 verzi pe schema reală.

## Acțiuni ulterioare

**ADR-uri ulterioare necesare** (cele marcate „nou" nu existau în ADR-0001):

| ID | ADR necesar | De ce este blocant |
|---|---|---|
| FUP-2 | **Model de autentificare și roluri** — roluri în interiorul tenantului (cetățean, funcționar, administrator de primărie), sursa de adevăr a rolului, cum se adaugă rolul în politicile RLS peste predicatul de tenant | Fără el, politicile RLS pot delimita tenantul, dar nu și ce poate face fiecare rol. Blochează administrarea. |
| FUP-3 | **Storage și control al accesului la fișiere** — tipuri și dimensiuni permise, proprietate, durata URL-urilor semnate, cine poate emite un URL semnat, retenție | Blochează sesizările cu fotografii și cererile cu documente. |
| FUP-4 | **Notificări, furnizor SMS/email și contorizare per tenant** — **furnizorul de SMS nu este ales în ADR-0002**; idempotență, numărul de înregistrare pe email, push, reconciliere de cost per tenant | Blochează înregistrarea prin telefon (decizia 9) și P2/P3. |
| FUP-5 | **Export (PDF / spreadsheet)** — generare server-side sub RLS, filtre care doar restrâng, livrare prin URL semnat | Cerință funcțională Phase 1; T14 depinde de el. |
| FUP-6 | **Observabilitate și retenție** — ce se loghează, ce NU, **perioadele de retenție a datelor personale, care NU sunt stabilite în ADR-0002 și nu se inventează** | Cerință din `.claude/rules/security.md`. |
| FUP-8 | **Publicarea conținutului public dinamic** — schema `announcements`, cache și revalidare în browser, stări de încărcare și eroare, programarea publicării | Consumă direct politica publică definită aici. |
| **FUP-10** (nou) | **Acces de suport bazat pe consimțământ, limitat în timp** — cum poate echipa de suport să investigheze o problemă a unei primării fără super-admin: consimțământ explicit al tenantului, durată limitată, scope limitat, urmă de audit vizibilă tenantului | Decizia 11 elimină super-adminul. Fără FUP-10, suportul se face doar din consolă. Este o lipsă funcțională asumată, nu rezolvată. |
| **FUP-11** (nou) | **DNS wildcard, certificate TLS și procedura de onboarding a unui tenant** — `*.e-glasul.ro`, certificate, pașii operaționali, cine execută | Decizia 4 promite „onboarding fără deployment". Fără FUP-11, promisiunea nu este operațională. |
| **FUP-12** (nou) | **Ciclul de viață al tenantului** — suspendare (ce se întâmplă cu utilizatorii și datele), ștergere, export complet la încetarea contractului, **procedura de restaurare selectivă a unui singur tenant** (inexistentă azi — vezi „Consecințe negative", punctul 3) | Consecință directă a alegerii Opțiunii A. Fără el, nu putem promite unei primării nici ștergerea, nici recuperarea datelor ei. |
| **FUP-13** (nou) | **Punctul de aplicare a rate limiting-ului** — unde se aplică efectiv limita per tenant (CDN/edge, Supabase, funcție server), cum se identifică tenantul înainte de autentificare, ce se face la depășire | Decizia 16 cere rate limiting per tenant, dar mecanismul nu este ales. Blochează P3 și expunerea publică a înregistrării. |

**Actualizări de registru — EFECTUATE**, prin commit-uri separate:

- [`docs/project/risk-register.md`](../project/risk-register.md) — R-002 are ca măsuri C1–C7 și T1–T18 din acest ADR. Riscul **rămâne `Open`** până când sunt verzi pe o schemă reală.
- [`docs/project/open-questions.md`](../project/open-questions.md) — întrebările deschise de mai jos sunt înregistrate acolo, cu owner și status.

**Întrebări deschise, care NU sunt ascunse în acest ADR** (evidența lor se ține în [registrul de întrebări deschise](../project/open-questions.md); mai jos sunt enunțate, nu urmărite):

- **Perioadele de retenție** a datelor personale, a documentelor încărcate și a log-urilor. **Nestabilite. Nu le inventăm.** Owner: Product owner + specialist privacy/juridic.
- **Furnizorul de SMS** și costul unitar real. Owner: Product owner + Solution architect (FUP-4).
- **Pragul de zgomot de vecin** la care intervenim. Nedefinit; se stabilește pe date reale, nu pe presupuneri. Owner: Solution architect.
- **Procedura de restaurare selectivă a unui tenant.** Nu există și nu este testată. Owner: Solution architect (FUP-12).
- **Cerințele legale de localizare a datelor** (regiunea Supabase). Neconfirmate; nu formulăm o cerință legală neverificată. Owner: Product owner + juridic.

## Surse și documente asociate

- [ADR-0001 — Baseline tehnologic și de deployment pentru Phase 1](./ADR-0001-phase-1-technology-and-deployment-baseline.md) — acest ADR este FUP-1 din el; preia V1 (teste cross-tenant) și V2 (scanare de secrete) ca porți de CI.
- [`docs/project/open-questions.md`](../project/open-questions.md) — decizia OQ-002 (subdomeniu per primărie, tenant din JWT) pe care acest ADR o implementează; decizia OQ-004 (citire publică fără JWT), care generează excepția de citire publică.
- [`docs/project/risk-register.md`](../project/risk-register.md) — R-002, riscul pe care acest ADR îl adresează.
- `CLAUDE.md` — scope Phase 1, monolit modular, interdicția de a inventa cerințe legale, definiția de „done" pentru artefacte de planificare.
- `.claude/rules/architecture.md` — multi-tenancy explicită, relație de tenant pe fiecare înregistrare, frontieră de tenant păstrată în exporturi, notificări, joburi de fundal și fișiere.
- `.claude/rules/security.md` — deny by default, autorizare server-side, izolarea tenantului ca frontieră de securitate, interdicția expunerii credențialelor privilegiate, interdicția inventării perioadelor de retenție.
