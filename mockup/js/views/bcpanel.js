/* ============================================================================
   View: Panou BC  — admin panel for Biroul Coordonator (bc only)
   Priorities §6 (acordare puncte, sancțiuni, cereri) + plan managerial (raport,
   roluri, postare taskuri/activități/anunțuri la nivel de organizație).
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data;

  const SANCTIONS = 2; // demo: sancțiuni active în semestru

  function memberColor(name) {
    const v = D.volunteers.find(x => x.name === name);
    return v ? v.avatarColor : '#3A3A3D';
  }
  function topMembers(n) {
    return [...D.volunteers].sort((a, b) => b.points - a.points).slice(0, n);
  }

  /* ---------- Stat header ---------- */
  function statCards() {
    const total = D.volunteers.length;
    const activi = D.volunteers.filter(v => v.status === 'activ').length;
    const cereri = D.taskRequests.length;
    const pct = Math.round(activi / total * 100);
    return `
      <div class="grid grid-4">
        <div class="card stat">
          <div class="row between"><span class="stat-label">Membri total</span>
            <span class="stat-icon">${OSUBB.icon('users', 20)}</span></div>
          <div class="stat-value t-num">${total}</div>
          <div class="stat-trend up">${OSUBB.icon('arrowUp', 14)} +2 față de luna trecută</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Membri activi</span>
            <span class="stat-icon">${OSUBB.icon('checkCircle', 20)}</span></div>
          <div class="stat-value t-num">${activi}</div>
          <div class="stat-trend up">${pct}% din organizație</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Cereri în așteptare</span>
            <span class="stat-icon">${OSUBB.icon('clock', 20)}</span></div>
          <div class="stat-value t-num">${cereri}</div>
          <div class="stat-trend down">necesită răspuns</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Sancțiuni</span>
            <span class="stat-icon">${OSUBB.icon('alert', 20)}</span></div>
          <div class="stat-value t-num">${SANCTIONS}</div>
          <div class="stat-trend">în acest semestru</div>
        </div>
      </div>`;
  }

  /* ---------- Cereri de task ---------- */
  function requestRow(r) {
    return `
      <div class="list-row" data-req="${r.id}">
        ${U.avatar(r.from, memberColor(r.from), 'avatar-sm')}
        <div class="list-main">
          <div class="row gap-2 wrap">
            <span class="t-semi truncate">${r.title}</span>
            <span class="tag tag--soft ${U.deptTag(r.dept)}">${U.dept(r.dept).short}</span>
            <span class="badge badge--soft">${r.points}p</span>
          </div>
          <div class="list-meta">
            <span class="t-semi">${r.from}</span>
            <span class="t-faint truncate">· ${r.note}</span>
          </div>
        </div>
        <button class="btn btn-success btn-sm" data-grant="${r.id}">${OSUBB.icon('check', 14)} Acordă +${r.points}p</button>
        <button class="btn btn-ghost btn-sm" data-reject="${r.id}">Respinge</button>
      </div>`;
  }

  function requestsCard() {
    return `
      <div class="card" id="req-card">
        <div class="card-head">
          <span class="card-title">${OSUBB.icon('task', 18)} Cereri de task
            <span class="badge badge--red">${D.taskRequests.length}</span></span>
          <button class="card-link" data-go="tasktracker">Task Tracker</button>
        </div>
        <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
          <div class="list" id="req-list">${D.taskRequests.map(requestRow).join('')}</div>
        </div>
      </div>`;
  }

  /* ---------- Acordare puncte & sancțiuni (tabel membri) ---------- */
  function memberRow(v, i) {
    return `
      <tr data-member="${v.id}">
        <td class="t-faint t-num">${i + 1}</td>
        <td>
          <div class="row gap-2">
            ${U.avatar(v.name, v.avatarColor, 'avatar-sm')}
            <div style="min-width:0">
              <div class="t-semi truncate">${v.name}</div>
              <div class="t-xs t-muted truncate">${v.email}</div>
            </div>
          </div>
        </td>
        <td><span class="tag tag--soft ${U.deptTag(v.dept)}">${U.dept(v.dept).short}</span></td>
        <td><span class="badge badge--soft">${U.role(v.role)}</span></td>
        <td class="td-num">${U.pts(v.points)}</td>
        <td>
          <div class="row gap-2" style="justify-content:flex-end">
            <button class="btn btn-outline btn-sm" data-addpts="${v.id}">${OSUBB.icon('plus', 14)} puncte</button>
            <button class="btn btn-danger btn-sm" data-sanction="${v.id}">Sancțiune</button>
          </div>
        </td>
      </tr>`;
  }

  function scoringCard() {
    const rows = topMembers(8);
    return `
      <div class="card">
        <div class="card-head">
          <span class="card-title">${OSUBB.icon('sparkle', 18)} Acordare puncte & sancțiuni</span>
          <span class="t-xs t-faint">top 8 după punctaj</span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th style="width:34px">#</th><th>Membru</th><th>Dept.</th><th>Rol</th>
              <th class="t-right">Puncte</th><th class="t-right">Acțiuni</th>
            </tr></thead>
            <tbody>${rows.map(memberRow).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---------- Raport ---------- */
  function reportCard() {
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">${OSUBB.icon('download', 18)} Raport BC</span></div>
        <div class="card-body">
          <p class="t-sm t-muted mb-3">Raport de activitate cu taskurile acordate de la ultimul AGO și sancțiunile aplicate, pentru ședința Biroului Coordonator.</p>
          <div class="list">
            <div class="list-row"><div class="grow"><span class="t-sm t-muted">Taskuri acordate</span></div><span class="t-bold t-num">128</span></div>
            <div class="list-row"><div class="grow"><span class="t-sm t-muted">Puncte distribuite</span></div><span class="t-bold t-num">${U.pts(2410)}</span></div>
            <div class="list-row"><div class="grow"><span class="t-sm t-muted">Cereri rezolvate</span></div><span class="t-bold t-num">36</span></div>
            <div class="list-row"><div class="grow"><span class="t-sm t-muted">Sancțiuni aplicate</span></div><span class="t-bold t-num">${SANCTIONS}</span></div>
          </div>
          <button class="btn btn-primary btn-block mt-4" data-report>${OSUBB.icon('download', 16)} Exportă raport</button>
        </div>
      </div>`;
  }

  /* ---------- Management roluri ---------- */
  function roleSelectRow(v) {
    return `
      <div class="list-row">
        ${U.avatar(v.name, v.avatarColor, 'avatar-sm')}
        <div class="list-main">
          <div class="t-semi t-sm truncate">${v.name}</div>
          <div class="t-xs t-muted truncate">${U.dept(v.dept).name} · ${U.pts(v.points)}p</div>
        </div>
        <select class="select" data-role="${v.id}" style="width:auto;min-width:152px;height:36px;font-size:var(--fs-sm)">
          ${D.roles.map(r => `<option value="${r.id}" ${r.id === v.role ? 'selected' : ''}>${r.name}</option>`).join('')}
        </select>
      </div>`;
  }

  function rolesCard(ctx) {
    const ids = [3, 4, 5, 8]; // Vlad (RP), Alex (BCE), Paul, Andrei
    const members = ids.map(id => D.volunteers.find(v => v.id === id)).filter(Boolean);
    const isMod = ctx && ctx.role === 'moderator';
    const note = isMod
      ? 'Moderator: poți schimba membrii BC (după alegerea în Adunarea Generală).'
      : 'BC: numești BCE (coordonatori) și Responsabilii de proiect. Membrii BC sunt aleși de AG și actualizați de Moderator.';
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">${OSUBB.icon('shield', 18)} Management roluri</span>
          <button class="card-link" data-go="volunteers">Toți voluntarii</button></div>
        <div class="card-body" style="padding-top:var(--s-3);padding-bottom:var(--s-3)">
          <div class="alert alert--info mb-3"><span class="alert-ic">${OSUBB.icon('shield', 16)}</span><div class="t-sm">${note}</div></div>
          <div class="list">${members.map(roleSelectRow).join('')}</div>
        </div>
      </div>`;
  }

  /* ---------- Acțiuni rapide ---------- */
  function quickActionsCard() {
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">${OSUBB.icon('plus', 18)} Acțiuni rapide</span></div>
        <div class="card-body col gap-3">
          <button class="btn btn-outline btn-block" data-go="tasktracker">${OSUBB.icon('task', 16)} Postează task organizație</button>
          <button class="btn btn-outline btn-block" data-go="calendar">${OSUBB.icon('calendar', 16)} Creează activitate</button>
          <button class="btn btn-outline btn-block" data-go="announcements">${OSUBB.icon('megaphone', 16)} Anunț nou</button>
          <button class="btn btn-outline btn-block" id="bc-csv">${OSUBB.icon('userplus', 16)} Importă recruți (CSV)</button>
          <button class="btn btn-outline btn-block" data-go="tasktracker">${OSUBB.icon('eye', 16)} Fișele voluntarilor</button>
        </div>
      </div>`;
  }

  /* ---------- Modals ---------- */
  function memberHead(v) {
    return `
      <div class="row gap-3 mb-4">
        ${U.avatar(v.name, v.avatarColor)}
        <div><div class="t-semi">${v.name}</div>
          <div class="t-sm t-muted">${U.role(v.role)} · ${U.dept(v.dept).name} · ${U.pts(v.points)}p</div></div>
      </div>`;
  }

  function openAddPoints(v, ctx) {
    ctx.modal({
      title: `Acordă puncte — ${v.name}`,
      body: `
        ${memberHead(v)}
        <div class="row between mb-3"><span class="t-sm t-muted">Aceeași formulă ca la taskuri (★ × rating).</span>
          <button type="button" class="btn btn-ghost btn-sm" id="ap-guide">${OSUBB.icon('target', 15)} Ghid de punctare</button></div>
        <div class="grid grid-2 gap-3">
          <div class="field"><label class="label">Dificultate</label>
            <div class="star-pick" id="ap-stars">${[1,2,3,4,5].map(i => `<span class="star" data-star="${i}">★</span>`).join('')}</div></div>
          <div class="field"><label class="label">Rating</label>
            <select class="select" id="ap-rate">${D.ratingGuide.map(r => `<option value="${r.rating}" ${r.rating === 3 ? 'selected' : ''}>${r.rating} — ${r.label} (×${r.mult < 0 ? '−1' : r.mult})</option>`).join('')}</select></div>
        </div>
        <div class="row between card-pad" style="background:var(--surface-2);border-radius:var(--r-sm)">
          <span class="t-semi">Puncte de acordat</span><span class="pts-preview" id="ap-pts">—</span></div>
        <div class="field mt-4" style="margin-bottom:0">
          <label class="label">Motiv (apare în notificare)</label>
          <textarea class="textarea" id="pts-reason" placeholder="ex: Distribuire afișe în 3 facultăți">Activitate de voluntariat</textarea>
        </div>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button>
             <button class="btn btn-primary" id="pts-confirm">${OSUBB.icon('sparkle', 16)} Acordă puncte</button>`,
      onMount(modal, close) {
        let diff = 0;
        const rate = modal.querySelector('#ap-rate'), ptsEl = modal.querySelector('#ap-pts');
        const calc = () => {
          if (!diff) { ptsEl.textContent = '—'; ptsEl.className = 'pts-preview'; return 0; }
          const p = diff * OSUBB.util.ratingMult(+rate.value);
          ptsEl.textContent = `${p > 0 ? '+' : ''}${p} puncte`;
          ptsEl.className = 'pts-preview' + (p < 0 ? ' neg' : p === 0 ? ' zero' : '');
          return p;
        };
        modal.querySelectorAll('#ap-stars .star').forEach(s => s.onclick = () => { diff = +s.dataset.star; modal.querySelectorAll('#ap-stars .star').forEach(x => x.classList.toggle('on', +x.dataset.star <= diff)); calc(); });
        rate.onchange = calc;
        modal.querySelector('#ap-guide').onclick = () => OSUBB.openScoringGuide(ctx);
        modal.querySelector('#pts-confirm').addEventListener('click', () => {
          const p = calc();
          ctx.toast({ title: 'Puncte acordate, notificare trimisă', body: `${p > 0 ? '+' : ''}${p}p către ${v.name}.`, icon: 'sparkle' });
          close();
        });
      },
    });
  }

  function openSanction(v, ctx) {
    ctx.modal({
      title: `Sancțiune — ${v.name}`,
      body: `
        <div class="alert alert--danger mb-4">
          <span class="alert-ic">${OSUBB.icon('alert', 20)}</span>
          <div>O sancțiune scade din punctaj și notifică voluntarul. Acțiunea apare în raportul BC.</div>
        </div>
        ${memberHead(v)}
        <div class="field">
          <label class="label">Tip sancțiune</label>
          <select class="select" id="sanc-type">
            <option>Avertisment</option>
            <option>Depunctare 10p</option>
            <option>Depunctare 25p</option>
            <option>Suspendare temporară</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="label">Motiv</label>
          <textarea class="textarea" id="sanc-reason" placeholder="ex: Absență nemotivată la 2 ședințe consecutive"></textarea>
        </div>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button>
             <button class="btn btn-danger" id="sanc-confirm">${OSUBB.icon('alert', 16)} Aplică sancțiune</button>`,
      onMount(modal, close) {
        modal.querySelector('#sanc-confirm').addEventListener('click', () => {
          const t = modal.querySelector('#sanc-type').value;
          ctx.toast({ title: 'Sancțiune acordată — voluntarul a fost notificat', body: `${v.name} · ${t}`, icon: 'alert', critical: true });
          close();
        });
      },
    });
  }

  function openCsvImport(ctx) {
    ctx.modal({
      title: 'Importă recruți (CSV)', size: 'lg',
      body: `
        <p class="t-muted mb-4">După fiecare recrutare, încarci CSV-ul cu recruții. Aplicația le creează automat conturi cu emailul și datele din fișier, generează o <b>parolă aleatorie</b> și le recomandă schimbarea ei la prima conectare.</p>
        <div class="card card-pad mb-4" style="background:var(--surface-2);border:1px dashed var(--border)">
          <div class="row gap-3"><span class="stat-icon">${OSUBB.icon('download', 20)}</span>
            <div><div class="t-semi">recruti_toamna_2026.csv</div><div class="t-xs t-muted">nume, email, telefon, facultate, departament</div></div>
            <button class="btn btn-outline btn-sm" style="margin-left:auto" data-pick>Alege fișier</button></div>
        </div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Nume</th><th>Email</th><th>Departament</th><th>Cont</th></tr></thead>
          <tbody>
            <tr><td class="t-semi">Andra Pop</td><td class="t-sm t-muted">andra.pop@osubb.ro</td><td><span class="tag tag--soft dept-edu">EDU</span></td><td><span class="badge badge--green">generat</span></td></tr>
            <tr><td class="t-semi">Mihai Ene</td><td class="t-sm t-muted">mihai.ene@osubb.ro</td><td><span class="tag tag--soft dept-hr">HR</span></td><td><span class="badge badge--green">generat</span></td></tr>
            <tr><td class="t-semi">Raluca Vid</td><td class="t-sm t-muted">raluca.vid@osubb.ro</td><td><span class="tag tag--soft dept-pr">IMG&PR</span></td><td><span class="badge badge--green">generat</span></td></tr>
          </tbody></table></div>
        <p class="hint mt-3">${OSUBB.icon('shield', 13)} Parolele generate sunt trimise pe email; recruții sunt rugați să le schimbe.</p>`,
      foot: `<button class="btn btn-ghost" data-close>Anulează</button>
             <button class="btn btn-primary" data-close id="csv-go">${OSUBB.icon('userplus', 16)} Creează 3 conturi</button>`,
      onMount(modal) {
        const pick = modal.querySelector('[data-pick]'); if (pick) pick.onclick = () => pick.textContent = 'recruti_toamna_2026.csv ✓';
        modal.querySelector('#csv-go').onclick = () => ctx.toast({ title: 'Conturi create', body: '3 recruți au primit conturi cu parole generate. Notificați pe email.', icon: 'userplus' });
      },
    });
  }

  /* ---------- View ---------- */
  OSUBB.registerView('bcpanel', {
    label: 'Panou BC', icon: 'shield', title: 'Panou BC',
    count(ctx) { return ctx.data.taskRequests.length; },

    render(ctx) {
      const first = ctx.user.name.split(' ')[0];
      const cereri = D.taskRequests.length;
      const activi = D.volunteers.filter(v => v.status === 'activ').length;
      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Panou BC</h1>
              <p class="page-sub">Salut, ${first} 👋 Ai ${cereri} cereri de aprobat și ${activi} membri activi azi.</p>
            </div>
            <div class="row gap-2">
              <span class="role-badge"><span class="dot"></span>Membru BC</span>
              <button class="btn btn-primary" data-report>${OSUBB.icon('download', 18)} Exportă raport</button>
            </div>
          </div>

          ${statCards()}

          <div class="grid grid-main mt-5">
            <div class="col gap-5">
              ${requestsCard()}
              ${scoringCard()}
            </div>
            <div class="col gap-5">
              ${reportCard()}
              ${rolesCard(ctx)}
              ${quickActionsCard()}
            </div>
          </div>
        </div>`;
    },

    mount(root, ctx) {
      // Export raport (header + card)
      root.querySelectorAll('[data-report]').forEach(b => b.addEventListener('click', () => {
        ctx.toast({ title: 'Raport generat: taskuri de la ultimul AGO + sancțiuni', body: 'Fișier descărcat în Documente.', icon: 'download' });
      }));

      // Cereri de task — acordă / respinge
      root.querySelectorAll('[data-grant]').forEach(b => b.addEventListener('click', () => {
        const r = D.taskRequests.find(x => x.id == b.getAttribute('data-grant'));
        ctx.toast({ title: 'Cerere aprobată', body: `+${r.points}p către ${r.from}. Notificare trimisă.`, icon: 'check' });
        const row = b.closest('[data-req]'); if (row) row.remove();
      }));
      root.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => {
        const r = D.taskRequests.find(x => x.id == b.getAttribute('data-reject'));
        ctx.toast({ title: 'Cerere respinsă', body: `${r.from} a fost notificat.`, icon: 'close' });
        const row = b.closest('[data-req]'); if (row) row.remove();
      }));

      // Acordare puncte / sancțiune
      root.querySelectorAll('[data-addpts]').forEach(b => b.addEventListener('click', () => {
        const v = D.volunteers.find(x => x.id == b.getAttribute('data-addpts'));
        openAddPoints(v, ctx);
      }));
      root.querySelectorAll('[data-sanction]').forEach(b => b.addEventListener('click', () => {
        const v = D.volunteers.find(x => x.id == b.getAttribute('data-sanction'));
        openSanction(v, ctx);
      }));

      // Management roluri
      root.querySelectorAll('[data-role]').forEach(sel => sel.addEventListener('change', () => {
        const v = D.volunteers.find(x => x.id == sel.getAttribute('data-role'));
        ctx.toast({ title: 'Rol actualizat', body: `${v.name} → ${U.role(sel.value)}. Voluntarul a fost notificat.`, icon: 'shield' });
      }));

      // Import recruți (CSV) — conturi generate automat
      const csv = root.querySelector('#bc-csv');
      if (csv) csv.addEventListener('click', () => openCsvImport(ctx));
    },
  });
})();
