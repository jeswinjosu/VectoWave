import type { Easing, EasingType } from '../types/model';

export const EASING_PRESETS: Record<Exclude<EasingType, 'custom'>, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  hold: [0, 0, 1, 1],
};

export const EASING_LABELS: Record<EasingType, string> = {
  linear: 'Linear',
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  easeInOut: 'Ease In-Out',
  hold: 'Hold',
  custom: 'Custom Bezier',
};

export const makeEasing = (type: EasingType, bezier?: [number, number, number, number]): Easing => ({
  type,
  bezier: bezier ?? (type === 'custom' ? [0.25, 0.1, 0.25, 1] : [...EASING_PRESETS[type]]),
});

export const DEFAULT_EASING: Easing = makeEasing('easeInOut');

/** Solve cubic-bezier(x1,y1,x2,y2) at progress x (CSS semantics). Newton with bisection fallback. */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x; // linear
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) return sampleY(t);
    const d = dX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const v = sampleX(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

export function applyEasing(e: Easing, t: number): number {
  if (e.type === 'hold') return t >= 1 ? 1 : 0;
  if (e.type === 'linear') return t;
  const [a, b, c, d] = e.bezier;
  return cubicBezierEase(a, b, c, d, t);
}

export const easingToCss = (e: Easing) =>
  e.type === 'hold' ? 'steps(1, end)' : e.type === 'linear' ? 'linear' : `cubic-bezier(${e.bezier.join(', ')})`;
