/* ============================================================================
   View: Task Tracker (priorities §1)
   Scoring: points = difficulty(1..5 ★) × ratingMultiplier(1..5 → -1/0/1/2/3).
   Visibility: regular volunteers see ONLY their own sheet + available tasks +
   leaderboard/gamification (no access to others' trackers). Managers
   (responsabil/bce/bc/moderator) can create tasks & award points. BC/moderator
   also see all "Fișele voluntarului" and the "Pentru Interne" sheets.
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data, icon = OSUBB.icon;
  const S = OSUBB._tt = OSUBB._tt || { tab: 'mine', q: '', dept: 'all', status: 'all', sort: 'deadline', dir: 'asc' };

  const deadVal = (t) => (t.deadline.m || 6) * 100 + t.deadline.d;
  const myTasks = (u) => D.tasks.filter(t => t.assignees.includes(u.name));
  const openTasks = () => D.tasks.filter(t => t.status === 'open');
  const memberColor = (n) => { const v = D.volunteers.find(x => x.name === n); return v ? v.avatarColor : '#3A3A3D'; };

  function sortList(list) {
    const k = S.sort, dir = S.dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      let av, bv;
      if (k === 'title') { av = a.title.toLowerCase(); bv = b.title.toLowerCase(); }
      else if (k === 'points') { av = a.points; bv = b.points; }
      else if (k === 'difficulty') { av = a.difficulty; bv = b.difficulty; }
      else { av = deadVal(a); bv = deadVal(b); }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }
  function filterList(list) {
    return list.filter(t =>
      (S.dept === 'all' || t.dept === S.dept) &&
      (S.status === 'all' || t.status === S.status) &&
      (!S.q || t.title.toLowerCase().includes(S.q.toLowerCase())));
  }

  function assigneeCell(t) {
    if (!t.assignees.length) return `<span class="badge badge--amber">${icon('userplus', 12)} disponibil</span>`;
    const shown = t.assignees.slice(0, 3);
    return `<div class="avatar-stack">${shown.map(n => U.avatar(n, memberColor(n), 'avatar-sm')).join('')}${t.assignees.length > 3 ? `<span class="avatar avatar-sm" style="background:var(--ink-200);color:var(--ink-600)">+${t.assignees.length - 3}</span>` : ''}</div>`;
  }

  function th(key, label, extra) {
    return `<th class="th-sort ${S.sort === key ? S.dir : ''} ${extra || ''}" data-sort="${key}">${label}</th>`;
  }

  function tableRows(list, ctx) {
    if (!list.length) return `<tr><td colspan="6"><div class="empty"><div class="empty-ic">${icon('task', 24)}</div>Niciun task aici.</div></td></tr>`;
    return list.map(t => {
      const st = U.taskStatus(t.status);
      const canTake = t.status === 'open';
      return `<tr data-task="${t.id}" style="cursor:pointer">
        <td><div class="t-semi">${t.title}</div><div class="t-xs t-faint">${t.team ? (D.teams.find(x => x.id === t.team) || {}).name || '' : 'Individual'}</div></td>
        <td><span class="tag tag--soft ${U.deptTag(t.dept)}">${U.dept(t.dept).short}</span></td>
        <td>${assigneeCell(t)}</td>
        <td><div class="t-sm ${U.isPast(t.deadline) && t.status !== 'done' ? 't-red t-semi' : ''}">${U.fmtDate(t.deadline)}</div><div class="t-xs t-faint">${U.relDay(t.deadline)}</div></td>
        <td><div class="row gap-2">${U.stars(t.difficulty)} <span class="t-xs t-faint">×${U.ratingMult(t.rating) < 0 ? '−1' : U.ratingMult(t.rating)}</span></div></td>
        <td class="td-num">${U.pointsBadge(t.points)}${canTake ? ` <button class="btn btn-outline btn-sm" data-take="${t.id}">Preia</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  function dataTable(list, ctx) {
    return `<div class="card"><div class="table-wrap"><table class="table"><thead><tr>
      ${th('title', 'Task')}<th>Departament</th><th>Responsabili</th>${th('deadline', 'Deadline')}
      ${th('difficulty', 'Dificultate × Rating')}${th('points', 'Puncte', 'td-num')}
    </tr></thead><tbody>${tableRows(list, ctx)}</tbody></table></div></div>`;
  }

  function toolbar() {
    return `<div class="toolbar">
      <div class="search"><span>${icon('search', 17)}</span><input id="tt-q" placeholder="Caută task…" value="${S.q}"></div>
      <button class="filter-pill ${S.dept === 'all' ? 'is-active' : ''}" data-dept="all">Toate dep.</button>
      ${D.departments.map(d => `<button class="filter-pill ${S.dept === d.id ? 'is-active' : ''}" data-dept="${d.id}">${d.short}</button>`).join('')}
      <span class="divider-v" style="height:24px"></span>
      ${['all', 'todo', 'progress', 'overdue', 'done'].map(s => `<button class="filter-pill ${S.status === s ? 'is-active' : ''}" data-status="${s}">${s === 'all' ? 'Orice status' : U.taskStatus(s).label}</button>`).join('')}
    </div>`;
  }

  /* ---- Fișa mea (personal sheet) ---- */
  function sheetFor(name) {
    const mine = D.tasks.filter(t => t.assignees.includes(name));
    const done = mine.filter(t => t.status === 'done');
    const earned = done.reduce((s, t) => s + t.points, 0);
    return { mine, done, earned };
  }
  function mySheet(ctx) {
    const { mine, done, earned } = sheetFor(ctx.user.name);
    return `
      <div class="grid grid-4 mb-4">
        <div class="card stat"><span class="stat-label">Puncte câștigate</span><div class="stat-value t-num">${U.pts(earned)}</div></div>
        <div class="card stat"><span class="stat-label">Finalizate</span><div class="stat-value t-num">${done.length}<span class="t-faint" style="font-size:var(--fs-md)"> / ${mine.length}</span></div></div>
        <div class="card stat"><span class="stat-label">În lucru</span><div class="stat-value t-num">${mine.filter(t => t.status === 'progress').length}</div></div>
        <div class="card stat"><span class="stat-label">Restante</span><div class="stat-value t-num">${mine.filter(t => t.status === 'overdue' || t.status === 'todo').length}</div></div>
      </div>
      ${dataTable(sortList(filterList(mine)), ctx)}
      <p class="t-xs t-faint mt-3">${icon('eye', 12)} Fișa ta personală — vizibilă doar ție și Biroului de Conducere.</p>`;
  }

  /* ---- Fișele voluntarilor (BC) ---- */
  function sheetsIndex() {
    const rows = D.volunteers.slice().sort((a, b) => b.points - a.points).map(v => {
      const { mine, done, earned } = sheetFor(v.name);
      return `<tr data-sheet="${v.name}" style="cursor:pointer">
        <td><div class="row gap-2">${U.avatar(v.name, v.avatarColor, 'avatar-sm')}<span class="t-semi">${v.name}</span></div></td>
        <td><span class="tag tag--soft ${U.deptTag(v.dept)}">${U.dept(v.dept).short}</span></td>
        <td><span class="badge badge--soft">${U.role(v.role)}</span></td>
        <td class="td-num">${mine.length}</td>
        <td class="td-num">${done.length}</td>
        <td class="td-num">${U.pointsBadge(earned)}</td>
      </tr>`;
    }).join('');
    return `<div class="alert alert--info mb-4"><span class="alert-ic">${icon('shield', 18)}</span>
        <div>Acces BC: vezi „Fișa Voluntarului” pentru fiecare membru — taskuri realizate / nerealizate și puncte.</div></div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Voluntar</th><th>Departament</th><th>Rol</th><th class="td-num">Taskuri</th><th class="td-num">Finalizate</th><th class="td-num">Puncte</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
  }

  /* ---- Pentru Interne — two auto sheets ---- */
  function interne() {
    const ag = D.agThreshold;
    const over = ag.members.filter(m => m.points >= ag.required).sort((a, b) => b.points - a.points);
    const agm = ag.members.filter(m => m.ag).sort((a, b) => b.points - a.points);
    const sheetTable = (rows, kind) => `<div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Membru</th><th class="td-num">Puncte</th><th>${kind === 'prag' ? 'Prag' : 'Status AG'}</th></tr></thead>
      <tbody>${rows.map((m, i) => `<tr><td class="t-num t-faint" style="width:30px">${i + 1}</td>
        <td class="t-semi">${m.name}</td><td class="td-num">${U.pts(m.points)}</td>
        <td>${kind === 'prag'
          ? `<span class="badge badge--green">${icon('check', 12)} peste ${ag.required}p</span>`
          : `<span class="badge ${m.role === 'bc' || m.role === 'vot' ? 'badge--solid' : 'badge--blue'}">${U.role(m.role)}</span>`}</td></tr>`).join('')}</tbody>
    </table></div>`;
    return `
      <div class="alert alert--info mb-4"><span class="alert-ic">${icon('flag', 18)}</span>
        <div>Acces: Vicepreședinte Interne + Echipa Interne. Fișele se actualizează <b>automat</b> din activitatea din Task Tracker.</div></div>
      <div class="grid grid-split">
        <div class="card"><div class="card-head"><span class="card-title">${icon('target', 18)} Prag Adunarea Generală (${D.agThreshold.required}p)</span>
          <span class="badge badge--green">auto</span></div>${sheetTable(over, 'prag')}</div>
        <div class="card"><div class="card-head"><span class="card-title">${icon('users', 18)} Membrii AG + punctaje</span>
          <span class="badge badge--soft">top ${D.agThreshold.agQuorum}% rămân</span></div>${sheetTable(agm, 'ag')}</div>
      </div>`;
  }

  function tabsFor(role) {
    const tabs = [['mine', 'Fișa mea'], ['open', 'Disponibile']];
    if (OSUBB.can('manageTasks', role)) tabs.push(['manage', 'Taskuri gestionate']);
    if (OSUBB.can('seeAllSheets', role)) tabs.push(['sheets', 'Fișele voluntarilor']);
    if (OSUBB.can('seeInterne', role)) tabs.push(['interne', 'Pentru Interne']);
    return tabs;
  }

  OSUBB.registerView('tasktracker', {
    label: 'Task Tracker', icon: 'task', title: 'Task Tracker',
    count(ctx) { return myTasks(ctx.user).filter(t => t.status !== 'done').length; },

    render(ctx) {
      const role = ctx.role;
      const tabs = tabsFor(role);
      if (!tabs.some(t => t[0] === S.tab)) S.tab = 'mine';
      const manage = OSUBB.can('manageTasks', role);
      let body;
      if (S.tab === 'interne') body = interne();
      else if (S.tab === 'sheets') body = sheetsIndex();
      else if (S.tab === 'mine') body = mySheet(ctx);
      else if (S.tab === 'open') body = `<div class="alert alert--warning mb-4"><span class="alert-ic">${icon('userplus', 18)}</span><div>Taskuri fără responsabil — primul care preia, îl primește.</div></div>${dataTable(sortList(filterList(openTasks())), ctx)}`;
      else body = `${toolbar()}${dataTable(sortList(filterList(D.tasks)), ctx)}`;

      return `
        <div class="page">
          <div class="page-head">
            <div><h1 class="page-title">Task Tracker</h1>
              <p class="page-sub">Punctaj: dificultate (★) × rating · ${D.tasks.length} taskuri</p></div>
            <div class="row gap-2 wrap">
              <button class="btn btn-outline" id="tt-legend">${icon('target', 17)} Ghid de punctare</button>
              <button class="btn btn-outline" id="tt-request">${icon('plus', 17)} Cere task</button>
              ${manage ? `<button class="btn btn-primary" id="tt-new">${icon('plus', 17)} Task nou</button>` : ''}
            </div>
          </div>
          <div class="seg mb-4" id="tt-tabs" style="flex-wrap:wrap">
            ${tabs.map(([k, l]) => `<button class="seg-btn ${S.tab === k ? 'is-active' : ''}" data-tab="${k}">${l}</button>`).join('')}
          </div>
          <div id="tt-body">${body}</div>
        </div>`;
    },

    mount(root, ctx) {
      const rerender = () => ctx.navigate('tasktracker');
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; rerender(); });
      root.querySelectorAll('[data-dept]').forEach(b => b.onclick = () => { S.dept = b.dataset.dept; rerender(); });
      root.querySelectorAll('[data-status]').forEach(b => b.onclick = () => { S.status = b.dataset.status; rerender(); });
      root.querySelectorAll('[data-sort]').forEach(h => h.onclick = () => { const k = h.dataset.sort; if (S.sort === k) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = k; S.dir = 'asc'; } rerender(); });
      const q = root.querySelector('#tt-q');
      if (q) q.oninput = () => { S.q = q.value; const tb = root.querySelector('.table tbody'); if (tb) { tb.innerHTML = tableRows(sortList(filterList(S.tab === 'open' ? openTasks() : D.tasks)), ctx); wireRows(root, ctx); } };

      wireRows(root, ctx);

      root.querySelectorAll('[data-sheet]').forEach(r => r.onclick = () => openVolunteerSheet(r.dataset.sheet, ctx));

      const nb = root.querySelector('#tt-new'); if (nb) nb.onclick = () => openNewTask(ctx);
      root.querySelector('#tt-legend').onclick = () => OSUBB.openScoringGuide(ctx);
      root.querySelector('#tt-request').onclick = () => openRequest(ctx);
    },
  });

  function wireRows(root, ctx) {
    root.querySelectorAll('[data-take]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const t = D.tasks.find(x => x.id == b.dataset.take);
      t.assignees = [ctx.user.name]; t.status = 'todo';
      ctx.toast({ title: 'Task preluat', body: `„${t.title}” este acum al tău (${t.points >= 0 ? '+' : ''}${t.points}p la finalizare).`, icon: 'check' });
      ctx.navigate('tasktracker');
    });
    root.querySelectorAll('[data-task]').forEach(r => r.onclick = () => OSUBB.openTask(D.tasks.find(t => t.id == r.dataset.task), ctx));
  }

  function openVolunteerSheet(name, ctx) {
    const v = D.volunteers.find(x => x.name === name) || { name };
    const { mine, done, earned } = sheetFor(name);
    OSUBB.modal({
      title: `Fișa Voluntarului — ${name}`, size: 'lg',
      body: `
        <div class="row gap-3 mb-4">${U.avatar(name, v.avatarColor, 'avatar-lg')}
          <div><div class="row gap-2 wrap mb-1"><span class="tag tag--soft ${U.deptTag(v.dept)}">${U.dept(v.dept).short}</span>
            <span class="badge badge--soft">${U.role(v.role)}</span></div>
            <div class="t-sm t-muted">${done.length}/${mine.length} taskuri finalizate · ${U.pts(earned)} puncte din taskuri</div></div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Deadline</th><th>★ × rating</th><th>Status</th><th class="td-num">Puncte</th></tr></thead>
        <tbody>${mine.length ? mine.map(t => `<tr><td class="t-semi">${t.title}</td><td class="t-sm">${U.fmtDate(t.deadline)}</td>
          <td>${U.stars(t.difficulty)} <span class="t-xs t-faint">×${U.ratingMult(t.rating) < 0 ? '−1' : U.ratingMult(t.rating)}</span></td>
          <td><span class="badge ${U.taskStatus(t.status).cls}">${U.taskStatus(t.status).label}</span></td><td class="td-num">${U.pointsBadge(t.points)}</td></tr>`).join('')
          : `<tr><td colspan="5"><div class="empty">Niciun task încă.</div></td></tr>`}</tbody></table></div>`,
      foot: `<button class="btn btn-ghost" data-close>Închide</button>`,
    });
  }

  /* ---- Ghid de punctare (shared; opened from add-task & award-points) ---- */
  OSUBB.openScoringGuide = function (ctx) {
    OSUBB.modal({
      title: 'Ghid de punctare', size: 'lg',
      body: `
        <p class="t-muted mb-4">Punctele unui task = <b>dificultate</b> (1–5 ★, fiecare stea = 1 punct) × <b>rating</b> (multiplicator).</p>
        <h4 class="mb-2">Rating (multiplicator)</h4>
        <div class="table-wrap mb-4"><table class="table"><thead><tr><th>Rating</th><th>Multiplicator</th><th>Înseamnă</th></tr></thead>
          <tbody>${D.ratingGuide.map(r => `<tr><td class="t-semi">${r.rating} — ${r.label}</td>
            <td>${U.pointsBadge(r.mult)} <span class="t-faint">×</span></td><td class="t-sm t-muted">${r.note}</td></tr>`).join('')}</tbody></table></div>
        <h4 class="mb-2">Dificultate (stele)</h4>
        <div class="list">${D.difficultyGuide.map(g => `<div class="list-row"><div style="width:96px">${U.stars(g.stars)}</div>
          <div class="list-main"><span class="t-sm">${g.note}</span></div><span class="badge badge--soft">${g.stars}p de bază</span></div>`).join('')}</div>
        <div class="alert alert--info mt-4"><span class="alert-ic">${icon('sparkle', 18)}</span>
          <div class="t-sm">Exemplu: dificultate ★★★★ (4) × rating 5 (×3) = <b>12 puncte</b>. Rating 1 scade puncte; rating 2 acordă 0.</div></div>`,
      foot: `<button class="btn btn-primary" data-close>Am înțeles</button>`,
    });
  };

  /* ---- Task nou (managers) — stars + rating pills + live points ---- */
  function openNewTask(ctx) {
    const canEmpty = OSUBB.can('manageTasks', ctx.role);
    OSUBB.modal({
      title: 'Task nou', size: 'lg',
      body: `
        <div class="row between mb-3"><span class="t-sm t-muted">Nu știi ce să alegi?</span>
          <button type="button" class="btn btn-ghost btn-sm" id="nt-guide">${icon('target', 15)} Ghid de punctare</button></div>
        <div class="field"><label class="label">Șablon</label>
          <select class="select" id="nt-tpl"><option value="">— Fără șablon —</option>
            ${D.taskTemplates.map((t, i) => `<option value="${i}">${t.name} (★${t.difficulty} × rating ${t.rating})</option>`).join('')}</select></div>
        <div class="field"><label class="label">Titlu</label><input class="input" id="nt-title" placeholder="ex: Minută ședință BC"></div>
        <div class="grid grid-2 gap-3">
          <div class="field"><label class="label">Dificultate</label><div class="star-pick" id="nt-stars">${[1,2,3,4,5].map(i => `<span class="star" data-star="${i}">★</span>`).join('')}</div>
            <span class="hint">Fiecare stea = 1 punct de bază.</span></div>
          <div class="field"><label class="label">Deadline</label><input class="input" type="date" value="2026-06-30"></div>
        </div>
        <div class="field"><label class="label">Rating (multiplicator)</label>
          <div class="rate-opts" id="nt-rate">${D.ratingGuide.map(r => `<div class="rate-opt" data-rate="${r.rating}" data-mult="${r.mult}"><span class="rate-mult">×${r.mult < 0 ? '−1' : r.mult}</span><span class="rate-lbl">${r.label}</span></div>`).join('')}</div></div>
        <div class="row between card-pad" style="background:var(--surface-2);border-radius:var(--r-sm)">
          <span class="t-semi">Puncte calculate</span><span class="pts-preview" id="nt-pts">—</span></div>
        <div class="field mt-4"><label class="label">Echipă / grup (un tag pentru tot grupul)</label>
          <select class="select"><option value="">— Persoane individuale —</option>${D.teams.map(t => `<option>${t.name}</option>`).join('')}</select></div>
        ${canEmpty ? `<label class="checkbox mb-3"><input type="checkbox" id="nt-empty"> <span>Fără responsabil — primul care preia, îl primește</span></label>` : ''}
        <div class="field"><label class="label">Descriere (opțional)</label><textarea class="textarea" placeholder="Detalii…"></textarea></div>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button><button class="btn btn-primary" data-close id="nt-save">Creează task</button>`,
      onMount(modal, close) {
        let diff = 0, rate = null;
        const ptsEl = modal.querySelector('#nt-pts');
        const recompute = () => {
          if (!diff || rate === null) { ptsEl.textContent = '—'; ptsEl.className = 'pts-preview'; return; }
          const mult = OSUBB.util.ratingMult(rate), p = diff * mult;
          ptsEl.textContent = `${p > 0 ? '+' : ''}${p} puncte`;
          ptsEl.className = 'pts-preview' + (p < 0 ? ' neg' : p === 0 ? ' zero' : '');
        };
        const setStars = (n) => { diff = n; modal.querySelectorAll('#nt-stars .star').forEach(s => s.classList.toggle('on', +s.dataset.star <= n)); recompute(); };
        modal.querySelectorAll('#nt-stars .star').forEach(s => s.onclick = () => setStars(+s.dataset.star));
        modal.querySelectorAll('#nt-rate .rate-opt').forEach(o => o.onclick = () => {
          rate = +o.dataset.rate; modal.querySelectorAll('#nt-rate .rate-opt').forEach(x => x.classList.toggle('is-active', x === o)); recompute();
        });
        modal.querySelector('#nt-tpl').onchange = (e) => { if (e.target.value !== '') { const t = D.taskTemplates[+e.target.value]; setStars(t.difficulty); modal.querySelector(`#nt-rate .rate-opt[data-rate="${t.rating}"]`).click(); } };
        modal.querySelector('#nt-guide').onclick = () => OSUBB.openScoringGuide(ctx);
        modal.querySelector('#nt-save').onclick = () => ctx.toast({ title: 'Task creat', body: 'Adăugat în Task Tracker' + (modal.querySelector('#nt-empty') && modal.querySelector('#nt-empty').checked ? ' — disponibil pentru preluare.' : ' și în calendar.'), icon: 'check' });
      },
    });
  }

  function openRequest(ctx) {
    OSUBB.modal({
      title: 'Cere un task',
      body: `<p class="t-muted mb-4">Solicită unui coordonator (BCE / Responsabil) adăugarea unui task pentru tine.</p>
        <div class="field"><label class="label">Ce ai realizat / vrei să preiei</label><textarea class="textarea" placeholder="ex: Am distribuit afișele în 3 facultăți…"></textarea></div>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button><button class="btn btn-primary" data-close id="cr-send">Trimite cererea</button>`,
      onMount(m) { m.querySelector('#cr-send').onclick = () => ctx.toast({ title: 'Cerere trimisă', body: 'Coordonatorul a fost notificat.', icon: 'check' }); },
    });
  }
})();
