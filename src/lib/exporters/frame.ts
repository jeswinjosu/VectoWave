// Static SVG snapshot of the scene at one point in time (used for video frames and thumbnails).
import type { DocumentModel, PathNode } from '../../types/model';
import { localMatrix, type EvalMap } from '../animation';
import { matToString, round } from '../math';
import { pathString } from '../path';

export function frameSvg(doc: DocumentModel, evals: EvalMap, width: number, height: number, background: string | null): string {
  const node = (id: string): string => {
    const n = doc.nodes[id];
    const e = evals[id];
    if (!n || !e || !n.visible) return '';
    const t = `transform="${matToString(localMatrix(n, e))}" opacity="${round(e.opacity, 4)}"`;
    if (n.type === 'group') return `<g ${t}>${n.children.map(node).join('')}</g>`;
    const p = n as PathNode;
    return `<g ${t}><path d="${pathString(e.geometry ?? p.geometry)}" fill="${e.fill}" fill-opacity="${p.fillOpacity}" fill-rule="${p.fillRule}" stroke="${e.stroke}" stroke-opacity="${p.strokeOpacity}" stroke-width="${round(e.strokeWidth, 3)}" stroke-linecap="${p.lineCap}" stroke-linejoin="${p.lineJoin}"/></g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}" width="${width}" height="${height}">${
    background ? `<rect width="${doc.width}" height="${doc.height}" fill="${background}"/>` : ''
  }${doc.rootIds.map(node).join('')}</svg>`;
}
