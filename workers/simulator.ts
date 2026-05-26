/// <reference lib="webworker" />

import { buildCotanLaplacian, estimateSpectralRadius } from "@/lib/laplacian";
import { decodeCortexMesh } from "@/lib/mesh";
import {
  makeSimulatorState,
  MODE_PRESETS,
  seedSpiral,
  step,
  stimulate,
  type ModeKey,
  type SimulatorState,
} from "@/lib/fhn";

export type InboundMessage =
  | { kind: "init"; meshBuffer: ArrayBuffer; mode: ModeKey }
  | { kind: "setMode"; mode: ModeKey }
  | { kind: "stimulate"; vertexIndex: number; amplitude?: number }
  | { kind: "reset" }
  | { kind: "setStepsPerFrame"; stepsPerFrame: number };

export type OutboundMessage =
  | {
      kind: "ready";
      vertexCount: number;
      triangleCount: number;
      positions: Float32Array;
      indices: Uint32Array;
      hemisphere: Uint32Array;
      dt: number;
    }
  | {
      kind: "frame";
      voltage: ArrayBuffer;
      recovery: ArrayBuffer;
      time: number;
      avgV: number;
      maxV: number;
    };

let state: SimulatorState | null = null;
let stepsPerFrame = 4;
let positionsRef: Float32Array | null = null;
let indicesRef: Uint32Array | null = null;
let hemiRef: Uint32Array | null = null;

function pickFurthestVertex(positions: Float32Array): number {
  // Lateral surface of the left precentral region: a vertex roughly at
  // (-0.6, 0.0, 0.4) is a sensible default pacemaker location.
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const score = -Math.hypot(x + 0.6, y, z - 0.4);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function applyMode(mode: ModeKey): void {
  if (!state) return;
  const preset = MODE_PRESETS[mode];
  state.params = {
    ...preset,
    pacemakerVertex: positionsRef ? pickFurthestVertex(positionsRef) : null,
  };
  // Reset voltage to resting and apply mode-specific initial condition.
  for (let i = 0; i < state.u.length; i++) {
    state.u[i] = -1.2;
    state.v[i] = -0.6;
  }
  state.time = 0;
  state.lastPacemakerFire = -1e9;
  if (mode === "spiral") seedSpiral(state);
  else if (mode === "sd" && state.params.pacemakerVertex != null) {
    stimulate(state, state.params.pacemakerVertex, state.params.stimAmp);
  } else if (mode === "sinus" && state.params.pacemakerVertex != null) {
    stimulate(state, state.params.pacemakerVertex);
    state.lastPacemakerFire = 0;
  }
}

self.onmessage = (ev: MessageEvent<InboundMessage>) => {
  const msg = ev.data;

  if (msg.kind === "init") {
    const mesh = decodeCortexMesh(msg.meshBuffer);
    positionsRef = mesh.positions;
    indicesRef = mesh.indices;
    hemiRef = mesh.hemisphere;
    const L = buildCotanLaplacian(mesh);
    const spectral = estimateSpectralRadius(L, 32);
    const preset = MODE_PRESETS[msg.mode];
    const pacemakerVertex = pickFurthestVertex(mesh.positions);
    state = makeSimulatorState(L, mesh.positions, { ...preset, pacemakerVertex }, spectral);
    applyMode(msg.mode);
    // Slice the views into freshly-allocated TypedArrays so each one
    // carries only its own data (the underlying brain.bin buffer is
    // shared between all three views, so sending .buffer would ship
    // the entire 13 MB to the main thread, and three concurrent views
    // of it would all interpret the same bytes differently).
    const ready: OutboundMessage = {
      kind: "ready",
      vertexCount: mesh.vertexCount,
      triangleCount: mesh.triangleCount,
      positions: new Float32Array(mesh.positions),
      indices: new Uint32Array(mesh.indices),
      hemisphere: new Uint32Array(mesh.hemisphere),
      dt: state.dt,
    };
    (self as DedicatedWorkerGlobalScope).postMessage(ready, [
      ready.positions.buffer,
      ready.indices.buffer,
      ready.hemisphere.buffer,
    ]);
    tickLoop();
    return;
  }

  if (!state) return;

  switch (msg.kind) {
    case "setMode":
      applyMode(msg.mode);
      break;
    case "stimulate":
      stimulate(state, msg.vertexIndex, msg.amplitude);
      break;
    case "reset":
      for (let i = 0; i < state.u.length; i++) {
        state.u[i] = -1.2;
        state.v[i] = -0.6;
      }
      state.time = 0;
      state.lastPacemakerFire = -1e9;
      break;
    case "setStepsPerFrame":
      stepsPerFrame = Math.max(1, Math.min(32, msg.stepsPerFrame));
      break;
  }
};

const TARGET_FRAME_MS = 33; // 30 Hz cap

function tickLoop(): void {
  if (!state) return;
  const t0 = performance.now();
  for (let s = 0; s < stepsPerFrame; s++) step(state);

  let avg = 0;
  let max = -Infinity;
  for (let i = 0; i < state.u.length; i++) {
    avg += state.u[i];
    if (state.u[i] > max) max = state.u[i];
  }
  avg /= state.u.length;

  const uCopy = new Float32Array(state.u);
  const vCopy = new Float32Array(state.v);
  const frame: OutboundMessage = {
    kind: "frame",
    voltage: uCopy.buffer,
    recovery: vCopy.buffer,
    time: state.time,
    avgV: avg,
    maxV: max,
  };
  (self as DedicatedWorkerGlobalScope).postMessage(frame, [uCopy.buffer, vCopy.buffer]);

  // Cap the tick rate so the main thread can keep up. Posting frames
  // faster than the renderer drains them queues messages and eventually
  // exhausts the heap.
  const elapsed = performance.now() - t0;
  const wait = Math.max(0, TARGET_FRAME_MS - elapsed);
  setTimeout(tickLoop, wait);
}

export {};
