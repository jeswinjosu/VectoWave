// ─────────────────────────────────────────────────────────────────────────────
//  Path engine: parse SVG path data → absolute cubic segments → anchor model,
//  serialization, Bezier maths (split / nearest point / bounds), and helpers
//  for anchor editing + morph normalization.
// ─────────────────────────────────────────────────────────────────────────────
import type { Anchor, HandleMode, PathGeometry, SubPath, Vec } from '../types/model';
import { type BBox, type Mat, apply, applyLinear, boxAdd, dist, emptyBox, lerp, round } from './math';

// ── Tokenizer / parser ───────────────────────────────────────────────────────

type Cmd = { c: string; args: number[] };

const ARG_COUNT: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Tokenise path data. Handles compact forms like "M10-5.5.5", exponents and arc flags ("a1 1 0 0110 10"). */
export function tokenizePath(d: string): Cmd[] {
  const cmds: Cmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let cur: Cmd | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1]) {
      cur = { c: m[1], args: [] };
      cmds.push(cur);
    } else if (cur) {
      const lc = cur.c.toLowerCase();
      // Arc flags may be written without separators: "0110" → 0,1,10
      if (lc === 'a') {
        const pos = cur.args.length % 7;
        if ((pos === 3 || pos === 4) && /^[01]\d/.test(m[2])) {
          cur.args.push(Number(m[2][0]));
          re.lastIndex = m.index + 1;
          continue;
        }
      }
      cur.args.push(parseFloat(m[2]));
    }
  }
  // Expand implicit repeats (e.g. "L 1 2 3 4", implicit lineto after moveto)
  const out: Cmd[] = [];
  for (const cmd of cmds) {
    const lc = cmd.c.toLowerCase();
    const n = ARG_COUNT[lc];
    if (n === 0) {
      out.push({ c: cmd.c, args: [] });
      continue;
    }
    for (let i = 0; i + n <= cmd.args.length; i += n) {
      let c = cmd.c;
      if (i > 0 && lc === 'm') c = cmd.c === 'm' ? 'l' : 'L';
      out.push({ c, args: cmd.args.slice(i, i + n) });
    }
  }
  return out;
}

/** Absolute cubic segment list per subpath. */
export interface CubicSub {
  start: Vec;
  segs: { c1: Vec; c2: Vec; p: Vec }[];
  closed: boolean;
}

function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  angle: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): { c1: Vec; c2: Vec; p: Vec }[] {
  // SVG spec F.6.5 endpoint → centre parameterisation
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, p: { x: x2, y: y2 } }];
  }
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const segCount = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / segCount;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out: { c1: Vec; c2: Vec; p: Vec }[] = [];
  const pt = (t: number) => {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    return {
      x: cx + rx * ct * cos - ry * st * sin,
      y: cy + rx * ct * sin + ry * st * cos,
      dx: -rx * st * cos - ry * ct * sin,
      dy: -rx * st * sin + ry * ct * cos,
    };
  };
  let t = theta1;
  for (let i = 0; i < segCount; i++) {
    const a = pt(t);
    const b = pt(t + delta);
    out.push({
      c1: { x: a.x + k * a.dx, y: a.y + k * a.dy },
      c2: { x: b.x - k * b.dx, y: b.y - k * b.dy },
      p: { x: b.x, y: b.y },
    });
    t += delta;
  }
  // Snap final point exactly to the requested end point
  out[out.length - 1].p = { x: x2, y: y2 };
  return out;
}

/** Parse any SVG path data string into absolute cubic subpaths. */
export function parsePathToCubics(d: string): CubicSub[] {
  const cmds = tokenizePath(d);
  const subs: CubicSub[] = [];
  let cur: CubicSub | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC2: Vec | null = null; // for S
  let lastQ: Vec | null = null; // for T
  const ensure = () => {
    if (!cur) {
      cur = { start: { x, y }, segs: [], closed: false };
      subs.push(cur);
    }
    return cur;
  };
  const line = (nx: number, ny: number) => {
    ensure().segs.push({ c1: { x, y }, c2: { x: nx, y: ny }, p: { x: nx, y: ny } });
    x = nx;
    y = ny;
  };
  for (const { c, args: a } of cmds) {
    const rel = c === c.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const lc = c.toLowerCase();
    let nextC2: Vec | null = null;
    let nextQ: Vec | null = null;
    switch (lc) {
      case 'm':
        x = a[0] + ox;
        y = a[1] + oy;
        sx = x;
        sy = y;
        cur = { start: { x, y }, segs: [], closed: false };
        subs.push(cur);
        break;
      case 'l':
        line(a[0] + ox, a[1] + oy);
        break;
      case 'h':
        line(a[0] + ox, y);
        break;
      case 'v':
        line(x, a[0] + oy);
        break;
      case 'c': {
        const c1 = { x: a[0] + ox, y: a[1] + oy };
        const c2 = { x: a[2] + ox, y: a[3] + oy };
        const p = { x: a[4] + ox, y: a[5] + oy };
        ensure().segs.push({ c1, c2, p });
        x = p.x;
        y = p.y;
        nextC2 = c2;
        break;
      }
      case 's': {
        const c1 = lastC2 ? { x: 2 * x - lastC2.x, y: 2 * y - lastC2.y } : { x, y };
        const c2 = { x: a[0] + ox, y: a[1] + oy };
        const p = { x: a[2] + ox, y: a[3] + oy };
        ensure().segs.push({ c1, c2, p });
        x = p.x;
        y = p.y;
        nextC2 = c2;
        break;
      }
      case 'q':
      case 't': {
        const q: Vec =
          lc === 'q'
            ? { x: a[0] + ox, y: a[1] + oy }
            : lastQ
              ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y }
              : { x, y };
        const p = lc === 'q' ? { x: a[2] + ox, y: a[3] + oy } : { x: a[0] + ox, y: a[1] + oy };
        ensure().segs.push({
          c1: { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
          c2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
          p,
        });
        x = p.x;
        y = p.y;
        nextQ = q;
        break;
      }
      case 'a': {
        const ex = a[5] + ox;
        const ey = a[6] + oy;
        const segs = arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey);
        ensure().segs.push(...segs);
        x = ex;
        y = ey;
        break;
      }
      case 'z':
        if (cur) {
          (cur as CubicSub).closed = true;
        }
        x = sx;
        y = sy;
        cur = null;
        break;
    }
    lastC2 = nextC2;
    lastQ = nextQ;
  }
  return subs.filter((s) => s.segs.length > 0 || subs.length === 1);
}

// ── Cubic subpaths ↔ anchor model ────────────────────────────────────────────

const EPS = 1e-6;

export function detectMode(a: Anchor): HandleMode {
  const li = Math.hypot(a.inX, a.inY);
  const lo = Math.hypot(a.outX, a.outY);
  if (li < EPS && lo < EPS) return 'corner';
  if (li < EPS || lo < EPS) return 'disconnected';
  const cross = (a.inX * a.outY - a.inY * a.outX) / (li * lo);
  const dotp = (a.inX * a.outX + a.inY * a.outY) / (li * lo);
  if (Math.abs(cross) < 0.02 && dotp < 0) {
    return Math.abs(li - lo) / Math.max(li, lo) < 0.02 ? 'mirrored' : 'asymmetric';
  }
  return 'disconnected';
}

export function cubicsToGeometry(subs: CubicSub[]): PathGeometry {
  const subpaths: SubPath[] = [];
  for (const s of subs) {
    const anchors: Anchor[] = [
      { x: s.start.x, y: s.start.y, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' },
    ];
    for (const seg of s.segs) {
      const prev = anchors[anchors.length - 1];
      prev.outX = seg.c1.x - prev.x;
      prev.outY = seg.c1.y - prev.y;
      anchors.push({
        x: seg.p.x,
        y: seg.p.y,
        inX: seg.c2.x - seg.p.x,
        inY: seg.c2.y - seg.p.y,
        outX: 0,
        outY: 0,
        mode: 'corner',
      });
    }
    let closed = s.closed;
    if (anchors.length > 1) {
      const first = anchors[0];
      const last = anchors[anchors.length - 1];
      if (Math.abs(first.x - last.x) < 1e-3 && Math.abs(first.y - last.y) < 1e-3) {
        // Explicit closing segment ended on the start point → merge
        if (closed) {
          first.inX = last.inX;
          first.inY = last.inY;
          anchors.pop();
          closed = true;
        }
      }
    }
    // Straight-line segments produce handles that coincide with their anchors; zero them
    for (const a of anchors) {
      if (Math.hypot(a.inX, a.inY) < 1e-4) a.inX = a.inY = 0;
      if (Math.hypot(a.outX, a.outY) < 1e-4) a.outX = a.outY = 0;
    }
    // Remove degenerate line-handles: for a straight segment c1==p0 and c2==p3 → already zero.
    for (const a of anchors) a.mode = detectMode(a);
    if (anchors.length > 0) subpaths.push({ anchors, closed });
  }
  return { subpaths };
}

export const parsePathData = (d: string): PathGeometry => cubicsToGeometry(parsePathToCubics(d));

const fmt = (n: number) => {
  const r = round(n, 2);
  return Object.is(r, -0) ? '0' : String(r);
};

export function segmentIsLine(a: Anchor, b: Anchor) {
  return a.outX === 0 && a.outY === 0 && b.inX === 0 && b.inY === 0;
}

/** Serialize to compact absolute path data. */
export function geometryToPath(g: PathGeometry): string {
  let d = '';
  for (const sp of g.subpaths) {
    const A = sp.anchors;
    if (!A.length) continue;
    d += `M${fmt(A[0].x)} ${fmt(A[0].y)}`;
    const n = sp.closed ? A.length : A.length - 1;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      const b = A[(i + 1) % A.length];
      if (segmentIsLine(a, b)) {
        if (!(sp.closed && i === A.length - 1)) d += `L${fmt(b.x)} ${fmt(b.y)}`;
      } else {
        d += `C${fmt(a.x + a.outX)} ${fmt(a.y + a.outY)} ${fmt(b.x + b.inX)} ${fmt(b.y + b.inY)} ${fmt(b.x)} ${fmt(b.y)}`;
      }
    }
    if (sp.closed) d += 'Z';
  }
  return d;
}

/** Serialization cache keyed by object identity (geometry objects are immutable in the store). */
const pathCache = new WeakMap<PathGeometry, string>();
export function pathString(g: PathGeometry): string {
  let s = pathCache.get(g);
  if (s === undefined) {
    s = geometryToPath(g);
    pathCache.set(g, s);
  }
  return s;
}

// ── Bezier maths ─────────────────────────────────────────────────────────────

export type Cubic = [Vec, Vec, Vec, Vec];

export function segmentCubic(sp: SubPath, i: number): Cubic {
  const a = sp.anchors[i];
  const b = sp.anchors[(i + 1) % sp.anchors.length];
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.outX, y: a.y + a.outY },
    { x: b.x + b.inX, y: b.y + b.inY },
    { x: b.x, y: b.y },
  ];
}

export const segmentCount = (sp: SubPath) =>
  sp.anchors.length < 2 ? 0 : sp.closed ? sp.anchors.length : sp.anchors.length - 1;

export function cubicAt(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

/** de Casteljau split. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const l = (p: Vec, q: Vec) => ({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });
  const p01 = l(c[0], c[1]);
  const p12 = l(c[1], c[2]);
  const p23 = l(c[2], c[3]);
  const p012 = l(p01, p12);
  const p123 = l(p12, p23);
  const m = l(p012, p123);
  return [
    [c[0], p01, p012, m],
    [m, p123, p23, c[3]],
  ];
}

export function nearestOnCubic(c: Cubic, p: Vec): { t: number; d: number; pt: Vec } {
  let best = { t: 0, d: Infinity, pt: c[0] };
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const q = cubicAt(c, t);
    const d = dist(p, q);
    if (d < best.d) best = { t, d, pt: q };
  }
  // Refine by ternary-ish local search
  let step = 1 / N;
  for (let k = 0; k < 12; k++) {
    step /= 2;
    for (const t of [best.t - step, best.t + step]) {
      if (t < 0 || t > 1) continue;
      const q = cubicAt(c, t);
      const d = dist(p, q);
      if (d < best.d) best = { t, d, pt: q };
    }
  }
  return best;
}

export function geometryBBox(g: PathGeometry, m?: Mat): BBox {
  const b = emptyBox();
  for (const sp of g.subpaths) {
    if (sp.anchors.length === 1) boxAdd(b, m ? apply(m, sp.anchors[0]) : sp.anchors[0]);
    const n = segmentCount(sp);
    for (let i = 0; i < n; i++) {
      const c = segmentCubic(sp, i);
      const cc = m ? (c.map((p) => apply(m, p)) as Cubic) : c;
      for (let s = 0; s <= 12; s++) boxAdd(b, cubicAt(cc, s / 12));
    }
  }
  return b;
}

/** Sample a subpath densely: returns points + flags marking original anchor indices. */
export function flattenSubPath(sp: SubPath, samplesPerSeg = 12): { pts: Vec[]; anchorIdx: number[] } {
  const pts: Vec[] = [];
  const anchorIdx: number[] = [];
  const n = segmentCount(sp);
  if (n === 0) return { pts: sp.anchors.map((a) => ({ x: a.x, y: a.y })), anchorIdx: [0] };
  for (let i = 0; i < n; i++) {
    const c = segmentCubic(sp, i);
    anchorIdx.push(pts.length);
    const isLine = segmentIsLine(sp.anchors[i], sp.anchors[(i + 1) % sp.anchors.length]);
    const steps = isLine ? 1 : samplesPerSeg;
    for (let s = 0; s < steps; s++) pts.push(cubicAt(c, s / steps));
  }
  // final point (for closed paths this equals pts[0])
  const last = sp.closed ? sp.anchors[0] : sp.anchors[sp.anchors.length - 1];
  pts.push({ x: last.x, y: last.y });
  return { pts, anchorIdx };
}

export function anchorCount(g: PathGeometry) {
  return g.subpaths.reduce((s, sp) => s + sp.anchors.length, 0);
}

// ── Geometry transforms & editing helpers ────────────────────────────────────

export function cloneGeometry(g: PathGeometry): PathGeometry {
  return { subpaths: g.subpaths.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) })) };
}

export function transformGeometry(g: PathGeometry, m: Mat): PathGeometry {
  return {
    subpaths: g.subpaths.map((s) => ({
      closed: s.closed,
      anchors: s.anchors.map((a) => {
        const p = apply(m, a);
        const i = applyLinear(m, { x: a.inX, y: a.inY });
        const o = applyLinear(m, { x: a.outX, y: a.outY });
        return { x: p.x, y: p.y, inX: i.x, inY: i.y, outX: o.x, outY: o.y, mode: a.mode };
      }),
    })),
  };
}

/** Insert a new anchor into segment `seg` of subpath `sub` at parameter t, preserving the curve shape. */
export function insertAnchor(g: PathGeometry, sub: number, seg: number, t: number): PathGeometry {
  const out = cloneGeometry(g);
  const sp = out.subpaths[sub];
  if (!sp) return out;
  const n = sp.anchors.length;
  const c = segmentCubic(sp, seg);
  const a = sp.anchors[seg];
  const bIdx = (seg + 1) % n;
  const b = sp.anchors[bIdx];
  const line = segmentIsLine(a, b);
  const [l, r] = splitCubic(c, t);
  const m = l[3];
  const na: Anchor = line
    ? { x: m.x, y: m.y, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' }
    : { x: m.x, y: m.y, inX: l[2].x - m.x, inY: l[2].y - m.y, outX: r[1].x - m.x, outY: r[1].y - m.y, mode: 'asymmetric' };
  if (!line) {
    a.outX = l[1].x - a.x;
    a.outY = l[1].y - a.y;
    b.inX = r[2].x - b.x;
    b.inY = r[2].y - b.y;
    na.mode = detectMode(na);
  }
  sp.anchors.splice(seg + 1, 0, na);
  return out;
}

export function deleteAnchors(g: PathGeometry, targets: { sub: number; idx: number }[]): PathGeometry {
  const out = cloneGeometry(g);
  const bySub = new Map<number, Set<number>>();
  targets.forEach((t) => {
    if (!bySub.has(t.sub)) bySub.set(t.sub, new Set());
    bySub.get(t.sub)!.add(t.idx);
  });
  out.subpaths = out.subpaths
    .map((sp, si) => {
      const del = bySub.get(si);
      if (!del) return sp;
      return { ...sp, anchors: sp.anchors.filter((_, i) => !del.has(i)) };
    })
    .filter((sp) => sp.anchors.length > 0);
  return out;
}

/** Apply a handle-mode constraint after one side changed. */
export function constrainHandles(a: Anchor, changed: 'in' | 'out'): Anchor {
  const r = { ...a };
  const [cx, cy, ox, oy] = changed === 'in' ? [r.inX, r.inY, r.outX, r.outY] : [r.outX, r.outY, r.inX, r.inY];
  const cl = Math.hypot(cx, cy);
  let nx = ox;
  let ny = oy;
  if (r.mode === 'mirrored') {
    nx = -cx;
    ny = -cy;
  } else if (r.mode === 'asymmetric' && cl > EPS) {
    const ol = Math.hypot(ox, oy);
    nx = (-cx / cl) * ol;
    ny = (-cy / cl) * ol;
  }
  if (changed === 'in') {
    r.outX = nx;
    r.outY = ny;
  } else {
    r.inX = nx;
    r.inY = ny;
  }
  return r;
}

/** Change an anchor's handle mode, generating sensible handles when converting from a corner. */
export function setAnchorMode(sp: SubPath, idx: number, mode: HandleMode): Anchor {
  const a = { ...sp.anchors[idx], mode };
  const n = sp.anchors.length;
  if (mode === 'corner') {
    a.inX = a.inY = a.outX = a.outY = 0;
    return a;
  }
  const hasHandles = Math.hypot(a.inX, a.inY) > EPS || Math.hypot(a.outX, a.outY) > EPS;
  if (!hasHandles) {
    const prev = sp.anchors[(idx - 1 + n) % n];
    const next = sp.anchors[(idx + 1) % n];
    const hasPrev = sp.closed || idx > 0;
    const hasNext = sp.closed || idx < n - 1;
    let tx = (hasNext ? next.x : a.x) - (hasPrev ? prev.x : a.x);
    let ty = (hasNext ? next.y : a.y) - (hasPrev ? prev.y : a.y);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const dPrev = hasPrev ? dist(a, prev) / 3 : 0;
    const dNext = hasNext ? dist(a, next) / 3 : 0;
    const l = mode === 'mirrored' ? (dPrev + dNext) / 2 || 20 : 0;
    a.inX = -tx * (mode === 'mirrored' ? l : dPrev || 20);
    a.inY = -ty * (mode === 'mirrored' ? l : dPrev || 20);
    a.outX = tx * (mode === 'mirrored' ? l : dNext || 20);
    a.outY = ty * (mode === 'mirrored' ? l : dNext || 20);
    return a;
  }
  if (mode === 'mirrored' || mode === 'asymmetric') {
    // Align: keep out handle direction, adjust in
    const lo = Math.hypot(a.outX, a.outY);
    const li = Math.hypot(a.inX, a.inY);
    let dx = a.outX - a.inX;
    let dy = a.outY - a.inY;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const avg = (lo + li) / 2;
    const lOut = mode === 'mirrored' ? avg : lo;
    const lIn = mode === 'mirrored' ? avg : li;
    a.outX = dx * lOut;
    a.outY = dy * lOut;
    a.inX = -dx * lIn;
    a.inY = -dy * lIn;
  }
  return a;
}

// ── Primitive builders ───────────────────────────────────────────────────────

const corner = (x: number, y: number): Anchor => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' });

export function rectGeometry(x: number, y: number, w: number, h: number, rx = 0, ry = rx): PathGeometry {
  rx = Math.min(Math.abs(rx), w / 2);
  ry = Math.min(Math.abs(ry), h / 2);
  if (rx <= 0 || ry <= 0) {
    return { subpaths: [{ closed: true, anchors: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] }] };
  }
  const k = 0.5523;
  const mk = (ax: number, ay: number, ix: number, iy: number, ox: number, oy: number): Anchor => ({
    x: ax,
    y: ay,
    inX: ix,
    inY: iy,
    outX: ox,
    outY: oy,
    mode: 'disconnected',
  });
  return {
    subpaths: [
      {
        closed: true,
        anchors: [
          mk(x + rx, y, -rx * k, 0, 0, 0),
          mk(x + w - rx, y, 0, 0, rx * k, 0),
          mk(x + w, y + ry, 0, -ry * k, 0, 0),
          mk(x + w, y + h - ry, 0, 0, 0, ry * k),
          mk(x + w - rx, y + h, rx * k, 0, 0, 0),
          mk(x + rx, y + h, 0, 0, -rx * k, 0),
          mk(x, y + h - ry, 0, ry * k, 0, 0),
          mk(x, y + ry, 0, 0, 0, -ry * k),
        ],
      },
    ],
  };
}

export function ellipseGeometry(cx: number, cy: number, rx: number, ry: number): PathGeometry {
  const k = 0.5522847498;
  const m = (x: number, y: number, ix: number, iy: number): Anchor => ({
    x,
    y,
    inX: ix,
    inY: iy,
    outX: -ix,
    outY: -iy,
    mode: 'mirrored',
  });
  return {
    subpaths: [
      {
        closed: true,
        anchors: [
          m(cx, cy - ry, -rx * k, 0),
          m(cx + rx, cy, 0, -ry * k),
          m(cx, cy + ry, rx * k, 0),
          m(cx - rx, cy, 0, ry * k),
        ],
      },
    ],
  };
}

export function polyGeometry(points: Vec[], closed: boolean): PathGeometry {
  return { subpaths: [{ closed, anchors: points.map((p) => corner(p.x, p.y)) }] };
}

// ── Morph normalisation ──────────────────────────────────────────────────────

function subdivideLongest(sp: SubPath): SubPath {
  const n = segmentCount(sp);
  if (n === 0) {
    const a = sp.anchors[0];
    return { ...sp, anchors: [...sp.anchors, { ...a }] };
  }
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < n; i++) {
    const c = segmentCubic(sp, i);
    const l = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  return insertAnchor({ subpaths: [sp] }, 0, best, 0.5).subpaths[0];
}

/**
 * Make two geometries structurally compatible for interpolation:
 * equal subpath counts (degenerate point-subpaths are added) and equal anchor counts
 * per subpath (longest segments are subdivided without changing shape).
 */
export function normalizePair(a: PathGeometry, b: PathGeometry): [PathGeometry, PathGeometry] {
  if (compatible(a, b)) return [a, b];
  const A = cloneGeometry(a);
  const B = cloneGeometry(b);
  const pad = (g: PathGeometry, other: PathGeometry) => {
    while (g.subpaths.length < other.subpaths.length) {
      const src = other.subpaths[g.subpaths.length];
      const bb = geometryBBox({ subpaths: [src] });
      const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
      g.subpaths.push({ closed: src.closed, anchors: [corner(c.x, c.y)] });
    }
  };
  pad(A, B);
  pad(B, A);
  for (let i = 0; i < A.subpaths.length; i++) {
    let guard = 0;
    while (A.subpaths[i].anchors.length < B.subpaths[i].anchors.length && guard++ < 500)
      A.subpaths[i] = subdivideLongest(A.subpaths[i]);
    while (B.subpaths[i].anchors.length < A.subpaths[i].anchors.length && guard++ < 500)
      B.subpaths[i] = subdivideLongest(B.subpaths[i]);
  }
  return [A, B];
}

export function compatible(a: PathGeometry, b: PathGeometry) {
  if (a.subpaths.length !== b.subpaths.length) return false;
  for (let i = 0; i < a.subpaths.length; i++)
    if (a.subpaths[i].anchors.length !== b.subpaths[i].anchors.length) return false;
  return true;
}

export function lerpGeometry(a: PathGeometry, b: PathGeometry, t: number): PathGeometry {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [A, B] = normalizePair(a, b);
  return {
    subpaths: A.subpaths.map((sa, si) => {
      const sb = B.subpaths[si];
      return {
        closed: t < 0.5 ? sa.closed : sb.closed,
        anchors: sa.anchors.map((pa, i) => {
          const pb = sb.anchors[i];
          return {
            x: lerp(pa.x, pb.x, t),
            y: lerp(pa.y, pb.y, t),
            inX: lerp(pa.inX, pb.inX, t),
            inY: lerp(pa.inY, pb.inY, t),
            outX: lerp(pa.outX, pb.outX, t),
            outY: lerp(pa.outY, pb.outY, t),
            mode: t < 0.5 ? pa.mode : pb.mode,
          };
        }),
      };
    }),
  };
}
