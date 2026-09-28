/* ================================================================
   MERCURY — the planet
   A real photograph of Mercury, unwrapped to a texture map and lit
   fresh here, so the globe turns rather than the picture spinning.

   The projection is fixed: only the longitude offset changes as the
   planet rotates. So every per-pixel term — which texture row, which
   base column, how much light falls there, how close to the limb —
   is solved once into a lookup table. After that a frame costs one
   array read and one multiply per pixel, which is what lets a
   full-resolution sphere run at 60fps without WebGL.
   ================================================================ */
import { clamp, TAU } from '../core/gfx.js';

const MAP = '/assets/textures/mercury-map.png';

/* The sun sits up and to the left, matching the rim light in the
   layout. Slightly more than unit length so the lit side is generous. */
const SUN = (() => {
  const v = { x: -0.58, y: 0.44, z: 0.69 };
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
})();

export class Planet {
  constructor() {
    this.ready = false;
    this.map = null;          // Uint8 luminance, mapW x mapH
    this.mapW = 0;
    this.mapH = 0;
    this.lut = null;          // built per radius
    this.lutR = 0;
    this.buf = null;          // ImageData for the disc
    this.canvas = null;       // offscreen disc, blitted to the scene
  }

  async load() {
    const img = new Image();
    img.src = MAP;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;

    this.mapW = c.width; this.mapH = c.height;
    this.map = new Uint8Array(c.width * c.height);
    for (let i = 0, p = 0; i < this.map.length; i++, p += 4) this.map[i] = d[p];
    this.ready = true;
    return this;
  }

  /**
   * Solve the projection once for a given radius.
   * Stores, per pixel inside the disc: the texture row, the longitude at
   * zero rotation, the diffuse light, and an edge softness for the limb.
   */
  _buildLut(R) {
    const S = R * 2;
    const n = S * S;
    const row = new Int32Array(n);        // texture row * mapW
    const lonIdx = new Float32Array(n);   // base column, in texels
    const light = new Float32Array(n);
    const edge = new Float32Array(n);
    const inside = new Uint8Array(n);

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const nx = (x + 0.5 - R) / R;
        const ny = (R - y - 0.5) / R;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;

        inside[i] = 1;
        const nz = Math.sqrt(1 - r2);

        const lat = Math.asin(clamp(ny, -1, 1));
        const lon = Math.atan2(nx, nz);

        const v = Math.min(this.mapH - 1,
          Math.max(0, Math.round((0.5 - lat / Math.PI) * (this.mapH - 1))));
        row[i] = v * this.mapW;
        lonIdx[i] = (lon / TAU + 0.5) * this.mapW;

        // Lambert, softened — a hard terminator looks like a cut-out
        const d = nx * SUN.x + ny * SUN.y + nz * SUN.z;
        light[i] = Math.pow(Math.max(0, d), 0.78);

        // antialias the silhouette instead of leaving a stair-stepped edge
        edge[i] = clamp((1 - Math.sqrt(r2)) * R * 1.4, 0, 1);
      }
    }
    this.lut = { S, row, lonIdx, light, edge, inside };
    this.lutR = R;

    this.canvas = document.createElement('canvas');
    this.canvas.width = S; this.canvas.height = S;
    this.bufCtx = this.canvas.getContext('2d');
    this.buf = this.bufCtx.createImageData(S, S);
  }

  /**
   * Draw the planet.
   * @param rotation radians of longitude; grows slowly
   */
  draw(ctx, cx, cy, R, rotation, { glow = 1, alpha = 1 } = {}) {
    if (!this.ready || alpha <= 0.002) return;
    R = Math.max(8, Math.round(R));
    if (!this.lut || this.lutR !== R) this._buildLut(R);

    const { S, row, lonIdx, light, edge, inside } = this.lut;
    const map = this.map, mapW = this.mapW;
    const px = this.buf.data;
    const off = (rotation / TAU) * mapW;

    for (let i = 0, p = 0; i < inside.length; i++, p += 4) {
      if (!inside[i]) { px[p + 3] = 0; continue; }

      let u = lonIdx[i] + off;
      u -= Math.floor(u / mapW) * mapW;          // wrap into the map
      const t = map[row[i] + (u | 0)];

      // a little ambient keeps the night side present rather than a void
      let lum = t * (0.075 + light[i] * 1.46);
      if (lum > 255) lum = 255;

      // Mercury is grey, but a touch of warmth in the lit side and cool in
      // the shadow stops it reading as a flat greyscale cut-out
      const warm = light[i];
      px[p]     = Math.min(255, lum * (1 + warm * 0.045));
      px[p + 1] = lum;
      px[p + 2] = Math.min(255, lum * (1 + (1 - warm) * 0.075));
      px[p + 3] = 255 * edge[i] * alpha;
    }

    this.bufCtx.putImageData(this.buf, 0, 0);

    /* ---- the silver corona, drawn behind the disc ---- */
    if (glow > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.5);
      g.addColorStop(0, `rgba(228,234,244,${0.30 * glow * alpha})`);
      g.addColorStop(0.24, `rgba(198,208,224,${0.13 * glow * alpha})`);
      g.addColorStop(0.62, `rgba(150,164,188,${0.035 * glow * alpha})`);
      g.addColorStop(1, 'rgba(150,164,188,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, TAU); ctx.fill();
    }

    ctx.drawImage(this.canvas, cx - R, cy - R);

    /* ---- a thin lit rim, on the sun side only ---- */
    if (glow > 0.01) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.006, 0, TAU);
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, `rgba(242,246,252,${0.62 * glow * alpha})`);
      rim.addColorStop(0.42, `rgba(206,216,232,${0.12 * glow * alpha})`);
      rim.addColorStop(0.75, 'rgba(206,216,232,0)');
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1, R * 0.008);
      ctx.stroke();
      ctx.restore();
    }
  }
}
