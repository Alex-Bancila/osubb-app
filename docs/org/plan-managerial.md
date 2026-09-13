# Plan managerial — Coordonator IT 2026–2027

> Extras fidel (markdown) din PDF-ul `Plan managerial Coordonator IT Băncilă Alex.pdf` — documentul candidaturii, rămas sursa de viziune a mandatului. PDF-urile nu sunt versionate în git (vezi `.gitignore`). Extras la 2026-08-12. Trasabilitatea fiecărui mecanism către faza de implementare: vezi spec-ul de arhitectură (Revizia 3) și `docs/roadmap.md`.

**PLAN MANAGERIAL — ORGANIZAȚIA STUDENȚILOR DIN UNIVERSITATEA BABEȘ-BOLYAI**
**Băncilă Ionuț Alexandru, candidat pentru funcția de Coordonator IT 2026–2027**

## I. Scop

Digitalizarea proceselor administrative, publice și interne, gestionarea platformelor web și dezvoltarea instrumentelor digitale necesare activității organizației.

## II. Viziune

Viziunea mea pentru acest mandat constă în simplificarea și eficientizarea proceselor interne ale organizației și canalelor de comunicare aferente acestora. Prin viziunea mea, acest proces o să fie unul continuu, pe parcursul întregului mandat, care va introduce treptat noi funcționalități ca urmare a nevoilor și cerințelor legitime ale organizației.

## III. Obiective

- Implementarea unui proces de Task Tracking eficient
- Implementarea unui sistem de management al activităților și al taskurilor
- Implementarea unui sistem de clasificare a voluntarilor
- Susținerea departamentelor și proiectelor în realizarea proceselor interne
- Centralizarea tuturor proceselor de feedback în organizație
- Realizarea unei echipe de voluntari pregătiți pentru a realiza implementarea și mentenanța aplicațiilor și a site-urilor
- Asigurarea tuturor proceselor tehnice de implementare a aplicației

## IV. Mecanisme

### 1. Implementarea unui proces de Task Tracking eficient

#### a. Task Tracking BC/BCE

- Facilitarea transferului task-urilor deja realizate sau în curs de realizare în aplicația OSUBB. Procesul va consta în centralizarea tuturor task-urilor și migrarea acestora în baza de date;
- Acces restricționat pentru membrii BC și BCE;
- Implementarea unui proces simplu de introducere a taskurilor care necesită completarea titlului, deadline-ului, membrilor care participă și o descriere opțională. Acest proces poate fi realizat de către membrii BC, dar și de către membrii BCE;
- În momentul adăugării unui task, acesta este transferat în Google sau Outlook calendar pentru o organizare mai bună a acestora;
- Adăugarea unui task a cărui zi a deadline-ului se suprapune cu ziua altui task va rezulta într-un pop-up care te avertizează și te întreabă dacă vrei să modifici deadline-ul sau să continui cu suprapunerea taskurilor;
- În momentul apropierii deadline-ului și în ziua acestuia o notificare va fi trimisă;
- Membrii BC vor avea acces la exportarea task-urilor într-un raport. Acesta va include toate task-urile de la ultimul AGO și toate sancțiunile acumulate, atât ale membrilor BC, cât și ale membrilor BCE.

#### b. Task Tracking OSUBB

- Facilitarea transferului task-urilor deja realizate sau în curs de realizare în aplicația OSUBB. Procesul va consta în centralizarea tuturor task-urilor și migrarea acestora în baza de date;
- Task Trackerul tuturor membrilor va fi realizat ca cel de pe Google Sheets, dar se va putea filtra în funcție de rolul voluntarilor, departamentelor, și membrii pot fi ordonați în funcție de nume sau punctaj;
- Membrii pot cere acordarea de puncte pentru taskurile realizate către persoanele responsabile de taskul realizat;
- Membrii BC/BCE/Responsabili de proiect pot acorda puncte pentru taskurile realizate;
- Introducerea unui ghid de punctare, pentru a menține consecvența punctării taskurilor și pentru a evita confuzia generată de acest proces.

### 2. Implementarea unui sistem de management al activităților

- Membrii BC/BCE/Responsabili de proiect pot adăuga ședințe sau activități;
- În momentul adăugării unei activități, aceasta va fi transferată în calendarul integrat în aplicație, pentru evitarea suprapunerii activităților (în momentul în care vrei să adaugi un task care se suprapune, primești un pop-up care îți specifică activitatea cu care se suprapune și un buton „Schimbă intervalul/data" și „Suprapune activitatea"). Iar în momentul în care ai creat o activitate sau ți-ai asumat o activitate, aceasta se va adăuga în calendarul tău Google sau Outlook în funcție de ce alegi să conectezi;
- În urma adăugării unei activități, persoanele eligibile acesteia (în funcție dacă activitatea este destinată unui departament, proiect sau către toată organizația) vor primi o notificare, iar o altă notificare va fi trimisă în ziua activității;
- Toate taskurile pot fi modificate de responsabilii acestora (fie ziua/ora/locația, descrierea sau anularea acestuia), iar în momentul modificării o nouă notificare va fi trimisă;
- Ședințelor li se atribuie un QR care va fi generat pentru persoana care organizează ședința, pentru a putea fi scanat la final de către participanți. Astfel, punctele li se vor adăuga automat în Task Tracker;
- Ședințele și activitățile o să aibă un buton „Vin/Nu pot veni" pentru a avea un număr estimativ al persoanelor care vor fi la acestea;
- Doar în momentul în care ai selectat „Vin" și a început activitatea poți cere acordarea punctelor;
- Pentru a evita spam-ul de notificări, membrii BC și BCE vor primi notificări doar pentru taskurile lor specifice, nu pentru orice update de pe aplicație.

### 3. Implementarea unui sistem de clasificare a voluntarilor

- **Recrut:** Acces doar la evenimentele departamentului principal și la evenimentele deschise către toată organizația (ex: campaniile specifice fiecărui departament care includ toți membrii organizației; înscrierea la workshopuri, în proiecte și activități specifice oricărui proiect în care sunt voluntari). Totodată, primesc acces la vizualizarea calendarului de activități și, în plus, pot cere acordarea completării taskului realizat prin intermediul aplicației;
- **Voluntar:** Poate alege departamente secundare și își poate schimba departamentul principal;
- **Voluntar activ:** În urma atingerii pragului minim pentru a deveni membru activ, aceștia vor primi automat în aplicație rolul de membru activ și vor primi o notificare cu toate beneficiile pe care le dobândesc. Prin intermediul acestei notificări pot completa formularul de aderare, unde vor avea și link-uri către ROF și Statut pentru a putea acumula cunoștințele necesare despre organizație. În urma completării, membrii comisiei de aderare vor primi răspunsurile pentru a le corecta și pentru a putea programa interviul. Acest proces va avea loc strict prin intermediul aplicației;
- **Voluntar cu drept de vot:** Acces la postările tuturor informațiilor transmise pe canalele de comunicare ale Adunării Generale. Buton nou în profile page „Demisie AG", care duce la retragerea drepturilor dobândite de rol. În momentele în care se convoacă orice Adunare Generală poți propune un punct pe ordinea de zi, notificare care va fi trimisă către Secretarul General/BC;
- **BCE:** Posibilitatea de a pune puncte pe Task Tracker sau postarea de task-uri către voluntari. Posibilitatea stabilirii de ședințe și activități care vor fi trimise tuturor voluntarilor de pe departament sau, în funcție de tipul activității, către toți voluntarii OSUBB. În plus, aceștia au acces și la Task Trackerul BC, unde își pot adăuga taskurile lor pentru raport;
- **BC:** Acces complet asupra aplicației și Task Trackerului. Pot acorda sancțiuni, iar voluntarii respectivi vor primi notificare cu motivul și sancțiunea acordată;
- **Responsabil proiect:** Posibilitatea de a pune puncte pe Task Tracker sau postarea de task-uri către voluntari. Posibilitatea stabilirii de ședințe și activități care vor fi trimise tuturor voluntarilor de pe departament sau, în funcție de tipul activității, către toți voluntarii OSUBB;
- **Moderator:** Contul de moderator cu acces complet asupra aplicației pentru a putea supraveghea întreaga funcționalitate a acesteia și pentru mentenanță.

### 4. Susținerea departamentelor și proiectelor în realizarea proceselor interne

#### Departamente

**i. Resurse Umane:**

1. Asigurarea recrutărilor prin intermediul aplicației. În urma completării formularului de pe Google Forms, răspunsurile vor fi centralizate și adăugate în baza de date. Prin intermediul aplicației voluntarii au acces la toate datele participantului și pot asigura întregul proces de interviu: programarea pe baza unui calendar comun, grila de interviu care calculează automat nota finală, notificare către BC în urma feedbackului negativ și selectarea departamentului principal, la care va avea acces în urma quiz-ului;
2. Campania de contactări se va asigura prin baza de date a aplicației, iar în momentul în care cineva alege să nu mai facă parte din OSUBB i se va trimite automat un mic formular de feedback, pentru a avea un raport în baza răspunsurilor.

**ii. Educațional:**

1. Prin intermediul aplicației, fiecare update educațional (fie el protest, o revendicare sau o informație importantă de la Echipa de Monitorizare) va apărea în header-ul paginii și se va trimite o notificare cu aceasta către toți voluntarii organizației;
2. Mentenanța paginilor de Resurse Educaționale, a asistentului virtual TUDI și publicarea tuturor pozițiilor și demersurilor pe site-ul OSUBB.

**iii. IMG&PR:**

1. Planurile media vor fi adăugate în aplicație pentru a putea ține evidența voluntarilor și pentru a li se trimite notificări când se postează și când se apropie deadline-ul dacă au preluat un task;
2. Salvarea alumnilor și onorificilor în baza de date, pentru a putea ține evidența zilelor lor de naștere pentru postările de pe Facebook.

**iv. Tineret:**

1. Prin intermediul aplicației, fiecare update de pe departamentul Tineret va apărea în header-ul paginii și se va trimite o notificare cu aceasta către toți voluntarii organizației.

**v. Financiar:**

1. Integrarea formularului de 3.5% în perioada campaniei, pentru a putea fi completat de către voluntarii angajați.

#### Proiecte

1. Tot call-ul pentru proiecte și completarea formularului se va facilita prin intermediul aplicației. Toți membrii organizației au acces la acesta și primesc notificare când se apropie și când este aproape deadline-ul de completare. În urma completării, responsabilii decid cine este acceptat și aceștia primesc acces la toate activitățile și ședințele specifice proiectului;
2. Menținerea update-urilor constante ale site-urilor acestora. Îmi doresc să renunțăm la folosirea WordPress, făcând schimbarea către site-uri statice și hostate folosind GitHub Pages.

#### Overall

1. Centralizarea datelor pentru etapa de raportare istorică;
2. În formulare nu mai este nevoie de date personale, deja sunt pe aplicație; va rămâne doar partea de întrebări specifice proiectului/activității sau înscrierea directă la activitate. În funcție de tipul formularului, persoana care îl creează poate selecta „Activitate OSUBB", iar în momentul în care cineva se înscrie, acestora li se va adăuga și activitatea în Task Tracker.

### 5. Centralizarea tuturor proceselor de feedback în organizație

- Implementarea formularului de feedback permanent, care va conține atât secțiunea de feedback, cât și analiza de nevoi;
- Lansarea formularului de feedback semestrial;
- În momentul în care un eveniment este creat în aplicație, pentru a putea fi postat, acestuia trebuie să i se aloce un formular scurt de feedback care va fi trimis către voluntari în momentul în care evenimentul s-a terminat. Răspunsurile vor fi centralizate și trimise către responsabili.

### 6. Realizarea unei echipe de voluntari pregătiți pentru implementarea și mentenanța aplicațiilor și a site-urilor

- Împărțirea în două echipe a voluntarilor: echipa pentru aplicație și echipa pentru site-uri;
- Realizarea de traininguri pentru voluntari, facilitate atât de mine, cât și de alte persoane cu experiență tehnică din organizație (ex: Cum să folosești GitHub și ce înseamnă Version Control; Cum să folosești agenți AI; Ce este System Design-ul; Cum să înțelegi o diagramă UML);
- Fiecare nouă funcționalitate a aplicației o să fie împărțită în sprinturi și taskuri individuale. Între fiecare sprint o să existe o perioadă de aproximativ 3 zile în care voi analiza implementarea acestuia și realizarea taskurilor neîndeplinite, astfel următorul va putea începe fără blockere;
- Realizarea de ședințe constante pentru a putea prezenta întregul plan pentru implementarea aplicației și update-uri înaintea începerii fiecărui sprint. În plus, dacă este nevoie voi realiza și ședințe one-to-one în momentul în care un voluntar simte că are nevoie;
- Realizarea mentoratului, care va conține atât o parte tehnică, cât și o parte de Management, pentru a putea asigura implementarea următoarelor funcționalități, cât și gestionarea echipei.

### 7. Asigurarea tuturor proceselor tehnice de implementare a aplicației

- **Version control:** GitHub, unde mă voi asigura că toată arhitectura și modul de hostare al aplicației sunt specificate și codul urmează „Clean Code Principles", pentru înțelegerea întregii implementări de persoanele care lucrează și vor lucra în viitor la aceasta;
- **Hostarea:** consultarea cu Vicepreședintele Financiar, pentru a ajunge la cea mai eficientă metodă calitate-preț, dar și pentru a avea în vedere parteneriatele în curs de desfășurare (Microsoft, Amazon, JetBrains).

### 8. Diverse

- **Gamification:**
  1. Profile page: pe profile page îți vor apărea punctele din Task Tracker, clasamentul pe care te afli (X) și un mesaj „Ești la Z puncte de a ajunge pe locul X−1";
  2. Cupa departamentelor: pagină separată cu clasamentul departamentelor.
- **Contracte de voluntariat:**
  1. Integrarea procesului de trimitere a anunțului, completarea contractelor și centralizarea acestora prin intermediul aplicației.
