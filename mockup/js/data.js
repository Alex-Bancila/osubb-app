/* ============================================================================
   OSUBB mock data  (global: OSUBB.data)  — anchored to "today" = 2026-06-28
   ----------------------------------------------------------------------------
   SCORING:  task points = difficulty(1..5 stars) × ratingMultiplier(rating)
             rating 1→×(-1) · 2→×0 · 3→×1 · 4→×2 · 5→×3   (see OSUBB.util.ratingMult)
   DEPARTMENTS (5): Educational, Imagine&PR, Tineret, Financiar, Resurse Umane.
             IT is NOT a department — it is a team led by Coordonator IT (BCE).
   ROLES: recrut · voluntar · activ(Membru Activ) · vot(Drept de vot) ·
          responsabil(Responsabil de proiect) · bce · bc · moderator
   ========================================================================== */
window.OSUBB = window.OSUBB || {};
OSUBB.today = { y: 2026, m: 6, d: 28 };

OSUBB.data = {
  departments: [
    { id:'edu',   name:'Educational',    tag:'dept-edu',   color:'#284C93', short:'EDU'    },
    { id:'pr',    name:'Imagine & PR',   tag:'dept-pr',    color:'#7500A0', short:'IMG&PR' },
    { id:'youth', name:'Tineret',        tag:'dept-youth', color:'#FF3B3B', short:'TIN'    },
    { id:'fin',   name:'Financiar',      tag:'dept-fin',   color:'#007F33', short:'FIN'    },
    { id:'hr',    name:'Resurse Umane',  tag:'dept-hr',    color:'#F2A700', short:'HR'     },
  ],

  roles: [
    { id:'recrut',      name:'Recrut',                 level:0, short:'REC' },
    { id:'voluntar',    name:'Voluntar',               level:1, short:'VOL' },
    { id:'activ',       name:'Membru Activ',           level:2, short:'ACT' },
    { id:'vot',         name:'Membru cu Drept de Vot', level:3, short:'AG'  },
    { id:'responsabil', name:'Responsabil de proiect', level:4, short:'RP'  },
    { id:'bce',         name:'BCE',                    level:5, short:'BCE' },
    { id:'bc',          name:'BC',                     level:6, short:'BC'  },
    { id:'moderator',   name:'Moderator',              level:9, short:'MOD' },
  ],

  /* Logged-in persona per role (drives role switcher + dashboard/profile).
     promo.note explains how to advance; promo.kind: 'time' | 'percentile' | 'top' | 'max' */
  accounts: {
    recrut:      { name:'Maria Pop',      initials:'MP', avatarColor:'#284C93', role:'recrut',   depts:['edu'],          teams:[],                   points:35,  rank:96, totalMembers:120, nextRankPts:12, tier:'Recrut',        nextTier:'Voluntar',     tierMin:0,   tierMax:80,  promo:{ kind:'time', months:4, monthsReq:6, note:'Devii Voluntar automat după 6 luni în organizație (4/6 luni).' } },
    voluntar:    { name:'Andrei Mureșan', initials:'AM', avatarColor:'#007F33', role:'voluntar', depts:['hr','pr'],      teams:['t-contact'],        points:140, rank:54, totalMembers:120, nextRankPts:18, tier:'Voluntar',      nextTier:'Membru Activ', tierMin:80,  tierMax:300, percentile:'top 45%', promo:{ kind:'percentile', target:35, note:'Intri automat în Membru Activ dacă termini semestrul în top 35%.' } },
    activ:       { name:'Bianca Roș',     initials:'BR', avatarColor:'#FF3B3B', role:'activ',    depts:['pr'],           teams:['t-media'],          points:355, rank:14, totalMembers:120, nextRankPts:25, tier:'Membru Activ',  nextTier:'Drept de vot', tierMin:300, tierMax:600, percentile:'top 20%', promo:{ kind:'top', target:25, note:'Completează „Formularul de aderare” ca să participi la Adunarea Generală.' } },
    vot:         { name:'Ioana Dragoș',   initials:'ID', avatarColor:'#7500A0', role:'vot',      depts:['pr'],           teams:['t-media'],          points:610, rank:2,  totalMembers:120, nextRankPts:0,  tier:'Drept de vot',  nextTier:'—',            tierMin:300, tierMax:900, percentile:'top 3%',  promo:{ kind:'max', note:'Rămâi cu drept de vot dacă ești în top 25% la fiecare AGO.' } },
    responsabil: { name:'Vlad Crișan',    initials:'VC', avatarColor:'#FF3B3B', role:'responsabil', depts:['youth'],     teams:['t-futureup'],       points:520, rank:3,  totalMembers:120, nextRankPts:0,  tier:'Responsabil de proiect', nextTier:'—', tierMin:300, tierMax:900, promo:{ kind:'max', note:'Coordonezi proiectul FutureUP — numit de BC.' } },
    bce:         { name:'Alex Băncilă',   initials:'AB', avatarColor:'#ED2025', role:'bce',      depts:['it'],           teams:['t-app','t-sites'],  points:480, rank:4,  totalMembers:120, nextRankPts:0,  tier:'BCE',           nextTier:'—',            tierMin:300, tierMax:900, coordinates:'Coordonator IT', promo:{ kind:'max', note:'Coordonator IT — numit de BC. Membru în Biroul de Conducere Extins.' } },
    bc:          { name:'Diana Anton',    initials:'DA', avatarColor:'#000000', role:'bc',       depts:['hr','fin'],     teams:[],                   points:780, rank:1,  totalMembers:120, nextRankPts:0,  tier:'BC',            nextTier:'—',            tierMin:0,   tierMax:900, coordinates:'Vicepreședinte Interne', promo:{ kind:'max', note:'Vicepreședinte — ales de Adunarea Generală.' } },
    moderator:   { name:'Moderator OSUBB',initials:'M',  avatarColor:'#0B0B0C', role:'moderator',depts:[],               teams:[],                   points:0,   rank:0,  totalMembers:120, nextRankPts:0,  tier:'Moderator',     nextTier:'—',            tierMin:0,   tierMax:1,   promo:{ kind:'max', note:'Cont unic de administrare — acces complet la întreaga aplicație.' } },
  },

  teams: [
    { id:'t-app',      name:'Echipa Aplicație',  dept:'it',    lead:'Alex Băncilă',  memberIds:[3,5,8,11], forRecruits:false },
    { id:'t-sites',    name:'Echipa Site-uri',   dept:'it',    lead:'Alex Băncilă',  memberIds:[3,9],      forRecruits:false },
    { id:'t-contact',  name:'Echipa Contactări', dept:'hr',    lead:'Andrei Mureșan',memberIds:[2,6,7],    forRecruits:true  },
    { id:'t-media',    name:'Echipa Media',      dept:'pr',    lead:'Ioana Dragoș',  memberIds:[4,10],     forRecruits:false },
    { id:'t-futureup', name:'FutureUP',          dept:'youth', lead:'Vlad Crișan',   memberIds:[12,13,14], forRecruits:true  },
    { id:'t-interne',  name:'Echipa Interne',    dept:'hr',    lead:'Diana Anton',   memberIds:[1],        forRecruits:false, interne:true },
  ],

  taskTemplates: [
    { name:'Ședință',     type:'sedinta',   difficulty:1, rating:3 },
    { name:'Minută',      type:'minuta',    difficulty:2, rating:3 },
    { name:'Contactări',  type:'contact',   difficulty:3, rating:4 },
    { name:'Promovare',   type:'promovare', difficulty:2, rating:3 },
    { name:'Postare',     type:'postare',   difficulty:3, rating:4 },
    { name:'Logistică',   type:'logistica', difficulty:4, rating:4 },
  ],

  /* rating multipliers, for the points guide */
  ratingGuide: [
    { rating:1, mult:-1, label:'Foarte slab', note:'Task realizat greșit / în detrimentul echipei — se scad puncte.' },
    { rating:2, mult:0,  label:'Insuficient', note:'Nefinalizat sau sub standard — nu se acordă puncte.' },
    { rating:3, mult:1,  label:'Bun',         note:'Realizat corect, conform cerinței.' },
    { rating:4, mult:2,  label:'Foarte bun',  note:'Peste așteptări, calitate ridicată.' },
    { rating:5, mult:3,  label:'Excelent',    note:'Excepțional, impact major pentru organizație.' },
  ],
  difficultyGuide: [
    { stars:1, note:'Foarte ușor (ex. confirmare prezență, share story).' },
    { stars:2, note:'Ușor (ex. minută, postare simplă).' },
    { stars:3, note:'Mediu (ex. contactări, grafică).' },
    { stars:4, note:'Greu (ex. logistică eveniment, dezvoltare ecran).' },
    { stars:5, note:'Foarte greu (ex. coordonare proiect, migrare bază de date).' },
  ],

  /* status: todo | progress | done | overdue | open(unassigned, first-taker)
     points = difficulty × ratingMult(rating) — precomputed here for convenience. */
  tasks: [
    { id:1,  title:'Minută ședință BC #14',           type:'minuta',    dept:'it',  team:null,        assignees:['Alex Băncilă'],              deadline:{m:6,d:29}, status:'progress', difficulty:2, rating:4, points:4,   desc:'Redactare minută și trimitere către BC.' },
    { id:2,  title:'Contactări campanie recrutare',   type:'contact',   dept:'hr',  team:'t-contact', assignees:['Andrei Mureșan','Maria Pop'],deadline:{m:6,d:30}, status:'todo',     difficulty:3, rating:4, points:6,   desc:'Listă de 50 de potențiali voluntari.' },
    { id:3,  title:'Wireframe ecran Calendar',        type:'logistica', dept:'it',  team:'t-app',     assignees:['Alex Băncilă'],              deadline:{m:6,d:27}, status:'overdue',  difficulty:4, rating:4, points:8,   desc:'Mockup pentru sprintul 2.' },
    { id:4,  title:'Postare „Săptămâna Bobocului”',   type:'postare',   dept:'pr',  team:'t-media',   assignees:['Ioana Dragoș'],              deadline:{m:7,d:2},  status:'todo',     difficulty:2, rating:4, points:4,   desc:'Grafică + copy conform plan media.' },
    { id:5,  title:'Migrare taskuri din Google Sheets',type:'logistica',dept:'it',  team:'t-app',     assignees:['Alex Băncilă','Paul Ilea'],  deadline:{m:7,d:5},  status:'progress', difficulty:5, rating:4, points:10,  desc:'Import în baza de date a aplicației.' },
    { id:6,  title:'Promovare workshop CV',           type:'promovare', dept:'hr',  team:'t-contact', assignees:['Maria Pop'],                 deadline:{m:6,d:28}, status:'todo',     difficulty:2, rating:3, points:2,   desc:'Distribuire în grupuri facultăți.' },
    { id:7,  title:'Logistică UBB Festival',          type:'logistica', dept:'youth',team:'t-futureup',assignees:['Vlad Crișan','Sara Marc'],  deadline:{m:7,d:8},  status:'todo',     difficulty:4, rating:5, points:12,  desc:'Coordonare standuri și voluntari.' },
    { id:8,  title:'Raport 3.5% — verificare formulare',type:'minuta',  dept:'fin', team:null,        assignees:['Diana Anton'],               deadline:{m:7,d:1},  status:'progress', difficulty:3, rating:3, points:3,   desc:'Verificare formulare depuse.' },
    { id:9,  title:'Update site CaravanaUBB',          type:'logistica',dept:'it',  team:'t-sites',   assignees:['Paul Ilea'],                 deadline:{m:7,d:4},  status:'todo',     difficulty:3, rating:4, points:6,   desc:'Migrare la GitHub Pages.' },
    { id:10, title:'Ședință echipă Media',            type:'sedinta',   dept:'pr',  team:'t-media',   assignees:['Ioana Dragoș','Bianca Roș'], deadline:{m:6,d:26}, status:'done',     difficulty:1, rating:3, points:1,   desc:'Planificare conținut iulie.' },
    { id:11, title:'Grilă interviu — actualizare',    type:'minuta',    dept:'hr',  team:null,        assignees:['Andrei Mureșan'],            deadline:{m:6,d:25}, status:'done',     difficulty:2, rating:4, points:4,   desc:'Criterii noi pentru recrutare.' },
    { id:12, title:'Design banner Mind Matters',      type:'postare',   dept:'pr',  team:'t-media',   assignees:['Bianca Roș'],                deadline:{m:7,d:10}, status:'todo',     difficulty:3, rating:4, points:6,   desc:'Conform brand book proiect.' },
    { id:13, title:'Predare PV cu întârziere',        type:'minuta',    dept:'youth',team:null,       assignees:['Sara Marc'],                 deadline:{m:6,d:24}, status:'done',     difficulty:2, rating:1, points:-2,  desc:'Predat cu 3 zile întârziere — penalizare.' },
    { id:14, title:'Promovare nefinalizată',          type:'promovare', dept:'fin', team:null,        assignees:['Cosmin Vass'],               deadline:{m:6,d:23}, status:'done',     difficulty:3, rating:2, points:0,   desc:'Nu a fost dusă la capăt — 0 puncte.' },
    /* open / first-taker (assignee empty) */
    { id:15, title:'Disponibil: Redactare PV ședință', type:'minuta',   dept:'hr',  team:'t-contact', assignees:[],                            deadline:{m:7,d:3},  status:'open',     difficulty:2, rating:3, points:2,   desc:'Fără responsabil — primul care preia, îl primește.' },
    { id:16, title:'Disponibil: Grafică afiș eveniment',type:'postare',  dept:'pr', team:'t-media',   assignees:[],                            deadline:{m:7,d:6},  status:'open',     difficulty:3, rating:4, points:6,   desc:'Task deschis — preia-l dacă ești disponibil.' },
  ],

  taskRequests: [
    { id:1, title:'Acordare puncte — distribuire afișe', from:'Maria Pop',      dept:'hr', points:6,  note:'Am distribuit afișele în 3 facultăți.' },
    { id:2, title:'Acordare puncte — story eveniment',   from:'Sara Marc',      dept:'youth',points:4, note:'Story UBB Festival, 1.2k vizualizări.' },
    { id:3, title:'Task nou: traducere ROF EN',          from:'Andrei Mureșan', dept:'it', points:8,  note:'Propun task pentru echipă.' },
  ],

  /* events — type: sedinta|activitate|call|eveniment|deadline|recrutare ; scope: team|dept|project|org
     audience controls who can see it (used for role-based calendar visibility):
       scope 'org'|'call' → everyone ; 'dept' → that dept ; 'team' → team members ; 'project' → project team */
  events: [
    { id:1,  title:'Ședință BC',                 type:'sedinta',    dept:'it',   m:6, d:30, time:'18:00', end:'19:30', location:'Sediu OSUBB',    scope:'team',    team:null,         going:11, capacity:14, joined:true,  qr:true,  desc:'Ședință săptămânală Birou Coordonator.' },
    { id:2,  title:'Contactări — campanie',      type:'activitate', dept:'hr',   m:6, d:30, time:'12:00', end:'14:00', location:'Online',        scope:'team',    team:'t-contact',  going:6,  joined:true,  qr:false, desc:'Sesiune de contactări recrutare.' },
    { id:3,  title:'Call proiecte — toamnă',     type:'call',       dept:'it',   m:6, d:29, time:'—',     end:'',      location:'Formular',      scope:'org',     team:null,         going:23, joined:false, qr:false, desc:'Aplică pentru a coordona un proiect.' },
    { id:4,  title:'Workshop CV & LinkedIn',     type:'eveniment',  dept:'hr',   m:6, d:27, time:'17:00', end:'19:00', location:'Sala 5/II',     scope:'org',     team:null,         going:42, capacity:60, joined:false, qr:true,  desc:'Workshop deschis tuturor voluntarilor.' },
    { id:5,  title:'Ședință echipă Aplicație',   type:'sedinta',    dept:'it',   m:6, d:28, time:'19:00', end:'20:00', location:'Discord',       scope:'team',    team:'t-app',      going:4,  joined:true,  qr:false, desc:'Sprint review — ecranul Task Tracker.' },
    { id:6,  title:'Deadline: Minută BC #14',    type:'deadline',   dept:'it',   m:6, d:29, time:'23:59', end:'',      location:'',              scope:'team',    team:'t-app',      going:0,  joined:false, qr:false, desc:'Termen limită predare minută.' },
    { id:7,  title:'UBB Festival — logistică',   type:'activitate', dept:'youth',m:7, d:8,  time:'09:00', end:'18:00', location:'Campus UBB',    scope:'project', team:'t-futureup', going:18, capacity:30, joined:false, qr:true,  desc:'Zi de eveniment, prezență obligatorie echipă.' },
    { id:8,  title:'Call echipă Media',          type:'call',       dept:'pr',   m:6, d:26, time:'20:00', end:'21:00', location:'Discord',       scope:'team',    team:'t-media',    going:5,  joined:false, qr:false, desc:'Planificare conținut.' },
    { id:9,  title:'Sfertul Academic',           type:'eveniment',  dept:'edu',  m:7, d:2,  time:'18:00', end:'20:00', location:'Aula Magna',    scope:'org',     team:null,         going:65, capacity:120,joined:false, qr:true,  desc:'Dezbatere academică deschisă.' },
    { id:10, title:'Deadline: Raport 3.5%',      type:'deadline',   dept:'fin',  m:7, d:1,  time:'23:59', end:'',      location:'',              scope:'dept',    team:null,         going:0,  joined:false, qr:false, desc:'Predare formulare 3.5%.' },
    { id:11, title:'Training: GitHub & Git',     type:'eveniment',  dept:'it',   m:7, d:3,  time:'18:00', end:'20:00', location:'Sala IT',       scope:'team',    team:'t-app',      going:9,  capacity:15, joined:true,  qr:true,  desc:'Version control pentru echipa tehnică.' },
    { id:12, title:'Recrutări toamnă 2026',      type:'recrutare',  dept:'hr',   m:7, d:5,  time:'10:00', end:'16:00', location:'Campus UBB',    scope:'org',     team:null,         going:0,  joined:false, qr:false, desc:'Eveniment de recrutare — interviuri și înscrieri. Recruții primesc conturi generate automat.' },
  ],

  /* priority: critical | important | normal — Pagina de anunțuri (Direcții și priorități §4) */
  announcements: [
    { id:1, title:'Modificare ROF — Capitolul 4',        body:'Articolele privind pragul de membru activ au fost actualizate. Vă rugăm să citiți noua variantă înainte de următoarea AGO.', dept:'it',  author:'Secretar General', date:{m:6,d:28}, priority:'critical',  category:'Modificare regulament', pinned:true,  read:false, form:null },
    { id:2, title:'Call proiecte toamnă 2026 — deschis',  body:'S-a deschis call-ul pentru coordonatori de proiect. Completează formularul până pe 5 iulie.', dept:'it', author:'BC', date:{m:6,d:28}, priority:'important', category:'Oportunitate de implicare', pinned:true, read:false, form:'Formular call proiecte' },
    { id:3, title:'Workshop CV & LinkedIn — înscrieri',   body:'Resurse Umane organizează un workshop deschis. Locuri limitate, înscriere din Calendar.', dept:'hr', author:'Resurse Umane', date:{m:6,d:27}, priority:'normal', category:'Informație importantă', pinned:false, read:false, form:null },
    { id:4, title:'Plan media iulie — disponibil',         body:'Echipa de Imagine & PR a publicat planul media pentru iulie. Verifică taskurile preluate.', dept:'pr', author:'Imagine & PR', date:{m:6,d:26}, priority:'normal', category:'Anunț oficial', pinned:false, read:true, form:null },
    { id:5, title:'Formular 3.5% — activ',                 body:'Voluntarii angajați sunt rugați să completeze formularul 3.5% până pe 1 iulie.', dept:'fin', author:'Financiar', date:{m:6,d:25}, priority:'important', category:'Formular activ', pinned:false, read:true, form:'Formular 3.5%' },
    { id:6, title:'Recrutări toamnă — call deschis',       body:'S-a deschis înscrierea pentru recrutările din toamnă. Eveniment în calendar pe 5 iulie.', dept:'hr', author:'Resurse Umane', date:{m:6,d:24}, priority:'normal', category:'Call deschis', pinned:false, read:true, form:'Formular înscriere recrutări' },
  ],

  deptCup: [
    { dept:'pr',    points:1980, members:18, trend:+1 },
    { dept:'hr',    points:1810, members:16, trend:-1 },
    { dept:'youth', points:1640, members:15, trend:+2 },
    { dept:'edu',   points:1520, members:13, trend:0  },
    { dept:'fin',   points:1190, members:9,  trend:-2 },
  ],

  leaderboard: [
    { rank:1, name:'Diana Anton',    initials:'DA', dept:'hr',    points:780 },
    { rank:2, name:'Ioana Dragoș',   initials:'ID', dept:'pr',    points:610 },
    { rank:3, name:'Vlad Crișan',    initials:'VC', dept:'youth', points:520 },
    { rank:4, name:'Alex Băncilă',   initials:'AB', dept:'it',    points:480 },
    { rank:5, name:'Paul Ilea',      initials:'PI', dept:'it',    points:390 },
    { rank:6, name:'Bianca Roș',     initials:'BR', dept:'pr',    points:355 },
    { rank:7, name:'Sara Marc',      initials:'SM', dept:'youth', points:310 },
    { rank:8, name:'Andrei Mureșan', initials:'AM', dept:'hr',    points:140 },
  ],

  volunteers: [
    { id:1,  name:'Diana Anton',    initials:'DA', avatarColor:'#000000', dept:'hr',    role:'bc',         points:780, status:'activ',   email:'diana.anton@osubb.ro',   phone:'0740 111 222', joined:'2023', team:'Echipa Interne' },
    { id:2,  name:'Ioana Dragoș',   initials:'ID', avatarColor:'#7500A0', dept:'pr',    role:'vot',        points:610, status:'activ',   email:'ioana.dragos@osubb.ro',  phone:'0740 333 444', joined:'2023', team:'Echipa Media' },
    { id:3,  name:'Vlad Crișan',    initials:'VC', avatarColor:'#FF3B3B', dept:'youth', role:'responsabil',points:520, status:'activ',   email:'vlad.crisan@osubb.ro',   phone:'0740 555 666', joined:'2024', team:'FutureUP' },
    { id:4,  name:'Alex Băncilă',   initials:'AB', avatarColor:'#ED2025', dept:'it',    role:'bce',        points:480, status:'activ',   email:'alex.bancila@osubb.ro',  phone:'0740 777 888', joined:'2024', team:'Echipa Aplicație' },
    { id:5,  name:'Paul Ilea',      initials:'PI', avatarColor:'#284C93', dept:'it',    role:'activ',      points:390, status:'activ',   email:'paul.ilea@osubb.ro',     phone:'0741 100 200', joined:'2024', team:'Echipa Site-uri' },
    { id:6,  name:'Bianca Roș',     initials:'BR', avatarColor:'#FF3B3B', dept:'pr',    role:'activ',      points:355, status:'activ',   email:'bianca.ros@osubb.ro',    phone:'0741 300 400', joined:'2024', team:'Echipa Media' },
    { id:7,  name:'Sara Marc',      initials:'SM', avatarColor:'#007F33', dept:'youth', role:'voluntar',   points:310, status:'activ',   email:'sara.marc@osubb.ro',     phone:'0741 500 600', joined:'2025', team:'FutureUP' },
    { id:8,  name:'Andrei Mureșan', initials:'AM', avatarColor:'#007F33', dept:'hr',    role:'voluntar',   points:140, status:'activ',   email:'andrei.muresan@osubb.ro',phone:'0741 700 800', joined:'2025', team:'Echipa Contactări' },
    { id:9,  name:'Cosmin Vass',    initials:'CV', avatarColor:'#284C93', dept:'fin',   role:'voluntar',   points:120, status:'inactiv', email:'cosmin.vass@osubb.ro',   phone:'0742 110 220', joined:'2025', team:'—' },
    { id:10, name:'Larisa Pinte',   initials:'LP', avatarColor:'#7500A0', dept:'pr',    role:'voluntar',   points:98,  status:'activ',   email:'larisa.pinte@osubb.ro',  phone:'0742 330 440', joined:'2025', team:'Echipa Media' },
    { id:11, name:'George Sima',    initials:'GS', avatarColor:'#ED2025', dept:'it',    role:'voluntar',   points:85,  status:'activ',   email:'george.sima@osubb.ro',   phone:'0742 550 660', joined:'2025', team:'Echipa Aplicație' },
    { id:12, name:'Maria Pop',      initials:'MP', avatarColor:'#284C93', dept:'edu',   role:'recrut',     points:35,  status:'activ',   email:'maria.pop@osubb.ro',     phone:'0742 770 880', joined:'2026', team:'—' },
    { id:13, name:'Denis Ardel',    initials:'DA', avatarColor:'#F2A700', dept:'youth', role:'recrut',     points:28,  status:'activ',   email:'denis.ardel@osubb.ro',   phone:'0743 100 300', joined:'2026', team:'—' },
    { id:14, name:'Otilia Crețu',   initials:'OC', avatarColor:'#FF3B3B', dept:'youth', role:'recrut',     points:20,  status:'activ',   email:'otilia.cretu@osubb.ro',  phone:'0743 400 500', joined:'2026', team:'—' },
  ],

  notifications: [
    { id:1, icon:'alert',    title:'Modificare ROF — Capitolul 4',  body:'Anunț critic. Citește înainte de AGO.',           time:'acum 5 min', critical:true,  read:false, dept:'it',  kind:'announce' },
    { id:2, icon:'clock',    title:'Deadline apropiat: Minută BC #14',body:'Termen limită mâine, 23:59.',                    time:'acum 1 oră', critical:false, read:false, dept:'it',  kind:'deadline' },
    { id:3, icon:'calendar', title:'Ședință BC — mâine 18:00',       body:'Confirmă prezența: Vin / Nu pot veni.',           time:'acum 3 ore', critical:false, read:false, dept:'it',  kind:'event' },
    { id:4, icon:'sparkle',  title:'Ești la 30p de locul 3!',         body:'Încă un task și urci în clasament.',              time:'azi 09:12',  critical:false, read:true,  dept:'it',  kind:'task' },
    { id:5, icon:'megaphone',title:'Call proiecte toamnă — deschis', body:'Aplică până pe 5 iulie.',                         time:'ieri',       critical:false, read:true,  dept:'it',  kind:'announce' },
    { id:6, icon:'check',    title:'Puncte acordate: +6',             body:'Ședință echipă Media confirmată.',                time:'ieri',       critical:false, read:true,  dept:'pr',  kind:'task' },
  ],

  /* Interne (Vicepreședinte Interne + Echipa Interne): two auto-updated sheets. */
  agThreshold: {
    required: 300,                       // prag Membru Activ / acces AG
    agQuorum: 25,                        // top 25% rămân cu drept de vot
    members: [
      { name:'Diana Anton',  points:780, role:'bc',  ag:true  },
      { name:'Ioana Dragoș', points:610, role:'vot', ag:true  },
      { name:'Vlad Crișan',  points:520, role:'responsabil', ag:true },
      { name:'Alex Băncilă', points:480, role:'bce', ag:true  },
      { name:'Paul Ilea',    points:390, role:'activ', ag:true },
      { name:'Bianca Roș',   points:355, role:'activ', ag:true },
      { name:'Sara Marc',    points:310, role:'voluntar', ag:false },
      { name:'Andrei Mureșan',points:140,role:'voluntar', ag:false },
      { name:'Larisa Pinte', points:98,  role:'voluntar', ag:false },
    ],
  },
};
