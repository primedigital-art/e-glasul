# Întrebări deschise

Acest registru păstrează întrebările care afectează mai multe funcționalități.

| ID | Întrebare | Categorie | Owner | Status | Decizie / referință |
|---|---|---|---|---|---|
| OQ-001 | Care este stack-ul tehnic aprobat pentru Phase 1? | Architecture | eg-solution-architect | Resolved | [ADR-0001](../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md) — baseline tehnologic și de deployment |
| OQ-002 | Ce nivel de white-label are fiecare tenant și cum se rezolvă tenantul? | Architecture | Solution architect | Resolved | [Decizie OQ-002 — subdomeniu per primărie, o singură aplicație](#decizie-oq-002--subdomeniu-per-primărie-o-singură-aplicație). Modelul complet se specifică în FUP-1. |
| OQ-003 | Ce reguli de registratură trebuie să suporte prima primărie pilot? | Domain | Municipality representative | Open | Domain validation |

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
