/* ============================================================================
   Icon set (Lucide-style, stroke = currentColor). Use: OSUBB.icon('home')
   ========================================================================== */
(function () {
  const P = {
    home:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    task:      '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    calendar:  '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z"/><path d="M18 8a4 4 0 0 1 0 8"/>',
    users:     '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 5.2a3.2 3.2 0 0 1 0 6"/><path d="M18.5 20a6 6 0 0 0-3-5.2"/>',
    userplus:  '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 12 0"/><path d="M19 8v6M16 11h6"/>',
    user:      '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    shield:    '<path d="M12 2.5 20 6v5c0 5-3.5 8.5-8 10.5C7.5 19.5 4 16 4 11V6Z"/><path d="m9 12 2 2 4-4"/>',
    bell:      '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
    search:    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    chevron:   '<path d="m9 6 6 6-6 6"/>',
    chevronDown:'<path d="m6 9 6 6 6-6"/>',
    menu:      '<path d="M3 6h18M3 12h18M3 18h18"/>',
    close:     '<path d="M6 6l12 12M18 6 6 18"/>',
    clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    alert:     '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5M12 17.5v.01"/>',
    sparkle:   '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"/>',
    check:     '<path d="M4 12.5 9 17.5 20 6.5"/>',
    checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    qr:        '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7v-3"/>',
    trophy:    '<path d="M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/><path d="M9 20h6M12 13v4"/>',
    flag:      '<path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/>',
    mail:      '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    phone:     '<path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V18a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    filter:    '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>',
    sort:      '<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>',
    download:  '<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>',
    dots:      '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    logout:    '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 12h10M16 8l4 4-4 4"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.3-1.3L13.8 2h-3.6l-.3 2.5A7 7 0 0 0 7.6 5.8l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.3 1.3l.3 2.5h3.6l.3-2.5a7 7 0 0 0 2.3-1.3l2.3 1 2-3.4-2-1.5A7 7 0 0 0 19 12Z"/>',
    grid:      '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    list:      '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    arrowUp:   '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowRight:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    pin:       '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/><path d="M12 14v7"/>',
    star:      '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9Z"/>',
    edit:      '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m14 6 4 4"/>',
    eye:       '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    target:    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    layers:    '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    refresh:   '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4"/>',
    moon:      '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  };
  OSUBB.icon = function (name, size) {
    const body = P[name] || P.grid;
    const s = size || 24;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  };
})();
