/**
 * Mesh container for the fsaverage5 cortical surface. Reads the packed
 * binary produced by scripts/convert_brain.py.
 *
 * Buffer layout (little-endian):
 *   uint32   N              vertex count
 *   uint32   M              triangle count
 *   float32  positions[3N]  xyz, unit-sphere normalized
 *   uint32   indices[3M]    triangle vertex indices
 *   uint32   hemi[N]        0 = left hemisphere, 1 = right
 */

export type CortexMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  hemisphere: Uint32Array;
  vertexCount: number;
  triangleCount: number;
};

export async function loadCortexMesh(url: string): Promise<CortexMesh> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`brain mesh fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return decodeCortexMesh(buf);
}

export function decodeCortexMesh(buf: ArrayBuffer): CortexMesh {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const m = dv.getUint32(4, true);
  const posBytes = n * 3 * 4;
  const idxBytes = m * 3 * 4;
  const hemiBytes = n * 4;
  const expected = 8 + posBytes + idxBytes + hemiBytes;
  if (buf.byteLength !== expected) {
    throw new Error(`brain.bin size ${buf.byteLength} != expected ${expected}`);
  }
  const positions = new Float32Array(buf, 8, n * 3);
  const indices = new Uint32Array(buf, 8 + posBytes, m * 3);
  const hemisphere = new Uint32Array(buf, 8 + posBytes + idxBytes, n);
  return {
    positions,
    indices,
    hemisphere,
    vertexCount: n,
    triangleCount: m,
  };
}

/**
 * Per-vertex outward normal, averaged from adjacent triangles.
 */
export function computeNormals(mesh: CortexMesh): Float32Array {
  const { positions, indices, vertexCount, triangleCount } = mesh;
  const normals = new Float32Array(vertexCount * 3);

  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const by = positions[b * 3 + 1];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    const cz = positions[c * 3 + 2];
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    normals[a * 3] += nx;
    normals[a * 3 + 1] += ny;
    normals[a * 3 + 2] += nz;
    normals[b * 3] += nx;
    normals[b * 3 + 1] += ny;
    normals[b * 3 + 2] += nz;
    normals[c * 3] += nx;
    normals[c * 3 + 1] += ny;
    normals[c * 3 + 2] += nz;
  }

  for (let i = 0; i < vertexCount; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }

  return normals;
}
