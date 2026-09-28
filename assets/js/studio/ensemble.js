/* ================================================================
   MERCURY — the ensemble
   Three opinions on every frame, which is the point: each is wrong in
   a different way, and their disagreement is itself information.

     template  geometric distance to a reference signature.
               Instant, needs nothing loaded, and every decision can be
               explained in a sentence a person can check.

     neural    a 20k-parameter MLP over the canonical encoding.
               The most accurate of the three on hands like the ones it
               was trained on, and the least able to say when it is out
               of its depth.

     personal  nearest neighbours among this signer's own recorded
               hands, from Qdrant. Worth nothing until someone
               calibrates, and worth more than either of the others
               once they have — because it is the only one that has
               actually seen their hands.

   The personal vote comes over the network, so it cannot run at frame
   rate. It is queried on a timer and while the other two disagree,
   and the last answer is held in between.
   ================================================================ */
import { classify } from './asl.js';
import { encode } from './encode.js';
import { Neural } from './neural.js';

const KNN_INTERVAL = 220;      // ms between personal-vote queries
const KNN_TTL      = 900;      // ms a personal vote stays usable

export class Ensemble {
  constructor({ session = 'default' } = {}) {
    this.session = session;
    this.neural = new Neural();
    this.neuralReady = false;
    this.personalEnabled = false;
    this.calibrationCount = 0;

    this._knn = null;
    this._knnAt = 0;
    this._knnBusy = false;
    this._lastNeural = null;
    this._neuralAt = 0;

    this.weights = { template: 0.30, neural: 0.70, personal: 0.00 };
    this.stats = { neuralMs: 0, knnMs: 0, agree: 0 };
  }

  async init() {
    try {
      await this.neural.load();
      this.neuralReady = true;
    } catch (err) {
      // the template path alone still works; say so rather than break
      console.warn('[mercury] neural classifier unavailable:', err.message);
      this.weights = { template: 1, neural: 0, personal: 0 };
    }
    await this.refreshCalibration();
    return this;
  }

  async refreshCalibration() {
    try {
      const r = await fetch('/api/vectors/summary').then(x => x.json());
      this.calibrationCount = r.total || 0;
    } catch { this.calibrationCount = 0; }
    this._rebalance();
    return this.calibrationCount;
  }

  /* The personal vote earns its weight rather than being given it:
     a handful of samples barely counts, a full calibration dominates. */
  _rebalance() {
    const n = this.calibrationCount;
    this.personalEnabled = n >= 12;
    const personal = this.personalEnabled ? Math.min(0.45, 0.12 + n / 400) : 0;
    const rest = 1 - personal;
    if (this.neuralReady) {
      this.weights = { template: rest * 0.3, neural: rest * 0.7, personal };
    } else {
      this.weights = { template: rest, neural: 0, personal };
    }
  }

  _queryPersonal(vec, now) {
    if (!this.personalEnabled || this._knnBusy || now - this._knnAt < KNN_INTERVAL) return;
    this._knnBusy = true;
    const t0 = performance.now();
    fetch('/api/vectors/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vector: Array.from(vec), k: 9, session: this.session })
    })
      .then(r => r.json())
      .then(r => {
        this.stats.knnMs = performance.now() - t0;
        if (!r.ok || !r.neighbours?.length) { this._knn = null; return; }
        // distance-weighted vote; a neighbour at 0.6 similarity is not
        // evidence, so the floor is deliberately high
        const votes = new Map();
        let total = 0;
        for (const nb of r.neighbours) {
          if (nb.score < 0.72) continue;
          const w = (nb.score - 0.72) / 0.28;
          votes.set(nb.letter, (votes.get(nb.letter) || 0) + w);
          total += w;
        }
        this._knn = total > 0
          ? { votes, total, at: performance.now() }
          : null;
      })
      .catch(() => { this._knn = null; })
      .finally(() => { this._knnBusy = false; this._knnAt = performance.now(); });
  }

  /**
   * @returns {{letter, confidence, ranked, sources, agreement, note}}
   */
  async predict(lm, now = performance.now()) {
    const tpl = classify(lm);
    const vec = encode(lm);

    // Inference is 0.125 ms warm, so there is nothing to gain by caching
    // it across frames — and an earlier time-based cache silently reused a
    // previous hand's answer whenever two frames arrived close together.
    let neu = null;
    if (this.neuralReady) {
      const t0 = performance.now();
      neu = await this.neural.predict(lm);
      this.stats.neuralMs = performance.now() - t0;
      this._lastNeural = neu;
    }

    this._queryPersonal(vec, now);
    const knnFresh = this._knn && (performance.now() - this._knn.at) < KNN_TTL ? this._knn : null;

    /* ---- weighted vote across whichever sources are available ---- */
    const score = new Map();
    const add = (letter, amount) => score.set(letter, (score.get(letter) || 0) + amount);

    for (const r of tpl.ranked) add(r.letter, r.score * this.weights.template);
    if (neu) for (const r of neu.ranked) add(r.letter, r.score * this.weights.neural);
    if (knnFresh) {
      for (const [letter, w] of knnFresh.votes) {
        add(letter, (w / knnFresh.total) * this.weights.personal);
      }
    }

    const ranked = [...score.entries()]
      .map(([letter, s]) => ({ letter, score: s }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0] || { letter: tpl.letter, score: tpl.confidence };
    const next = ranked[1];

    // agreement between the independent opinions is a better honesty
    // signal than any single model's own confidence
    const picks = [tpl.letter, neu?.letter, knnFresh ? [...knnFresh.votes.entries()].sort((a,b)=>b[1]-a[1])[0][0] : null]
      .filter(Boolean);
    const agreement = picks.filter(p => p === best.letter).length / picks.length;
    this.stats.agree = agreement;

    const margin = next ? best.score - next.score : best.score;
    const confidence = Math.max(0, Math.min(1,
      best.score * 0.55 + Math.min(1, margin / 0.22) * 0.2 + agreement * 0.25));

    return {
      letter: best.letter,
      confidence,
      ranked: ranked.slice(0, 5).map(r => ({ letter: r.letter, score: Math.min(1, r.score) })),
      agreement,
      note: tpl.note,
      sources: {
        template: { letter: tpl.letter, confidence: tpl.confidence },
        neural: neu ? { letter: neu.letter, confidence: neu.confidence } : null,
        personal: knnFresh
          ? { letter: [...knnFresh.votes.entries()].sort((a,b)=>b[1]-a[1])[0][0],
              samples: knnFresh.votes.size }
          : null
      },
      encoded: vec
    };
  }
}
