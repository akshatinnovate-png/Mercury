/* ================================================================
   MERCURY — atmosphere kit
   A starfield with real parallax depth, and a cloud volume the
   camera actually flies through: puffs live at (x,y,z), the camera
   travels along z, and each puff is projected, scaled and recycled
   as it passes behind. That perspective pass is what makes a
   descent feel like falling rather than like a gradient wipe.
   ================================================================ */
import { rng, clamp, lerp, TAU } from '../core/gfx.js';

/* ---------------------------------------------------------- STARS */
/* Three depth bands. Near stars are bigger, brighter and parallax
   hardest; far ones barely move, which is what sells the distance. */
export function makeStars(count = 700, seed = 3) {
  const rand = rng(seed);
  return Array.from({ length: count }, () => {
    const band = rand();
    const depth = band < 0.5 ? 0.25 : band < 0.82 ? 0.6 : 1;   // far → near
    return {
      x: rand(), y: rand(), depth,
      r: lerp(0.4, 1.9, depth) * (0.6 + rand() * 0.8),
      tw: rand() * TAU,
      twRate: 0.6 + rand() * 2.2,
      hue: rand()
    };
  });
}

/**
 * @param scroll  parallax input, in screens
 * @param alpha   master fade (stars wash out inside the atmosphere)
 * @param streak  0 = points, 1 = full motion streaks
 */
export function drawStars(ctx, w, h, stars, t, { scroll = 0, alpha = 1, streak = 0 } = {}) {
  if (alpha <= 0.001) return;
  for (const s of stars) {
    const y = (((s.y - scroll * s.depth * 0.35) % 1) + 1) % 1 * h;
    const x = s.x * w;
    const tw = 0.55 + Math.sin(t * s.twRate + s.tw) * 0.45;
    const a = tw * alpha * lerp(0.35, 1, s.depth);
    if (a <= 0.01) continue;
    // a touch of colour temperature stops the field looking like dust
    const c = s.hue < 0.72 ? '255,255,255'
            : s.hue < 0.89 ? '186,212,255'
            : '255,214,170';
    if (streak > 0.02) {
      const len = streak * lerp(14, 90, s.depth);
      const g = ctx.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = s.r;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(${c},${a})`;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
    }
  }
}

/* --------------------------------------------------------- CLOUDS */
/* Each puff is a cluster of soft blobs. One blob is a smudge; a
   cluster with varied radii reads as cumulus. */
export function makeClouds(count = 26, seed = 11) {
  const rand = rng(seed);
  return Array.from({ length: count }, () => ({
    x: (rand() - 0.5) * 2.6,
    y: (rand() - 0.5) * 1.5,
    z: rand(),                                   // 0..1 through the volume
    scale: 0.5 + rand() * 1.5,
    spin: (rand() - 0.5) * 0.25,
    blobs: Array.from({ length: 7 + ((rand() * 6) | 0) }, () => ({
      dx: (rand() - 0.5) * 1.25,
      dy: (rand() - 0.5) * 0.48,
      r: 0.14 + rand() * 0.26,
      a: 0.5 + rand() * 0.5
    }))
  }));
}

/**
 * Fly the camera through the cloud volume.
 * @param camZ   0..1 position through the deck; puffs behind it recycle
 * @param tint   [r,g,b] of the lit cloud
 * @param alpha  master opacity
 */
/* One radial gradient per blob per frame is the single most expensive thing
   on this page. The shape never changes, so bake it into a sprite once per
   tint and blit it instead — same picture, a fraction of the cost. */
const SPRITES = new Map();
function puffSprite(tint) {
  const key = tint.join(',');
  const hit = SPRITES.get(key);
  if (hit) return hit;

  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  const [r, g, b] = tint;
  // highlight sits above centre, so every puff reads as lit from above
  const grd = x.createRadialGradient(S / 2, S * 0.36, S * 0.02, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.58, `rgba(${r},${g},${b},.78)`);
  grd.addColorStop(0.86, `rgba(${r},${g},${b},.20)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grd;
  x.fillRect(0, 0, S, S);

  SPRITES.set(key, cv);
  return cv;
}

export function drawClouds(ctx, w, h, clouds, t, { camZ = 0, tint = [255, 255, 255], alpha = 1, spread = 1 } = {}) {
  if (alpha <= 0.001) return;
  // A real pinhole projection: screen = focal * world / depth. Position and
  // size share the same divide, so a puff spreads outward as it rushes past
  // instead of just growing in place.
  const focal = Math.max(w, h) * 0.10 * spread;
  const maxR = Math.max(w, h) * 0.34;
  const sprite = puffSprite(tint);

  const order = clouds
    .map(c => ({ c, dz: ((c.z - camZ) % 1 + 1) % 1 }))
    .sort((a, b) => b.dz - a.dz);          // far first, so near puffs occlude

  const prevAlpha = ctx.globalAlpha;
  for (const { c, dz } of order) {
    const z = 0.17 + dz * 2.1;             // never let a puff reach the lens
    const s = (focal * c.scale) / z;
    if (s < 3) continue;

    const px = w / 2 + (c.x * focal) / z;
    const py = h / 2 + (c.y * focal) / z;
    if (px < -s * 2.2 || px > w + s * 2.2 || py < -s * 2.2 || py > h + s * 2.2) continue;

    const far  = clamp((1 - dz) / 0.30);   // resolves out of the far haze
    const near = clamp(1 - dz / 0.16);     // blows out as it passes the camera
    const a = alpha * far * (1 - near) * 0.9;
    if (a <= 0.008) continue;

    const rot = t * c.spin, cos = Math.cos(rot), sin = Math.sin(rot);
    for (const b of c.blobs) {
      const br = b.r * s;
      if (br < 1.5 || br > maxR) continue;   // giant near blobs are all cost
      const bx = px + (b.dx * cos - b.dy * sin) * s;
      const by = py + (b.dx * sin + b.dy * cos) * s * 0.62;
      if (bx < -br || bx > w + br || by < -br || by > h + br) continue;
      ctx.globalAlpha = a * b.a;
      ctx.drawImage(sprite, bx - br, by - br, br * 2, br * 2);
    }
  }
  ctx.globalAlpha = prevAlpha;
}

/* ------------------------------------------------------- AIRGLOW */
/* The thin bright band on a planet's limb. Cheap, and it does more
   for "we are in an atmosphere" than any amount of gradient. */
export function drawAirglow(ctx, w, h, { y = 0.5, thickness = 0.16, tint = [120, 190, 255], alpha = 1 } = {}) {
  if (alpha <= 0.001) return;
  const [r, g, b] = tint;
  const top = h * (y - thickness);
  const grd = ctx.createLinearGradient(0, top, 0, h * (y + thickness));
  grd.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grd.addColorStop(0.5, `rgba(${r},${g},${b},${0.5 * alpha})`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, top, w, h * thickness * 2);
}

/* Sample an atmospheric column: black space → blue → daylight. */
const SKY = [
  [0.00, [4, 6, 13]], [0.16, [8, 10, 40]], [0.32, [20, 26, 96]],
  [0.50, [42, 76, 170]], [0.66, [92, 152, 218]], [0.82, [168, 204, 238]],
  [1.00, [247, 247, 244]]
];
export function skyAt(p) {
  p = clamp(p);
  for (let i = 1; i < SKY.length; i++) {
    if (p <= SKY[i][0]) {
      const [p0, c0] = SKY[i - 1], [p1, c1] = SKY[i];
      const k = (p - p0) / (p1 - p0);
      return c0.map((v, j) => Math.round(lerp(v, c1[j], k)));
    }
  }
  return SKY[SKY.length - 1][1];
}


/* ---------------------------------------------- half-res cloud buffer */
/* Clouds are soft by nature, so drawing them at half resolution and
   upscaling is visually free and quarters the fill cost — which is the
   entire bottleneck on a machine without a GPU. */
let _buf = null, _bctx = null, _bw = 0, _bh = 0;

export function cloudBuffer(w, h, scale = 0.5) {
  const bw = Math.max(1, Math.round(w * scale));
  const bh = Math.max(1, Math.round(h * scale));
  if (!_buf) { _buf = document.createElement('canvas'); _bctx = _buf.getContext('2d'); }
  if (bw !== _bw || bh !== _bh) { _buf.width = _bw = bw; _buf.height = _bh = bh; }
  _bctx.setTransform(1, 0, 0, 1, 0, 0);
  _bctx.clearRect(0, 0, bw, bh);
  return { ctx: _bctx, w: bw, h: bh, canvas: _buf };
}

export function blitClouds(ctx, w, h, buf) {
  ctx.drawImage(buf.canvas, 0, 0, buf.w, buf.h, 0, 0, w, h);
}

/* ------------------------------------------------- adaptive quality */
/* Watches the frame rate and steps the cloud buffer down on machines
   that cannot keep up, rather than shipping one fixed cost to everyone. */
let _q = 0.5, _slow = 0, _fast = 0;
export function cloudScale(fps) {
  if (fps < 34) { _slow++; _fast = 0; } else if (fps > 52) { _fast++; _slow = 0; }
  if (_slow > 24) { _q = Math.max(0.3, _q - 0.1); _slow = 0; }
  if (_fast > 90 && _q < 0.5) { _q = Math.min(0.5, _q + 0.1); _fast = 0; }
  return _q;
}
