"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  computeSliceSegments,
  endpointVoltage,
  type SliceAxis,
  type SliceSegment,
} from "@/lib/sliceContour";

type Props = {
  positions: Float32Array;
  indices: Uint32Array;
  voltageRef: React.MutableRefObject<Float32Array | null>;
  axis: SliceAxis;
  offset: number;
};

const AXIS_LABEL: Record<SliceAxis, string> = {
  x: "sagittal",
  y: "axial",
  z: "coronal",
};

const AXIS_AXES_2D: Record<SliceAxis, { u: string; v: string }> = {
  x: { u: "posterior <- z -> anterior", v: "inferior <- y -> superior" },
  y: { u: "right <- x -> left", v: "posterior <- z -> anterior" },
  z: { u: "right <- x -> left", v: "inferior <- y -> superior" },
};

function voltageColor(u: number): [number, number, number] {
  // Mirror of the GLSL colormap on the 3D side. Keep them in sync.
  const t = Math.max(0, Math.min(1, (u + 1.3) / 3.1));
  const dark: [number, number, number] = [0.012, 0.022, 0.055];
  const navy: [number, number, number] = [0.055, 0.11, 0.26];
  const cyan: [number, number, number] = [0.15, 0.58, 0.95];
  const white: [number, number, number] = [0.88, 0.96, 1.0];
  const pink: [number, number, number] = [1.0, 0.42, 0.9];
  const hot: [number, number, number] = [1.0, 0.88, 1.0];
  function mix(a: number[], b: number[], k: number): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  if (t < 0.15) return mix(dark, navy, t / 0.15);
  if (t < 0.4) return mix(navy, cyan, (t - 0.15) / 0.25);
  if (t < 0.6) return mix(cyan, white, (t - 0.4) / 0.2);
  if (t < 0.8) return mix(white, pink, (t - 0.6) / 0.2);
  return mix(pink, hot, (t - 0.8) / 0.2);
}

function emissionBoost(u: number): number {
  // Same shape as the shader: smoothstep(-0.5, 0.8, u).
  const t = Math.max(0, Math.min(1, (u + 0.5) / 1.3));
  return t * t * (3 - 2 * t);
}

export default function SliceView({ positions, indices, voltageRef, axis, offset }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Recompute segments whenever the slice axis or offset changes. This
  // is the expensive step (40k triangles) and happens only on slider
  // release, not every frame.
  const segments: SliceSegment[] = useMemo(
    () => computeSliceSegments(positions, indices, axis, offset),
    [positions, indices, axis, offset],
  );

  // Bounds for fitting the projected curve into the canvas.
  const bounds = useMemo(() => {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const s of segments) {
      if (s.p0u < minU) minU = s.p0u;
      if (s.p0u > maxU) maxU = s.p0u;
      if (s.p1u < minU) minU = s.p1u;
      if (s.p1u > maxU) maxU = s.p1u;
      if (s.p0v < minV) minV = s.p0v;
      if (s.p0v > maxV) maxV = s.p0v;
      if (s.p1v < minV) minV = s.p1v;
      if (s.p1v > maxV) maxV = s.p1v;
    }
    if (!isFinite(minU)) {
      // Use the mesh bounding box as a fallback for empty slices.
      minU = -1;
      maxU = 1;
      minV = -1;
      maxV = 1;
    }
    return { minU, maxU, minV, maxV };
  }, [segments]);

  // Animation loop: redraw each frame with current voltage.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 320;
      const cssH = canvas.clientHeight || 320;
      const targetW = Math.max(1, Math.floor(cssW * dpr));
      const targetH = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext("2d");
      const live = voltageRef.current;
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.fillStyle = "rgba(6, 8, 22, 1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (segments.length === 0 || !live) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = `${Math.round(11 * dpr)}px ui-sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(
          "slice is outside the cortex",
          canvas.width / 2,
          canvas.height / 2,
        );
        raf = requestAnimationFrame(draw);
        return;
      }

      const { minU, maxU, minV, maxV } = bounds;
      const margin = 18 * dpr;
      const spanU = Math.max(1e-6, maxU - minU);
      const spanV = Math.max(1e-6, maxV - minV);
      // Uniform scale so the cross-section keeps its proportions.
      const sx = (canvas.width - 2 * margin) / spanU;
      const sy = (canvas.height - 2 * margin) / spanV;
      const s = Math.min(sx, sy);
      const offsetX = (canvas.width - s * spanU) / 2 - s * minU;
      const offsetY = (canvas.height - s * spanV) / 2 + s * maxV;
      const proj = (u: number, v: number): [number, number] => [
        offsetX + s * u,
        offsetY - s * v,
      ];

      // First pass: dim outline so the cross-section is visible even at rest.
      ctx.lineWidth = Math.max(1, dpr * 1.0);
      ctx.lineCap = "round";
      for (const seg of segments) {
        const [x0, y0] = proj(seg.p0u, seg.p0v);
        const [x1, y1] = proj(seg.p1u, seg.p1v);
        ctx.strokeStyle = "rgba(80,120,200,0.18)";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // Second pass: colored segments by voltage. Use additive blending
      // so depolarized regions bloom.
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = Math.max(1.4, dpr * 1.4);
      for (const seg of segments) {
        const v0 = endpointVoltage(live, seg.e0a, seg.e0b, seg.e0w);
        const v1 = endpointVoltage(live, seg.e1a, seg.e1b, seg.e1w);
        const avg = (v0 + v1) * 0.5;
        if (avg < -0.6) continue; // Below threshold: leave the dim outline.
        const [r, g, b] = voltageColor(avg);
        const em = emissionBoost(avg);
        const a = 0.15 + em * 0.85;
        ctx.strokeStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(3)})`;
        const [x0, y0] = proj(seg.p0u, seg.p0v);
        const [x1, y1] = proj(seg.p1u, seg.p1v);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      // Plane axis label.
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = `${Math.round(9 * dpr)}px ui-sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(AXIS_AXES_2D[axis].u, margin, canvas.height - 8 * dpr);
      ctx.save();
      ctx.translate(canvas.width - 8 * dpr, canvas.height - margin);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "left";
      ctx.fillText(AXIS_AXES_2D[axis].v, 0, 0);
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [segments, bounds, axis, voltageRef]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-baseline justify-between px-1 mb-1.5 shrink-0">
        <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
          {AXIS_LABEL[axis]} slice
        </span>
        <span className="font-mono text-[10px] tabular-nums text-white/40">
          {axis} = {offset.toFixed(2)}  ·  {segments.length} segments
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full flex-1 min-h-0 rounded-lg"
        style={{ background: "#06081a" }}
      />
    </div>
  );
}
