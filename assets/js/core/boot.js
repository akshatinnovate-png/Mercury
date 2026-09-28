/* ================================================================
   MERCURY — boot sequence
   A deliberate, readable preload: the interpreter "waking up".
   Resolves once the curtain is off so the acts can start clean.
   ================================================================ */
import { clamp } from './gfx.js';

const LOG = [
  'Initialising interpreter…',
  'Loading landmark topology — 21 nodes, 20 bones',
  'Mounting handshape grammar — 26 letters',
  'Calibrating temporal window — 16 frames',
  'Warming the voice…',
  'Ready.'
];

export function boot() {
  const el   = document.getElementById('boot');
  const fill = document.getElementById('bootFill');
  const pct  = document.getElementById('bootPct');
  const log  = document.getElementById('bootLog');
  document.body.classList.add('is-booting');

  return new Promise(resolve => {
    let p = 0, i = 0, t0 = performance.now();

    const step = () => {
      const elapsed = (performance.now() - t0) / 1000;
      // ease toward 100 but never quite arrive until the log is done
      const target = Math.min(100, elapsed * 62);
      p = clamp(p + (target - p) * 0.14, 0, 100);

      const idx = Math.min(LOG.length - 1, Math.floor(p / (100 / LOG.length)));
      if (idx !== i) { i = idx; log.textContent = LOG[i]; }

      fill.style.width = p + '%';
      pct.textContent = String(Math.round(p)).padStart(2, '0') + '%';

      if (p > 99.4) return done();
      requestAnimationFrame(step);
    };

    const done = () => {
      fill.style.width = '100%';
      pct.textContent = '100%';
      log.textContent = LOG[LOG.length - 1];
      el.classList.add('is-done');
      // curtain: fade, then hand control to the page
      setTimeout(() => {
        el.style.opacity = '0';
        document.body.classList.remove('is-booting');
        setTimeout(() => { el.remove(); resolve(); }, 620);
      }, 320);
    };

    requestAnimationFrame(step);
  });
}
