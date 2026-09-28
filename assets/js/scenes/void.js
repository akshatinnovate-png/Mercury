/* ================================================================
   MERCURY — ACT I, THE VOID
   A point-cloud Mercury with sign-language corridors arcing between
   cities. Drawn every frame from maths; no textures, no sprites.
   ================================================================ */
import {
  fitCanvas, onTick, whenVisible, fibSphere, arc, rot, project,
  rng, clamp, lerp, ease, TAU
} from '../core/gfx.js';
import { scrub } from '../core/scroll.js';

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

  const shell   = fibSphere(5200);         // the planet surface
  const rand    = rng(7);
  const stars   = Array.from({ length: 420 }, () => ({
    x: rand(), y: rand(), r: rand() * 1.5 + 0.25, tw: rand() * TAU
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
    const cx    = lerp(w * 0.74, w * 0.5, e);     // slide toward centre
    const fade  = 1 - clamp((prog - 0.72) / 0.28); // hand off to the descent

    ctx.save();
    ctx.translate(cx - w / 2, 0);
    ctx.globalAlpha = fade;

    /* ---- starfield (parallax: barely moves) ---- */
    for (const s of stars) {
      const sx = s.x * w, sy = (s.y * h + prog * 40) % h;
      const a = 0.25 + Math.sin(t * 1.4 + s.tw) * 0.2;
      ctx.fillStyle = `rgba(200,210,235,${a * fade})`;
      ctx.fillRect(sx, sy, s.r, s.r);
    }

    /* ---- limb light: a tight corona hugging the edge, not a wash ---- */
    const R = fov / camZ;
    const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.94, w / 2, h / 2, R * 1.16);
    g.addColorStop(0, 'rgba(255,107,26,0)');
    g.addColorStop(0.32, 'rgba(255,124,40,.42)');
    g.addColorStop(1, 'rgba(255,107,26,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, R * 1.16, 0, TAU); ctx.fill();

    /* shadowed body, so the point cloud has something to sit against */
    ctx.fillStyle = 'rgba(3,5,11,.92)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, R * 0.985, 0, TAU); ctx.fill();

    /* ---- the planet: depth-sorted points, lit from upper-right ---- */
    const light = { x: 0.72, y: -0.5, z: 0.48 };
    const pts = [];
    for (const p0 of shell) {
      const p = rot(p0, ry, rx);
      if (p.z < -0.92) continue;                       // cheap backface cull
      const pr = project(p, w, h, fov, camZ);
      const lit = clamp(p0.x * light.x + p0.y * light.y + p0.z * light.z);
      pts.push({ ...pr, lit });
    }
    pts.sort((a, b) => b.z - a.z);
    for (const p of pts) {
      const depth = clamp((p.z + 1) / 2);
      const a = (0.06 + Math.pow(p.lit, 1.35) * 1.0) * (0.45 + depth * 0.55) * fade;
      // sunlit side runs amber, the dark side keeps a cold rim
      const c = p.lit > 0.5
        ? `rgba(255,${Math.round(140 + p.lit * 90)},${Math.round(70 + p.lit * 90)},${a})`
        : `rgba(70,100,175,${a * 0.5})`;
      ctx.fillStyle = c;
      const r = Math.max(0.6, p.s * fov * 0.0050);
      ctx.fillRect(p.x, p.y, r, r);
    }

    /* ---- corridors: signal travelling between sign languages ---- */
    routes.forEach((rt, i) => {
      const proj = rt.pts.map(p => project(rot(p, ry, rx), w, h, fov, camZ));
      // trail
      ctx.beginPath();
      proj.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = `rgba(255,107,26,${0.16 * fade})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // the packet in flight
      const head = (t * 0.22 + rt.phase) % 1;
      const idx  = Math.floor(head * (proj.length - 1));
      const seg  = proj.slice(Math.max(0, idx - 9), idx + 1);
      if (seg.length > 1) {
        ctx.beginPath();
        seg.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.strokeStyle = `rgba(255,150,60,${0.85 * fade})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        const tip = seg[seg.length - 1];
        ctx.fillStyle = `rgba(255,200,130,${fade})`;
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
      ctx.fillStyle = `rgba(77,232,255,${a})`;
      ctx.fillRect(p.x - 1.6, p.y - 1.6, 3.2, 3.2);
      ctx.strokeStyle = `rgba(77,232,255,${a * 0.42})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 16, p.y - 12); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`;
      ctx.fillText(hb.name, p.x + 20, p.y - 13);
    }

    ctx.restore();
  });
}
