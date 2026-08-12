/* ============================================================================
   View: Bază de date voluntari (Voluntari)  — HR-style volunteer database
   Visibility: responsabil / bc only (see OSUBB.access).
   Stats + searchable / filterable / sortable table & card directory.
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data;

  // role id -> badge variant (gives the directory some color hierarchy)
  const ROLE_BADGE = {
    moderator:   'badge--solid',
    bc:          'badge--solid',
    bce:         'badge--red',
    responsabil: 'badge--purple',
    vot:         'badge--amber',
    activ:       'badge--green',
    voluntar:    'badge--blue',
    recrut:      'badge--grey',
  };

  // module-scoped UI state — reset on every fresh render() so the toolbar
  // chrome (pills/seg/select) always matches the data on screen.
  const S = { q: '', dept: 'all', status: 'all', sort: 'points', dir: 'desc', view: 'list' };
  function resetState() { Object.assign(S, { q: '', dept: 'all', status: 'all', sort: 'points', dir: 'desc', view: 'list' }); }

  const vById = (id) => D.volunteers.find(v => v.id == id);

  function roleBadge(id) { return `<span class="badge ${ROLE_BADGE[id] || 'badge--grey'}">${U.role(id)}</span>`; }
  function statusBadge(s) {
    return s === 'activ'
      ? `<span class="badge badge--green"><span class="dot dot--green"></span>Activ</span>`
      : `<span class="badge badge--grey"><span class="dot"></span>Inactiv</span>`;
  }

  /* ---------- filtering + sorting ---------- */
  function filtered() {
    let rows = D.volunteers.slice();
    const q = S.q.trim().toLowerCase();
    if (q) rows = rows.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.email.toLowerCase().includes(q) ||
      (v.team || '').toLowerCase().includes(q));
    if (S.dept !== 'all') rows = rows.filter(v => v.dept === S.dept);
    if (S.status !== 'all') rows = rows.filter(v => v.status === S.status);

    const dir = S.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let r;
      if (S.sort === 'points') r = a.points - b.points;
      else if (S.sort === 'name') r = a.name.localeCompare(b.name, 'ro');
      else if (S.sort === 'dept') r = U.dept(a.dept).name.localeCompare(U.dept(b.dept).name, 'ro');
      else if (S.sort === 'status') r = a.status.localeCompare(b.status, 'ro');
      else r = 0;
      return r * dir;
    });
    return rows;
  }

  function sortCls(key) { return S.sort === key ? S.dir : ''; }

  /* ---------- table ---------- */
  function rowHTML(v) {
    return `
      <tr data-vol="${v.id}" style="cursor:pointer">
        <td>
          <div class="row gap-2">
            ${U.avatar(v.name, v.avatarColor, 'avatar-sm')}
            <div class="t-semi truncate">${v.name}</div>
          </div>
        </td>
        <td><span class="tag tag--soft ${U.deptTag(v.dept)}">${U.dept(v.dept).short}</span></td>
        <td>${roleBadge(v.role)}</td>
        <td class="t-sm t-muted truncate">${v.team}</td>
        <td class="td-num">${U.pts(v.points)}</td>
        <td>${statusBadge(v.status)}</td>
        <td style="text-align:right">
          <div class="row gap-1" style="justify-content:flex-end">
            <button class="btn btn-outline btn-icon btn-sm" data-mail="${v.id}" title="Trimite email">${OSUBB.icon('mail', 16)}</button>
            <button class="btn btn-outline btn-icon btn-sm" data-phone="${v.id}" title="Sună">${OSUBB.icon('phone', 16)}</button>
          </div>
        </td>
      </tr>`;
  }

  function tableHTML(rows) {
    return `
      <div class="card" style="overflow:hidden">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="th-sort ${sortCls('name')}" data-sort="name">Voluntar</th>
                <th class="th-sort ${sortCls('dept')}" data-sort="dept">Departament</th>
                <th>Rol</th>
                <th>Echipă</th>
                <th class="th-sort ${sortCls('points')}" data-sort="points" style="text-align:right">Puncte</th>
                <th class="th-sort ${sortCls('status')}" data-sort="status">Status</th>
                <th style="text-align:right">Contact</th>
              </tr>
            </thead>
            <tbody>${rows.map(rowHTML).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---------- cards ---------- */
  function cardHTML(v) {
    return `
      <div class="card card-pad card-hover" data-vol="${v.id}" style="cursor:pointer">
        <div class="row gap-3 mb-3">
          ${U.avatar(v.name, v.avatarColor, 'avatar-lg')}
          <div class="grow" style="min-width:0">
            <div class="t-bold truncate">${v.name}</div>
            <div class="row gap-1 mt-1 wrap">
              <span class="tag tag--soft ${U.deptTag(v.dept)}">${U.dept(v.dept).short}</span>
              ${roleBadge(v.role)}
            </div>
          </div>
        </div>
        <div class="row between">
          <div>
            <div class="stat-label">Puncte</div>
            <div class="t-extra t-num t-lg">${U.pts(v.points)}</div>
          </div>
          ${statusBadge(v.status)}
        </div>
        <div class="divider"></div>
        <div class="row between t-sm t-muted gap-2">
          <span class="truncate">${OSUBB.icon('users', 13)} ${v.team}</span>
          <span class="t-faint">din ${v.joined}</span>
        </div>
      </div>`;
  }

  function emptyHTML() {
    return `<div class="card card-pad"><div class="empty"><div class="empty-ic">${OSUBB.icon('search', 24)}</div>
      Niciun voluntar găsit. Schimbă căutarea sau resetează filtrele.</div></div>`;
  }

  function contentHTML() {
    const rows = filtered();
    const label = `${rows.length} ${rows.length === 1 ? 'voluntar' : 'voluntari'}`
      + (S.dept !== 'all' ? ` · ${U.dept(S.dept).name}` : '')
      + (S.status !== 'all' ? ` · ${S.status === 'activ' ? 'activi' : 'inactivi'}` : '');
    const head = `<div class="row between wrap gap-2 mb-3"><div class="t-sm t-muted">${label}</div></div>`;
    if (!rows.length) return head + emptyHTML();
    return head + (S.view === 'cards' ? `<div class="grid grid-3">${rows.map(cardHTML).join('')}</div>` : tableHTML(rows));
  }

  /* ---------- stat header ---------- */
  function statCards() {
    const vols = D.volunteers;
    const total = vols.length;
    const activi = vols.filter(v => v.status === 'activ').length;
    const deptCount = OSUBB.data.departments.length;
    const recruti = vols.filter(v => v.role === 'recrut').length;
    return `
      <div class="grid grid-4">
        <div class="card stat">
          <div class="row between"><span class="stat-label">Total voluntari</span>
            <span class="stat-icon">${OSUBB.icon('users', 20)}</span></div>
          <div class="stat-value t-num">${total}</div>
          <div class="stat-trend up">${OSUBB.icon('arrowUp', 14)} +3 luna aceasta</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Membri activi</span>
            <span class="stat-icon">${OSUBB.icon('star', 20)}</span></div>
          <div class="stat-value t-num">${activi}<span class="t-faint" style="font-size:var(--fs-md)"> / ${total}</span></div>
          <div class="stat-trend up">${Math.round(activi / total * 100)}% din bază</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Departamente</span>
            <span class="stat-icon">${OSUBB.icon('layers', 20)}</span></div>
          <div class="stat-value t-num">${deptCount}</div>
          <div class="row gap-1 wrap mt-1">${D.departments.map(d => `<span class="dot" style="background:${d.color}" title="${d.name}"></span>`).join('')}</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Recruți</span>
            <span class="stat-icon">${OSUBB.icon('userplus', 20)}</span></div>
          <div class="stat-value t-num">${recruti}</div>
          <div class="stat-trend">în perioada de probă</div>
        </div>
      </div>`;
  }

  /* ---------- toolbar ---------- */
  function toolbar() {
    const deptPills = [`<button class="filter-pill is-active" data-dept="all">Toate</button>`]
      .concat(D.departments.map(d =>
        `<button class="filter-pill" data-dept="${d.id}"><span class="dot" style="background:${d.color}"></span>${d.short}</button>`))
      .join('');
    return `
      <div class="toolbar">
        <div class="search" style="min-width:240px">
          ${OSUBB.icon('search', 17)}
          <input id="vol-search" type="text" placeholder="Caută după nume, email sau echipă…">
        </div>
        ${deptPills}
        <span class="divider-v" style="height:24px"></span>
        <button class="filter-pill is-active" data-status="all">Toți</button>
        <button class="filter-pill" data-status="activ">Activi</button>
        <button class="filter-pill" data-status="inactiv">Inactivi</button>
        <div class="row gap-2" style="margin-left:auto">
          <select class="select" id="vol-sort" style="width:auto;height:36px;padding-right:34px">
            <option value="points:desc" selected>Puncte ↓</option>
            <option value="points:asc">Puncte ↑</option>
            <option value="name:asc">Nume A–Z</option>
            <option value="name:desc">Nume Z–A</option>
          </select>
          <div class="seg">
            <button class="seg-btn is-active" data-view="list">${OSUBB.icon('list', 15)} Listă</button>
            <button class="seg-btn" data-view="cards">${OSUBB.icon('grid', 15)} Carduri</button>
          </div>
        </div>
      </div>`;
  }

  /* ---------- detail modal ---------- */
  function openVolunteer(v, ctx) {
    const role = D.roles.find(r => r.id === v.role) || { name: v.role };
    ctx.modal({
      title: v.name,
      body: `
        <div class="row gap-4 mb-4 wrap">
          ${U.avatar(v.name, v.avatarColor, 'avatar-xl')}
          <div class="grow" style="min-width:200px">
            <div class="row gap-2 wrap mb-2">
              <span class="tag ${U.deptTag(v.dept)}">${U.dept(v.dept).name}</span>
              ${roleBadge(v.role)}
              ${statusBadge(v.status)}
            </div>
            <div class="row gap-2 wrap">
              <span class="chip">${OSUBB.icon('mail', 14)} ${v.email}</span>
              <span class="chip">${OSUBB.icon('phone', 14)} ${v.phone}</span>
            </div>
          </div>
        </div>
        <div class="grid grid-2 gap-3">
          <div><div class="stat-label">Departament</div><div class="t-semi">${U.dept(v.dept).name}</div></div>
          <div><div class="stat-label">Rol</div><div class="t-semi">${role.name}</div></div>
          <div><div class="stat-label">Echipă</div><div class="t-semi">${v.team}</div></div>
          <div><div class="stat-label">Membru din</div><div class="t-semi">${v.joined}</div></div>
          <div><div class="stat-label">Puncte acumulate</div><div class="t-semi t-num">${U.pts(v.points)} p</div></div>
          <div><div class="stat-label">Status</div><div class="t-semi">${v.status === 'activ' ? 'Activ' : 'Inactiv'}</div></div>
        </div>`,
      foot: `
        <button class="btn btn-ghost" data-close>Închide</button>
        <button class="btn btn-outline" id="vp-mail">${OSUBB.icon('mail', 16)} Trimite email</button>
        <button class="btn btn-primary" id="vp-pts">${OSUBB.icon('sparkle', 16)} Acordă puncte</button>`,
      onMount(modal, close) {
        modal.querySelector('#vp-mail').addEventListener('click', () => {
          close();
          ctx.toast({ title: 'Email pregătit', body: `Către ${v.name} · ${v.email}`, icon: 'mail' });
        });
        modal.querySelector('#vp-pts').addEventListener('click', () => {
          close();
          ctx.toast({ title: `Puncte acordate lui ${v.name.split(' ')[0]}`, body: '+10 puncte adăugate în cont. Apar în clasament.', icon: 'sparkle' });
        });
      },
    });
  }

  /* ---------- add modal ---------- */
  function openAdd(ctx) {
    ctx.modal({
      title: 'Adaugă voluntar',
      body: `
        <div class="field"><label class="label">Nume complet</label>
          <input class="input" id="av-name" placeholder="ex. Andrei Pop"></div>
        <div class="grid grid-2 gap-3">
          <div class="field"><label class="label">Departament</label>
            <select class="select" id="av-dept">${D.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}</select></div>
          <div class="field"><label class="label">Rol</label>
            <select class="select" id="av-role">${D.roles.map(r => `<option value="${r.id}" ${r.id === 'recrut' ? 'selected' : ''}>${r.name}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label class="label">Email</label>
          <input class="input" id="av-mail" placeholder="prenume.nume@osubb.ro"></div>
        <p class="hint">Voluntarul apare imediat în bază și primește acces în aplicație.</p>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button>
             <button class="btn btn-primary" data-close id="av-save">${OSUBB.icon('check', 16)} Salvează</button>`,
      onMount(modal) {
        modal.querySelector('#av-save').addEventListener('click', () => {
          const name = (modal.querySelector('#av-name').value || '').trim() || 'Voluntar nou';
          ctx.toast({ title: 'Voluntar adăugat', body: `${name} a fost adăugat în baza de date.`, icon: 'userplus' });
        });
      },
    });
  }

  /* ============================ view ============================ */
  OSUBB.registerView('volunteers', {
    label: 'Voluntari', icon: 'users', title: 'Bază de date voluntari',
    count(ctx) { return ctx.data.volunteers.filter(v => v.status === 'inactiv').length; },

    render(ctx) {
      resetState();
      const first = ctx.user.name.split(' ')[0];
      const total = D.volunteers.length;
      const activi = D.volunteers.filter(v => v.status === 'activ').length;
      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Bază de date voluntari</h1>
              <p class="page-sub">Salut, ${first} 👋 Ai ${total} voluntari în evidență, dintre care ${activi} activi. Caută, filtrează și acordă puncte.</p>
            </div>
            <div class="row gap-2">
              <button class="btn btn-outline" id="vol-export">${OSUBB.icon('download', 18)} Export</button>
              <button class="btn btn-primary" id="vol-add">${OSUBB.icon('userplus', 18)} Adaugă voluntar</button>
            </div>
          </div>

          ${statCards()}
          <div class="mt-5">${toolbar()}</div>
          <div id="vol-content">${contentHTML()}</div>
        </div>`;
    },

    mount(root, ctx) {
      const content = root.querySelector('#vol-content');
      const sortSel = root.querySelector('#vol-sort');
      const paint = () => { content.innerHTML = contentHTML(); };

      function syncSortSelect() {
        const val = `${S.sort}:${S.dir}`;
        if ([...sortSel.options].some(o => o.value === val)) sortSel.value = val;
      }

      // search
      const search = root.querySelector('#vol-search');
      search.addEventListener('input', () => { S.q = search.value; paint(); });

      // department pills (single-select)
      root.querySelectorAll('[data-dept]').forEach(p => p.addEventListener('click', () => {
        S.dept = p.getAttribute('data-dept');
        root.querySelectorAll('[data-dept]').forEach(x => x.classList.toggle('is-active', x === p));
        paint();
      }));

      // status pills (single-select)
      root.querySelectorAll('[data-status]').forEach(p => p.addEventListener('click', () => {
        S.status = p.getAttribute('data-status');
        root.querySelectorAll('[data-status]').forEach(x => x.classList.toggle('is-active', x === p));
        paint();
      }));

      // sort select
      sortSel.addEventListener('change', () => {
        const [k, d] = sortSel.value.split(':');
        S.sort = k; S.dir = d; paint();
      });

      // list / cards toggle
      root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
        S.view = b.getAttribute('data-view');
        root.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('is-active', x === b));
        paint();
      }));

      // export
      root.querySelector('#vol-export').addEventListener('click', () =>
        ctx.toast({ title: 'Export generat (CSV)', body: `${filtered().length} voluntari pregătiți pentru descărcare.`, icon: 'download' }));

      // add
      root.querySelector('#vol-add').addEventListener('click', () => openAdd(ctx));

      // delegated clicks inside the (re-rendered) content
      content.addEventListener('click', (e) => {
        const th = e.target.closest('[data-sort]');
        if (th) {
          const k = th.getAttribute('data-sort');
          if (S.sort === k) S.dir = S.dir === 'asc' ? 'desc' : 'asc';
          else { S.sort = k; S.dir = (k === 'points') ? 'desc' : 'asc'; }
          syncSortSelect();
          paint();
          return;
        }
        const mail = e.target.closest('[data-mail]');
        if (mail) { e.stopPropagation(); const v = vById(mail.getAttribute('data-mail'));
          ctx.toast({ title: 'Email pregătit', body: `Către ${v.name} · ${v.email}`, icon: 'mail' }); return; }
        const phone = e.target.closest('[data-phone]');
        if (phone) { e.stopPropagation(); const v = vById(phone.getAttribute('data-phone'));
          ctx.toast({ title: `Apel către ${v.name}`, body: v.phone, icon: 'phone' }); return; }
        const row = e.target.closest('[data-vol]');
        if (row) openVolunteer(vById(row.getAttribute('data-vol')), ctx);
      });
    },
  });
})();
