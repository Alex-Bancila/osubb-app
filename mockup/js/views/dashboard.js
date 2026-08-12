/* ============================================================================
   View: Dashboard (Acasă)  — role-adaptive personal panel + gamification
   Reference implementation: shows the house style for all other views.
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data;

  function myTasks(user) { return D.tasks.filter(t => t.assignees.includes(user.name)); }
  function upcoming(limit, ctx) {
    return D.events
      .filter(e => !U.isPast({ m: e.m, d: e.d }) && e.type !== 'deadline' && OSUBB.eventVisible(e, ctx.user, ctx.role))
      .sort((a, b) => (a.m * 100 + a.d) - (b.m * 100 + b.d))
      .slice(0, limit);
  }

  function tierBanner(user) {
    const span = user.tierMax - user.tierMin;
    const pct = Math.max(6, Math.min(100, Math.round((user.points - user.tierMin) / span * 100)));
    const toNext = Math.max(0, user.tierMax - user.points);
    const topTier = user.nextTier === '—';
    return `
      <div class="card card-accent card-pad">
        <div class="row between wrap gap-4">
          <div class="grow" style="min-width:240px">
            <div class="row gap-2 mb-2">
              <span class="role-badge"><span class="dot"></span>${user.tier}</span>
              ${topTier ? `<span class="badge badge--amber">Nivel maxim</span>`
                        : `<span class="badge badge--soft">Următorul: ${user.nextTier}</span>`}
            </div>
            <h3>${topTier ? 'Ești în vârful organizației 🔥' : `Următorul nivel: „${user.nextTier}”`}</h3>
            <div class="progress mt-3" style="max-width:520px"><div class="progress-bar" style="width:${pct}%"></div></div>
            <div class="t-sm t-muted mt-2">${U.pts(user.points)} puncte${user.percentile ? ' · ' + user.percentile : ''} · ${user.promo && user.promo.note ? user.promo.note : (topTier ? 'nivel maxim' : 'continuă tot așa!')}</div>
          </div>
          <div class="ring" style="--pct:${pct}"><span>${pct}%</span></div>
        </div>
      </div>`;
  }

  function statCards(user) {
    const due = myTasks(user).filter(t => t.status !== 'done').length;
    const toRank = user.rank > 1 ? user.nextRankPts : 0;
    return `
      <div class="grid grid-4">
        <div class="card stat">
          <div class="row between"><span class="stat-label">Punctaj total</span>
            <span class="stat-icon">${OSUBB.icon('sparkle', 20)}</span></div>
          <div class="stat-value t-num">${U.pts(user.points)}</div>
          <div class="stat-trend up">${OSUBB.icon('arrowUp', 14)} +25 această săptămână</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Clasament</span>
            <span class="stat-icon">${OSUBB.icon('trophy', 20)}</span></div>
          <div class="stat-value t-num">#${user.rank}<span class="t-faint" style="font-size:var(--fs-md)"> / ${user.totalMembers}</span></div>
          <div class="stat-trend ${user.rank > 1 ? 'up' : ''}">${user.rank > 1 ? `${OSUBB.icon('arrowUp', 14)} +${toRank}p până la #${user.rank - 1}` : 'Locul 1 🏆'}</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Taskuri scadente</span>
            <span class="stat-icon">${OSUBB.icon('task', 20)}</span></div>
          <div class="stat-value t-num">${due}</div>
          <div class="stat-trend ${due ? 'down' : ''}">${due ? 'necesită atenție' : 'totul la zi ✓'}</div>
        </div>
        <div class="card stat">
          <div class="row between"><span class="stat-label">Departamente</span>
            <span class="stat-icon">${OSUBB.icon('layers', 20)}</span></div>
          <div class="stat-value t-num">${user.depts.length}</div>
          <div class="row gap-1 wrap mt-1">${user.depts.map(id => `<span class="tag tag--soft ${U.deptTag(id)}">${U.dept(id).short}</span>`).join('')}</div>
        </div>
      </div>`;
  }

  function eventRow(e) {
    return `
      <div class="list-row clickable" data-event="${e.id}">
        <div class="list-lead" style="background:${U.dept(e.dept).color}1a;color:${U.dept(e.dept).color}">
          ${OSUBB.icon(e.type === 'call' ? 'megaphone' : e.type === 'sedinta' ? 'users' : 'calendar', 20)}
        </div>
        <div class="list-main">
          <div class="list-title truncate">${e.title}</div>
          <div class="list-meta">
            <span class="tag tag--soft ${U.deptTag(e.dept)}">${U.dept(e.dept).short}</span>
            <span>${U.relDay({ m: e.m, d: e.d })}${e.time !== '—' ? ' · ' + e.time : ''}</span>
            <span class="t-faint">· ${e.going} participă</span>
          </div>
        </div>
        ${e.joined
          ? `<span class="badge badge--green">${OSUBB.icon('check', 13)} Vin</span>`
          : `<button class="btn btn-outline btn-sm" data-going="${e.id}">Vin</button>`}
      </div>`;
  }

  function taskRow(t) {
    const st = U.taskStatus(t.status);
    return `
      <div class="list-row clickable" data-task="${t.id}">
        <div class="list-main">
          <div class="row gap-2"><span class="t-semi truncate">${t.title}</span></div>
          <div class="list-meta">
            <span class="tag tag--soft ${U.deptTag(t.dept)}">${U.dept(t.dept).short}</span>
            <span>${OSUBB.icon('clock', 13)} ${U.fmtDate(t.deadline)}</span>
            <span class="t-faint">· ${t.points}p</span>
          </div>
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
      </div>`;
  }

  function sideColumn(ctx) {
    const user = ctx.user;
    const anns = D.announcements.slice(0, 3);
    const lb = D.leaderboard.slice(0, 5);
    return `
      <div class="col gap-5">
        <div class="card">
          <div class="card-head"><span class="card-title">${OSUBB.icon('megaphone', 18)} Anunțuri</span>
            <button class="card-link" data-go="announcements">Toate</button></div>
          <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-2)">
            <div class="list">
              ${anns.map(a => `
                <div class="list-row clickable" data-go="announcements">
                  <div class="dot ${a.priority === 'critical' ? 'dot--red' : a.priority === 'important' ? 'dot--amber' : 'dot--blue'}"></div>
                  <div class="list-main">
                    <div class="t-semi t-sm truncate">${a.title}</div>
                    <div class="t-xs t-muted">${U.relDay(a.date)} · ${a.category}</div>
                  </div>
                  ${a.priority === 'critical' ? `<span class="badge badge--red">${OSUBB.icon('alert', 12)} critic</span>` : ''}
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title">${OSUBB.icon('trophy', 18)} Clasament</span>
            <button class="card-link" data-go="profile">Cupa departamentelor</button></div>
          <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
            <div class="list">
              ${lb.map(p => `
                <div class="list-row ${p.you ? 'is-you' : ''}" style="${p.you ? 'background:var(--red-050);border-radius:var(--r-sm)' : ''}">
                  <div class="t-extra t-num" style="width:24px;color:${p.rank <= 3 ? 'var(--red)' : 'var(--ink-400)'}">${p.rank}</div>
                  ${U.avatar(p.name, U.dept(p.dept).color, 'avatar-sm')}
                  <div class="list-main"><div class="t-semi t-sm truncate">${p.name}${p.you ? ' <span class="badge badge--red">tu</span>' : ''}</div></div>
                  <div class="t-bold t-num">${U.pts(p.points)}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  OSUBB.registerView('dashboard', {
    label: 'Acasă', icon: 'home', title: 'Panou principal',

    render(ctx) {
      const user = ctx.user;
      const first = user.name.split(' ')[0];
      const tasks = myTasks(user).filter(t => t.status !== 'done').slice(0, 5);
      const evs = upcoming(4, ctx);
      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Salut, ${first} 👋</h1>
              <p class="page-sub">Duminică, 28 iunie 2026 · iată ce urmează pentru tine.</p>
            </div>
            <button class="btn btn-primary" data-go="tasktracker">${OSUBB.icon(OSUBB.can('manageTasks', ctx.role) ? 'plus' : 'task', 18)} ${OSUBB.can('manageTasks', ctx.role) ? 'Task nou' : 'Fișa mea'}</button>
          </div>

          ${tierBanner(user)}
          <div class="mt-5">${statCards(user)}</div>

          <div class="grid grid-main mt-5">
            <div class="col gap-5">
              <div class="card">
                <div class="card-head"><span class="card-title">${OSUBB.icon('calendar', 18)} Urmează săptămâna asta</span>
                  <button class="card-link" data-go="calendar">Calendar</button></div>
                <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
                  <div class="list">${evs.map(eventRow).join('')}</div>
                </div>
              </div>

              <div class="card">
                <div class="card-head"><span class="card-title">${OSUBB.icon('task', 18)} Taskurile mele</span>
                  <button class="card-link" data-go="tasktracker">Task Tracker</button></div>
                <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
                  ${tasks.length ? `<div class="list">${tasks.map(taskRow).join('')}</div>`
                    : `<div class="empty"><div class="empty-ic">${OSUBB.icon('check', 24)}</div>Niciun task scadent. Bravo!</div>`}
                </div>
              </div>
            </div>

            ${sideColumn(ctx)}
          </div>
        </div>`;
    },

    mount(root, ctx) {
      root.querySelectorAll('[data-going]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const ev = D.events.find(x => x.id == b.getAttribute('data-going'));
        ev.joined = true; ev.going++;
        ctx.toast({ title: 'Participare confirmată', body: `Te-ai înscris la „${ev.title}”. Apare în calendarul tău.`, icon: 'check' });
        ctx.navigate('dashboard');
      }));

      root.querySelectorAll('[data-event]').forEach(r => r.addEventListener('click', () => {
        const ev = D.events.find(x => x.id == r.getAttribute('data-event'));
        openEvent(ev, ctx);
      }));

      root.querySelectorAll('[data-task]').forEach(r => r.addEventListener('click', () => {
        const t = D.tasks.find(x => x.id == r.getAttribute('data-task'));
        openTask(t, ctx);
      }));
    },
  });

  // shared mini-modals reused by other views via OSUBB.openEvent / openTask
  function openEvent(ev, ctx) {
    OSUBB.modal({
      title: ev.title,
      body: `
        <div class="row gap-2 wrap mb-4">
          <span class="tag ${U.deptTag(ev.dept)}">${U.dept(ev.dept).name}</span>
          <span class="badge badge--soft">${ev.scope === 'org' ? 'Toată organizația' : ev.scope === 'team' ? 'Echipă' : ev.scope === 'project' ? 'Proiect' : 'Departament'}</span>
          ${ev.qr ? `<span class="badge badge--grey">${OSUBB.icon('qr', 12)} check-in QR</span>` : ''}
        </div>
        <p class="t-muted mb-4">${ev.desc}</p>
        <div class="grid grid-2 gap-3">
          <div><div class="stat-label">Data</div><div class="t-semi">${U.fmtDate({ m: ev.m, d: ev.d })} (${U.relDay({ m: ev.m, d: ev.d })})</div></div>
          <div><div class="stat-label">Ora</div><div class="t-semi">${ev.time}${ev.end ? '–' + ev.end : ''}</div></div>
          <div><div class="stat-label">Locație</div><div class="t-semi">${ev.location || '—'}</div></div>
          <div><div class="stat-label">Participă</div><div class="t-semi">${ev.going}${ev.capacity ? ' / ' + ev.capacity : ''}</div></div>
        </div>`,
      foot: `<button class="btn btn-ghost" data-close>Închide</button>
             <button class="btn btn-primary" data-close id="ev-going">${ev.joined ? 'Anulează participarea' : 'Vin'}</button>`,
      onMount(modal, close) {
        modal.querySelector('#ev-going').addEventListener('click', () => {
          if (!ev.joined) { ev.joined = true; ev.going++; ctx.toast({ title: 'Participare confirmată', body: ev.title, icon: 'check' }); }
          else { ev.joined = false; ev.going--; }
          close();
        });
      },
    });
  }

  function openTask(t, ctx) {
    const st = U.taskStatus(t.status);
    OSUBB.modal({
      title: t.title,
      body: `
        <div class="row gap-2 wrap mb-4">
          <span class="tag ${U.deptTag(t.dept)}">${U.dept(t.dept).name}</span>
          <span class="badge ${st.cls}">${st.label}</span>
          ${U.pointsBadge(t.points)}
        </div>
        <p class="t-muted mb-4">${t.desc}</p>
        <div class="grid grid-2 gap-3">
          <div><div class="stat-label">Deadline</div><div class="t-semi">${U.fmtDate(t.deadline)} (${U.relDay(t.deadline)})</div></div>
          <div><div class="stat-label">Punctaj</div><div class="t-semi">${U.stars(t.difficulty)} × rating ${t.rating} (×${U.ratingMult(t.rating) < 0 ? '−1' : U.ratingMult(t.rating)})</div></div>
          <div class="span-2"><div class="stat-label">Responsabili</div>
            <div class="row gap-2 wrap mt-1">${t.assignees.map(n => `<span class="chip">${U.avatar(n, '#3A3A3D', 'avatar-sm')} ${n}</span>`).join('')}</div></div>
        </div>`,
      foot: `<button class="btn btn-ghost" data-close>Închide</button>
             <button class="btn btn-outline" data-close>${OSUBB.icon('sparkle', 16)} Cere puncte</button>
             <button class="btn btn-primary" data-close>Marchează finalizat</button>`,
    });
  }

  OSUBB.openEvent = openEvent;
  OSUBB.openTask = openTask;
})();
