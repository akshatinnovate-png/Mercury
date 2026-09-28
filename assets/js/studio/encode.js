/* ================================================================
   MERCURY — canonical pose encoding
   One definition of "what a handshape looks like as numbers", used by
   the neural classifier, the template matcher and the vector store.

   Landmarks arrive in image space, at whatever size and angle the
   signer's hand happens to be. This puts every hand into the same
   frame: wrist at the origin, palm length 1, the palm facing +z and
   the middle knuckle pointing up. After that, two people signing the
   same letter produce nearly the same numbers — which is the whole
   reason a model trained on one set of hands can read another's.
   ================================================================ */
import { features } from './asl.js';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = v => Math.hypot(v.x, v.y, v.z) || 1e-6;
const unit = v => { const l = len(v); return { x: v.x / l, y: v.y / l, z: v.z / l }; };

/**
 * Put a hand into the canonical frame.
 * @returns {Array<{x,y,z}>} 21 landmarks, wrist-centred and unit-scaled
 */
export function frame(lm) {
  const wrist = lm[0];
  const up = sub(lm[9], wrist);              // wrist → middle knuckle
  const scale = len(up);

  // Build an orthonormal basis from the palm. `across` spans the
  // knuckles; its component along `up` is removed so the axes are square.
  const yAxis = unit(up);
  const acrossRaw = sub(lm[17], lm[5]);      // pinky knuckle → index knuckle
  const proj = dot(acrossRaw, yAxis);
  const xAxis = unit({
    x: acrossRaw.x - yAxis.x * proj,
    y: acrossRaw.y - yAxis.y * proj,
    z: acrossRaw.z - yAxis.z * proj
  });
  const zAxis = cross(xAxis, yAxis);         // palm normal

  const local = lm.map(p => {
    const v = sub(p, wrist);
    return {
      x: dot(v, xAxis) / scale,
      y: dot(v, yAxis) / scale,
      z: dot(v, zAxis) / scale
    };
  });
  return { local, xAxis, yAxis, zAxis, scale };
}

export const canonical = lm => frame(lm).local;

/* The 13 geometric features are already invariant and, unlike raw
   coordinates, each one means something a person can check. */
export function geometric(lm) {
  const f = features(lm);
  return [
    f.curl[0], f.curl[1], f.curl[2], f.curl[3], f.curl[4],
    f.thumb.fromWrist, f.spread[0], f.spread[1], f.spread[2],
    f.thumb.toIndexTip, f.thumb.toIndexMcp,
    f.crossed ? 1 : 0, f.pointing
  ];
}

/* Canonical coordinates are rotation-invariant by construction, which is
   what makes the model robust — and which also erases G from Q and P from
   K, since those differ only in how the hand is turned. The frame's own
   axes are appended so that orientation is available again, explicitly. */
export const ENCODE_DIM = 63 + 13 + 1 + 6;   // canonical · geometric · sideways · frame axes

/**
 * The model's input vector: canonical coordinates carry the shape,
 * geometric features carry the parts a human would describe.
 */
export function encode(lm) {
  const fr = frame(lm);
  const out = new Float32Array(ENCODE_DIM);
  let i = 0;
  for (const p of fr.local) { out[i++] = p.x; out[i++] = p.y; out[i++] = p.z; }
  for (const g of geometric(lm)) out[i++] = g;
  out[i++] = features(lm).sideways;
  // where the hand actually points in the world, which the canonical
  // frame has just normalised away
  for (const a of [fr.yAxis, fr.zAxis]) { out[i++] = a.x; out[i++] = a.y; out[i++] = a.z; }
  return out;
}

/* ================================================================
   Augmentation — used only when generating training data.

   The rig gives one perfect example of each letter. Real hands differ
   in proportion, are held at angles, and are tracked imperfectly. This
   randomises all three, which is what lets a model trained on a rig
   generalise to a person. It is domain randomisation, and it is the
   honest answer to having no recorded dataset.
   ================================================================ */
function rotAxis(p, ax, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(p, ax);
  const cr = cross(ax, p);
  return {
    x: p.x * c + cr.x * s + ax.x * d * (1 - c),
    y: p.y * c + cr.y * s + ax.y * d * (1 - c),
    z: p.z * c + cr.z * s + ax.z * d * (1 - c)
  };
}

export function augment(lm, rnd, strength = 1) {
  const g = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.5;   // ~normal

  // whole-hand rotation: people do not hold a hand square to the lens
  let out = lm.map(p => ({ ...p }));
  const wrist = out[0];
  const centred = out.map(p => sub(p, wrist));
  const rx = g() * 0.42 * strength, ry = g() * 0.52 * strength, rz = g() * 0.34 * strength;
  const rotated = centred
    .map(p => rotAxis(p, { x: 1, y: 0, z: 0 }, rx))
    .map(p => rotAxis(p, { x: 0, y: 1, z: 0 }, ry))
    .map(p => rotAxis(p, { x: 0, y: 0, z: 1 }, rz));

  // proportion: longer fingers, wider palms, different hands
  const fingerScale = 1 + g() * 0.16 * strength;
  const palmScale = 1 + g() * 0.13 * strength;
  const scaled = rotated.map((p, i) => {
    const k = i === 0 ? 1 : (i % 4 === 1 ? palmScale : fingerScale);
    return { x: p.x * k, y: p.y * k, z: p.z * k };
  });

  // tracker jitter: MediaPipe is good, not exact, and z is the noisiest
  const jitter = 0.022 * strength;
  return scaled.map(p => ({
    x: p.x + wrist.x + g() * jitter,
    y: p.y + wrist.y + g() * jitter,
    z: p.z + wrist.z + g() * jitter * 2.1
  }));
}
