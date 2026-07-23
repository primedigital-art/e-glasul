# Feature Brief: Sesizări cetățenești

- **ID:** FEAT-001
- **Status:** Draft
- **Fază:** Phase 1 required
- **Owner:** Product owner
- **Ultima actualizare:** 2026-07-14

> **De ce `Draft` și nu `In review`.** Întrebarea centrală a acestei funcționalități — **ce este primăria obligată să facă atunci când primește o sesizare** (termen, număr de înregistrare, formă a răspunsului) — este **nerezolvată** și nu poate fi rezolvată de produs. Vezi secțiunea 18, blocantul B1. Nu inventăm termene, proceduri de registratură sau obligații legale (`.claude/rules/security.md`, `CLAUDE.md`, principiul 8). Brief-ul descrie tot ce **știm**, marchează explicit tot ce **nu știm** și rămâne `Draft` până când [OQ-003](../../project/open-questions.md) primește un răspuns.

---

## 1. Problema

Astăzi, un cetățean care vede o groapă în asfalt, un bec de iluminat public stins, o grămadă de gunoi, o haită de câini fără stăpân sau o conductă spartă are la dispoziție canale care **nu produc nicio urmă verificabilă**: un telefon la primărie, un mesaj pe o pagină de Facebook, o vizită la ghișeu, o discuție cu un consilier local.

Consecințele, pe fiecare parte:

**Pentru cetățean.** Nu știe dacă sesizarea lui a ajuns undeva, cine o are, dacă cineva lucrează la ea și dacă s-a rezolvat. Absența unui răspuns este indistinguibilă de absența unei înregistrări. Rezultatul practic este că **nu mai raportează** — nu pentru că problema a dispărut, ci pentru că raportarea nu a produs nimic observabil.

**Pentru primărie.** Sesizările sosesc pe canale eterogene, nu sunt agregate, nu au un proprietar clar și nu au un istoric. Aceeași groapă poate fi raportată de cinci oameni pe cinci canale, iar primăria nu poate ști că este aceeași groapă. Nu există o listă care să răspundă la întrebarea „ce avem de făcut azi și cine o face".

**Pentru conducere.** Nu există niciun număr credibil. Întrebări elementare — „câte sesizări am primit luna trecută", „cât durează, în medie, de la primire la preluare", „ce categorie de probleme domină" — nu au răspuns care să poată fi verificat de altcineva.

Problema pe care o rezolvăm nu este „lipsa unui formular". Este **lipsa unei urme comune, verificabile, între cetățean și primărie, de la momentul semnalării până la momentul închiderii**.

## 2. Rezultatul dorit

1. Un cetățean poate semnala o problemă din spațiul public **de pe telefon, din teren, în câteva minute**, cu fotografie, categorie, descriere și punct pe hartă.
2. Cetățeanul poate vedea, în orice moment, **în ce stare se află sesizarea lui** și ce s-a întâmplat cu ea, fără să sune pe nimeni.
3. Personalul primăriei are **o singură listă** cu toate sesizările tenantului său, filtrabilă, în care fiecare sesizare are un status și — după triaj — un responsabil.
4. Fiecare schimbare de status este **atribuită unei persoane și unui moment**, și rămâne în istoric permanent.
5. Conducerea poate citi indicatori **derivați din istoricul imuabil al tranzițiilor**, nu din starea curentă, deci nemanipulabili prin editarea statusului ([FUP-9, ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md)).

Ce **nu** promite acest brief: că problemele se rezolvă mai repede. Produsul face vizibil ce se întâmplă; nu asfaltează gropi. Orice afirmație de tipul „primăria devine mai eficientă" este o **ipoteză de măsurat** (secțiunea 17), nu un rezultat livrat.

## 3. Utilizatori și roluri

Rolurile sunt cele patru din [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md) și **nu se redeschid aici**. Acest brief descrie doar ce fac ele în fluxul de sesizări.

| Rol | Utilizator | Ce face în acest flux |
|---|---|---|
| `citizen` | Cetățeanul (utilizator **primar**) | Creează sesizări. Vede **exclusiv** sesizările proprii și istoricul lor. |
| `staff` | Funcționarul primăriei (utilizator **operațional**) | Vede toate sesizările tenantului. Triază, atribuie, schimbă statusul, atașează dovada „după", exportă. |
| `leadership` | Primarul, viceprimarul, secretarul general | **Citește** sesizările tenantului și indicatorii. **Nu** atribuie, **nu** schimbă statusul. |
| `tenant_admin` | Administratorul primăriei | Tot ce poate `staff`, plus administrarea conturilor. Nu are un rol distinct în fluxul de sesizări. |

**Consecința rolurilor cumulative, tratată explicit.** Un `staff` este și cetățean ([ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md), D5). Când funcționarul Maria raportează groapa din fața casei ei, sesizarea rezultată este **o sesizare de cetățean obișnuită**: apare în inbox ca oricare alta, fără marcaj de prioritate, fără tratament special, fără a fi ascunsă de colegi.

**Auto-procesarea — ce facem și ce NU facem.** Dacă Maria schimbă ulterior statusul propriei sesizări, sistemul **înregistrează** faptul (`actor_user_id` = `author_user_id` în urma de audit) și **nu îl blochează**. Blocarea tehnică este o **decizie de produs neluată** — [OQ-013](../../project/open-questions.md), risc [R-006](../../project/risk-register.md). Acest brief **nu o presupune și nu o inventează**. Cerința care decurge de aici este de vizibilitate, nu de interdicție: vezi FR-016.

## 4. Context de utilizare

**Cetățeanul** este **în teren, în picioare, pe telefon**, adesea cu o singură mână liberă, uneori pe semnal mobil slab sau intermitent ([ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md), D6). Fotografiază lucrul pe care îl vede, acolo unde îl vede. Nu are răbdare pentru un formular lung, nu are chef să scrie mult și nu va reveni acasă ca să termine. Poate avea experiență digitală limitată.

**Funcționarul** este la birou, pe desktop, într-o primărie mică (3–10 angajați, fără departament IT). Deschide lista o dată sau de câteva ori pe zi. Are alte sarcini. Nu a fost instruit pe acest produs și nu va fi. Fluxul trebuie să fie evident fără manual ([ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md), D4; risc [R-004](../../project/risk-register.md)).

**Conducerea** deschide dashboard-ul rar — înainte de o ședință, la final de lună. Vrea numere pe care le poate rosti public fără să fie contrazisă.

## 5. Scop inclus

**Cetățean**
- Creare sesizare cu: **fotografie**, **categorie**, **descriere**, **punct pe hartă**.
- Categorii Phase 1, set închis: **groapă**, **iluminat**, **gunoi**, **câini**, **apă**.
- Listă cu sesizările proprii și statusul fiecăreia.
- Detaliul unei sesizări proprii, cu istoricul stărilor prin care a trecut.
- Vizualizarea fotografiei „după", **atunci când primăria o furnizează** (nu este obligatorie).

**Primărie (`staff` / `tenant_admin`)**
- Inbox cu toate sesizările tenantului, cu filtre.
- Atribuire către o persoană responsabilă sau către un departament.
- Schimbare de status pe fluxul `primit → în lucru → rezolvat`, cu istoric complet.
- Adăugarea unei fotografii „după" la rezolvare (opțională).
- Export al listei filtrate în **PDF** și **spreadsheet**.

**Conducere (`leadership`)**
- Citirea sesizărilor tenantului.
- Indicatori operaționali, calculați **exclusiv** din istoricul tranzițiilor.

## 6. În afara scopului

Fiecare element de mai jos este exclus **deliberat**, cu motiv.

| Exclus | Motiv |
|---|---|
| Flux de **urgență** / prioritate ridicată (inclusiv pentru câini periculoși) | **Nu este aprobat în Phase 1** și nu îl inventăm. Întrebare deschisă reală — vezi Î5, secțiunea 18. |
| **Deduplicare automată** a sesizărilor apropiate | Problema este reală (secțiunea 10, E4), soluția **nu este evidentă**. Nu presupunem una. Vezi Î4. |
| **Comentarii** / dialog cetățean ↔ funcționar pe sesizare | Nu este în scopul aprobat. Ar transforma sesizarea într-un canal de corespondență, cu implicații de registratură necunoscute (B1). |
| **Vot / susținere** („și eu am aceeași problemă") | Nu este aprobat. Ar apropia produsul de un instrument de mobilizare — `CLAUDE.md` interzice funcționalitatea de persuasiune politică. |
| **Hartă publică** cu toate sesizările | Expune date personale ale altor cetățeni ([ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md), D3). Nu este aprobată. |
| **Notificări push** pe schimbarea de status | Push-ul există în scopul Phase 1 pentru **anunțuri**. Legarea lui de sesizări nu este specificată aici; se tratează în brief-ul de notificări. |
| **Ștergerea** unei sesizări de către cetățean | Ștergerea fizică nu există ([ADR-0002](../../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md)); anularea logică de către autor nu este în scopul aprobat. Vezi Î8. |
| **Reguli de rutare pe compartimente** (Urbanism vede doar Urbanism) | Orice `staff` vede toate sesizările tenantului — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md). Schimbarea este model nou, nu setare — [OQ-011](../../project/open-questions.md). |
| **Formulele** indicatorilor | Aparțin FUP-9, nu acestui brief. Vezi secțiunea 13. |
| **Cereri online cu documente**, anunțuri, informații municipale | Sunt Phase 1, dar **alte funcționalități**, cu brief propriu. |

## 7. Flux principal

**A. Cetățeanul depune o sesizare**

1. Deschide aplicația, autentificat, pe subdomeniul primăriei sale.
2. Apasă acțiunea primară — **una singură, vizibilă fără scroll**: „Trimite o sesizare".
3. Face fotografia (sau alege una din galerie).
4. Alege categoria dintr-o listă de **cinci**.
5. Confirmă locul pe hartă. Aplicația **propune** un punct din locația dispozitivului; cetățeanul îl poate muta.
6. Scrie o descriere scurtă.
7. Trimite.
8. Primește o confirmare pe ecran, cu un identificator al sesizării, și sesizarea apare imediat în lista lui, cu statusul **`primit`**.

**B. Primăria triază**

9. Sesizarea apare în inbox cu statusul `primit`.
10. Un `staff` o deschide, o atribuie unei persoane sau unui departament și schimbă statusul în **`în lucru`**.
11. Tranziția se scrie în istoric: din ce status, în ce status, cine, când.

**C. Rezolvare**

12. Când problema este remediată, un `staff` schimbă statusul în **`rezolvat`** și poate atașa o fotografie „după".
13. Tranziția se scrie în istoric.
14. Cetățeanul vede, în lista lui, statusul `rezolvat`, istoricul și — dacă există — fotografia „după".

**D. Conducerea**

15. `leadership` citește indicatori recalculați din istoricul tranzițiilor.

**Ce NU face fluxul de mai sus** — și trebuie spus: nu produce **niciun număr de înregistrare oficial**, **niciun răspuns formal** și **niciun termen**. Dacă primăria este obligată la vreunul dintre acestea, **fluxul de mai sus este incomplet**. Vezi B1.

## 8. Cerințe funcționale

### Depunere (cetățean)

- **FR-001** — Un `citizen` autentificat poate crea o sesizare cu exact aceste câmpuri: fotografie, categorie, descriere, punct pe hartă.
- **FR-002** — Câmpuri **obligatorii**: categorie, punct pe hartă, descriere. Fotografia este obligatorie sau opțională — **nedecis**, vezi Î7. Până la decizie, brief-ul **nu impune** obligativitatea ei.
- **FR-003** — Categoriile sunt un **set închis de cinci**: groapă, iluminat, gunoi, câini, apă. Câmp liber de categorie nu există.
- **FR-004** — Aplicația propune un punct pe hartă din locația dispozitivului, dacă utilizatorul acordă permisiunea. Utilizatorul **poate muta punctul** și poate depune o sesizare **fără** a acorda permisiunea de locație (mutând manual pinul).
- **FR-005** — **Sursa de adevăr a locului este pinul confirmat de utilizator**, nu coordonatele EXIF ale fotografiei și nu locația dispozitivului. Vezi E7.
- **FR-006** — Descrierea are o lungime maximă afișată utilizatorului **înainte** de a o depăși.
- **FR-007** — La depunerea reușită, sistemul afișează o confirmare care conține un identificator al sesizării, iar sesizarea apare imediat în lista autorului cu statusul `primit`.
- **FR-008** — Depunerea este **idempotentă la retrimitere**: o retrimitere a aceleiași sesizări (aceeași încercare, întreruptă și reluată) nu creează două sesizări. Vezi E6.

### Urmărire (cetățean)

- **FR-009** — Un `citizen` vede lista **exclusiv** a sesizărilor al căror autor este el. Aplicarea este în planul de date, nu în UI ([ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md)).
- **FR-010** — Detaliul unei sesizări proprii afișează statusul curent și **istoricul complet** al tranzițiilor (din ce status, în ce status, când). **Dacă istoricul afișează cetățeanului și numele funcționarului — nedecis. Vezi Î9.**
- **FR-011** — Dacă primăria a atașat o fotografie „după", cetățeanul autor o vede în detaliul sesizării lui.

### Inbox și procesare (`staff`, `tenant_admin`)

- **FR-012** — Un `staff` vede **toate** sesizările tenantului său, într-o listă unică.
- **FR-013** — Lista se poate filtra cel puțin după: **status**, **categorie**, **responsabil atribuit** (inclusiv „neatribuit") și **interval de timp al depunerii**.
- **FR-014** — Un `staff` poate atribui o sesizare unei persoane sau unui departament, și poate **reatribui**. Fiecare atribuire este înregistrată cu autor și moment.
- **FR-015** — Un `staff` poate schimba statusul pe tranzițiile permise (FR-018). `leadership` și `citizen` **nu pot**.
- **FR-016** — Când autorul unei sesizări este o persoană cu rol elevat în același tenant, sesizarea apare în inbox **ca orice sesizare de cetățean**: fără prioritate, fără marcaj, fără ascundere. Când **actorul unei schimbări de status este chiar autorul sesizării**, faptul este **vizibil în istoricul sesizării** — nu blocat ([OQ-013](../../project/open-questions.md), [R-006](../../project/risk-register.md)).
- **FR-017** — Un `staff` poate atașa o fotografie „după" la o sesizare. **Nu este obligatorie** pentru trecerea în `rezolvat`.

### Status și istoric

- **FR-018** — Stările sunt exact trei: `primit`, `în lucru`, `rezolvat`. Tranziții permise: `primit → în lucru`, `în lucru → rezolvat`. **Dacă redeschiderea (`rezolvat → în lucru`) este permisă — nedecis. Vezi Î6.**
- **FR-019** — Fiecare schimbare de status produce un rând **nou** în istoric (`din status`, `în status`, actor, moment). Istoricul este **append-only**: rândurile nu se modifică și nu se șterg ([FUP-9, ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md)).
- **FR-020** — O corecție a unui status greșit se face printr-o **tranziție compensatorie înainte**, înregistrată ca atare. **Nu se rescrie și nu se șterge nimic din istoric.**
- **FR-021** — Statusul curent este o **proiecție** a istoricului. Nu este sursa de adevăr pentru niciun indicator.

### Izolare și acces

- **FR-022** — Fiecare sesizare aparține **exact unui tenant** ([ADR-0002](../../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md)). Nu există sesizare fără tenant și nu există sesizare partajată între tenanți.
- **FR-023** — Autorul unei sesizări **nu poate fi falsificat** de client la depunere.
- **FR-024** — Fotografiile și fișierele unei sesizări respectă aceeași frontieră de tenant și aceeași regulă de proprietate ca sesizarea. Livrarea lor este controlată, nu printr-un URL public ghicibil. **Vizibilitatea exactă a fotografiei este nedecisă — vezi B2.**

### Export

- **FR-025** — Un `staff` poate exporta lista **așa cum este filtrată pe ecran**, în PDF și în format de foaie de calcul.
- **FR-026** — Un export conține **exclusiv** date ale tenantului actorului. Frontiera de tenant se aplică la generarea exportului, nu prin filtrarea din UI.
- **FR-027** — Exportul înregistrează în audit **cine** a exportat, **când** și **cu ce filtre** (un export este o extragere de date personale în afara sistemului).

## 9. Criterii de acceptare

Fiecare criteriu este observabil și verificabil. Fără „ușor", „rapid", „transparent" fără metodă de măsurare (`.claude/rules/product-scope.md`).

**Depunere**

- **AC-001** — Un `citizen` autentificat depune o sesizare validă (categorie + pin + descriere) și, **imediat după confirmare**, aceeași sesizare apare în lista lui cu statusul `primit`. Verificare: reîncărcare completă a paginii; sesizarea persistă.
- **AC-002** — La depunerea unei sesizări fără categorie **sau** fără pin **sau** fără descriere, sistemul refuză și afișează, **lângă fiecare câmp lipsă**, un mesaj în limba română care spune ce lipsește. Nu se creează nicio sesizare.
- **AC-003** — Formularul oferă **exact cinci** categorii. Un client care trimite o a șasea valoare de categorie primește refuz **de la server**, nu doar din UI.
- **AC-004** — Un utilizator care **refuză** permisiunea de locație poate totuși depune o sesizare, plasând manual pinul. Verificare: cu permisiunea refuzată la nivel de browser, fluxul se finalizează cu succes.
- **AC-005** — Când fotografia conține coordonate EXIF **diferite** de pinul confirmat, sesizarea salvată poartă **coordonatele pinului**. Verificare: se compară coordonatele stocate cu pinul, nu cu EXIF.

**Urmărire și izolare**

- **AC-006** — Cetățeanul A **nu poate citi** sesizarea cetățeanului B din același tenant, **nici prin UI, nici printr-o interogare directă cu cheia publică a clientului**. Verificare: test automat de acces, nu inspecție vizuală.
- **AC-007** — Un utilizator autentificat în tenantul X **nu obține niciun rând** al tenantului Y, nici măcar accesând subdomeniul lui Y.
- **AC-008** — Un `citizen` care încearcă să schimbe statusul propriei sesizări **nu reușește**. Verificare: după încercare, statusul stocat este neschimbat **și** nu există niciun rând nou în istoric. *(Atenție operațională: o respingere în planul de date se poate manifesta ca răspuns „reușit" cu zero rânduri afectate. Criteriul se verifică pe **starea stocată**, nu pe codul de răspuns.)*
- **AC-009** — Un `leadership` care încearcă să schimbe statusul sau să atribuie o sesizare **nu reușește**, verificat pe starea stocată, ca la AC-008.

**Istoric**

- **AC-010** — După secvența `primit → în lucru → rezolvat`, istoricul sesizării conține **exact două** rânduri, în ordine, fiecare cu actor și moment.
- **AC-011** — Un rând de istoric **nu poate fi modificat sau șters** de niciun rol al aplicației. Verificare: tentativa eșuează; rândul rămâne identic.
- **AC-012** — O sesizare marcată greșit `rezolvat` și corectată produce **un rând nou** de istoric. Numărul total de rânduri **crește**; niciun rând anterior nu se schimbă.
- **AC-013** — Un indicator de durată calculat pentru o sesizare corectată **nu scade** ca urmare a corecției: durata deja acumulată rămâne în calcul ([FUP-9, ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md)).

**Inbox și procesare**

- **AC-014** — Inboxul unui `staff` conține **toate** sesizările tenantului său și **niciuna** din alt tenant. Verificare: numărul de rânduri afișate este egal cu numărul de sesizări ale tenantului în baza de date.
- **AC-015** — Fiecare filtru din FR-013 poate fi aplicat singur și în combinație, iar rezultatul afișat coincide cu rezultatul așteptat pe un set de date de test cunoscut.
- **AC-016** — O sesizare depusă de un utilizator cu rol `staff` apare în inbox **fără niciun marcaj vizual de prioritate** și **nu este mutată** în ordinea listei față de o sesizare identică depusă de un `citizen`.
- **AC-017** — Când actorul unei schimbări de status **este** autorul sesizării, istoricul afișat în ecranul de administrare **arată acest fapt explicit**. Verificare: fapt vizibil în interfață, nu doar prezent în baza de date.

**Export**

- **AC-018** — Exportul PDF și cel de foaie de calcul, generate din același ecran cu aceleași filtre, conțin **același număr de sesizări** și **aceleași sesizări** ca lista afișată.
- **AC-019** — Un export generat de un `staff` al tenantului X nu conține **niciun rând** al tenantului Y, chiar dacă cererea de export este modificată de client.
- **AC-020** — Fiecare export produce **un rând de audit** cu actorul, momentul și filtrele aplicate.

## 10. Cazuri-limită și comportamente negative

- **E1 — Pin în afara UAT-ului primăriei.** Cetățeanul plasează pinul pe un drum județean, într-o comună vecină sau, accidental, în alt județ. **Comportament nedecis.** Opțiuni reale: (a) refuz cu explicație, (b) avertisment + permitere, (c) acceptare tăcută și triaj uman. Alegerea depinde de faptul dacă primăria are o **obligație** de a răspunde ceva unei sesizări care nu îi aparține (B1). Produsul **nu poate decide singur**. Vezi Î1. *Presupunerea implicită „refuzăm" ar putea bloca sesizări legitime de la limita administrativă; presupunerea „acceptăm" umple inboxul cu lucruri pe care primăria nu le poate rezolva.*
- **E2 — Sesizări duplicate.** Aceeași groapă, cinci cetățeni, cinci sesizări. Toate cinci sunt **sesizări valide, ale unor autori diferiți**. Nu putem fuziona rândurile fără a decide ce se întâmplă cu cei patru autori a căror sesizare „dispare" — și fiecare are dreptul la propriul istoric. **Problema este numită; soluția nu este presupusă.** Vezi Î4.
- **E3 — Fotografie cu date personale.** Fotografia unei gropi prinde un trecător, un număr de înmatriculare, fereastra sau curtea cuiva. **Nu există o soluție automată sigură** în Phase 1 (anonimizarea automată nu este aprobată și nu este fiabilă). Consecința: **vizibilitatea fotografiei devine decizia care contează** — B2.
- **E4 — Sesizarea conține numele și adresa unui cetățean.** Descrierea sau fotografia identifică o persoană. Un vecin **nu are dreptul** să o citească ([ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md), D3). Consecință dură și acceptată: **nu putem avea o hartă publică a sesizărilor** fără o decizie explicită de vizibilitate (B2). Am exclus-o din scop.
- **E5 — Fotografie fără GPS.** Poza importată din galerie, sau cu EXIF eliminat de sistemul de operare. **Comportament: normal, nu eroare.** Locul este dat de pin (FR-005); absența EXIF nu blochează nimic.
- **E6 — Trimitere întreruptă în teren (semnal slab).** Cetățeanul apasă „Trimite" și pierde semnalul la jumătatea încărcării fotografiei. Comportamente **inacceptabile**: pierderea tăcută a sesizării; două sesizări identice la reluare; un ecran blocat fără explicație. Comportament **cerut**: starea trimiterii este vizibilă, reluarea nu duplică (FR-008), iar dacă trimiterea eșuează definitiv, utilizatorul primește un mesaj clar și **datele introduse nu se pierd**. *Mecanismul concret (retry, coadă locală, service worker) este decizie de arhitectură, nu de produs.*
- **E7 — GPS diferit de pin.** EXIF spune un lucru, pinul altul. **Sursa de adevăr este pinul** (FR-005). Motiv: fotografia poate fi făcută de la distanță, printr-un geam de mașină, sau poate fi mai veche. Pinul este singura declarație explicită a utilizatorului.
- **E8 — Categoria „câini" și pericolul imediat.** O haită agresivă lângă o școală **nu este** același lucru cu o groapă. Fluxul de urgență **nu este aprobat în Phase 1 și nu îl inventăm**. Riscul asumat, spus deschis: un cetățean poate crede că a alertat primăria despre un pericol iminent, când de fapt a depus o sesizare care va fi văzută la următorul triaj. **Dacă acest lucru este inacceptabil, este o schimbare de scop, nu un detaliu de UI.** Vezi Î5. *Mitigare minimă posibilă, de validat: un text explicit în formular care spune că pentru pericol imediat se sună la numărul de urgență — dar acest text nu poate fi scris fără validare de domeniu.*
- **E9 — Sesizare fără fotografie.** Depinde de Î7. Dacă fotografia devine obligatorie, un cetățean care raportează un bec stins **noaptea** (fotografie inutilizabilă) este blocat.
- **E10 — Autorul își pierde rolul / pleacă din primărie.** Un `staff` cu sesizări proprii și cu tranziții făcute de el își pierde rolul elevat. Sesizările lui **rămân ale lui** (rămâne cetățean), iar tranzițiile pe care le-a făcut **rămân în istoric cu numele lui**. Istoricul nu se rescrie.
- **E11 — Fișier care nu este fotografie.** Utilizatorul încarcă un PDF, un fișier executabil sau o fotografie de 40 MB. Tipul, dimensiunea și proprietatea fișierului se validează **pe server** (`.claude/rules/security.md`), cu mesaj de eroare clar și fără detalii interne.
- **E12 — Sesizare cu descriere abuzivă sau conținut nepotrivit.** Nu există moderare în Phase 1. Problema există; **nu inventăm un flux de moderare neaprobat**. De numit ca risc, nu de rezolvat aici.
- **E13 — Statusul se schimbă de două ori simultan** (doi funcționari, aceeași sesizare, în același moment). Rezultatul trebuie să fie **determinist**: o singură tranziție reușește, cealaltă este respinsă cu un mesaj clar; nu se produc două rânduri de istoric contradictorii.
- **E14 — Inbox gol** (primărie nouă, prima zi). Ecranul spune ce urmează să apară acolo, nu afișează o listă goală fără explicație.
- **E15 — Export pe o listă filtrată la zero rezultate.** Exportul reușește și produce un document valid, gol, cu filtrele scrise în antet — nu o eroare.

## 11. Date implicate

Categoriile de date, nu schema (schema aparține specificației tehnice).

| Categorie | Conținut | Sensibilitate |
|---|---|---|
| Identitatea autorului | Legătura sesizare → cont | **Date personale.** Necesară: fără ea, cetățeanul nu își poate urmări sesizarea și nu îl putem proteja de vecin. |
| Descrierea | Text liber | **Poate conține date personale ale unor terți** (nume, adrese). Nu le putem preveni. |
| Fotografia „înainte" | Imagine din teren | **Poate conține date personale ale unor terți** — chipuri, numere de înmatriculare, interiorul unei proprietăți (E3). |
| Fotografia „după" | Imagine făcută de primărie | Aceleași riscuri, sursă diferită. |
| Locația (pin) | Coordonate | **Cvasi-identificatoare.** Un pin în fața unei case indică, practic, o gospodărie. |
| Metadate EXIF ale fotografiei | Coordonate, model de telefon, moment | **Nu sunt sursa de adevăr** (FR-005). **Dacă se păstrează sau se elimină — nedecis.** Vezi Î10. |
| Categoria, statusul, istoricul tranzițiilor | Date operaționale | Nu sunt personale în sine, dar **actorul** fiecărei tranziții este o persoană. |
| Atribuirea | Persoană sau departament responsabil | Date despre angajați. |
| Urma de audit | Actor, rol, calitate (`acting_as`), moment | Sensibilă; **nu se suprascrie**. |
| Exporturile | Extrageri de date în afara sistemului | **Cea mai riscantă suprafață**: un fișier exportat scapă de sub controlul aplicației. De aici FR-027. |

**Nedecis, marcat explicit:**

- **Vizibilitatea fotografiei** (publică? doar primărie + autor? doar autor?) — **B2**.
- **Retenția** sesizărilor, fotografiilor, istoricului și log-urilor — **nestabilită**, [OQ-007](../../project/open-questions.md). **Nu se inventează** (`.claude/rules/security.md`).
- **Comportamentul la ștergerea contului**: ce se întâmplă cu sesizările unui cetățean care își cere ștergerea? Istoricul este audit-relevant și nu se suprascrie — dar sesizarea poartă date personale. Tensiunea este reală și **nerezolvată**. Vezi Î11.

## 12. Accesibilitate și limbaj

- Toată interfața pentru cetățean este în **română corectă, cu diacritice**, în limbaj **neutru și neadministrativ**. Nu „a se completa în mod obligatoriu câmpul aferent"; ci „Spune-ne ce ai văzut".
- Denumirile stărilor sunt **cele pe care le vede cetățeanul**: `primit`, `în lucru`, `rezolvat`. Nu expunem identificatorii tehnici.
- Acțiunea primară de pe ecranul cetățeanului este **una singură** și este vizibilă fără scroll, pe un ecran de telefon.
- Formularul se poate parcurge **cu tastatura**, are etichete asociate câmpurilor și mesaje de eroare **legate de câmpul care le-a produs**, nu un bloc generic în capul paginii.
- Fotografia încărcată are **text alternativ**; harta are o **alternativă non-vizuală** pentru confirmarea locului (de exemplu adresa rezultată, citibilă de un cititor de ecran). *Măsura exactă a alternativei la hartă este o problemă de design nerezolvată — o numim, nu o ascundem.*
- Ținta de accesibilitate (nivelul de conformitate) **nu este fixată în acest brief**. Este cerință non-funcțională; aparține specificației tehnice.
- **Explicăm de ce cerem locația.** Un cetățean care este întrebat unde se află are dreptul să știe motivul (`.claude/rules/product-scope.md`).

## 13. Metrici de succes

Se împart în două: ce vrea **conducerea** (indicatori de produs, livrați în dashboard) și ce urmărim **noi** (indicatori de adopție).

**Indicatorii ceruți de conducere** — enumerați aici, **formulele NU se definesc în acest brief**. Ele aparțin **[FUP-9](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md)**, care trebuie să stabilească pentru fiecare: formula, unitatea, fereastra de timp, tratarea sesizărilor redeschise, a celor fără tranziție finală, a celor create înainte de definiție, și frontiera de tenant a agregării.

| # | Ce vrea conducerea să știe | Sursa obligatorie |
|---|---|---|
| M1 | Câte sesizări au fost primite într-un interval | Istoricul tranzițiilor |
| M2 | Distribuția pe categorii | Sesizări + istoric |
| M3 | Cât durează de la depunere până la **prima preluare** (`primit → în lucru`) | **Diferență de timestamp-uri de tranziție** |
| M4 | Cât durează de la depunere până la **rezolvare** | **Diferență de timestamp-uri de tranziție** |
| M5 | Câte sesizări sunt **deschise acum** și de cât timp | Istoricul tranzițiilor |
| M6 | Câte sunt **neatribuite** | Atribuiri + istoric |

**Regula care nu se negociază** ([FUP-9, ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md)): **niciun indicator nu se calculează din câmpul de status curent.** Toți se derivă din istoricul imuabil. Consecința intenționată: un indicator **nu poate fi ameliorat** prin editarea statusului unei sesizări.

**Indicatori de adopție (ai noștri, nu ai primăriei)** — **TBD ca praguri**, definiți ca metodă:

- **A1** — Rata de finalizare a formularului: sesizări trimise cu succes / formulare începute. Prag: **TBD**, se stabilește pe date reale din pilot, nu prin presupunere.
- **A2** — Rata de eșec al trimiterii în teren (E6): trimiteri eșuate definitiv / trimiteri inițiate. Prag: **TBD**.
- **A3** — Procentul de sesizări care primesc o primă preluare (nu rămân la `primit`). **Măsoară dacă primăria folosește efectiv produsul**, nu dacă cetățenii îl folosesc. Prag: **TBD**.

**Ce NU măsurăm și nu vom afișa:** nimic care poate fi citit ca performanță politică a unei persoane. Dashboard-ul nu este un instrument de campanie (`CLAUDE.md`).

## 14. Dependențe

| # | Dependență | Stare |
|---|---|---|
| DEP-1 | Model de tenancy și rezolvarea tenantului — [ADR-0002](../../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md) | Există. Nu se relitighează. |
| DEP-2 | Model de autentificare și roluri — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md) | Există. Nu se relitighează. |
| DEP-3 | Baseline tehnologic — [ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md) | Există. |
| DEP-4 | **FUP-9 — definiția matematică a indicatorilor** | **Nu există.** Blochează livrarea dashboard-ului (M1–M6), **nu** blochează depunerea și procesarea sesizărilor. |
| DEP-5 | **Răspunsul de domeniu la [OQ-003](../../project/open-questions.md)** (registratură) | **Nu există.** Vezi B1. |
| DEP-6 | **Retenția datelor — [OQ-007](../../project/open-questions.md)** | **Nu există.** Vezi B3. |
| DEP-7 | **Decizia de produs asupra auto-procesării — [OQ-013](../../project/open-questions.md)** | **Nu există.** Nu blochează livrarea: comportamentul implicit (înregistrare, nu blocare) este deja fixat de [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md). |
| DEP-8 | **Compartimentele primăriei pilot — [OQ-011](../../project/open-questions.md)** | **Nu există.** Dacă răspunsul este „da, trebuie separate", **inboxul din acest brief se schimbă structural**. |
| DEP-9 | Furnizarea listei de departamente / persoane responsabile ale primăriei pilot | Necesară pentru FR-014. Sursa: reprezentantul primăriei. |
| DEP-10 | Sursa datelor de hartă și limitele UAT-ului | Necesară pentru E1. Decizie tehnică, dar cu **precondiție de produs**: știm ce e „înăuntru"? |

## 15. Riscuri

Registrul de riscuri este în [`docs/project/risk-register.md`](../../project/risk-register.md). **Nu recopiem aici severitatea și statusul** (`.claude/rules/architecture.md`).

**Riscuri existente pe care această funcționalitate le atinge direct:**

- **[R-003](../../project/risk-register.md) — proceduri municipale presupuse greșit.** Acesta este **riscul dominant al acestei funcționalități**. Dacă „sesizarea" este de fapt o **petiție** în sens legal, întregul flux din secțiunea 7 este insuficient. Vezi B1.
- **[R-004](../../project/risk-register.md) — aplicație prea complicată pentru personalul local.** Inboxul, atribuirea și schimbarea de status sunt exact suprafața pe care acest risc se materializează.
- **[R-006](../../project/risk-register.md) — ambiguitatea de audit când funcționarul acționează ca cetățean.** FR-016 și AC-017 sunt răspunsul de produs; blocarea rămâne nedecisă ([OQ-013](../../project/open-questions.md)).
- **[R-002](../../project/risk-register.md) — izolare multi-tenant.** Această funcționalitate introduce **primele suprafețe netestate** menționate în nota de la R-002: **Storage** (fotografiile) și **export**. Consecință directă, care trebuie spusă: **frontiera de tenant pentru fișiere și pentru exporturi nu este demonstrată azi.** FR-024, FR-026 și AC-019 sunt cerințele care obligă la demonstrarea ei.
- **[R-001](../../project/risk-register.md) — extinderea necontrolată a Phase 1.** Presiunea concretă asupra acestui brief: flux de urgență, deduplicare, comentarii, hartă publică. Toate sunt în secțiunea 6, cu motiv.

**Riscuri specifice acestei funcționalități, care nu existau înainte:**

- **Fotografia ca vector de date personale ale terților** (E3). Nu îl putem elimina prin design; îl putem doar limita prin **vizibilitate** — care este nedecisă (B2).
- **Exportul ca scurgere de date.** Un fișier ieșit din sistem nu mai poate fi controlat. FR-027 face extragerea trasabilă; **nu o face reversibilă**.
- **Așteptare falsă de urgență** pe categoria „câini" (E8). Riscul este de siguranță a persoanei, nu de produs.
- **Duplicatele degradează inboxul** până când primăria încetează să îl mai deschidă (E2).

## 16. Fapte confirmate

Fiecare punct de mai jos este **decis** și are o sursă. **Nu se redeschid în acest brief.**

1. Sesizările cu fotografie, categorie, descriere și hartă, urmărirea `primit → în lucru → rezolvat` și dovada înainte/după sunt **în scopul aprobat al Phase 1** — `CLAUDE.md`.
2. Inboxul cu filtre, atribuirea, schimbarea de status cu istoric și exportul PDF/spreadsheet sunt **în scopul aprobat al Phase 1** — `CLAUDE.md`.
3. **Fiecare sesizare aparține exact unui tenant**, iar tenantul se rezolvă exclusiv dintr-un claim verificat din JWT — [ADR-0002](../../decisions/ADR-0002-tenancy-model-and-tenant-resolution.md).
4. **Un `citizen` citește doar sesizările proprii; `staff`, `leadership` și `tenant_admin` citesc toate sesizările tenantului lor** — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md).
5. **`leadership` nu procesează sesizări**: nu atribuie, nu schimbă statusul — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md).
6. **Rolurile sunt cumulative**: un funcționar poate raporta o groapă ca cetățean, din același cont — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md).
7. **Auto-procesarea este înregistrată, nu blocată** în Phase 1 — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md), „Consecințe negative", punctul 1.
8. **Istoricul tranzițiilor este append-only**; o corecție este o tranziție compensatorie înainte, niciodată o rescriere — [FUP-9, ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md).
9. **Indicatorii se calculează exclusiv din istoricul imuabil al tranzițiilor**, niciodată din câmpul de status curent — [FUP-9, ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md).
10. **Orice `staff` vede toate sesizările tenantului**; nu există segmentare pe compartimente în Phase 1 — [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md).
11. **Cetățeanul fotografiază în teren, uneori cu semnal slab** — [ADR-0001](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md), D6.
12. **Perioadele de retenție sunt nestabilite și nu se inventează** — [OQ-007](../../project/open-questions.md), `.claude/rules/security.md`.

## 17. Ipoteze

Marcate ca **ipoteze**, nu ca fapte. Fiecare are o metodă de infirmare.

- **IP-1** — Cetățeanul acceptă să se autentifice **înainte** de a depune o sesizare. *Riscul:* autentificarea obligatorie este cea mai mare barieră de adopție posibilă, iar sesizarea anonimă nu este în scopul aprobat. *Cum aflăm:* rata de abandon la înregistrare, în pilot. **Dacă ipoteza cade, este o schimbare de scop, nu o ajustare de UI.**
- **IP-2** — Cele cinci categorii acoperă majoritatea sesizărilor reale. *Cum aflăm:* proporția de sesizări puse în categoria „greșită" sau cu descrieri care contrazic categoria, în pilot.
- **IP-3** — Trei stări sunt suficiente pentru o primărie mică. *Cum aflăm:* dacă funcționarii cer, în pilot, stări intermediare („trimis la operatorul de apă", „în așteptare de buget"), ipoteza a căzut.
- **IP-4** — Personalul deschide inboxul cel puțin o dată pe zi. *Cum aflăm:* A3 din secțiunea 13. Dacă sesizările rămân la `primit`, produsul a eșuat operațional, indiferent câți cetățeni îl folosesc.
- **IP-5** — Fotografia „după" este furnizată suficient de des încât să fie credibilă ca dovadă. *Cum aflăm:* proporția sesizărilor `rezolvat` care au fotografie „după".
- **IP-6** — Filtrele din FR-013 corespund muncii zilnice reale a funcționarului. *Cum aflăm:* observație directă în pilot. **Neverificat azi** — filtrele au fost derivate din scop, nu din observație.
- **IP-7** — Volumul de duplicate rămâne suportabil manual în primăria pilot. *Dacă este fals*, E2 devine blocant, nu inconvenient.

## 18. Întrebări deschise

### Blocante

**B1 — Ce este primăria OBLIGATĂ să facă atunci când primește o sesizare?**
*Cine răspunde:* **reprezentantul primăriei** + **`eg-public-sector-domain-expert`**. *Legat de:* [OQ-003](../../project/open-questions.md), [R-003](../../project/risk-register.md).

Aceasta este **cea mai importantă întrebare din brief** și nu poate fi răspunsă de produs. Sub-întrebări, fiecare cu efect direct asupra scopului:

- **Este „sesizarea" din acest brief o comunicare informală, sau intră în categoria unei petiții formale?** Distincția nu este semantică — ea determină dacă fluxul din secțiunea 7 este suficient sau nu. **Nu știm în ce categorie cade și nu ghicim.**
- **Există un termen legal de răspuns?** **Nu scriem niciun număr de zile în acest brief.** Dacă un termen există, produsul trebuie să îl **calculeze, să îl afișeze și să alerteze la depășire** — funcționalitate care **nu este în scopul de față**.
- **Trebuie sesizarea înregistrată în registratura primăriei și trebuie să primească un număr de înregistrare oficial?** Dacă da, identificatorul din FR-007 **nu este suficient** și apare o dependență de un sistem de registratură pe care nu am specificat-o.
- **Trebuie primăria să emită un răspuns formal, scris?** Dacă da, „status = `rezolvat`" **nu este** un răspuns, iar produsul îi lasă primăriei o obligație neîndeplinită.
- **Ce se schimbă dacă cetățeanul cere explicit un răspuns oficial?**

**Consecința pentru livrare:** dacă răspunsul la B1 este „da, sunt obligații formale", acest brief **subestimează scopul**, iar `Draft` este singurul status onest.

**B2 — Cine are voie să vadă fotografia și descrierea unei sesizări?**
*Cine răspunde:* **Product owner** + **reprezentantul primăriei** + **specialist privacy/juridic**. *Legat de:* [OQ-007](../../project/open-questions.md), [ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md) (D3).

Opțiunile sunt reale și se exclud: (a) **doar autorul + personalul primăriei** — cea mai sigură, dar elimină orice transparență publică; (b) **public** — utilă civic, dar expune chipuri, numere de înmatriculare și curți private (E3), iar cetățeanul-autor nu a consimțit la publicarea unei fotografii cu terți; (c) **public, dar fără fotografie**.
**Brief-ul presupune implicit (a) — cea mai restrictivă — și marchează acest lucru ca presupunere, nu ca decizie.** O alegere greșită aici nu este reparabilă retroactiv: o fotografie publicată nu se depublică.

**B3 — Cât timp păstrăm sesizările, fotografiile și istoricul?**
*Cine răspunde:* **Product owner** + **specialist privacy/juridic**. *Legat de:* [OQ-007](../../project/open-questions.md). **Nestabilit. Nu se inventează** (`.claude/rules/security.md`). Tensiunea de rezolvat: istoricul tranzițiilor este **audit-relevant și nu se suprascrie**, dar poartă date personale.

### Care schimbă scopul dacă răspunsul este „da"

- **Î1 — Ce se întâmplă cu un pin în afara UAT-ului?** (E1) *Cine răspunde:* reprezentantul primăriei + `eg-public-sector-domain-expert`. Depinde de B1: dacă primăria are o obligație de a răspunde chiar și la o sesizare care nu îi aparține teritorial, nu o putem refuza.
- **Î5 — Categoria „câini" implică un pericol imediat. Există sau nu un flux de urgență?** (E8) *Cine răspunde:* reprezentantul primăriei + `eg-public-sector-domain-expert`. **Nu inventăm un flux de urgență.** Dacă răspunsul este „da", este **schimbare de scop Phase 1**, nu o adăugare de câmp.
- **Î11 — Ce se întâmplă cu sesizările unui cetățean care își cere ștergerea contului?** *Cine răspunde:* Product owner + specialist privacy/juridic. Legat de B3.

### Decizii de produs, nerezolvate, care nu blochează începerea lucrului

- **Î2 — Se blochează tehnic auto-procesarea?** [OQ-013](../../project/open-questions.md), [R-006](../../project/risk-register.md). *Cine răspunde:* Product owner + reprezentantul primăriei. **Comportamentul implicit este deja fixat** ([ADR-0003](../../decisions/ADR-0003-authentication-and-role-model.md)): înregistrată, nu blocată. Brief-ul îl respectă.
- **Î3 — Are primăria pilot compartimente care trebuie separate în inbox?** [OQ-011](../../project/open-questions.md). *Cine răspunde:* reprezentantul primăriei. Dacă „da", **FR-012 se schimbă structural** și devine model nou, nu setare.
- **Î4 — Ce facem cu duplicatele?** (E2) *Cine răspunde:* Product owner + reprezentantul primăriei. Nu presupunem o soluție.
- **Î6 — Este permisă redeschiderea (`rezolvat → în lucru`)?** (FR-018) *Cine răspunde:* Product owner + reprezentantul primăriei. Nota tehnică: [FUP-9](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md) **presupune deja** că redeschiderile există și trebuie tratate în formule. Dacă produsul nu le permite, contradicția trebuie rezolvată explicit.
- **Î7 — Fotografia este obligatorie la depunere?** (FR-002, E9) *Cine răspunde:* Product owner. Argument contra obligativității: becul stins noaptea.
- **Î8 — Poate cetățeanul anula o sesizare depusă din greșeală?** *Cine răspunde:* Product owner. Ștergerea fizică nu există; anularea logică nu este în scopul aprobat.
- **Î9 — Vede cetățeanul numele funcționarului care i-a schimbat statusul?** (FR-010) *Cine răspunde:* Product owner + reprezentantul primăriei. Transparență vs. protecția angajatului.
- **Î10 — Se păstrează sau se elimină metadatele EXIF ale fotografiei?** *Cine răspunde:* Product owner + specialist privacy. Legat de B2 și B3.

## 19. Decizia de pregătire

- [x] **Pregătit pentru domain review** — brief-ul este complet ca **produs**; nu poate avansa mai departe fără răspunsuri de domeniu.
- [x] **Necesită clarificări** — **B1, B2, B3** sunt blocante. B1 poate **extinde scopul**.
- [ ] De amânat

**Recomandare:** trimite brief-ul la **`eg-public-sector-domain-expert`**, cu **B1 ca prioritate unică**. Toate celelalte întrebări sunt secundare față de aceasta: dacă „sesizarea" este o petiție formală, cu termen și cu număr de înregistrare, atunci acest brief descrie **o parte** din funcționalitatea necesară, nu toată.

**Ce poate avansa în paralel, fără să aștepte răspunsul la B1** (asumat conștient, cu risc de refacere):
- Depunerea, urmărirea și inboxul cu filtre — sunt necesare **indiferent** de răspunsul la B1.
- Modelul de istoric append-only — este deja fixat de [FUP-9](../../decisions/ADR-0001-phase-1-technology-and-deployment-baseline.md) și nu depinde de B1.

**Ce NU poate avansa:**
- Orice afirmație către cetățean despre **ce va face primăria și în cât timp**. Astăzi, nu o știm.
- Dashboard-ul de conducere — blocat de **FUP-9** (DEP-4).
- Publicarea fotografiilor sub orice formă — blocată de **B2**.
