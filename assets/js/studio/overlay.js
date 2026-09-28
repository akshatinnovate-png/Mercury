/* ================================================================
   MERCURY — landmark overlay
   Draws the rig on top of the video feed: bones, joints, the dwell
   ring that fills as a letter is held, and a tracking box.
   ================================================================ */
import { BONES, STRUT } from './rig.js';
import { clamp, lerp, TAU } from '../core/gfx.js';

export function drawOverlay(ctx, w, h, hands, { mirror = true, dwell = 0, letter = '', confidence = 0 } = {}) {
  ctx.clearRect(0, 0, w, h);
  if (!hands?.length) return;

  for (const hand of hands) {
    // raw landmarks are in video space; mirror for display only
    const P = hand.raw.map(p => ({
      x: (mirror ? 1 - p.x : p.x) * w,
      y: p.y * h,
      z: p.z
    }));

    /* bones */
    ctx.lineCap = ctx.lineJoin = 'round';
    BONES.forEach(([a, b], i) => {
      const A = P[a], B = P[b];
      if (STRUT.has(i)) {
        ctx.strokeStyle = 'rgba(255,255,255,.30)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(77,232,255,.85)';
        ctx.lineWidth = 3.5;
      }
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    });

    /* joints — fingertips carry the signal colour */
    const TIPS = new Set([4, 8, 12, 16, 20]);
    P.forEach((p, i) => {
      const tip = TIPS.has(i);
      ctx.fillStyle = tip ? '#ff6b1a' : 'rgba(255,255,255,.92)';
      ctx.beginPath(); ctx.arc(p.x, p.y, tip ? 5 : 3, 0, TAU); ctx.fill();
    });

    /* tracking box */
    const xs = P.map(p => p.x), ys = P.map(p => p.y);
    const x0 = Math.min(...xs) - 18, x1 = Math.max(...xs) + 18;
    const y0 = Math.min(...ys) - 18, y1 = Math.max(...ys) + 18;
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    const k = 16;
    [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]].forEach(([x,y,sx,sy])=>{
      ctx.beginPath();
      ctx.moveTo(x, y + k*sy); ctx.lineTo(x, y); ctx.lineTo(x + k*sx, y);
      ctx.stroke();
    });
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillText(hand.handedness.toUpperCase(), x0, y0 - 8);

    /* dwell ring at the wrist: how close this shape is to committing */
    if (dwell > 0 && letter) {
      const c = P[0], R = 34;
      ctx.beginPath(); ctx.arc(c.x, c.y + 42, R, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y + 42, R, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(dwell));
      ctx.strokeStyle = '#ff6b1a'; ctx.lineWidth = 5; ctx.stroke();
      ctx.font = '700 26px Archivo, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(letter, c.x, c.y + 43);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }
}
