/* Apply the theme before first paint, so dark-mode users never see a white
   flash. Loaded as a blocking classic script from <head> in index.html: it
   lives in its own file because the Content-Security-Policy allows scripts
   from 'self' only, never inline (#770). The key is THEME_STORAGE_KEY in
   src/lib/theme.ts; until a member picks a theme we follow the OS. */
(function () {
  try {
    var saved = localStorage.getItem('osubb-theme');
    var dark = saved
      ? saved === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  } catch {
    /* private mode, storage disabled — light theme is a fine fallback */
  }
})();
