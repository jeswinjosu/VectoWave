// ─────────────────────────────────────────────────────────────────────────────
//  Keyframe evaluation engine: samples tracks, interpolates every property type
//  (numbers, vectors, OKLab colours, path morphs), builds world matrices.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  AnimState,
  DocumentModel,
  Easing,
  EvaluatedNode,
  Keyframe,
  NodeTracks,
  PropKey,
  PropValueMap,
  SceneNode,
} from '../types/model';
import { lerpColor } from './color';
import { applyEasing, DEFAULT_EASING } from './easing';
import {
  type BBox,
  type Mat,
  boxUnion,
  boxValid,
  composeTransform,
  emptyBox,
  IDENTITY,
  lerp,
  lerpVec,
  multiply,
  transformBox,
  uid,
} from './math';
import { geometryBBox, lerpGeometry } from './path';

export function isAnimatable(node: SceneNode, prop: PropKey) {
  if (node.type === 'group') return prop === 'position' || prop === 'scale' || prop === 'rotation' || prop === 'opacity';
  return true;
}

export function baseValue<P extends PropKey>(node: SceneNode, prop: P): PropValueMap[P] {
  switch (prop) {
    case 'position':
      return node.position as PropValueMap[P];
    case 'scale':
      return node.scale as PropValueMap[P];
    case 'rotation':
      return node.rotation as PropValueMap[P];
    case 'opacity':
      return node.opacity as PropValueMap[P];
  }
  if (node.type !== 'path') return undefined as unknown as PropValueMap[P];
  switch (prop) {
    case 'fill':
      return node.fill as PropValueMap[P];
    case 'stroke':
      return node.stroke as PropValueMap[P];
    case 'strokeWidth':
      return node.strokeWidth as PropValueMap[P];
    case 'path':
      return node.geometry as PropValueMap[P];
  }
  return undefined as unknown as PropValueMap[P];
}

export function interpolate<P extends PropKey>(prop: P, a: PropValueMap[P], b: PropValueMap[P], t: number): PropValueMap[P] {
  switch (prop) {
    case 'position':
    case 'scale':
      return lerpVec(a as PropValueMap['position'], b as PropValueMap['position'], t) as PropValueMap[P];
    case 'rotation':
    case 'opacity':
    case 'strokeWidth':
      return lerp(a as number, b as number, t) as PropValueMap[P];
    case 'fill':
    case 'stroke':
      return lerpColor(a as string, b as string, t) as PropValueMap[P];
    case 'path':
      return lerpGeometry(a as PropValueMap['path'], b as PropValueMap['path'], t) as PropValueMap[P];
  }
  return a;
}

/** Sample a keyframe list at `time`. Holds first/last values outside the keyed range. */
export function sampleTrack<P extends PropKey>(prop: P, kfs: Keyframe<P>[] | undefined, time: number, base: PropValueMap[P]): PropValueMap[P] {
  if (!kfs || kfs.length === 0) return base;
  if (time <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.value;
  // binary search for segment
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  const span = b.time - a.time;
  const t = span <= 0 ? 1 : applyEasing(a.easing, (time - a.time) / span);
  return interpolate(prop, a.value, b.value, t);
}

export function evaluateNode(node: SceneNode, tracks: NodeTracks | undefined, time: number): EvaluatedNode {
  const s = <P extends PropKey>(p: P) => sampleTrack(p, tracks?.[p] as Keyframe<P>[] | undefined, time, baseValue(node, p));
  return {
    position: s('position'),
    scale: s('scale'),
    rotation: s('rotation'),
    opacity: s('opacity'),
    fill: node.type === 'path' ? s('fill') : 'none',
    stroke: node.type === 'path' ? s('stroke') : 'none',
    strokeWidth: node.type === 'path' ? s('strokeWidth') : 0,
    geometry: node.type === 'path' ? s('path') : null,
  };
}

export type EvalMap = Record<string, EvaluatedNode>;

export function evaluateDoc(doc: DocumentModel, state: AnimState | undefined, time: number): EvalMap {
  const out: EvalMap = {};
  for (const id in doc.nodes) out[id] = evaluateNode(doc.nodes[id], state?.tracks[id], time);
  return out;
}

export function blendEval(a: EvaluatedNode, b: EvaluatedNode, t: number): EvaluatedNode {
  if (t >= 1) return b;
  if (t <= 0) return a;
  return {
    position: lerpVec(a.position, b.position, t),
    scale: lerpVec(a.scale, b.scale, t),
    rotation: lerp(a.rotation, b.rotation, t),
    opacity: lerp(a.opacity, b.opacity, t),
    fill: lerpColor(a.fill, b.fill, t),
    stroke: lerpColor(a.stroke, b.stroke, t),
    strokeWidth: lerp(a.strokeWidth, b.strokeWidth, t),
    geometry: a.geometry && b.geometry ? lerpGeometry(a.geometry, b.geometry, t) : b.geometry,
  };
}

export const localMatrix = (node: SceneNode, e: EvaluatedNode): Mat =>
  composeTransform(e.position, node.origin, e.rotation, e.scale);

/** World (artboard-space) matrix for every node. */
export function worldMatrices(doc: DocumentModel, evals: EvalMap): Record<string, Mat> {
  const out: Record<string, Mat> = {};
  const walk = (id: string, parent: Mat) => {
    const n = doc.nodes[id];
    if (!n) return;
    const m = multiply(parent, localMatrix(n, evals[id]));
    out[id] = m;
    if (n.type === 'group') n.children.forEach((c) => walk(c, m));
  };
  doc.rootIds.forEach((id) => walk(id, IDENTITY));
  return out;
}

/** Bounding box of a node in its own local (pre-transform) coordinates. */
export function localBBox(doc: DocumentModel, evals: EvalMap, id: string): BBox {
  const n = doc.nodes[id];
  if (!n) return emptyBox();
  if (n.type === 'path') return geometryBBox(evals[id]?.geometry ?? n.geometry);
  let b = emptyBox();
  for (const c of n.children) {
    const cb = localBBox(doc, evals, c);
    if (!boxValid(cb)) continue;
    b = boxUnion(b, transformBox(cb, localMatrix(doc.nodes[c], evals[c])));
  }
  return b;
}

/** Static-geometry local bbox (used to place transform origins). */
export function staticLocalBBox(doc: DocumentModel, id: string): BBox {
  const evals: EvalMap = {};
  for (const k in doc.nodes) evals[k] = evaluateNode(doc.nodes[k], undefined, 0);
  return localBBox(doc, evals, id);
}

// ── Keyframe list helpers (pure) ─────────────────────────────────────────────

export const KEY_TIME_EPS = 0.5; // ms

export function upsertKeyframe<P extends PropKey>(
  list: Keyframe<P>[] | undefined,
  time: number,
  value: PropValueMap[P],
  easing?: Easing,
): Keyframe<P>[] {
  const arr = [...(list ?? [])];
  const idx = arr.findIndex((k) => Math.abs(k.time - time) < KEY_TIME_EPS);
  if (idx >= 0) arr[idx] = { ...arr[idx], value };
  else {
    arr.push({ id: uid('k'), time, value, easing: easing ?? { ...DEFAULT_EASING, bezier: [...DEFAULT_EASING.bezier] } });
    arr.sort((a, b) => a.time - b.time);
  }
  return arr;
}

export function keyAt(list: Keyframe[] | undefined, time: number) {
  return list?.find((k) => Math.abs(k.time - time) < KEY_TIME_EPS);
}

export function hasAnyKeys(tracks: NodeTracks | undefined) {
  if (!tracks) return false;
  return Object.values(tracks).some((k) => k && k.length > 0);
}

/** All distinct keyframe times for a node (for summary rows). */
export function nodeKeyTimes(tracks: NodeTracks | undefined): number[] {
  if (!tracks) return [];
  const s = new Set<number>();
  Object.values(tracks).forEach((list) => list?.forEach((k) => s.add(Math.round(k.time))));
  return [...s].sort((a, b) => a - b);
}

export function forEachDescendant(doc: DocumentModel, id: string, fn: (n: SceneNode) => void) {
  const n = doc.nodes[id];
  if (!n) return;
  fn(n);
  if (n.type === 'group') n.children.forEach((c) => forEachDescendant(doc, c, fn));
}

/** Depth-first ordered list of node ids (paint order: first = bottom). */
export function flattenTree(doc: DocumentModel): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    const n = doc.nodes[id];
    if (n?.type === 'group') n.children.forEach(walk);
  };
  doc.rootIds.forEach(walk);
  return out;
}
