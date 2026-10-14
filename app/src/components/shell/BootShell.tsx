/**
 * The shell `index.html` draws before the app's code runs, drawn again by
 * React while the stored session is read: the same markup, styled by
 * `public/splash.css`, so the hand-over does not flicker and a slow start is
 * never a blank page. Its classes must match `index.html` (BootShell.test).
 */
export function BootShell() {
  return (
    <div className="boot-shell" role="status" aria-label="Se încarcă aplicația">
      <img
        className="boot-logo"
        src="/favicon.svg"
        alt=""
        width={48}
        height={48}
      />
      <span className="boot-bar" />
      <span className="boot-bar" />
      <span className="boot-bar" />
    </div>
  );
}
