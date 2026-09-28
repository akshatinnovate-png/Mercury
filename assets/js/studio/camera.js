/* ================================================================
   MERCURY — camera and hand tracking
   Wraps MediaPipe's HandLandmarker: device enumeration, permission
   handling, the detection loop, and a clear state for every way this
   can fail. Everything is vendored, so no network is involved and no
   frame ever leaves the machine.
   ================================================================ */

const WASM_PATH  = '/assets/vendor/mp/wasm';
const MODEL_PATH = '/assets/models/hand_landmarker.task';

export const STATE = {
  IDLE: 'idle', LOADING: 'loading', READY: 'ready',
  DENIED: 'denied', NO_CAMERA: 'no-camera', ERROR: 'error'
};

export class Tracker {
  constructor({ onState, onResult } = {}) {
    this.onState = onState || (() => {});
    this.onResult = onResult || (() => {});
    this.state = STATE.IDLE;
    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.mirror = true;
    this.deviceId = null;
    this.fps = 0;
    this._frames = 0;
    this._fpsAt = 0;
  }

  _set(state, detail) {
    this.state = state;
    this.onState(state, detail);
  }

  /** Cameras need a permission grant before labels are readable. */
  async devices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'videoinput');
  }

  async start(video, { deviceId } = {}) {
    this.video = video;
    if (deviceId) this.deviceId = deviceId;

    if (!window.isSecureContext) {
      return this._set(STATE.ERROR,
        'The camera needs a secure context. Use http://localhost rather than an IP address.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return this._set(STATE.NO_CAMERA, 'This browser has no camera API.');
    }

    this._set(STATE.LOADING, 'Loading the hand model…');
    try {
      if (!this.landmarker) this.landmarker = await this._loadModel();
    } catch (err) {
      return this._set(STATE.ERROR, `Could not load the hand model. ${err.message}`);
    }

    this._set(STATE.LOADING, 'Asking for the camera…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : { facingMode: 'user' }),
          width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }
        },
        audio: false
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        return this._set(STATE.DENIED,
          'Camera access was refused. Allow it in the address bar, then press start again.');
      }
      if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        return this._set(STATE.NO_CAMERA, 'No camera was found on this device.');
      }
      if (err.name === 'NotReadableError') {
        return this._set(STATE.ERROR, 'The camera is already in use by another application.');
      }
      return this._set(STATE.ERROR, err.message || String(err));
    }

    video.srcObject = this.stream;
    await video.play().catch(() => {});
    await new Promise(res => {
      if (video.readyState >= 2) return res();
      video.onloadeddata = res;
    });

    this.running = true;
    this._set(STATE.READY);
    this._loop();
  }

  async _loadModel() {
    const { FilesetResolver, HandLandmarker } =
      await import('/assets/vendor/mp/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    }).catch(async () => {
      // Some machines have no working WebGL for the GPU delegate.
      const fs = await FilesetResolver.forVisionTasks(WASM_PATH);
      return HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2
      });
    });
  }

  _loop = () => {
    if (!this.running) return;
    const v = this.video;
    if (v && v.currentTime !== this.lastVideoTime && v.readyState >= 2) {
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      try {
        const res = this.landmarker.detectForVideo(v, now);
        this._frames++;
        if (now - this._fpsAt > 500) {
          this.fps = Math.round(this._frames * 1000 / (now - this._fpsAt));
          this._frames = 0; this._fpsAt = now;
        }
        this.onResult(this._shape(res), now);
      } catch { /* a dropped frame is not worth stopping for */ }
    }
    requestAnimationFrame(this._loop);
  };

  /** Normalise MediaPipe's output, and mirror left hands onto the right-hand
      convention the recogniser's templates were built in. */
  _shape(res) {
    const hands = [];
    const lms = res?.landmarks || [];
    for (let i = 0; i < lms.length; i++) {
      const handedness = res.handednesses?.[i]?.[0]?.categoryName || 'Right';
      // the video is mirrored for the user, so MediaPipe's label is flipped
      const shown = this.mirror ? (handedness === 'Left' ? 'Right' : 'Left') : handedness;
      const raw = lms[i];
      const lm = shown === 'Left'
        ? raw.map(p => ({ x: 1 - p.x, y: p.y, z: p.z }))   // mirror to right-hand form
        : raw.map(p => ({ x: p.x, y: p.y, z: p.z }));
      hands.push({ lm, raw, handedness: shown, score: res.handednesses?.[i]?.[0]?.score ?? 1 });
    }
    return { hands };
  }

  setMirror(on) { this.mirror = on; }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this._set(STATE.IDLE);
  }
}
