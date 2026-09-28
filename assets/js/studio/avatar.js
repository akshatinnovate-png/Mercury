/* ================================================================
   MERCURY — the signing avatar
   A quicksilver figure that fingerspells, built in three.js.

   Why liquid metal rather than a person: a realistic human that is
   almost right is worse than no human at all, and a rigged photoreal
   model would have to be downloaded. Mercury is the god of quicksilver,
   so chrome is both on theme and honest about being a machine — and
   polished metal carries the hand's shape in its reflections, which is
   exactly what a viewer needs to read a handshape.

   The hand is the same 21-landmark rig the recogniser uses, so what the
   avatar signs is precisely what Mercury expects to see.
   ================================================================ */
import * as THREE from '/assets/vendor/three/three.module.js';
import { solve, mixPose, BONES, STRUT } from './rig.js';
import { SIGNS, REST } from './alphabet.js';
import { clamp, lerp, ease } from '../core/gfx.js';

/* rig space is screen space (y down, z away); three is y up, z toward us */
const toWorld = (p, s) => new THREE.Vector3(p.x * s, -p.y * s, -p.z * s);

const HAND = 0.155;          // rig unit -> metres
const TIPS = new Set([4, 8, 12, 16, 20]);

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.queue = [];
    this.i = 0;
    this.t = 0;
    this.playing = false;
    this.speed = 1;
    this.clock = 0;
    this.onLetter = () => {};
    this.orbit = { az: 0.22, el: 0.04, dist: 1.85, drag: false, px: 0, py: 0, focus: 'body' };
  }

  init() {
    if (this.ready) return this;
    const cv = this.canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);

    this._environment();
    this._lights();
    this._build();
    this._controls();

    this.ready = true;
    return this;
  }

  /* ---- reflections. Chrome without an environment is a black blob, so
     the studio it stands in is painted into a texture: bright above,
     dark floor, one soft key and one cool rim. ---- */
  _environment() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const x = c.getContext('2d');

    const sky = x.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0.00, '#e9eef8');
    sky.addColorStop(0.42, '#7d89a8');
    sky.addColorStop(0.52, '#2a2f3a');
    sky.addColorStop(1.00, '#05070c');
    x.fillStyle = sky; x.fillRect(0, 0, 512, 256);

    const key = x.createRadialGradient(150, 70, 4, 150, 70, 120);
    key.addColorStop(0, 'rgba(255,255,255,1)');
    key.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = key; x.fillRect(0, 0, 512, 256);

    const rim = x.createRadialGradient(400, 110, 4, 400, 110, 90);
    rim.addColorStop(0, 'rgba(176,200,240,.85)');
    rim.addColorStop(1, 'rgba(176,200,240,0)');
    x.fillStyle = rim; x.fillRect(0, 0, 512, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromEquirectangular(tex).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
    tex.dispose();
  }

  _lights() {
    this.scene.add(new THREE.AmbientLight(0x8a97ad, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-1.3, 1.9, 1.5);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xa8c4ee, 1.9);
    rim.position.set(1.7, 0.7, -1.4);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x6f7c93, 0.7);
    fill.position.set(0.6, -1.1, 1.1);
    this.scene.add(fill);
  }

  _metal(rough = 0.24, tint = 0xdfe6f2) {
    return new THREE.MeshPhysicalMaterial({
      color: tint, metalness: 1, roughness: rough,
      envMapIntensity: 1.45, clearcoat: 0.35, clearcoatRoughness: 0.25
    });
  }

  _build() {
    this.root = new THREE.Group();
    this.scene.add(this.root);

    const skin = this._metal(0.26);
    const dark = this._metal(0.42, 0x9aa6bb);

    /* ---- torso: a lathe gives a shoulder line a box never will ---- */
    const profile = [
      [0.020, -0.46], [0.150, -0.44], [0.175, -0.30], [0.168, -0.14],
      [0.180, 0.00], [0.205, 0.12], [0.215, 0.20], [0.150, 0.26], [0.055, 0.28]
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), skin);
    torso.scale.set(1, 1, 0.66);
    torso.position.y = 1.16;
    this.root.add(torso);
    this.torso = torso;

    /* ---- neck and head ---- */
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.07, 6, 20), skin);
    neck.position.y = 1.47;
    this.root.add(neck);

    const head = new THREE.Group();
    head.position.y = 1.60;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.098, 48, 40), skin);
    skull.scale.set(0.92, 1.12, 1.0);
    head.add(skull);
    // a smooth brow ridge and jaw suggest a face without attempting one
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.012, 12, 40, Math.PI), skin);
    brow.position.set(0, 0.022, 0.058);
    brow.rotation.set(-0.15, 0, 0);
    head.add(brow);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.062, 32, 24), skin);
    jaw.scale.set(0.95, 0.62, 0.92);
    jaw.position.set(0, -0.062, 0.016);
    head.add(jaw);
    this.root.add(head);
    this.head = head;

    /* ---- arms. The signing arm is posed once into a natural
       fingerspelling position; only the hand articulates. ---- */
    this.arm = this._arm(skin, dark, +1);
    this.armL = this._arm(skin, dark, -1, true);
    this.root.add(this.arm.group, this.armL.group);

    /* ---- the hand: the same rig the recogniser reads ---- */
    this.hand = this._hand(skin);
    this.arm.wrist.add(this.hand.group);

    /* ---- a soft ground shadow, so the figure is standing somewhere ---- */
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.695;
    this.root.add(disc);
  }

  /** One arm, posed. `side` is +1 for the signing (right) arm. */
  _arm(skin, dark, side, relaxed = false) {
    const group = new THREE.Group();
    group.position.set(0.205 * side, 1.36, 0);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.062, 32, 24), skin);
    group.add(shoulder);

    const upper = new THREE.Group();
    // a relaxed arm hangs; the signing arm comes up and forward
    upper.rotation.set(relaxed ? 0.08 : -0.72, 0, side * (relaxed ? 0.14 : 0.66));
    group.add(upper);

    const upperMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.20, 8, 24), skin);
    upperMesh.position.y = -0.135;
    upper.add(upperMesh);

    const elbow = new THREE.Group();
    elbow.position.y = -0.255;
    elbow.rotation.set(relaxed ? -0.16 : -1.38, 0, 0);
    upper.add(elbow);
    elbow.add(new THREE.Mesh(new THREE.SphereGeometry(0.043, 24, 20), dark));

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.19, 8, 24), skin);
    fore.position.y = -0.125;
    elbow.add(fore);

    const wrist = new THREE.Group();
    wrist.position.y = -0.235;
    elbow.add(wrist);
    wrist.add(new THREE.Mesh(new THREE.SphereGeometry(0.030, 20, 16), dark));

    return { group, upper, elbow, wrist };
  }

  /**
   * Build the hand once, then move its pieces each frame. Rebuilding
   * geometry per frame would be the obvious way and the slow one.
   */
  _hand(skin) {
    const group = new THREE.Group();
    // the rig is authored with the wrist at +y; rotate so it hangs off the arm
    group.rotation.set(Math.PI, 0, 0);

    const joints = [];
    for (let i = 0; i < 21; i++) {
      const r = i === 0 ? 0.026 : TIPS.has(i) ? 0.0125 : 0.0155;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), skin);
      group.add(m);
      joints.push(m);
    }

    const bones = BONES.map((_, i) => {
      const thick = STRUT.has(i) ? 0.020 : 0.0135;
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(thick, 1, 6, 16), skin);
      group.add(m);
      return m;
    });

    // a flattened sphere fills the space the bones only outline. A box was
    // the obvious choice and read as a plate: its corners caught the light
    // as hard edges no hand has.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), skin);
    palm.scale.set(1, 1, 0.055);
    group.add(palm);

    return { group, joints, bones, palm };
  }

  /** Place every piece of the hand for a solved pose. */
  _poseHand(P) {
    const { joints, bones, palm } = this.hand;
    const w = P.map(p => toWorld(p, HAND));
    // the rig puts the wrist below the origin; bring it to the joint
    const o = w[0].clone();
    for (const v of w) v.sub(o);

    joints.forEach((m, i) => m.position.copy(w[i]));

    BONES.forEach(([a, b], i) => {
      const A = w[a], B = w[b];
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const dir = B.clone().sub(A);
      const len = dir.length() || 1e-5;
      bones[i].position.copy(mid);
      bones[i].scale.set(1, Math.max(0.001, len), 1);
      bones[i].quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.divideScalar(len));
    });

    // span the palm across the knuckles and down to the wrist
    const across = w[17].clone().sub(w[5]);
    const down = w[0].clone().sub(w[9]);
    const c = new THREE.Vector3()
      .add(w[5]).add(w[17]).add(w[0]).add(w[9]).multiplyScalar(0.25);
    palm.position.copy(c);
    palm.scale.set(Math.max(0.02, across.length() * 1.04),
                   Math.max(0.02, down.length() * 1.10), 0.030);
    const n = across.clone().cross(down).normalize();
    const m4 = new THREE.Matrix4().makeBasis(
      across.clone().normalize(),
      down.clone().normalize(),
      n
    );
    palm.quaternion.setFromRotationMatrix(m4);
  }

  /* ---- drag to orbit, wheel to zoom ---- */
  _controls() {
    const cv = this.canvas;
    const down = e => {
      this.orbit.drag = true;
      this.orbit.px = e.clientX; this.orbit.py = e.clientY;
      cv.setPointerCapture?.(e.pointerId);
    };
    const move = e => {
      if (!this.orbit.drag) return;
      this.orbit.az += (e.clientX - this.orbit.px) * 0.006;
      this.orbit.el = clamp(this.orbit.el + (e.clientY - this.orbit.py) * 0.004, -0.5, 0.6);
      this.orbit.px = e.clientX; this.orbit.py = e.clientY;
    };
    const up = e => { this.orbit.drag = false; cv.releasePointerCapture?.(e.pointerId); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.orbit.dist = clamp(this.orbit.dist + e.deltaY * 0.0016, 0.7, 3.4);
    }, { passive: false });
  }

  load(text) {
    this.queue = [...String(text).toUpperCase()].map(ch => ({
      ch, pose: SIGNS[ch] || REST, known: !!SIGNS[ch]
    }));
    this.i = 0; this.t = 0;
    return this.queue.length;
  }

  play()  { if (this.queue.length) this.playing = true; }
  pause() { this.playing = false; }
  stop()  { this.playing = false; this.i = 0; this.t = 0; }
  get current() { return this.queue[this.i] || null; }

  update(dt) {
    if (!this.ready) return;
    this.clock += dt;

    if (this.playing && this.queue.length) {
      const dur = (this.current?.ch === ' ' ? 0.32 : 0.60) / this.speed;
      this.t += dt / dur;
      if (this.t >= 1) {
        this.t = 0; this.i++;
        if (this.i >= this.queue.length) { this.i = this.queue.length - 1; this.playing = false; }
        this.onLetter(this.current?.ch || '', this.i);
      }
    }

    const cur = this.queue[this.i]?.pose || REST;
    const nxt = this.queue[this.i + 1]?.pose || cur;
    // hold the shape, then move: a linear blend between letters reads as mush
    this._poseHand(solve(mixPose(cur, nxt, ease(clamp((this.t - 0.60) / 0.40)))));

    /* idle life: breathing, a little sway, the head tracking the camera */
    const b = Math.sin(this.clock * 1.15) * 0.006;
    this.torso.position.y = 1.16 + b;
    this.torso.rotation.z = Math.sin(this.clock * 0.42) * 0.012;
    this.head.position.y = 1.60 + b * 1.4;
    this.head.rotation.y = Math.sin(this.clock * 0.33) * 0.10 + this.orbit.az * 0.22;
    this.head.rotation.x = Math.sin(this.clock * 0.51) * 0.045 - 0.04;
    this.arm.upper.rotation.x = -0.72 + Math.sin(this.clock * 0.9) * 0.018;

    this._render();
  }

  _render() {
    const cv = this.canvas;
    const w = cv.clientWidth || 1, h = cv.clientHeight || 1;
    if (cv.width !== w * this.renderer.getPixelRatio() ||
        cv.height !== h * this.renderer.getPixelRatio()) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    const { az, el, dist } = this.orbit;
    // The hand moves with the arm pose, so a close view has to follow it
    // rather than aim at a position guessed once.
    const target = this.orbit.focus === 'hand'
      ? this.wristWorld()
      : new THREE.Vector3(0.13, 1.26, 0.04);
    this.camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  }

  /** Where the signing wrist actually is, in world space. */
  wristWorld() {
    const v = new THREE.Vector3();
    this.arm.wrist.getWorldPosition(v);
    return v;
  }

  /** @param focus 'body' frames the figure; 'hand' follows the wrist. */
  setView(az, el, dist, focus = 'body') {
    Object.assign(this.orbit, { az, el, dist, focus });
  }

  dispose() {
    this.renderer?.dispose();
    this.envMap?.dispose();
  }
}
