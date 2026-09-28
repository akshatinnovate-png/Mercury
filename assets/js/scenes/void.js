/* ================================================================
   MERCURY — ACT I, THE VOID
   A point-cloud Mercury with sign-language corridors arcing between
   cities. Drawn every frame from maths; no textures, no sprites.
   ================================================================ */
import {
  fitCanvas, onTick, whenVisible, arc, rot, project,
  rng, clamp, lerp, ease, TAU
} from '../core/gfx.js';
import { Planet } from './planet.js';
import { scrub } from '../core/scroll.js';
import { makeStars, drawStars } from './atmos.js';

/* Mercury is the closest planet to the sun, so the sun belongs in frame.
   Drawn small and far off to the side: it lights the scene, it is not the
   subject. */
function drawSun(ctx, w, h, x, y, r, a) {
  if (a <= 0.01) return;
  const core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, `rgba(255,255,255,${a})`);
  core.addColorStop(0.35, `rgba(240,246,255,${a * 0.5})`);
  core.addColorStop(1, 'rgba(210,226,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();

  // anamorphic streak, the one piece of lens language the scene allows
  const streak = ctx.createLinearGradient(x - r * 7, y, x + r * 7, y);
  streak.addColorStop(0, 'rgba(190,214,255,0)');
  streak.addColorStop(0.5, `rgba(226,238,255,${a * 0.30})`);
  streak.addColorStop(1, 'rgba(190,214,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(x - r * 7, y - r * 0.09, r * 14, r * 0.18);
}

/* Hubs are placed by lat/lon so the corridors read as real routes. */
const HUBS = [
  ['ASL',  38.9, -77.0], ['LSF',  48.9,   2.4], ['BSL',  51.5,  -0.1],
  ['ISL',  28.6,  77.2], ['CSL',  39.9, 116.4], ['JSL',  35.7, 139.7],
  ['LIBRAS', -23.5, -46.6], ['AUSLAN', -33.9, 151.2], ['SASL', -26.2, 28.0]
];

const toVec = (lat, lon) => {
  const a = (90 - lat) * Math.PI / 180, b = (lon + 180) * Math.PI / 180;
  return { x: Math.sin(a) * Math.cos(b), y: Math.cos(a), z: Math.sin(a) * Math.sin(b) };
};

export function sceneVoid() {
  const cv = document.getElementById('cvVoid');
  if (!cv) return;

  const planet  = new Planet();
  planet.load().catch(() => { /* the arcs and stars still carry the scene */ });
  const rand    = rng(7);
  // fewer stars than before: the planet is the subject, not the field
  const stars   = makeStars(300, 7);
  // motes drifting between camera and planet, to give the void a near plane
  const dust    = Array.from({ length: 70 }, () => ({
    x: rand(), y: rand(), z: 0.3 + rand() * 0.7,
    r: 0.5 + rand() * 1.5, sp: 0.004 + rand() * 0.016, p: rand() * TAU
  }));
  const hubs    = HUBS.map(([n, la, lo]) => ({ name: n, v: toVec(la, lo) }));
  const routes  = [];
  for (let i = 0; i < hubs.length; i++) {
    const j = (i * 3 + 2) % hubs.length;         // deterministic pairing
    if (i !== j) routes.push({
      pts: arc(hubs[i].v, hubs[j].v, 52, 0.26),
      phase: i / hubs.length
    });
  }

  let prog = 0, alive = false, t = 0;

  scrub('#act-void', p => { prog = p; }, { start: 'top top', end: 'bottom bottom' });
  whenVisible(document.getElementById('act-void'), () => alive = true, () => alive = false);

  onTick((dt) => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);

    /* camera: the planet drifts right→centre and closes in as you scroll */
    const e     = ease(prog);
    const camZ  = lerp(3.15, 1.55, e);            // dolly in
    const ry    = t * 0.055 + prog * 1.25;        // slow spin + scrub
    const rx    = lerp(-0.22, 0.12, e);
    const fov   = Math.min(w, h) * 1.35;
    const cx    = lerp(w * 0.80, w * 0.54, e);    // slide toward centre
    const fade  = 1 - clamp((prog - 0.72) / 0.28); // hand off to the descent

    ctx.save();
    ctx.translate(cx - w / 2, 0);
    ctx.globalAlpha = fade;

    /* ---- starfield: near bands drift hardest, which reads as depth ---- */
    drawStars(ctx, w, h, stars, t, { scroll: prog * 0.5, alpha: fade });

    /* ---- the sun, far off and small ---- */
    drawSun(ctx, w, h, w * 0.055 - prog * w * 0.06, h * 0.16,
            Math.min(w, h) * 0.020, fade * 0.95);

    /* ---- the planet itself ---- */
    const R = fov / camZ * 0.66;
    // Mercury turns once every 59 days. This is faster than that and still
    // slow enough that it reads as a body in motion rather than a spin.
    const spin = t * 0.021 + prog * 0.55;
    planet.draw(ctx, w / 2, h * 0.5, R, spin, { glow: 1, alpha: fade });

    /* ---- dust in the foreground, lit from the sun side ---- */
    for (const d of dust) {
      const dx = ((d.x + t * d.sp * 0.05) % 1) * w;
      const dy = ((d.y - t * d.sp * 0.03) % 1 + 1) % 1 * h;
      const a = (0.10 + Math.sin(t * 0.8 + d.p) * 0.08) * d.z * fade;
      if (a <= 0.005) continue;
      ctx.fillStyle = `rgba(226,233,245,${a})`;
      ctx.beginPath(); ctx.arc(dx, dy, d.r * d.z, 0, TAU); ctx.fill();
    }

    /* ---- corridors: signal travelling between sign languages ---- */
    routes.forEach((rt, i) => {
      const proj = rt.pts.map(p => project(rot(p, ry, rx), w, h, fov, camZ));
      // trail
      ctx.beginPath();
      proj.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = `rgba(176,188,208,${0.13 * fade})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // the packet in flight
      const head = (t * 0.22 + rt.phase) % 1;
      const idx  = Math.floor(head * (proj.length - 1));
      const seg  = proj.slice(Math.max(0, idx - 9), idx + 1);
      if (seg.length > 1) {
        ctx.beginPath();
        seg.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.strokeStyle = `rgba(232,238,248,${0.8 * fade})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        const tip = seg[seg.length - 1];
        ctx.fillStyle = `rgba(255,255,255,${fade})`;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 2, 0, TAU); ctx.fill();
      }
    });

    /* ---- hub pins: only the ones facing us ---- */
    ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    for (const hb of hubs) {
      const p3 = rot(hb.v, ry, rx);
      if (p3.z < 0.12) continue;
      const p = project(p3, w, h, fov, camZ);
      const a = clamp((p3.z - 0.12) / 0.4) * fade;
      ctx.fillStyle = `rgba(226,233,245,${a})`;
      ctx.fillRect(p.x - 1.6, p.y - 1.6, 3.2, 3.2);
      ctx.strokeStyle = `rgba(200,212,232,${a * 0.38})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 16, p.y - 12); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`;
      ctx.fillText(hb.name, p.x + 20, p.y - 13);
    }

    ctx.restore();
  });
}
