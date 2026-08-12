/* ============================================================================
   State + utilities  (globals: OSUBB.state, OSUBB.util, OSUBB.access)
   ========================================================================== */
(function () {
  const D = OSUBB.data;

  OSUBB.state = {
    role: 'bce',
    listeners: [],
    current() { return D.accounts[this.role]; },
    setRole(r) { this.role = r; this.emit(); },
    on(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach(fn => fn()); },
  };

  const MONTHS = ['ian.','feb.','mar.','apr.','mai','iun.','iul.','aug.','sep.','oct.','nov.','dec.'];
  const DOW = ['Lun','Mar','Mie','Joi','Vin','Sâm','Dum'];

  function idx(m, d) { return m === 6 ? d : 30 + d; }
  const TODAY_IDX = idx(OSUBB.today.m, OSUBB.today.d);

  // IT is a team (Coordonator IT), not a department → render red, never in dept lists.
  const IT_PSEUDO = { id:'it', name:'Coordonator IT', short:'IT', tag:'dept-org', color:'#ED2025' };
  const ORG_PSEUDO = { id:'org', name:'Organizație', short:'ORG', tag:'dept-org', color:'#ED2025' };

  OSUBB.util = {
    dept(id) {
      const d = D.departments.find(x => x.id === id);
      if (d) return d;
      if (id === 'it') return IT_PSEUDO;
      if (id === 'org') return ORG_PSEUDO;
      return { id, name:id, short:'?', tag:'dept-ext', color:'#5C5C61' };
    },
    deptTag(id)  { return this.dept(id).tag; },
    deptName(id) { return this.dept(id).name; },
    role(id)     { return (D.roles.find(r => r.id === id) || { name:id }).name; },
    initials(name) { return name.split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase(); },

    fmtDate(o)   { return `${o.d} ${MONTHS[(o.m||6)-1]}`; },
    dow(i)       { return DOW[i]; },

    relDay(o) {
      const diff = idx(o.m || 6, o.d) - TODAY_IDX;
      if (diff === 0) return 'azi';
      if (diff === 1) return 'mâine';
      if (diff === -1) return 'ieri';
      if (diff > 1) return `în ${diff} zile`;
      return `acum ${-diff} zile`;
    },
    isPast(o)  { return idx(o.m || 6, o.d) < TODAY_IDX; },
    isToday(o) { return idx(o.m || 6, o.d) === TODAY_IDX; },

    pts(n) { return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ro-RO'); },

    juneDow(d) { return (new Date(2026, 5, d).getDay() + 6) % 7; },

    avatar(name, color, cls) {
      const c = color || '#3A3A3D';
      return `<span class="avatar ${cls||''}" style="background:${c}">${this.initials(name)}</span>`;
    },

    // ---- scoring: points = difficulty(1..5) × ratingMult(rating) ----
    ratingMult(r) { return ({1:-1,2:0,3:1,4:2,5:3})[r]; },
    taskPoints(t) { return (t.difficulty || 0) * this.ratingMult(t.rating || 3); },
    stars(n, max) {
      max = max || 5; let s = '';
      for (let i = 1; i <= max; i++) s += `<span class="star ${i <= n ? 'on' : ''}">★</span>`;
      return `<span class="stars" title="${n}/${max}">${s}</span>`;
    },
    pointsBadge(p) {
      const cls = p > 0 ? 'badge--green' : p < 0 ? 'badge--red' : 'badge--grey';
      return `<span class="badge ${cls} t-num">${p > 0 ? '+' : ''}${p}p</span>`;
    },

    taskStatus(s) {
      return ({
        todo:     { label:'De făcut',  cls:'badge--grey'  },
        progress: { label:'În lucru',  cls:'badge--blue'  },
        done:     { label:'Finalizat', cls:'badge--green' },
        overdue:  { label:'Întârziat', cls:'badge--red'   },
        open:     { label:'Disponibil',cls:'badge--amber' },
      })[s] || { label:s, cls:'badge--grey' };
    },
  };

  // ---- capabilities by role ----
  const ALL = ['recrut','voluntar','activ','vot','responsabil','bce','bc','moderator'];
  OSUBB.cap = {
    seeAllEvents: ['responsabil','bce','bc','moderator'],   // full calendar (avoid overlaps)
    manageTasks:  ['responsabil','bce','bc','moderator'],   // create tasks / award points
    seeAllSheets: ['bc','moderator'],                       // all Fișele voluntarului
    seeInterne:   ['bc','moderator'],                       // VP Interne + Echipa Interne
    manageRoles:  ['bc','moderator'],                       // change BCE / Responsabili (BC); Moderator changes BC
    createTeams:  ['bce','bc','moderator'],
    noTaskNotifs: ['bc'],                                   // BC don't get task/event notifications
  };
  OSUBB.can = function (capId, role) { return (OSUBB.cap[capId] || []).indexOf(role) !== -1; };

  // Which roles see each nav view. Views absent here → all roles.
  OSUBB.access = {
    volunteers: ['bce', 'bc', 'moderator'],
    bcpanel:    ['bc', 'moderator'],
  };
  OSUBB.canAccess = function (viewId, role) {
    const a = OSUBB.access[viewId];
    return !a || a.indexOf(role) !== -1;
  };

  // BC members don't receive task/event notifications.
  OSUBB.visibleNotifications = function (role) {
    if (OSUBB.can('noTaskNotifs', role)) return D.notifications.filter(n => ['task', 'event', 'deadline'].indexOf(n.kind) === -1);
    return D.notifications;
  };

  // Can this user see this event on their calendar?
  OSUBB.eventVisible = function (ev, user, role) {
    if (OSUBB.can('seeAllEvents', role)) return true;
    if (ev.scope === 'org' || ev.type === 'call' || ev.type === 'recrutare') return true;
    if (ev.scope === 'dept') return user.depts.indexOf(ev.dept) !== -1;
    if (ev.team) {
      if ((user.teams || []).indexOf(ev.team) !== -1) return true;
      if (role === 'recrut') { const t = D.teams.find(x => x.id === ev.team); if (t && t.forRecruits) return true; }
      return false;
    }
    return user.depts.indexOf(ev.dept) !== -1;
  };
})();
