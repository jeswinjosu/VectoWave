// ─────────────────────────────────────────────────────────────────────────────
//  Shape simplification: Ramer–Douglas–Peucker picks the anchors to keep from a
//  densely-flattened outline, then each span between kept anchors is refitted
//  with a least-squares cubic Bezier (Schneider) so curves stay smooth.
// ─────────────────────────────────────────────────────────────────────────────
import type { Anchor, PathGeometry, SubPath, Vec } from '../types/model';
import { add, dist, dot, mul, norm, sub } from './math';
import { detectMode, flattenSubPath, type Cubic } from './path';

/** Perpendicular distance from p to segment ab (falls back to point distance for degenerate ab). */
function segDist(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Iterative Douglas–Peucker. Returns the sorted indices to keep. */
export function douglasPeucker(pts: Vec[], epsilon: number, forced: Set<number> = new Set()): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  forced.forEach((i) => (keep[i] = 1));
  // Split on forced points first so they act as fixed boundaries
  const bounds = [...new Set([0, n - 1, ...forced])].sort((a, b) => a - b);
  const stack: [number, number][] = [];
  for (let i = 0; i < bounds.length - 1; i++) stack.push([bounds[i], bounds[i + 1]]);
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

// ── Schneider single-cubic least-squares fit with fixed end tangents ─────────

const B0 = (u: number) => (1 - u) ** 3;
const B1 = (u: number) => 3 * u * (1 - u) ** 2;
const B2 = (u: number) => 3 * u * u * (1 - u);
const B3 = (u: number) => u ** 3;

function bez(c: Cubic, u: number): Vec {
  return {
    x: B0(u) * c[0].x + B1(u) * c[1].x + B2(u) * c[2].x + B3(u) * c[3].x,
    y: B0(u) * c[0].y + B1(u) * c[1].y + B2(u) * c[2].y + B3(u) * c[3].y,
  };
}

function newtonReparam(c: Cubic, p: Vec, u: number): number {
  const d = sub(bez(c, u), p);
  const q1 = [mul(sub(c[1], c[0]), 3), mul(sub(c[2], c[1]), 3), mul(sub(c[3], c[2]), 3)];
  const q2 = [mul(sub(q1[1], q1[0]), 2), mul(sub(q1[2], q1[1]), 2)];
  const mu = 1 - u;
  const Q1 = add(add(mul(q1[0], mu * mu), mul(q1[1], 2 * u * mu)), mul(q1[2], u * u));
  const Q2 = add(mul(q2[0], mu), mul(q2[1], u));
  const num = dot(d, Q1);
  const den = dot(Q1, Q1) + dot(d, Q2);
  if (Math.abs(den) < 1e-12) return u;
  return Math.max(0, Math.min(1, u - num / den));
}

export function fitCubic(points: Vec[], tHat1: Vec, tHat2: Vec): Cubic {
  return fitCubicWithError(points, tHat1, tHat2).curve;
}

/** Least-squares fit + maximum deviation of the input points from the fitted curve. */
export function fitCubicWithError(points: Vec[], tHat1: Vec, tHat2: Vec): { curve: Cubic; error: number } {
  const p0 = points[0];
  const p3 = points[points.length - 1];
  const segLen = dist(p0, p3);
  // chord-length parameterisation
  const u: number[] = [0];
  for (let i = 1; i < points.length; i++) u.push(u[i - 1] + dist(points[i], points[i - 1]));
  const total = u[u.length - 1] || 1;
  for (let i = 0; i < u.length; i++) u[i] /= total;

  const solve = (): Cubic => {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < points.length; i++) {
      const a0 = mul(tHat1, B1(u[i]));
      const a1 = mul(tHat2, B2(u[i]));
      c00 += dot(a0, a0);
      c01 += dot(a0, a1);
      c11 += dot(a1, a1);
      const tmp = sub(points[i], add(mul(p0, B0(u[i]) + B1(u[i])), mul(p3, B2(u[i]) + B3(u[i]))));
      x0 += dot(a0, tmp);
      x1 += dot(a1, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
    let ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
    const eps = 1e-6 * segLen;
    if (!(al > eps) || !(ar > eps) || !isFinite(al) || !isFinite(ar)) al = ar = segLen / 3;
    // Clamp to avoid loops on noisy data
    al = Math.min(al, segLen * 1.2);
    ar = Math.min(ar, segLen * 1.2);
    return [p0, add(p0, mul(tHat1, al)), add(p3, mul(tHat2, ar)), p3];
  };

  let c = solve();
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 1; i < points.length - 1; i++) u[i] = newtonReparam(c, points[i], u[i]);
    c = solve();
  }
  let error = 0;
  for (let i = 1; i < points.length - 1; i++) error = Math.max(error, dist(bez(c, newtonReparam(c, points[i], u[i])), points[i]));
  return { curve: c, error };
}

function isCollinear(points: Vec[], tol: number) {
  const a = points[0];
  const b = points[points.length - 1];
  return points.every((p) => segDist(p, a, b) <= tol);
}

/** Turn angle (degrees) at sample i given neighbour samples. */
function turnAngle(prev: Vec, cur: Vec, next: Vec) {
  const a = norm(sub(cur, prev));
  const b = norm(sub(next, cur));
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
}

export function simplifySubPath(sp: SubPath, epsilon: number, keepCorners: boolean): SubPath {
  const minAnchors = sp.closed ? 3 : 2;
  if (sp.anchors.length <= minAnchors) return sp;
  const { pts, anchorIdx } = flattenSubPath(sp, 16);
  const n = pts.length;
  const at = (i: number) => (sp.closed ? pts[((i % (n - 1)) + (n - 1)) % (n - 1)] : pts[Math.max(0, Math.min(n - 1, i))]);

  const forced = new Set<number>();
  if (keepCorners) {
    for (const ai of anchorIdx) {
      if (ai === 0 || ai === n - 1) continue;
      if (turnAngle(at(ai - 1), at(ai), at(ai + 1)) > 35) forced.add(ai);
    }
  }
  let keep = douglasPeucker(pts, epsilon, forced);
  if (sp.closed) {
    // Closed paths: keep first == last; make sure we have at least 3 distinct anchors
    while (keep.length - 1 < 3) {
      let far = -1;
      let fd = -1;
      for (let i = 1; i < n - 1; i++) {
        if (keep.includes(i)) continue;
        const d = Math.min(...keep.map((k) => dist(pts[i], pts[k])));
        if (d > fd) {
          fd = d;
          far = i;
        }
      }
      if (far < 0) break;
      keep = [...keep, far].sort((a, b) => a - b);
    }
  }
  // Tangents at a sample index (from dense neighbour samples); smooth points share one tangent
  const tangentAt = (k: number) => {
    const prev = k === 0 && !sp.closed ? null : at(k - 1);
    const next = k === n - 1 && !sp.closed ? null : at(k + 1);
    const p = pts[k];
    let tIn = prev ? norm(sub(prev, p)) : null; // points backwards
    let tOut = next ? norm(sub(next, p)) : null;
    if (tIn && tOut) {
      const angle = turnAngle(prev!, p, next!);
      if (angle < 25) {
        const t = norm(sub(tOut, tIn));
        tOut = t;
        tIn = mul(t, -1);
      }
    }
    return { tIn, tOut };
  };
  const tol = Math.max(epsilon * 0.25, 0.01);
  const spanFit = (a: number, b: number) => {
    const span = pts.slice(a, b + 1);
    if (span.length < 3 || isCollinear(span, tol)) return { curve: null, error: isCollinear(span, epsilon) ? 0 : Infinity };
    const t1 = tangentAt(a).tOut ?? norm(sub(span[span.length - 1], span[0]));
    const t2 = tangentAt(b).tIn ?? norm(sub(span[0], span[span.length - 1]));
    return fitCubicWithError(span, t1, t2);
  };
  // Douglas–Peucker over-keeps points on curves (it measures straight-line deviation),
  // so greedily drop key points whose neighbours can be bridged by ONE cubic within tolerance.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 1; i < keep.length - 1; i++) {
      if (forced.has(keep[i])) continue;
      if (sp.closed && keep.length - 1 <= 3) break;
      if (!sp.closed && keep.length <= 2) break;
      if (spanFit(keep[i - 1], keep[i + 1]).error <= epsilon) {
        keep.splice(i, 1);
        i--;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const tangents = keep.map(tangentAt);

  const count = sp.closed ? keep.length - 1 : keep.length;
  const anchors: Anchor[] = [];
  for (let i = 0; i < count; i++) {
    const p = pts[keep[i]];
    anchors.push({ x: p.x, y: p.y, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' });
  }
  for (let i = 0; i < keep.length - 1; i++) {
    const span = pts.slice(keep[i], keep[i + 1] + 1);
    if (span.length < 2) continue;
    if (isCollinear(span, tol)) continue; // straight line → no handles
    const t1 = tangents[i].tOut ?? norm(sub(span[span.length - 1], span[0]));
    const t2 = tangents[i + 1].tIn ?? norm(sub(span[0], span[span.length - 1]));
    const c = fitCubic(span, t1, t2);
    const a = anchors[i];
    const bIdx = (i + 1) % anchors.length;
    const b = anchors[bIdx];
    a.outX = c[1].x - c[0].x;
    a.outY = c[1].y - c[0].y;
    b.inX = c[2].x - c[3].x;
    b.inY = c[2].y - c[3].y;
  }
  anchors.forEach((a) => (a.mode = detectMode(a)));
  return { closed: sp.closed, anchors };
}

/**
 * @param amount 0–100 (UI slider). 0 = untouched.
 * @param diag   diagonal of the artwork, so tolerance scales with drawing size.
 */
export function simplifyGeometry(g: PathGeometry, amount: number, diag: number): PathGeometry {
  if (amount <= 0) return g;
  const t = amount / 100;
  const epsilon = diag * (0.0008 + 0.045 * t * t);
  const result: PathGeometry = {
    subpaths: g.subpaths.map((sp) => simplifySubPath(sp, epsilon, t < 0.7)),
  };
  // Never return something with *more* anchors than the original
  const before = g.subpaths.reduce((s, sp) => s + sp.anchors.length, 0);
  const after = result.subpaths.reduce((s, sp) => s + sp.anchors.length, 0);
  return after < before ? result : g;
}
