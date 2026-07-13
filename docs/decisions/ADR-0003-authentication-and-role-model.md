# ADR-0003: Model de autentificare și de roluri

- **Status:** Proposed
- **Data:** 2026-07-13
- **Decidenți:** Product owner, Solution architect
- **Înlocuiește:** None
- **Înlocuit de:** None

## Context

Acest ADR este **FUP-2** din [ADR-0001](./ADR-0001-phase-1-technology-and-deployment-baseline.md) și [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md).

[ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md) a fixat **frontiera de tenant** și a spus explicit ce lasă nerezolvat: politicile RLS pot delimita tenantul, dar **nu pot încă exprima ce are voie să facă fiecare persoană în interiorul tenantului**. O politică de forma `tenant_id = current_tenant_id()` este adevărată și pentru cetățeanul care și-a raportat o groapă, și pentru funcționarul care triază toate sesizările primăriei. Astăzi, cu doar acel predicat, orice cetățean al primăriei ar putea citi sesizările tuturor vecinilor săi. Aceasta este o breșă de confidențialitate în interiorul tenantului, nu între tenanți.

**Ce se preia din ADR-0002 și NU se relitigează aici:**

- Tenantul efectiv vine exclusiv dintr-un claim verificat din JWT, injectat server-side în `app_metadata` de un Custom Access Token Hook care citește `tenant_users`. Hostname-ul nu este niciodată frontieră de securitate.
- `current_tenant_id()` este funcția de citire a claim-ului, fail-closed prin `NULL`.
- Deny by default în planul de date; `ENABLE` + `FORCE ROW LEVEL SECURITY` pe fiecare tabel cu `tenant_id`; `WITH CHECK` obligatoriu pe `UPDATE`.
- Un cont aparține exact unui tenant (cheie primară pe `user_id` în `tenant_users`).
- Înregistrare cu **email + parolă SAU telefon + parolă**, niciodată ambele.
- **Nu există super-admin.** Nicio politică RLS nu acordă acces cross-tenant.
- Verificările structurale **C1–C7** și suita cross-tenant **T1–T18** sunt porți blocante în CI.

**Ce fixează acest ADR:**

- Setul închis de roluri din Phase 1 și semantica lor.
- Unde trăiește rolul (sursa de adevăr) și cum ajunge în RLS.
- Funcțiile SQL `current_role()` / `has_role()`, analog cu `current_tenant_id()`.
- Tiparul de politică RLS care combină **tenant ȘI rol** pe același tabel.
- Cine creează conturile și cum se previne escaladarea de privilegii.
- Matricea de permisiuni, rol × acțiune.
- Extinderea suitei de teste cu cazuri de rol (**T19+**).

Acest ADR adaugă un al doilea predicat peste frontiera definită în ADR-0002. **Nu o slăbește și nu o poate slăbi**: orice politică scrisă aici este `tenant_id = current_tenant_id() AND <predicat de rol>`. Riscul [R-002](../project/risk-register.md) rămâne adresat de ADR-0002; acest ADR adaugă un al doilea vector de eroare — o politică de rol prea permisivă expune date **în interiorul** tenantului.

**Realitatea operațională care conduce decizia centrală.** Într-o comună mică, funcționarul de la registratură **este** un cetățean al acelei comune. Locuiește pe o stradă cu gropi. Primărie cu 6 angajați, sat cu 2.000 de locuitori. Dacă îi cerem un al doilea cont pentru a raporta o groapă, îi cerem un al doilea număr de telefon sau o a doua adresă de email — pe care, foarte probabil, nu le are și nu le va crea. Consecința practică nu este „își face al doilea cont", ci **„nu raportează niciodată nimic ca cetățean"**. Cei mai activi utilizatori posibili ai funcționalității de cetățean ar fi exact cei excluși din ea.

## Factori de decizie

| # | Factor | De ce contează |
|---|---|---|
| D1 | Rolul trebuie să fie un **claim verificat**, emis server-side | Aceeași logică pe care ADR-0002 o aplică lui `tenant_id`. Un rol scriptibil de client înseamnă că fiecare utilizator își alege singur rolul. |
| D2 | Rolul **nu înlocuiește niciodată** predicatul de tenant | Predicatul de rol se **adaugă** (`AND`), nu se substituie. O politică „staff vede tot" fără `tenant_id` este o breșă cross-tenant. |
| D3 | Confidențialitatea între cetățenii aceluiași tenant | O sesizare poate conține numele, adresa și fotografia din fața casei unui om. Vecinul nu are dreptul să o citească. Tenantul singur nu este suficient. |
| D4 | Fluxul real al unei primării mici | 3–10 angajați, fără departament IT, fără proceduri de identitate. Modelul trebuie să funcționeze fără instruire. |
| D5 | Funcționarul este și cetățean | Vezi „Context". Un model care îl obligă la două identități îl scoate din produs. |
| D6 | Primăria se administrează singură | Operatorul platformei nu poate fi în calea creării fiecărui cont de funcționar. Nu scalează și, mai grav, ar reintroduce un rol privilegiat. |
| D7 | Fără super-admin — **decizia 11 din ADR-0002 nu se reintroduce pe ușa din spate** | Un „rol de suport care vede tot" este exact super-adminul, redenumit. |
| D8 | Auditul trebuie să distingă **intenția** unei acțiuni | Dacă o persoană poate acționa și ca funcționar, și ca cetățean, urma de audit trebuie să spună în ce calitate a acționat. |
| D9 | Revocarea unui rol trebuie să fie **explicabilă**, chiar dacă nu e instantanee | JWT-urile sunt semnate și au durată de viață. Un rol retras nu dispare magic din token-ul deja emis. Trebuie spus, nu ascuns. |
| D10 | Setul de roluri trebuie să rămână mic în Phase 1 | Fiecare rol în plus multiplică politicile RLS, cazurile de test și confuzia utilizatorului. |
| D11 | Conducerea nu procesează sesizări | Primarul citește indicatori. Nu atribuie și nu închide sesizări. Un rol care poate face totul „ca să fie sigur" distruge trasabilitatea răspunderii. |

## Opțiuni analizate

### Opțiunea A — Roluri cumulative, un cont per persoană

Patru roluri: `citizen`, `staff`, `leadership`, `tenant_admin`. Rolurile sunt **cumulative**: `staff`, `leadership` și `tenant_admin` includ **fiecare drept al unui cetățean**. O persoană are **un singur cont**, cu **un singur rol** stocat, iar drepturile de cetățean sunt implicite în orice rol elevat.

**Avantaje**

- **Funcționarul rămâne cetățean.** Poate raporta groapa din fața casei lui din același cont, fără al doilea telefon, fără a doua adresă de email, fără a-și aminti două parole. Aceasta este singura opțiune care nu îl exclude de facto (D5).
- **Un singur cont per persoană** — un singur canal de verificare, o singură resetare de parolă, o singură sesiune. Pentru un utilizator cu experiență digitală limitată, aceasta este diferența dintre „folosesc aplicația" și „nu o folosesc" (D4).
- **Model mental simplu pentru primărie**: „îi dau lui Maria rolul de funcționar" — o singură acțiune, un singur rând.
- **Un singur claim de rol** în JWT, deci un singur predicat suplimentar în fiecare politică RLS. Cel mai mic număr de politici dintre opțiuni.
- Nu există „conturi orfane": o persoană care pleacă din primărie își pierde rolul elevat, dar rămâne cetățeanul care era. Nu trebuie să ștergem un cont și să păstrăm altul.

**Dezavantaje**

- **Auditul devine ambiguu prin construcție.** Când Maria (rol `staff`) creează o sesizare, a făcut-o în calitate de funcționar sau de cetățean care are o groapă în fața casei? Sistemul trebuie să răspundă la această întrebare **explicit** (vezi „Decizie", punctul 14), pentru că rolul singur nu o mai face.
- **Un cont compromis expune două suprafețe simultan**: și datele oficiale ale primăriei, și sesizările personale ale persoanei.
- Separarea atribuțiilor (segregation of duties), un principiu clasic în sectorul public, este **slăbită deliberat**. Nu pretindem altceva.
- Un funcționar vede în același ecran sesizarea lui personală și sesizările pe care le procesează. UI-ul trebuie să distingă clar cele două, altfel confuzia se mută în interfață.

**Riscuri**

- **Ambiguitatea de audit devine reală la primul litigiu.** „Funcționarul și-a rezolvat propria sesizare cu prioritate" este o acuzație pe care sistemul trebuie să o poată infirma sau confirma **din date**. Dacă nu înregistrăm calitatea în care a acționat, nu putem nici una, nici alta.
- Riscul ca o funcție de cetățean (de exemplu, ștergerea propriei sesizări) să fie expusă accidental unui funcționar asupra sesizărilor altora, printr-o politică scrisă neglijent — pentru că **același tabel** servește ambele roluri.
- Un funcționar care este și cetățean poate, teoretic, să își citească propriile date personale prin ruta de funcționar și să nu observe granița. Nu e o breșă, dar erodează disciplina.

### Opțiunea B — Conturi separate per rol

Fiecare persoană are un cont de cetățean (personal) și, dacă lucrează în primărie, un **cont profesional distinct** (`maria.ionescu@primaria-x.ro`). Rolurile nu sunt cumulative: un cont de `staff` **nu** poate crea sesizări ca cetățean.

**Avantaje**

- **Separarea atribuțiilor este reală, nu declarată.** Un cont profesional face doar lucruri profesionale. Este modelul standard în administrația publică și în orice organizație cu cerințe de conformitate.
- **Urma de audit este neechivocă, fără niciun mecanism suplimentar.** „Cine a schimbat statusul?" → un cont profesional. „Cine a raportat groapa?" → un cont personal. **Nu există nicio situație în care sistemul să nu poată spune în ce calitate a acționat cineva.** Acesta este un avantaj genuin și important, iar Opțiunea A trebuie să îl reconstruiască artificial, prin metadate de intenție, care pot fi greșite sau lipsă.
- **Blast radius mai mic la compromitere.** Furtul contului personal al Mariei nu dă acces la sesizările primăriei. Furtul contului profesional nu expune datele ei personale.
- Revocarea la plecarea din primărie este curată: se dezactivează un cont, integral. Nu se „retrogradează" nimic.
- Se potrivește natural peste modelul „un cont = un tenant" din ADR-0002 — un cont profesional aparține primăriei, un cont personal aparține persoanei.

**Dezavantaje**

- **Cere o a doua identitate verificabilă.** ADR-0002 permite email SAU telefon. Un al doilea cont are nevoie de un al doilea email sau de un al doilea număr de telefon, **distinct**. Într-o comună mică, funcționarul nu are adresă instituțională și nu are al doilea telefon.
- **Consecința practică nu este „al doilea cont", ci abandonul.** Persoana nu își face un al doilea cont ca să raporteze o groapă. Pur și simplu nu raportează. Pierdem exact utilizatorii cei mai apropiați de problemele publice.
- Două parole, două resetări, două sesiuni, două dispozitive de notificat. Cost de utilizare real pentru un public cu experiență digitală limitată (D4).
- Costul de verificare crește: dacă al doilea cont e pe telefon, e un SMS în plus, deci un cost real (ADR-0002, decizia 15).
- Primăria trebuie să emită și să administreze identități instituționale — ceva ce o primărie mică nu face astăzi.

**Riscuri**

- Utilizatorii vor **eluda** modelul: vor folosi contul profesional pentru a raporta probleme personale (dacă e permis) sau vor împrumuta conturi. Un model pe care oamenii îl ocolesc produce o urmă de audit **falsă**, care e mai rea decât una ambiguă.
- Adopția funcționalității de cetățean scade măsurabil în rândul angajaților primăriei — cel mai motivat segment.
- Riscul de a lega implicit cele două conturi (aceeași persoană) în UI, ceea ce ar reintroduce ambiguitatea pe care modelul o eliminase, dar fără avantajele ei.

### Opțiunea C — Set de permisiuni (capability list) în loc de un câmp de rol

În loc de `role text`, contul poartă o listă de capabilități: `["issue.read.all", "issue.assign", "issue.status.change", "announcement.publish", "user.manage", ...]`. RLS verifică prezența capabilității, nu numele rolului. Rolurile devin, cel mult, preseturi de capabilități în UI.

**Avantaje**

- **Flexibilitate fără schimbare de schemă.** O primărie cu o structură neobișnuită („funcționarul poate publica anunțuri, dar nu poate atribui sesizări") se configurează prin date, nu printr-o migrație și un release. Acesta este un avantaj real, iar Opțiunea A **nu îl are deloc**: în A, orice structură neprevăzută înseamnă cod nou.
- Permite delegare fină și temporară (de exemplu, cineva primește doar `announcement.publish` pe perioada concediului colegului).
- Politicile RLS devin uniforme: `has_capability('issue.assign')` — un singur tipar, indiferent câte roluri există.
- Model recunoscut și bine înțeles (RBAC cu permisiuni explicite); nu inventăm nimic.

**Dezavantaje**

- **Explozia stărilor posibile.** Cu N capabilități există 2^N combinații. Ce înseamnă un cont cu `issue.status.change` dar fără `issue.read.all`? Este o stare validă? Cine o testează? **Testabilitatea exhaustivă dispare**, iar acesta este exact lucrul pe care ADR-0002 l-a cumpărat prin simplitate.
- **Cere un ecran de administrare a permisiunilor.** Un secretar de primărie cu experiență digitală limitată trebuie să bifeze corect 9–15 capabilități. Va greși. Va bifa tot „ca să meargă". Rezultatul practic al flexibilității este, cel mai probabil, **acordarea tuturor permisiunilor tuturor** — adică toată lumea devine `tenant_admin`, dar fără ca cineva să fi decis asta.
- Un JWT cu o listă de capabilități crește în dimensiune și devine mai greu de citit la depanare.
- Complexitate pe care Phase 1 nu are dovezi că o cere: nu cunoaștem nicio primărie pilot cu o structură care nu încape în patru roluri. **Am construi flexibilitate pentru o cerință pe care nu am observat-o.**

**Riscuri**

- O capabilitate uitată dintr-o politică = o funcție inaccesibilă (vizibil, se repară). O capabilitate acordată greșit = privilegiu tăcut (invizibil, se descoperă târziu). Al doilea caz devine **mult mai probabil** când acordarea se face prin bifare, de un om, în producție.
- Migrarea de la capabilități înapoi la roluri, dacă modelul se dovedește prea complex, este dureroasă: fiecare cont are deja o combinație unică.
- Riscul de a construi un motor de permisiuni în loc de un produs civic.

**Opțiunile B și C nu sunt inferioare.** B are o proprietate de audit pe care A **nu o poate egala**, ci doar aproxima. C are o flexibilitate pe care A **nu o are deloc**. Ambele sunt respinse pentru Phase 1 din motive de adopție reală (B) și de testabilitate + capacitate a utilizatorului (C), nu pentru că ar fi soluții slabe. Motivația completă este mai jos.

## Decizie

### 1. Setul de roluri — închis pentru Phase 1

1. **Exact patru roluri**: `citizen`, `staff`, `leadership`, `tenant_admin`. Niciun alt rol nu există în Phase 1. **Nu există `super_admin` — decizia 11 din [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md) rămâne în vigoare și nu se reintroduce sub niciun nume.**

2. **Rolurile sunt CUMULATIVE.** `staff`, `leadership` și `tenant_admin` includ **fiecare drept pe care îl are un `citizen`**. O persoană are **un cont**.

3. Semantica fiecărui rol:

| Rol | Ce poate |
|---|---|
| `citizen` | Creează sesizări și cereri. Citește **doar ce a creat el însuși**. |
| `staff` | Citește **toate** sesizările tenantului său. Atribuie. Schimbă statusul. Publică anunțuri. **Plus tot ce poate un cetățean.** |
| `leadership` | Citește indicatorii din dashboard și sesizările tenantului său. **NU procesează sesizări**: nu atribuie, nu schimbă statusul, nu publică anunțuri. **Plus tot ce poate un cetățean.** |
| `tenant_admin` | Tot ce poate `staff`, plus administrarea utilizatorilor, a setărilor și a brandingului tenantului. **Plus tot ce poate un cetățean.** |

4. **Un cont are exact un rol stocat.** Cumulativitatea este exprimată în funcțiile de verificare (`has_role`), nu prin roluri multiple pe cont.

### 2. Sursa de adevăr a rolului

5. **Rolul trăiește în `tenant_users.role`**, în baza de date. Aceasta este **singura** sursă de adevăr.

6. **Rolul ajunge în JWT prin Custom Access Token Hook**, în **`app_metadata`**, alături de `tenant_id`, citit de hook din `tenant_users`.

7. **Rolul NU are voie să apară NICIODATĂ în `user_metadata`.** `user_metadata` este scriptibil de client prin `auth.updateUser`. Un rol acolo înseamnă că **fiecare utilizator își alege singur rolul**. Este exact argumentul pe care ADR-0002 îl dă pentru `tenant_id` (regula C7), extins la rol.

8. **Rolul nu se citește niciodată** dintr-un header, dintr-un parametru de query, dintr-un câmp de body, din hostname sau din `user_metadata`.

### 3. Aplicarea în RLS

9. **Fiecare politică pe un tabel deținut de tenant are forma:**

   ```
   tenant_id = (select public.current_tenant_id())  AND  <predicat de rol>
   ```

   **Predicatul de rol nu înlocuiește NICIODATĂ predicatul de tenant. Se adaugă la el, cu `AND`.** O politică de rol fără predicat de tenant este o breșă cross-tenant, indiferent cât de corect este predicatul de rol.

10. **`current_role()` și `has_role()` sunt fail-closed**: claim absent sau `NULL` ⇒ acces refuzat, prin construcție (`NULL` este fals în `USING`/`WITH CHECK`), nu printr-un `if`.

### 4. Provizionarea conturilor

11. **Un utilizator care se înregistrează singur obține EXCLUSIV rolul `citizen`**, într-**un singur tenant**. Nu poate obține nimic altceva, prin niciun mecanism expus.

12. **Rolul NU este ales de utilizator.** Nu există câmp de rol în formularul de înregistrare, nu este acceptat în payload și, dacă este trimis, este **ignorat** — hook-ul citește rolul din baza de date, nu din cererea clientului.

13. **`tenant_admin` creează și administrează conturile de `staff`, `leadership` și alți `tenant_admin` — exclusiv în propriul tenant.** Primăriile se administrează singure (D6).

14. **Primul `tenant_admin` al unei primării noi este creat de operatorul platformei, la onboarding.** Este o **procedură operațională** (consolă Supabase + `INSERT` în `tenant_users`), **nu o funcționalitate a aplicației**. Nu există în aplicație nicio rută care creează un `tenant_admin` fără un `tenant_admin` existent al aceluiași tenant.

### 5. Auditul intenției — răspunsul la dezavantajul central al Opțiunii A

15. **Fiecare acțiune auditabilă înregistrează calitatea în care a fost făcută**, nu doar autorul. Tabelul de audit poartă:

    - `actor_user_id` — cine,
    - `actor_role` — rolul efectiv din JWT la momentul acțiunii (`citizen`, `staff`, ...),
    - `acting_as` — **calitatea declarată de contextul acțiunii**: `citizen` pentru o acțiune făcută prin ruta de cetățean (creare sesizare proprie), `official` pentru o acțiune făcută prin ruta de administrare (atribuire, schimbare de status, publicare).

    `acting_as` **nu este ales de utilizator dintr-un comutator din UI**. Este determinat de **acțiunea executată**: `issue.create` este întotdeauna `citizen`; `issue.assign`, `issue.status_change`, `announcement.publish` sunt întotdeauna `official`. Nu există acțiune ambiguă.

16. **O sesizare poartă întotdeauna `author_user_id`.** Când autorul are rol elevat în același tenant, sesizarea rămâne o sesizare de cetățean. **Nu se acordă tratament preferențial și nu se ascunde autorul de colegi**: dacă un funcționar procesează sesizarea unui coleg, faptul este vizibil în audit prin `actor_user_id` = `author_user_id`. Această situație **nu este blocată tehnic în Phase 1** — este **înregistrată și vizibilă**. Vezi „Consecințe negative", punctul 1.

### 6. Autentificare

17. **Neschimbat față de [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md)**: email + parolă **SAU** telefon + parolă, ales la înregistrare, niciodată ambele. Un singur SMS la verificare, nu login prin OTP.

18. Schimbarea rolului **nu** schimbă metoda de autentificare. Un funcționar promovat nu primește credențiale noi; primește un rol nou pe același cont.

### Ce NU decide acest ADR

- **Granularitatea de rutare pe departamente.** Cele patru roluri nu exprimă „funcționarul de la Urbanism vede doar sesizările de Urbanism". În Phase 1, **orice `staff` al unui tenant vede toate sesizările acelui tenant.** Dacă primăria pilot cere segmentare pe departamente, este un ADR ulterior (FUP-14), nu o extindere tăcută a acestui model.
- **MFA / 2FA nu este decisă aici.** Nu decurge din modelul de roluri. Faptul că un `tenant_admin` poate acorda roluri crește miza compromiterii contului său — este un **argument** pentru MFA, nu o decizie. Se tratează în FUP-15, cu propriile compromisuri de utilizabilitate.
- **Accesul de suport** rămâne un ADR separat ([FUP-10 din ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md)). Acest ADR **nu** creează un rol de suport și **nu** slăbește interdicția super-adminului.
- **Politica de sesiune** (durata refresh token-ului, sesiuni concurente, deconectare forțată) nu este stabilită aici, deși influențează direct întârzierea de propagare de la punctul 3 al „Consecințelor negative". Vezi FUP-15.
- **Perioadele de retenție** rămân nestabilite (OQ-007). Nu se inventează aici.

## Motivație

**De ce roluri cumulative, deși Opțiunea B are un audit mai curat**

Argumentul nu este că separarea conturilor ar fi un model prost. **Este un model mai bun din punctul de vedere al auditului și al separării atribuțiilor, și o spunem fără menajamente.** Argumentul este că, în populația reală de utilizatori pe care o servim, el **nu funcționează**.

O primărie de comună are 6 angajați. Niciunul nu are adresă de email instituțională. Telefonul de serviciu este telefonul personal. Ca să dăm secretarei un al doilea cont, avem nevoie de o a doua identitate verificabilă pe care **ea nu o are**. Rezultatul previzibil nu este că își face un al doilea cont — este că **nu folosește niciodată partea de cetățean**. Am construi o funcționalitate de raportare civică și am exclude din ea, prin design, oamenii care cunosc cel mai bine problemele localității.

Alegem, deci, un model cu o slăbiciune **cunoscută și numită** (ambiguitatea de audit), pe care o **compensăm explicit** prin `acting_as` (decizia 15), în loc de un model cu o slăbiciune **de adopție**, pe care nu o putem compensa cu nimic. Compensarea nu este echivalentă: `acting_as` este derivat din acțiune, deci corect prin construcție, dar nu oferă separarea criptografică a identităților pe care B o oferă gratuit. **Plătim acest lucru. Vezi „Consecințe negative".**

**De ce un câmp de rol, și nu capabilități**

Opțiunea C are dreptate într-un punct pe care A nu îl poate contesta: **o primărie cu o structură neobișnuită va trebui să se îndoaie după cele patru roluri ale noastre.** Aceasta este o pierdere reală.

Alegem totuși A pentru că C mută complexitatea exact acolo unde nu ne putem permite: **în mâinile utilizatorului**. Un ecran cu 15 capabilități de bifat, administrat de un secretar de primărie fără instruire, produce, cu probabilitate mare, un singur rezultat: se bifează tot. Flexibilitatea teoretică devine, în practică, **acordarea tuturor drepturilor tuturor** — adică exact opusul principiului „deny by default" pe care îl aplicăm în planul de date. Un model care se degradează la utilizare nu este un model sigur.

În plus, testabilitatea. Cu patru roluri, matricea rol × acțiune are 4 × 9 = 36 de celule, **fiecare enumerabilă și testabilă**. Cu capabilități, spațiul stărilor este combinatorial și nu poate fi acoperit exhaustiv. ADR-0002 a ales explicit modelul de tenancy care **concentrează riscul într-un loc testabil**. Acest ADR aplică același criteriu la roluri.

Dacă apare o primărie pilot cu o structură care nu încape în patru roluri, **acesta este exact tipul de dovadă** pe care îl cerem înainte de a introduce complexitate. Atunci reevaluăm — printr-un ADR, nu printr-un câmp adăugat în grabă.

**De ce rolul în `app_metadata` și nu în `user_metadata`**

Pentru exact același motiv pentru care `tenant_id` este acolo. `user_metadata` este **scriptibil de client**: orice utilizator autentificat poate apela `auth.updateUser({ data: { role: 'tenant_admin' } })` din consola browserului. Dacă politicile RLS ar citi rolul de acolo, **fiecare cetățean ar putea deveni administrator al primăriei sale în cinci secunde**, fără niciun exploit, folosind API-ul public documentat al Supabase.

`app_metadata` nu este scriptibil de client. Este populat de hook-ul de token, server-side, dintr-o interogare pe `tenant_users`. Clientul nu îl poate influența — poate doar refuza să prezinte token-ul, ceea ce îl lasă fără acces (fail closed).

**De ce fără super-admin, din nou**

Un rol care ar putea „vedea tot ca să ajute" este super-adminul lui ADR-0002, redenumit. O sesiune compromisă a unui angajat al operatorului ar deveni un breach al tuturor primăriilor. Interdicția rămâne. Suportul rămâne inconfortabil. **Acesta este scopul.**

## Consecințe pozitive

- **FUP-2 din ADR-0001 și ADR-0002 este închis.** Politicile RLS pot fi acum scrise complet: tenant **și** rol. Schema poate porni.
- **Confidențialitatea între cetățenii aceluiași tenant devine aplicabilă în planul de date** (D3): predicatul `author_user_id = auth.uid()` face ca un cetățean să nu poată citi sesizarea vecinului, nici cu interogări arbitrare, nici cu cheia anon.
- **Funcționarul rămâne cetățean.** Cel mai activ utilizator posibil al funcționalității de raportare nu este exclus din ea.
- **Un cont per persoană**: o parolă, o resetare, un canal de verificare, un dispozitiv de notificat. Costul de utilizare rămâne cel din ADR-0002, neschimbat.
- **Primăriile se administrează singure.** Operatorul platformei intervine o singură dată per primărie (primul `tenant_admin`) și apoi iese din calea operațională.
- **Matricea de permisiuni este enumerabilă și complet testabilă** — 36 de celule, fiecare cu un test.
- **`leadership` fără drept de procesare** păstrează trasabilitatea răspunderii: dacă statusul unei sesizări s-a schimbat, cineva cu rol operațional a făcut-o, iar numele lui este în istoric.
- Modelul nu introduce nicio rută privilegiată nouă și **nu slăbește frontiera de tenant** din ADR-0002.

## Consecințe negative

Acceptate conștient:

1. **Ambiguitatea de audit este reală, chiar și cu `acting_as`.** Când funcționarul Maria raportează o groapă, urma spune „acțiune de cetățean, autor Maria, rol efectiv `staff`". Dar dacă tot Maria procesează ulterior acea sesizare, sistemul o **înregistrează**, nu o **împiedică**. Nu implementăm în Phase 1 blocarea auto-procesării (`actor_user_id != author_user_id` la schimbarea de status). Este o decizie de produs, nu una tehnică, și trebuie luată conștient — nu presupusă. **Este un cost direct al respingerii Opțiunii B**, iar Opțiunea B nu ar fi avut nevoie de niciun mecanism pentru a-l evita.

2. **Un cont de `staff` compromis expune și datele personale de cetățean ale persoanei.** Sesizările ei, adresa ei, fotografiile din fața casei ei. În Opțiunea B, aceste două suprafețe erau separate. Aici nu sunt. Cumulativitatea are un preț și acesta este.

3. **Revocarea unui rol NU este instantanee.** Rolul trăiește într-un JWT semnat. Când un `tenant_admin` retrage rolul de `staff` al unei persoane, **token-ul deja emis păstrează rolul vechi până expiră**. Fereastra este durata de viață a access token-ului (implicit 1 oră în Supabase, valoare care se poate reduce, cu cost de rețea și de sesiune). Mitigarea, spusă exact:
   - `tenant_users.role` este actualizat imediat, deci **orice token nou** (după refresh) poartă rolul nou;
   - la o **revocare care contează** (angajat plecat, cont compromis), procedura este **revocarea sesiunilor** utilizatorului (`auth.admin.signOut(user_id)` / invalidarea refresh token-urilor), care forțează re-autentificarea și, deci, emiterea unui token nou;
   - **fără acest pas explicit, fereastra rămâne deschisă.** Nu pretindem că retrogradarea rolului este suficientă. Procedura de revocare este parte din ecranul de administrare a utilizatorilor, nu o opțiune ascunsă.
   - Sensul invers (promovare) suferă de aceeași întârziere, dar este inofensiv: utilizatorul pur și simplu nu vede noile funcții până la refresh. Este confuz, nu periculos. UI-ul trebuie să spună „reconectează-te".

4. **Patru roluri fixe.** O primărie cu o structură neobișnuită trebuie să se **îndoaie după model**. Un funcționar care ar trebui să publice anunțuri dar nu să atribuie sesizări nu are un rol potrivit: primește `staff` (prea mult) sau `leadership` (prea puțin). **Nu avem un răspuns bun pentru acest caz în Phase 1.** Îl acceptăm și îl urmărim; dacă apare la primăria pilot, este dovada care declanșează reevaluarea Opțiunii C.

5. **`leadership` poate citi toate sesizările tenantului**, deci și sesizările personale ale angajaților și ale cetățenilor. Nu este un privilegiu de procesare, dar **este un privilegiu de lectură asupra datelor personale**. Este justificat operațional (conducerea trebuie să vadă ce se întâmplă în localitate), dar trebuie spus explicit, nu ascuns sub eticheta „doar citește".

6. **`tenant_admin` este un punct unic de eșec în interiorul tenantului.** Cine îl compromite poate crea alți `tenant_admin`, poate citi toate sesizările, poate schimba orice status. Frontiera de tenant îl oprește (nu poate atinge alt tenant), dar **în interiorul primăriei lui, este total**. MFA ar fi mitigarea evidentă; **nu este decisă aici** și acest lucru rămâne un risc deschis, nu unul rezolvat.

7. **Complexitatea politicilor RLS crește.** Fiecare tabel are acum mai multe politici de `SELECT` (una pentru cetățean, una pentru rolurile elevate) în loc de una singură. Mai multe politici = mai multe locuri de greșit. Verificarea C2 din ADR-0002 (nicio politică cu `USING (true)`) devine și mai importantă.

## Impact asupra securității și confidențialității

### `tenant_users` cu rol — forma exactă

Extinde tabelul din [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md). Cheia primară pe `user_id` rămâne — „un cont = un tenant" este în continuare o **constrângere structurală**, nu o convenție.

```sql
create type public.app_role as enum ('citizen', 'staff', 'leadership', 'tenant_admin');
-- Enum, nu text: un rol inexistent devine EROARE DE SCRIERE, nu un rând tăcut
-- pe care nicio politică nu îl potrivește. Setul este închis la nivel de tip.

create table public.tenant_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  role        public.app_role not null default 'citizen',   -- implicit: cel mai mic privilegiu
  full_name   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),   -- cine a acordat contul/rolul
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

create index tenant_users_tenant_role_idx on public.tenant_users (tenant_id, role);
```

Puncte care nu sunt decorative:

- **`default 'citizen'`** — un rând inserat fără rol este cel mai puțin privilegiat posibil. Deny by default, aplicat și la roluri.
- **`created_by` / `updated_by`** — cine a acordat rolul este el însuși un fapt auditabil. Fără el, „cine l-a făcut administrator?" nu are răspuns.
- **`is_active`** — dezactivarea unui cont nu îl șterge (audit-relevant facts nu se suprascriu). Un cont inactiv nu primește claim-uri (vezi hook-ul).

### Claim-ul din JWT — forma exactă (ilustrativ)

```json
{
  "sub": "9c1f6f0e-4f2a-4f7b-9a01-2e3b7c5d8a11",
  "aud": "authenticated",
  "role": "authenticated",
  "exp": 1783000000,
  "email": "maria.ionescu@example.ro",
  "app_metadata": {
    "tenant_id": "3d2b8a51-6c44-4a0e-9f3d-71b0c9e4a2f7",
    "app_role": "staff"
  },
  "user_metadata": {}
}
```

**Note obligatorii asupra formei:**

- Claim-ul se numește **`app_role`**, nu `role`. Câmpul `role` de nivel superior este al **PostgREST/Supabase** (`authenticated` / `anon`) și nu are voie să fie suprascris — o suprascriere ar rupe autentificarea sau ar putea escalada la un rol de bază de date. **Nu atingem `claims.role`.**
- `app_role` stă în **`app_metadata`**, alături de `tenant_id`, **niciodată** în `user_metadata`.
- `user_metadata` rămâne gol de orice câmp cu semnificație de autorizare. Este scriptibil de client; tot ce se află acolo este **date furnizate de utilizator**, nu fapte.

### Hook-ul de token — citește sursa de adevăr din baza de date

Extinde hook-ul din [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md). Citește **`tenant_users`**, niciodată input de client.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_claims    jsonb;
  v_tenant_id uuid;
  v_role      public.app_role;
begin
  -- SURSA DE ADEVĂR: baza de date. Niciodată `event -> 'claims' -> 'user_metadata'`,
  -- niciodată un câmp trimis de client. Un rol trimis de client este IGNORAT aici,
  -- pentru că nu este citit aici.
  select tu.tenant_id, tu.role
    into v_tenant_id, v_role
    from public.tenant_users tu
   where tu.user_id = (event ->> 'user_id')::uuid
     and tu.is_active = true;          -- cont dezactivat => niciun claim => niciun acces

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_claims := jsonb_set(
    v_claims, '{app_metadata}',
    coalesce(v_claims -> 'app_metadata', '{}'::jsonb),
    true
  );

  if v_tenant_id is not null and v_role is not null then
    v_claims := jsonb_set(v_claims, '{app_metadata,tenant_id}',
                          to_jsonb(v_tenant_id::text), true);
    v_claims := jsonb_set(v_claims, '{app_metadata,app_role}',
                          to_jsonb(v_role::text), true);
  end if;
  -- Fără rând activ în tenant_users => AMBELE claim-uri LIPSESC.
  -- Consecință: current_tenant_id() = NULL ȘI current_app_role() = NULL.
  -- RLS refuză peste tot. Fail closed, prin construcție.

  return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;
```

### Funcțiile de citire a rolului — fail-closed, analog cu `current_tenant_id()`

```sql
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', ''),
    ''
  )::public.app_role
$$;

-- has_role(...) modelează CUMULATIVITATEA într-un singur loc.
-- Un rol elevat satisface întotdeauna cerința de 'citizen'.
create or replace function public.has_role(required public.app_role)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when public.current_app_role() is null then false          -- claim absent => REFUZ
    when required = 'citizen'                                   -- orice rol include cetățean
         then true
    when required = 'staff'
         then public.current_app_role() in ('staff', 'tenant_admin')
    when required = 'leadership'
         then public.current_app_role() in ('leadership', 'staff', 'tenant_admin')
    when required = 'tenant_admin'
         then public.current_app_role() = 'tenant_admin'
    else false                                                  -- necunoscut => REFUZ
  end
$$;
```

Puncte care nu sunt decorative:

- **`current_app_role()` returnează `NULL` când claim-ul lipsește.** `NULL` în `USING`/`WITH CHECK` este fals ⇒ acces refuzat. **Fail closed prin construcție, nu printr-un `if` pe care cineva îl poate uita.**
- **`has_role` ramifică pe `else false`.** Un rol viitor, necunoscut acestei funcții, **nu primește nimic**. Nu există cale prin care o valoare neașteptată să producă `true`.
- **Cumulativitatea este exprimată o singură dată**, aici. Politicile RLS nu enumeră liste de roluri; cheamă `has_role`. Dacă mâine `leadership` capătă un drept, se schimbă **un loc**, nu douăzeci de politici.
- `has_role('leadership')` este adevărat și pentru `staff`/`tenant_admin`: „poate citi ca și conducerea" este un drept pe care rolurile operaționale îl au oricum. Aceasta **nu** înseamnă că `leadership` poate face ce face `staff` — vezi `has_role('staff')`, care nu îl include.
- `security invoker` + `search_path = ''` — funcția nu poate fi deturnată printr-un `search_path` ostil și nu rulează cu privilegiile definitorului.

### Tiparul de politică RLS: tenant ȘI rol, pe același tabel

Exemplu complet pe `issues`. **Același tabel servește ambele roluri; politicile diferă, predicatul de tenant NU.**

```sql
alter table public.issues enable row level security;
alter table public.issues force  row level security;

-- Coloana care face posibilă delimitarea între cetățenii ACELUIAȘI tenant:
--   author_user_id uuid not null default auth.uid()
--     references auth.users(id) on delete restrict

------------------------------------------------------------------------------
-- SELECT
------------------------------------------------------------------------------

-- Cetățeanul: DOAR rândurile lui, DOAR în tenantul lui.
-- Fără predicatul pe author_user_id, orice cetățean ar citi sesizările vecinilor.
create policy issues_select_own_as_citizen
  on public.issues
  for select
  to authenticated
  using (
        tenant_id      = (select public.current_tenant_id())   -- FRONTIERA DE TENANT
    and author_user_id = (select auth.uid())                   -- FRONTIERA DE PROPRIETATE
  );

-- staff / leadership / tenant_admin: TOATE rândurile tenantului LOR.
-- has_role('leadership') este adevărat pentru leadership, staff și tenant_admin.
-- Predicatul de tenant este PREZENT. Rolul NU îl înlocuiește.
create policy issues_select_all_in_tenant_elevated
  on public.issues
  for select
  to authenticated
  using (
        tenant_id = (select public.current_tenant_id())        -- ACELAȘI predicat de tenant
    and (select public.has_role('leadership'))                 -- predicat ADĂUGAT, nu substituit
  );

-- Politicile PERMISIVE se combină prin OR. Un `staff` satisface a doua politică
-- pentru toate rândurile tenantului său — inclusiv pentru cele scrise de el ca cetățean.
-- Un `citizen` nu satisface a doua politică NICIODATĂ: has_role('leadership') este false.

------------------------------------------------------------------------------
-- INSERT — oricine, în tenantul lui, ca autor al lui însuși
------------------------------------------------------------------------------

-- Un rol elevat NU pierde acest drept: has_role('citizen') este true pentru toți.
-- Aceasta ESTE cumulativitatea, aplicată în planul de date.
create policy issues_insert_own_as_citizen
  on public.issues
  for insert
  to authenticated
  with check (
        tenant_id      = (select public.current_tenant_id())   -- nu poate scrie în alt tenant
    and author_user_id = (select auth.uid())                   -- nu poate FALSIFICA autorul
    and (select public.has_role('citizen'))                    -- claim absent => false => refuz
  );

-- `author_user_id = auth.uid()` în WITH CHECK este ceea ce împiedică un funcționar
-- să creeze o sesizare "în numele" altui cetățean. Fără el, autorul devine un câmp
-- liber trimis de client, iar întreaga urmă de audit a autorului devine fictivă.

------------------------------------------------------------------------------
-- UPDATE — două politici distincte, cu WITH CHECK obligatoriu (ADR-0002, C3)
------------------------------------------------------------------------------

-- Cetățeanul își poate corecta propria sesizare. NU își poate schimba autorul,
-- NU o poate muta în alt tenant.
create policy issues_update_own_as_citizen
  on public.issues
  for update
  to authenticated
  using (
        tenant_id      = (select public.current_tenant_id())
    and author_user_id = (select auth.uid())
  )
  with check (
        tenant_id      = (select public.current_tenant_id())   -- nu poate MUTA rândul în alt tenant
    and author_user_id = (select auth.uid())                   -- nu poate CEDA/FURA autorul
  );
  -- Ce câmpuri poate schimba efectiv (nu statusul!) se aplică prin GRANT UPDATE (col)
  -- și prin trigger; RLS filtrează RÂNDURI, nu COLOANE. Vezi mai jos.

-- staff / tenant_admin procesează sesizările tenantului lor.
-- leadership NU: has_role('staff') este FALSE pentru leadership.
create policy issues_update_processing_as_staff
  on public.issues
  for update
  to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('staff'))                      -- exclude leadership ȘI citizen
  )
  with check (
        tenant_id = (select public.current_tenant_id())        -- nu poate MUTA rândul în alt tenant
    and (select public.has_role('staff'))
  );

------------------------------------------------------------------------------
-- DELETE — nicio politică. Ștergerea logică se face prin UPDATE (ADR-0002).
------------------------------------------------------------------------------
```

**Ce NU face RLS și trebuie făcut altfel — spus explicit:**

- **RLS filtrează rânduri, nu coloane.** Politica `issues_update_own_as_citizen` permite cetățeanului să atingă *rândul* lui — dar nu îl împiedică, singură, să scrie `status = 'resolved'` în el. Delimitarea pe coloane se face cu **`GRANT UPDATE (col, ...)`** (ca la citirea publică din ADR-0002) și/sau cu un **trigger** care respinge modificarea câmpurilor rezervate rolurilor elevate:

```sql
revoke update on public.issues from authenticated;
grant  update (title, description, category_id, location, updated_at)
  on public.issues to authenticated;
-- status, assigned_to, resolved_at NU sunt acordate rolului `authenticated` la nivel de coloană.
-- Schimbarea lor trece EXCLUSIV printr-o funcție SECURITY DEFINER dedicată
-- (change_issue_status), care:
--   1. verifică has_role('staff')  -- leadership și citizen sunt refuzați,
--   2. validează tranziția de status permisă,
--   3. scrie rândul în issue_status_history (append-only),
--   4. scrie rândul de audit cu actor_user_id, actor_role, acting_as = 'official',
--   toate în ACEEAȘI tranzacție.
-- Contractul complet al acestei funcții este în specificația de workflow, nu în acest ADR.
```

- **`FORCE ROW LEVEL SECURITY`** rămâne obligatoriu (ADR-0002): fără el, codul care rulează ca proprietar al tabelului ocolește politicile. **`FORCE` nu oprește `service_role`** — de aceea cheia `service_role` nu are voie într-un bundle de client (V2 din ADR-0001).
- **`(select public.has_role(...))`**, nu `public.has_role(...)` — forma cu `select` este evaluată o singură dată (InitPlan), nu o dată pe rând. Corectitudinea e identică; performanța nu.

### Prevenirea escaladării de privilegii — politicile pe `tenant_users`

Aici se decide dacă întregul model rezistă. `tenant_users` este tabelul care **produce claim-urile**. Cine îl poate scrie, își poate scrie rolul.

```sql
alter table public.tenant_users enable row level security;
alter table public.tenant_users force  row level security;

------------------------------------------------------------------------------
-- SELECT
------------------------------------------------------------------------------

create policy tenant_users_select_self
  on public.tenant_users for select to authenticated
  using ( user_id = (select auth.uid()) );          -- oricine își vede propriul rând

create policy tenant_users_select_tenant_admin
  on public.tenant_users for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())   -- DOAR utilizatorii tenantului SĂU
    and (select public.has_role('tenant_admin'))
  );
-- Un tenant_admin al lui A nu vede NICIUN utilizator al lui B. Predicatul de tenant
-- este prezent și aici; rolul nu îl înlocuiește niciodată.

------------------------------------------------------------------------------
-- INSERT / UPDATE — EXCLUSIV tenant_admin, EXCLUSIV în propriul tenant
------------------------------------------------------------------------------

create policy tenant_users_insert_by_tenant_admin
  on public.tenant_users for insert to authenticated
  with check (
        tenant_id = (select public.current_tenant_id())   -- (a) NU poate crea un cont în tenantul B
    and (select public.has_role('tenant_admin'))          -- (b) NU poate crea conturi cine nu e admin
    and user_id <> (select auth.uid())                    -- (c) NU își poate crea un al doilea rând sieși
  );

create policy tenant_users_update_by_tenant_admin
  on public.tenant_users for update to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('tenant_admin'))
    and user_id <> (select auth.uid())                    -- (d) NU își poate modifica PROPRIUL rol
  )
  with check (
        tenant_id = (select public.current_tenant_id())   -- (e) NU poate MUTA un utilizator în tenantul B
    and (select public.has_role('tenant_admin'))
    and user_id <> (select auth.uid())
  );

-- Nicio politică DELETE. Dezactivarea se face prin `is_active = false` (UPDATE),
-- care păstrează faptele auditabile (ADR-0002).
```

**Ce oprește fiecare predicat — explicit, pentru că fiecare oprește un atac diferit:**

| Predicat | Atacul pe care îl oprește |
|---|---|
| `tenant_id = current_tenant_id()` în `USING` | Un `tenant_admin` al lui A **citește** utilizatorii lui B. |
| `tenant_id = current_tenant_id()` în `WITH CHECK` | Un `tenant_admin` al lui A **acordă un rol în tenantul B** sau **mută** un utilizator în B. **Acesta este atacul cross-tenant de escaladare. Fără `WITH CHECK`, el reușește.** |
| `has_role('tenant_admin')` | Un `citizen` sau un `staff` **își acordă singur** un rol. Un `staff` **nu** administrează utilizatori. |
| `user_id <> auth.uid()` | Un `tenant_admin` **își schimbă propriul rol** — și, mai important, un `citizen` **nu își poate modifica propriul rând** (nu are nicio politică `UPDATE` care să îl acopere; politica `tenant_users_select_self` este **doar `SELECT`**). |
| `role` are tip `app_role` (enum) | Scrierea unui rol inexistent (`'super_admin'`, `'god'`) **eșuează la nivel de tip**, nu produce un rând tăcut. |
| Hook-ul citește `tenant_users`, nu `event.claims.user_metadata` | Un rol **trimis de client** la înregistrare sau prin `auth.updateUser` **nu este citit niciodată**, deci nu poate ajunge în JWT. |

**Auto-escaladarea este imposibilă prin trei mecanisme independente**, și niciunul nu e suficient singur:

1. Un `citizen` nu satisface `has_role('tenant_admin')`, deci **nu are nicio politică de scriere** pe `tenant_users`. Deny by default se aplică.
2. Chiar dacă ar avea, `user_id <> auth.uid()` îl împiedică să își atingă **propriul** rând.
3. Chiar dacă ar reuși să scrie în baza de date, **claim-ul lui actual nu se schimbă** până la refresh — iar la refresh, hook-ul citește din nou `tenant_users`, deci ar citi valoarea nouă. **Punctul 3 nu este o protecție**; îl enumerăm ca să fie clar că protecția reală este 1 + 2, nu întârzierea de propagare.

**Înregistrarea unui utilizator nou.** Un utilizator care se înregistrează singur **nu poate insera în `tenant_users`** (nu satisface `has_role('tenant_admin')`). Rândul lui este creat de un **trigger `SECURITY DEFINER` pe `auth.users`**, care:

- setează `role = 'citizen'` **necondiționat**, ignorând orice câmp din `raw_user_meta_data`;
- setează `tenant_id` din tenantul de înregistrare (rezolvat server-side);
- **nu citește niciodată un rol propus de client.**

Un utilizator care trimite `{ "role": "tenant_admin" }` la înregistrare obține un cont de `citizen`. Câmpul nu este respins cu eroare — este **inexistent pentru cod**.

### Ce obține și ce nu obține un utilizator care se înregistrează singur

| Obține | Nu obține, prin niciun mecanism expus |
|---|---|
| Rol `citizen` | Orice rol elevat |
| Apartenență la **exact un** tenant | Apartenență la mai mulți tenanți |
| Drept de creare de sesizări și cereri | Citirea sesizărilor altui cetățean, chiar din același tenant |
| Citirea **doar** a propriilor sesizări și cereri | Atribuire, schimbare de status, publicare de anunțuri |
| Citirea conținutului public (ADR-0002) | Acces la dashboard, la utilizatori, la setări sau la branding |
| — | Orice date ale altui tenant, pe orice rută |

## Impact multi-tenant

**Rolul nu este o frontieră de tenant și nu poate deveni una.** Este un al doilea predicat, **peste** cel din [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md). Regula operațională, fără excepții în Phase 1:

> Orice politică RLS pe un tabel cu `tenant_id` conține predicatul `tenant_id = (select public.current_tenant_id())`. **Un predicat de rol nu îl poate înlocui, nu îl poate relaxa și nu poate exista în locul lui.**

Aceasta devine o **verificare structurală blocantă**, extinsă din C1–C7:

| # | Verificare | Rezultat cerut |
|---|---|---|
| **C8** | Fiecare politică pe un tabel cu `tenant_id` conține în `USING` **și** în `WITH CHECK` (unde există) o referință la `current_tenant_id()` | fără excepție; o politică „doar cu rol" **pică build-ul** |
| **C9** | Șirul `app_role` (sau orice claim de rol) **nu apare niciodată** în `user_metadata` — nici în cod de client, nici în hook, nici în migrații | zero potriviri. Extinde C7 din ADR-0002 de la `tenant_id` la rol. |
| **C10** | Hook-ul de token nu citește **niciun** câmp din `event -> 'claims' -> 'user_metadata'` și nici alt input de client pentru a determina rolul | zero potriviri |
| **C11** | Nicio politică pe `tenant_users` pentru `INSERT`/`UPDATE` nu există fără **toate trei**: predicat de tenant, `has_role('tenant_admin')`, `user_id <> auth.uid()` | fără excepție |
| **C12** | Rolul este de tip enum `app_role`; nu există coloană de rol de tip `text` liber | zero potriviri |
| **C13** | Nu există niciun rol numit `super_admin`, `platform_admin`, `support` sau echivalent în `app_role`, și nicio politică fără predicat de tenant | zero potriviri. **Protejează decizia 11 din ADR-0002 împotriva reintroducerii tăcute.** |

**Frontiera de tenant dincolo de tabele** rămâne cea din ADR-0002, cu rolul adăugat ca al doilea predicat:

- **Storage.** Prefixul `{tenant_id}/` rămâne token-ul de autorizare. Rolul se adaugă acolo unde contează: un cetățean poate citi doar atașamentele **sesizărilor lui**; un rol elevat poate citi atașamentele tenantului. Regulile complete rămân în FUP-3.
- **Exporturi.** Se generează server-side, sub JWT-ul utilizatorului, deci sub RLS **și** sub predicatul de rol. Un `citizen` care cere un export obține exclusiv propriile rânduri — **fără nicio verificare suplimentară în codul de export**, pentru că RLS o face. Serverul nu acceptă niciodată `tenant_id` **și nici `role`** ca parametri de la client.
- **Dashboard.** Indicatorii se calculează sub RLS. `leadership` îi vede; un `citizen` care ar apela același endpoint obține agregate peste **propriile** rânduri, nu un refuz — **acest lucru trebuie tratat explicit în FUP-9**: un dashboard care nu verifică `has_role('leadership')` la nivel de rută nu expune date, dar afișează cifre lipsite de sens. Autorizarea de rută este UX + claritate; **autorizarea reală rămâne în RLS.**
- **Notificări și joburi de fundal.** Neschimbat față de ADR-0002: scope de tenant explicit, fără `service_role` cu acces general.

### Suita de teste — extinde T1–T18 din ADR-0002

T1–T18 rămân neschimbate și obligatorii. Se adaugă cazurile de rol. Se execută cu client Supabase real și **cheia anon** (niciodată `service_role`), cu doi tenanți (A, B) și, în fiecare, câte un utilizator din fiecare rol.

| # | Caz | Rezultat cerut |
|---|---|---|
| **T19** | `citizen` C1 din tenantul A face `select` pe `issues`, unde există sesizări ale lui C1 **și** ale lui C2 (alt cetățean, **același tenant**) | strict sesizările lui C1. **Testul care prinde politica fără predicatul `author_user_id`.** |
| **T20** | `citizen` C1 face `select` filtrat explicit pe `id`-ul sesizării lui C2 (același tenant) | 0 rânduri |
| **T21** | `citizen` C1 face `update` pe sesizarea lui C2 (același tenant) | 0 rânduri afectate |
| **T22** | `citizen` C1 face `insert` cu `author_user_id` = C2 | eroare (`WITH CHECK`) — **falsificarea autorului este blocată** |
| **T23** | `staff` din A face `select` nefiltrat pe `issues` | **toate** sesizările lui A, **zero** ale lui B |
| **T24** | `staff` din A creează o sesizare (ca cetățean) | reușește; `author_user_id` = el; audit: `actor_role = 'staff'`, `acting_as = 'citizen'` — **testul care dovedește cumulativitatea** |
| **T25** | `leadership` din A încearcă schimbarea statusului unei sesizări | **refuzat** (`has_role('staff')` = false) |
| **T26** | `leadership` din A încearcă atribuirea unei sesizări | refuzat |
| **T27** | `leadership` din A încearcă publicarea unui anunț | refuzat |
| **T28** | `leadership` din A face `select` pe `issues` | toate sesizările lui A (citire permisă), zero ale lui B |
| **T29** | `leadership` din A creează o sesizare proprie | reușește (cumulativitate) |
| **T30** | `staff` din A face `insert`/`update` pe `tenant_users` | **refuzat** — `staff` nu administrează utilizatori |
| **T31** | `staff` din A încearcă să își schimbe propriul rol în `tenant_admin` | refuzat (`has_role('tenant_admin')` = false **și** `user_id <> auth.uid()`) |
| **T32** | `citizen` din A încearcă `insert`/`update` pe `tenant_users` (orice rând, inclusiv propriul) | refuzat |
| **T33** | `citizen` din A apelează `auth.updateUser({ data: { app_role: 'tenant_admin' } })`, apoi **reîmprospătează sesiunea** | `user_metadata.app_role` există (clientul l-a scris), dar **JWT-ul are `app_metadata.app_role = 'citizen'`**; toate acțiunile elevate rămân refuzate. **Testul care dovedește că un claim falsificat este ignorat.** |
| **T34** | `tenant_admin` din A face `insert` în `tenant_users` cu `tenant_id` = B | eroare (`WITH CHECK`) — **escaladare cross-tenant blocată** |
| **T35** | `tenant_admin` din A face `update` pe un rând din `tenant_users` al tenantului B | 0 rânduri afectate |
| **T36** | `tenant_admin` din A face `update` mutând un utilizator al lui A în `tenant_id` = B | eroare (`WITH CHECK`) |
| **T37** | `tenant_admin` din A face `select` pe `tenant_users` | strict utilizatorii lui A |
| **T38** | `tenant_admin` din A acordă rolul `staff` unui cetățean din A | reușește; `created_by`/`updated_by` = admin-ul; rând de audit prezent |
| **T39** | `tenant_admin` din A încearcă `update` pe **propriul** rând | refuzat (`user_id <> auth.uid()`) — **niciun rol nu se acordă sieși** |
| **T40** | Se scrie `role = 'super_admin'` în `tenant_users` | eroare de tip (enum `app_role`) |
| **T41** | Utilizator cu rând `is_active = false` în `tenant_users`, reautentificat | JWT **fără** `tenant_id` și **fără** `app_role`; 0 rânduri pe orice tabel; orice scriere refuzată |
| **T42** | **JWT învechit**: `staff` din A obține un token; `tenant_admin` îl retrogradează la `citizen`; `staff` folosește **token-ul vechi, încă valid** | acțiunile de `staff` **REUȘESC** până la expirarea token-ului. **Testul documentează comportamentul real, nu îl ascunde.** |
| **T43** | Aceeași secvență ca T42, urmată de **revocarea sesiunilor** utilizatorului | token-ul vechi este respins; toate acțiunile de `staff` sunt refuzate. **Aceasta este mitigarea; T42 fără T43 este fereastra deschisă.** |
| **T44** | `citizen` din A încearcă `select` pe `audit_log`, `tenant_users` (rândurile altora), setări, branding | refuzat / 0 rânduri |
| **T45** | Client **anon** (fără JWT) încearcă orice acțiune care cere rol | refuzat — `current_app_role()` = `NULL` ⇒ `has_role(...)` = `false` |

**T42 este cel mai important test din acest ADR**: nu pentru că demonstrează o protecție, ci pentru că **demonstrează o gaură pe care o acceptăm conștient**. Un test care trece pentru că sistemul face lucrul greșit-dar-așteptat este mai onest decât un test care nu există.

## Impact operațional și cost

**Onboarding-ul unui tenant** — extinde procedura din [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md):

1. `INSERT` în `tenants`.
2. Înregistrare DNS.
3. **Creare cont pentru primul `tenant_admin`** — cont în `auth.users` + rând în `tenant_users` cu `role = 'tenant_admin'`, executat de **operatorul platformei**, din consola Supabase.
4. Predarea contului către primărie, cu **schimbarea obligatorie a parolei la prima autentificare**.
5. **Din acest punct, primăria se administrează singură.** Operatorul nu mai intervine.

Pasul 3 este singura acțiune privilegiată din tot ciclul de viață al unui tenant. Este **deliberată** (cineva se autentifică în consola Supabase), **rară** (o dată per primărie) și **urmăribilă** (log-urile furnizorului). **Nu este o rută în aplicație și nu poate fi furată printr-un XSS.**

**Cazul care nu are răspuns bun.** Dacă singurul `tenant_admin` al unei primării își pierde accesul (parolă uitată + email/telefon inaccesibil), **primăria rămâne fără administrator**. Nu există super-admin care să repare. Ce facem:

- Recomandăm ferm **cel puțin doi `tenant_admin`** per primărie. Aplicația **avertizează** când există unul singur.
- Recuperarea de ultimă instanță este o **intervenție din consola Supabase de către operator** — aceeași procedură ca la pasul 3, cu aceeași urmă de audit.
- **Nu este o funcționalitate. Este o intervenție manuală, și o numim așa.** Este costul direct al deciziei „fără super-admin". Îl acceptăm.

**Cost.** Modelul de roluri **nu adaugă cost de infrastructură**: o coloană, un enum, un claim în JWT, câteva politici. Costul real este:

- **Cognitiv**, pentru echipă: mai multe politici per tabel, deci mai multe locuri de greșit.
- **De testare**: matricea rol × acțiune (36 de celule) plus T19–T45 cresc timpul de CI. Reevaluăm față de pragul V9 din ADR-0001 (10 minute).
- **Operațional**: ecranul de administrare a utilizatorilor este funcționalitate de construit (Phase 1, `phase-1-required`), nu o consecință gratuită a acestui ADR.

## Impact asupra migrării și compatibilității

Nu există sistem de migrat. Impactul este asupra **ordinii migrațiilor** și a compatibilității viitoare.

1. **`app_role`, coloana `tenant_users.role` și funcțiile `current_app_role()` / `has_role()` intră în migrațiile INIȚIALE**, în aceeași migrație cu `tenant_users` din ADR-0002. **Nu se creează niciun tabel cu politici de rol înaintea lor.**
2. **Hook-ul de token se actualizează în ACEEAȘI migrație** în care apare coloana `role`. Un hook care nu emite `app_role` peste un set de politici care îl cer produce **refuz total** — vizibil, dar la fel de rupt.
3. **Nicio migrație care creează un tabel cu `tenant_id` nu are voie să fie separată de migrația care îi definește politicile de tenant ȘI de rol.** Sunt aceeași schimbare (extinde regula din ADR-0002). C1 și C8 pică altfel.
4. **Adăugarea unui rol nou în viitor** este o schimbare **compatibilă înainte**: `alter type app_role add value ...` + actualizarea `has_role` + politici noi. Conturile existente păstrează rolul lor. **Eliminarea** unui rol nu este compatibilă: `alter type ... drop value` nu există în PostgreSQL; ar cere migrarea conturilor și recrearea tipului.
5. **Trecerea la Opțiunea C (capabilități) este o schimbare INCOMPATIBILĂ.** Ar însemna: tabel nou de capabilități, claim nou în JWT, **rescrierea fiecărei politici RLS** și migrarea fiecărui cont existent la un set de capabilități. **Estimare onestă: zile de muncă și o rescriere completă a politicilor, plus o suită de teste nouă.** Nu pregătim această cale și nu pretindem că modelul este „gata de capabilități". Dacă devine cerință, este un ADR care **înlocuiește** acest ADR.
6. **Trecerea la Opțiunea B (conturi separate) este, de asemenea, incompatibilă**, și în plus **retroactivă**: conturile existente ar trebui divizate, iar istoricul de audit al unei persoane s-ar rupe în două. Cu cât rulăm mai mult pe modelul cumulativ, cu atât costul acestei schimbări crește. **Este o ușă care se închide încet.** O spunem acum, nu la momentul deciziei.

## Plan de validare

Toate verificările produc un rezultat observabil. Cele blocante opresc merge-ul în `main`.

| ID | Verificare | Cum se dovedește | Poartă |
|---|---|---|---|
| C1–C7 | Verificările structurale din [ADR-0002](./ADR-0002-tenancy-model-and-tenant-resolution.md) | Neschimbate. Rămân blocante. | Blocantă în CI |
| **C8** | Fiecare politică pe un tabel cu `tenant_id` conține `current_tenant_id()` | Interogare pe `pg_policies`: `qual` și `with_check` conțin referința. O politică „doar cu rol" = build roșu. | Blocantă în CI |
| **C9** | Rolul nu apare niciodată în `user_metadata` | Grep pe cod, migrații și hook. Zero potriviri. Extinde C7. | Blocantă în CI |
| **C10** | Hook-ul nu citește rolul din input de client | Inspecție a corpului funcției în `pg_proc`: fără referință la `user_metadata` sau la câmpuri de request. | Blocantă în CI |
| **C11** | Politicile de scriere pe `tenant_users` au toate trei predicatele | Interogare pe `pg_policies` pentru `tenant_users`: fiecare `INSERT`/`UPDATE` conține tenant + `has_role('tenant_admin')` + `user_id <> auth.uid()`. | Blocantă în CI |
| **C12** | Rolul este enum, nu `text` | Interogare pe `information_schema.columns`. | Blocantă în CI |
| **C13** | Nu există rol de tip super-admin și nicio politică fără predicat de tenant | Enumerarea valorilor `app_role` = exact cele patru. **Protejează decizia 11 din ADR-0002.** | Blocantă în CI |
| T1–T18 | Suita cross-tenant din ADR-0002 | Neschimbată. Rămâne blocantă. | Blocantă în CI |
| **T19–T45** | Suita cross-rol | Teste automate, client anon real, doi tenanți × patru roluri, pe schema reală produsă de replay. | Blocantă în CI |
| **M1** | **Matricea de permisiuni este acoperită integral** | Fiecare celulă din matricea rol × acțiune (36) are **cel puțin un test** cu rezultat DA sau NU explicit. O celulă neacoperită = build roșu. | Blocantă în CI |
| **A1** | **Auditul înregistrează calitatea acțiunii** | Fiecare rând de audit are `actor_user_id`, `actor_role` și `acting_as` non-null. Un `staff` care creează o sesizare produce `acting_as = 'citizen'`; o schimbare de status produce `acting_as = 'official'`. | Blocantă înainte de primul tenant real |
| **A2** | **Revocarea sesiunii funcționează** | T43: după revocare, token-ul vechi este respins. Procedura este expusă în ecranul de administrare a utilizatorilor, nu doar în consolă. | Blocantă înainte de primul tenant real |
| **A3** | **Avertismentul „un singur tenant_admin"** | Aplicația afișează avertismentul când tenantul are un singur `tenant_admin` activ. | Blocantă înainte de primul tenant real |
| V2 (ADR-0001) | `service_role` absent din bundle-uri | Neschimbată. | Blocantă în CI |

[R-002](../project/risk-register.md) rămâne guvernat de ADR-0002. Acest ADR **nu îl închide și nu îl agravează** — adaugă C8–C13 și T19–T45 ca verificări suplimentare peste aceeași frontieră.

### Matricea de permisiuni — sursa pentru M1

DA = permis. NU = refuzat în planul de date (RLS sau `GRANT` de coloană), nu doar ascuns în UI.

| Acțiune | `citizen` | `staff` | `leadership` | `tenant_admin` |
|---|:---:|:---:|:---:|:---:|
| Creează sesizare / cerere | **DA** | **DA** | **DA** | **DA** |
| Citește **propriile** sesizări | **DA** | **DA** | **DA** | **DA** |
| Citește sesizările **altui cetățean** din același tenant | **NU** | DA | DA | DA |
| Citește **toate** sesizările tenantului | NU | **DA** | **DA** | **DA** |
| Atribuie o sesizare | NU | **DA** | **NU** | **DA** |
| Schimbă statusul unei sesizări | NU | **DA** | **NU** | **DA** |
| Publică / programează anunțuri | NU | **DA** | **NU** | **DA** |
| Vede dashboard-ul de indicatori | NU | DA | **DA** | DA |
| Administrează utilizatori (creare, rol, dezactivare) | NU | **NU** | NU | **DA** |
| Administrează setări și branding | NU | NU | NU | **DA** |
| Citește sesizările **altui tenant** | **NU** | **NU** | **NU** | **NU** |
| Acordă un rol **în alt tenant** | **NU** | **NU** | **NU** | **NU** |
| Își modifică **propriul** rol | **NU** | **NU** | **NU** | **NU** |

Citirea acestei matrici, pe verticală:

- **Primele două rânduri sunt cumulativitatea.** Fiecare rol elevat are DA. Acesta este întregul argument al Opțiunii A, exprimat în două rânduri.
- **`leadership` are NU pe atribuire, status și anunțuri.** Nu este o omisiune. Conducerea **nu procesează** (D11). Dacă primarul vrea să schimbe un status, cere unui funcționar — și rămâne urma cine a făcut-o.
- **`staff` are NU pe administrarea utilizatorilor.** Un funcționar nu își poate promova colegii și nu se poate promova pe sine.
- **Ultimele trei rânduri au NU pe toate coloanele.** Nu există rol în acest sistem care le poate face. **Inclusiv `tenant_admin`. Inclusiv operatorul platformei, prin aplicație.**

## Acțiuni ulterioare

**ADR-uri ulterioare necesare:**

| ID | ADR necesar | De ce este blocant |
|---|---|---|
| **FUP-14** (nou) | **Rutare și atribuire pe departamente** — dacă și cum se segmentează sesizările pe departamente/compartimente în interiorul unui tenant; dacă un `staff` de Urbanism trebuie să nu vadă sesizările de Asistență Socială | Cele patru roluri **nu** exprimă acest lucru: în Phase 1, orice `staff` vede **toate** sesizările tenantului. Dacă primăria pilot cere segmentare, este o schimbare de model, nu o setare. Blochează triajul în primării cu mai multe compartimente. |
| **FUP-15** (nou) | **Politica de sesiune și MFA** — durata access token-ului (care **determină direct** fereastra de la T42), sesiuni concurente, deconectare forțată, dacă `tenant_admin` cere MFA obligatoriu | Fereastra de propagare a revocării de rol (consecința negativă 3) este **un parametru al politicii de sesiune, nu al acestui ADR**. Miza compromiterii unui `tenant_admin` (consecința negativă 6) este un argument pentru MFA, **nu o decizie luată aici**. |
| FUP-3 | **Storage și control al accesului la fișiere** — trebuie extins cu predicatul de rol: cetățeanul vede atașamentele **sesizărilor lui**; rolurile elevate, pe cele ale tenantului | Definit în ADR-0002 fără rol. Acum are nevoie de el. |
| FUP-9 | **Definiția indicatorilor din dashboard** — trebuie să precizeze că `leadership` este consumatorul, iar autorizarea de rută (`has_role('leadership')`) este UX, **nu** control de securitate; controlul rămâne în RLS | Un `citizen` care apelează endpoint-ul de dashboard nu trebuie să obțină cifre lipsite de sens. |
| FUP-10 | **Acces de suport bazat pe consimțământ** (din ADR-0002) — rămâne **separat** și **nu** se rezolvă prin adăugarea unui rol în `app_role` | **Acest ADR nu creează un rol de suport.** C13 împiedică adăugarea lui tăcută. |
| FUP-12 | **Ciclul de viață al tenantului** (din ADR-0002) — trebuie extins: ce se întâmplă cu conturile și rolurile la suspendarea unui tenant | `is_active` pe utilizator există; suspendarea unui **tenant** întreg nu este definită. |

**Actualizări de registru — necesare, prin commit-uri separate** (acest ADR **nu** le execută):

- [`docs/project/open-questions.md`](../project/open-questions.md) — înregistrarea întrebărilor deschise de mai jos, cu owner și status.
- [`docs/project/risk-register.md`](../project/risk-register.md) — R-002 este adresat de ADR-0002; acest ADR adaugă C8–C13 și T19–T45 la setul de porți. Riscul nou de mai jos (ambiguitatea de audit + fereastra de revocare) trebuie înregistrat ca risc distinct, **nu topit în R-002**.

**Întrebări deschise, care NU sunt ascunse în acest ADR:**

- **Se blochează tehnic auto-procesarea?** Un funcționar care își procesează propria sesizare este **înregistrat**, dar **nu este împiedicat** (consecința negativă 1). Blocarea (`actor_user_id <> author_user_id` la schimbarea de status) este o **decizie de produs**, nu una tehnică. **Nu o presupunem.** Owner: Product owner + reprezentantul primăriei.
- **Cât durează access token-ul?** Determină direct fereastra de la T42. Nu o alegem aici. Owner: Solution architect (FUP-15).
- **Este MFA obligatoriu pentru `tenant_admin`?** Argumentul există (consecința negativă 6). Decizia **nu**. Owner: Product owner + Solution architect (FUP-15).
- **Are primăria pilot o structură care încape în patru roluri?** **Neverificat.** Dacă nu, este dovada care declanșează reevaluarea Opțiunii C. Owner: Product owner + reprezentantul primăriei ([OQ-003](../project/open-questions.md)).
- **Are primăria pilot compartimente care trebuie separate?** Neverificat. Blochează FUP-14. Owner: reprezentantul primăriei.
- **Perioadele de retenție** pentru rândurile de audit care conțin `actor_user_id`. **Nestabilite. Nu se inventează** ([OQ-007](../project/open-questions.md)).

## Surse și documente asociate

- [ADR-0002 — Model de multi-tenancy și strategia de rezolvare a tenantului](./ADR-0002-tenancy-model-and-tenant-resolution.md) — acest ADR este **FUP-2** din el. Preia integral: `current_tenant_id()`, hook-ul de token, `app_metadata` ca singurul loc pentru claim-uri verificate, `FORCE ROW LEVEL SECURITY`, deny by default, `WITH CHECK` obligatoriu pe `UPDATE`, „un cont = un tenant", interdicția super-adminului (decizia 11), verificările C1–C7 și suita T1–T18.
- [ADR-0001 — Baseline tehnologic și de deployment pentru Phase 1](./ADR-0001-phase-1-technology-and-deployment-baseline.md) — FUP-2 este definit acolo. Preia V1 (teste cross-tenant) și V2 (scanare de secrete) ca porți de CI; cerința ca indicatorii să se calculeze din istoricul imuabil de tranziții.
- [`docs/project/open-questions.md`](../project/open-questions.md) — OQ-003 (regulile primăriei pilot, care determină dacă patru roluri sunt suficiente), OQ-007 (retenție).
- [`docs/project/risk-register.md`](../project/risk-register.md) — R-002, guvernat de ADR-0002; R-004 (aplicație prea complicată pentru personalul local), care este **argumentul central împotriva Opțiunii C**.
- `CLAUDE.md` — scope Phase 1 (rolurile municipale și de conducere), monolit modular, interdicția de a inventa cerințe legale sau perioade de retenție.
- `.claude/rules/security.md` — deny by default, autorizare server-side pentru fiecare acțiune protejată, interdicția filtrării în client ca autorizare, audit trail pentru acțiuni relevante de securitate.
- `.claude/rules/architecture.md` — izolarea tenantului niciodată implicită, contracte stabile între module, faptele auditabile nu se suprascriu.
- `.claude/rules/product-scope.md` — standardul de simplitate: „fewer steps and clearer decisions for users", care nu înseamnă securitate slabă. Argumentul împotriva unui ecran de bifat capabilități.
