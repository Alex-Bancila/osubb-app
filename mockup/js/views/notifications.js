/* ============================================================================
   View: Notificări (§3.7) — centru de notificări cu priorități.
   Accesibil din clopoțelul din topbar ("Vezi toate").
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data;
  let ROLE = OSUBB.state.role;
  const notis = () => OSUBB.visibleNotifications(ROLE);

  // Catalog de tipuri (etichetă, icon de tip, view țintă pentru navigare).
  const TYPES = {
    task:     { label: 'Taskuri',     icon: 'sparkle',   go: 'tasktracker',  desc: 'Puncte acordate, taskuri noi și statusuri.' },
    event:    { label: 'Evenimente',  icon: 'calendar',  go: 'calendar',     desc: 'Ședințe și activități la care participi.' },
    call:     { label: 'Call-uri',    icon: 'megaphone', go: 'calendar',     desc: 'Call-uri de proiecte și de echipă.' },
    deadline: { label: 'Deadline-uri',icon: 'clock',     go: 'tasktracker',  desc: 'Memento înainte de fiecare termen.' },
    announce: { label: 'Anunțuri',    icon: 'megaphone', go: 'announcements',desc: 'Anunțuri oficiale și modificări de regulament.' },
    sanction: { label: 'Sancțiuni',   icon: 'alert',     go: 'profile',      desc: 'Avertismente și sancțiuni disciplinare.' },
  };

  // Derivă tipul unei notificări din icon + flag-ul critical (schema data.js).
  function typeOf(n) {
    if (n.icon === 'clock') return 'deadline';
    if (n.icon === 'calendar') return 'event';
    if (n.icon === 'sparkle' || n.icon === 'check') return 'task';
    return 'announce'; // alert / megaphone → anunț
  }

  // "Azi" vs "Mai devreme" — heuristic pe câmpul liber `time`.
  function isToday(n) { return /acum|azi/i.test(n.time); }

  function unreadCount() { return notis().filter(n => !n.read).length; }
  function critUnreadCount() { return notis().filter(n => !n.read && n.critical).length; }

  function notiRow(n) {
    const type = typeOf(n);
    const t = TYPES[type];
    const accent = n.critical ? 'border-left:3px solid var(--red);' : '';
    return `
      <div class="noti ${n.read ? '' : 'unread'}" data-noti="${n.id}" data-type="${type}" data-go="${t.go}"
           style="align-items:flex-start;${accent}">
        <div class="noti-ic ${n.critical ? 'crit' : ''}">${OSUBB.icon(n.icon, 18)}</div>
        <div class="grow" style="min-width:0">
          <div class="row between gap-3">
            <span class="${n.read ? 't-semi' : 't-bold'} truncate">${n.title}</span>
            <span class="t-xs t-faint" style="flex:none">${n.time}</span>
          </div>
          <div class="t-sm t-muted" style="margin-top:2px">${n.body}</div>
          <div class="row gap-2 wrap mt-2">
            <span class="tag tag--soft ${U.deptTag(n.dept)}">${U.dept(n.dept).short}</span>
            ${n.critical ? `<span class="badge badge--red">${OSUBB.icon('alert', 12)} Important</span>` : ''}
            <span class="badge badge--soft">${t.label}</span>
          </div>
        </div>
        ${n.read ? '' : '<span class="dot dot--red" style="align-self:flex-start;margin-top:7px" title="Necitit"></span>'}
      </div>`;
  }

  function groupCard(title, items) {
    if (!items.length) return '';
    return `
      <div class="card" data-group>
        <div class="card-head">
          <span class="card-title">${title}</span>
          <span class="badge badge--soft" data-group-count>${items.length}</span>
        </div>
        <div data-group-rows>${items.map(notiRow).join('')}</div>
      </div>`;
  }

  function filterPills() {
    const list = notis();
    const order = Object.keys(TYPES);
    const present = order.filter(id => list.some(n => typeOf(n) === id));
    const pill = (id, label, ic, count) =>
      `<button class="filter-pill ${id === 'all' ? 'is-active' : ''}" data-filter="${id}">
         ${ic ? OSUBB.icon(ic, 15) : ''}${label}
         <span class="badge badge--soft">${count}</span>
       </button>`;
    return `
      <div class="toolbar">
        ${pill('all', 'Toate', 'bell', list.length)}
        ${present.map(id => pill(id, TYPES[id].label, TYPES[id].icon,
          list.filter(n => typeOf(n) === id).length)).join('')}
      </div>`;
  }

  function prefRow(id, label, icon, desc, checked) {
    return `
      <div class="row between gap-3" style="padding:var(--s-2) 0">
        <div class="row gap-3" style="min-width:0">
          <span class="noti-ic" style="width:32px;height:32px">${OSUBB.icon(icon, 16)}</span>
          <div class="col" style="min-width:0">
            <span class="t-semi t-sm">${label}</span>
            <span class="t-xs t-faint">${desc}</span>
          </div>
        </div>
        <label class="switch"><input type="checkbox" data-pref="${id}" ${checked ? 'checked' : ''}><span class="track"></span></label>
      </div>`;
  }

  function prefsCard(ctx) {
    const managerial = ctx.role === 'bc' || ctx.role === 'responsabil';
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">${OSUBB.icon('settings', 18)} Preferințe notificări</span></div>
        <div class="card-body" style="padding-top:var(--s-3);padding-bottom:var(--s-4)">
          <div class="col">
            ${Object.keys(TYPES).map(id => prefRow(id, TYPES[id].label, TYPES[id].icon, TYPES[id].desc,
              id !== 'sanction')).join('')}
          </div>
          <div class="divider"></div>
          ${prefRow('mine', 'Doar taskurile mele', 'target',
            'Primești doar ce te privește direct.', managerial)}
          <p class="hint mt-2">${managerial
            ? 'Ca rol de coordonare, „Doar taskurile mele” reduce notificările de la întreaga organizație — fără spam.'
            : 'Activează „Doar taskurile mele” dacă primești prea multe notificări.'}</p>
        </div>
      </div>`;
  }

  function summaryCard() {
    const cells = [
      { label: 'Necitite', value: unreadCount(), cls: '' },
      { label: 'Critice', value: critUnreadCount(), cls: 't-red' },
      { label: 'Azi', value: notis().filter(isToday).length, cls: '' },
    ];
    return `
      <div class="card card-pad">
        <div class="row between">
          ${cells.map((c, i) => `
            ${i ? '<div class="divider-v"></div>' : ''}
            <div class="col center" style="flex:1;text-align:center">
              <span class="stat-label">${c.label}</span>
              <span class="t-extra t-num ${c.cls}" style="font-size:var(--fs-xl)">${c.value}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  OSUBB.registerView('notifications', {
    label: 'Notificări', icon: 'bell', title: 'Notificări',

    count(ctx) { return OSUBB.visibleNotifications(ctx.role).filter(n => !n.read).length; },

    render(ctx) {
      ROLE = ctx.role;
      const today = notis().filter(isToday);
      const earlier = notis().filter(n => !isToday(n));
      const unread = unreadCount();
      const crit = critUnreadCount();

      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Notificări</h1>
              <p class="page-sub">${unread
                ? `Ai <b>${unread}</b> ${unread === 1 ? 'notificare necitită' : 'notificări necitite'}${crit ? `, din care ${crit} ${crit === 1 ? 'critică' : 'critice'}` : ''}.`
                : 'Ești la zi cu toate notificările. 🎉'}</p>
            </div>
            <div class="row gap-2 wrap">
              <button class="btn btn-outline" id="test-crit">${OSUBB.icon('alert', 18)} Testează pop-up critic</button>
              <button class="btn btn-ghost" id="mark-all">${OSUBB.icon('check', 18)} Marchează toate ca citite</button>
            </div>
          </div>

          ${crit ? `
            <div class="alert alert--danger" style="margin-bottom:var(--s-5)">
              <span class="alert-ic">${OSUBB.icon('alert', 20)}</span>
              <div>
                <div class="t-semi">${crit === 1 ? 'Ai un anunț critic necitit' : `Ai ${crit} anunțuri critice necitite`}</div>
                <div class="t-sm">Anunțurile critice cer atenție imediată — apar și ca pop-up roșu peste tot în aplicație.</div>
              </div>
            </div>` : ''}

          ${filterPills()}

          <div class="grid grid-wide">
            <div class="col gap-5">
              ${groupCard('Azi', today)}
              ${groupCard('Mai devreme', earlier)}
              <div class="empty hide" id="no-results">
                <div class="empty-ic">${OSUBB.icon('bell', 24)}</div>
                Nicio notificare pentru acest filtru.
              </div>
            </div>
            <div class="col gap-5">
              ${summaryCard()}
              ${prefsCard(ctx)}
            </div>
          </div>
        </div>`;
    },

    mount(root, ctx) {
      // Filtru pe tip — ascunde/arată rândurile fără re-render.
      function applyFilter(type) {
        root.querySelectorAll('[data-noti]').forEach(row => {
          const show = type === 'all' || row.getAttribute('data-type') === type;
          row.classList.toggle('hide', !show);
        });
        let anyVisible = false;
        root.querySelectorAll('[data-group]').forEach(g => {
          const vis = g.querySelectorAll('[data-noti]:not(.hide)').length;
          g.classList.toggle('hide', vis === 0);
          const c = g.querySelector('[data-group-count]');
          if (c) c.textContent = vis;
          if (vis) anyVisible = true;
        });
        const none = root.querySelector('#no-results');
        if (none) none.classList.toggle('hide', anyVisible);
      }

      root.querySelectorAll('[data-filter]').forEach(p => p.addEventListener('click', () => {
        root.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('is-active'));
        p.classList.add('is-active');
        applyFilter(p.getAttribute('data-filter'));
      }));

      // Click pe notificare → marchează citită + navighează la viewul relevant.
      root.querySelectorAll('[data-noti]').forEach(row => row.addEventListener('click', () => {
        const n = D.notifications.find(x => x.id == row.getAttribute('data-noti'));
        if (n) n.read = true;
        ctx.navigate(row.getAttribute('data-go'));
      }));

      // Marchează toate ca citite.
      root.querySelector('#mark-all').addEventListener('click', () => {
        if (!unreadCount()) { ctx.toast({ title: 'Ești la zi', body: 'Nu ai notificări necitite.', icon: 'check' }); return; }
        D.notifications.forEach(n => n.read = true);
        ctx.toast({ title: 'Notificări citite', body: 'Toate notificările au fost marcate ca citite.', icon: 'check' });
        ctx.navigate('notifications');
      });

      // Demo pop-up critic.
      root.querySelector('#test-crit').addEventListener('click', () => {
        ctx.toast({
          critical: true, icon: 'alert', title: 'Anunț critic',
          body: 'Modificare ROF — Capitolul 4. Citește înainte de AGO!',
        });
      });

      // Toggle preferințe → toast.
      root.querySelectorAll('[data-pref]').forEach(sw => sw.addEventListener('change', () => {
        const id = sw.getAttribute('data-pref');
        const on = sw.checked;
        const label = id === 'mine' ? 'Doar taskurile mele' : (TYPES[id] ? TYPES[id].label : id);
        ctx.toast({
          title: on ? 'Notificări activate' : 'Notificări oprite',
          body: `${label} ${on ? '— le primești.' : '— nu te mai deranjăm.'}`,
          icon: on ? 'check' : 'bell',
        });
      }));
    },
  });
})();
