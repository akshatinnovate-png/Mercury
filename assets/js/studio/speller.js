/* ================================================================
   MERCURY — text to fingerspelling
   The other direction: type or speak a sentence and the rig signs it
   back. Same solver as the recogniser's templates, so what the studio
   teaches is exactly what it expects to see.
   ================================================================ */
import { solve, mixPose, BONES, STRUT, ALONG } from './rig.js';
import { SIGNS, REST } from './alphabet.js';
import { fitCanvas, onTick, clamp, lerp, ease, rot, project, TAU } from '../core/gfx.js';

export class Speller {
  constructor(canvas, { onLetter } = {}) {
    this.cv = canvas;
    this.onLetter = onLetter || (() => {});
    this.queue = [];          // [{ ch, pose }]
    this.i = 0;
    this.t = 0;               // 0..1 through the current letter
    this.playing = false;
    this.speed = 1;
    this.clock = 0;
    this.motionPhase = 0;
    onTick(dt => this._tick(dt));
  }

  /** Load a string. Unknown characters become pauses. */
  load(text) {
    this.queue = [...text.toUpperCase()].map(ch => ({
      ch,
      pose: SIGNS[ch] || REST,
      known: !!SIGNS[ch],
      motion: SIGNS[ch]?.motion || null
    }));
    this.i = 0; this.t = 0;
    return this.queue.length;
  }

  play()  { if (this.queue.length) this.playing = true; }
  pause() { this.playing = false; }
  stop()  { this.playing = false; this.i = 0; this.t = 0; }
  seek(i) { this.i = clamp(i, 0, Math.max(0, this.queue.length - 1)); this.t = 0; }

  get current() { return this.queue[this.i] || null; }
  get progress() {
    return this.queue.length ? (this.i + this.t) / this.queue.length : 0;
  }

  _tick(dt) {
    this.clock += dt;
    if (this.playing && this.queue.length) {
      // a letter holds, then transitions; spaces are a beat of rest
      const dur = (this.current?.ch === ' ' ? 0.34 : 0.62) / this.speed;
      this.t += dt / dur;
      if (this.t >= 1) {
        this.t = 0;
        this.i++;
        if (this.i >= this.queue.length) { this.i = this.queue.length - 1; this.playing = false; }
        this.onLetter(this.current?.ch || '', this.i);
      }
    }
    this._draw();
  }

  _draw() {
    const { ctx, w, h } = fitCanvas(this.cv);
    ctx.clearRect(0, 0, w, h);
    if (!this.queue.length) { this._drawIdle(ctx, w, h); return; }

    const cur = this.queue[this.i];
    const nxt = this.queue[this.i + 1] || cur;
    // hold the shape, then move; a linear blend reads as mush
    const blend = ease(clamp((this.t - 0.62) / 0.38));
    let pose = mixPose(cur.pose, nxt.pose, blend);

    // J and Z are drawn in the air; nudge the whole hand along their path
    let drift = { x: 0, y: 0 };
    if (cur.motion) {
      const k = this.t;
      if (cur.motion === 'hook') drift = { x: Math.sin(k * Math.PI) * -0.22, y: k * 0.30 };
      if (cur.motion === 'zigzag') {
        const seg = k * 3;
        drift = { x: (seg < 1 ? seg : seg < 2 ? 1 - (seg - 1) : (seg - 2)) * 0.34 - 0.17,
                  y: (seg < 1 ? 0 : seg < 2 ? (seg - 1) : 1) * 0.26 - 0.13 };
      }
    }

    const L = solve(pose);
    const fov = Math.min(w, h) * 1.5;
    const scale = 0.95;
    const ry = Math.sin(this.clock * 0.35) * 0.18 - 0.12;
    const rx = -0.08;

    const P = L.map(q => {
      const r = rot({
        x: (q.x + drift.x) * scale,
        y: (q.y + drift.y) * scale,
        z: q.z * scale
      }, ry, rx);
      const v = project(r, w, h, fov, 2.5);
      return { x: v.x, y: v.y, z: r.z };
    });

    /* palm */
    const across = { x: L[17].x - L[5].x, y: L[17].y - L[5].y, z: L[17].z - L[5].z };
    const wl = { x: L[0].x - across.x * .34, y: L[0].y - across.y * .34, z: L[0].z - across.z * .34 };
    const wr = { x: L[0].x + across.x * .34, y: L[0].y + across.y * .34, z: L[0].z + across.z * .34 };
    const palm = [L[5], L[9], L[13], L[17], wr, wl].map(q => {
      const r = rot({ x: (q.x + drift.x) * scale, y: (q.y + drift.y) * scale, z: q.z * scale }, ry, rx);
      const v = project(r, w, h, fov, 2.5);
      return { x: v.x, y: v.y };
    });
    ctx.beginPath();
    palm.forEach((q, k) => k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(159,180,208,.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(159,180,208,.30)';
    ctx.lineWidth = 1.4; ctx.stroke();

    /* digits */
    ctx.lineCap = ctx.lineJoin = 'round';
    BONES.forEach(([a, b], bi) => {
      const A = P[a], B = P[b];
      const d = clamp((((A.z + B.z) / 2) + 1) / 2);
      if (STRUT.has(bi)) {
        ctx.strokeStyle = `rgba(255,255,255,${0.10 + d * 0.16})`;
        ctx.lineWidth = 1.2;
      } else {
        ctx.strokeStyle = `rgba(210,240,255,${0.34 + d * 0.5})`;
        ctx.lineWidth = lerp(3, 9, d) * (1 - clamp(ALONG[bi], 0, 2) * 0.19);
      }
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    });

    const TIPS = new Set([4, 8, 12, 16, 20]);
    P.forEach((p, i) => {
      const d = clamp((p.z + 1) / 2);
      const r = lerp(2.4, 5.2, d);
      if (TIPS.has(i)) {
        ctx.fillStyle = 'rgba(226,233,245,.25)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8edf6';
      } else {
        ctx.fillStyle = `rgba(255,255,255,${0.45 + d * 0.5})`;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    });

    /* the letter itself, big and ghosted behind */
    if (cur.ch !== ' ') {
      ctx.font = `800 ${Math.round(Math.min(w, h) * 0.46)}px Archivo, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillText(cur.known ? cur.ch : '·', w / 2, h / 2);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }

  _drawIdle(ctx, w, h) {
    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.textAlign = 'center';
    ctx.fillText('TYPE SOMETHING TO SEE IT SIGNED', w / 2, h / 2);
    ctx.textAlign = 'start';
  }
}
