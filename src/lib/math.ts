import type { Vec } from '../types/model';

/** 2D affine matrix in SVG order: [a, b, c, d, e, f] ⇒ x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, p = 3) => {
  const f = 10 ** p;
  return Math.round(v * f) / f;
};

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export const apply = (m: Mat, p: Vec): Vec => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

/** Apply only the linear part (for vectors / handle offsets). */
export const applyLinear = (m: Mat, p: Vec): Vec => ({
  x: m[0] * p.x + m[2] * p.y,
  y: m[1] * p.x + m[3] * p.y,
});

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleM = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];
export const rotateM = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};

/**
 * Node local transform: T(position) · T(origin) · R(rotation) · S(scale) · T(−origin)
 * Equivalent to CSS `translate` + `rotate` + `scale` with transform-origin = origin,
 * and to Lottie with anchor = origin and position = origin + position.
 */
export function composeTransform(position: Vec, origin: Vec, rotation: number, scale: Vec): Mat {
  let m = translate(position.x + origin.x, position.y + origin.y);
  if (rotation) m = multiply(m, rotateM(rotation));
  if (scale.x !== 1 || scale.y !== 1) m = multiply(m, scaleM(scale.x, scale.y));
  return multiply(m, translate(-origin.x, -origin.y));
}

export function matToString(m: Mat): string {
  return `matrix(${m.map((n) => round(n, 5)).join(' ')})`;
}

export const matScaleFactor = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export const emptyBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export const boxValid = (b: BBox) => b.minX <= b.maxX && b.minY <= b.maxY;
export function boxAdd(b: BBox, p: Vec) {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}
export function boxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
export const boxCenter = (b: BBox): Vec => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
export function transformBox(b: BBox, m: Mat): BBox {
  const out = emptyBox();
  [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].forEach((p) => boxAdd(out, apply(m, p)));
  return out;
}

let idCounter = 0;
export function uid(prefix = 'n'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}${idCounter.toString(36)}`;
}
