import type { AnimState, DocumentModel, Keyframe, PathGeometry, PropKey, SceneNode } from '../../types/model';
import { flattenTree } from '../animation';
import { round } from '../math';
import { normalizePair } from '../path';

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

/** Stable, CSS/XML-safe element ids derived from node names. */
export function exportIds(doc: DocumentModel): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  flattenTree(doc).forEach((id) => {
    const base = `vm-${slug(doc.nodes[id].name)}`;
    let name = base;
    let i = 2;
    while (used.has(name)) name = `${base}-${i++}`;
    used.add(name);
    out[id] = name;
  });
  return out;
}

/** Bring every geometry of a morph track to an identical structure (required by SMIL / Lottie). */
export function normalizeGeometries(list: PathGeometry[]): PathGeometry[] {
  if (list.length < 2) return list;
  const out = [...list];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < out.length; i++) {
      const [a, b] = normalizePair(out[0], out[i]);
      out[0] = a;
      out[i] = b;
    }
  }
  return out;
}

const f = (n: number) => String(round(n, 2));

/** Always-cubic serialisation so interpolated path strings share one command structure. */
export function cubicPath(g: PathGeometry): string {
  let d = '';
  for (const sp of g.subpaths) {
    const A = sp.anchors;
    if (!A.length) continue;
    d += `M${f(A[0].x)} ${f(A[0].y)}`;
    const n = sp.closed ? A.length : A.length - 1;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      const b = A[(i + 1) % A.length];
      d += `C${f(a.x + a.outX)} ${f(a.y + a.outY)} ${f(b.x + b.inX)} ${f(b.y + b.inY)} ${f(b.x)} ${f(b.y)}`;
    }
    if (n === 0) d += `L${f(A[0].x)} ${f(A[0].y)}`;
    if (sp.closed) d += 'Z';
  }
  return d;
}

export function stateTracks(state: AnimState, nodeId: string) {
  return state.tracks[nodeId] ?? {};
}

export function keyedProps(state: AnimState, node: SceneNode): PropKey[] {
  const t = state.tracks[node.id];
  if (!t) return [];
  return (Object.keys(t) as PropKey[]).filter((p) => (t[p] as Keyframe[] | undefined)?.length);
}

export const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

export function download(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
