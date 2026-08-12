# Direcții și priorități IT [Coord. IT 2026–2027]

> Extras fidel (markdown) din PDF-ul `02. Direcţii şi priotităţi IT [Coord. IT 2026-2027].pdf` — documentul rămâne sursa vizuală; PDF-urile nu sunt versionate în git (vezi `.gitignore`). Extras la 2026-08-12. Trasabilitatea fiecărui punct către faza de implementare: vezi spec-ul de arhitectură (Revizia 3) și `docs/roadmap.md`.

## Priorități aplicație OSUBB

## 1. Task Tracker

### 1.1. Sistemul de punctare
- Se păstrează formula actuală de calcul al punctajului (dificultate × rating).
- Nu sunt necesare modificări majore asupra algoritmului de calcul.

### 1.2. Ghid de punctare (legendă)
Implementarea unei legende standardizate pentru punctarea taskurilor recurente.

Scop:
- uniformizarea modului în care coordonatorii acordă punctaje;
- reducerea diferențelor dintre departamente;
- simplificarea procesului de creare a taskurilor.

Funcționalitate propusă:
- buton dedicat în Task Tracker („Legendă" / „Ghid de punctare");
- acces rapid la exemple și punctajele recomandate.

Conținutul exact al ghidului va fi stabilit ulterior în cadrul ședințelor de BC.

### 1.3. Taskuri standard (template-uri)
Posibilitatea de a selecta taskuri recurente dintr-un dropdown.

Exemple:
- Ședință
- Minute
- Contactări
- Promovare

Opțional:
- punctajul recomandat să fie completat automat.

### 1.4. Grupuri / echipe
Posibilitatea de a crea grupuri de voluntari.

Scop:
- atribuirea unui task întregii echipe printr-un singur tag, fără selectarea manuală a fiecărui membru.

### 1.5. Cerere de task
Implementarea unei funcționalități prin care un voluntar poate solicita adăugarea unui task către coordonator.

### 1.6. Fișa voluntarului
Crearea unei fișe de TT dedicate fiecărui voluntar, disponibilă doar voluntarului respectiv și moderatorilor.

### 1.7. Pentru Interne
- fișă automată privind îndeplinirea pragului pentru Adunarea Generală;
- fișă separată cu membrii AG + punctajele lor;
- actualizare automată în funcție de activitatea din Task Tracker.

## 2. Conturi

### 2.1. Acces diferențiat
Sistem de roluri și permisiuni în funcție de tipul contului (recrut, voluntar, membru activ, responsabil proiect, etc.)

### 2.2. Dashboard personal
După autentificare, fiecare utilizator ar trebui să poată vedea rapid:
- departamentul/departamentele din care face parte;
- echipele din care face parte;
- Task Tracker-ul personal;
- informațiile relevante pentru rolul său;
- tipul de categorie de voluntar în care se regăsește
  - să se updateze automat în funcție de punctaj (ex: tranziția la membru activ când trece de pragul de puncte) sau de perioadă (ex: tranziția de la recrut la voluntar) — **GAMIFICAT**

## 3. Calendar

Un calendar comun al organizației.

### 3.1. Acces diferențiat
Evenimentele afișate vor depinde de rolul utilizatorului.

### 3.2. Organizare vizuală
- culori diferite pentru:
  - departamente;
  - proiecte;
  - activități externe;
  - organizație.

### 3.3. Înscriere la activități
Posibilitatea de a te înscrie direct (join) la:
- call-uri;
- formulare;
- activități;
- evenimente.

### 3.4. Tipuri de call-uri
Diferențiere între:
- call-uri de echipă;
- call-uri de departament;
- call-uri de proiect;
- call-uri generale ale organizației.

### 3.5. Evenimente viitoare
O zonă dedicată cu:
- ce urmează în perioada apropiată;
- deadline-uri personale;
- întâlniri;
- taskuri importante.

### 3.6. Detectarea suprapunerilor
Implementarea unei funcționalități care semnalează suprapunerea evenimentelor din calendar (idee propusă de Băncilă).

### 3.7. Notificări
Sistem integrat de notificări în aplicație.

Exemple:
- reminder pentru taskuri;
- evenimente apropiate;
- call-uri noi;
- deadline-uri;
- anunțuri importante.

Pentru informațiile critice:
- notificări de tip pop-up;
- evidențiere vizuală (ex. culoare roșie).

## 4. Pagină de anunțuri

O secțiune dedicată comunicării interne.

Conținut posibil:
- anunțuri oficiale;
- informații importante;
- modificări de regulament;
- oportunități de implicare;
- formulare active;
- call-uri deschise.

Anunțurile prioritare vor putea fi marcate astfel încât să apară sub formă de notificări pop-up până la vizualizarea lor.

## 5. Baza de date voluntari

Precum cea a HR-ului.

## 6. Panou BC

Nu am discutat concret încă funcționalitățile.
