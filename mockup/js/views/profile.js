/* ============================================================================
   View: Profilul meu — profil personal + gamification (§2.2 + plan managerial §8)
   Role-adaptive prin ctx.user: tier, punctaj, clasament, Cupa departamentelor,
   echipe, departamente, setări & integrări calendar.
   ========================================================================== */
(function () {
  const U = OSUBB.util, D = OSUBB.data, I = OSUBB.icon;

  // short, friendly benefit list per tier (managerial vision — gamification)
  const TIER_BENEFITS = {
    'Recrut':                ['Acces la departamentul tău și la echipele pentru recruți', 'Acces la toate call-urile de voluntari', 'Devii Voluntar automat după 6 luni'],
    'Voluntar':              ['Îți poți schimba departamentul principal', 'Poți adăuga departamente secundare', 'Acces la proiectele departamentului'],
    'Membru Activ':          ['Ești în top 35% al voluntarilor', 'Acces la „Formularul de aderare” pentru AG', 'Acces la evenimente exclusive OSUBB'],
    'Drept de vot':          ['Drept de vot în Adunarea Generală', 'Poți propune puncte pe ordinea de zi', 'Acces la documentele interne (ROF, PV-uri)'],
    'Responsabil de proiect':['Creezi call-uri de voluntari', 'Creezi evenimente și taskuri pentru echipă', 'Numit de Biroul de Conducere'],
    'BCE':                   ['Coordonezi un departament / echipa IT', 'Acorzi puncte și creezi taskuri/evenimente', 'Poți crea echipe'],
    'BC':                    ['Acces complet la panoul de administrare', 'Vezi toate „Fișele Voluntarului”', 'Decizii la nivel de organizație'],
    'Moderator':             ['Acces complet la întreaga aplicație', 'Poți modifica orice', 'Cont unic de administrare'],
  };

  function tier(user) {
    const span = Math.max(1, user.tierMax - user.tierMin);
    const pct = Math.max(6, Math.min(100, Math.round((user.points - user.tierMin) / span * 100)));
    const toNext = Math.max(0, user.tierMax - user.points);
    const top = user.nextTier === '—';
    return { pct, toNext, top };
  }

  function rankMsg(user) {
    if (user.rank === 1) return 'Ești pe primul loc 🏆';
    if (user.nextRankPts > 0) return `Ești la ${U.pts(user.nextRankPts)}p de locul ${user.rank - 1}`;
    return `La un pas de locul ${user.rank - 1}`;
  }

  function deptCupRow(d, user) {
    const max = Math.max.apply(null, D.deptCup.map(x => x.points));
    const i = D.deptCup.indexOf(d);
    const dept = U.dept(d.dept);
    const mine = user.depts.includes(d.dept);
    const w = Math.round(d.points / max * 100);
    const tColor = d.trend > 0 ? 'var(--success)' : d.trend < 0 ? 'var(--red)' : 'var(--ink-400)';
    const arrow = d.trend !== 0
      ? `<span style="display:inline-flex;transform:rotate(${d.trend < 0 ? 180 : 0}deg)">${I('arrowUp', 13)}</span>` : '';
    const tTxt = d.trend > 0 ? `+${d.trend}` : d.trend < 0 ? `${d.trend}` : '0';
    return `
      <div class="list-row" style="${mine ? 'background:var(--red-050);border-radius:var(--r-sm)' : ''}">
        <div class="t-extra t-num" style="width:20px;color:${i < 3 ? 'var(--red)' : 'var(--ink-400)'}">${i + 1}</div>
        <div style="width:58px"><span class="tag ${U.deptTag(d.dept)}">${dept.short}</span></div>
        <div class="grow" style="min-width:0">
          <div class="row between mb-1 gap-2">
            <span class="t-sm t-semi truncate">${dept.name}${mine ? ' <span class="badge badge--red">tu</span>' : ''}</span>
            <span class="t-xs t-faint">${d.members} membri</span>
          </div>
          <div class="progress thin"><div class="progress-bar" style="width:${w}%;background:${dept.color}"></div></div>
        </div>
        <div class="td-num" style="width:56px">${U.pts(d.points)}</div>
        <div class="t-sm t-semi t-num" style="width:46px;display:inline-flex;align-items:center;justify-content:flex-end;gap:2px;color:${tColor}">${arrow}${tTxt}</div>
      </div>`;
  }

  function lbRow(p, you) {
    return `
      <tr class="${you ? 'is-selected' : ''}">
        <td class="t-extra t-num" style="width:42px;color:${p.rank <= 3 ? 'var(--red)' : 'var(--ink-400)'}">${p.rank}</td>
        <td>
          <div class="row gap-2">
            ${U.avatar(p.name, U.dept(p.dept).color, 'avatar-sm')}
            <span class="t-semi truncate">${p.name}</span>
            ${you ? '<span class="badge badge--red">tu</span>' : ''}
          </div>
        </td>
        <td><span class="tag tag--soft ${U.deptTag(p.dept)}">${U.dept(p.dept).short}</span></td>
        <td class="td-num">${U.pts(p.points)}</td>
      </tr>`;
  }

  function switchRow(id, kind, title, sub, checked) {
    return `
      <div class="row between gap-3" style="padding:var(--s-2) 0">
        <div class="grow" style="min-width:0">
          <div class="t-semi t-sm">${title}</div>
          <div class="t-xs t-muted">${sub}</div>
        </div>
        <label class="switch">
          <input type="checkbox" data-setting="${id}" data-kind="${kind}" data-label="${title}" ${checked ? 'checked' : ''}>
          <span class="track"></span>
        </label>
      </div>`;
  }

  OSUBB.registerView('profile', {
    label: 'Profil', icon: 'user', title: 'Profilul meu',

    render(ctx) {
      const user = ctx.user;
      const role = ctx.role;
      const vol = D.volunteers.find(v => v.name === user.name) || {};
      const t = tier(user);
      const benefits = TIER_BENEFITS[user.tier] || TIER_BENEFITS['Voluntar'];
      const inLb = D.leaderboard.some(p => p.name === user.name || p.you);

      const lbRows = D.leaderboard
        .map(p => lbRow(p, p.name === user.name || !!p.you))
        .join('') + (inLb ? '' : `
          <tr><td colspan="4" class="t-center t-faint" style="padding:6px">···</td></tr>
          ${lbRow({ rank: user.rank, name: user.name, dept: user.depts[0], points: user.points }, true)}`);

      return `
        <div class="page">
          <div class="page-head">
            <div>
              <h1 class="page-title">Profilul meu</h1>
              <p class="page-sub">Nivelul tău, punctajul și setările contului OSUBB.</p>
            </div>
            <div class="row gap-2 wrap">
              <button class="btn btn-outline" id="theme-toggle">${I(OSUBB.getTheme() === 'dark' ? 'sun' : 'moon', 16)} ${OSUBB.getTheme() === 'dark' ? 'Temă luminoasă' : 'Temă întunecată'}</button>
              <button class="btn btn-outline" id="edit-profile">${I('edit', 16)} Editează profil</button>
            </div>
          </div>

          <!-- Header card -->
          <div class="card card-pad">
            <div class="row-top gap-5 wrap">
              ${U.avatar(user.name, user.avatarColor, 'avatar-xl')}
              <div class="grow" style="min-width:260px">
                <div class="row gap-3 wrap">
                  <h2 style="font-size:var(--fs-xl)">${user.name}</h2>
                  <span class="role-badge"><span class="dot"></span>${U.role(user.role)}</span>
                </div>
                <div class="row gap-2 wrap mt-2">
                  ${user.depts.map(id => `<span class="tag ${U.deptTag(id)}">${U.dept(id).short}</span>`).join('')}
                  ${vol.email ? `<span class="chip">${I('mail', 14)} ${vol.email}</span>` : ''}
                  <span class="badge badge--soft">${I('clock', 12)} Membru din ${vol.joined || '2025'}</span>
                </div>

                <div class="mt-4" style="max-width:560px">
                  <div class="row between mb-2 gap-2">
                    <span class="t-sm t-semi">${user.tier}${t.top ? '' : ` <span class="t-faint">→ ${user.nextTier}</span>`}</span>
                    <span class="t-sm t-muted t-num">${U.pts(user.points)} / ${U.pts(user.tierMax)} p</span>
                  </div>
                  <div class="progress"><div class="progress-bar" style="width:${t.pct}%"></div></div>
                  <div class="t-xs t-muted mt-2">
                    ${user.promo && user.promo.note ? user.promo.note
                      : (t.top ? 'Nivel maxim atins 🔥 — ești în vârful organizației.'
                               : `Mai ai <b class="t-red">${U.pts(t.toNext)}p</b> până la „${user.nextTier}”.`)}
                  </div>
                </div>
              </div>
              <div class="ring" style="--pct:${t.pct}"><span>${t.pct}%</span></div>
            </div>

            ${role === 'activ' ? `
              <div class="alert alert--info mt-5" style="align-items:center">
                <span class="alert-ic">${I('flag', 20)}</span>
                <div class="grow">
                  <div class="t-semi">Ești aproape de „Drept de vot”</div>
                  <div class="t-sm">Completează formularul de aderare ca să devii membru cu drepturi depline în Adunarea Generală.</div>
                </div>
                <button class="btn btn-primary btn-sm" id="join-form">Completează formularul de aderare</button>
              </div>` : ''}
            ${role === 'vot' ? `
              <div class="alert alert--info mt-5">
                <span class="alert-ic">${I('shield', 20)}</span>
                <div class="grow">
                  <div class="t-semi">Membru cu drept de vot</div>
                  <div class="t-sm">La fiecare Adunare Generală rămân doar voluntarii din <b>top 25%</b> după puncte. La prima ta AG punctele nu se iau în calcul — doar de aici înainte.</div>
                </div>
              </div>` : ''}
          </div>

          <!-- Body grid -->
          <div class="grid grid-main mt-5">
            <div class="col gap-5">

              <div class="grid grid-2">
                <div class="card stat">
                  <div class="row between"><span class="stat-label">Punctaj total</span>
                    <span class="stat-icon">${I('sparkle', 20)}</span></div>
                  <div class="stat-value t-num">${U.pts(user.points)}</div>
                  <div class="stat-trend up">${I('arrowUp', 14)} +25 această săptămână</div>
                </div>
                <div class="card stat">
                  <div class="row between"><span class="stat-label">Loc în clasament</span>
                    <span class="stat-icon">${I('trophy', 20)}</span></div>
                  <div class="stat-value t-num">#${user.rank}<span class="t-faint" style="font-size:var(--fs-md)"> / ${user.totalMembers}</span></div>
                  <div class="stat-trend ${user.rank > 1 ? 'up' : ''}">${user.rank > 1 ? I('arrowUp', 14) + ' ' : ''}${rankMsg(user)}</div>
                </div>
              </div>

              <!-- Cupa departamentelor -->
              <div class="card">
                <div class="card-head">
                  <span class="card-title">${I('trophy', 18)} Cupa departamentelor</span>
                  <span class="badge badge--soft">sezon 2025–2026</span>
                </div>
                <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
                  <div class="list">${D.deptCup.map(d => deptCupRow(d, user)).join('')}</div>
                </div>
              </div>

              <!-- Clasament general -->
              <div class="card">
                <div class="card-head">
                  <span class="card-title">${I('users', 18)} Clasament general</span>
                  <button class="card-link" data-go="dashboard">Panou</button>
                </div>
                <div class="card-body" style="padding:0">
                  <div class="table-wrap">
                    <table class="table">
                      <thead><tr><th>#</th><th>Voluntar</th><th>Dept.</th><th class="t-right">Puncte</th></tr></thead>
                      <tbody>${lbRows}</tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right column -->
            <div class="col gap-5">

              <!-- Beneficii nivel -->
              <div class="card">
                <div class="card-head"><span class="card-title">${I('shield', 18)} Beneficii nivel</span>
                  <span class="badge badge--grey">${user.tier}</span></div>
                <div class="card-body">
                  <div class="col gap-3">
                    ${benefits.map(b => `
                      <div class="row gap-2">
                        <span style="color:var(--success);flex:none;display:inline-flex">${I('checkCircle', 18)}</span>
                        <span class="t-sm">${b}</span>
                      </div>`).join('')}
                  </div>
                  ${t.top ? '' : `
                    <div class="alert alert--info mt-4">
                      <span class="alert-ic">${I('sparkle', 18)}</span>
                      <div class="t-sm">Mai ai ${U.pts(t.toNext)}p până la „${user.nextTier}” — deblochezi beneficii noi.</div>
                    </div>`}
                </div>
              </div>

              <!-- Echipele mele -->
              <div class="card">
                <div class="card-head"><span class="card-title">${I('users', 18)} Echipele mele</span>
                  <span class="badge badge--soft">${user.teams.length}</span></div>
                <div class="card-body" style="padding-top:var(--s-2);padding-bottom:var(--s-3)">
                  ${user.teams.length ? `<div class="list">${user.teams.map(id => {
                    const tm = D.teams.find(x => x.id === id); if (!tm) return '';
                    const dc = U.dept(tm.dept);
                    return `
                      <div class="list-row">
                        <div class="list-lead" style="background:${dc.color}1a;color:${dc.color}">${I('users', 18)}</div>
                        <div class="list-main">
                          <div class="t-semi t-sm truncate">${tm.name}</div>
                          <div class="list-meta">
                            <span class="tag tag--soft ${U.deptTag(tm.dept)}">${dc.short}</span>
                            <span class="t-faint">Lider: ${tm.lead}</span>
                          </div>
                        </div>
                        <span class="badge badge--grey">${tm.memberIds.length}</span>
                      </div>`;
                  }).join('')}</div>`
                    : `<div class="empty"><div class="empty-ic">${I('users', 24)}</div>Nu faci parte din nicio echipă încă.</div>`}
                </div>
              </div>

              <!-- Departamentele mele -->
              <div class="card">
                <div class="card-head"><span class="card-title">${I('layers', 18)} Departamentele mele</span></div>
                <div class="card-body">
                  <div class="col gap-3">
                    ${user.depts.map(id => {
                      const dept = U.dept(id);
                      const cup = D.deptCup.find(c => c.dept === id);
                      const cupRank = cup ? D.deptCup.indexOf(cup) + 1 : '—';
                      return `
                        <div class="row between gap-2">
                          <div class="row gap-2" style="min-width:0">
                            <span class="tag ${U.deptTag(id)}">${dept.short}</span>
                            <span class="t-semi t-sm truncate">${dept.name}</span>
                          </div>
                          <span class="t-xs t-muted t-num">${cup ? `${U.pts(cup.points)}p · #${cupRank} în Cupă` : ''}</span>
                        </div>`;
                    }).join('')}
                  </div>
                </div>
              </div>

              <!-- Setări & integrări -->
              <div class="card">
                <div class="card-head"><span class="card-title">${I('settings', 18)} Setări & integrări</span></div>
                <div class="card-body" style="padding-top:var(--s-3)">
                  <div class="t-xs t-up t-faint mb-2">Integrări calendar</div>
                  ${switchRow('gcal', 'integration', 'Conectează Google Calendar', 'Sincronizează automat evenimentele OSUBB.', false)}
                  ${switchRow('outlook', 'integration', 'Outlook Calendar', 'Sincronizare bidirecțională a ședințelor.', false)}
                  <div class="divider"></div>
                  <div class="t-xs t-up t-faint mb-2">Notificări</div>
                  ${switchRow('n-crit', 'noti', 'Anunțuri critice', 'Pop-up roșu pentru anunțuri urgente.', true)}
                  ${switchRow('n-task', 'noti', 'Remindere taskuri', 'Cu 24h înainte de fiecare deadline.', true)}
                  ${switchRow('n-event', 'noti', 'Evenimente & ședințe', 'Reminder înainte de ședințe și evenimente.', true)}
                  ${switchRow('n-points', 'noti', 'Puncte & clasament', 'Când primești puncte sau urci în clasament.', false)}
                </div>
                ${role === 'vot' ? `
                  <div class="card-foot row between gap-3">
                    <span class="t-xs t-muted">Membru cu drept de vot în AG</span>
                    <button class="btn btn-danger btn-sm" id="resign-ag">${I('logout', 14)} Demisie AG</button>
                  </div>` : ''}
              </div>
            </div>
          </div>
        </div>`;
    },

    mount(root, ctx) {
      const user = ctx.user;
      const vol = D.volunteers.find(v => v.name === user.name) || {};

      // Theme toggle (light / dark)
      const tt = root.querySelector('#theme-toggle');
      if (tt) tt.addEventListener('click', () => {
        const t = OSUBB.toggleTheme();
        ctx.toast({ icon: t === 'dark' ? 'moon' : 'sun', title: t === 'dark' ? 'Temă întunecată activată' : 'Temă luminoasă activată' });
        ctx.navigate('profile');
      });

      // Settings switches -> toast
      root.querySelectorAll('[data-setting]').forEach(inp => {
        inp.addEventListener('change', () => {
          const label = inp.getAttribute('data-label');
          const on = inp.checked;
          if (inp.getAttribute('data-kind') === 'integration') {
            ctx.toast({
              icon: 'calendar',
              title: on ? `${label.replace('Conectează ', '')} conectat` : `${label.replace('Conectează ', '')} deconectat`,
              body: on ? 'Evenimentele OSUBB se vor sincroniza automat.' : 'Sincronizarea a fost oprită.',
            });
          } else {
            ctx.toast({ icon: on ? 'check' : 'bell', title: on ? `Activat: ${label}` : `Dezactivat: ${label}` });
          }
        });
      });

      // Edit profile
      const edit = root.querySelector('#edit-profile');
      if (edit) edit.addEventListener('click', () => {
        ctx.modal({
          title: 'Editează profilul',
          body: `
            <div class="field"><label class="label">Nume complet</label>
              <input class="input" value="${user.name}"></div>
            <div class="grid grid-2 gap-3">
              <div class="field"><label class="label">Email</label>
                <input class="input" value="${vol.email || ''}"></div>
              <div class="field"><label class="label">Telefon</label>
                <input class="input" value="${vol.phone || ''}"></div>
            </div>
            <div class="field"><label class="label">Despre mine</label>
              <textarea class="textarea" placeholder="Spune-le colegilor câteva cuvinte despre tine..."></textarea></div>`,
          foot: `<button class="btn btn-ghost" data-close>Anulează</button>
                 <button class="btn btn-primary" id="save-profile">Salvează</button>`,
          onMount(m, close) {
            m.querySelector('#save-profile').addEventListener('click', () => {
              ctx.toast({ icon: 'check', title: 'Profil actualizat', body: 'Modificările au fost salvate.' });
              close();
            });
          },
        });
      });

      // 'activ' -> formular de aderare
      const join = root.querySelector('#join-form');
      if (join) join.addEventListener('click', () => {
        ctx.modal({
          title: 'Formular de aderare — drept de vot',
          size: 'lg',
          body: `
            <p class="t-muted mb-4">Devii membru cu drept de vot în Adunarea Generală. Cererea este analizată de Biroul Coordonator.</p>
            <div class="grid grid-2 gap-3">
              <div class="field"><label class="label">Nume</label><input class="input" value="${user.name}"></div>
              <div class="field"><label class="label">Email</label><input class="input" value="${vol.email || ''}"></div>
            </div>
            <div class="field"><label class="label">Departament principal</label>
              <select class="select">${user.depts.map(id => `<option>${U.dept(id).name}</option>`).join('')}</select></div>
            <div class="field"><label class="label">De ce vrei drept de vot?</label>
              <textarea class="textarea" placeholder="Motivația ta..."></textarea></div>
            <label class="checkbox"><input type="checkbox" checked> Am citit și sunt de acord cu ROF-ul OSUBB.</label>`,
          foot: `<button class="btn btn-ghost" data-close>Anulează</button>
                 <button class="btn btn-primary" id="submit-join">Trimite formularul</button>`,
          onMount(m, close) {
            m.querySelector('#submit-join').addEventListener('click', () => {
              ctx.toast({ icon: 'check', title: 'Formular trimis', body: 'Cererea ta de aderare a fost înregistrată. Vei fi notificat de BC.' });
              close();
            });
          },
        });
      });

      // 'vot' -> demisie AG (confirm)
      const resign = root.querySelector('#resign-ag');
      if (resign) resign.addEventListener('click', () => {
        ctx.modal({
          title: 'Demisie din Adunarea Generală',
          body: `
            <p class="t-muted mb-4">Ești sigur că vrei să-ți retragi calitatea de membru cu drept de vot? Vei pierde dreptul de vot în AGO și accesul la documentele interne.</p>
            <div class="alert alert--warning">
              <span class="alert-ic">${I('alert', 18)}</span>
              <div class="t-sm">Această acțiune trebuie aprobată de Biroul Coordonator înainte de a deveni definitivă.</div>
            </div>`,
          foot: `<button class="btn btn-ghost" data-close>Renunță</button>
                 <button class="btn btn-danger" id="confirm-resign">Trimite demisia</button>`,
          onMount(m, close) {
            m.querySelector('#confirm-resign').addEventListener('click', () => {
              ctx.toast({ critical: true, icon: 'alert', title: 'Cerere de demisie trimisă', body: 'Biroul Coordonator a fost notificat.' });
              close();
            });
          },
        });
      });
    },
  });
})();
