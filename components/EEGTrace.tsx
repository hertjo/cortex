"use client";

import { useEffect, useMemo, useRef } from "react";
import { ACCENT_CYAN, ACCENT_PINK } from "@/lib/colormap";

type Props = {
  /** Push a new sample tuple here on each frame. */
  sampleRef: React.MutableRefObject<[number, number, number] | null>;
  /** Number of samples to keep in the rolling window. */
  window?: number;
};

const DEFAULT_WINDOW = 480;
const HEIGHT = 110;

export default function EEGTrace({ sampleRef, window = DEFAULT_WINDOW }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buffers = useMemo(() => {
    return {
      ch0: new Float32Array(window),
      ch1: new Float32Array(window),
      ch2: new Float32Array(window),
      head: 0,
    };
  }, [window]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 600;
      const targetW = Math.max(1, Math.floor(cssW * dpr));
      const targetH = Math.max(1, Math.floor(HEIGHT * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // Push the latest sample if one is queued.
      if (sampleRef.current) {
        const [a, b, c] = sampleRef.current;
        buffers.ch0[buffers.head] = a;
        buffers.ch1[buffers.head] = b;
        buffers.ch2[buffers.head] = c;
        buffers.head = (buffers.head + 1) % window;
        sampleRef.current = null;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawChannel(ctx, buffers.ch0, buffers.head, window, canvas.width, canvas.height, 0, ACCENT_CYAN);
      drawChannel(ctx, buffers.ch1, buffers.head, window, canvas.width, canvas.height, 1, "#a4b8e6");
      drawChannel(ctx, buffers.ch2, buffers.head, window, canvas.width, canvas.height, 2, ACCENT_PINK);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [buffers, sampleRef, window]);

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1 px-1">
        <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
          synthetic eeg
        </span>
        <span className="text-[10px] uppercase tracking-[0.24em] text-white/30">
          F3  C3  P3
        </span>
      </div>
      <canvas ref={canvasRef} className="w-full block" style={{ height: HEIGHT }} />
    </div>
  );
}

function drawChannel(
  ctx: CanvasRenderingContext2D,
  buf: Float32Array,
  head: number,
  n: number,
  w: number,
  h: number,
  channel: number,
  color: string,
) {
  const rowH = h / 3;
  const baseline = rowH * (channel + 0.5);
  const amp = rowH * 0.42;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.min(2, w / 800));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const idx = (head + i) % n;
    const x = (i / (n - 1)) * w;
    const y = baseline - Math.max(-1.4, Math.min(1.4, buf[idx])) * amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Faint divider line under each channel.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baseline + amp + 4);
  ctx.lineTo(w, baseline + amp + 4);
  ctx.stroke();
}
