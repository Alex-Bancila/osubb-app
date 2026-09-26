import type { ReactNode } from 'react';

/**
 * The Privacy Notice as the app shows it (#771, ruling L16).
 *
 * `docs/legal/politica-de-confidentialitate.md` is the source of truth; this is
 * its copy. A pull request that changes the text changes both files and bumps
 * the version in both — `privacy-notice.test.tsx` fails while the version or a
 * section heading here differs from the document. The `[[...]]` placeholders
 * are the document's own and are filled there first, before the board approves
 * the text.
 *
 * After the Release that ships a new version, BC raises `org_settings`
 * `privacy_notice_version` to the same number, and every Member is asked to
 * acknowledge it again.
 */
export const PRIVACY_NOTICE_VERSION = '1.0';
export const PRIVACY_NOTICE_TITLE =
  'Politica de confidențialitate a aplicației OSUBB';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
}: {
  head: readonly [string, string, ...string[]];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <thead className="bg-muted">
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="p-2 align-top font-semibold"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t">
              {row.map((cell, column) => (
                <td key={column} className="p-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The notice text: its title, version line, the twelve sections and the closing line. */
export function PrivacyNoticeContent() {
  return (
    <article className="space-y-6 leading-relaxed">
      <header className="space-y-2">
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          {PRIVACY_NOTICE_TITLE}
        </h1>
        <p className="font-semibold">
          Versiunea {PRIVACY_NOTICE_VERSION} · în vigoare de la [[DATA]]
        </p>
      </header>

      <p>
        Aplicația OSUBB (<code>app.osubb.ro</code>) este aplicația internă a
        Organizației Studenților din Universitatea Babeș-Bolyai. Este folosită
        doar de membrii organizației, pe bază de invitație, pentru a organiza
        activitatea de voluntariat: taskuri și puncte, calendarul evenimentelor,
        anunțuri și notificări. Această politică îți spune, pe scurt și pe
        înțeles, ce date despre tine ajung în aplicație, de ce, cine le vede,
        cât le păstrăm și ce drepturi ai. Ți-o arătăm o singură dată la prima
        conectare, o găsești oricând în pagina <strong>Profil</strong>, iar când
        o schimbăm ți-o arătăm din nou.
      </p>

      <Section title="1. Cine prelucrează datele">
        <p>
          Operatorul datelor este <strong>[[DENUMIRE JURIDICĂ]]</strong>{' '}
          (OSUBB), cu sediul în [[SEDIU]], CUI [[CUI]], reprezentată de [[NUME
          PREȘEDINTE]]. Pentru orice întrebare sau cerere legată de datele tale
          scrie la <strong>[[EMAIL CONTACT]]</strong>. Organizația nu are
          obligația de a numi un responsabil cu protecția datelor; persoana care
          răspunde la această adresă este Coordonatorul IT al mandatului în
          curs.
        </p>
      </Section>

      <Section title="2. Ce date prelucrăm și de unde provin">
        <p>
          <strong>Date de identificare și contact.</strong> Numele complet și
          adresa de email, primite de la Biroul de Conducere (BC/BCE) când te
          invită sau când ești importat din formularul de recrutare. Opțional,
          numărul de telefon și porecla pe care le completezi tu în Profil, plus
          culoarea avatarului.
        </p>
        <p>
          <strong>Apartenența la organizație.</strong> Rolul (Recrut, Voluntar,
          Voluntar Activ, Voluntar cu Drept de Vot, BCE, BC, Moderator),
          statutul de membru (activ/inactiv), data intrării în organizație,
          grupurile și departamentele din care faci parte, funcțiile de
          conducere în grupuri și istoricul schimbărilor de rol, cu cine le-a
          făcut și când.
        </p>
        <p>
          <strong>Activitatea în aplicație.</strong> Taskurile pe care le
          creezi, le primești sau la care te înscrii; notele și observațiile
          date de un coordonator la evaluarea unui task; punctele obținute și
          poziția în clasament; cererile de recunoaștere a muncii; participarea
          (RSVP) la evenimente; anunțurile pe care le-ai citit; notificările
          primite în aplicație și preferințele tale de notificare; candidaturile
          la grupuri; datele perioadelor de evaluare și ale promovărilor.
        </p>
        <p>
          <strong>Date istorice.</strong> Pentru membrii BC/BCE de la lansare,
          taskurile și notele din evidența anterioară a organizației (foaia de
          calcul folosită până acum) sunt importate în aplicație, ca istoric.
        </p>
        <p>
          <strong>Date tehnice.</strong> Dacă activezi notificările pe un
          dispozitiv, aplicația păstrează abonamentul tehnic al acelui browser
          (o adresă unică și chei de criptare), pe care numai tu îl vezi și îl
          poți șterge. Furnizorul nostru de autentificare păstrează jurnale de
          conectare (data ultimei conectări, adresa IP, tipul de browser).
          Furnizorul de email păstrează jurnalul emailurilor de conectare
          trimise (adresa, subiectul, starea livrării, conținutul). Furnizorul
          de găzduire păstrează jurnale tehnice de acces (adresa IP, pagina
          cerută).
        </p>
        <p>
          <strong>Ce nu prelucrăm.</strong> Aplicația nu folosește cookie-uri de
          urmărire, nu conține instrumente de analiză a comportamentului și nu
          vinde sau închiriază date nimănui. Nu cerem și nu stocăm parole:
          conectarea se face printr-un link sau un cod de unică folosință trimis
          pe email.
        </p>
      </Section>

      <Section title="3. De ce prelucrăm datele și pe ce temei">
        <Table
          head={['Scop', 'Temei (Regulamentul (UE) 2016/679)']}
          rows={[
            [
              'Gestionarea calității tale de membru: cont, rol, grupuri, istoric',
              'art. 6 alin. (1) lit. b) — raportul de membru conform Statutului și ROF-ului OSUBB',
            ],
            [
              'Organizarea activității de voluntariat: taskuri, evaluări, puncte, clasament, evenimente, cereri',
              'art. 6 alin. (1) lit. b) și lit. f) — interesul legitim al organizației de a-și coordona activitatea și de a recunoaște munca depusă',
            ],
            [
              'Comunicarea internă: anunțuri, notificări în aplicație',
              'art. 6 alin. (1) lit. f) — interesul legitim de a informa membrii',
            ],
            [
              'Notificări pe dispozitivul tău (push)',
              'art. 6 alin. (1) lit. a) — consimțământul tău, dat prin permisiunea acordată în browser; îl retragi oricând din Profil',
            ],
            [
              'Autentificare, securitate, prevenirea accesului neautorizat, jurnale tehnice',
              'art. 6 alin. (1) lit. f) — interesul legitim de a proteja datele membrilor',
            ],
            [
              'Aplicarea regulilor de promovare stabilite de BC',
              'art. 6 alin. (1) lit. b) — regulile organizației privind rolurile',
            ],
            [
              'Păstrarea istoricului după încheierea calității de membru (alumni)',
              'art. 6 alin. (1) lit. f) — interesul legitim de raportare istorică a organizației; vezi secțiunea 7',
            ],
          ]}
        />
        <p>
          Furnizarea datelor de identificare este necesară pentru a fi membru în
          aplicație: fără nume și email nu poate exista un cont. Telefonul,
          porecla și notificările push sunt opționale.
        </p>
      </Section>

      <Section title="4. Decizii automate">
        <p>
          Aplicația aplică automat regulile de promovare stabilite de BC:
          trecerea de la Recrut la Voluntar după vechimea cerută, și de la
          Voluntar la Voluntar Activ după vechime plus fie o poziție în
          clasamentul perioadei de evaluare, fie atingerea pragului de puncte.
          Efectul este schimbarea rolului tău în organizație și o notificare.
          Nicio decizie automată nu retrogradează pe nimeni. Poți cere oricând
          ca o promovare (sau lipsa ei) să fie verificată de o persoană, scriind
          BC-ului sau la [[EMAIL CONTACT]].
        </p>
      </Section>

      <Section title="5. Cine vede datele tale în organizație">
        <p>Vizibilitatea depinde de rol, exact ca în organizație:</p>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            <strong>Orice membru</strong> vede numele sau porecla ta, rolul,
            grupurile din care faci parte, și te poate vedea pe listele de
            participare la evenimentele la care aveți acces amândoi, și în
            clasament, dacă rolul lui permite clasamentul.
          </li>
          <li>
            <strong>Coordonatorii grupurilor tale</strong> văd taskurile tale
            din acele grupuri, evaluările și punctele aferente, candidaturile și
            cererile tale.
          </li>
          <li>
            <strong>BC, BCE și Moderatorul</strong> văd toate datele de mai sus,
            plus datele de contact (email, telefon), istoricul rolurilor și
            confirmările acestei politici.
          </li>
        </ul>
        <p>
          Numai tu îți vezi notificările, preferințele și dispozitivele abonate
          la notificări.
        </p>
      </Section>

      <Section title="6. Cine ne ajută să prelucrăm datele (persoane împuternicite)">
        <p>
          Nu transmitem datele niciunui terț pentru scopurile lui. Folosim
          următorii furnizori, fiecare pe baza unui acord de prelucrare a
          datelor:
        </p>
        <Table
          head={['Furnizor', 'Ce face pentru noi', 'Unde sunt datele']}
          rows={[
            [
              <strong key="supabase">Supabase, Inc.</strong>,
              'baza de date, autentificarea, funcțiile aplicației, copiile de siguranță',
              'Frankfurt, Germania (UE)',
            ],
            [
              <strong key="resend">Resend, Inc.</strong>,
              'trimiterea emailurilor de invitație și conectare',
              'trimitere din Irlanda (UE); jurnalele emailurilor sunt stocate în SUA, în baza Cadrului UE–SUA privind confidențialitatea datelor și a clauzelor contractuale standard',
            ],
            [
              <strong key="cloudflare">Cloudflare, Inc.</strong>,
              'găzduirea și livrarea aplicației în browser',
              'rețea globală; jurnale tehnice de acces conform acordului de prelucrare al Cloudflare',
            ],
            [
              <>
                <strong>Serviciile de notificare ale browserelor</strong>{' '}
                (Google, Apple, Mozilla, Microsoft)
              </>,
              'livrarea notificărilor push pe dispozitivul tău, doar dacă le-ai activat',
              <>
                primesc doar adresa tehnică a abonamentului și un mesaj{' '}
                <strong>criptat</strong>, pe care nu îl pot citi
              </>,
            ],
          ]}
        />
        <p>
          Codul sursă al aplicației este public pe GitHub; el nu conține date
          personale.
        </p>
      </Section>

      <Section title="7. Cât păstrăm datele">
        <ul className="list-disc space-y-2 ps-6">
          <li>
            <strong>Cât ești membru:</strong> toate datele de mai sus, pentru
            funcționarea aplicației.
          </li>
          <li>
            <strong>După încheierea calității de membru:</strong> contul devine
            inactiv și nu te mai poți conecta. Numele, rolurile, taskurile și
            punctele rămân în istoricul organizației (alumni), pentru raportări
            și aniversări, conform hotărârii organizației. Poți cere oricând
            ștergerea completă (secțiunea 8).
          </li>
          <li>
            <strong>Jurnale tehnice:</strong> rândurile interne de livrare a
            notificărilor push se șterg după 7 zile; jurnalul emailurilor la
            Resend se păstrează 30 de zile; jurnalele de conectare ale Supabase
            și jurnalele de acces ale Cloudflare se păstrează conform
            politicilor acelor furnizori, pentru securitate.
          </li>
          <li>
            <strong>Abonamentele push:</strong> până le dezactivezi tu sau până
            browserul le invalidează.
          </li>
          <li>
            <strong>Copii de siguranță:</strong> copii zilnice ale bazei de
            date, păstrate 7 zile.
          </li>
        </ul>
      </Section>

      <Section title="8. Drepturile tale">
        <p>Ai dreptul:</p>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            <strong>de acces</strong> — să afli ce date avem despre tine și să
            primești o copie;
          </li>
          <li>
            <strong>de rectificare</strong> — porecla, telefonul și culoarea
            avatarului le schimbi singur în Profil; adresa de email o schimbi
            din Profil cu confirmare pe ambele adrese; numele complet îl
            corectează BC la cererea ta;
          </li>
          <li>
            <strong>la ștergere</strong> — ștergerea contului și a tuturor
            datelor tale, inclusiv din istoric; ștergerea modifică retroactiv
            totalurile istorice ale grupurilor, ceea ce organizația acceptă;
          </li>
          <li>
            <strong>la restricționarea prelucrării</strong> și{' '}
            <strong>la opoziție</strong> față de prelucrările bazate pe interes
            legitim;
          </li>
          <li>
            <strong>la portabilitate</strong> — să primești datele furnizate de
            tine într-un format uzual;
          </li>
          <li>
            <strong>de a-ți retrage consimțământul</strong> pentru notificările
            push, oricând, din Profil sau din setările browserului, fără a
            afecta restul;
          </li>
          <li>
            <strong>
              de a nu face obiectul unei decizii exclusiv automate
            </strong>{' '}
            — vezi secțiunea 4;
          </li>
          <li>
            <strong>de a depune o plângere</strong> la Autoritatea Națională de
            Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP),
            B-dul G-ral. Gheorghe Magheru nr. 28-30, sector 1, București,{' '}
            <code>anspdcp@dataprotection.ro</code>,{' '}
            <code>www.dataprotection.ro</code>.
          </li>
        </ul>
        <p>
          Trimite orice cerere la [[EMAIL CONTACT]] de pe adresa ta de email din
          aplicație. Răspundem în cel mult o lună; dacă cererea este complexă,
          te anunțăm și putem prelungi cu încă două luni.
        </p>
      </Section>

      <Section title="9. Cum protejăm datele">
        <p>
          Accesul este exclusiv pe bază de invitație; nu există înregistrare
          publică. Conectarea se face fără parolă, printr-un link sau cod de
          unică folosință care expiră repede. Fiecare interogare a bazei de date
          este filtrată după rolul tău (reguli de securitate la nivel de rând),
          astfel încât aplicația nu poate livra un rând pe care nu ai dreptul să
          îl vezi. Traficul este criptat (HTTPS), notificările push sunt
          criptate de la capăt la capăt, iar accesul administrativ la furnizori
          este protejat cu autentificare în doi pași. Copiile de siguranță sunt
          zilnice.
        </p>
      </Section>

      <Section title="10. Stocare locală în browser">
        <p>
          Aplicația păstrează în memoria browserului tău sesiunea de conectare
          și câteva preferințe (tema, vederea calendarului, ultimul filtru). Nu
          folosim cookie-uri de urmărire și nu cerem acordul pentru cookie-uri,
          pentru că nu există unele care să aibă nevoie de el. Datele membrilor
          nu sunt stocate în browser pentru folosire offline.
        </p>
      </Section>

      <Section title="11. Minori">
        <p>
          Aplicația este destinată studenților și membrilor OSUBB, persoane
          majore. Dacă un membru are sub 18 ani, BC obține acordul părintelui
          înainte de invitație.
        </p>
      </Section>

      <Section title="12. Modificări">
        <p>
          Când schimbăm această politică, publicăm noua versiune în aplicație,
          cu numărul și data ei, și îți cerem să confirmi că ai citit-o la
          următoarea conectare. Confirmarea ta (versiunea și momentul) este
          păstrată și vizibilă pentru BC, ca dovadă că ai fost informat; ea nu
          este un consimțământ și nu schimbă nimic din datele tale.
        </p>
      </Section>

      <hr />
      <p className="text-sm text-muted-foreground">
        <em>
          Versiunea {PRIVACY_NOTICE_VERSION} — [[DATA]]. Prima versiune, la
          lansarea aplicației.
        </em>
      </p>
    </article>
  );
}
