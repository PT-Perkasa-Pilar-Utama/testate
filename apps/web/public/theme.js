/*
 * The stored theme, applied before the bundle paints, or the page flashes the other one.
 *
 * A file rather than an inline script on purpose: the API serves the SPA under
 * `script-src 'self'` (07 §7.5), so an inline script works in the dev server and is silently
 * refused in production, which is the worst of both.
 *
 * No stored choice leaves the attribute off, which is what lets the stylesheet's media query
 * answer the system preference.
 */
try {
  var mode = localStorage.getItem("testate-theme");
  if (mode === "light" || mode === "dark") document.documentElement.dataset.mode = mode;
} catch {
  /* A browser with storage blocked still gets the system preference. */
}
