// ─────────────────────────────────────────────────────────────────────────────
//  Lottie (Bodymovin 5.x) exporter. Groups → null layers (parented),
//  paths → shape layers with sh / fl / st / tr items. Every animatable property
//  maps 1:1 onto a Lottie keyframed property with cubic-bezier i/o tangents.
// ─────────────────────────────────────────────────────────────────────────────
import type { AnimState, DocumentModel, Easing, Keyframe, PathGeometry, PathNode, SceneNode, Vec } from '../../types/model';
import { hexToLottie } from '../color';
import { evaluateNode, flattenTree } from '../animation';
import { round } from '../math';
import { normalizeGeometries } from './common';

type LottieKf = Record<string, unknown>;
type LottieProp = { a: 0; k: unknown } | { a: 1; k: LottieKf[] };

const LC = { butt: 1, round: 2, square: 3 } as const;
const LJ = { miter: 1, round: 2, bevel: 3 } as const;

function kfEasing(e: Easing, dims: number) {
  const [x1, y1, x2, y2] = e.type === 'linear' ? [0, 0, 1, 1] : e.bezier;
  const arr = (v: number) => Array(dims).fill(round(v, 4));
  return { o: { x: arr(x1), y: arr(y1) }, i: { x: arr(x2), y: arr(y2) } };
}

function toFrames(ms: number, fps: number) {
  return round((ms / 1000) * fps, 3);
}

/** Build an animatable Lottie property from a keyframe list (or a static value). */
function prop<T>(
  list: Keyframe[] | undefined,
  base: T,
  map: (v: T) => unknown,
  fps: number,
  dims: number,
  spatial = false,
): LottieProp {
  if (!list || list.length === 0) return { a: 0, k: map(base) };
  if (list.length === 1) return { a: 0, k: map(list[0].value as T) };
  const k: LottieKf[] = list.map((kf, i) => {
    const out: LottieKf = { t: toFrames(kf.time, fps), s: wrap(map(kf.value as T)) };
    if (i < list.length - 1) {
      if (kf.easing.type === 'hold') out.h = 1;
      else Object.assign(out, kfEasing(kf.easing, dims));
      if (spatial) Object.assign(out, { to: [0, 0, 0], ti: [0, 0, 0] });
    }
    return out;
  });
  return { a: 1, k };
}
const wrap = (v: unknown) => (Array.isArray(v) ? v : [v]);

function shapeKs(g: PathGeometry, subIndex: number) {
  const sp = g.subpaths[subIndex];
  if (!sp) return { i: [], o: [], v: [], c: false };
  return {
    i: sp.anchors.map((a) => [round(a.inX, 3), round(a.inY, 3)]),
    o: sp.anchors.map((a) => [round(a.outX, 3), round(a.outY, 3)]),
    v: sp.anchors.map((a) => [round(a.x, 3), round(a.y, 3)]),
    c: sp.closed,
  };
}

const solidOr = (hex: string, fallback: string) => (hex === 'none' ? fallback : hex);

export function exportLottie(doc: DocumentModel, state: AnimState): Record<string, unknown> {
  const fps = doc.fps || 60;
  const op = Math.max(1, Math.round((state.duration / 1000) * fps));
  const order = flattenTree(doc); // paint order bottom → top
  const ind: Record<string, number> = {};
  order.forEach((id, i) => (ind[id] = i + 1));

  // Opacity does not inherit through Lottie parenting → fold static ancestor opacity in,
  // and bake (sample) when an ancestor's opacity is animated.
  const ancestorOpacity = (n: SceneNode) => {
    let f = 1;
    let animated = false;
    let p = n.parentId ? doc.nodes[n.parentId] : null;
    while (p) {
      f *= p.opacity;
      if (state.tracks[p.id]?.opacity?.length) animated = true;
      p = p.parentId ? doc.nodes[p.parentId] : null;
    }
    return { f, animated };
  };

  const opacityProp = (n: SceneNode): LottieProp => {
    const { f, animated } = ancestorOpacity(n);
    if (!animated) {
      const list = state.tracks[n.id]?.opacity as Keyframe[] | undefined;
      return prop<number>(list, n.opacity, (v) => round(v * f * 100, 3), fps, 1);
    }
    // Bake effective opacity per frame
    const k: LottieKf[] = [];
    const step = Math.max(1, Math.round(fps / 30));
    for (let fr = 0; fr <= op; fr += step) {
      const t = (fr / fps) * 1000;
      let o = evaluateNode(n, state.tracks[n.id], t).opacity;
      let p = n.parentId ? doc.nodes[n.parentId] : null;
      while (p) {
        o *= evaluateNode(p, state.tracks[p.id], t).opacity;
        p = p.parentId ? doc.nodes[p.parentId] : null;
      }
      k.push({ t: fr, s: [round(o * 100, 3)], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } });
    }
    return { a: 1, k };
  };

  const transform = (n: SceneNode, withOpacity: boolean) => {
    const tr = state.tracks[n.id] ?? {};
    return {
      a: { a: 0, k: [round(n.origin.x, 3), round(n.origin.y, 3), 0] },
      p: prop<Vec>(tr.position as Keyframe[], n.position, (v) => [round(v.x + n.origin.x, 3), round(v.y + n.origin.y, 3), 0], fps, 3, true),
      s: prop<Vec>(tr.scale as Keyframe[], n.scale, (v) => [round(v.x * 100, 3), round(v.y * 100, 3), 100], fps, 3),
      r: prop<number>(tr.rotation as Keyframe[], n.rotation, (v) => round(v, 3), fps, 1),
      o: withOpacity ? opacityProp(n) : { a: 0, k: 100 },
    };
  };

  const layers: Record<string, unknown>[] = [];
  for (const id of order) {
    const n = doc.nodes[id];
    if (!n.visible) continue;
    const base = {
      ddd: 0,
      ind: ind[id],
      nm: n.name,
      sr: 1,
      ao: 0,
      ip: 0,
      op,
      st: 0,
      bm: 0,
      ...(n.parentId ? { parent: ind[n.parentId] } : {}),
    };
    if (n.type === 'group') {
      layers.push({ ...base, ty: 3, ks: transform(n, false) });
      continue;
    }
    const p = n as PathNode;
    const tr = state.tracks[id] ?? {};
    const items: Record<string, unknown>[] = [];

    // Geometry (one `sh` per subpath; morph keyframes normalised to identical topology)
    const pathKfs = tr.path as Keyframe<'path'>[] | undefined;
    if (pathKfs && pathKfs.length > 1) {
      const geos = normalizeGeometries(pathKfs.map((k) => k.value as PathGeometry));
      const subCount = geos[0].subpaths.length;
      for (let s = 0; s < subCount; s++) {
        items.push({
          ty: 'sh',
          nm: `Path ${s + 1}`,
          ks: {
            a: 1,
            k: pathKfs.map((kf, i) => ({
              t: toFrames(kf.time, fps),
              s: [shapeKs(geos[i], s)],
              ...(i < pathKfs.length - 1 ? (kf.easing.type === 'hold' ? { h: 1 } : kfEasing(kf.easing, 1)) : {}),
            })),
          },
        });
      }
    } else {
      const g = pathKfs?.length === 1 ? (pathKfs[0].value as PathGeometry) : p.geometry;
      g.subpaths.forEach((_, s) => items.push({ ty: 'sh', nm: `Path ${s + 1}`, ks: { a: 0, k: shapeKs(g, s) } }));
    }

    const fillList = tr.fill as Keyframe[] | undefined;
    const hasFill = p.fill !== 'none' || fillList?.some((k) => k.value !== 'none');
    if (hasFill) {
      const fb = p.fill !== 'none' ? p.fill : ((fillList?.find((k) => k.value !== 'none')?.value as string) ?? '#000000');
      items.push({
        ty: 'fl',
        nm: 'Fill',
        c: prop<string>(fillList, p.fill, (v) => hexToLottie(solidOr(v, fb)), fps, 4),
        o: { a: 0, k: round(p.fillOpacity * 100, 2) },
        r: p.fillRule === 'evenodd' ? 2 : 1,
      });
    }
    const strokeList = tr.stroke as Keyframe[] | undefined;
    const hasStroke = p.stroke !== 'none' || strokeList?.some((k) => k.value !== 'none');
    if (hasStroke) {
      const fb = p.stroke !== 'none' ? p.stroke : ((strokeList?.find((k) => k.value !== 'none')?.value as string) ?? '#000000');
      items.push({
        ty: 'st',
        nm: 'Stroke',
        c: prop<string>(strokeList, p.stroke, (v) => hexToLottie(solidOr(v, fb)), fps, 4),
        o: { a: 0, k: round(p.strokeOpacity * 100, 2) },
        w: prop<number>(tr.strokeWidth as Keyframe[], p.strokeWidth, (v) => round(v, 3), fps, 1),
        lc: LC[p.lineCap],
        lj: LJ[p.lineJoin],
        ml: 4,
      });
    }
    items.push({
      ty: 'tr',
      p: { a: 0, k: [0, 0] },
      a: { a: 0, k: [0, 0] },
      s: { a: 0, k: [100, 100] },
      r: { a: 0, k: 0 },
      o: { a: 0, k: 100 },
      sk: { a: 0, k: 0 },
      sa: { a: 0, k: 0 },
    });
    layers.push({ ...base, ty: 4, ks: transform(n, true), shapes: [{ ty: 'gr', nm: n.name, it: items }] });
  }

  // Lottie draws the first layer on top → reverse paint order
  layers.reverse();

  return {
    v: '5.12.1',
    fr: fps,
    ip: 0,
    op,
    w: doc.width,
    h: doc.height,
    nm: `${doc.name} – ${state.name}`,
    ddd: 0,
    assets: [],
    layers,
    markers: [],
    meta: { g: 'VectoWave 1.0' },
  };
}

/** Quick sanity check used by tests / UI. */
export function lottieSummary(json: Record<string, unknown>) {
  const layers = (json.layers as unknown[]) ?? [];
  return { layers: layers.length, frames: json.op as number, fps: json.fr as number };
}

