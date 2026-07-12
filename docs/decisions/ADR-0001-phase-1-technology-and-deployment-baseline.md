# ADR-0001: Baseline tehnologic și de deployment pentru Phase 1

- **Status:** Proposed
- **Data:** 2026-07-11
- **Decidenți:** Product owner, Solution architect
- **Înlocuiește:** None
- **Înlocuit de:** None

## Context

e-glasul este o platformă civică multi-tenant. În Phase 1 livrăm două experiențe distincte pentru fiecare primărie (tenant):

1. Un **site public** (prezentare, informații municipale utile, anunțuri publice) — conținut citit de cetățeni neautentificați și indexat de motoarele de căutare.
2. O **aplicație autentificată**: PWA pentru cetățeni (sesizări cu fotografie, hartă, categorie, urmărire status, cereri simple cu încărcare de documente) și aplicația de administrare pentru personalul primăriei (triaj, atribuire, schimbare status cu istoric, anunțuri, export PDF/spreadsheet, dashboard de management).

Până acum, stack-ul tehnic nu a fost fixat. `CLAUDE.md` interzice explicit inițializarea framework-urilor și a bazelor de date înainte de aprobarea unui baseline arhitectural, iar `docs/project/open-questions.md` înregistrează acest gol ca **OQ-001 — „Care este stack-ul tehnic aprobat pentru Phase 1?"**, cu status `Open` și mențiunea `ADR required`. Acest ADR este răspunsul la OQ-001.

Constrângerile reale ale proiectului în acest moment:

- O singură echipă mică, fără echipă de operare (SRE/DBA) dedicată.
- Buget de infrastructură redus; costul trebuie să crească aproximativ proporțional cu numărul de tenanți, nu în trepte mari.
- Izolarea între tenanți este o **frontieră de securitate**, nu o preferință de UX (`.claude/rules/architecture.md`, `.claude/rules/security.md`), iar registrul de riscuri o marchează ca **R-002 — „Izolare multi-tenant incompletă", impact Critical**.
- Cerințe funcționale care ating direct alegerea platformei: PWA, hărți/GIS, încărcare și livrare controlată de fișiere, audit trail, export, notificări.
- Phase 2/3 (Ghișeul.ro, programări, portal de transparență, sondaje, asistent AI) sunt **amânate** și nu justifică, prin ele însele, complexitate suplimentară acum.

Acest ADR fixează **baseline-ul**: limbaj/runtime, organizarea repository-ului, framework-uri front-end, platforma de date și autentificare, hosting, stilul arhitectural, observabilitatea, protecția anti-abuz pe endpoint-uri publice și disciplina de livrare. Nu fixează modelul de tenancy, modelul de roluri, schema de date sau contractele de API — acestea sunt ADR-uri ulterioare, enumerate în „Acțiuni ulterioare".

## Factori de decizie

Ordonați descrescător după greutatea avută în decizie:

| # | Factor | De ce contează |
|---|---|---|
| D1 | Izolare multi-tenant demonstrabilă | R-002 are impact Critical. Vrem izolare aplicată în planul de date (server-side), nu doar în UI. |
| D2 | Securitate și confidențialitate din start | Date personale ale cetățenilor, documente încărcate, audit trail. Deny-by-default obligatoriu. |
| D3 | Cost operațional și număr mic de componente de operat | Fără echipă de operare; fiecare componentă proprie (server, DB, backup, patching) este cost recurent real. |
| D4 | Viteză de livrare a Phase 1 fără a sacrifica auditabilitatea | `CLAUDE.md` interzice explicit acest schimb. |
| D5 | SEO și performanță pentru conținutul public | Site-ul public trebuie indexabil și utilizabil pe conexiuni mobile slabe. |
| D6 | Capabilități PWA, offline-tolerant, stateful pentru aplicația autentificată | Cetățeanul fotografiază în teren, uneori cu semnal slab. |
| D7 | Integritatea datelor și reproductibilitatea schemei | Fără modificări manuale de schemă în producție. |
| D8 | Capabilitatea echipei | TypeScript/React este competența existentă. Nu introducem un limbaj sau un model de operare nou în Phase 1. |
| D9 | Cost de ieșire (lock-in) acceptabil și conștient | Nu eliminăm lock-in-ul; îl limităm și îl documentăm. |
| D10 | Opționalitate pentru Phase 2/3 doar unde costul e mic azi | `CLAUDE.md`: fără cerințe speculative. |

## Opțiuni analizate

### Opțiunea A — Monorepo pnpm + Astro (site public) + React/Vite (aplicație) + Supabase + Netlify

Un singur repository pnpm cu `apps/public` (Astro, generat static implicit) și `apps/app` (React + Vite + TypeScript, PWA + administrare). Supabase furnizează PostgreSQL, Authentication, Storage și capabilitățile de backend. Netlify găzduiește cele două aplicații ca **două proiecte Netlify separate conectate la același repository GitHub**.

**Avantaje**

- Un singur plan de date (PostgreSQL) cu Row Level Security ca punct unic de aplicare a izolării între tenanți (D1). Regula de izolare se scrie o dată, lângă date, nu în fiecare handler.
- Două profile de execuție tratate corect: site-ul public livrează HTML pre-generat, cu JavaScript minim; aplicația livrează un bundle SPA autentificat, cu service worker și stare de client (D5, D6).
- Cost de pornire redus și predictibil: nu operăm servere, backup-uri, patching de sistem de operare sau replici de bază de date (D3).
- Tipuri TypeScript și contractul de bază de date partajate într-un singur repo; o schimbare care atinge simultan schema, aplicația și site-ul public se face într-un singur pull request atomic (D4, D7).
- Storage cu URL-uri semnate și politici de acces pe bucket — răspunde direct cerinței de livrare controlată a fișierelor (D2).
- Migrații versionate din CLI Supabase, aplicabile în CI/CD; schema este reproductibilă de la zero (D7).

**Dezavantaje**

- **Vendor lock-in real pe Supabase**, în special pe Auth, Storage și politicile RLS. PostgreSQL este portabil; produsul construit în jurul lui este mai puțin.
- Doi furnizori (Netlify + Supabase) în loc de unul: două console, două seturi de secrete, două puncte de defect, două facturi.
- Fără SSR pe site-ul public implicit: conținut care se schimbă des (de ex. anunțuri) necesită rebuild sau hidratare pe client. Trebuie decis explicit per tip de conținut.
- RLS este puternic, dar este cod cu semantică subtilă; politici greșite eșuează silențios (fie blochează, fie expun). Necesită suită de teste dedicată.
- Monorepo pnpm fără Turborepo: CI mai simplu de înțeles, dar fără cache de task-uri; timpul de CI crește liniar cu numărul de pachete.
- Două aplicații front-end înseamnă două build-uri, două seturi de variabile de mediu și un anumit dublaj în layer-ul de prezentare (design tokens, componente de bază).

**Riscuri**

- **Cheia `service_role` ajunge accidental într-un bundle de browser.** Bundle-ul Vite este servit clientului; orice variabilă `VITE_*` este publică. Consecință: bypass complet al RLS și expunere cross-tenant. Risc de severitate maximă, direct legat de R-002.
- Dependență de disponibilitatea Supabase; un incident al furnizorului oprește autentificarea și datele.
- Limitele planurilor Supabase (conexiuni, storage, egress) pot fi atinse pe măsură ce cresc tenanții — necesită monitorizare, nu presupuneri.
- Dacă logica ajunge împrăștiată între politici RLS, funcții de bază de date și cod de client, auditabilitatea scade. Necesită granițe de modul explicite.

### Opțiunea B — O singură aplicație Next.js pe Vercel (site public + aplicație)

**Avantaje**

- Un singur framework, un singur build, un singur furnizor de hosting; mai puține concepte pentru echipă.
- SSR/ISR nativ: anunțurile publice pot fi randate pe server și revalidate fără rebuild complet — răspuns mai bun decât A la conținut public dinamic.
- Server Components / Route Handlers permit menținerea integrală a logicii de autorizare pe server, cu bundle de client mai mic pentru zonele autentificate.
- Un singur set de variabile de mediu; secretele de server nu trec prin bundle-ul de client prin construcție.
- Este stack-ul implicit din instrucțiunile globale ale utilizatorului — cost de învățare zero.

**Dezavantaje**

- Site-ul public și aplicația autentificată împart același deploy: o regresie în aplicație poate scoate din funcțiune și site-ul public informativ al primăriei. „Blast radius" mai mare.
- Un singur artefact face mai greu de menținut disciplina „public = static, puțin JS": e ușor să se scurgă dependențe ale aplicației în paginile publice.
- Configurarea PWA/service worker peste App Router este mai puțin directă decât peste Vite.
- Rămâne necesar un plan de date; Next.js nu rezolvă multi-tenancy — se combină oricum cu Supabase sau cu un backend propriu, deci nu elimină decizia D1, doar o amână.
- Rulare pe funcții serverless: costul devine dependent de trafic, mai greu de prognozat pentru un site public indexat.

**Riscuri**

- Cuplare între cele două profile de produs, cu tendință de creștere în timp (un „mic" import comun devine dependență permanentă).
- Lock-in pe primitivele de deploy Vercel (ISR, middleware) dacă sunt folosite intensiv.
- Un incident de build blochează simultan ambele audiențe.

Opțiunea B este o alegere legitimă și, pentru conținut public dinamic, tehnic superioară Opțiunii A. A fost respinsă din motive de izolare a defectelor și de claritate a profilurilor de execuție (vezi „Motivație"), nu pentru că ar fi slabă.

### Opțiunea C — Repository-uri separate pentru fiecare aplicație

**Avantaje**

- Granițe fizice între site-ul public și aplicație; imposibil de importat accidental cod al aplicației în site.
- Permisiuni și cicluri de release independente; util dacă în viitor echipe diferite dețin cele două aplicații.
- CI mai scurt pe fiecare repo.

**Dezavantaje**

- Contractul de bază de date și tipurile partajate trebuie distribuite ca pachet versionat sau duplicate. Ambele variante costă: publicare/versionare, sau divergență.
- O schimbare de schemă care atinge ambele aplicații nu mai poate fi atomică: apare o fereastră în care un repo este actualizat și celălalt nu.
- Migrațiile au un singur proprietar natural; în două repo-uri, proprietatea devine ambiguă.
- Review și trasabilitate fragmentate: un pull request nu mai descrie complet schimbarea.

**Riscuri**

- Drift de contract între aplicații, detectat târziu (în producție, nu în CI).
- Costul de coordonare crește exact la schimbările cele mai sensibile — cele care ating datele.

### Opțiunea D — Backend propriu (Node/NestJS) + PostgreSQL auto-administrat, în locul Supabase

**Avantaje**

- Control complet asupra autentificării, autorizării, schemei și livrării fișierelor; nicio semantică ascunsă în platformă.
- Lock-in minim: PostgreSQL standard, cod propriu, portabil între furnizori.
- Izolarea multi-tenant se poate implementa la nivel de aplicație într-un singur strat de acces la date, ușor de citit și de testat cu unelte obișnuite.
- Fără limite de plan impuse de un furnizor; costul la scară mare poate fi mai mic.

**Dezavantaje**

- Trebuie construite din zero, în Phase 1: autentificare (parole, reset, verificare email, sesiuni, rate limiting), storage cu URL-uri semnate, migrații, backup-uri, restaurare, patching, monitorizare, hardening.
- Sarcină de operare permanentă pentru o echipă care nu are rol de operare dedicat (D3, D8).
- Fiecare componentă construită de noi este o suprafață de atac în plus, întreținută de noi. Autentificarea scrisă în casă este istoric o sursă de vulnerabilități.
- Întârzie livrarea Phase 1 cu săptămâni fără a livra valoare vizibilă pentru cetățean sau primărie.

**Riscuri**

- Risc de securitate mai mare pe termen scurt decât o platformă gestionată, exact în zona cu impact Critical (D1, D2).
- Risc operațional: backup neverificat, restaurare netestată, patch întârziat.
- Costul real (timp de om) este subestimat sistematic în acest tip de decizie.

Opțiunea D rămâne calea de ieșire dacă lock-in-ul Supabase devine inacceptabil. Este respinsă **acum**, pentru Phase 1, nu în principiu.

## Decizie

Adoptăm **Opțiunea A**, cu următoarele elemente fixate ca decise:

**Repository și runtime**

1. Un singur **monorepo pnpm**.
2. **Node.js 24 LTS**, **pnpm 11**.
3. Explicit **fără Turborepo** în Phase 1.

**Aplicații**

4. `apps/public` — site public, **Astro**, **generat static implicit**.
5. `apps/app` — PWA pentru cetățeni + aplicația de administrare a primăriei, **React + Vite + TypeScript**.

**Date și backend**

6. **Supabase** furnizează PostgreSQL, Authentication, Storage și capabilitățile de backend.
7. **Toate modificările de bază de date sunt reprezentate prin fișiere de migrare versionate**, comise în repository.
8. **Dezvoltarea locală pe Supabase local este obligatorie înainte de deployment remote.**
9. **Deployment-ul în producție nu depinde de modificări manuale de schemă.**

**Hosting**

10. **Netlify** găzduiește site-ul Astro și aplicația React ca **două proiecte Netlify separate, conectate la ACELAȘI repository GitHub**.

**Stil arhitectural**

11. Phase 1 este un **monolit modular**.
12. Excluse explicit în Phase 1: **microservicii, Kubernetes, event bus-uri, baze de date multiple, Turborepo, sisteme de plugin-uri speculative**.

**Observabilitate și anti-abuz**

13. **Sentry** din primul release funcțional al aplicației.
14. **Cloudflare Turnstile** doar pe endpoint-urile publice cu risc real de spam/abuz (formulare publice neautentificate), nu global.

**Disciplină de livrare**

15. **GitHub Pull Requests + verificări CI automate obligatorii înainte de merge în `main`.**

Această decizie **închide OQ-001**. Actualizarea `docs/project/open-questions.md` este o acțiune ulterioară (vezi „Acțiuni ulterioare"); acest ADR nu modifică acel fișier.

## Motivație

**De ce UN SINGUR monorepo (și nu Opțiunea C)**

Cele două aplicații nu sunt independente: consumă aceeași schemă, aceleași enumerări de status, aceleași tipuri de tenant și aceleași politici de acces. Într-un monorepo:

- **Tipuri partajate**: tipurile generate din schemă sunt un pachet intern; ambele aplicații compilează împotriva aceleiași versiuni. O incompatibilitate se manifestă ca eroare de compilare în CI, nu ca eroare în producție.
- **Contract unic de bază de date**: migrațiile au un singur proprietar și un singur istoric liniar.
- **Schimbări atomice cross-app**: o redenumire de câmp sau o schimbare de status atinge migrația, aplicația și site-ul public într-un singur pull request, cu un singur review și un singur punct de revert.
- **Un singur CI**: aceleași porți de calitate (lint, typecheck, teste, teste cross-tenant, scanare de secrete) se aplică uniform.

Costul acceptat: CI mai lent decât cu repository-uri separate, pentru că rulează pe tot ce e afectat. Este acceptabil la scara Phase 1.

**De ce Astro și React/Vite sunt SEPARATE (și nu Opțiunea B)**

Cele două produse au profile de execuție fundamental diferite:

| Dimensiune | `apps/public` (Astro) | `apps/app` (React + Vite) |
|---|---|---|
| Audiență | Anonimă, indexabilă | Autentificată (cetățean, personal primărie) |
| Randare | HTML pre-generat, JavaScript minim | SPA, stare de client, service worker |
| Caching | CDN agresiv, conținut public | Fără cache partajat; răspunsuri per utilizator și per tenant |
| Autentificare | Absentă | Sesiune, roluri, tenant |
| Obiectiv de performanță | Time-to-content pe mobil slab, SEO | Interactivitate, funcționare tolerantă la rețea slabă |

Combinarea lor într-un singur artefact (Opțiunea B) forțează compromisuri în ambele direcții: fie site-ul public cară cod de aplicație, fie aplicația e constrânsă de modelul de randare al site-ului. Separarea aduce și o proprietate operațională concretă: **un deploy defect al aplicației nu scoate din funcțiune site-ul public al primăriei** — pagina de contact, informațiile utile și anunțurile publicate rămân servite de CDN. Invers, un rebuild al site-ului public nu atinge sesiunile active ale personalului.

Recunoaștem explicit ce pierdem: Opțiunea B ar fi oferit SSR/ISR nativ pentru anunțuri și un singur furnizor. Acceptăm conștient acest schimb (vezi „Consecințe negative").

**De ce monolit modular**

- Scara Phase 1 (un pilot, apoi câțiva tenanți) nu produce niciun argument de scalare care să justifice servicii separate.
- O singură echipă: granițele de serviciu ar deveni granițe de coordonare, nu de autonomie.
- **Izolarea între tenanți e mai ușor de garantat într-un singur plan de date**: o singură bază de date, un singur set de politici RLS, o singură suită de teste cross-tenant. Cu servicii multiple și baze de date multiple, izolarea ar trebui demonstrată la fiecare frontieră — R-002 ar deveni sensibil mai greu de închis.
- **Fără tranzacții distribuite**: „schimbă status + scrie istoric + scrie audit + programează notificare" rămâne o tranzacție PostgreSQL, nu o saga.
- Modularitatea se aplică prin granițe explicite de modul în interiorul monolitului (contracte stabile, fără dependențe circulare), conform `.claude/rules/architecture.md`. Extracția unui serviciu rămâne posibilă mai târziu, **dacă apar dovezi** care o cer.

**De ce Supabase (și nu Opțiunea D)**

Autentificarea, storage-ul cu acces controlat și RLS sunt exact componentele pe care nu vrem să le scriem în casă la un produs care manipulează date personale ale cetățenilor și documente oficiale. Timpul economisit se investește în ceea ce nu poate fi cumpărat: modelul de tenancy, workflow-urile municipale, audit trail-ul și testele cross-tenant. Plătim pentru asta cu lock-in, asumat mai jos.

## Consecințe pozitive

- OQ-001 este închisă; echipa poate începe inițializarea repository-ului după acceptarea acestui ADR.
- Un singur punct de aplicare a izolării multi-tenant (RLS în PostgreSQL), deci un singur loc de auditat și testat.
- Schema de date este reproductibilă de la zero din migrațiile din repo; nu există „starea din producție" ca sursă de adevăr.
- Site-ul public poate atinge obiective de performanță și SEO fără a fi tras în jos de bundle-ul aplicației.
- Aplicația poate deveni PWA fără compromisuri de framework.
- Suprafață de operare mică: fără servere, fără Kubernetes, fără broker de mesaje de întreținut.
- Preview deploys per pull request pe ambele proiecte Netlify — review pe artefacte reale, nu pe descrieri.
- Sentry oferă vizibilitate asupra erorilor din primul release, nu după primul incident raportat de primărie.

## Consecințe negative

Acceptate conștient:

1. **Vendor lock-in pe Supabase.** PostgreSQL și migrațiile sunt portabile. Auth (utilizatori, sesiuni, JWT), Storage (bucket-uri, politici, URL-uri semnate) și politicile RLS legate de `auth.*` **nu sunt**. O migrare ulterioară către Opțiunea D ar însemna rescrierea autentificării și a stratului de fișiere. Estimare grosieră: **săptămâni, nu zile**. Nu ascundem acest cost.
2. **Doi furnizori (Netlify + Supabase).** Două console, două seturi de secrete, două domenii de incident, două facturi. Un incident la oricare dintre ei degradează produsul.
3. **Fără SSR pe site-ul public implicit.** Conținutul public care se schimbă des (anunțuri) necesită fie rebuild declanșat, fie încărcare pe client din Supabase. Ambele au dezavantaje (întârziere de publicare vs. conținut neindexabil). **Strategia de publicare a anunțurilor pe site-ul public este o întrebare deschisă**, nu una rezolvată de acest ADR (vezi „Acțiuni ulterioare", FUP-8).
4. **Complexitatea RLS.** Politicile sunt greu de citit, ușor de greșit și eșuează silențios. Necesită teste cross-tenant obligatorii în CI — nu este opțional.
5. **Monorepo pnpm fără Turborepo.** CI mai simplu de citit și de depanat, dar fără cache de task-uri: timpul de build crește liniar cu numărul de pachete. Acceptăm CI mai lent în schimbul unei configurații mai puține. Reevaluăm dacă timpul de CI depășește pragul definit în „Plan de validare".
6. **Două aplicații front-end** înseamnă un anumit dublaj de layer de prezentare (design tokens, componente de bază). Îl limităm printr-un pachet intern partajat, dar nu îl eliminăm.
7. **Node 24 / pnpm 11** trebuie fixate identic local, în CI și în build-urile Netlify; o divergență de versiune produce build-uri care trec local și cad în CI.

## Impact asupra securității și confidențialității

**Principii aplicate (conform `.claude/rules/security.md`)**

- **Deny by default.** Fiecare tabel care conține date de tenant are RLS activat, fără politică permisivă implicită. Absența unei politici înseamnă „acces refuzat", nu „acces liber".
- **Autorizare validată pe server, pentru fiecare acțiune protejată.** Filtrarea în UI nu este autorizare. Aplicația React se execută în browserul unui utilizator potențial ostil.

**Chei și secrete — riscul cel mai mare al acestei decizii**

- Bundle-ul Vite din `apps/app` **este livrat browserului**. Orice variabilă expusă la build (`VITE_*`) este **publică**.
- În orice bundle de client (Astro sau React) poate ajunge **doar cheia publishable/anon** a Supabase. Aceasta este proiectată să fie publică și **nu ocolește RLS**.
- **Cheia `service_role` nu are voie să apară niciodată** într-un bundle de client, într-un fișier `.env` comis, într-o variabilă `VITE_*`, într-un log sau într-un eveniment Sentry. Ea ocolește RLS integral; expunerea ei este echivalentă cu un breach cross-tenant complet (R-002).
- Controale: separarea variabilelor de mediu server/client în Netlify, scanare automată de secrete în CI **și** scanare a artefactului de build produs (nu doar a codului sursă) — vezi „Plan de validare".

**Fișiere**

- Bucket-urile Supabase Storage sunt private implicit. Livrarea se face prin **URL-uri semnate cu durată limitată**, nu prin URL-uri publice permanente.
- Regulile de tip, dimensiune, proprietate și acces pentru fișiere se definesc într-un ADR dedicat (FUP-3). Acest ADR fixează doar mecanismul (Storage + URL-uri semnate), nu politicile.

**Observabilitate**

- Sentry se configurează cu **scrubbing de PII activat**: fără corpuri de request, fără token-uri, fără conținut de documente încărcate, fără date personale în breadcrumbs. Fără stack trace-uri interne returnate utilizatorului.
- Politica de retenție a log-urilor și evenimentelor **nu este stabilită** în acest ADR. **Nu inventăm perioade de retenție** — rămâne deschisă până la validare cu primăria și cu specialistul de privacy (FUP-6).

**Anti-abuz**

- Cloudflare Turnstile se aplică **doar** pe endpoint-urile publice neautentificate cu risc real (de exemplu formularul public de sesizare, dacă rămâne accesibil fără cont). Nu se aplică pe rutele autentificate: acolo controlul este autentificarea plus rate limiting, nu un challenge.

**Audit**

- Acțiunile relevante pentru securitate și schimbările de status se scriu într-un audit trail append-only, în aceeași bază de date, în aceeași tranzacție cu acțiunea. Faptele relevante pentru audit nu se suprascriu. Schema concretă este definită în specificațiile de funcționalitate, nu aici.

## Impact multi-tenant

Legat direct de **R-002 (Izolare multi-tenant incompletă, impact Critical)**.

- **Fiecare înregistrare deținută de un tenant are o coloană `tenant_id` explicită**, `NOT NULL`, cu cheie externă. Nicio deducere implicită a tenantului.
- **RLS este frontiera de aplicare (enforcement boundary)**, în planul de date. Filtrarea în UI, în query-uri de client sau în cod de aplicație este o comoditate, **nu** un control de securitate. Un client compromis trebuie să nu poată citi date ale altui tenant nici dacă emite interogări arbitrare cu cheia anon.
- Frontiera de tenant trebuie păstrată **peste tot**, nu doar în tabele: **Storage** (cale/bucket și politici legate de tenant), **exporturi** (PDF/spreadsheet — sursa de date filtrată server-side), **notificări** (destinatari doar din tenantul care a generat evenimentul), **joburi de fundal** (context de tenant explicit; un job nu rulează „peste toate datele" fără delimitare), **analytics/dashboard** (metricile sunt per tenant).
- **Modelul de tenancy și strategia de rezolvare a tenantului** (subdomeniu vs. path vs. claim în JWT; tenant din token vs. tenant din URL) **NU sunt decise aici**. Este ADR-ul următor și cel mai important (FUP-1). Până la acceptarea lui, nu se scriu politici RLS finale.
- Selecția shared-database / shared-schema cu `tenant_id` este **implicată** de decizia „un singur plan de date, un singur PostgreSQL", dar alternativele (schemă per tenant, bază de date per tenant) trebuie argumentate explicit în FUP-1 înainte de a fi eliminate.
- **Testele cross-tenant sunt o poartă de CI blocantă**, nu un exercițiu opțional (vezi „Plan de validare"). R-002 nu poate trece în `Mitigated` fără ele.

## Impact operațional și cost

**Componente de operat**

| Componentă | Cine o operează | Efort recurent |
|---|---|---|
| PostgreSQL, Auth, Storage | Supabase | Configurare, monitorizare limite, verificare backup |
| Hosting site public | Netlify (proiect 1) | Build config, variabile de mediu |
| Hosting aplicație | Netlify (proiect 2) | Build config, variabile de mediu |
| CI / porți de calitate | GitHub Actions | Întreținerea workflow-urilor |
| Erori | Sentry | Triaj, configurare scrubbing |
| Anti-abuz | Cloudflare Turnstile | Configurare per endpoint |

Nu operăm: servere, orchestrare, broker de mesaje, replici de bază de date.

**Deployment**

- **Un repository GitHub, două proiecte Netlify.**
  - Proiect 1 → build `apps/public` (Astro, output static).
  - Proiect 2 → build `apps/app` (Vite, output SPA).
- Fiecare proiect folosește un **build filter / ignore command** astfel încât un commit care atinge doar cealaltă aplicație să nu declanșeze un build inutil. Notă onestă: schimbările în pachetele partajate declanșează build pe ambele — corect, și dorit.
- **Preview deploys** pe fiecare pull request, pe ambele proiecte.
- **Separarea mediilor** este obligatorie: `local` (Supabase local), `preview/staging` (proiect Supabase separat), `production` (proiect Supabase separat). **Un preview deploy nu are voie să scrie în baza de date de producție.** Managementul concret al secretelor și al mediilor este un ADR ulterior (FUP-7).

**Cost**

- Cost de pornire mic (planuri gratuite/de intrare la Netlify, Supabase, Sentry).
- Costul crește cu: numărul de tenanți, volumul de fișiere încărcate (Storage + egress), minutele de build, volumul de evenimente Sentry.
- **Nu formulăm o estimare de cost în acest ADR** — ar fi o cifră inventată. Estimarea se face după ce FUP-1 fixează modelul de tenancy (care determină direct amprenta de Storage și de bază de date).
- Rămâne de urmărit: **egress-ul de fișiere** este cel mai probabil factor de cost surpriză (fotografii de sesizări, documente atașate).

## Impact asupra migrării și compatibilității

Nu există sistem existent de migrat — este un start pe teren gol. Impactul se referă la **disciplina de schemă**, obligatorie de la primul commit:

1. **Doar migrații versionate.** Orice modificare de schemă (tabel, coloană, index, politică RLS, funcție, trigger, bucket) există ca **fișier de migrare comis în repo**, cu istoric liniar.
2. **Supabase local primul.** Migrația se scrie și se rulează pe stack-ul Supabase local înainte de a atinge orice mediu remote. Nu se creează schemă direct din consola Supabase remote.
3. **Migrațiile se aplică în CI/CD, înainte de release-ul aplicației.** Ordinea este: migrație aplicată → aplicație publicată. Aplicația trebuie să tolereze schema nouă înainte de a depinde de ea.
4. **Fără modificări manuale de schemă în producție.** Producția nu conține schimbări care nu există în repo. Dacă cineva editează manual, starea devine nereproductibilă și migration replay eșuează — de aceea replay-ul este o verificare de CI (vezi „Plan de validare").
5. **Așteptare forward-only.** Nu ne bazăm pe migrații de rollback automate. Recuperarea se face prin **migrație corectivă înainte** plus, dacă e nevoie, restaurare din backup. Consecință: schimbările distructive (drop de coloană, drop de tabel) se fac în **pași expand/contract** separați, nu într-un singur release.
6. **Compatibilitatea client–schemă**: pentru că cele două aplicații se pot deploya la momente diferite, o schimbare de schemă trebuie să fie compatibilă cu versiunea încă live a fiecărei aplicații pe durata ferestrei de deploy.

## Plan de validare

Baseline-ul se consideră validat doar cu **dovezi verificabile**. Fiecare verificare de mai jos are un rezultat observabil.

| ID | Verificare | Cum se dovedește | Poartă |
|---|---|---|---|
| V1 | **Suită de teste cross-tenant** | Test automat: un utilizator autentificat din tenantul A execută citire, scriere, update, delete, listare Storage și export pe resurse ale tenantului B, folosind clientul cu cheia anon. **Toate trebuie să eșueze** (0 rânduri sau eroare de autorizare). Acoperă fiecare tabel cu `tenant_id`. | Blocantă în CI |
| V2 | **Scanare de secrete în artefactul de build** | Se caută `service_role`, chei de serviciu și pattern-uri de secret **în output-ul de build** (`dist/`) al ambelor aplicații, nu doar în sursă. Orice potrivire = build eșuat. | Blocantă în CI |
| V3 | **Migration replay de la zero** | Pe o bază de date PostgreSQL curată, toate migrațiile rulează în ordine, fără eroare, producând schema așteptată (inclusiv politicile RLS). Rulează la fiecare pull request care atinge migrațiile. | Blocantă în CI |
| V4 | **Deriva de schemă** | Diferența dintre schema produsă de replay și schema mediului remote este **zero**. O diferență nenulă înseamnă modificare manuală în producție. | Blocantă înainte de release |
| V5 | **Poarta de CI verde** | Lint, typecheck, teste unitare, V1, V2, V3 trec pe fiecare pull request. Merge în `main` blocat altfel (branch protection). | Blocantă |
| V6 | **Lighthouse / SEO pe site-ul public** | Raport Lighthouse pe paginile publice principale. Prag de referință: Performance ≥ 90 și SEO ≥ 95 pe profil mobil. Pagini indexabile, `sitemap.xml` și metadate prezente. Pragul se confirmă la primul build real. | Blocantă la primul release public |
| V7 | **Sentry primește evenimente** | O eroare provocată intenționat în preview apare în Sentry, cu sursă corectă, **și fără PII** în payload (verificare manuală a evenimentului). | Blocantă la primul release funcțional |
| V8 | **Izolarea mediilor** | Un preview deploy nu poate scrie în baza de date de producție: verificare că variabilele de mediu de preview indică proiectul Supabase de staging. | Blocantă |
| V9 | **Timp de CI** | Se măsoară durata pipeline-ului. Dacă depășește **10 minute** pe un pull request tipic, se reevaluează decizia „fără Turborepo" (nu se schimbă automat — se deschide o discuție). | Informativă |

R-002 nu poate fi mutat din `Open` fără V1 și V2 verzi, demonstrate pe schema reală.

## Acțiuni ulterioare

**ADR-uri ulterioare necesare (în ordinea priorității):**

| ID | ADR necesar | De ce e blocant |
|---|---|---|
| FUP-1 | **Model de tenancy și strategie de rezolvare a tenantului** (shared schema cu `tenant_id` vs. schemă per tenant; tenant din subdomeniu vs. path vs. claim JWT) | Blochează scrierea politicilor RLS finale și schema. Cel mai important ADR următor. Adresează R-002. |
| FUP-2 | **Model de autentificare și roluri** (roluri de cetățean, personal primărie, administrator de tenant, administrator de platformă; sursa de adevăr a rolului; relația cu Supabase Auth) | Blochează orice decizie de autorizare. |
| FUP-3 | **Stocare de fișiere și control al accesului** (structură bucket-uri, proprietate, tipuri și dimensiuni permise, durata URL-urilor semnate, retenție) | Blochează sesizările cu fotografii și cererile cu documente. |
| FUP-4 | **Notificări și livrare de email** (furnizor, numărul de înregistrare pe email, push notifications, idempotență, frontieră de tenant) | Cerință funcțională Phase 1. |
| FUP-5 | **Abordare pentru export (PDF / spreadsheet)** (generare pe client vs. pe server, filtrare server-side, tenant boundary) | Cerință funcțională Phase 1. |
| FUP-6 | **Observabilitate și retenție a log-urilor** (ce se loghează, ce NU se loghează, perioade de retenție — **de validat cu primăria și cu privacy, nu de inventat**) | Cerință din `.claude/rules/security.md`. |
| FUP-7 | **Managementul mediilor și al secretelor** (local / preview / production; rotația cheilor; unde trăiește fiecare secret) | Susține V2 și V8. |
| FUP-8 | **Strategia de publicare a conținutului public dinamic** (anunțuri pe site-ul static: rebuild declanșat vs. încărcare pe client vs. randare hibridă Astro) | Consecință directă a alegerii „static implicit"; nerezolvată aici. |
| FUP-9 | **Definiția matematică a indicatorilor din dashboard-ul de conducere** (formula fiecărui indicator, unitatea de măsură, fereastra de timp, tratarea cazurilor limită) | Cerință Phase 1 din `CLAUDE.md`: fiecare metrică trebuie să aibă o definiție scrisă și un calcul reproductibil. Blochează dashboard-ul de management. |

**Cerință obligatorie pentru FUP-9 — integritatea indicatorilor:**

Indicatorii dashboard-ului de conducere se calculează **exclusiv din istoricul imuabil al tranzițiilor de status**, nu din câmpul de status curent al sesizării.

- Fiecare schimbare de status produce un rând nou, append-only, în istoricul de tranziții (`from_status`, `to_status`, `actor`, `timestamp`, `tenant_id`). Rândurile de istoric nu se modifică și nu se șterg — sunt fapte auditabile (`.claude/rules/architecture.md`: „Do not overwrite audit-relevant facts").
- Statusul curent este o **proiecție** a istoricului, nu sursa de adevăr pentru metrici.
- Metricile de tip durată (de exemplu timp până la prima preluare, timp până la rezolvare) se derivă din diferențe între timestamp-uri de tranziție, nu din câmpuri actualizate în loc.
- **Consecință explicită:** un indicator nu poate fi ameliorat prin schimbarea artificială a statusului curent. Dacă o sesizare este marcată „resolved" și apoi redeschisă, ambele tranziții rămân în istoric și intră în calcul; o corecție de status nu șterge durata deja acumulată.
- Corecțiile se fac prin **tranziție compensatorie înainte**, înregistrată ca atare, nu prin rescrierea istoricului.
- FUP-9 trebuie să definească, pentru fiecare indicator: cum tratează sesizările redeschise, cele fără tranziție finală, cele create înainte de intrarea în vigoare a definiției, și frontiera de tenant a agregării.

Acest ADR nu fixează formulele — le fixează **sursa de adevăr** și interdicția de manipulare. Formulele sunt conținutul FUP-9.

**Acțiuni de întreținere a documentației (NU sunt executate de acest ADR):**

- **Actualizarea `docs/project/open-questions.md`**: OQ-001 („Care este stack-ul tehnic aprobat pentru Phase 1?") trece în `Resolved`, cu referință `ADR-0001`. **Acest ADR nu modifică acel fișier** — actualizarea este o acțiune ulterioară, de făcut după acceptarea ADR-ului. Owner: Solution architect.
- **Actualizarea `docs/project/risk-register.md`**: R-002 primește ca măsură explicită „politici RLS + V1 (teste cross-tenant) + V2 (scanare de secrete în bundle) ca porți de CI blocante". Rămâne `Open` până la FUP-1 și la V1/V2 verzi. Owner: Architecture/Security.

**Întrebări deschise care NU sunt rezolvate de acest ADR (nu le ascundem aici):**

- OQ-002 — modelul comercial și nivelul de white-label per tenant. Are impact direct asupra FUP-1 (dacă fiecare primărie are domeniu propriu, strategia de rezolvare a tenantului se schimbă). **Owner: Product owner.**
- OQ-003 — regulile de registratură ale primăriei pilot (numărul de înregistrare). Are impact asupra FUP-4 și asupra schemei. **Owner: Municipality representative.**
- Perioadele de retenție a datelor personale și a documentelor încărcate. **Nu sunt stabilite și nu sunt presupuse.** Owner: Product owner + specialist privacy/juridic.
- Cerințe legale privind localizarea datelor (regiunea în care rulează Supabase). Neconfirmate. Nu formulăm o cerință legală neverificată. **Owner: Product owner + juridic.**

## Surse și documente asociate

- `CLAUDE.md` — misiunea produsului, scope-ul Phase 1, principiile de livrare (monolit modular pentru Phase 1; fără inițializare de framework-uri înainte de baseline aprobat; criteriile de justificare a alegerilor tehnologice).
- `.claude/rules/architecture.md` — granițe de modul, multi-tenancy, stări de workflow, cerințe pentru specificații.
- `.claude/rules/security.md` — deny by default, autorizare server-side, izolarea tenantului ca frontieră de securitate, interdicția expunerii credențialelor privilegiate, reguli de upload, audit trail, privacy by design, interdicția inventării perioadelor de retenție.
- `.claude/rules/product-scope.md` — clasificarea funcționalităților pe faze; standardul de simplitate; interdicția afirmațiilor vagi fără măsurare.
- `docs/project/open-questions.md` — **OQ-001** (închisă de acest ADR, cu actualizarea fișierului ca acțiune ulterioară), OQ-002, OQ-003.
- `docs/project/risk-register.md` — **R-002** (izolare multi-tenant incompletă, impact Critical), R-001, R-003, R-004.
