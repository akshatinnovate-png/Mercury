/* ================================================================
   MERCURY — ACT V, THE VOICE  &  ACT VI, THE ASCENT
   The corridor opens into an ocean of sound; then the camera lifts
   through cloud until the whole network is visible at once.
   ================================================================ */
import {
  fitCanvas, onTick, whenVisible, clamp, lerp, ease, rng, TAU
} from '../core/gfx.js';
import { scrub } from '../core/scroll.js';

/* ---------------------------------------------------------------- VOICE */
const LINES = [
  'GOOD MORNING — I HAVE AN APPOINTMENT AT TEN.',
  'CAN YOU REPEAT THAT MORE SLOWLY, PLEASE?',
  'MY DAUGHTER IS DEAF. SHE WILL SIGN FOR HERSELF.',
  'THANK YOU. THAT IS EXACTLY WHAT I MEANT.'
];

function captions() {
  const el = document.getElementById('captionText');
  if (!el) return;
  let li = 0, ci = 0, hold = 0, dir = 1;

  onTick(dt => {
    hold -= dt;
    if (hold > 0) return;
    if (dir > 0) {
      ci++; hold = 0.035;
      if (ci >= LINES[li].length) { dir = -1; hold = 2.4; }
    } else {
      ci -= 3; hold = 0.012;
      if (ci <= 0) { ci = 0; dir = 1; hold = 0.5; li = (li + 1) % LINES.length; }
    }
    el.textContent = LINES[li].slice(0, Math.max(0, ci));
  });
}

export function sceneVoice() {
  const cv = document.getElementById('cvWave');
  if (!cv) return;
  captions();

  const rand = rng(21);
  const foam = Array.from({ length: 160 }, () => ({
    x: rand(), y: rand(), r: rand() * 1.8 + 0.4, v: rand() * 0.5 + 0.2, p: rand() * TAU
  }));

  let prog = 0, alive = false, t = 0;
  scrub('#act-wave', p => { prog = p; }, { start: 'top top', end: 'bottom bottom' });
  whenVisible(document.getElementById('act-wave'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);

    /* deep water, lighter toward the surface as we rise */
    const e = ease(prog);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgb(${lerp(4,12,e)|0},${lerp(12,34,e)|0},${lerp(38,84,e)|0})`);
    g.addColorStop(0.55, `rgb(${lerp(6,18,e)|0},${lerp(20,52,e)|0},${lerp(62,120,e)|0})`);
    g.addColorStop(1, `rgb(${lerp(3,8,e)|0},${lerp(8,20,e)|0},${lerp(24,52,e)|0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    /* ---- swell: stacked bands of moving water ---- */
    for (let b = 0; b < 5; b++) {
      const depth = b / 4;
      const baseY = h * (0.16 + depth * 0.82);
      const amp   = (10 + depth * 46) * (0.6 + e * 0.6);
      // solve the crest once, then reuse it for the fill and the glimmer
      const crest = [];
      for (let x = -10; x <= w + 10; x += 16) {
        const k = x / w;
        crest.push([x, baseY
          + Math.sin(k * 7.5 + t * (0.55 + depth * 0.5) + b) * amp
          + Math.sin(k * 17.3 - t * 0.9 + b * 2) * amp * 0.32]);
      }
      ctx.beginPath();
      ctx.moveTo(-10, h + 10);
      crest.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(w + 10, h + 10); ctx.closePath();
      ctx.fillStyle = `rgba(${8 + b * 4},${26 + b * 12},${70 + b * 20},${0.34 + depth * 0.2})`;
      ctx.fill();
      ctx.beginPath();
      crest.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.strokeStyle = `rgba(160,220,255,${0.05 + depth * 0.1})`;
      ctx.lineWidth = 1; ctx.stroke();
    }

    /* ---- the utterance, rendered as a live spectrum ---- */
    const bars = 72, bw = w / bars, mid = h * 0.80;
    for (let i = 0; i < bars; i++) {
      const k = i / bars;
      // a formant-ish envelope so it reads as a voice, not a test tone
      const env = Math.sin(k * Math.PI) ** 0.7;
      const v = env * (
        0.42 * Math.sin(t * 6.1 + k * 22) +
        0.30 * Math.sin(t * 9.7 - k * 37) +
        0.28 * Math.sin(t * 3.3 + k * 11)
      );
      const a = Math.abs(v) * h * 0.20 * (0.4 + e * 0.9);
      const alpha = 0.16 + Math.abs(v) * 0.5;
      ctx.fillStyle = `rgba(77,232,255,${alpha})`;
      ctx.fillRect(i * bw + bw * 0.22, mid - a, bw * 0.56, a * 2);
    }

    /* ---- foam ---- */
    for (const f of foam) {
      const x = f.x * w;
      const y = ((f.y + t * f.v * 0.04) % 1) * h;
      const a = 0.14 + Math.sin(t * 2 + f.p) * 0.12;
      ctx.fillStyle = `rgba(230,246,255,${Math.max(0, a)})`;
      ctx.beginPath(); ctx.arc(x, y, f.r, 0, TAU); ctx.fill();
    }
  });
}

/* --------------------------------------------------------------- ASCENT */
export function sceneAscent() {
  const cv = document.getElementById('cvAscent');
  if (!cv) return;

  const rand = rng(99);
  /* people, as a network that finally resolves into one shape */
  const N = 54;
  const nodes = Array.from({ length: N }, (_, i) => ({
    a: rand() * TAU, r: 0.18 + rand() * 0.8, sp: (rand() - 0.5) * 0.09,
    z: rand(), s: 1 + rand() * 1.8
  }));
  const clouds = Array.from({ length: 16 }, () => ({
    x: rand(), y: rand(), r: 0.16 + rand() * 0.26, v: 0.004 + rand() * 0.012, o: 0.05 + rand() * 0.1
  }));

  let alive = false, t = 0, prog = 0;
  scrub('#act-ascent', p => { prog = p; }, { start: 'top bottom', end: 'bottom top' });
  whenVisible(document.getElementById('act-ascent'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#040814'); g.addColorStop(0.6, '#0a1430'); g.addColorStop(1, '#122246');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    /* cloud deck drifting between us and the network */
    for (const c of clouds) {
      const x = ((c.x + t * c.v) % 1.3 - 0.15) * w;
      const y = c.y * h;
      const R = c.r * Math.min(w, h);
      const cg = ctx.createRadialGradient(x, y, 0, x, y, R);
      cg.addColorStop(0, `rgba(190,215,255,${c.o})`);
      cg.addColorStop(1, 'rgba(190,215,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    }

    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38;
    const pts = nodes.map(n => {
      const a = n.a + t * n.sp;
      return { x: cx + Math.cos(a) * R * n.r, y: cy + Math.sin(a) * R * n.r * 0.62, s: n.s, z: n.z };
    });

    /* links: only near neighbours, so the graph breathes */
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d > R * 0.42) continue;
        ctx.strokeStyle = `rgba(77,232,255,${(1 - d / (R * 0.42)) * 0.16})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
      }
    }
    for (const p of pts) {
      ctx.fillStyle = `rgba(255,${180 + p.z * 60 | 0},${120 + p.z * 90 | 0},${0.5 + p.z * 0.5})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill();
    }

    /* the messenger, at the centre of it */
    const pulse = 0.5 + Math.sin(t * 1.5) * 0.5;
    ctx.strokeStyle = `rgba(255,107,26,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.16 + pulse * 8, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ff6b1a';
    ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, TAU); ctx.fill();
  });
}

/* ---------------------------------------------------------------- CLOSE */
export function sceneClose() {
  const cv = document.getElementById('cvClose');
  if (!cv) return;
  const rand = rng(5);
  const bits = Array.from({ length: 220 }, () => ({
    x: rand(), y: rand(), v: 0.02 + rand() * 0.09, r: rand() * 1.4 + 0.3, p: rand() * TAU
  }));

  let alive = false, t = 0;
  whenVisible(document.getElementById('act-close'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      const x = b.x * w;
      const y = ((b.y - t * b.v * 0.06) % 1 + 1) % 1 * h;
      const a = (0.12 + Math.sin(t * 1.6 + b.p) * 0.12);
      ctx.fillStyle = `rgba(255,107,26,${Math.max(0, a)})`;
      ctx.fillRect(x, y, b.r, b.r);
    }
  });
}
