/* ============================================================================
   Router + view registry  (globals: OSUBB.registerView, OSUBB.router)
   ----------------------------------------------------------------------------
   A view registers itself:
     OSUBB.registerView('dashboard', {
       label:'Acasă', icon:'home', title:'Panou principal',
       count(ctx){ return 0 },            // optional nav badge
       render(ctx){ return '<div class="page">...</div>' },
       mount(root, ctx){ }                // optional, wire events after render
     });
   ctx = { state, data, util, icon, role, user, navigate, modal, toast, confirmGoing }
   ========================================================================== */
(function () {
  OSUBB.views = {};
  OSUBB.registerView = function (id, def) { OSUBB.views[id] = Object.assign({ id }, def); };

  const SIDEBAR_ORDER = ['dashboard', 'tasktracker', 'calendar', 'announcements', 'volunteers', 'profile', 'bcpanel'];
  const TABBAR_ORDER  = ['dashboard', 'calendar', 'tasktracker', 'announcements', 'profile'];

  OSUBB.router = {
    current: null,

    ctx() {
      const r = this;
      return {
        state: OSUBB.state, data: OSUBB.data, util: OSUBB.util, icon: OSUBB.icon,
        role: OSUBB.state.role, user: OSUBB.state.current(),
        navigate: (id) => r.go(id),
        modal: (opts) => OSUBB.modal(opts),
        toast: (opts) => OSUBB.toast(opts),
      };
    },

    go(id) {
      if (!OSUBB.views[id]) id = 'dashboard';
      if (!OSUBB.canAccess(id, OSUBB.state.role)) id = 'dashboard';
      this.current = id;
      const ctx = this.ctx();
      const view = OSUBB.views[id];
      const root = document.getElementById('view');
      root.innerHTML = view.render(ctx);
      root.scrollTop = 0;
      document.querySelector('.main').scrollTop = 0;
      if (view.mount) view.mount(root, ctx);
      document.getElementById('topbar-title').textContent = view.title || view.label || '';
      this.renderNav();
      // close mobile sidebar
      document.querySelector('.sidebar').classList.remove('open');
      const scrim = document.getElementById('nav-scrim'); if (scrim) scrim.remove();
    },

    renderNav() {
      const ctx = this.ctx();
      const role = OSUBB.state.role;

      // Sidebar
      const nav = document.querySelector('.nav');
      nav.innerHTML = SIDEBAR_ORDER
        .filter(id => OSUBB.views[id] && OSUBB.canAccess(id, role))
        .map(id => {
          const v = OSUBB.views[id];
          const n = v.count ? v.count(ctx) : 0;
          return `<div class="nav-item ${id === this.current ? 'is-active' : ''}" data-go="${id}">
              ${OSUBB.icon(v.icon, 20)}<span>${v.label}</span>
              ${n ? `<span class="nav-count">${n}</span>` : ''}
            </div>`;
        }).join('');

      // Mobile tab bar
      const tabbar = document.querySelector('.tabbar');
      if (tabbar) {
        tabbar.innerHTML = TABBAR_ORDER
          .filter(id => OSUBB.views[id] && OSUBB.canAccess(id, role))
          .map(id => {
            const v = OSUBB.views[id];
            const n = v.count ? v.count(ctx) : 0;
            return `<a class="tab-link ${id === this.current ? 'is-active' : ''}" data-go="${id}">
                ${n ? '<span class="tab-ind"></span>' : ''}${OSUBB.icon(v.icon, 22)}<span>${v.label}</span>
              </a>`;
          }).join('');
      }

      // Sidebar user card
      const u = OSUBB.state.current();
      const foot = document.getElementById('sidebar-user');
      if (foot) {
        foot.innerHTML = `
          ${OSUBB.util.avatar(u.name, u.avatarColor)}
          <div class="grow" style="min-width:0">
            <div class="t-bold truncate">${u.name}</div>
            <div class="t-xs t-muted truncate">${OSUBB.util.role(u.role)}</div>
          </div>
          ${OSUBB.icon('settings', 18)}`;
      }
    },
  };
})();
