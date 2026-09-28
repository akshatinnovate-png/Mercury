/* ================================================================
   MERCURY — cursor
   A ring that carries scroll progress, swaps to a verb over any
   element declaring data-cursor, and is simply absent on touch.
   ================================================================ */
import { onTick, lerp } from './gfx.js';

const DASH = 132; // circumference of r=21

export function cursor() {
  if (matchMedia('(hover:none)').matches) return;

  const el    = document.getElementById('cursor');
  const prog  = document.getElementById('cursorProg');
  const label = document.getElementById('cursorLabel');

  let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, live = false;

  addEventListener('pointermove', e => {
    tx = e.clientX; ty = e.clientY;
    if (!live) { live = true; x = tx; y = ty; el.classList.add('is-live'); }
  }, { passive: true });

  addEventListener('pointerdown', () => el.classList.add('is-hot'));
  addEventListener('pointerup',   () => { if (!hot) el.classList.remove('is-hot'); });

  let hot = false;
  const HOT = 'a,button,[data-cursor]';
  document.addEventListener('pointerover', e => {
    const t = e.target.closest?.(HOT);
    if (!t) return;
    hot = true;
    label.textContent = t.dataset.cursor || '';
    el.classList.add('is-hot');
  });
  document.addEventListener('pointerout', e => {
    if (!e.target.closest?.(HOT)) return;
    hot = false;
    el.classList.remove('is-hot');
  });

  onTick(() => {
    // trailing follow — the lag is what makes it feel physical
    x = lerp(x, tx, 0.19); y = lerp(y, ty, 0.19);
    el.style.translate = `${x}px ${y}px`;

    const doc = document.documentElement;
    const p = doc.scrollHeight - innerHeight > 0
      ? scrollY / (doc.scrollHeight - innerHeight) : 0;
    prog.style.strokeDashoffset = String(DASH * (1 - p));
  });
}
