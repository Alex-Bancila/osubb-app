/* ============================================================================
   View: Calendar  — common org calendar (priorities doc §3)
   Anchored to JUNE 2026 (today = 28). Month grid + week list, dept filters,
   upcoming side panel, overlap-aware "Adaugă activitate" (§3.6).
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data;
  const TODAY = OSUBB.today;                       // {y:2026,m:6,d:28}
  const WD = ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum'];

  // current viewer (set in render) → drives role-based event visibility
  let CUR = { user: OSUBB.state.current(), role: OSUBB.state.role };
  const vis = (e) => OSUBB.eventVisible(e, CUR.user, CUR.role);
  const juneEvents = () => D.events.filter(e => e.m === 6 && vis(e));
  const julyEvents = () => D.events.filter(e => e.m === 7 && vis(e));

  function evIcon(e) {
    return e.type === 'deadline' ? 'flag'
      : e.type === 'call' ? 'megaphone'
      : e.type === 'recrutare' ? 'userplus'
      : e.type === 'sedinta' ? 'users'
      : e.type === 'eveniment' ? 'star'
      : 'calendar';
  }

  /* ---------- Month grid ---------- */
  function monthGrid(deptFilter) {
    const lead = U.juneDow(1);                     // 0 = Mon … 6 = Sun for June 1
    let cells = '';
    for (let i = 0; i < lead; i++) cells += `<div class="cal-cell out"></div>`;

    for (let d = 1; d <= 30; d++) {
      const evs = juneEvents().filter(e => e.d === d && (deptFilter === 'all' || e.dept === deptFilter));
      const today = d === TODAY.d ? ' today' : '';
      cells += `
        <div class="cal-cell${today}">
          <span class="cal-daynum">${d}</span>
          ${evs.map(e => `
            <div class="cal-event ${U.deptTag(e.dept)}" data-event="${e.id}" title="${e.title} · ${e.time !== '—' ? e.time : 'formular'}">${e.title}</div>`).join('')}
        </div>`;
    }

    const total = lead + 30;
    const trail = (7 - (total % 7)) % 7;            // fill final week with July
    for (let j = 1; j <= trail; j++) cells += `<div class="cal-cell out"><span class="cal-daynum t-faint">${j}</span></div>`;

    return `
      <div class="cal">
        <div class="cal-weekdays">${WD.map(w => `<div>${w}</div>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>`;
  }

  /* ---------- Week view (current week, Mon..Sun) ---------- */
  function weekChip(e) {
    const isCall = e.type === 'call', isDl = e.type === 'deadline';
    return `
      <div class="row between gap-3" data-event="${e.id}"
           style="padding:7px 10px;border-radius:var(--r-sm);background:var(--surface-2);cursor:pointer;border-left:3px solid ${U.dept(e.dept).color}">
        <div class="row gap-2" style="min-width:0">
          <span class="tag tag--soft ${U.deptTag(e.dept)}">${U.dept(e.dept).short}</span>
          <span class="t-semi truncate">${e.title}</span>
          ${isCall ? `<span class="badge badge--purple">call</span>` : ''}
          ${isDl ? `<span class="badge badge--red">deadline</span>` : ''}
        </div>
        <div class="row gap-2" style="flex:none">
          <span class="t-sm t-muted">${e.time !== '—' ? e.time : '—'}</span>
          ${isDl ? '' : e.joined
            ? `<span class="badge badge--green">${OSUBB.icon('check', 12)} Vin</span>`
            : `<button class="btn btn-outline btn-sm" data-going="${e.id}">Vin</button>`}
        </div>
      </div>`;
  }

  function weekView(deptFilter) {
    const monday = TODAY.d - U.juneDow(TODAY.d);    // 22
    let rows = '';
    for (let i = 0; i < 7; i++) {
      const d = monday + i;
      if (d < 1 || d > 30) continue;
      const isToday = d === TODAY.d;
      const evs = juneEvents()
        .filter(e => e.d === d && (deptFilter === 'all' || e.dept === deptFilter))
        .sort((a, b) => (a.time > b.time ? 1 : -1));
      rows += `
        <div class="list-row" style="align-items:flex-start;gap:var(--s-4)">
          <div style="width:52px;flex:none" class="t-center">
            <div class="t-xs t-faint t-up">${U.dow(U.juneDow(d))}</div>
            <div style="${isToday
              ? 'background:var(--red);color:#fff;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;margin:3px auto 0;font-weight:var(--fw-bold)'
              : 'font-weight:var(--fw-bold);font-size:var(--fs-md);margin-top:2px;color:var(--text-muted)'}">${d}</div>
          </div>
          <div class="grow col gap-2" style="min-width:0">
            ${evs.length ? evs.map(weekChip).join('') : `<div class="t-sm t-faint" style="padding:7px 0">— liber —</div>`}
          </div>
        </div>`;
    }
    return `
      <div class="card">
        <div class="card-head">
          <span class="card-title">${OSUBB.icon('calendar', 18)} Săptămâna ${monday}–${monday + 6} iunie</span>
          <span class="badge badge--soft">vizualizare săptămânală</span>
        </div>
        <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
          <div class="list">${rows}</div>
        </div>
      </div>`;
  }

  /* ---------- Side panel list row ---------- */
  function eventLine(e) {
    const isCall = e.type === 'call', isDl = e.type === 'deadline';
    const col = U.dept(e.dept).color;
    return `
      <div class="list-row clickable" data-event="${e.id}"
           ${isDl ? 'style="background:var(--danger-050);border-radius:var(--r-sm)"' : ''}>
        <div class="list-lead" style="background:${col}1a;color:${col}">${OSUBB.icon(evIcon(e), 20)}</div>
        <div class="list-main">
          <div class="row gap-2">
            <span class="list-title truncate">${e.title}</span>
            ${isCall ? `<span class="badge badge--purple">${OSUBB.icon('megaphone', 11)} call</span>` : ''}
            ${isDl ? `<span class="badge badge--red">${OSUBB.icon('alert', 11)} deadline</span>` : ''}
          </div>
          <div class="list-meta">
            <span class="tag tag--soft ${U.deptTag(e.dept)}">${U.dept(e.dept).short}</span>
            <span>${U.relDay({ m: e.m, d: e.d })}${e.time !== '—' ? ' · ' + e.time : ''}</span>
            ${e.going ? `<span class="t-faint">· ${e.going} participă</span>` : ''}
          </div>
        </div>
        ${isDl ? '' : e.joined
          ? `<span class="badge badge--green">${OSUBB.icon('check', 13)} Vin</span>`
          : `<button class="btn btn-outline btn-sm" data-going="${e.id}">Vin</button>`}
      </div>`;
  }

  /* ---------- Side panel ---------- */
  function sideCards() {
    const today = juneEvents().filter(e => e.d === TODAY.d);
    const upcoming = D.events
      .filter(e => vis(e) && !U.isPast({ m: e.m, d: e.d }))
      .sort((a, b) => (a.m * 100 + a.d) - (b.m * 100 + b.d))
      .slice(0, 6);
    const july = julyEvents().slice().sort((a, b) => a.d - b.d);

    return `
      <div class="card card-accent card-pad">
        <div class="t-xs t-up t-faint">Duminică · 28 iunie</div>
        <h3 class="mt-1">${today.length
          ? `${today.length} ${today.length === 1 ? 'eveniment' : 'evenimente'} azi`
          : 'Nimic în agendă azi'}</h3>
        <div class="t-sm t-muted mt-1">${today.length
          ? 'Nu uita să confirmi prezența 💪'
          : 'Zi liberă — profită de ea 🌿'}</div>
        ${today.length ? `<div class="list mt-3">${today.map(eventLine).join('')}</div>` : ''}
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">${OSUBB.icon('sparkle', 18)} Evenimente viitoare</span>
          <span class="badge badge--soft">${upcoming.length}</span>
        </div>
        <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
          <div class="list">${upcoming.map(eventLine).join('')}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">${OSUBB.icon('calendar', 18)} În iulie</span>
          ${OSUBB.can('seeAllEvents', CUR.role) ? `<button class="card-link" data-add>${OSUBB.icon('plus', 14)} Adaugă</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
          <div class="list">${july.map(eventLine).join('')}</div>
        </div>
      </div>`;
  }

  /* ---------- Add-activity modal with overlap detection (§3.6) ---------- */
  function openAddModal(ctx) {
    const deptOpts = D.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    OSUBB.modal({
      title: 'Adaugă activitate',
      body: `
        <div class="field">
          <label class="label">Titlu activitate</label>
          <input class="input" id="add-title" placeholder="ex. Ședință de departament" value="Ședință de departament">
        </div>
        <div class="field">
          <label class="label">Departament</label>
          <select class="select" id="add-dept">${deptOpts}</select>
        </div>
        <div class="grid grid-2 gap-3">
          <div class="field" style="margin-bottom:0">
            <label class="label">Data</label>
            <input class="input" type="date" id="add-date" value="2026-06-28" min="2026-06-01" max="2026-07-31">
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="label">Ora</label>
            <input class="input" type="time" id="add-time" value="18:00">
          </div>
        </div>
        <p class="hint mt-2">${OSUBB.icon('shield', 13)} Verificăm automat suprapunerile cu calendarul comun.</p>
        <div id="add-overlap" class="mt-3"></div>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button>
             <button class="btn btn-primary" id="add-confirm">${OSUBB.icon('plus', 16)} Adaugă activitate</button>`,
      onMount(modal, close) {
        const dateEl = modal.querySelector('#add-date');
        const timeEl = modal.querySelector('#add-time');
        const zone = modal.querySelector('#add-overlap');
        let forced = false;

        function parse() {
          const v = dateEl.value;
          if (!v) return null;
          return { m: parseInt(v.slice(5, 7), 10), d: parseInt(v.slice(8, 10), 10) };
        }
        function conflicts() {
          const p = parse();
          return p ? D.events.filter(e => e.m === p.m && e.d === p.d) : [];
        }
        function proceed() {
          const title = (modal.querySelector('#add-title').value || 'Activitate nouă').trim();
          const p = parse();
          close();
          ctx.toast({
            title: 'Activitate adăugată',
            body: `„${title}” · ${U.fmtDate(p)}, ${timeEl.value}${forced ? ' (suprapusă manual)' : ''}.`,
            icon: 'calendar',
          });
        }
        function render() {
          const c = conflicts();
          if (!c.length) { zone.innerHTML = ''; return; }
          const p = parse();
          zone.innerHTML = `
            <div class="alert alert--warning">
              <span class="alert-ic">${OSUBB.icon('alert', 20)}</span>
              <div class="grow">
                <div class="t-bold">Suprapunere detectată</div>
                <div class="t-sm mt-1">Pe ${U.fmtDate(p)} ${c.length > 1 ? 'există deja evenimentele' : 'există deja evenimentul'}
                  ${c.map(e => `<b>„${e.title}”</b>${e.time !== '—' ? ` (${e.time})` : ''}`).join(', ')}.</div>
                <div class="row gap-2 mt-3">
                  <button class="btn btn-sm btn-outline" id="ov-change">Schimbă intervalul</button>
                  <button class="btn btn-sm btn-danger" id="ov-force">Suprapune oricum</button>
                </div>
              </div>
            </div>`;
          modal.querySelector('#ov-change').addEventListener('click', () => {
            forced = false;
            dateEl.focus();
            if (dateEl.showPicker) { try { dateEl.showPicker(); } catch (_) {} }
          });
          modal.querySelector('#ov-force').addEventListener('click', () => { forced = true; proceed(); });
        }

        dateEl.addEventListener('change', () => { forced = false; render(); });
        timeEl.addEventListener('change', () => { forced = false; render(); });
        modal.querySelector('#add-confirm').addEventListener('click', () => {
          if (conflicts().length && !forced) {
            render();
            zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
          }
          proceed();
        });

        render();   // June 28 already collides → demo-ready warning on open
      },
    });
  }

  /* ---------- View ---------- */
  OSUBB.registerView('calendar', {
    label: 'Calendar', icon: 'calendar', title: 'Calendar',

    count(ctx) { return D.events.filter(e => e.m === TODAY.m && e.d === TODAY.d).length; },

    render(ctx) {
      CUR = { user: ctx.user, role: ctx.role };
      const seesAll = OSUBB.can('seeAllEvents', ctx.role);
      const legend = D.departments.map(d => `<span class="tag ${d.tag}">${d.name}</span>`).join('')
        + `<span class="tag dept-org">Organizație / IT</span>`;
      const pills = `<button class="filter-pill is-active" data-dept="all">${OSUBB.icon('layers', 15)} Toate</button>`
        + D.departments.map(d =>
            `<button class="filter-pill" data-dept="${d.id}"><span class="dot" style="background:${d.color}"></span>${d.short}</button>`).join('');

      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Calendar</h1>
              <p class="page-sub">${seesAll
                ? 'Toate evenimentele organizației · adaugi fără să suprapui.'
                : 'Evenimentele la care ai acces · duminică, 28 iunie 2026.'}</p>
            </div>
            ${seesAll ? `<button class="btn btn-primary" data-add>${OSUBB.icon('plus', 18)} Adaugă activitate</button>` : ''}
          </div>

          <div class="grid grid-wide">
            <div class="col gap-4">
              <div class="toolbar" style="margin-bottom:0">
                <div class="seg" id="cal-seg">
                  <button class="seg-btn is-active" data-mode="month">${OSUBB.icon('grid', 15)} Lună</button>
                  <button class="seg-btn" data-mode="week">${OSUBB.icon('list', 15)} Săptămână</button>
                </div>
                <div class="row gap-1">
                  <button class="btn btn-icon btn-sm btn-outline" data-month="prev" aria-label="Luna anterioară">
                    <span style="display:inline-flex;transform:scaleX(-1)">${OSUBB.icon('chevron', 16)}</span></button>
                  <span class="t-bold" style="min-width:104px;text-align:center">Iunie 2026</span>
                  <button class="btn btn-icon btn-sm btn-outline" data-month="next" aria-label="Luna următoare">${OSUBB.icon('chevron', 16)}</button>
                </div>
                <div class="grow"></div>
              </div>

              <div class="row gap-2 wrap" id="cal-pills">${pills}</div>

              <div class="row gap-2 wrap" style="align-items:center">
                <span class="t-xs t-up t-faint" style="margin-right:2px">Legendă</span>${legend}
              </div>

              <div id="cal-view">${monthGrid('all')}</div>
            </div>

            <div class="col gap-5" id="cal-side">${sideCards()}</div>
          </div>
        </div>`;
    },

    mount(root, ctx) {
      const q = (s) => root.querySelector(s);
      const state = { mode: 'month', dept: 'all' };

      const paintView = () => { q('#cal-view').innerHTML = state.mode === 'month' ? monthGrid(state.dept) : weekView(state.dept); };
      const paintSide = () => { q('#cal-side').innerHTML = sideCards(); };
      const setSeg = () => root.querySelectorAll('#cal-seg [data-mode]')
        .forEach(b => b.classList.toggle('is-active', b.getAttribute('data-mode') === state.mode));
      const setPills = () => root.querySelectorAll('#cal-pills [data-dept]')
        .forEach(p => p.classList.toggle('is-active', p.getAttribute('data-dept') === state.dept));

      function join(id) {
        const ev = D.events.find(x => String(x.id) === String(id));
        if (!ev || ev.joined) return;
        ev.joined = true; ev.going++;
        ctx.toast({ title: 'Participare confirmată', body: `Te-ai înscris la „${ev.title}”. Apare în calendarul tău.`, icon: 'check' });
        paintView(); paintSide();
      }

      root.addEventListener('click', (e) => {
        const going = e.target.closest('[data-going]');
        if (going) { e.stopPropagation(); join(going.getAttribute('data-going')); return; }

        const evEl = e.target.closest('[data-event]');
        if (evEl) {
          const ev = D.events.find(x => String(x.id) === String(evEl.getAttribute('data-event')));
          if (ev) OSUBB.openEvent(ev, ctx);
          return;
        }
        const seg = e.target.closest('[data-mode]');
        if (seg) { state.mode = seg.getAttribute('data-mode'); setSeg(); paintView(); return; }

        const pill = e.target.closest('[data-dept]');
        if (pill) { state.dept = pill.getAttribute('data-dept'); setPills(); paintView(); return; }

        const mo = e.target.closest('[data-month]');
        if (mo) { ctx.toast({ title: 'Doar iunie 2026', body: 'Prototipul este ancorat pe luna curentă.', icon: 'calendar' }); return; }

        const add = e.target.closest('[data-add]');
        if (add) { openAddModal(ctx); return; }
      });
    },
  });
})();
