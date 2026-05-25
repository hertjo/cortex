/**
 * FitzHugh-Nagumo reaction-diffusion on the cortical surface.
 *
 *     du/dt = D * Laplacian(u) + u - u^3/3 - v + I(x, t)
 *     dv/dt = epsilon * (u + a - b * v)
 *
 * u is the fast voltage (excitable), v is the slow recovery. Three preset
 * parameter packs reproduce qualitatively distinct cortical regimes:
 *
 *   - sinus:     a single focal pacemaker fires at fixed period.
 *   - sd:        spreading depression. Slow diffusion, high amplitude.
 *   - spiral:    cross-field stimulation seeds a re-entrant spiral wave,
 *                qualitatively similar to focal seizure dynamics.
 *
 * Integration is forward Euler with a CFL-bounded dt. RK2 would be more
 * stable but the savings do not justify the doubled compute per step.
 */

import { applyLaplacian, type CotanLaplacian } from "./laplacian";

export type ModeKey = "sinus" | "sd" | "spiral";

export type ModeParams = {
  D: number;
  epsilon: number;
  a: number;
  b: number;
  stimAmp: number;
  stimRadius: number;
  pacemakerPeriod: number | null;
  pacemakerVertex: number | null;
  description: string;
};

export const MODE_PRESETS: Record<ModeKey, Omit<ModeParams, "pacemakerVertex">> = {
  sinus: {
    D: 0.025,
    epsilon: 0.04,
    a: 0.7,
    b: 0.8,
    stimAmp: 2.2,
    stimRadius: 0.12,
    pacemakerPeriod: 8.0,
    description: "focal pacemaker, regular target waves",
  },
  sd: {
    D: 0.008,
    epsilon: 0.012,
    a: 0.6,
    b: 0.7,
    stimAmp: 1.8,
    stimRadius: 0.18,
    pacemakerPeriod: 18.0,
    description: "spreading depression, slow large amplitude wave",
  },
  spiral: {
    D: 0.04,
    epsilon: 0.03,
    a: 0.75,
    b: 0.8,
    stimAmp: 1.5,
    stimRadius: 0.15,
    pacemakerPeriod: null,
    description: "spiral wave re-entry, focal seizure analog",
  },
};

export type SimulatorState = {
  u: Float32Array;
  v: Float32Array;
  lap: Float32Array;
  L: CotanLaplacian;
  positions: Float32Array;
  params: ModeParams;
  dt: number;
  time: number;
  lastPacemakerFire: number;
};

export function makeSimulatorState(
  L: CotanLaplacian,
  positions: Float32Array,
  params: ModeParams,
  spectralRadius: number,
): SimulatorState {
  const n = L.vertexCount;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = -1.2;
    v[i] = -0.6;
  }
  const lap = new Float32Array(n);
  // CFL: dt <= 2 / (D * spectralRadius). Use a generous safety factor.
  const cfl = 2 / (params.D * spectralRadius);
  const dt = Math.min(0.08, 0.4 * cfl);
  return {
    u,
    v,
    L,
    lap,
    positions,
    params,
    dt,
    time: 0,
    lastPacemakerFire: -1e9,
  };
}

/**
 * Apply a Gaussian voltage perturbation centered at vertex `centerIdx`.
 * Used for click-to-stimulate and pacemaker firing.
 */
export function stimulate(state: SimulatorState, centerIdx: number, ampOverride?: number): void {
  const { u, positions, params } = state;
  const cx = positions[centerIdx * 3];
  const cy = positions[centerIdx * 3 + 1];
  const cz = positions[centerIdx * 3 + 2];
  const r2 = params.stimRadius * params.stimRadius;
  const amp = ampOverride ?? params.stimAmp;
  for (let i = 0; i < u.length; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 4 * r2) {
      u[i] += amp * Math.exp(-d2 / r2);
    }
  }
}

/**
 * Cross-field stimulation: a narrow strip on the lateral surface gets
 * excited, while an adjacent strip just below is forced into refractory
 * recovery. The wavefront can then only propagate in one direction,
 * which curls into a spiral tip.
 */
export function seedSpiral(state: SimulatorState): void {
  const { u, v, positions } = state;
  for (let i = 0; i < u.length; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    // Front strip: a thin vertical band on the lateral surface, x near 0.
    if (Math.abs(x) < 0.08 && z > -0.2 && z < 0.5 && y > -0.1) {
      u[i] = 1.1;
    }
    // Refractory band just behind the wavefront, on the y < 0 side.
    if (Math.abs(x) < 0.08 && z > -0.2 && z < 0.5 && y < -0.1) {
      v[i] = 0.7;
    }
  }
}

/**
 * One forward-Euler step of the FHN system on the mesh.
 */
export function step(state: SimulatorState): void {
  const { u, v, L, lap, params, dt } = state;
  applyLaplacian(L, u, lap);
  const n = u.length;
  const { D, epsilon, a, b } = params;
  for (let i = 0; i < n; i++) {
    const ui = u[i];
    const vi = v[i];
    const du = D * lap[i] + ui - (ui * ui * ui) / 3 - vi;
    const dv = epsilon * (ui + a - b * vi);
    u[i] = ui + dt * du;
    v[i] = vi + dt * dv;
  }
  state.time += dt;

  if (params.pacemakerPeriod != null && params.pacemakerVertex != null) {
    if (state.time - state.lastPacemakerFire >= params.pacemakerPeriod) {
      stimulate(state, params.pacemakerVertex);
      state.lastPacemakerFire = state.time;
    }
  }
}
