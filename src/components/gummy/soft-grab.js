/**
 * Soft radial grab.
 *
 * Tetrament's built-in drag pins exactly one vertex (`applyDrag` dispatches
 * `.compute(1)`) and yanks it at full strength. On a smooth high-resolution
 * surface that reads as a thin spike pulled out of the bear rather than jelly
 * stretching — the neighbouring material simply isn't told to follow.
 *
 * This is the same constraint spread over a neighbourhood: every vertex within
 * `radius` of the grabbed point moves toward the target, weighted by a smooth
 * falloff, so the pull tapers into the body the way a soft solid does.
 *
 * The neighbourhood is measured in REST space — the kernel reads the grabbed
 * vertex's own `initialPosition` as the centre — so the grip stays attached to
 * the same lump of material no matter how far the bear has moved, rotated or
 * deformed since. Measuring in world space would let the region slide off the
 * moment the body turned.
 */
import * as THREE from 'three/webgpu';
import { Fn, If, instanceIndex, uniform, int, float, length, vec4 } from 'three/tsl';

export class SoftGrab {
  /** @param {import('../../vendor/tetrament/index.js').SoftbodySimulation} simulation */
  constructor(simulation, options = {}) {
    this.simulation = simulation;
    this.vertexId = -1;
    this.active = false;

    const { vertexBuffer } = simulation.buffers;

    this.uniforms = {
      active: uniform(0, 'int'),
      vertexId: uniform(0, 'uint'),
      target: uniform(new THREE.Vector3()),
      radius: uniform(options.radius ?? 0.45),
      strength: uniform(options.strength ?? 0.35),
    };

    const u = this.uniforms;

    this.kernel = Fn(() => {
      If(u.active.equal(int(1)), () => {
        If(instanceIndex.lessThan(simulation.uniforms.vertexCount), () => {
          // Centre of the grab, in the body's undeformed frame.
          const centre = vertexBuffer.get(u.vertexId, 'initialPosition');
          const rest = vertexBuffer.get(instanceIndex, 'initialPosition');
          const d = length(rest.sub(centre)).toVar();

          If(d.lessThan(u.radius), () => {
            // Smoothstep-ish falloff: full pull at the grabbed point, zero and
            // flat at the rim, so there is no crease where the region ends.
            const t = float(1).sub(d.div(u.radius)).toVar();
            const w = t.mul(t).mul(float(3).sub(t.mul(2))).mul(u.strength).toVar();

            const position = vertexBuffer.get(instanceIndex, 'position').toVar();
            const prevPosition = vertexBuffer.get(instanceIndex, 'prevPosition').toVar();

            position.addAssign(u.target.sub(position).mul(w));

            // Bleed off half the velocity this introduced, matching the
            // library's drag, so releasing does not fling the body.
            const velocity = position.sub(prevPosition).toVar();
            prevPosition.assign(position.sub(velocity.mul(0.5)));

            vertexBuffer.get(instanceIndex, 'position').assign(position);
            vertexBuffer.get(instanceIndex, 'prevPosition').assign(prevPosition);
          });
        });
      });
    })().compute(simulation.vertexCount);
  }

  /** Runs the constraint. Call once per frame, after simulation.update(). */
  update() {
    if (!this.active) return;
    this.simulation.renderer.compute(this.kernel);
  }

  start(vertexId, target) {
    this.vertexId = vertexId;
    this.active = true;
    this.uniforms.active.value = 1;
    this.uniforms.vertexId.value = vertexId;
    this.uniforms.target.value.copy(target);
  }

  move(target) {
    if (!this.active) return;
    this.uniforms.target.value.copy(target);
  }

  end() {
    this.active = false;
    this.vertexId = -1;
    this.uniforms.active.value = 0;
  }

  set radius(v) { this.uniforms.radius.value = v; }
  set strength(v) { this.uniforms.strength.value = v; }
}

/**
 * Weak pull back to the spawn pose.
 *
 * The solver on its own is stable — an untouched body holds 1.455 x 2.134 for
 * as long as you leave it. Dragging is what does the damage: a sustained grab
 * walks the body toward the camera and leaves it permanently inflated, because
 * nothing in the solver remembers where the bear was supposed to be.
 *
 * This does. Every vertex is drawn a little way back toward its rest position
 * mapped through the spawn transform, which is exactly how the library's own
 * reset kernel defines home (`resetMatrix * initialPosition`). The pull is far
 * weaker than a grab, so the bear still stretches freely while held and simply
 * finds its way home afterwards.
 */
export class HomeSpring {
  constructor(simulation, options = {}) {
    this.simulation = simulation;
    this.enabled = options.enabled ?? true;

    const { vertexBuffer } = simulation.buffers;

    this.uniforms = {
      homeMatrix: uniform(new THREE.Matrix4()),
      strength: uniform(options.strength ?? 0.006),
    };
    const u = this.uniforms;

    this.kernel = Fn(() => {
      If(instanceIndex.lessThan(simulation.uniforms.vertexCount), () => {
        const rest = vertexBuffer.get(instanceIndex, 'initialPosition');
        const home = u.homeMatrix.mul(vec4(rest.xyz, 1)).xyz;

        const position = vertexBuffer.get(instanceIndex, 'position').toVar();
        const prevPosition = vertexBuffer.get(instanceIndex, 'prevPosition').toVar();

        const delta = home.sub(position).mul(u.strength).toVar();
        position.addAssign(delta);
        // Carry prevPosition along so the correction adds no velocity: this is
        // meant to be felt as memory of shape, not as a force.
        prevPosition.addAssign(delta);

        vertexBuffer.get(instanceIndex, 'position').assign(position);
        vertexBuffer.get(instanceIndex, 'prevPosition').assign(prevPosition);
      });
    })().compute(simulation.vertexCount);
  }

  /** @param {THREE.Matrix4} matrix the spawn transform the body should return to */
  setHome(matrix) {
    this.uniforms.homeMatrix.value.copy(matrix);
  }

  set strength(v) { this.uniforms.strength.value = v; }

  /** Call once per frame, after simulation.update(). */
  update() {
    if (!this.enabled) return;
    this.simulation.renderer.compute(this.kernel);
  }
}

/**
 * Pointer plumbing for SoftGrab: picks the nearest softbody vertex under the
 * cursor and drags it in the plane facing the camera.
 */
export class GrabControl {
  constructor(simulation, camera, domElement, grab, options = {}) {
    this.simulation = simulation;
    this.camera = camera;
    this.domElement = domElement;
    this.grab = grab;
    this.maxDistance = options.maxDistance ?? 0.35;
    this.enabled = true;

    // Touch gating. A finger swiping across the bear has to scroll the page,
    // so on touch the grab only arms after the finger has held still for
    // `touchHoldDelay`; moving more than `touchSlop` px first cancels it and
    // the browser keeps the gesture. A mouse has a real button, so it grabs
    // immediately. `touchHoldDelay: 0` restores the old behaviour.
    this.touchHoldDelay = options.touchHoldDelay ?? 0;
    this.touchSlop = options.touchSlop ?? 10;
    this._holdTimer = null;
    this._holdStart = null;

    // The canvas is a full-viewport background layer with pointer-events:none,
    // so it can never receive events itself — the page underneath has to stay
    // clickable. Listen on a target that sees everything (the window) and let
    // `shouldGrab` decide whether this particular point belongs to the bear.
    // `domElement` is still the geometry we measure rays against.
    this.eventTarget = options.eventTarget ?? domElement;
    this.shouldGrab = options.shouldGrab ?? (() => true);

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._plane = new THREE.Plane();
    this._hit = new THREE.Vector3();
    this._pending = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    this._onTouchMove = this._onTouchMove.bind(this);

    const t = this.eventTarget;
    t.addEventListener('pointerdown', this._onDown);
    t.addEventListener('pointermove', this._onMove);
    t.addEventListener('pointerup', this._onUp);
    t.addEventListener('pointercancel', this._onUp);
    // The non-passive touchmove is attached only for the duration of a grab.
    // Leaving one on the window permanently would make the browser wait on JS
    // before every scroll on every page — a real cost paid by the whole site
    // for a listener that does nothing 99% of the time.
  }

  /** Blocks scrolling and text selection for as long as the bear is held. */
  _beginGesture() {
    this.eventTarget.addEventListener('touchmove', this._onTouchMove, { passive: false });
    const b = document.body;
    this._prevUserSelect = b.style.userSelect;
    this._prevWebkitUserSelect = b.style.webkitUserSelect;
    b.style.userSelect = 'none';
    b.style.webkitUserSelect = 'none';
    // A drag that began as a press on the headline may already have started a
    // selection; drop it so the text does not flash highlighted mid-throw.
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }

  _endGesture() {
    this.eventTarget.removeEventListener('touchmove', this._onTouchMove);
    const b = document.body;
    b.style.userSelect = this._prevUserSelect ?? '';
    b.style.webkitUserSelect = this._prevWebkitUserSelect ?? '';
  }

  _cancelHold() {
    if (this._holdTimer !== null) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
    this._holdStart = null;
  }

  _ray(event) {
    const r = this.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      -((event.clientY - r.top) / r.height) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    return this._raycaster.ray;
  }

  _onDown(event) {
    if (!this.enabled || event.button !== 0 || this._pending) return;
    if (!this.shouldGrab(event)) return;

    if (event.pointerType === 'touch' && this.touchHoldDelay > 0) {
      this._cancelHold();
      this._holdStart = { x: event.clientX, y: event.clientY };
      this._holdTimer = setTimeout(() => {
        this._holdTimer = null;
        // Held still long enough that no scroll has begun — take the pointer.
        this.domElement.setPointerCapture?.(event.pointerId);
        this._pick(event);
      }, this.touchHoldDelay);
      return;
    }

    this._pick(event);
  }

  async _pick(event) {
    if (this._pending) return;
    const ray = this._ray(event);
    this._pending = true;
    // Vertex picking needs a GPU readback, so this resolves a frame or two later.
    const hit = await this.simulation.findNearestVertex(ray.origin, ray.direction, this.maxDistance);
    this._pending = false;
    if (!hit) return;

    this._plane.setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()).negate(),
      hit.position
    );
    this._beginGesture();
    this.grab.start(hit.vertexId, hit.position);
  }

  _onMove(event) {
    // Still waiting on the hold: any real movement means the user is scrolling.
    if (this._holdStart) {
      const dx = event.clientX - this._holdStart.x;
      const dy = event.clientY - this._holdStart.y;
      if (Math.hypot(dx, dy) > this.touchSlop) this._cancelHold();
    }
    if (!this.grab.active) return;
    const ray = this._ray(event);
    if (ray.intersectPlane(this._plane, this._hit)) this.grab.move(this._hit);
  }

  _onTouchMove(event) {
    if (this.grab.active) event.preventDefault();
  }

  _onUp() {
    this._cancelHold();
    if (this.grab.active) {
      this.grab.end();
      this._endGesture();
    }
  }

  dispose() {
    this._cancelHold();
    if (this.grab.active) this._endGesture();
    const t = this.eventTarget;
    t.removeEventListener('pointerdown', this._onDown);
    t.removeEventListener('pointermove', this._onMove);
    t.removeEventListener('pointerup', this._onUp);
    t.removeEventListener('pointercancel', this._onUp);
    this.grab.end();
  }
}
