/* ================================================================
   MERCURY — non-manual markers
   The part of sign language that is not on the hands.

   ASL grammar lives in the face and the body. Raised brows turn a
   statement into a yes/no question. Furrowed brows mark a wh-question.
   A head tilt marks a conditional. Where a sign is made — at the
   forehead, the chin, the chest — changes what it means. A system that
   reads only handshape is reading about half the language.

   This tracks face and pose alongside the hands and turns them into a
   small set of labelled grammatical signals, which are then given to
   the language model as context. It is a beginning, not the whole of
   non-manual grammar, and the studio says so.
   ================================================================ */

const WASM_PATH = '/assets/vendor/mp/wasm';

/* MediaPipe face mesh indices, from the canonical 478-point topology. */
const FACE = {
  browInnerL: 105, browOuterL: 46, eyeTopL: 159, eyeBotL: 145, eyeOuterL: 33,
  browInnerR: 334, browOuterR: 276, eyeTopR: 386, eyeBotR: 374, eyeOuterR: 263,
  lipTop: 13, lipBot: 14, lipL: 61, lipR: 291,
  noseTip: 1, chin: 152, foreheadTop: 10
};

/* Pose landmarks that bound the signing space. */
const POSE = { nose: 0, shoulderL: 11, shoulderR: 12, hipL: 23, hipR: 24 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

export class Holistic {
  constructor() {
    this.face = null;
    this.pose = null;
    this.ready = false;
    this.loading = null;
    this.enabled = false;
    this.lastFace = null;
    this.lastPose = null;
    /* Resting measurements, captured the first second a face is seen.
       Brow height only means something relative to that person's neutral. */
    this.baseline = { brow: null, mouth: null, samples: 0 };
  }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const { FilesetResolver, FaceLandmarker, PoseLandmarker } =
        await import('/assets/vendor/mp/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks(WASM_PATH);

      this.face = await FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/assets/models/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: true
      });
      this.pose = await PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/assets/models/pose_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 1
      });
      this.ready = true;
      this.enabled = true;
      return this;
    })().catch(err => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  /** Run both models on the current video frame. Cheap to call at a
      lower rate than the hand tracker — grammar changes slower than
      handshape does. */
  detect(video, ts) {
    if (!this.ready || !this.enabled) return null;
    try {
      const f = this.face.detectForVideo(video, ts);
      const p = this.pose.detectForVideo(video, ts);
      this.lastFace = f?.faceLandmarks?.[0] || null;
      this.lastPose = p?.landmarks?.[0] || null;
      this.blendshapes = f?.faceBlendshapes?.[0]?.categories || null;
      return this.read();
    } catch { return null; }
  }

  /** Turn raw landmarks into grammatical signals. */
  read() {
    const fm = this.lastFace;
    if (!fm) return null;

    // scale everything by face height so distance from the lens cancels
    const faceH = dist(fm[FACE.foreheadTop], fm[FACE.chin]) || 1e-6;

    const browL = dist(fm[FACE.browInnerL], fm[FACE.eyeTopL]) / faceH;
    const browR = dist(fm[FACE.browInnerR], fm[FACE.eyeTopR]) / faceH;
    const brow = (browL + browR) / 2;

    const mouthOpen = dist(fm[FACE.lipTop], fm[FACE.lipBot]) / faceH;
    const mouthWide = dist(fm[FACE.lipL], fm[FACE.lipR]) / faceH;

    // head tilt from the line between the eyes
    const tilt = Math.atan2(
      fm[FACE.eyeOuterR].y - fm[FACE.eyeOuterL].y,
      fm[FACE.eyeOuterR].x - fm[FACE.eyeOuterL].x
    );

    // learn this face's neutral before judging anything against it
    if (this.baseline.samples < 45) {
      const s = this.baseline.samples;
      this.baseline.brow = this.baseline.brow == null ? brow : (this.baseline.brow * s + brow) / (s + 1);
      this.baseline.mouth = this.baseline.mouth == null ? mouthOpen : (this.baseline.mouth * s + mouthOpen) / (s + 1);
      this.baseline.samples++;
    }

    const browDelta = this.baseline.brow ? (brow - this.baseline.brow) / this.baseline.brow : 0;

    /* ---- the grammatical reading ---- */
    const raised = browDelta > 0.11;
    const furrowed = browDelta < -0.10;
    const tilted = Math.abs(tilt) > 0.11;

    let marker = null, meaning = null;
    if (raised) {
      marker = 'brow-raise';
      meaning = 'yes/no question';
    } else if (furrowed) {
      marker = 'brow-furrow';
      meaning = 'wh-question (who, what, where, why)';
    } else if (tilted) {
      marker = 'head-tilt';
      meaning = 'conditional or topic';
    }

    return {
      marker, meaning,
      brow: +browDelta.toFixed(3),
      mouthOpen: +mouthOpen.toFixed(3),
      mouthWide: +mouthWide.toFixed(3),
      tilt: +tilt.toFixed(3),
      calibrated: this.baseline.samples >= 45,
      zone: this.zone()
    };
  }

  /**
   * Which region of the signing space the dominant hand occupies.
   * In ASL this is not decoration: the same handshape means different
   * things at the forehead and at the chest.
   */
  zone(handY) {
    const p = this.lastPose;
    if (!p || handY == null) return null;
    const nose = p[POSE.nose];
    const shoulder = (p[POSE.shoulderL].y + p[POSE.shoulderR].y) / 2;
    const hip = (p[POSE.hipL].y + p[POSE.hipR].y) / 2;
    const head = nose.y - (shoulder - nose.y) * 0.55;

    if (handY < head) return 'above head';
    if (handY < nose.y) return 'forehead';
    if (handY < shoulder) return 'face';
    if (handY < shoulder + (hip - shoulder) * 0.45) return 'chest';
    if (handY < hip) return 'torso';
    return 'below waist';
  }

  /** A line of context for the language model, or null when there is nothing to say. */
  asPrompt(signals) {
    if (!signals?.marker) return null;
    return `The signer's face showed ${signals.marker.replace('-', ' ')}, which in ASL marks a ${signals.meaning}.`;
  }

  stop() { this.enabled = false; }
}
