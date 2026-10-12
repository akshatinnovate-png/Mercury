/* ================================================================
   MERCURY STUDIO — ambience
   The acts are rendered scenes; the studio was a flat panel. This is
   the layer that makes them one product: the same starfield, the same
   planetary limb, the same drifting dust, running quietly behind the
   instrument.

   Purely decorative. It sits behind everything, takes no pointer
   events, and touches nothing the studio does. If it fails to start,
   the studio is exactly as it was.
   ================================================================ */
import { makeStars, drawStars } from '../scenes/atmos.js';
import { fitCanvas, onTick, clamp, lerp, rng, TAU } from '../core/gfx.js';

export class Ambience {
  constructor(canvas) {
    this.cv = canvas;
    this.t = 0;
    this.stars = makeStars(260, 19);
    const rand = rng(41);
    /* a few motes on a near plane, so the background has depth rather
       than being a flat field of points */
    this.dust = Array.from({ length: 46 }, () => ({
      x: rand(), y: rand(), z: 0.25 + rand() * 0.75,
      r: 0.5 + rand() * 1.4, sp: 0.003 + rand() * 0.012, p: rand() * TAU
    }));
    /* how brightly the limb burns — nudged up while a hand is being read,
       so the room responds to the work without ever distracting from it */
    this.energy = 0;
    this._target = 0;
  }

  /** @param v 0..1 — how active recognition currently is */
  setEnergy(v) { this._target = clamp(v); }

  start() {
    onTick(dt => this._draw(dt));
    return this;
  }

  _draw(dt) {
    const cv = this.cv;
    if (!cv || !cv.isConnected) return;
    this.t += dt;
    this.energy = lerp(this.energy, this._target, 1 - Math.pow(0.004, dt));

    const { ctx, w, h } = fitCanvas(cv, 1.5);
    ctx.clearRect(0, 0, w, h);

    /* ---- deep field ---- */
    const bg = ctx.createRadialGradient(
      w * 0.30, h * 0.42, 0, w * 0.30, h * 0.42, Math.max(w, h) * 0.82);
    bg.addColorStop(0, 'rgba(32,41,60,.72)');
    bg.addColorStop(0.55, 'rgba(14,19,32,.48)');
    bg.addColorStop(1, 'rgba(4,6,13,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    drawStars(ctx, w, h, this.stars, this.t, {
      scroll: this.t * 0.004,
      alpha: 0.85 + this.energy * 0.15
    });

    /* ---- the planet's limb, just off the bottom-left corner.
       Only the edge is in frame: the studio is somewhere on Mercury,
       not looking at it from space. ---- */
    const R = Math.max(w, h) * 1.05;
    const cx = -R * 0.46, cy = h + R * 0.52;
    const glow = 0.34 + this.energy * 0.26;

    const halo = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.20);
    halo.addColorStop(0, `rgba(226,233,245,${glow * 0.9})`);
    halo.addColorStop(0.35, `rgba(176,193,220,${glow * 0.42})`);
    halo.addColorStop(1, 'rgba(150,170,205,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.20, 0, TAU); ctx.fill();

    // the body itself, a touch darker than the page so the edge reads
    ctx.fillStyle = 'rgba(6,9,16,.97)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

    // a hairline of lit rock along the terminator
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = `rgba(236,241,250,${0.52 + this.energy * 0.38})`;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    /* ---- dust on the near plane ---- */
    for (const d of this.dust) {
      const dx = ((d.x + this.t * d.sp * 0.04) % 1) * w;
      const dy = ((d.y - this.t * d.sp * 0.02) % 1 + 1) % 1 * h;
      const a = (0.13 + Math.sin(this.t * 0.7 + d.p) * 0.09) * d.z;
      if (a <= 0.004) continue;
      ctx.fillStyle = `rgba(226,233,245,${a})`;
      ctx.beginPath(); ctx.arc(dx, dy, d.r * d.z, 0, TAU); ctx.fill();
    }
  }
}
