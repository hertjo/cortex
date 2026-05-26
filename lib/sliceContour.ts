/**
 * Compute the curve where an axis-aligned plane intersects the cortical
 * surface mesh. The plane is x = offset, y = offset, or z = offset
 * depending on the chosen axis.
 *
 * A triangle either lies entirely on one side of the plane (no
 * intersection), or has exactly two edges that straddle the plane. The
 * intersection on a straddling edge is the linear interpolation of the
 * two endpoints at the plane value, with weight
 *
 *     w = (offset - v0) / (v1 - v0)
 *
 * giving the point  (1 - w) * p0 + w * p1.
 *
 * For each triangle we emit one line segment between its two
 * intersection points. Each endpoint records (vertexA, vertexB, w) so
 * that the voltage at the point can be interpolated each frame as
 *
 *     voltage = (1 - w) * u[vertexA] + w * u[vertexB]
 *
 * The 2D projected coordinates are the two mesh coordinates orthogonal
 * to the slice axis.
 */

export type SliceAxis = "x" | "y" | "z";

export type SliceSegment = {
  // 2D projected positions of the two endpoints.
  p0u: number;
  p0v: number;
  p1u: number;
  p1v: number;
  // Interpolation data for endpoint 0.
  e0a: number;
  e0b: number;
  e0w: number;
  // Interpolation data for endpoint 1.
  e1a: number;
  e1b: number;
  e1w: number;
};

const AXIS_INDEX: Record<SliceAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

function axisProjection(axis: SliceAxis): { u: 0 | 1 | 2; v: 0 | 1 | 2 } {
  // Pick the two axes orthogonal to the slice axis as the 2D coords.
  // The choice keeps the resulting projection right-handed when read
  // from outside the head.
  switch (axis) {
    case "x":
      return { u: 2, v: 1 }; // sagittal: see (z, y), z toward back
    case "y":
      return { u: 0, v: 2 }; // axial: see (x, z), x to the right
    case "z":
      return { u: 0, v: 1 }; // coronal: see (x, y), x to the right
  }
}

export function computeSliceSegments(
  positions: Float32Array,
  indices: Uint32Array,
  axis: SliceAxis,
  offset: number,
): SliceSegment[] {
  const ax = AXIS_INDEX[axis];
  const { u: uAx, v: vAx } = axisProjection(axis);
  const out: SliceSegment[] = [];
  const triCount = indices.length / 3;

  const edgeBuf: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const va = positions[ia * 3 + ax] - offset;
    const vb = positions[ib * 3 + ax] - offset;
    const vc = positions[ic * 3 + ax] - offset;

    // Quick reject when all three vertices fall on the same side.
    if ((va > 0 && vb > 0 && vc > 0) || (va < 0 && vb < 0 && vc < 0)) continue;

    edgeBuf[0][0] = ia;
    edgeBuf[0][1] = ib;
    edgeBuf[0][2] = 0;
    edgeBuf[1][0] = ib;
    edgeBuf[1][1] = ic;
    edgeBuf[1][2] = 0;
    edgeBuf[2][0] = ic;
    edgeBuf[2][1] = ia;
    edgeBuf[2][2] = 0;

    const vals = [va, vb, vc, va];
    let crossings = 0;
    let pUx = 0;
    let pVx = 0;
    let pUy = 0;
    let pVy = 0;
    let xa = 0;
    let xb = 0;
    let xw = 0;
    let ya = 0;
    let yb = 0;
    let yw = 0;
    for (let e = 0; e < 3; e++) {
      const v0 = vals[e];
      const v1 = vals[e + 1];
      if ((v0 < 0 && v1 > 0) || (v0 > 0 && v1 < 0)) {
        const i0 = edgeBuf[e][0];
        const i1 = edgeBuf[e][1];
        const w = -v0 / (v1 - v0); // (offset - x0) / (x1 - x0) with offset subtracted earlier
        const pu = (1 - w) * positions[i0 * 3 + uAx] + w * positions[i1 * 3 + uAx];
        const pv = (1 - w) * positions[i0 * 3 + vAx] + w * positions[i1 * 3 + vAx];
        if (crossings === 0) {
          pUx = pu;
          pVx = pv;
          xa = i0;
          xb = i1;
          xw = w;
        } else if (crossings === 1) {
          pUy = pu;
          pVy = pv;
          ya = i0;
          yb = i1;
          yw = w;
        }
        crossings++;
      }
    }
    if (crossings !== 2) continue;
    out.push({
      p0u: pUx,
      p0v: pVx,
      p1u: pUy,
      p1v: pVy,
      e0a: xa,
      e0b: xb,
      e0w: xw,
      e1a: ya,
      e1b: yb,
      e1w: yw,
    });
  }

  return out;
}

/**
 * Read voltage at a slice endpoint given the precomputed interpolation
 * triple (vertexA, vertexB, w).
 */
export function endpointVoltage(u: Float32Array, a: number, b: number, w: number): number {
  return (1 - w) * u[a] + w * u[b];
}
