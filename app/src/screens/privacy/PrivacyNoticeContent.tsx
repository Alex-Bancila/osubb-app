import type { ReactNode } from 'react';

/**
 * The Privacy Notice as the app shows it (#771, ruling L16), both on
 * `/confidentialitate` and in the Privacy Acknowledgement step after sign-in.
 *
 * `docs/legal/politica-de-confidentialitate.md` is the source of truth; this is
 * its copy. A pull request that changes the text changes both files and bumps
 * the version and date in both — `privacy-notice.test.tsx` fails while the
 * words, the version, the date or a section heading here differ from the
 * document.
 *
 * After the Release that ships a new version, BC raises `org_settings`
 * `privacy_notice_version` to the same number, and every Member is asked to
 * acknowledge it again.
 */
export const PRIVACY_NOTICE_VERSION = '1.0';
/** The effective date as the document writes it (dd.mm.yyyy). */
export const PRIVACY_NOTICE_DATE = '02.10.2026';
export const PRIVACY_NOTICE_TITLE =
  'Politica de confidențialitate a aplicației OSUBB';

const DATE_TIME = PRIVACY_NOTICE_DATE.split('.').reverse().join('-');
const CONTACT_EMAIL = 'it@osubb.ro';

const PROCESSORS = [
  {
    name: 'Supabase, Inc.',
    role: 'baza de date, autentificarea, funcțiile aplicației, copiile de siguranță',
    location: 'Frankfurt, Germania (UE)',
  },
  {
    name: 'Resend, Inc.',
    role: 'trimiterea emailurilor de invitație și conectare',
    location:
      'trimitere din Irlanda (UE); jurnalele emailurilor sunt stocate în SUA, în baza Cadrului UE–SUA privind confidențialitatea datelor și a clauzelor contractuale standard',
  },
  {
    name: 'Cloudflare, Inc.',
    role: 'găzduirea și livrarea aplicației în browser',
    location:
      'rețea globală; jurnale tehnice de acces conform acordului de prelucrare al Cloudflare',
  },
] as const;

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  const id = `confidentialitate-${number}`;
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2
        id={id}
        className="flex gap-2.5 text-lg leading-snug font-bold tracking-tight text-foreground sm:text-xl"
      >
        <span className="shrink-0 text-primary tabular-nums">{number}.</span>{' '}
        <span className="text-balance">{title}</span>
      </h2>
      {children}
    </section>
  );
}

/** A definition-style lead-in: "Date tehnice." */
function Term({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-2.5 ps-5 marker:text-muted-foreground">
      {children}
    </ul>
  );
}

function ContactLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="font-medium text-foreground underline decoration-primary/50 underline-offset-4 transition-colors hover:decoration-primary"
    >
      {CONTACT_EMAIL}
    </a>
  );
}

/**
 * The processors as a table from `sm` up; below it each row stacks, and the
 * column name rides on the cell as a CSS label (so the text stays the
 * document's), with no horizontal scroll at 375 px.
 */
function ProcessorTable() {
  const cell =
    'px-4 py-3 align-top max-sm:block max-sm:p-0 max-sm:before:mb-0.5 max-sm:before:block max-sm:before:text-xs max-sm:before:font-medium max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]';
  return (
    <div className="overflow-hidden rounded-lg border">
      <table
        aria-label="Persoane împuternicite"
        className="w-full border-collapse text-left text-sm leading-6 max-sm:block"
      >
        <thead className="bg-muted text-xs text-muted-foreground max-sm:sr-only">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold sm:w-[9.5rem]">
              Furnizor
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold sm:w-[34%]">
              Ce face pentru noi
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Unde sunt datele
            </th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {PROCESSORS.map((processor) => (
            <tr
              key={processor.name}
              className="border-t max-sm:block max-sm:space-y-2 max-sm:px-4 max-sm:py-3.5 max-sm:first:border-t-0"
            >
              <th
                scope="row"
                className="px-4 py-3 align-top font-semibold text-foreground max-sm:block max-sm:p-0 max-sm:text-[0.9375rem]"
              >
                {processor.name}
              </th>
              <td data-label="Ce face pentru noi" className={cell}>
                {processor.role}
              </td>
              <td data-label="Unde sunt datele" className={cell}>
                {processor.location}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The notice text: its title, version line, the ten sections and the closing line. */
export function PrivacyNoticeContent() {
  return (
    <article className="space-y-10 text-base leading-7 text-foreground">
      <header className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-balance sm:text-3xl">
            {PRIVACY_NOTICE_TITLE}
          </h1>
          <p className="text-sm text-muted-foreground">
            Versiunea {PRIVACY_NOTICE_VERSION} · în vigoare de la{' '}
            <time dateTime={DATE_TIME}>{PRIVACY_NOTICE_DATE}</time>
          </p>
        </div>
        <p>
          Aplicația OSUBB („app.osubb.ro”) este aplicația internă a Organizației
          Studenților din Universitatea Babeș-Bolyai (OSUBB). Este folosită doar
          de membrii organizației, pe bază de invitație, pentru a organiza
          activitatea de voluntariat: taskuri și puncte, calendarul
          evenimentelor, anunțuri și notificări.
        </p>
        <p>
          Această politică îți spune ce date despre tine ajung în aplicație, de
          ce, cine le vede, cât le păstrăm și ce drepturi ai. Ți-o prezentăm o
          singură dată la prima conectare, dar o poți găsi oricând în pagina
          Profil, iar când vor exista modificări ți-o vom arăta din nou.
        </p>
      </header>

      <Section number={1} title="Cine prelucrează datele">
        <p>
          Operatorul datelor este organizația Studenților din Universitatea
          Babeș-Bolyai (OSUBB). Pentru orice întrebare sau cerere legată de
          datele tale scrie la <ContactLink />. Organizația nu are obligația de
          a numi un responsabil cu protecția datelor; persoana care răspunde la
          această adresă este Coordonatorul IT al mandatului în curs.
        </p>
      </Section>

      <Section number={2} title="Ce date prelucrăm și de unde provin">
        <p>
          <Term>Date de identificare și contact.</Term> Numele complet, numărul
          de telefon și adresa de email, colectate de către Biroul de Conducere
          prin intermediul bazei de date a voluntarilor sau a formularului de
          recrutare. Opțional, va exista și un câmp de poreclă, pe care o poți
          completa tu în Profil.
        </p>
        <p>
          <Term>Apartenența la organizație.</Term> Rolul (Recrut, Voluntar,
          Voluntar Activ, Voluntar cu Drept de Vot, BCE, BC, Moderator),
          statutul de membru (activ/inactiv), data intrării în organizație,
          grupurile și departamentele din care faci parte, funcțiile de
          conducere în grupuri și istoricul schimbărilor de rol, cu cine le-a
          făcut și când.
        </p>
        <div className="space-y-2.5">
          <p>
            <Term>Activitatea în aplicație.</Term>
          </p>
          <List>
            <li>
              Taskurile pe care le creezi, le primești sau la care te înscrii;
            </li>
            <li>
              Notele și observațiile date de un coordonator la evaluarea unui
              task;
            </li>
            <li>Punctele obținute și poziția în clasament;</li>
            <li>
              Cererile de recunoaștere a muncii; participarea (RSVP) la
              evenimente;
            </li>
            <li>Anunțurile pe care le-ai citit;</li>
            <li>
              Notificările primite în aplicație și preferințele tale de
              notificare; candidaturile la grupuri;
            </li>
            <li>Datele perioadelor de evaluare și ale promovărilor.</li>
          </List>
        </div>
        <p>
          <Term>Date tehnice.</Term> Dacă activezi notificările pe un
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
          <Term>Ce nu prelucrăm.</Term> Aplicația nu folosește cookie-uri de
          urmărire, nu conține instrumente de analiză a comportamentului și nu
          vinde sau închiriază date nimănui. Nu cerem și nu stocăm parole:
          conectarea se face printr-un link sau un cod de unică folosință trimis
          pe email.
        </p>
      </Section>

      <Section number={3} title="Decizii automate">
        <p>
          Aplicația aplică automat regulile de promovare stabilite de BC:
          trecerea de la Recrut la Voluntar după vechimea cerută, și de la
          Voluntar la Voluntar Activ după vechime plus fie o poziție în
          clasamentul perioadei de evaluare, fie atingerea pragului de puncte.
          Efectul este schimbarea rolului tău în organizație și o notificare.
          Nicio decizie automată nu retrogradează pe nimeni. Poți cere oricând
          ca o promovare (sau lipsa ei) să fie verificată de o persoană, scriind
          BC-ului sau la <ContactLink />.
        </p>
      </Section>

      <Section number={4} title="Cine vede datele tale în organizație">
        <p>Vizibilitatea depinde de rol, exact ca în organizație:</p>
        <List>
          <li>
            <Term>Orice membru</Term> vede numele sau porecla ta, rolul,
            grupurile din care faci parte, și te poate vedea pe listele de
            participare la evenimentele la care aveți acces amândoi, și în
            clasament, dacă rolul lui permite clasamentul.
          </li>
          <li>
            <Term>Coordonatorii grupurilor tale</Term> văd taskurile tale din
            acele grupuri, evaluările și punctele aferente, candidaturile și
            cererile tale.
          </li>
          <li>
            <Term>BC, BCE și Moderatorul</Term> văd toate datele de mai sus,
            plus datele de contact (email, telefon), istoricul rolurilor și
            confirmările acestei politici.
          </li>
        </List>
        <p>
          Numai tu îți vezi notificările, preferințele și dispozitivele abonate
          la notificări.
        </p>
      </Section>

      <Section
        number={5}
        title="Cine ne ajută să prelucrăm datele (persoane împuternicite)"
      >
        <p>
          Nu transmitem datele niciunui terț pentru scopurile lui. Folosim
          următorii furnizori, fiecare pe baza unui acord de prelucrare a
          datelor:
        </p>
        <ProcessorTable />
      </Section>

      <Section number={6} title="Cât păstrăm datele">
        <List>
          <li>
            <Term>Cât ești membru:</Term> toate datele de mai sus, pentru
            funcționarea aplicației.
          </li>
          <li>
            <Term>După încheierea calității de membru:</Term> contul devine
            inactiv și nu te mai poți conecta. Numele, rolurile, taskurile și
            punctele rămân în istoricul organizației, pentru raportări și
            aniversări, conform hotărârii organizației. Poți cere oricând
            ștergerea completă (secțiunea 7).
          </li>
          <li>
            <Term>Jurnale tehnice:</Term> rândurile interne de livrare a
            notificărilor push se șterg după 7 zile; jurnalul emailurilor la
            Resend se păstrează 30 de zile; jurnalele de conectare ale Supabase
            și jurnalele de acces ale Cloudflare se păstrează conform
            politicilor acelor furnizori, pentru securitate.
          </li>
          <li>
            <Term>Abonamentele push:</Term> până le dezactivezi tu sau până
            browserul le invalidează.
          </li>
          <li>
            <Term>Copii de siguranță:</Term> copii zilnice ale bazei de date,
            păstrate 7 zile.
          </li>
        </List>
      </Section>

      <Section number={7} title="Drepturile tale">
        <p>Ai dreptul:</p>
        <List>
          <li>
            <Term>de acces</Term> — să afli ce date avem despre tine și să
            primești o copie;
          </li>
          <li>
            <Term>de rectificare</Term> — porecla, telefonul și culoarea
            avatarului le schimbi singur în Profil; adresa de email o schimbi
            din Profil cu confirmare pe ambele adrese; numele complet îl
            corectează BC la cererea ta;
          </li>
          <li>
            <Term>la ștergere</Term> — ștergerea contului și a tuturor datelor
            tale, inclusiv din istoric; ștergerea modifică retroactiv totalurile
            istorice ale grupurilor, ceea ce organizația acceptă;
          </li>
          <li>
            <Term>la restricționarea prelucrării</Term> și{' '}
            <Term>la opoziție</Term> față de prelucrările bazate pe interes
            legitim;
          </li>
          <li>
            <Term>la portabilitate</Term> — să primești datele furnizate de tine
            într-un format uzual;
          </li>
          <li>
            <Term>de a-ți retrage consimțământul</Term> pentru notificările
            push, oricând, din Profil sau din setările browserului, fără a
            afecta restul;
          </li>
          <li>
            <Term>de a nu face obiectul unei decizii exclusiv automate</Term> —
            vezi secțiunea 3;
          </li>
        </List>
        <p>
          Trimite orice cerere la <ContactLink /> de pe adresa ta de email din
          aplicație.
        </p>
      </Section>

      <Section number={8} title="Cum protejăm datele">
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

      <Section number={9} title="Stocare locală în browser">
        <p>
          Aplicația păstrează în memoria browserului tău sesiunea de conectare
          și câteva preferințe (tema, vederea calendarului, ultimul filtru). Nu
          folosim cookie-uri de urmărire și nu cerem acordul pentru cookie-uri,
          pentru că nu există unele care să aibă nevoie de el. Datele membrilor
          nu sunt stocate în browser pentru folosire offline.
        </p>
      </Section>

      <Section number={10} title="Modificări">
        <p>
          Când schimbăm această politică, publicăm noua versiune în aplicație,
          cu numărul și data ei, și îți cerem să confirmi că ai citit-o la
          următoarea conectare. Confirmarea ta (versiunea și momentul) este
          păstrată și vizibilă pentru BC, ca dovadă că ai fost informat; ea nu
          este un consimțământ și nu schimbă nimic din datele tale.
        </p>
      </Section>

      <footer className="border-t pt-6">
        <p className="text-sm text-muted-foreground italic">
          Versiunea {PRIVACY_NOTICE_VERSION} —{' '}
          <time dateTime={DATE_TIME}>{PRIVACY_NOTICE_DATE}</time>. Prima
          versiune, la lansarea aplicației.
        </p>
      </footer>
    </article>
  );
}
