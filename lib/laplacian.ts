/**
 * Discrete Laplace-Beltrami operator on a triangle mesh, using the
 * cotangent weights of Pinkall and Polthier (1993):
 *
 *     (L u)_i  =  (1 / (2 A_i)) * sum_{j ~ i} (cot a_ij + cot b_ij) (u_j - u_i)
 *
 * where a_ij, b_ij are the two angles opposite the edge ij in the two
 * triangles that share it, and A_i is the Voronoi area at vertex i.
 *
 * For boundary edges (only one incident triangle) we just use the single
 * available cotangent. For numerical safety the cotangent is clamped to
 * avoid blow-ups on obtuse triangles.
 *
 * The result is stored in compressed sparse row form, with the diagonal
 * folded into row[i]:
 *
 *     for k in [rowPtr[i], rowPtr[i+1]):
 *         (L u)_i += weight[k] * u[col[k]]
 *
 * One slot per row is reserved for the diagonal (col == i).
 */

import type { CortexMesh } from "./mesh";

export type CotanLaplacian = {
  rowPtr: Uint32Array;
  col: Uint32Array;
  weight: Float32Array;
  invMass: Float32Array;
  vertexCount: number;
};

const COT_CLAMP = 1e4;

function cotangent(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  // Cotangent of the angle at vertex a in triangle (a, b, c).
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const dot = ux * vx + uy * vy + uz * vz;
  const crossX = uy * vz - uz * vy;
  const crossY = uz * vx - ux * vz;
  const crossZ = ux * vy - uy * vx;
  const sinTimesLen = Math.hypot(crossX, crossY, crossZ);
  if (sinTimesLen < 1e-12) return 0;
  const cot = dot / sinTimesLen;
  return Math.max(-COT_CLAMP, Math.min(COT_CLAMP, cot));
}

export function buildCotanLaplacian(mesh: CortexMesh): CotanLaplacian {
  const { positions, indices, vertexCount, triangleCount } = mesh;

  // Step 1: collect off-diagonal weight contributions.
  // Use a Number-keyed map; with vertexCount up to ~330k the product
  // a * vertexCount + b stays well below 2^53 and BigInt is avoided.
  const edgeWeight = new Map<number, number>();
  const addEdge = (i: number, j: number, w: number) => {
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = a * vertexCount + b;
    edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + w);
  };

  const mass = new Float64Array(vertexCount);

  for (let t = 0; t < triangleCount; t++) {
    const i = indices[t * 3];
    const j = indices[t * 3 + 1];
    const k = indices[t * 3 + 2];

    const ix = positions[i * 3];
    const iy = positions[i * 3 + 1];
    const iz = positions[i * 3 + 2];
    const jx = positions[j * 3];
    const jy = positions[j * 3 + 1];
    const jz = positions[j * 3 + 2];
    const kx = positions[k * 3];
    const ky = positions[k * 3 + 1];
    const kz = positions[k * 3 + 2];

    const cotI = cotangent(ix, iy, iz, jx, jy, jz, kx, ky, kz);
    const cotJ = cotangent(jx, jy, jz, kx, ky, kz, ix, iy, iz);
    const cotK = cotangent(kx, ky, kz, ix, iy, iz, jx, jy, jz);

    // Edge jk gets cotI/2, edge ki gets cotJ/2, edge ij gets cotK/2.
    addEdge(j, k, 0.5 * cotI);
    addEdge(k, i, 0.5 * cotJ);
    addEdge(i, j, 0.5 * cotK);

    // Area = 0.5 * |(j-i) x (k-i)|.
    const ux = jx - ix;
    const uy = jy - iy;
    const uz = jz - iz;
    const vx = kx - ix;
    const vy = ky - iy;
    const vz = kz - iz;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    const third = area / 3;
    mass[i] += third;
    mass[j] += third;
    mass[k] += third;
  }

  // Step 2: build adjacency per vertex, then flatten to CSR.
  const adj: number[][] = Array.from({ length: vertexCount }, () => []);
  const adjW: number[][] = Array.from({ length: vertexCount }, () => []);
  for (const [key, w] of edgeWeight.entries()) {
    const a = Math.floor(key / vertexCount);
    const b = key - a * vertexCount;
    adj[a].push(b);
    adjW[a].push(w);
    adj[b].push(a);
    adjW[b].push(w);
  }

  let nnz = 0;
  for (let i = 0; i < vertexCount; i++) nnz += adj[i].length + 1; // +1 for diagonal

  const rowPtr = new Uint32Array(vertexCount + 1);
  const col = new Uint32Array(nnz);
  const weight = new Float32Array(nnz);
  let cursor = 0;
  for (let i = 0; i < vertexCount; i++) {
    rowPtr[i] = cursor;
    const neighbors = adj[i];
    const neighborWeights = adjW[i];
    let diag = 0;
    for (let n = 0; n < neighbors.length; n++) {
      col[cursor] = neighbors[n];
      weight[cursor] = neighborWeights[n];
      diag -= neighborWeights[n];
      cursor++;
    }
    col[cursor] = i;
    weight[cursor] = diag;
    cursor++;
  }
  rowPtr[vertexCount] = cursor;

  const invMass = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    invMass[i] = mass[i] > 1e-12 ? 1 / mass[i] : 0;
  }

  return { rowPtr, col, weight, invMass, vertexCount };
}

/**
 * Apply the cotangent Laplacian to u, without the Voronoi mass term.
 *
 * The mass-normalized operator (M^{-1} L) has an unbounded spectral
 * radius on irregular meshes which forces an impractically small dt.
 * Dropping the mass term gives the "stiffness" form L u; the effective
 * diffusion coefficient just absorbs the average mass.
 */
export function applyLaplacian(L: CotanLaplacian, u: Float32Array, out: Float32Array): void {
  const { rowPtr, col, weight, vertexCount } = L;
  for (let i = 0; i < vertexCount; i++) {
    const start = rowPtr[i];
    const end = rowPtr[i + 1];
    let acc = 0;
    for (let k = start; k < end; k++) acc += weight[k] * u[col[k]];
    out[i] = acc;
  }
}

/**
 * Estimate the spectral radius of the Laplacian via a few power iterations.
 * Used to size the CFL-bounded explicit time step:
 *     dt <= 2 / spectralRadius
 */
export function estimateSpectralRadius(L: CotanLaplacian, iters = 24): number {
  const n = L.vertexCount;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.random() - 0.5;
  let lambda = 1;
  for (let k = 0; k < iters; k++) {
    applyLaplacian(L, x, y);
    let norm = 0;
    for (let i = 0; i < n; i++) norm += y[i] * y[i];
    norm = Math.sqrt(norm) || 1;
    let dot = 0;
    for (let i = 0; i < n; i++) dot += x[i] * (y[i] / norm);
    lambda = Math.abs(dot) > 0 ? norm / Math.abs(dot || 1) : norm;
    for (let i = 0; i < n; i++) x[i] = y[i] / norm;
  }
  let xLx = 0;
  let xx = 0;
  applyLaplacian(L, x, y);
  for (let i = 0; i < n; i++) {
    xLx += x[i] * y[i];
    xx += x[i] * x[i];
  }
  return Math.abs(xLx / (xx || 1));
}
