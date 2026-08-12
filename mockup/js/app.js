/* ============================================================================
   App bootstrap: login, topbar, role switcher, notifications, modal + toast
   NOTE: prototype renders only controlled OSUBB.data via template strings —
   no external/user input, so innerHTML is safe here.
   ========================================================================== */
(function () {
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- Theme (light / dark) ---------- */
  OSUBB.getTheme = function () { try { return localStorage.getItem('osubb-theme') || 'light'; } catch (e) { return 'light'; } };
  OSUBB.applyTheme = function (t) {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('osubb-theme', t); } catch (e) {}
  };
  OSUBB.toggleTheme = function () { const n = OSUBB.getTheme() === 'dark' ? 'light' : 'dark'; OSUBB.applyTheme(n); return n; };

  /* ---------- Modal ---------- */
  OSUBB.modal = function (opts) {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-scrim';
    wrap.innerHTML = `
      <div class="modal ${opts.size || ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${opts.title || ''}</h3>
          <button class="icon-btn" data-close aria-label="Închide">${OSUBB.icon('close', 20)}</button>
        </div>
        <div class="modal-body">${typeof opts.body === 'function' ? opts.body() : (opts.body || '')}</div>
        ${opts.foot ? `<div class="modal-foot">${opts.foot}</div>` : ''}
      </div>`;
    root.appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close();
    });
    if (opts.onMount) opts.onMount(wrap.querySelector('.modal'), close);
    return close;
  };

  /* ---------- Toast / critical pop-up ---------- */
  OSUBB.toast = function (opts) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + (opts.critical ? 'critical' : '');
    el.innerHTML = `
      <span class="toast-ic">${OSUBB.icon(opts.icon || (opts.critical ? 'alert' : 'check'), 20)}</span>
      <div class="grow">
        <div class="t-bold">${opts.title || ''}</div>
        ${opts.body ? `<div class="t-sm" style="opacity:.85">${opts.body}</div>` : ''}
      </div>
      <button class="icon-btn" data-close style="color:inherit;width:28px;height:28px">${OSUBB.icon('close', 16)}</button>`;
    root.appendChild(el);
    const close = () => { el.style.opacity = 0; setTimeout(() => el.remove(), 180); };
    el.querySelector('[data-close]').addEventListener('click', close);
    if (opts.timeout !== 0) setTimeout(close, opts.timeout || 5200);
    return close;
  };

  /* ---------- Notifications dropdown ---------- */
  function notiIconClass(t) { return t.critical ? 'crit' : ''; }
  function renderNotiDropdown() {
    const items = OSUBB.visibleNotifications(OSUBB.state.role);
    const unread = items.filter(n => !n.read).length;
    return `
      <div class="dropdown" id="noti-dd">
        <div class="dropdown-head">
          <h4>Notificări ${unread ? `<span class="badge badge--red">${unread} noi</span>` : ''}</h4>
          <button class="card-link" data-go="notifications" data-close-dd>Vezi toate</button>
        </div>
        <div class="dropdown-body">
          ${items.map(n => `
            <div class="noti ${n.read ? '' : 'unread'}" data-go="notifications" data-close-dd>
              <div class="noti-ic ${notiIconClass(n)}">${OSUBB.icon(n.icon, 18)}</div>
              <div class="grow">
                <div class="t-semi t-sm">${n.title}</div>
                <div class="t-xs t-muted">${n.body}</div>
                <div class="t-xs t-faint mt-1">${n.time}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }
  function toggleNoti() {
    const host = $('#noti-host');
    if ($('#noti-dd')) { host.innerHTML = ''; return; }
    host.innerHTML = renderNotiDropdown();
    $('#bell-ind') && $('#bell-ind').classList.remove('hide');
  }

  /* ---------- Global wiring ---------- */
  function enterApp() {
    $('#login').classList.add('hide');
    $('#app').classList.remove('hide');
    $('#role-select').value = OSUBB.state.role;
    OSUBB.router.go('dashboard');
    // critical pop-up demo (priorities doc: critical info as red pop-up)
    setTimeout(() => OSUBB.toast({
      critical: true, icon: 'alert',
      title: 'Anunț critic: Modificare ROF',
      body: 'Capitolul 4 a fost actualizat — citește înainte de AGO.',
      timeout: 7000,
    }), 900);
  }

  function roleOptions() {
    return OSUBB.data.roles.map(r =>
      `<option value="${r.id}" ${r.id === OSUBB.state.role ? 'selected' : ''}>${r.name}</option>`).join('');
  }
  function buildRoleSwitcher() {
    const sel = $('#role-select');
    sel.innerHTML = roleOptions();
    sel.addEventListener('change', () => {
      OSUBB.state.setRole(sel.value);
      OSUBB.router.go(OSUBB.router.current || 'dashboard');
    });
    const ls = $('#login-role');
    if (ls) ls.innerHTML = roleOptions();
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildRoleSwitcher();

    // Login
    $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); enterApp(); });
    $('#login-role') && $('#login-role').addEventListener('change', (e) => OSUBB.state.setRole(e.target.value));
    $('#google-btn') && $('#google-btn').addEventListener('click', enterApp);

    // Bell
    $('#bell-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleNoti(); });

    // Mobile menu
    $('#menu-btn').addEventListener('click', () => {
      const sb = $('.sidebar'); sb.classList.add('open');
      const sc = document.createElement('div'); sc.className = 'scrim'; sc.id = 'nav-scrim';
      document.body.appendChild(sc);
      sc.addEventListener('click', () => { sb.classList.remove('open'); sc.remove(); });
    });

    // Global click delegation
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) {
        const id = go.getAttribute('data-go');
        if (go.hasAttribute('data-close-dd')) $('#noti-host').innerHTML = '';
        OSUBB.router.go(id);
        return;
      }
      // close noti dropdown on outside click
      if ($('#noti-dd') && !e.target.closest('#noti-host') && !e.target.closest('#bell-btn')) {
        $('#noti-host').innerHTML = '';
      }
    });

    // Re-render nav when role changes
    OSUBB.state.on(() => OSUBB.router.renderNav());
  });
})();
