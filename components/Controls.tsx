"use client";

import type { ModeKey } from "@/lib/fhn";
import type { SliceAxis } from "@/lib/sliceContour";

type Props = {
  mode: ModeKey;
  onMode: (m: ModeKey) => void;
  sliceAxis: SliceAxis;
  onSliceAxis: (a: SliceAxis) => void;
  slicerOffset: number;
  onSlicer: (v: number) => void;
  sliceMin: number;
  sliceMax: number;
  stepsPerFrame: number;
  onStepsPerFrame: (v: number) => void;
  onReset: () => void;
};

const MODES: Array<{ key: ModeKey; label: string; subtitle: string }> = [
  { key: "sinus", label: "sinus", subtitle: "focal pacemaker, regular target waves" },
  { key: "sd", label: "spreading depression", subtitle: "slow large amplitude wave" },
  { key: "spiral", label: "spiral reentry", subtitle: "focal seizure analog" },
];

const SLICE_AXES: Array<{ key: SliceAxis; label: string; full: string }> = [
  { key: "y", label: "axial", full: "horizontal · top-down" },
  { key: "x", label: "sagittal", full: "vertical · left-right" },
  { key: "z", label: "coronal", full: "vertical · front-back" },
];

export default function Controls({
  mode,
  onMode,
  sliceAxis,
  onSliceAxis,
  slicerOffset,
  onSlicer,
  sliceMin,
  sliceMax,
  stepsPerFrame,
  onStepsPerFrame,
  onReset,
}: Props) {
  return (
    <div className="space-y-6">
      <section>
        <SectionLabel>regime</SectionLabel>
        <div className="mt-2.5 space-y-2">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => onMode(m.key)}
                className={[
                  "block w-full text-left rounded-xl px-3 py-2.5 transition-all duration-200 border",
                  active
                    ? "border-cyan-400/55 bg-cyan-400/[0.08] text-white shadow-[0_0_0_1px_rgba(86,224,255,0.2),inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "border-white/[0.07] bg-white/[0.02] text-white/65 hover:border-white/20 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
              >
                <div className="text-[13px] font-medium tracking-tight leading-tight">
                  {m.label}
                </div>
                <div className="text-[10px] tracking-[0.06em] text-white/40 mt-0.5">
                  {m.subtitle}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <SectionLabel>slicer</SectionLabel>
          <span className="font-mono text-[11px] text-white/60 tabular-nums">
            {sliceAxis} = {slicerOffset.toFixed(2)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {SLICE_AXES.map((a) => {
            const active = a.key === sliceAxis;
            return (
              <button
                key={a.key}
                onClick={() => onSliceAxis(a.key)}
                className={[
                  "rounded-lg px-1.5 py-1 text-[10.5px] tracking-tight transition-colors border",
                  active
                    ? "border-cyan-400/55 bg-cyan-400/[0.08] text-white"
                    : "border-white/[0.07] bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white",
                ].join(" ")}
                title={a.full}
              >
                {a.label}
              </button>
            );
          })}
        </div>
        <input
          type="range"
          min={sliceMin}
          max={sliceMax}
          step={0.005}
          value={slicerOffset}
          onChange={(e) => onSlicer(Number(e.target.value))}
          className="w-full"
        />
        <div className="text-[10px] text-white/40 mt-1.5 leading-snug">
          the 3D view clips the cortex at this plane; the 2D slice panel
          renders the cross-section curve, colored live by voltage.
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2.5">
          <SectionLabel>integration speed</SectionLabel>
          <span className="font-mono text-[11px] text-white/60 tabular-nums">
            {stepsPerFrame} steps / frame
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={16}
          step={1}
          value={stepsPerFrame}
          onChange={(e) => onStepsPerFrame(Number(e.target.value))}
          className="w-full"
        />
        <button
          onClick={onReset}
          className="mt-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/[0.05] hover:border-white/20 transition-colors"
        >
          reset state
        </button>
      </section>

      <section className="text-[10.5px] leading-relaxed text-white/50 border-t border-white/[0.06] pt-4">
        <div className="text-white/70 mb-1">interaction</div>
        click anywhere on the cortex to inject a Gaussian voltage perturbation
        of about 1.4 mV peak. The wave will then propagate, collide, and
        eventually annihilate against itself.
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">
      {children}
    </div>
  );
}
