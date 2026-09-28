/* ================================================================
   MERCURY — the learned classifier
   A 20,568-parameter MLP over the canonical pose encoding, trained on
   67,200 synthetic hands and run here through ONNX Runtime Web.

   Why a standard runtime for such a small graph: the .onnx file is a
   portable artifact. It can be retrained, inspected in any ONNX tool,
   or swapped for a much larger temporal model without a line of this
   file changing. The runtime is loaded lazily, so nothing pays for it
   until the studio actually starts recognising.

   Honest about what the accuracy number means: 99.6% is on held-out
   *synthetic* hands. The model has never seen a photograph. The
   calibration store is what closes that gap for a real signer.
   ================================================================ */
import { encode, ENCODE_DIM } from './encode.js';

const MODEL = '/assets/models/handshape.onnx';
const META  = '/assets/models/handshape.meta.json';

export class Neural {
  constructor() {
    this.ready = false;
    this.loading = null;
    this.session = null;
    this.letters = [];
    this.meta = null;
    this.backend = null;
    this.lastMs = 0;
  }

  /** Load once; concurrent callers share the same promise. */
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const ort = await import('/assets/vendor/ort/ort.wasm.min.mjs');
      const env = ort.env ?? ort.default?.env;
      const InferenceSession = ort.InferenceSession ?? ort.default?.InferenceSession;
      this.Tensor = ort.Tensor ?? ort.default?.Tensor;

      env.wasm.wasmPaths = '/assets/vendor/ort/';
      // one thread keeps this off the critical path and avoids needing
      // cross-origin isolation for SharedArrayBuffer
      env.wasm.numThreads = 1;
      env.wasm.simd = true;
      env.logLevel = 'error';

      this.meta = await fetch(META).then(r => r.json());
      this.letters = this.meta.letters;
      if (this.meta.dim !== ENCODE_DIM) {
        throw new Error(`model expects ${this.meta.dim} dims, encoder produces ${ENCODE_DIM}`);
      }
      this.session = await InferenceSession.create(MODEL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      this.backend = 'wasm';
      this.ready = true;
      return this;
    })().catch(err => {
      this.loading = null;                 // allow a retry
      throw err;
    });
    return this.loading;
  }

  /**
   * @returns {{letter, confidence, ranked:[{letter,score}], probs:Float32Array}|null}
   */
  async predict(lm) {
    if (!this.ready) return null;
    const t0 = performance.now();
    const input = new this.Tensor('float32', encode(lm), [1, ENCODE_DIM]);
    const out = await this.session.run({ input });
    const probs = out.probs.data;
    this.lastMs = performance.now() - t0;

    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;

    const ranked = Array.from(probs)
      .map((score, i) => ({ letter: this.letters[i], score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { letter: this.letters[best], confidence: probs[best], ranked, probs };
  }
}
