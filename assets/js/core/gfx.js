/* ================================================================
   MERCURY — shared graphics kit
   A tiny 3D pipeline (rotate → project) plus a single rAF ticker.
   Everything on this site is drawn, not loaded: no image assets.
   ================================================================ */

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
/* smoothstep-ish easing used for scrubbed camera moves */
export const ease = t => t * t * (3 - 2 * t);
/* map v from [a,b] into [0,1], clamped */
export const norm = (v, a, b) => clamp((v - a) / (b - a));
/* deterministic pseudo-random so every reload draws the same sky */
export function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/* ---------------- canvas with device-pixel-ratio backing ---------------- */
export function fitCanvas(cv, maxDpr = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height, dpr };
}

/* ---------------- 3D ---------------- */
/* Rotate a point around Y then X. Returns a new vec. */
export function rot(p, ry, rx) {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const x =  p.x * cy + p.z * sy;
  const z = -p.x * sy + p.z * cy;
  const y =  p.y * cx - z * sx;
  const z2 = p.y * sx + z * cx;
  return { x, y: y, z: z2 };
}

/* Weak perspective projection. fov acts as focal length in px. */
export function project(p, w, h, fov = 900, camZ = 3.2) {
  const d = fov / (camZ + p.z);
  return { x: w / 2 + p.x * d, y: h / 2 + p.y * d, s: d / fov, z: p.z };
}

/* Evenly distributed points on a unit sphere (Fibonacci lattice). */
export function fibSphere(n) {
  const pts = [], golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return pts;
}

/* Great-circle arc between two unit vectors, as `seg` points. */
export function arc(a, b, seg = 48, lift = 0.22) {
  const out = [];
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  const omega = Math.acos(dot) || 1e-4;
  const so = Math.sin(omega);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const k0 = Math.sin((1 - t) * omega) / so;
    const k1 = Math.sin(t * omega) / so;
    // bulge the arc away from the surface so it reads as a flight path
    const r = 1 + Math.sin(t * Math.PI) * lift;
    out.push({
      x: (a.x * k0 + b.x * k1) * r,
      y: (a.y * k0 + b.y * k1) * r,
      z: (a.z * k0 + b.z * k1) * r
    });
  }
  return out;
}

/* ---------------- one ticker to rule them all ---------------- */
const jobs = new Set();
let running = false, last = performance.now(), fps = 60, acc = 0, frames = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt; frames++;
  if (acc >= 0.5) { fps = Math.round(frames / acc); acc = 0; frames = 0; }
  for (const j of jobs) { try { j(dt, now / 1000); } catch (e) { /* keep the loop alive */ } }
  requestAnimationFrame(loop);
}

export function onTick(fn) {
  jobs.add(fn);
  if (!running) { running = true; requestAnimationFrame(loop); }
  return () => jobs.delete(fn);
}
export const getFps = () => fps;

/* Only run a scene while its section is anywhere near the viewport. */
export function whenVisible(el, on, off) {
  const io = new IntersectionObserver(
    ([e]) => (e.isIntersecting ? on() : off()),
    { rootMargin: '10% 0px' }
  );
  io.observe(el);
  return io;
}
