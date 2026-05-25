"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeNormals, type CortexMesh } from "@/lib/mesh";
import type { ModeKey } from "@/lib/fhn";
import type {
  InboundMessage,
  OutboundMessage,
} from "@/workers/simulator";
import Controls from "./Controls";
import EEGTrace from "./EEGTrace";

const BrainCanvas = dynamic(() => import("./BrainCanvas"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full grid place-items-center text-white/35 text-xs uppercase tracking-[0.24em]">
      preparing cortex...
    </div>
  ),
});

const SLICE_MIN = -1.05;
const SLICE_MAX = 1.05;

export default function Studio() {
  const workerRef = useRef<Worker | null>(null);
  const [mesh, setMesh] = useState<CortexMesh | null>(null);
  const [normals, setNormals] = useState<Float32Array | null>(null);
  const [voltage, setVoltage] = useState<Float32Array | null>(null);
  const [time, setTime] = useState(0);
  const [avgV, setAvgV] = useState(0);
  const [mode, setMode] = useState<ModeKey>("sinus");
  const [slicerOffset, setSlicerOffset] = useState(SLICE_MAX);
  const [stepsPerFrame, setStepsPerFrame] = useState(2);
  const [vertexCount, setVertexCount] = useState(0);
  const [triangleCount, setTriangleCount] = useState(0);

  // Tuple [F3, C3, P3] pushed to the EEG every frame.
  const eegSample = useRef<[number, number, number] | null>(null);
  // Cache the channel sampling vertex indices once we know the mesh.
  const channelVertsRef = useRef<[number, number, number] | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/simulator.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    let aborted = false;
    fetch("/brain.bin")
      .then((res) => res.arrayBuffer())
      .then((buf) => {
        if (aborted) return;
        // Send a copy so we can keep our own decoded view alive on the main side.
        const copy = buf.slice(0);
        const init: InboundMessage = {
          kind: "init",
          meshBuffer: copy,
          mode: "sinus",
        };
        worker.postMessage(init, [copy]);
      })
      .catch((e) => console.error("mesh load", e));

    worker.onmessage = (ev: MessageEvent<OutboundMessage>) => {
      const m = ev.data;
      if (m.kind === "ready") {
        const positions = new Float32Array(m.positions);
        const indices = new Uint32Array(m.indices);
        const hemisphere = new Uint32Array(m.hemisphere);
        const meshObj: CortexMesh = {
          positions,
          indices,
          hemisphere,
          vertexCount: m.vertexCount,
          triangleCount: m.triangleCount,
        };
        setMesh(meshObj);
        setNormals(computeNormals(meshObj));
        setVoltage(new Float32Array(m.vertexCount));
        setVertexCount(m.vertexCount);
        setTriangleCount(m.triangleCount);
        channelVertsRef.current = pickChannelVertices(positions);
      } else if (m.kind === "frame") {
        const u = new Float32Array(m.voltage);
        setVoltage(u);
        setTime(m.time);
        setAvgV(m.avgV);
        const chans = channelVertsRef.current;
        if (chans) {
          eegSample.current = [u[chans[0]], u[chans[1]], u[chans[2]]];
        }
      }
    };

    return () => {
      aborted = true;
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = (msg: InboundMessage) => {
    workerRef.current?.postMessage(msg);
  };

  const handleMode = (m: ModeKey) => {
    setMode(m);
    send({ kind: "setMode", mode: m });
  };

  const handlePick = useMemo(
    () => (vertexIndex: number) => send({ kind: "stimulate", vertexIndex }),
    [],
  );

  const handleStepsPerFrame = (s: number) => {
    setStepsPerFrame(s);
    send({ kind: "setStepsPerFrame", stepsPerFrame: s });
  };

  const handleReset = () => send({ kind: "reset" });

  return (
    <div className="w-full px-8 pb-4 grid grid-cols-12 gap-4">
      <aside className="col-span-12 lg:col-span-3 flex flex-col gap-4">
        <Panel className="h-[112px] justify-center">
          <Brief />
        </Panel>
        <Panel className="flex-1">
          <Controls
            mode={mode}
            onMode={handleMode}
            slicerOffset={slicerOffset}
            onSlicer={setSlicerOffset}
            sliceMin={SLICE_MIN}
            sliceMax={SLICE_MAX}
            stepsPerFrame={stepsPerFrame}
            onStepsPerFrame={handleStepsPerFrame}
            onReset={handleReset}
          />
        </Panel>
        <Panel className="h-[170px]" title="state">
          <Stats
            time={time}
            avgV={avgV}
            mode={mode}
            vertexCount={vertexCount}
            triangleCount={triangleCount}
          />
        </Panel>
      </aside>

      <main className="col-span-12 lg:col-span-9 flex flex-col gap-4">
        <Panel className="aspect-[16/10]" title="cortical surface">
          {mesh && normals && voltage ? (
            <BrainCanvas
              positions={mesh.positions}
              indices={mesh.indices}
              normals={normals}
              voltage={voltage}
              slicerOffset={slicerOffset}
              onPick={handlePick}
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-white/35 text-xs uppercase tracking-[0.24em]">
              loading fsaverage5 pial surface...
            </div>
          )}
        </Panel>
        <Panel className="h-[160px]" title="virtual scalp electrodes">
          <EEGTrace sampleRef={eegSample} />
        </Panel>
      </main>
    </div>
  );
}

function Brief() {
  return (
    <div className="text-[11.5px] leading-relaxed text-white/55">
      Reaction-diffusion simulator on the fsaverage5 cortical surface. Click
      anywhere on the brain to inject a voltage perturbation; the wave then
      evolves under the FitzHugh-Nagumo dynamics across roughly 20k vertices
      in real time.
    </div>
  );
}

function Panel({
  children,
  title,
  subtitle,
  className = "",
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative flex flex-col rounded-2xl border border-white/[0.08] bg-[#0a0c1a]/65 backdrop-blur-md p-4 overflow-hidden ${className}`}
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.4), 0 20px 50px -20px rgba(0,0,0,0.6)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none rounded-2xl"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at top left, rgba(86,224,255,0.05), transparent 70%), radial-gradient(ellipse 80% 60% at bottom right, rgba(255,122,219,0.04), transparent 70%)",
        }}
      />
      {(title || subtitle) && (
        <header className="relative mb-2.5 flex items-baseline justify-between shrink-0">
          {title && (
            <h2 className="text-[13px] font-medium tracking-tight text-white/90">
              {title}
            </h2>
          )}
          {subtitle && (
            <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
              {subtitle}
            </span>
          )}
        </header>
      )}
      <div className="relative flex-1 min-h-0 min-w-0">{children}</div>
    </section>
  );
}

function Stats({
  time,
  avgV,
  mode,
  vertexCount,
  triangleCount,
}: {
  time: number;
  avgV: number;
  mode: ModeKey;
  vertexCount: number;
  triangleCount: number;
}) {
  return (
    <dl className="grid grid-cols-2 gap-y-2 gap-x-3 text-[11.5px] font-mono">
      <Stat label="t (s)" value={time.toFixed(2)} />
      <Stat label="mean u" value={avgV.toFixed(3)} />
      <Stat label="mode" value={mode} />
      <Stat label="hemis" value="L + R" />
      <Stat label="verts" value={vertexCount.toString()} />
      <Stat label="tris" value={triangleCount.toString()} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-white/40">{label}</dt>
      <dd className="text-right text-white/85 tabular-nums">{value}</dd>
    </>
  );
}

/**
 * Pick vertices roughly under standard EEG positions F3, C3, P3 on the
 * left hemisphere by selecting the nearest vertex to canonical normalized
 * locations on the unit sphere.
 */
function pickChannelVertices(positions: Float32Array): [number, number, number] {
  const targets: [number, number, number][] = [
    [-0.45, 0.7, 0.55], // F3 (frontal)
    [-0.65, 0.4, 0.0], // C3 (central)
    [-0.45, 0.2, -0.65], // P3 (parietal)
  ];
  const out: number[] = [];
  for (const [tx, ty, tz] of targets) {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < positions.length / 3; i++) {
      const dx = positions[i * 3] - tx;
      const dy = positions[i * 3 + 1] - ty;
      const dz = positions[i * 3 + 2] - tz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    out.push(best);
  }
  return [out[0], out[1], out[2]];
}
