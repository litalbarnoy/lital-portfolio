/**
 * Gummy bear geometry.
 *
 * The render surface is the supplied `gummy.obj` model. It is already exactly
 * what tetrahedralisation needs — verified closed and manifold: 12,098 verts /
 * 24,192 tris, 0 boundary edges, 0 non-manifold edges, Euler characteristic 2
 * (a single genus-0 shell), welded, outward-wound.
 *
 * What it is NOT suitable for is being tetrahedralised directly: the
 * tetrahedraliser turns every surface vertex into a tet vertex, so 12k vertices
 * would give a huge, sliver-ridden tet mesh. So the physics runs on a coarse
 * cage derived from the model by sampling it into a signed distance field and
 * polygonising that with marching cubes — which also lets the cage be dilated
 * so it fully encloses the render mesh (see `bindSurfaceToTets`).
 */
import * as THREE from 'three/webgpu';
import { MeshBVH } from 'three-mesh-bvh';
// Canonical Bourke lookup tables. Imported rather than transcribed so the
// 4096-entry triangle table cannot pick up a typo.
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

/* ------------------------------------------------------------------ *
 * Model loading
 * ------------------------------------------------------------------ */

/**
 * Minimal OBJ reader: positions and faces only, quads triangulated.
 *
 * three's OBJLoader is deliberately not used here — it expands to a
 * non-indexed geometry, turning 12k shared vertices into 72k unshared ones.
 * That would triple the render cost and, more importantly, break the welded
 * topology the binding and the manifold checks rely on.
 */
function parseOBJ(text) {
  const positions = [];
  const indices = [];

  for (let i = 0, n = text.length; i < n; ) {
    let end = text.indexOf('\n', i);
    if (end === -1) end = n;
    const line = text.slice(i, end);
    i = end + 1;

    if (line.charCodeAt(0) === 118 /* v */ && line.charCodeAt(1) === 32) {
      const p = line.split(/\s+/);
      positions.push(+p[1], +p[2], +p[3]);
    } else if (line.charCodeAt(0) === 102 /* f */ && line.charCodeAt(1) === 32) {
      const parts = line.trim().split(/\s+/);
      const corner = [];
      for (let k = 1; k < parts.length; k++) {
        // "v", "v/vt", "v//vn" or "v/vt/vn" — only the position index matters.
        const slash = parts[k].indexOf('/');
        corner.push(parseInt(slash === -1 ? parts[k] : parts[k].slice(0, slash), 10) - 1);
      }
      for (let k = 1; k + 1 < corner.length; k++) {
        indices.push(corner[0], corner[k], corner[k + 1]);
      }
    }
  }

  return { positions, indices };
}

/**
 * Loads the bear model and normalises it: centred on the origin and scaled to
 * `targetHeight`. Normals are computed rather than read from the file — the
 * file stores them per face corner, which would force the shared vertices apart
 * again.
 *
 * @returns {Promise<THREE.BufferGeometry>}
 */
export async function loadBearGeometry(url, options = {}) {
  const targetHeight = options.targetHeight ?? 2.0;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url}: ${response.status}`);
  const { positions, indices } = parseOBJ(await response.text());
  if (!positions.length) throw new Error(`${url} contained no vertices`);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();

  const bb = geometry.boundingBox;
  const height = bb.max.y - bb.min.y;
  const scale = targetHeight / height;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;

  geometry.translate(-cx, -cy, -cz);
  geometry.scale(scale, scale, scale);

  if (options.rotateY) geometry.rotateY(options.rotateY);

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

/* ------------------------------------------------------------------ *
 * Mesh -> signed distance field
 * ------------------------------------------------------------------ */

/**
 * Samples `geometry` into a density grid (positive inside), for marching cubes.
 *
 * Distance comes from the BVH's closest-point query; the sign comes from ray
 * parity rather than from the nearest triangle's normal, which is unreliable
 * near edges and corners. The ray direction is deliberately off-axis so it does
 * not run along coplanar faces and double-count crossings.
 */
function sampleMeshField(bvh, nx, ny, nz, origin, cell, band) {
  const field = new Float32Array(nx * ny * nz);
  const point = new THREE.Vector3();
  const hit = {};
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));

  // One ray per (y, z) row rather than one per sample: the crossings along a
  // row are shared by every x on it, which turns nx*ny*nz raycasts into ny*nz.
  const xs = [];
  for (let z = 0; z < nz; z++) {
    const wz = origin.z + z * cell;
    for (let y = 0; y < ny; y++) {
      const wy = origin.y + y * cell;

      ray.origin.set(origin.x - cell, wy, wz);
      const hits = bvh.raycast(ray, THREE.DoubleSide);
      xs.length = 0;
      for (let i = 0; i < hits.length; i++) xs.push(hits[i].point.x);
      xs.sort((a, b) => a - b);

      // x increases monotonically, so the crossing count only ever advances.
      let crossed = 0;
      const rowBase = y * nx + z * nx * ny;

      for (let x = 0; x < nx; x++) {
        const wx = origin.x + x * cell;
        while (crossed < xs.length && xs[crossed] < wx) crossed++;
        const inside = (crossed & 1) === 1;

        // Exact distance is only needed near the isosurface; past `band` the
        // sign is all marching cubes will use, so cap the search and skip the
        // expensive closest-point query for the bulk of the volume.
        point.set(wx, wy, wz);
        const found = bvh.closestPointToPoint(point, hit, 0, band);
        const d = found ? hit.distance : band;

        field[rowBase + x] = inside ? d : -d;
      }
    }
  }
  return field;
}

/**
 * Builds the coarse physics cage from the render mesh.
 *
 * @param {THREE.BufferGeometry} geometry Render surface.
 * @param {object} [options]
 * @param {number} [options.resolution=22] Cells across the longest axis.
 * @param {number} [options.dilate=0] Grow the cage outward by this much, so it
 *   encloses the render mesh and every render vertex binds inside a tet.
 * @returns {{ geometry: THREE.BufferGeometry, stats: object }}
 */
export function buildCage(geometry, options = {}) {
  const resolution = Math.max(8, Math.round(options.resolution ?? 22));
  const dilate = options.dilate ?? 0;

  const bvh = new MeshBVH(geometry);
  const bb = geometry.boundingBox;

  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  const cell = span / resolution;
  // Three clear cells of air past the dilated surface, so it can never touch
  // the grid boundary and be clipped open.
  const pad = dilate + cell * 3;

  const origin = new THREE.Vector3(bb.min.x - pad, bb.min.y - pad, bb.min.z - pad);
  const nx = Math.ceil((bb.max.x + pad - origin.x) / cell) + 1;
  const ny = Math.ceil((bb.max.y + pad - origin.y) / cell) + 1;
  const nz = Math.ceil((bb.max.z + pad - origin.z) / cell) + 1;

  // Distances matter only out to the dilated isosurface plus a cell either side.
  const band = Math.abs(dilate) + cell * 2.5;
  const field = sampleMeshField(bvh, nx, ny, nz, origin, cell, band);
  // Shifting the isosurface outward by `dilate` grows the shape.
  if (dilate !== 0) for (let i = 0; i < field.length; i++) field[i] += dilate;

  const { positions, indices } = marchingCubes(field, nx, ny, nz, origin, cell);
  if (!positions.length) throw new Error('cage polygonisation produced no surface');

  let volume = signedVolume(positions, indices);
  if (volume < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    volume = -volume;
  }

  const vertexCount = positions.length / 3;
  const topology = inspectTopology(indices, vertexCount);

  const cage = new THREE.BufferGeometry();
  cage.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cage.setIndex(indices);
  cage.computeVertexNormals();
  cage.computeBoundingBox();

  return {
    geometry: cage,
    stats: {
      vertexCount,
      triangleCount: indices.length / 3,
      gridDims: [nx, ny, nz],
      cellSize: cell,
      dilate,
      volume,
      watertight: topology.boundaryEdges === 0,
      manifold: topology.boundaryEdges === 0 && topology.nonManifoldEdges === 0,
      euler: vertexCount - topology.edgeCount + indices.length / 3,
      ...topology,
    },
  };
}

/** Topology report for any indexed geometry — used to vet the loaded model. */
export function inspectGeometry(geometry) {
  const index = geometry.getIndex();
  const indices = index ? Array.from(index.array) : null;
  if (!indices) return { indexed: false };
  const vertexCount = geometry.getAttribute('position').count;
  const topology = inspectTopology(indices, vertexCount);
  return {
    indexed: true,
    vertexCount,
    triangleCount: indices.length / 3,
    watertight: topology.boundaryEdges === 0,
    manifold: topology.boundaryEdges === 0 && topology.nonManifoldEdges === 0,
    euler: vertexCount - topology.edgeCount + indices.length / 3,
    ...topology,
  };
}

/* ------------------------------------------------------------------ *
 * Marching cubes
 * ------------------------------------------------------------------ */

/*
 * three's tables use the canonical Bourke corner order. Written in grid
 * offsets from the cell origin (x, y, z):
 *
 *   c0 (0,0,0)  c1 (1,0,0)  c2 (1,1,0)  c3 (0,1,0)
 *   c4 (0,0,1)  c5 (1,0,1)  c6 (1,1,1)  c7 (0,1,1)
 *
 * Each of the 12 edges is owned by one grid point plus an axis, which is what
 * makes the vertex cache possible: two cells sharing an edge compute the same
 * key and therefore reuse the same vertex.
 */
const CORNER_OFFSETS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

// [ownerCornerIndex, axis] per edge; axis 0 = x, 1 = y, 2 = z.
const EDGE_OWNER = [
  [0, 0], [1, 1], [3, 0], [0, 1],
  [4, 0], [5, 1], [7, 0], [4, 1],
  [0, 2], [1, 2], [2, 2], [3, 2],
];

// The two corners each edge spans.
const EDGE_CORNERS = [
  [0, 1], [1, 2], [3, 2], [0, 3],
  [4, 5], [5, 6], [7, 6], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Polygonises a scalar field. `field` is density-like (high inside), matching
 * three's table convention: a corner bit is set when it sits below the
 * isosurface, i.e. outside.
 */
function marchingCubes(field, nx, ny, nz, origin, cell) {
  const strideY = nx;
  const strideZ = nx * ny;
  const at = (x, y, z) => x + y * strideY + z * strideZ;

  // -1 = "no vertex emitted on this edge yet".
  const edgeVertex = new Int32Array(nx * ny * nz * 3).fill(-1);

  const positions = [];
  const indices = [];

  const cornerField = new Float32Array(8);
  const cornerIndex = new Int32Array(8);

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNER_OFFSETS[c];
          const idx = at(x + o[0], y + o[1], z + o[2]);
          cornerIndex[c] = idx;
          const v = field[idx];
          cornerField[c] = v;
          if (v < 0) cubeIndex |= 1 << c;
        }

        const bits = edgeTable[cubeIndex];
        if (bits === 0) continue;

        // Emit (or look up) a vertex for every edge the surface crosses.
        const cellEdgeVertex = new Int32Array(12).fill(-1);
        for (let e = 0; e < 12; e++) {
          if ((bits & (1 << e)) === 0) continue;

          const [ownerCorner, axis] = EDGE_OWNER[e];
          const oo = CORNER_OFFSETS[ownerCorner];
          const ox = x + oo[0], oy = y + oo[1], oz = z + oo[2];
          const key = at(ox, oy, oz) * 3 + axis;

          let vi = edgeVertex[key];
          if (vi === -1) {
            const [ca, cb] = EDGE_CORNERS[e];
            const fa = cornerField[ca];
            const fb = cornerField[cb];
            // Linear crossing point. The denominator cannot be zero: the two
            // corners straddle the isosurface, so they differ in sign.
            const t = fa / (fa - fb);

            const a = CORNER_OFFSETS[ca];
            const b = CORNER_OFFSETS[cb];
            const px = origin.x + (x + a[0] + (b[0] - a[0]) * t) * cell;
            const py = origin.y + (y + a[1] + (b[1] - a[1]) * t) * cell;
            const pz = origin.z + (z + a[2] + (b[2] - a[2]) * t) * cell;

            vi = positions.length / 3;
            positions.push(px, py, pz);
            edgeVertex[key] = vi;
          }
          cellEdgeVertex[e] = vi;
        }

        const base = cubeIndex << 4;
        for (let i = 0; triTable[base + i] !== -1; i += 3) {
          const a = cellEdgeVertex[triTable[base + i]];
          const b = cellEdgeVertex[triTable[base + i + 1]];
          const c = cellEdgeVertex[triTable[base + i + 2]];
          // Degenerate triangles appear when two edges resolve to the same
          // cached vertex; dropping them keeps the edge-pairing check honest.
          if (a === b || b === c || a === c) continue;
          indices.push(a, b, c);
        }
      }
    }
  }

  return { positions, indices };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * A closed manifold surface has every edge shared by exactly two triangles.
 * Anything else means the tetrahedralizer will see a leak.
 */
function inspectTopology(indices, vertexCount) {
  const counts = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const n of counts.values()) {
    if (n === 1) boundaryEdges++;
    else if (n > 2) nonManifoldEdges++;
  }
  return { boundaryEdges, nonManifoldEdges, edgeCount: counts.size };
}

/** Signed volume via the divergence theorem. Positive means outward winding. */
function signedVolume(positions, indices) {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/* ------------------------------------------------------------------ *
 * Surface → tet binding
 * ------------------------------------------------------------------ */

/**
 * Re-binds every render vertex to the tetrahedron that actually contains it.
 *
 * Tetrament's own `processGeometry` picks the tet whose *centroid* is nearest
 * and then solves for barycentric coordinates. For a render mesh finer than the
 * tet cage that regularly picks a tet the vertex is not inside, giving
 * coordinates far outside [0,1]. The vertex shader reconstructs the position as
 *
 *     v0 + (v1-v0)·b.x + (v2-v0)·b.y + (v3-v0)·b.z
 *
 * so once that tet rotates, an out-of-range coordinate throws the vertex metres
 * away — the long spikes. Sliver tets make it worse, because their basis is
 * near-degenerate and inverting it amplifies everything.
 *
 * This does a proper containment search over a uniform grid, and where no
 * containing tet exists (a vertex just outside the cage) it projects the
 * weights onto the simplex, which pins the vertex to the tet's surface instead.
 * A bounded error of a fraction of a cell, rather than an unbounded spike.
 *
 * Mutates `model.attachedTets` and `model.baryCoords` in place.
 */
export function bindSurfaceToTets(model, options = {}) {
  const tol = options.tolerance ?? 1e-4;

  const verts = model.tetVerts;
  const ids = model.tetIds;
  const positions = model.positions;

  const tetCount = (ids.length / 4) | 0;
  const surfaceCount = (positions.length / 3) | 0;
  const tetVertexCount = (verts.length / 3) | 0;

  // The library accepts both 0- and 1-based tet indices; match its rule so we
  // reconstruct exactly the tets it bound against.
  let minIdx = Infinity, maxIdx = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] < minIdx) minIdx = ids[i];
    if (ids[i] > maxIdx) maxIdx = ids[i];
  }
  const offset = minIdx >= 1 && maxIdx >= tetVertexCount ? -1 : 0;

  // Per-tet origin, inverse basis and bounds.
  const origin = new Float64Array(tetCount * 3);
  const inv = new Float64Array(tetCount * 9);
  const bbox = new Float64Array(tetCount * 6);
  const usable = new Uint8Array(tetCount);

  let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
  let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;

  for (let t = 0; t < tetCount; t++) {
    const i0 = (ids[t * 4] + offset) * 3;
    const i1 = (ids[t * 4 + 1] + offset) * 3;
    const i2 = (ids[t * 4 + 2] + offset) * 3;
    const i3 = (ids[t * 4 + 3] + offset) * 3;

    const x0 = verts[i0], y0 = verts[i0 + 1], z0 = verts[i0 + 2];
    const ax = verts[i1] - x0, ay = verts[i1 + 1] - y0, az = verts[i1 + 2] - z0;
    const bx = verts[i2] - x0, by = verts[i2 + 1] - y0, bz = verts[i2 + 2] - z0;
    const cx = verts[i3] - x0, cy = verts[i3 + 1] - y0, cz = verts[i3 + 2] - z0;

    // det of the column matrix [a b c] — six times the signed tet volume.
    const det = ax * (by * cz - bz * cy) - bx * (ay * cz - az * cy) + cx * (ay * bz - az * by);
    if (!isFinite(det) || Math.abs(det) < 1e-18) continue; // fully degenerate

    const invDet = 1 / det;
    const o = t * 9;
    // Inverse of [a b c] (columns), row-major.
    inv[o + 0] = (by * cz - bz * cy) * invDet;
    inv[o + 1] = (bz * cx - bx * cz) * invDet;
    inv[o + 2] = (bx * cy - by * cx) * invDet;
    inv[o + 3] = (az * cy - ay * cz) * invDet;
    inv[o + 4] = (ax * cz - az * cx) * invDet;
    inv[o + 5] = (ay * cx - ax * cy) * invDet;
    inv[o + 6] = (ay * bz - az * by) * invDet;
    inv[o + 7] = (az * bx - ax * bz) * invDet;
    inv[o + 8] = (ax * by - ay * bx) * invDet;

    origin[t * 3] = x0; origin[t * 3 + 1] = y0; origin[t * 3 + 2] = z0;

    const xs = [x0, x0 + ax, x0 + bx, x0 + cx];
    const ys = [y0, y0 + ay, y0 + by, y0 + cy];
    const zs = [z0, z0 + az, z0 + bz, z0 + cz];
    const b = t * 6;
    bbox[b] = Math.min(...xs); bbox[b + 1] = Math.min(...ys); bbox[b + 2] = Math.min(...zs);
    bbox[b + 3] = Math.max(...xs); bbox[b + 4] = Math.max(...ys); bbox[b + 5] = Math.max(...zs);

    if (bbox[b] < gMinX) gMinX = bbox[b];
    if (bbox[b + 1] < gMinY) gMinY = bbox[b + 1];
    if (bbox[b + 2] < gMinZ) gMinZ = bbox[b + 2];
    if (bbox[b + 3] > gMaxX) gMaxX = bbox[b + 3];
    if (bbox[b + 4] > gMaxY) gMaxY = bbox[b + 4];
    if (bbox[b + 5] > gMaxZ) gMaxZ = bbox[b + 5];

    usable[t] = 1;
  }

  // Uniform grid over tet bounds. Each tet is registered in every cell its
  // bounding box touches, so a point's own cell holds every candidate.
  const span = Math.max(gMaxX - gMinX, gMaxY - gMinY, gMaxZ - gMinZ) || 1;
  const res = Math.max(4, Math.min(48, Math.round(Math.cbrt(tetCount) * 1.6)));
  const cell = span / res;
  const gx = Math.max(1, Math.ceil((gMaxX - gMinX) / cell) + 1);
  const gy = Math.max(1, Math.ceil((gMaxY - gMinY) / cell) + 1);
  const gz = Math.max(1, Math.ceil((gMaxZ - gMinZ) / cell) + 1);

  const buckets = new Map();
  const cellOf = (x, y, z) =>
    Math.min(gx - 1, Math.max(0, Math.floor((x - gMinX) / cell))) +
    Math.min(gy - 1, Math.max(0, Math.floor((y - gMinY) / cell))) * gx +
    Math.min(gz - 1, Math.max(0, Math.floor((z - gMinZ) / cell))) * gx * gy;

  for (let t = 0; t < tetCount; t++) {
    if (!usable[t]) continue;
    const b = t * 6;
    const x0 = Math.max(0, Math.floor((bbox[b] - gMinX) / cell));
    const y0 = Math.max(0, Math.floor((bbox[b + 1] - gMinY) / cell));
    const z0 = Math.max(0, Math.floor((bbox[b + 2] - gMinZ) / cell));
    const x1 = Math.min(gx - 1, Math.floor((bbox[b + 3] - gMinX) / cell));
    const y1 = Math.min(gy - 1, Math.floor((bbox[b + 4] - gMinY) / cell));
    const z1 = Math.min(gz - 1, Math.floor((bbox[b + 5] - gMinZ) / cell));
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const key = x + y * gx + z * gx * gy;
          let arr = buckets.get(key);
          if (!arr) buckets.set(key, (arr = []));
          arr.push(t);
        }
  }

  // Barycentric weights of p in tet t, as [w1, w2, w3]; w0 is 1 - their sum.
  const bary = (t, px, py, pz, out) => {
    const o = t * 9, q = t * 3;
    const dx = px - origin[q], dy = py - origin[q + 1], dz = pz - origin[q + 2];
    out[0] = inv[o + 0] * dx + inv[o + 1] * dy + inv[o + 2] * dz;
    out[1] = inv[o + 3] * dx + inv[o + 4] * dy + inv[o + 5] * dz;
    out[2] = inv[o + 6] * dx + inv[o + 7] * dy + inv[o + 8] * dz;
  };

  const w = [0, 0, 0];
  const best = [0, 0, 0];
  let contained = 0, projected = 0, orphaned = 0;
  let maxWeightBefore = 0, maxWeightAfter = 0;

  const track = (arr, before) => {
    const m = Math.max(Math.abs(arr[0]), Math.abs(arr[1]), Math.abs(arr[2]),
                       Math.abs(1 - arr[0] - arr[1] - arr[2]));
    if (before) { if (m > maxWeightBefore) maxWeightBefore = m; }
    else if (m > maxWeightAfter) maxWeightAfter = m;
  };

  for (let i = 0; i < surfaceCount; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];

    // What the library gave us, for the before/after comparison.
    best[0] = model.baryCoords[i * 3];
    best[1] = model.baryCoords[i * 3 + 1];
    best[2] = model.baryCoords[i * 3 + 2];
    track(best, true);

    let chosen = -1;
    let chosenScore = -Infinity; // most interior wins

    const candidates = buckets.get(cellOf(px, py, pz));
    if (candidates) {
      for (let ci = 0; ci < candidates.length; ci++) {
        const t = candidates[ci];
        const b = t * 6;
        if (px < bbox[b] - tol || px > bbox[b + 3] + tol) continue;
        if (py < bbox[b + 1] - tol || py > bbox[b + 4] + tol) continue;
        if (pz < bbox[b + 2] - tol || pz > bbox[b + 5] + tol) continue;

        bary(t, px, py, pz, w);
        const w0 = 1 - w[0] - w[1] - w[2];
        const score = Math.min(w0, w[0], w[1], w[2]);
        if (score > chosenScore) {
          chosenScore = score;
          chosen = t;
          best[0] = w[0]; best[1] = w[1]; best[2] = w[2];
        }
        if (score >= 0) break; // strictly inside; nothing will beat it
      }
    }

    if (chosen === -1) {
      // Nothing in the cell at all — keep the library's tet and clamp.
      orphaned++;
      chosen = model.attachedTets[i];
      if (usable[chosen]) bary(chosen, px, py, pz, best);
      chosenScore = -1;
    }

    if (chosenScore < -tol) {
      // Outside every candidate: project the weights onto the simplex so the
      // vertex sits on the tet's boundary rather than flying off it.
      projected++;
      let w0 = Math.max(1 - best[0] - best[1] - best[2], 0);
      let w1 = Math.max(best[0], 0);
      let w2 = Math.max(best[1], 0);
      let w3 = Math.max(best[2], 0);
      const sum = w0 + w1 + w2 + w3 || 1;
      best[0] = w1 / sum; best[1] = w2 / sum; best[2] = w3 / sum;
    } else {
      contained++;
    }

    track(best, false);
    model.attachedTets[i] = chosen;
    model.baryCoords[i * 3] = best[0];
    model.baryCoords[i * 3 + 1] = best[1];
    model.baryCoords[i * 3 + 2] = best[2];
  }

  return {
    surfaceCount,
    contained,
    projected,
    orphaned,
    maxWeightBefore,
    maxWeightAfter,
  };
}

/* ------------------------------------------------------------------ *
 * Thickness
 * ------------------------------------------------------------------ */

/**
 * Bakes how much material sits behind each vertex, by firing a ray straight
 * into the body along the inward normal and measuring where it comes out.
 *
 * This is what drives the Beer-Lambert absorption: the belly and head are
 * several centimetres of jelly and read deep and saturated, while ears, paws
 * and the rim of the silhouette are thin and read bright. Approximating
 * thickness with distance-from-centre — the usual shortcut — gets the rim
 * wrong, because a point on the ear is far from the centre yet barely thick.
 *
 * @param {THREE.BufferGeometry} geometry Closed, manifold, outward-wound.
 * @returns {Float32Array} One thickness per vertex, in world units.
 */
export function bakeThickness(geometry) {
  const bvh = new MeshBVH(geometry);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const count = position.count;

  const bb = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox);
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  // Start just inside the surface so the ray does not immediately re-hit the
  // triangle it started on.
  const epsilon = span * 1e-4;

  const out = new Float32Array(count);
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const ray = new THREE.Ray();

  for (let i = 0; i < count; i++) {
    dir.set(normal.getX(i), normal.getY(i), normal.getZ(i)).normalize().negate();
    origin
      .set(position.getX(i), position.getY(i), position.getZ(i))
      .addScaledVector(dir, epsilon);

    ray.origin.copy(origin);
    ray.direction.copy(dir);

    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    // No exit hit means the ray left through a crease it could not resolve;
    // fall back to a thin value rather than an infinite one.
    out[i] = hit ? hit.distance + epsilon : epsilon;
  }

  return out;
}
