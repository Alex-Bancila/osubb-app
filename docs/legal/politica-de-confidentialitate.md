<!--
  Politica de confidențialitate a aplicației OSUBB: sursa de adevăr pentru pagina /confidentialitate
  și pentru pasul de confirmare de după conectare (#771, ruling L16). Textul versiunii 1.0 a fost
  aprobat de Alex pe 2026-09-27; corecturile versiunii 1.1 (#860), pe 2026-09-29.
  Regula versiunilor: orice schimbare de conținut incrementează „Versiunea” și data, în acest fișier și
  în app/src/screens/privacy/PrivacyNoticeContent.tsx, iar în același pull request o migrație ridică
  în org_settings `privacy_notice_version` la același număr; aplicația cere apoi fiecărui Membru o
  nouă confirmare. Serverul nu cere niciodată o versiune al cărei text aplicația nu îl are.
  Corecturile de formă nu schimbă versiunea.
-->

# Politica de confidențialitate a aplicației OSUBB

**Versiunea 1.1 · în vigoare de la 02.10.2026**

Aplicația OSUBB („app.osubb.ro”) este aplicația internă a Organizației Studenților din Universitatea Babeș-Bolyai (OSUBB). Este folosită doar de membrii organizației, pe bază de invitație, pentru a organiza activitatea de voluntariat: taskuri și puncte, calendarul evenimentelor, anunțuri și notificări.

Această politică îți spune ce date despre tine ajung în aplicație, de ce, cine le vede, cât le păstrăm și ce drepturi ai. Ți-o prezentăm o singură dată la prima conectare, dar o poți găsi oricând în pagina Profil, iar când vor exista modificări ți-o vom arăta din nou.

## 1. Cine prelucrează datele

Operatorul datelor este organizația Studenților din Universitatea Babeș-Bolyai (OSUBB). Pentru orice întrebare sau cerere legată de datele tale scrie la [it@osubb.ro](mailto:it@osubb.ro). Organizația nu are obligația de a numi un responsabil cu protecția datelor; persoana care răspunde la această adresă este Coordonatorul IT al mandatului în curs.

## 2. Ce date prelucrăm și de unde provin

**Date de identificare și contact.** Numele complet, numărul de telefon și adresa de email, colectate de către Biroul de Conducere prin intermediul bazei de date a voluntarilor sau a formularului de recrutare. Opțional, un pseudonim, pe care îl poți completa tu în Profil.

**Apartenența la organizație.** Rolul (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot, BCE, BC, Moderator), statutul de membru (activ/inactiv), data intrării în organizație, grupurile și departamentele din care faci parte, funcțiile de conducere în grupuri și istoricul schimbărilor de rol, cu cine le-a făcut și când.

**Activitatea în aplicație.**

- Taskurile pe care le creezi, le primești sau la care te înscrii;
- Notele și observațiile date de un coordonator la evaluarea unui task;
- Punctele obținute și poziția în clasament;
- Cererile de recunoaștere a muncii; participarea (RSVP) la evenimente;
- Anunțurile pe care le-ai citit;
- Notificările primite în aplicație și preferințele tale de notificare; candidaturile la grupuri;
- Evaluările de rol și rezultatele lor: candidații la promovare și semnalele de retenție.

**Date tehnice.** Dacă activezi notificările pe un dispozitiv, aplicația păstrează abonamentul tehnic al acelui browser (o adresă unică și chei de criptare), pe care numai tu îl vezi și îl poți șterge. Furnizorul nostru de autentificare păstrează jurnale de conectare (data ultimei conectări, adresa IP, tipul de browser). Furnizorul de email păstrează jurnalul emailurilor trimise, inclusiv al rezumatului zilnic opțional pe email (adresa, subiectul, starea livrării, conținutul). Furnizorul de găzduire păstrează jurnale tehnice de acces (adresa IP, pagina cerută).

**Ce nu prelucrăm.** Aplicația nu folosește cookie-uri de urmărire, nu conține instrumente de analiză a comportamentului și nu vinde sau închiriază date nimănui. Nu cerem și nu stocăm parole: conectarea se face printr-un link sau un cod de unică folosință trimis pe email.

## 3. Decizii automate

Aplicația aplică automat o singură regulă de promovare stabilită de BC: trecerea de la Recrut la Voluntar după vechimea cerută. Efectul este schimbarea rolului tău în organizație și o notificare. Trecerea de la Voluntar la Voluntar Activ nu este automată: o evaluare de rol te poate arăta drept candidat la promovare, după vechime și pragul de puncte, iar BC decide promovarea. Nicio decizie automată nu retrogradează pe nimeni. Poți cere oricând ca o promovare (sau lipsa ei) să fie verificată de o persoană, scriind BC-ului sau la [it@osubb.ro](mailto:it@osubb.ro).

## 4. Cine vede datele tale în organizație

Vizibilitatea depinde de rol, exact ca în organizație:

- **Orice membru** vede numele și pseudonimul tău, rolul, data intrării în organizație, grupurile din care faci parte, și te poate vedea în clasament, dacă rolul lui permite clasamentul.
- **Coordonatorii grupurilor tale** văd taskurile tale din acele grupuri, evaluările și punctele aferente, candidaturile și cererile tale.
- **BC, BCE și Moderatorul** văd toate taskurile, evaluările și punctele, participarea (RSVP) la evenimente și datele de contact (email, telefon); **BC și Moderatorul** văd în plus candidaturile și cererile din toate grupurile, istoricul rolurilor și confirmările acestei politici.

Numai tu îți vezi notificările, preferințele și dispozitivele abonate la notificări.

## 5. Cine ne ajută să prelucrăm datele (persoane împuternicite)

Nu transmitem datele niciunui terț pentru scopurile lui. Folosim următorii furnizori, fiecare pe baza unui acord de prelucrare a datelor:

| Furnizor             | Ce face pentru noi                                                                                      | Unde sunt datele                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase, Inc.**   | baza de date, autentificarea, funcțiile aplicației, copiile de siguranță                                | Frankfurt, Germania (UE)                                                                                                                                               |
| **Resend, Inc.**     | trimiterea emailurilor de invitație, conectare și schimbare a adresei, și a rezumatului zilnic opțional | trimitere din Irlanda (UE); jurnalele emailurilor sunt stocate în SUA, în baza Cadrului UE–SUA privind confidențialitatea datelor și a clauzelor contractuale standard |
| **Cloudflare, Inc.** | găzduirea și livrarea aplicației în browser                                                             | rețea globală; jurnale tehnice de acces conform acordului de prelucrare al Cloudflare                                                                                  |

## 6. Cât păstrăm datele

- **Cât ești membru:** toate datele de mai sus, pentru funcționarea aplicației.
- **După încheierea calității de membru:** contul devine inactiv și nu te mai poți conecta. Numele, rolurile, taskurile și punctele rămân în istoricul organizației, pentru raportări și aniversări, conform hotărârii organizației. Poți cere oricând ștergerea completă (secțiunea 7).
- **Jurnale tehnice:** rândurile interne de livrare a notificărilor push se șterg după 7 zile; jurnalul emailurilor la Resend se păstrează 30 de zile; jurnalele de conectare ale Supabase și jurnalele de acces ale Cloudflare se păstrează conform politicilor acelor furnizori, pentru securitate.
- **Abonamentele push:** până le dezactivezi tu sau până browserul le invalidează.
- **Copii de siguranță:** copii zilnice ale bazei de date, păstrate 7 zile.

## 7. Drepturile tale

Ai dreptul:

- **de acces** — să afli ce date avem despre tine și să primești o copie;
- **de rectificare** — pseudonimul, telefonul și culoarea avatarului le schimbi singur în Profil; adresa de email o schimbi din Profil cu confirmare pe ambele adrese; numele complet îl corectează BC la cererea ta;
- **la ștergere** — ștergerea contului și a tuturor datelor tale, inclusiv din istoric; ștergerea modifică retroactiv totalurile istorice ale grupurilor, ceea ce organizația acceptă;
- **la restricționarea prelucrării** și **la opoziție** față de prelucrările bazate pe interes legitim;
- **la portabilitate** — să primești datele furnizate de tine într-un format uzual;
- **de a-ți retrage consimțământul** pentru notificările push, oricând, din Profil sau din setările browserului, fără a afecta restul;
- **de a nu face obiectul unei decizii exclusiv automate** — vezi secțiunea 3;

Trimite orice cerere la [it@osubb.ro](mailto:it@osubb.ro) de pe adresa ta de email din aplicație.

## 8. Cum protejăm datele

Accesul este exclusiv pe bază de invitație; nu există înregistrare publică. Conectarea se face fără parolă, printr-un link sau cod de unică folosință care expiră repede. Fiecare interogare a bazei de date este filtrată după rolul tău (reguli de securitate la nivel de rând), astfel încât aplicația nu poate livra un rând pe care nu ai dreptul să îl vezi. Traficul este criptat (HTTPS), notificările push sunt criptate de la capăt la capăt, iar accesul administrativ la furnizori este protejat cu autentificare în doi pași. Copiile de siguranță sunt zilnice.

## 9. Stocare locală în browser

Aplicația păstrează în memoria browserului tău sesiunea de conectare, adresa de email pentru care ai cerut un link de conectare (cât timp linkul este valabil) și câteva preferințe (tema, vederea calendarului și a clasamentului, dacă notificările sunt pornite pe acel dispozitiv). Nu folosim cookie-uri de urmărire și nu cerem acordul pentru cookie-uri, pentru că nu există unele care să aibă nevoie de el. Datele membrilor nu sunt stocate în browser pentru folosire offline.

## 10. Modificări

Când schimbăm această politică, publicăm noua versiune în aplicație, cu numărul și data ei, și îți cerem să confirmi că ai citit-o la următoarea conectare. Confirmarea ta (versiunea și momentul) este păstrată și vizibilă pentru BC și Moderator, ca dovadă că ai fost informat; ea nu este un consimțământ și nu schimbă nimic din datele tale.

---

_Versiunea 1.1 — 02.10.2026. Corectează textul după aplicația de la lansare: pseudonimul, promovarea la Voluntar Activ decisă de BC, evaluările de rol, rezumatul zilnic pe email și cine vede ce date._

_Versiunea 1.0 — aprobată pe 27.09.2026. Prima versiune, înlocuită de versiunea 1.1 înainte de lansare._
