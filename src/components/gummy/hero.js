/**
 * The gummy bear as a site background layer.
 *
 * This is the production entry: no gui, no orbit controls, no debug affordances.
 * The canvas is a fixed, full-viewport layer that renders *both* the palette
 * gradient and the bear, and the CSS `.color-field` is hidden while it is up.
 *
 * Why the gradient moves into WebGL: three.js transmission refracts what was
 * rendered into the scene, not the DOM behind the canvas. On a transparent
 * canvas the bear would sample an empty backbuffer and read as grey and broken
 * instead of glassy. Painting the gradient in-scene gives the refraction
 * something real to bend, and as a bonus the bear picks up the palette as it
 * changes down the page. Covering the full viewport (rather than just the hero
 * box) is what keeps the canvas edge from showing as a seam against the CSS
 * gradient.
 *
 * Mount lazily — the caller should only import this module once WebGPU is
 * known to be present, so `three` stays out of the main bundle.
 */
import * as THREE from 'three/webgpu';
import { Fn, uv, uniform, vec3, vec4, float, smoothstep, texture } from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  SoftbodySimulation,
  tetrahedralize,
  loadModelFromGeometry,
} from '../../vendor/tetrament/index.js';

import { SoftGrab, GrabControl, HomeSpring } from './soft-grab.js';
import {
  loadBearGeometry,
  buildCage,
  bindSurfaceToTets,
  bakeThickness,
} from './bear-geometry.js';
import { applyGlassMaterial, setupStudio, GUMMY_PRESETS } from './material.js';
import { HeroText } from './hero-text.js';

/** Coarser physics on phones: fewer tets and fewer solver steps. */
const MOBILE = {
  physicsDetail: 16,
  resolution: 5,
  stepsPerSecond: 320,
  pixelRatio: 1.5,
  // Share of the viewport's width the bear should occupy, and how far toward
  // the edge it sits. A phone is tall and narrow: at the desktop framing the
  // same camera distance made the bear fill ~73% of the width and swallow the
  // opening paragraph, so it is framed smaller and kept nearer the centre.
  widthFraction: 0.66,
  heightFraction: 0.52,
  sideBias: 0.34,
};
const DESKTOP = {
  physicsDetail: 22,
  resolution: 6,
  stepsPerSecond: 640,
  pixelRatio: 2,
  widthFraction: 0.56,
  heightFraction: 0.60,
  sideBias: 0.62,
};

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n, fallback) => {
    const v = cs.getPropertyValue(n).trim();
    return v || fallback;
  };
  return {
    bg: get('--bg', '#8fb0b5'),
    tints: [
      get('--t1', '#a9acb4'),
      get('--t2', '#8b98ab'),
      get('--t3', '#7a9fa8'),
      get('--t4', '#a09b9e'),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

export async function mountGummyHero(container, options = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;

  // Tablets take the light profile too. At 767px a 768-wide iPad fell through
  // to the desktop settings — 22 cage cells, 640 solver steps a second and a
  // 2x buffer — which is far more than a tablet GPU should be asked for.
  const isMobile = window.matchMedia('(max-width: 1023px)').matches;
  const profile = isMobile ? MOBILE : DESKTOP;
  const preset = GUMMY_PRESETS[options.preset ?? 'amber'];

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  // The camera looks straight ahead, never down. Aiming it below the body's
  // centre lifted the bear in frame, but it also tilted it: a downward view
  // foreshortens the head and the bear reads as leaning forward. Keeping the
  // target level with the camera removes the tilt entirely, and vertical
  // placement is set by the camera's own height instead — raise it and the bear
  // sits lower in frame.
  const baseCameraY = 1.62;
  const lookY = baseCameraY;
  camera.position.set(0, baseCameraY, 5.4);
  camera.lookAt(0, lookY, 0);

  // The bear sits on the side of the frame the text runs away from: the left
  // in Hebrew (RTL), the right in English. Panning the camera rather than
  // moving the body keeps physics and picking in the same world space — the
  // vertex buffers are world coordinates and know nothing about a transform on
  // simulation.object.
  // Read on every layout pass, not captured once. Astro swaps pages with the
  // ClientRouter, and a value latched at mount left the bear on the Hebrew side
  // of an English page (and vice versa) after switching language.
  const isRtl = () => (document.documentElement.dir || 'ltr').toLowerCase() === 'rtl';
  // Fraction of the visible half-width to push it by. Positive camera x moves
  // the bear left on screen, so RTL takes the positive sign.
  const sideBias = options.sideBias ?? profile.sideBias;

  // Transparent: the canvas stacks ABOVE the page headline, so everywhere the
  // bear is not it has to let the page through.
  const renderer = new THREE.WebGPURenderer({ antialias: !isMobile, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatio));
  // Nothing receives a shadow — the floor is hidden so the bear reads as
  // floating on the gradient — so the shadow pass would be pure cost.
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  try {
    await Promise.race([
      renderer.init(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WebGPU init timed out')), 10000)
      ),
    ]);
  } catch {
    canvas.remove();
    return null;
  }
  if (!renderer.backend?.isWebGPUBackend) {
    canvas.remove();
    renderer.dispose();
    return null;
  }

  /* -------------------- gradient backdrop -------------------- */

  const pal = readPalette();
  const uBg = uniform(new THREE.Color(pal.bg));
  const uTints = pal.tints.map((c) => uniform(new THREE.Color(c)));
  const uAspect = uniform(1);
  const uTextColor = uniform(new THREE.Color(0xffffff));

  // Four soft radial blobs over a base colour — the same construction as
  // ColorField.astro. This is no longer drawn as geometry: it is the function
  // the glass refracts, so the bear shows the page's own gradient bent through
  // it while the canvas itself stays transparent.
  const BLOBS = [
    [0.02, 1.02],
    [0.98, 1.06],
    [0.12, -0.06],
    [0.9, -0.02],
  ];

  /** @param {*} p screen uv -> the page's background colour there */
  // Builds an expression, not a shader variable: no toVar/assign, because this
  // is called while composing the node graph rather than inside an Fn(), and
  // TSL rejects assignment outside a function stack. Reassigning the local JS
  // reference is the correct way to chain graph nodes here.
  const backdropAt = (p) => {
    let out = vec3(uBg);
    BLOBS.forEach(([bx, by], i) => {
      const dx = p.x.sub(bx).mul(uAspect);
      const dy = p.y.sub(by);
      const d = dx.mul(dx).add(dy.mul(dy)).sqrt();
      // matches radial-gradient(circle, tint 0%, transparent 68%)
      const w = smoothstep(float(0.62), float(0.0), d);
      out = out.mix(vec3(uTints[i]), w);
    });
    // Composite the headline on top, so what the glass refracts is exactly what
    // a viewer sees behind it: the page gradient with the title sitting on it.
    if (!textInScene) return out;
    // Composite the headline on top, so what the glass refracts is exactly what
    // a viewer sees behind it: the page gradient with the title sitting on it.
    // The texture is a coverage mask, so its red channel is the glyph alpha.
    const mask = texture(heroText.texture, p).r;
    return out.mix(vec3(uTextColor), mask);
  };

  // DISABLED, and deliberately hard to turn back on by accident.
  //
  // Rasterising the page's headline into the scene is the only way the glass
  // can refract it — but the raster would not land on the real text. Across
  // several attempts it sat about one line-height low, and the cause was never
  // found: it was not the entry animation (the layout was measured stable), not
  // the canvas transform, and not the mixed-script line boxes. Each attempt put
  // a broken headline on the site's most prominent element.
  //
  // The DOM headline is now never touched by this component at all — the CSS
  // rule that could hide it has been deleted, so the worst an accidental
  // re-enable can do is draw a second copy, which is visible and harmless
  // rather than a broken layout.
  const textInScene = false;

  const heroText = new HeroText(options.textSelector ?? 'h1');
  if (textInScene) {
    await HeroText.waitForFonts();
    heroText.draw();
    uTextColor.value.set(heroText.color);
  }

  const TEXT_DISTANCE = 12;
  const textMaterial = new THREE.MeshBasicNodeMaterial();
  textMaterial.transparent = true;
  textMaterial.depthWrite = false;
  textMaterial.toneMapped = false;
  textMaterial.colorNode = vec3(uTextColor);
  textMaterial.opacityNode = texture(heroText.texture, uv()).r;

  const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), textMaterial);
  textPlane.position.z = -TEXT_DISTANCE;
  textPlane.frustumCulled = false;
  textPlane.renderOrder = -1;
  textPlane.visible = textInScene;
  if (textInScene) camera.add(textPlane);
  scene.add(camera);   // camera children only render if the camera is in the graph

  function fitTextPlane() {
    const hh = 2 * TEXT_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    textPlane.scale.set(hh * camera.aspect, hh, 1);
  }



  const studio = setupStudio(scene, renderer, {
    RoomEnvironment,
    environmentIntensity: options.environmentIntensity ?? 0.7,
  });
  // The gradient is the background; a lit ground plane under the bear would
  // read as a stage floor and break the "floating in the page" look.
  studio.floor.visible = false;
  // Nothing paints the background any more — the page's own ColorField shows
  // through the transparent canvas.
  scene.background = null;
  studio.key.castShadow = false;

  /* -------------------- build the bear -------------------- */

  const surface = await loadBearGeometry(options.modelUrl ?? '/gummy.obj', {
    targetHeight: 2.0,
    rotateY: Math.PI,
  });
  const thickness = bakeThickness(surface);
  // Used to frame the camera. Deliberately the bounding SPHERE, not the X
  // extent: the bear is nearly as deep as it is wide, and perspective makes
  // the near side project wider than the model measures, so framing off width
  // alone consistently under-estimates the silhouette and the bear comes out
  // bigger than asked for.
  surface.computeBoundingSphere();
  const bearWidth = surface.boundingSphere.radius * 2;

  const span = Math.max(
    surface.boundingBox.max.x - surface.boundingBox.min.x,
    surface.boundingBox.max.y - surface.boundingBox.min.y,
    surface.boundingBox.max.z - surface.boundingBox.min.z
  );
  const dilate = (span / profile.physicsDetail) * 0.9;

  const { geometry: cage } = buildCage(surface, {
    resolution: profile.physicsDetail,
    dilate,
  });
  const tets = tetrahedralize(cage, { resolution: profile.resolution, minQuality: 0.01 });
  const model = loadModelFromGeometry(tets.tetVerts, tets.tetIds, surface);
  bindSurfaceToTets(model);
  cage.dispose();

  // No gravity and no floor. With a home spring holding the rest pose there is
  // nothing for a ground plane to do except raise the question of where it is —
  // the bear reads as suspended in the page rather than standing on an invisible
  // surface. It also removes toppling: a hard throw can no longer leave the
  // hero lying on its face until someone reloads.
  const simulation = new SoftbodySimulation(renderer, {
    // The profile CAPS the preset, it does not merely provide a default. Every
    // flavour carries its own stepsPerSecond, so `preset ?? profile` meant the
    // mobile ceiling was never once applied and phones were running the full
    // desktop solver rate.
    stepsPerSecond: Math.min(preset.stepsPerSecond ?? Infinity, profile.stepsPerSecond),
    gravity: new THREE.Vector3(0, 0, 0),
    damping: 0.93,
    friction: 0.9,
    rotationSteps: 2,
  });

  const softGeometry = simulation.addGeometry(model, THREE.MeshPhysicalNodeMaterial);
  const instance = simulation.addInstance(softGeometry);
  scene.add(simulation.object);
  await simulation.bake();

  if (softGeometry.mesh) {
    softGeometry.mesh.castShadow = false;
    softGeometry.mesh.receiveShadow = false;
    softGeometry.geometry.setAttribute(
      'thickness',
      new THREE.BufferAttribute(thickness, 1, false)
    );
  }

  // Absorption is measured against the page gradient the glass refracts, not
  // against a studio backdrop, so these are tuned for the on-site context.
  const gummyMaterial = applyGlassMaterial(softGeometry.material, backdropAt, {
    thicknessScale: options.thicknessScale ?? 1.0,
    // A soft rose rather than the preset amber. Against this palette amber went
    // muddy, and at the low absorption needed for a see-through body it drained
    // to a milky white with no colour left in it at all.
    attenuationColor: options.attenuationColor ?? 0xff5fa2,
    // Tuned live against the site's own gradient. Absorption is deliberately
    // weak — the body should read as glass with a hint of flavour, not as
    // coloured plastic — and the refraction is strong enough that the bent
    // background, not diffuse shading, is what gives the body its form.
    // Close enough to the body's own thickness that the tint actually reads,
    // far enough that you still see straight through it.
    attenuationDistance: options.attenuationDistance ?? 7.0,
    // The rim was most of the milkiness: a bright fresnel halo over a pale
    // body reads as frosted plastic. Kept only as a thin wet edge.
    rimStrength: options.rimStrength ?? 0.10,
    refractStrength: options.refractStrength ?? 0.30,
    roughness: options.roughness ?? 0.06,
  });

  const spawn = new THREE.Vector3(0, -surface.boundingBox.min.y, 0);
  await instance.spawn(spawn.clone(), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));

  const homeMatrix = new THREE.Matrix4().compose(
    spawn.clone(),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1)
  );
  const homeSpring = new HomeSpring(simulation, {
    strength: options.homeStrength ?? 0.006,
  });
  homeSpring.setHome(homeMatrix);

  const softGrab = new SoftGrab(simulation, {
    radius: preset.grabRadius,
    strength: preset.grabStrength,
  });
  // Anything the page should own the click for. The bear lives underneath the
  // cards and above the headline, so a press on a card or a link has to reach
  // the page; a press on the headline (or on bare background) belongs to the bear.
  const PAGE_OWNS = 'a, button, input, textarea, select, summary, [data-cursor-hover]';

  // Refreshed off the GPU on a slow timer. Without it every pointerdown
  // anywhere on the page would have to round-trip the GPU to find out whether
  // it touched the bear, and the answer would arrive too late to stop the
  // browser starting a text selection.
  // Declared here rather than with the loop state below: refreshBounds() reads
  // it and now runs at mount, before that block is reached.
  let disposed = false;
  let bearBounds = null;
  async function refreshBounds() {
    if (disposed || !simulation.initialized) return;
    const p = await simulation.readAllVertexPositions();
    let b = { minx: 1e9, maxx: -1e9, miny: 1e9, maxy: -1e9, minz: 1e9, maxz: -1e9 };
    for (let i = 0; i < simulation.vertexCount; i++) {
      const x = p[i * 4], y = p[i * 4 + 1], z = p[i * 4 + 2];
      if (x < b.minx) b.minx = x; if (x > b.maxx) b.maxx = x;
      if (y < b.miny) b.miny = y; if (y > b.maxy) b.maxy = y;
      if (z < b.minz) b.minz = z; if (z > b.maxz) b.maxz = z;
    }
    bearBounds = b;
    publishAnchor();
  }

  const _c = new THREE.Vector3();
  /**
   * Writes the bear's on-screen footprint to CSS custom properties, in document
   * coordinates, so anything in the page can attach itself to the body instead
   * of being parked at a guessed offset. The layer never scrolls relative to the
   * document, so adding scrollY once makes these stable page positions.
   */
  function publishAnchor() {
    if (!bearBounds) return;
    // project() reads camera.matrixWorldInverse, which three only refreshes as
    // part of a render. This runs before the first frame — and again whenever
    // the loop is parked — so the matrix has to be brought up to date by hand
    // or every point projects to the centre of the screen.
    camera.updateMatrixWorld(true);
    const r = canvas.getBoundingClientRect();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 8; i++) {
      _c.set(
        i & 1 ? bearBounds.maxx : bearBounds.minx,
        i & 2 ? bearBounds.maxy : bearBounds.miny,
        i & 4 ? bearBounds.maxz : bearBounds.minz
      ).project(camera);
      const sx = r.left + (_c.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-_c.y * 0.5 + 0.5) * r.height;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    const root = document.documentElement.style;
    root.setProperty('--gummy-anchor-x', `${Math.round((minX + maxX) / 2)}px`);
    root.setProperty('--gummy-anchor-y', `${Math.round(maxY + window.scrollY)}px`);
    // Top of the head, for anything that should hang above the bear rather
    // than below it — below lands in the work cards.
    root.setProperty('--gummy-anchor-top', `${Math.round(minY + window.scrollY)}px`);

    // The body's inner edge — the side facing the text — plus how much of the
    // viewport it claims. Published so page content can be laid out against the
    // bear instead of guessing where it is. It is a live measurement, so it
    // stays true as the body deforms and as the framing changes with viewport.
    const rtlNow = isRtl();
    const innerEdge = rtlNow ? maxX : minX;
    root.setProperty('--gummy-inner-edge', `${Math.round(innerEdge)}px`);
    root.setProperty(
      '--gummy-claim',
      `${Math.round(rtlNow ? innerEdge : window.innerWidth - innerEdge)}px`
    );
  }

  const _corner = new THREE.Vector3();
  /** Synchronous, conservative: is this point inside the bear's screen box? */
  function pointerOverBear(event) {
    if (!bearBounds) return false;
    const r = canvas.getBoundingClientRect();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 8; i++) {
      _corner.set(
        i & 1 ? bearBounds.maxx : bearBounds.minx,
        i & 2 ? bearBounds.maxy : bearBounds.miny,
        i & 4 ? bearBounds.maxz : bearBounds.minz
      ).project(camera);
      const sx = r.left + (_corner.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-_corner.y * 0.5 + 0.5) * r.height;
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
    }
    const pad = 8;
    return event.clientX >= minX - pad && event.clientX <= maxX + pad
        && event.clientY >= minY - pad && event.clientY <= maxY + pad;
  }

  function pointerIsFree(event) {
    if (!pointerOverBear(event)) return false;
    // The canvas is pointer-events:none, so this reports the real content
    // under the cursor rather than the canvas itself.
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el) return true;
    if (el.closest(PAGE_OWNS)) return false;
    // Don't grab through a card: it is stacked above the bear, so a press
    // there is visually on the card even where the bear shows behind it.
    if (el.closest('[data-gummy-blocks]')) return false;
    return true;
  }

  // Publish an anchor immediately, before the render loop has run a single
  // frame. The loop is paused whenever the hero is off-screen or the tab is
  // hidden, so anything relying on the anchor would otherwise sit at its
  // fallback position until the reader happened to scroll it into view.
  await refreshBounds();

  const grabControl = new GrabControl(simulation, camera, canvas, softGrab, {
    maxDistance: 0.35,
    // The layer is click-through, so listen where every event actually lands.
    eventTarget: window,
    shouldGrab: pointerIsFree,
    // A plain swipe has to keep scrolling the page, so on touch the bear is
    // only grabbed after the finger has held still briefly. A mouse has a
    // real button and needs no such gate.
    touchHoldDelay: 150,
    touchSlop: 10,
  });

  /* -------------------- palette follows the page -------------------- */

  // Sampled every frame rather than on a MutationObserver. The layout writes
  // the palette as inline custom properties on <html>, but those properties
  // are *transitioned*: the attribute changes once while the computed colour
  // keeps animating for the length of the transition. An observer therefore
  // fires exactly once, at the moment the value is still the old one, and the
  // glass would stay the previous section's colour — a green bear on a pink
  // page. Reading each frame follows the transition instead.
  //
  // Cost is one getComputedStyle on a single element per frame; the string
  // compare below keeps it from touching the uniforms unless something moved.
  let lastPaletteKey = '';
  function syncPalette() {
    const p = readPalette();
    const key = p.bg + '|' + p.tints.join('|');
    if (key === lastPaletteKey) return;
    lastPaletteKey = key;
    uBg.value.set(p.bg);
    p.tints.forEach((c, i) => uTints[i].value.set(c));
    if (textInScene) {
      heroText.draw();                      // line boxes/colour move with --fg
      uTextColor.value.set(heroText.color);
    }
  }
  syncPalette();

  /* -------------------- sizing + scroll -------------------- */

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 1 || h < 1) return;
    camera.aspect = w / h;

    // Frame by how much of the viewport the bear should cover, not by a fixed
    // camera distance. Note this is measured against the bounding SPHERE, which
    // is wider than the bear's actual silhouette, so the fraction it occupies
    // on screen lands at roughly two thirds of the number set here. A fixed distance means the visible world width shrinks
    // with the aspect ratio, so the same bear that reads well on a desktop
    // takes over the screen on a phone. Solving for the distance instead keeps
    // it the same share of the frame everywhere.
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

    // Framed against BOTH axes, taking whichever constraint binds. Sizing on
    // width alone meant a wide, short window (HD is 16:9) gave the bear its
    // share of a very large width while the height stayed small, so it grew
    // past the top and bottom of the screen. The larger of the two distances is
    // the one that satisfies both limits.
    const wf = options.widthFraction ?? profile.widthFraction;
    const hf = options.heightFraction ?? profile.heightFraction;
    const distForWidth = bearWidth / (wf * 2 * halfFov * camera.aspect);
    const distForHeight = bearWidth / (hf * 2 * halfFov);
    const dist = THREE.MathUtils.clamp(
      Math.max(distForWidth, distForHeight),
      3.0,
      24.0
    );

    const visibleW = 2 * dist * halfFov * camera.aspect;
    const panX = (isRtl() ? 1 : -1) * sideBias * (visibleW / 2);

    camera.position.set(panX, baseCameraY, dist);
    camera.updateProjectionMatrix();
    camera.lookAt(panX, lookY, 0);

    uAspect.value = w / h;
    if (textInScene) { fitTextPlane(); heroText.draw(); }   // boxes move with layout
    renderer.setSize(w, h, false);
    // The camera has only now been framed; the mount-time publish ran against
    // an unframed camera and put the anchor at the centre of the screen.
    publishAnchor();
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  // Scrolling away ends the interaction and sends the bear home. Without this
  // a body left mid-throw stays mid-throw, and coming back up the page you
  // meet a stretched shape parked somewhere off its mark rather than the pose
  // the hero is supposed to open on.
  const HOME_STRENGTH = options.homeStrength ?? 0.006;
  const RETURN_STRENGTH = options.returnStrength ?? 0.045;
  let returnUntil = 0;

  function onScroll() {
    if (grabControl.grab.active) {
      grabControl.grab.end();
      grabControl._endGesture();
    }
    // Snap home briskly for a moment, then hand back to the gentle spring.
    returnUntil = performance.now() + 900;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* -------------------- loop -------------------- */

  let onScreen = true;
  let visible = !document.hidden;
  let running = false;
  let generation = 0;
  let last = performance.now();
  let boundsAge = 1e9;   // forces a bounds read on the first frame

  const io = new IntersectionObserver(
    ([e]) => {
      onScreen = e.isIntersecting;
      sync();
    },
    { threshold: 0 }
  );
  io.observe(container);

  function onVisibility() {
    visible = !document.hidden;
    sync();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function sync() {
    const should = onScreen && visible && !disposed;
    if (should && !running) {
      running = true;
      last = performance.now();
      const g = generation;
      requestAnimationFrame(() => frame(g));
    } else if (!should && running) {
      running = false;
      generation++;
    }
  }

  async function frame(g) {
    if (!running || disposed || g !== generation) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    syncPalette();

    // Re-rasterise only when the headline actually moved. During the hero's
    // entry animation and while scrolling this fires for a few frames; the
    // rest of the time the comparison is all it costs.
    if (textInScene && heroText.signature() !== heroText.lastSignature) {
      heroText.draw();
      uTextColor.value.set(heroText.color);
    }

    await simulation.update(dt, now / 1000);
    // Both are separate compute passes and have to be dispatched every frame,
    // after the solver. Without the first, the pointer picks a vertex and
    // nothing ever pulls it; without the second, a drag leaves the bear
    // permanently stretched and drifting toward the camera.
    softGrab.update();
    homeSpring.strength = now < returnUntil ? RETURN_STRENGTH : HOME_STRENGTH;
    homeSpring.update();
    renderer.render(scene, camera);

    boundsAge += dt;
    if (boundsAge > 0.4) {
      boundsAge = 0;
      refreshBounds();
    }

    if (running && !disposed && g === generation) {
      requestAnimationFrame(() => frame(g));
    }
  }
  sync();

  document.body.classList.add('gummy-active');

  return {
    scene,
    camera,
    renderer,
    simulation,
    gummyMaterial,
    grabControl,
    softGrab,
    homeSpring,
    heroText,
    _palette: { uBg, uTints, syncPalette, readPalette },
    setPreset(name) {
      const p = GUMMY_PRESETS[name];
      if (!p) return;
      gummyMaterial.apply(p);
      simulation.config.stepsPerSecond = Math.min(p.stepsPerSecond, profile.stepsPerSecond);
      softGrab.radius = p.grabRadius;
      softGrab.strength = p.grabStrength;
    },
    destroy() {
      disposed = true;
      running = false;
      generation++;
      document.body.classList.remove('gummy-active');
      io.disconnect();
      document.documentElement.style.removeProperty('--gummy-anchor-x');
      document.documentElement.style.removeProperty('--gummy-anchor-y');
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      grabControl.dispose();
      scene.remove(simulation.object);
      simulation.dispose();

      camera.remove(textPlane);
      textPlane.geometry.dispose();
      textMaterial.dispose();
      heroText.dispose();
      studio.dispose();
      surface.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
