/**
 * Voltage colormap. The FitzHugh-Nagumo u variable lives roughly on
 * [-2.5, +2.0]. We map:
 *
 *   u <= -1   : deep navy (resting)
 *   u =  0    : near-black with cyan tint
 *   u =  1    : warm pink
 *   u >= 1.5  : near-white with magenta glow
 *
 * The shader does the final mix; this function is used for sampling on
 * the JS side (e.g. EEG trace coloring).
 */

export type RGB = [number, number, number];

export function voltageToColor(u: number): RGB {
  const x = Math.max(-2.5, Math.min(2.0, u));
  // Normalize to [0, 1] across the active range.
  const t = (x + 2.5) / 4.5;
  // Three-stop ramp: navy -> cyan -> white -> magenta.
  const stops: RGB[] = [
    [0.025, 0.04, 0.09],
    [0.07, 0.45, 0.85],
    [0.62, 0.92, 0.98],
    [0.95, 0.6, 0.95],
    [1.0, 0.78, 0.95],
  ];
  const segs = stops.length - 1;
  const s = Math.min(segs - 1e-6, t * segs);
  const i = Math.floor(s);
  const f = s - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const ACCENT_CYAN = "#56e0ff";
export const ACCENT_PINK = "#ff7adb";
