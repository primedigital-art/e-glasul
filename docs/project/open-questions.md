# Întrebări deschise

Acest registru păstrează întrebările care afectează mai multe funcționalități.

| ID | Întrebare | Categorie | Owner | Status | Decizie / referință |
|---|---|---|---|---|---|
| OQ-001 | Care este stack-ul tehnic aprobat pentru Phase 1? | Architecture | eg-solution-architect | Resolved | [ADR-0001](../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md) — baseline tehnologic și de deployment |
| OQ-002 | Ce nivel de white-label are fiecare tenant și cum se rezolvă tenantul? | Architecture | Solution architect | Resolved | [Decizie OQ-002 — subdomeniu per primărie, o singură aplicație](#decizie-oq-002--subdomeniu-per-primărie-o-singură-aplicație). Modelul complet: [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md) (FUP-1). |
| OQ-003 | Ce reguli de registratură trebuie să suporte prima primărie pilot? | Domain | Municipality representative | Open | Domain validation |
| OQ-004 | Cum ajunge conținutul public dinamic (anunțurile) pe site-ul static? | Architecture | Solution architect | Resolved | [Decizie OQ-004 — anunțurile se încarcă la runtime, nu la build](#decizie-oq-004--anunțurile-se-încarcă-la-runtime-nu-la-build). Mecanismul complet se specifică în FUP-8. |
| OQ-005 | Unde se aplică efectiv rate limiting-ul per tenant și **cum se identifică tenantul înainte de autentificare**? | Architecture | Solution architect | Open | FUP-13 — vezi „Acțiuni ulterioare" în [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md). Blocant pentru expunerea publică a înregistrării: un flood de SMS este un atac financiar direct, iar la înregistrare **nu există încă JWT**. |
| OQ-006 | Ce furnizor de SMS folosim și care este costul unitar real? | Architecture | Product owner + Solution architect | Open | Neales în [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md). FUP-4. Costul se refacturează per primărie, deci consumul trebuie contorizat per tenant. |
| OQ-007 | Care sunt perioadele de retenție pentru datele personale, documentele încărcate și log-uri? | Legal/Privacy | Product owner + specialist privacy/juridic | Open | **Nestabilite. Nu se inventează** (`.claude/rules/security.md`). FUP-6. |
| OQ-008 | Cum se restaurează selectiv datele unui singur tenant? | Architecture | Solution architect | Open | Procedura **nu există și nu este testată**. Consecință asumată a schemei partajate — vezi „Consecințe negative" în [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md). FUP-12. |
| OQ-009 | Există cerințe legale de localizare a datelor (regiunea Supabase)? | Legal | Product owner + juridic | Open | Neconfirmate. Nu formulăm o cerință legală neverificată. |
| OQ-010 | La ce prag de „zgomot de vecin" intervenim? | Architecture | Solution architect | Open | Nedefinit. Se stabilește pe date reale, nu pe presupuneri. |

Lista completă a ADR-urilor ulterioare (FUP-2 … FUP-13) este în secțiunea „Acțiuni ulterioare" din [ADR-0002](../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md). Registrul **nu o repetă**.

## Decizie OQ-002 — subdomeniu per primărie, o singură aplicație

**Data:** 2026-07-12 — statusul și owner-ul întrebării sunt în rândul OQ-002 din tabelul de mai sus.

### Ce s-a decis

1. **Subdomeniu per primărie.** Fiecare primărie primește un subdomeniu propriu sub `e-glasul.ro` (de exemplu `botosani.e-glasul.ro`).

2. **O singură aplicație, un singur deployment, o singură bază de date.** Aplicația **nu** este copiată și **nu** este forkuită per primărie. Nu există build-uri separate per tenant.

3. **Subdomeniul determină doar contextul de prezentare**: branding, logo, culori, date de contact, categorii active. Această configurație este **date**, stocate într-un tabel `tenants` — **nu cod** și **nu artefacte de build per tenant**.

4. **Tenantul efectiv pentru orice acces la date se rezolvă EXCLUSIV dintr-un claim verificat din JWT-ul utilizatorului autentificat**, aplicat de PostgreSQL Row Level Security pe `tenant_id`.

5. **Hostname-ul nu este NICIODATĂ o frontieră de securitate.** Un utilizator autentificat pentru tenantul A nu trebuie să poată citi datele tenantului B nici măcar atunci când accesează subdomeniul tenantului B.

6. **Onboarding-ul unei primării noi = un rând în tabelul `tenants` + o înregistrare DNS.** Nu trebuie să necesite modificare de cod și nici un deployment nou.

### Consecința de securitate, explicit

Subdomeniul este **context de prezentare**, nu autorizare. Cele două se separă complet:

| Aspect | Sursa de adevăr |
|---|---|
| Ce branding, logo, culori, contact, categorii se afișează | Hostname → rând în `tenants` (date) |
| La ce date are acces utilizatorul | **Claim verificat din JWT → RLS pe `tenant_id`** |

Un utilizator al tenantului A care navighează la subdomeniul tenantului B poate vedea brandingul lui B, dar **nu poate citi, scrie sau lista niciun rând al lui B**. Izolarea nu depinde de gazdă, de rutare, de UI sau de configurarea Netlify — depinde de RLS.

Aceasta este măsura directă împotriva riscului **[R-002 — izolare multi-tenant incompletă](./risk-register.md)** și se validează prin **V1** (suită de teste cross-tenant) din [ADR-0001](../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md).

### Ce NU este rezolvat aici

Această decizie fixează **modelul de tenancy și rezolvarea tenantului**. Modelul complet — schema tabelului `tenants`, forma exactă a claim-ului din JWT și cum ajunge acolo, politicile RLS concrete, comportamentul pentru utilizatorii neautentificați pe site-ul public, gestionarea DNS și a certificatelor wildcard, procedura operațională de onboarding — **se specifică în FUP-1 (ADR: model de tenancy și rezolvarea tenantului)**, care nu este creat de această decizie.

**Termenii comerciali** (preț, pachete, contractare) se gestionează **în afara acestui repository** și nu constituie o întrebare deschisă de arhitectură. Din acest motiv, OQ-002 este formulată strict ca întrebare de white-label și de rezolvare a tenantului.

## Decizie OQ-004 — anunțurile se încarcă la runtime, nu la build

**Data:** 2026-07-13 — statusul și owner-ul întrebării sunt în rândul OQ-004 din tabelul de mai sus.

### Ce s-a decis

1. **Anunțurile NU sunt generate static** în site-ul public Astro.

2. **Site-ul public se construiește static o singură dată și se servește din CDN.** Anunțurile se citesc **la runtime, în browser**, direct din Supabase, folosind **cheia anon** și o **politică RLS de citire publică, delimitată pe tenant**.

3. **Publicarea unui anunț NU necesită rebuild și NU necesită deployment.** Este o **scriere în baza de date**, făcută de personalul primăriei din panoul de administrare.

4. **Adăugarea unei primării NU necesită rebuild.** Un singur build Astro servește toți tenanții: tenantul se rezolvă din hostname, iar datele lui de prezentare se citesc din tabelul `tenants`.

### Consecința acceptată deliberat

**Anunțurile NU sunt indexate de motoarele de căutare.** Fiind încărcate în browser după livrarea HTML-ului static, ele nu există în pagina pe care o vede un crawler.

Cetățenii ajung la anunțuri **vizitând direct site-ul** sau **prin notificare push** — **nu prin Google**. Acesta este un compromis asumat, nu o scăpare: costul lui este vizibilitatea în căutare, iar câștigul este că o primărie poate publica un anunț în câteva secunde, fără build, fără deployment și fără intervenția echipei tehnice.

Dacă indexarea anunțurilor devine o cerință, decizia se reevaluează explicit — nu se rezolvă prin soluții parțiale.

### Ce NU este rezolvat aici

Mecanismul complet — forma politicii RLS de citire publică, schema tabelului de anunțuri, comportamentul de cache și revalidare în browser, starea de încărcare și de eroare la citirea anunțurilor, programarea publicării, comportamentul când Supabase nu răspunde — **se specifică în FUP-8**, care nu este creat de această decizie.

Politica de citire publică atinge direct izolarea între tenanți: este singurul loc din Phase 1 unde date se citesc **fără JWT**. Delimitarea pe tenant a acestei politici trebuie tratată în FUP-8 ca subiect de securitate, nu ca detaliu de implementare.
