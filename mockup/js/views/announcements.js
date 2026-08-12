/* ============================================================================
   View: Anunțuri  — internal communication feed (priorities doc §4)
   Filter pills + search · pinned-first feed · priority styling ·
   active forms/calls rail · compose modal for responsabil/bc.
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data, icon = OSUBB.icon;

  const dateIdx = (o) => (o.m || 6) * 100 + o.d;

  function priorityMeta(p) {
    return ({
      critical:  { label: 'Critic',    badge: 'badge--red',   dot: 'dot--red',   icon: 'alert' },
      important: { label: 'Important', badge: 'badge--amber', dot: 'dot--amber', icon: 'star'  },
      normal:    { label: 'Normal',    badge: 'badge--grey',  dot: 'dot--blue',  icon: null    },
    })[p] || { label: p, badge: 'badge--grey', dot: 'dot--blue', icon: null };
  }

  const unreadCount = () => D.announcements.filter(a => !a.read).length;
  const isFormy = (a) => !!a.form || a.category === 'Oportunitate';

  function ordered() {
    const pinned = D.announcements.filter(a => a.pinned);
    const rest = D.announcements.filter(a => !a.pinned).sort((a, b) => dateIdx(b.date) - dateIdx(a.date));
    return [...pinned, ...rest];
  }

  /* ---------- announcement card ---------- */
  function annCard(a) {
    const d = U.dept(a.dept), pr = priorityMeta(a.priority);
    const txt = `${a.title} ${a.body} ${a.author} ${a.category}`.toLowerCase();
    return `
      <div class="card card-pad card-hover ${a.priority === 'critical' ? 'card-accent' : ''}"
           data-ann="${a.id}" data-cat="${a.category}" data-text="${txt}">
        <div class="row between gap-3 wrap mb-2">
          <div class="row gap-2 wrap">
            ${a.pinned ? `<span class="badge badge--soft">${icon('pin', 12)} Fixat</span>` : ''}
            <span class="badge ${pr.badge}">${pr.icon ? icon(pr.icon, 12) : ''} ${pr.label}</span>
            <span class="badge badge--soft">${a.category}</span>
          </div>
          ${!a.read ? `<span class="row gap-2 t-xs t-red t-semi"><span class="dot dot--red"></span>Necitit</span>` : ''}
        </div>

        <h3>${a.title}</h3>
        <p class="t-muted mt-2">${a.body}</p>

        ${a.form ? `<button class="btn btn-outline btn-sm mt-3" data-form="${a.id}">
          ${icon('arrowRight', 15)} Deschide formular: ${a.form}</button>` : ''}

        <div class="divider"></div>
        <div class="row between wrap gap-2">
          <div class="row gap-2 wrap">
            <span class="tag tag--soft ${d.tag}">${d.short}</span>
            <span class="t-sm t-muted row gap-1">${icon('user', 13)} ${a.author}</span>
            <span class="t-sm t-faint">· ${U.relDay(a.date)}</span>
          </div>
          <span class="card-link row gap-1">Citește ${icon('chevron', 14)}</span>
        </div>
      </div>`;
  }

  /* ---------- side rail: active forms & calls ---------- */
  function formRail() {
    const items = D.announcements.filter(isFormy);
    return `
      <div class="card">
        <div class="card-head">
          <span class="card-title">${icon('flag', 18)} Formulare active &amp; Call-uri</span>
          <span class="badge badge--soft">${items.length}</span>
        </div>
        <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
          <div class="list">
            ${items.map(a => {
              const d = U.dept(a.dept);
              return `
              <div class="list-row clickable" data-ann="${a.id}">
                <div class="list-lead" style="background:${d.color}1a;color:${d.color}">
                  ${icon(a.form ? 'flag' : 'megaphone', 18)}
                </div>
                <div class="list-main">
                  <div class="t-semi t-sm truncate">${a.form || a.title}</div>
                  <div class="list-meta">
                    <span class="tag tag--soft ${d.tag}">${d.short}</span>
                    <span class="t-faint">${U.relDay(a.date)}</span>
                  </div>
                </div>
                ${a.form
                  ? `<button class="btn btn-outline btn-sm" data-form="${a.id}">Deschide</button>`
                  : `<span class="badge badge--amber">Call</span>`}
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  function summaryCard() {
    const total = D.announcements.length;
    const unread = unreadCount();
    const pinned = D.announcements.filter(a => a.pinned).length;
    const crit = D.announcements.filter(a => a.priority === 'critical').length;
    const cell = (label, val, cls) => `
      <div class="col gap-1">
        <div class="stat-label">${label}</div>
        <div class="t-extra t-num ${cls || ''}" style="font-size:var(--fs-xl)">${val}</div>
      </div>`;
    return `
      <div class="card card-pad">
        <div class="card-title mb-3">${icon('megaphone', 18)} Rezumat feed</div>
        <div class="grid grid-2 gap-4">
          ${cell('Total', total)}
          ${cell('Necitite', unread, unread ? 't-red' : '')}
          ${cell('Fixate', pinned)}
          ${cell('Critice', crit, crit ? 't-red' : '')}
        </div>
      </div>`;
  }

  /* ---------- detail modal ---------- */
  function openAnn(a, ctx) {
    const d = U.dept(a.dept), pr = priorityMeta(a.priority);
    ctx.modal({
      title: a.title,
      body: `
        <div class="row gap-2 wrap mb-4">
          <span class="tag ${d.tag}">${d.name}</span>
          <span class="badge ${pr.badge}">${pr.icon ? icon(pr.icon, 12) : ''} ${pr.label}</span>
          <span class="badge badge--soft">${a.category}</span>
          ${a.pinned ? `<span class="badge badge--soft">${icon('pin', 12)} Fixat</span>` : ''}
        </div>
        <p class="t-muted mb-4">${a.body}</p>
        <div class="grid grid-2 gap-3">
          <div><div class="stat-label">Autor</div><div class="t-semi">${a.author}</div></div>
          <div><div class="stat-label">Publicat</div><div class="t-semi">${U.fmtDate(a.date)} (${U.relDay(a.date)})</div></div>
        </div>
        ${a.form ? `<div class="alert alert--info mt-4"><span class="alert-ic">${icon('flag', 18)}</span>
          <div>Formular asociat: <b>${a.form}</b></div></div>` : ''}`,
      foot: `
        <button class="btn btn-ghost" data-close>Închide</button>
        ${a.form ? `<button class="btn btn-outline" id="m-form">${icon('arrowRight', 16)} Deschide formular</button>` : ''}
        ${!a.read
          ? `<button class="btn btn-primary" id="m-read">${icon('check', 16)} Marchează citit</button>`
          : `<span class="badge badge--green">${icon('check', 13)} Citit</span>`}`,
      onMount(modalEl, close) {
        const rb = modalEl.querySelector('#m-read');
        if (rb) rb.addEventListener('click', () => {
          a.read = true; close();
          ctx.toast({ title: 'Marcat ca citit', body: a.title, icon: 'check' });
          ctx.navigate('announcements');
        });
        const fb = modalEl.querySelector('#m-form');
        if (fb) fb.addEventListener('click', () => {
          close();
          ctx.toast({ title: 'Formular deschis', body: a.form, icon: 'flag' });
        });
      },
    });
  }

  /* ---------- compose modal (responsabil / bc) ---------- */
  function openCompose(ctx) {
    const deptOpts = D.departments.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
    const cats = [...new Set(D.announcements.map(a => a.category))];
    const catOpts = cats.map(c => `<option value="${c}">${c}</option>`).join('');
    ctx.modal({
      title: 'Anunț nou',
      size: 'lg',
      body: `
        <div class="field">
          <label class="label">Titlu</label>
          <input class="input" id="c-title" placeholder="Ex: Call proiecte toamnă 2026 — deschis">
        </div>
        <div class="field">
          <label class="label">Conținut</label>
          <textarea class="textarea" id="c-body" placeholder="Scrie anunțul pentru membri…"></textarea>
        </div>
        <div class="grid grid-2 gap-3">
          <div class="field">
            <label class="label">Prioritate</label>
            <select class="select" id="c-prio">
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="critical">Critic</option>
            </select>
          </div>
          <div class="field">
            <label class="label">Departament</label>
            <select class="select" id="c-dept">${deptOpts}</select>
          </div>
        </div>
        <div class="field">
          <label class="label">Categorie</label>
          <select class="select" id="c-cat">${catOpts}</select>
        </div>
        <div class="field">
          <label class="checkbox"><input type="checkbox" id="c-hasform"> <span class="t-semi">Atașează un formular</span></label>
          <input class="input mt-2 hide" id="c-form" placeholder="Nume formular (ex: Formular call proiecte)">
          <div class="hint">Membrii vor vedea un buton „Deschide formular”.</div>
        </div>
        <div class="row between gap-3 card-pad" style="background:var(--surface-2);border-radius:var(--r-sm)">
          <div>
            <div class="t-semi">${icon('alert', 14)} Trimite ca pop-up critic</div>
            <div class="hint">Afișează un pop-up roșu instant tuturor membrilor (§3.7).</div>
          </div>
          <label class="switch"><input type="checkbox" id="c-critical"><span class="track"></span></label>
        </div>`,
      foot: `
        <button class="btn btn-ghost" data-close>Renunță</button>
        <button class="btn btn-primary" id="c-submit">${icon('megaphone', 16)} Publică anunțul</button>`,
      onMount(modalEl, close) {
        const hf = modalEl.querySelector('#c-hasform');
        const fi = modalEl.querySelector('#c-form');
        hf.addEventListener('change', () => fi.classList.toggle('hide', !hf.checked));

        modalEl.querySelector('#c-submit').addEventListener('click', () => {
          const title = modalEl.querySelector('#c-title').value.trim() || 'Anunț fără titlu';
          const prio = modalEl.querySelector('#c-prio').value;
          const critical = modalEl.querySelector('#c-critical').checked || prio === 'critical';
          close();
          ctx.toast({ title: 'Anunț publicat', body: `„${title}” a fost trimis în feed.`, icon: 'megaphone' });
          if (critical) {
            ctx.toast({
              critical: true, icon: 'alert',
              title: 'Anunț critic trimis ca pop-up',
              body: title, timeout: 7000,
            });
          }
        });
      },
    });
  }

  /* ---------- view ---------- */
  OSUBB.registerView('announcements', {
    label: 'Anunțuri', icon: 'megaphone', title: 'Anunțuri',

    count(ctx) { return unreadCount(); },

    render(ctx) {
      const canPost = ctx.role === 'responsabil' || ctx.role === 'bc';
      const unread = unreadCount();
      const first = ctx.user.name.split(' ')[0];
      const cats = [...new Set(D.announcements.map(a => a.category))];
      const crit = D.announcements.find(a => a.priority === 'critical');

      const pills = `
        <button class="filter-pill is-active" data-filter="all">Toate</button>
        ${cats.map(c => `<button class="filter-pill" data-filter="${c}">${c}</button>`).join('')}`;

      const banner = crit ? `
        <div class="alert alert--danger mb-5" data-ann="${crit.id}" style="cursor:pointer">
          <span class="alert-ic">${icon('alert', 20)}</span>
          <div class="grow">
            <div class="t-bold">Anunț critic: ${crit.title}</div>
            <div class="t-sm">${crit.body}</div>
          </div>
          <button class="btn btn-danger btn-sm" data-ann="${crit.id}">Citește acum</button>
        </div>` : '';

      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Anunțuri</h1>
              <p class="page-sub">Salut, ${first}! ${unread
                ? `Ai <b class="t-red">${unread}</b> ${unread === 1 ? 'anunț necitit' : 'anunțuri necitite'} în feed.`
                : 'Ești la zi cu toate anunțurile 🎉'}</p>
            </div>
            ${canPost ? `<button class="btn btn-primary" id="ann-new">${icon('plus', 18)} Anunț nou</button>` : ''}
          </div>

          ${banner}

          <div class="toolbar">
            <div class="search" style="flex:1;max-width:340px">
              ${icon('search', 17)}<input id="ann-search" placeholder="Caută în anunțuri…">
            </div>
            <div class="row gap-2 wrap">${pills}</div>
          </div>

          <div class="grid grid-wide">
            <div class="col gap-4" id="ann-list">
              ${ordered().map(annCard).join('')}
              <div class="card card-pad hide" id="ann-empty">
                <div class="empty"><div class="empty-ic">${icon('search', 24)}</div>
                  Niciun anunț nu corespunde filtrelor.</div>
              </div>
            </div>

            <div class="col gap-5">
              ${formRail()}
              ${summaryCard()}
            </div>
          </div>
        </div>`;
    },

    mount(root, ctx) {
      // compose
      const nb = root.querySelector('#ann-new');
      if (nb) nb.addEventListener('click', () => openCompose(ctx));

      // open form (toast) — stop card/row from also opening detail
      root.querySelectorAll('[data-form]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = D.announcements.find(x => x.id == b.getAttribute('data-form'));
        ctx.toast({ title: 'Formular deschis', body: a.form, icon: 'flag' });
      }));

      // open detail
      root.querySelectorAll('[data-ann]').forEach(el => el.addEventListener('click', () => {
        const a = D.announcements.find(x => x.id == el.getAttribute('data-ann'));
        openAnn(a, ctx);
      }));

      // filtering (category pills + search)
      const cards = [...root.querySelectorAll('#ann-list [data-ann]')];
      const empty = root.querySelector('#ann-empty');
      const search = root.querySelector('#ann-search');
      const pills = [...root.querySelectorAll('[data-filter]')];
      let cat = 'all', q = '';

      function apply() {
        let any = false;
        cards.forEach(card => {
          const okCat = cat === 'all' || card.getAttribute('data-cat') === cat;
          const okQ = !q || card.getAttribute('data-text').indexOf(q) !== -1;
          const show = okCat && okQ;
          card.classList.toggle('hide', !show);
          if (show) any = true;
        });
        if (empty) empty.classList.toggle('hide', any);
      }

      pills.forEach(p => p.addEventListener('click', () => {
        pills.forEach(x => x.classList.toggle('is-active', x === p));
        cat = p.getAttribute('data-filter');
        apply();
      }));
      if (search) search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); apply(); });
    },
  });
})();
