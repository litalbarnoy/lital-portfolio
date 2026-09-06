/**
 * Translucent gummy material.
 *
 * The colour is not painted on — it is absorption. The base colour is left
 * near-white and effectively all light is transmitted; what you see is
 * Beer-Lambert attenuation through the body, driven by a real per-vertex
 * thickness map (see `bakeThickness`). Thick parts — belly, head — accumulate
 * absorption and read deep and saturated; thin parts — ears, paws, the rim of
 * the silhouette — read bright and pale. That difference is most of what makes
 * a material read as candy rather than as tinted glass.
 *
 * The material is configured in place rather than constructed here, because
 * Tetrament's SoftbodyGeometry builds its own material instance so it can own
 * `positionNode` and `normalNode` (the mesh is deformed on the GPU).
 */
import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  color,
  float,
  normalView,
  normalWorld,
  positionWorld,
  pow,
  screenUV,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Each preset changes how the sweet absorbs light *and* how it moves, so the
 * flavours read as different materials rather than as a recolour.
 *
 * `attenuationDistance` is set against the actual baked thickness map, whose
 * median through the body is ~1.11 world units. Transmittance is
 * exp(-thickness / attenuationDistance), so a distance of 1.8 leaves roughly
 * half the light coming through the belly — pigmented but clearly see-through.
 * Values near the body thickness (~0.4) absorb over 90% and read as solid.
 *
 * `stepsPerSecond` is the closest thing Tetrament has to a stiffness control —
 * its solver has no compliance term, so how hard the body resists is governed
 * by how many constraint iterations run per second. The grab settings change
 * how far a pull carries into the body.
 */
export const GUMMY_PRESETS = {
  amber: {
    label: 'amber',
    attenuationColor: 0xff7a18,
    attenuationDistance: 1.80,
    roughness: 0.16,
    // Firm and glassy, like a fresh sweet.
    stepsPerSecond: 640,
    grabRadius: 0.40,
    grabStrength: 0.32,
  },
  rose: {
    label: 'rose',
    attenuationColor: 0xff2f6a,
    attenuationDistance: 1.45,
    roughness: 0.22,
    // Softer and slower to recover — the pull carries further.
    stepsPerSecond: 420,
    grabRadius: 0.52,
    grabStrength: 0.40,
  },
  mint: {
    label: 'mint',
    attenuationColor: 0x22d39a,
    attenuationDistance: 2.40,
    roughness: 0.10,
    // Cleanest and snappiest: clearer body, tighter grip.
    stepsPerSecond: 760,
    grabRadius: 0.34,
    grabStrength: 0.28,
  },
};

/**
 * Configures a MeshPhysicalNodeMaterial as gelatin.
 *
 * @param {THREE.MeshPhysicalNodeMaterial} material Material owned by SoftbodyGeometry.
 * @param {object} [options]
 * @returns {{ uniforms: object, apply(preset): void }}
 */
export function applyGummyMaterial(material, options = {}) {
  const uniforms = {
    attenuationColor: uniform(new THREE.Color(options.attenuationColor ?? 0xff7a18)),
    attenuationDistance: uniform(options.attenuationDistance ?? 1.80),
    thicknessScale: uniform(options.thicknessScale ?? 1.0),
    roughness: uniform(options.roughness ?? 0.16),
    ior: uniform(options.ior ?? 1.35),
    rimStrength: uniform(options.rimStrength ?? 0.18),
  };

  // Scalars as well as nodes: three uses the scalar values to decide which
  // shading features to compile in, so a transmission node alone is not enough
  // to switch the transmission path on.
  material.transmission = 1.0;
  material.transparent = true;
  material.side = THREE.FrontSide;
  material.metalness = 0.0;
  material.roughness = 0.16;
  material.ior = 1.35;
  material.thickness = 1.0;

  material.colorNode = color(0xffffff);
  material.metalnessNode = float(0.0);
  material.roughnessNode = uniforms.roughness;
  material.iorNode = uniforms.ior;
  material.transmissionNode = float(1.0);

  // The baked map is in world units for a bear ~2 units tall; the scale lets
  // the absorption be tuned without re-baking.
  material.thicknessNode = attribute('thickness', 'float').mul(uniforms.thicknessScale);
  material.attenuationColorNode = uniforms.attenuationColor;
  material.attenuationDistanceNode = uniforms.attenuationDistance;

  // A cool Fresnel lift at grazing angles. Real gelatin is wet: the rim catches
  // the environment far more than the face-on surface does, and without it a
  // fully transmissive body loses its silhouette against a light background.
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = float(1.0).sub(normalWorld.dot(viewDir).clamp(0, 1)).pow(3.0);
  material.emissiveNode = uniforms.attenuationColor.mul(fresnel).mul(uniforms.rimStrength);

  function apply(preset) {
    if (!preset) return;
    if (preset.attenuationColor !== undefined) {
      uniforms.attenuationColor.value.set(preset.attenuationColor);
    }
    if (preset.attenuationDistance !== undefined) {
      uniforms.attenuationDistance.value = preset.attenuationDistance;
    }
    if (preset.roughness !== undefined) uniforms.roughness.value = preset.roughness;
  }

  return { uniforms, apply };
}

/**
 * Gelatin for a TRANSPARENT canvas.
 *
 * `applyGummyMaterial` above uses real transmission, which refracts whatever
 * was rendered into the scene. That needs an opaque backdrop *inside* the
 * scene — and an opaque full-viewport canvas cannot sit above the page's own
 * headline without erasing it.
 *
 * So this variant drops physical transmission and refracts an analytic
 * backdrop instead: the same four-blob gradient the page paints in CSS,
 * sampled at a screen position pushed sideways by the surface normal. The
 * canvas is then free to be transparent everywhere the bear is not, and the
 * body can be stacked above the headline.
 *
 * What this trades away: text and page content behind the bear are hidden
 * rather than refracted, since the shader only knows about the gradient. In
 * the reference that is exactly the intended look.
 *
 * @param {THREE.MeshPhysicalNodeMaterial} material Material owned by SoftbodyGeometry.
 * @param {(uv) => any} backdrop Returns the page's background colour at a screen uv.
 */
export function applyGlassMaterial(material, backdrop, options = {}) {
  // `backdrop(uv)` returns what is behind the body at a screen uv. Splitting the
  // lookup into three slightly different offsets per colour channel is what
  // produces the coloured fringe real glass shows at its steep edges — the same
  // effect three's own `dispersion` gives, done here because this path composes
  // its background rather than sampling the scene.
  const uniforms = {
    attenuationColor: uniform(new THREE.Color(options.attenuationColor ?? 0xff7a18)),
    attenuationDistance: uniform(options.attenuationDistance ?? 9.0),
    thicknessScale: uniform(options.thicknessScale ?? 1.0),
    roughness: uniform(options.roughness ?? 0.06),
    ior: uniform(options.ior ?? 1.35),
    rimStrength: uniform(options.rimStrength ?? 0.35),
    refractStrength: uniform(options.refractStrength ?? 0.30),
    dispersion: uniform(options.dispersion ?? 0.10),
  };

  material.transmission = 0;      // the analytic backdrop replaces it
  material.transparent = false;   // the body is opaque; it *shows* the background
  material.side = THREE.FrontSide;
  material.metalness = 0.0;
  material.roughness = options.roughness ?? 0.12;
  material.ior = options.ior ?? 1.35;

  const thickness = attribute('thickness', 'float').mul(uniforms.thicknessScale);

  // Push the lookup sideways by the view-space normal: straight-on the sample is
  // undisplaced, and it swings hardest where the surface turns away — which is
  // what reads as a lens.
  const offset = vec2(normalView.x, normalView.y)
    .mul(uniforms.refractStrength)
    .mul(thickness);

  const d = uniforms.dispersion;
  const behind = vec3(
    backdrop(screenUV.add(offset.mul(float(1.0).sub(d)))).r,
    backdrop(screenUV.add(offset)).g,
    backdrop(screenUV.add(offset.mul(float(1.0).add(d)))).b
  );

  // Beer-Lambert as a per-unit transmittance: colour^(distance / attenuation),
  // so thick parts saturate and thin ones stay near-clear.
  const tint = pow(vec3(uniforms.attenuationColor), thickness.div(uniforms.attenuationDistance));

  // No diffuse: the body is not a lit surface, it is the background seen
  // through coloured glass. Specular and the environment still land on top,
  // which is what keeps it looking wet.
  material.colorNode = color(0x000000);
  material.roughnessNode = uniforms.roughness;
  material.metalnessNode = float(0.0);
  material.iorNode = uniforms.ior;

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = float(1.0).sub(normalWorld.dot(viewDir).clamp(0, 1)).pow(3.0);

  material.emissiveNode = behind.mul(tint).add(
    vec3(uniforms.attenuationColor).mul(fresnel).mul(uniforms.rimStrength)
  );

  function apply(preset) {
    if (!preset) return;
    if (preset.attenuationColor !== undefined) uniforms.attenuationColor.value.set(preset.attenuationColor);
    if (preset.roughness !== undefined) uniforms.roughness.value = preset.roughness;
  }

  return { uniforms, apply };
}

/**
 * Studio lighting: a soft room environment doing most of the work, one sharp
 * key for the highlight that slides over the surface as the body deforms, and
 * a contact shadow to sit the bear on the ground.
 *
 * Returns a disposer, since the generated environment map owns GPU memory.
 */
export function setupStudio(scene, renderer, options = {}) {
  const background = new THREE.Color(options.background ?? 0xeceae5);
  scene.background = background;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new options.RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = options.environmentIntensity ?? 1.1;

  const key = new THREE.DirectionalLight(0xffffff, options.keyIntensity ?? 2.6);
  key.position.set(2.6, 4.4, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 18;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0015;
  key.shadow.radius = 6;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xdfe8ff, options.fillIntensity ?? 0.55);
  fill.position.set(-3.0, 1.8, -2.2);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardNodeMaterial({
      color: background.clone().multiplyScalar(1.02),
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  return {
    key,
    fill,
    floor,
    dispose() {
      scene.remove(key, fill, floor);
      floor.geometry.dispose();
      floor.material.dispose();
      envRT.dispose();
      pmrem.dispose();
      scene.environment = null;
    },
  };
}
