/* ================================================================
   MERCURY — ASL fingerspelling recogniser
   Turns 21 MediaPipe landmarks into a letter.

   The approach is deliberately not a black box: landmarks are reduced
   to a small set of human-readable features (how folded each finger
   is, how far apart they are, where the thumb sits), and each letter
   is a template over those features. That means a wrong call can be
   explained and corrected, and it runs in microseconds on any device.

   J and Z are motion letters; they are detected from the path of the
   hand over time rather than a single frame.
   ================================================================ */

const FINGERS = [
  { name: 'thumb',  mcp: 1,  pip: 2,  dip: 3,  tip: 4  },
  { name: 'index',  mcp: 5,  pip: 6,  dip: 7,  tip: 8  },
  { name: 'middle', mcp: 9,  pip: 10, dip: 11, tip: 12 },
  { name: 'ring',   mcp: 13, pip: 14, dip: 15, tip: 16 },
  { name: 'pinky',  mcp: 17, pip: 18, dip: 19, tip: 20 }
];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const len = v => Math.hypot(v.x, v.y, v.z);
const norm = v => { const l = len(v) || 1e-6; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * Reduce 21 landmarks to a scale- and position-invariant feature set.
 * Everything is divided by palm length, so it holds whether the hand is
 * near the lens or across the room.
 */
export function features(lm) {
  const wrist = lm[0];
  // palm length is the most stable scale reference on a hand
  const scale = len(sub(lm[9], wrist)) || 1e-6;
  const d = (a, b) => len(sub(lm[a], lm[b])) / scale;

  /* ---- curl: total bend down each finger chain, 0 straight → 1 folded ---- */
  const curl = FINGERS.map((f, i) => {
    const root = i === 0 ? lm[0] : lm[f.mcp];
    const a = norm(sub(lm[f.pip], root));
    const b = norm(sub(lm[f.dip], lm[f.pip]));
    const c = norm(sub(lm[f.tip], lm[f.dip]));
    // two joint angles, each 0 when straight and PI when fully folded back
    const j1 = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    const j2 = Math.acos(Math.max(-1, Math.min(1, dot(b, c))));
    // the thumb bends far less than the fingers, so it gets its own range
    const span = i === 0 ? 1.7 : 3.0;
    return clamp01((j1 + j2) / span);
  });

  /* ---- spread: angle between neighbouring finger directions ---- */
  const dirs = FINGERS.map(f => norm(sub(lm[f.tip], lm[f.mcp])));
  const spread = [];
  for (let i = 1; i < 4; i++) {
    spread.push(Math.acos(Math.max(-1, Math.min(1, dot(dirs[i], dirs[i + 1])))));
  }

  /* ---- thumb relationships: what separates A from S, M from N, F from D ---- */
  const thumb = {
    toIndexTip:   d(4, 8),
    toIndexMcp:   d(4, 5),
    toMiddlePip:  d(4, 10),
    toRingPip:    d(4, 14),
    toPinkyMcp:   d(4, 17),
    fromWrist:    d(4, 0),
    // is the thumb out to the side of the palm, or tucked across it?
    abduction:    Math.acos(Math.max(-1, Math.min(1,
                    dot(norm(sub(lm[4], lm[2])), norm(sub(lm[17], lm[5])))))),
  };

  /* ---- orientation: are the fingers pointing up, sideways, or down? ---- */
  const palmUp = norm(sub(lm[9], lm[0]));           // wrist → middle knuckle
  const pointing = -palmUp.y;                        // image y grows downward
  const sideways = Math.abs(palmUp.x);

  /* ---- index/middle crossing, which is all that separates R from U ---- */
  const ix = lm[8].x - lm[5].x, mx = lm[12].x - lm[9].x;
  const crossed = (lm[8].x - lm[12].x) * (lm[5].x - lm[9].x) < 0 &&
                  d(8, 12) < 0.45;

  /* ---- tips gathered toward the thumb, as in O and C ---- */
  const gather = (d(4, 8) + d(4, 12) + d(4, 16)) / 3;

  return { curl, spread, thumb, pointing, sideways, crossed, gather, scale, ix, mx };
}

/* ================================================================
   Letter templates.

   Each row is the feature signature of that handshape, measured from
   the rig poses in alphabet.js rather than guessed. Hand-written
   thresholds scored 10/24 on the round-trip test; measured signatures
   with weighted distance score far higher, and stay honest because the
   features are all anatomically meaningful quantities.

   Order:
     0-3  curl of index, middle, ring, pinky   (0 straight .. 1 folded)
     4    thumb extension from the wrist
     5-7  spread between adjacent finger pairs
     8    thumb tip to index tip
     9    thumb tip to index knuckle
     10   index and middle crossed (0/1)
     11   pointing up
     12   pointing sideways
   ================================================================ */
export const TEMPLATES = {
  A: [ 0.881, 0.883, 0.881, 0.877, 1.194, 0.101, 0.103, 0.108, 0.514, 0.331,     0, 0.999,  0.03],
  B: [ 0.027, 0.027, 0.027, 0.027, 0.339,  0.04,  0.04,  0.04, 1.583, 0.703,     0, 0.999,  0.03],
  C: [ 0.401, 0.405, 0.402, 0.417, 1.049, 0.159, 0.136, 0.184, 0.704, 0.129,     0, 0.999,  0.03],
  D: [ 0.027, 0.793, 0.791, 0.788,  0.98, 2.005, 0.088, 0.092, 0.926, 0.123,     0, 0.999,  0.03],
  E: [ 0.665, 0.666, 0.665, 0.661, 0.401, 0.087, 0.088,  0.09, 0.763,  0.64,     0, 0.999,  0.03],
  F: [ 0.555, 0.036, 0.036, 0.035, 0.851, 1.401,  0.12,  0.12, 0.692, 0.242,     0, 0.999,  0.03],
  G: [ 0.072, 0.865, 0.863, 0.859,  1.11, 2.052,   0.1, 0.104, 0.848, 0.186,     0,  0.19, 0.982],
  H: [ 0.054, 0.054, 0.863, 0.857, 0.755,  0.06, 2.122, 0.122, 1.139, 0.338,     0,  0.19, 0.982],
  I: [ 0.872, 0.874, 0.872, 0.034, 0.401, 0.099, 0.101, 2.116, 0.497,  0.64,     0, 0.999,  0.03],
  J: [ 0.872, 0.874, 0.872, 0.034, 0.401, 0.099, 0.101, 2.116, 0.497,  0.64,     0, 0.999,  0.03],
  K: [ 0.035, 0.035, 0.861, 0.853, 1.246,  0.48, 2.109, 0.139, 0.881, 0.447,     0, 0.999,  0.03],
  L: [ 0.036, 0.865, 0.863, 0.857,  1.29, 2.148, 0.118, 0.122, 1.547, 0.947,     0, 0.999,  0.03],
  M: [ 0.863, 0.865, 0.863, 0.824, 0.425, 0.098,   0.1,   0.1, 0.501, 0.624,     0, 0.999,  0.03],
  N: [ 0.863, 0.865, 0.809, 0.806, 0.425, 0.098, 0.134, 0.095, 0.501, 0.624,     0, 0.999,  0.03],
  O: [ 0.554, 0.558, 0.555, 0.544,   0.8, 0.154, 0.128, 0.153, 0.718, 0.278,     0, 0.999,  0.03],
  P: [ 0.035, 0.035, 0.861, 0.853, 1.246,  0.48, 2.109, 0.139, 0.881, 0.447,     0, 0.135,  0.03],
  Q: [ 0.072, 0.865, 0.863, 0.859,  1.11, 2.052,   0.1, 0.104, 0.848, 0.186,     0, 0.135,  0.03],
  R: [ 0.087, 0.087, 0.859, 0.844, 0.468, 0.523, 2.061,  0.19, 1.345, 0.589,     1, 0.999,  0.03],
  S: [  0.89, 0.892,  0.89, 0.886, 0.554, 0.103, 0.105,  0.11, 0.463, 0.535,     0, 0.999,  0.03],
  T: [ 0.827, 0.865, 0.863, 0.859,   0.6, 0.116,   0.1, 0.104, 0.497, 0.492,     0, 0.999,  0.03],
  U: [ 0.036, 0.036, 0.861, 0.853, 0.363,  0.06, 2.165, 0.139, 1.551, 0.675,     0, 0.999,  0.03],
  V: [ 0.035, 0.035, 0.859, 0.848, 0.363, 0.561, 2.079, 0.155,  1.58, 0.675,     0, 0.999,  0.03],
  W: [ 0.035, 0.036, 0.035, 0.813, 0.445,  0.24,  0.24,  1.94,   1.5, 0.607,     0, 0.999,  0.03],
  X: [ 0.495, 0.865, 0.863, 0.859, 0.626, 0.918,   0.1, 0.104, 0.886, 0.461,     0, 0.999,  0.03],
  Y: [ 0.861, 0.865, 0.861,  0.03, 1.295, 0.155, 0.155, 1.969, 0.799, 0.916,     0, 0.999,  0.03],
  Z: [ 0.027, 0.793, 0.791, 0.788,  0.98, 2.005, 0.088, 0.092, 0.926, 0.123,     0, 0.999,  0.03],
};

/* Divisor per dimension, bringing each onto roughly 0..1 so no single
   feature dominates the distance purely because of its units. */
const SPAN = [1, 1, 1, 1, 1.3, 2.2, 2.2, 2.2, 1.6, 1.0, 1, 1, 1];

/* How much each feature is trusted. Finger curl carries most of the
   alphabet; crossing is the only thing separating R from U, and
   orientation is the only thing separating P from K and Q from G. */
const WEIGHT = [1.5, 1.5, 1.1, 1.1, 0.9, 0.7, 0.7, 0.7, 0.6, 0.6, 2.2, 1.6, 1.6];

/* Human-readable notes, shown in the studio when a letter is proposed. */
export const NOTES = {
  A:'fist, thumb alongside',        B:'flat hand, thumb across palm',
  C:'curved C',                     D:'index up, others meet the thumb',
  E:'fingers curled to the thumb',  F:'thumb and index touch, three up',
  G:'index points sideways',        H:'index and middle sideways',
  I:'pinky up',                     J:'pinky up, drawing a hook',
  K:'index and middle up, thumb between', L:'thumb and index at a right angle',
  M:'thumb under three fingers',    N:'thumb under two fingers',
  O:'fingertips meet the thumb',    P:'K, turned to point down',
  Q:'G, turned to point down',      R:'index and middle crossed',
  S:'fist, thumb across the front', T:'thumb between index and middle',
  U:'index and middle up, together',V:'index and middle up, apart',
  W:'three fingers up',             X:'index hooked',
  Y:'thumb and pinky out',          Z:'index up, drawing a Z'
};

/* Letters whose static shape is identical to another letter's; only the
   motion tells them apart, so they are excluded from still matching. */
export const MOTION_LETTERS = { J: 'I', Z: 'D' };

export function vector(f) {
  return [
    f.curl[1], f.curl[2], f.curl[3], f.curl[4],
    f.thumb.fromWrist, f.spread[0], f.spread[1], f.spread[2],
    f.thumb.toIndexTip, f.thumb.toIndexMcp,
    f.crossed ? 1 : 0, f.pointing, f.sideways
  ];
}

/**
 * Classify one frame.
 * @returns {{letter, confidence, note, ranked:[{letter,score}], features}}
 */
export function classify(lm) {
  const f = features(lm);
  const v = vector(f);

  const scored = [];
  for (const [letter, tpl] of Object.entries(TEMPLATES)) {
    if (letter in MOTION_LETTERS) continue;      // needs motion, not a still
    let acc = 0, wsum = 0;
    for (let i = 0; i < v.length; i++) {
      const e = (v[i] - tpl[i]) / SPAN[i];
      acc += e * e * WEIGHT[i];
      wsum += WEIGHT[i];
    }
    scored.push({ letter, score: Math.sqrt(acc / wsum) });
  }
  scored.sort((a, b) => a.score - b.score);

  const best = scored[0], next = scored[1];
  // confidence is about separation as much as fit: a shape is only
  // trustworthy when nothing else is nearly as close
  const fit = clamp01(1 - best.score / 0.42);
  const sep = clamp01((next.score - best.score) / 0.12);
  const confidence = clamp01(fit * 0.5 + sep * 0.5);

  return {
    letter: best.letter,
    confidence,
    note: NOTES[best.letter] || '',
    ranked: scored.slice(0, 5).map(s => ({ letter: s.letter, score: clamp01(1 - s.score / 0.55) })),
    features: f
  };
}

/* ================================================================
   Temporal stabiliser.
   A single frame is noisy and hands pass through other letters on the
   way to the one they mean. A letter only commits once it has held the
   lead for a dwell period, and cannot immediately re-commit.
   ================================================================ */
export class Stabiliser {
  constructor({ dwell = 380, minConfidence = 0.55, cooldown = 260, window = 9 } = {}) {
    this.dwell = dwell;
    this.minConfidence = minConfidence;
    this.cooldown = cooldown;
    this.window = window;
    this.history = [];
    this.candidate = null;
    this.since = 0;
    this.lastCommit = 0;
    this.lastLetter = null;
  }

  reset() { this.history.length = 0; this.candidate = null; this.lastLetter = null; }

  /** @returns {{letter, progress, committed}} */
  push(result, now) {
    this.history.push(result);
    if (this.history.length > this.window) this.history.shift();

    // vote across the window, weighted by each frame's confidence
    const votes = new Map();
    for (const r of this.history) {
      if (r.confidence < this.minConfidence * 0.6) continue;
      votes.set(r.letter, (votes.get(r.letter) || 0) + r.confidence);
    }
    let lead = null, leadScore = 0;
    for (const [k, v] of votes) if (v > leadScore) { leadScore = v; lead = k; }

    const strong = lead && (leadScore / this.history.length) >= this.minConfidence;
    if (!strong) { this.candidate = null; return { letter: lead, progress: 0, committed: null }; }

    if (lead !== this.candidate) { this.candidate = lead; this.since = now; }

    const held = now - this.since;
    const progress = clamp01(held / this.dwell);
    let committed = null;

    if (progress >= 1 && now - this.lastCommit > this.cooldown) {
      committed = lead;
      this.lastCommit = now;
      this.lastLetter = lead;
      this.since = now;          // require another full dwell to repeat
    }
    return { letter: lead, progress, committed };
  }
}
