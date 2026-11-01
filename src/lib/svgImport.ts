// ─────────────────────────────────────────────────────────────────────────────
//  SVG import pipeline
//   1. Sanitise & strip editor metadata / comments / scripts
//   2. Resolve <use> references
//   3. Mount off-screen so the browser resolves CSS (classes, <style>, inheritance)
//   4. Convert every primitive to path geometry, baking element transforms
//   5. Clean the resulting tree (hidden layers, empty + redundant groups)
// ─────────────────────────────────────────────────────────────────────────────
import type { DocumentModel, GroupNode, PathGeometry, PathNode, SceneNode } from '../types/model';
import { lerpColor, parseColor } from './color';
import { createEmptyDoc, makeGroupNode, makePathNode, recenterGroupOrigins } from './doc';
import { type Mat, IDENTITY, matScaleFactor, multiply, translate } from './math';
import { anchorCount, ellipseGeometry, parsePathData, polyGeometry, rectGeometry, transformGeometry } from './path';
import { simplifyGeometry } from './simplify';

export interface ImportOptions {
  stripMetadata: boolean;
  removeHidden: boolean;
  collapseGroups: boolean;
  simplify: boolean;
  simplifyAmount: number; // 0..100
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  stripMetadata: true,
  removeHidden: true,
  collapseGroups: true,
  simplify: false,
  simplifyAmount: 30,
};

export interface ImportStats {
  elements: number;
  shapes: number;
  removedMetadata: number;
  removedHidden: number;
  removedEmptyGroups: number;
  collapsedGroups: number;
  unsupported: string[];
  anchorsBefore: number;
  anchorsAfter: number;
}

export interface ImportResult {
  doc: DocumentModel;
  stats: ImportStats;
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['g', 'svg', 'a', 'switch']);
const NON_RENDERED = new Set([
  'defs', 'clippath', 'mask', 'symbol', 'lineargradient', 'radialgradient', 'pattern', 'marker',
  'style', 'filter', 'title', 'desc', 'metadata',
]);
const STRIP_TAGS =new Set(['metadata', 'title', 'desc', 'script', 'style-ignored', 'sodipodi:namedview', 'foreignObject']);

function readLength(attr: SVGAnimatedLength | undefined, fallback = 0) {
  try {
    return attr ? attr.baseVal.value : fallback;
  } catch {
    return fallback;
  }
}

function elementMatrix(el: Element): Mat {
  const g = el as SVGGraphicsElement;
  const list = g.transform?.baseVal;
  if (!list || list.numberOfItems === 0) return IDENTITY;
  const m = list.consolidate()?.matrix;
  return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : IDENTITY;
}

function parsePoints(s: string) {
  const nums = (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

function shapeGeometry(el: Element): PathGeometry | null {
  const tag = el.tagName.toLowerCase();
  const e = el as unknown as Record<string, SVGAnimatedLength>;
  switch (tag) {
    case 'path':
      return parsePathData(el.getAttribute('d') ?? '');
    case 'rect': {
      const w = readLength(e.width);
      const h = readLength(e.height);
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? readLength(e.rx) : NaN;
      let ry = el.hasAttribute('ry') ? readLength(e.ry) : NaN;
      if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry;
      if (isNaN(ry)) ry = rx;
      return rectGeometry(readLength(e.x), readLength(e.y), w, h, rx, ry);
    }
    case 'circle': {
      const r = readLength(e.r);
      return r > 0 ? ellipseGeometry(readLength(e.cx), readLength(e.cy), r, r) : null;
    }
    case 'ellipse': {
      const rx = readLength(e.rx);
      const ry = readLength(e.ry);
      return rx > 0 && ry > 0 ? ellipseGeometry(readLength(e.cx), readLength(e.cy), rx, ry) : null;
    }
    case 'line':
      return polyGeometry(
        [
          { x: readLength(e.x1), y: readLength(e.y1) },
          { x: readLength(e.x2), y: readLength(e.y2) },
        ],
        false,
      );
    case 'polyline':
    case 'polygon': {
      const pts = parsePoints(el.getAttribute('points') ?? '');
      return pts.length >= 2 ? polyGeometry(pts, tag === 'polygon') : null;
    }
  }
  return null;
}

/** Resolve a paint (incl. url(#gradient)) to a hex colour. Gradients are averaged in OKLab. */
function resolvePaint(value: string, root: Document | Element): string {
  if (!value || value === 'none') return 'none';
  const url = /url\(["']?#([^"')]+)["']?\)/.exec(value);
  if (url) {
    const grad = (root as Document).getElementById
      ? (root as Document).getElementById(url[1])
      : (root as Element).querySelector(`#${CSS.escape(url[1])}`);
    if (grad) {
      const stops = [...grad.querySelectorAll('stop')]
        .map((s) => parseColor(getComputedStyle(s).stopColor || s.getAttribute('stop-color') || '#000')?.hex)
        .filter(Boolean) as string[];
      if (stops.length) return stops.reduce((acc, c, i) => lerpColor(acc, c, 1 / (i + 1)));
    }
    // fallback colour after url(...)
    const fb = value.replace(url[0], '').trim();
    return parseColor(fb)?.hex ?? '#888888';
  }
  return parseColor(value)?.hex ?? 'none';
}

function labelFor(el: Element, fallback: string) {
  return (
    el.getAttribute('inkscape:label') ||
    el.getAttribute('data-name') ||
    el.getAttribute('id') ||
    el.getAttribute('aria-label') ||
    fallback
  );
}

export function parseSvgString(text: string, options: ImportOptions = DEFAULT_IMPORT_OPTIONS, fileName = 'Imported'): ImportResult {
  const stats: ImportStats = {
    elements: 0,
    shapes: 0,
    removedMetadata: 0,
    removedHidden: 0,
    removedEmptyGroups: 0,
    collapsedGroups: 0,
    unsupported: [],
    anchorsBefore: 0,
    anchorsAfter: 0,
  };
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = parsed.querySelector('parsererror');
  const svgEl = parsed.documentElement;
  if (err || svgEl.tagName.toLowerCase() !== 'svg') throw new Error('Not a valid SVG document.');

  // ── 1. strip metadata, comments, editor cruft, scripts / event handlers ──
  const walker = parsed.createTreeWalker(svgEl, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  stats.removedMetadata += options.stripMetadata ? comments.length : 0;

  svgEl.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName;
    const lower = tag.toLowerCase();
    if (lower === 'script' || lower === 'foreignobject') {
      el.remove();
      return;
    }
    // Security: drop inline event handlers
    [...el.attributes].forEach((a) => a.name.toLowerCase().startsWith('on') && el.removeAttribute(a.name));
    if (options.stripMetadata && (STRIP_TAGS.has(lower) || tag.includes(':'))) {
      el.remove();
      stats.removedMetadata++;
    }
  });

  // ── 2. resolve <use> by cloning their target ──
  for (let pass = 0; pass < 3; pass++) {
    const uses = [...svgEl.querySelectorAll('use')];
    if (!uses.length) break;
    uses.forEach((use) => {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      const target = href.startsWith('#') ? parsed.getElementById(href.slice(1)) : null;
      const g = parsed.createElementNS('http://www.w3.org/2000/svg', 'g');
      [...use.attributes].forEach((a) => {
        if (!['href', 'xlink:href', 'x', 'y', 'width', 'height'].includes(a.name)) g.setAttribute(a.name, a.value);
      });
      const x = parseFloat(use.getAttribute('x') ?? '0') || 0;
      const y = parseFloat(use.getAttribute('y') ?? '0') || 0;
      const t = use.getAttribute('transform') ?? '';
      g.setAttribute('transform', `${t} translate(${x} ${y})`.trim());
      if (target) {
        const clone = target.cloneNode(true) as Element;
        clone.removeAttribute('id');
        if (clone.tagName.toLowerCase() === 'symbol') {
          while (clone.firstChild) g.appendChild(clone.firstChild);
        } else g.appendChild(clone);
      }
      use.replaceWith(g);
    });
  }

  // ── 3. artboard ──
  const vb = svgEl.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let width = parseFloat(svgEl.getAttribute('width') ?? '') || 0;
  let height = parseFloat(svgEl.getAttribute('height') ?? '') || 0;
  let rootM: Mat = IDENTITY;
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    width = vb[2];
    height = vb[3];
    rootM = translate(-vb[0], -vb[1]);
  }
  if (!width || !height) {
    width = width || 512;
    height = height || 512;
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;opacity:0;pointer-events:none';
  const live = document.importNode(svgEl, true) as unknown as SVGSVGElement;
  host.appendChild(live);
  document.body.appendChild(host);

  const doc = createEmptyDoc(Math.round(width * 100) / 100, Math.round(height * 100) / 100, fileName.replace(/\.svg$/i, ''));
  const palette: string[] = [];
  let counter = 0;

  try {
    const visit = (el: Element, parentM: Mat, parentId: string | null, out: string[]) => {
      const tag = el.tagName.toLowerCase();
      if (NON_RENDERED.has(tag) || tag.includes(':')) return;
      stats.elements++;
      const cs = getComputedStyle(el);
      const hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse';
      if (hidden && options.removeHidden) {
        stats.removedHidden++;
        return;
      }
      const m = multiply(parentM, el === live ? IDENTITY : elementMatrix(el));
      const opacity = parseFloat(cs.opacity || '1');

      if (CONTAINERS.has(tag)) {
        let mm = m;
        if (tag === 'svg' && el !== live) {
          const x = readLength((el as SVGSVGElement).x);
          const y = readLength((el as SVGSVGElement).y);
          mm = multiply(m, translate(x, y));
        }
        const g = makeGroupNode(labelFor(el, el === live ? 'Artwork' : `Group ${++counter}`), parentId);
        g.opacity = isNaN(opacity) ? 1 : opacity;
        g.visible = !hidden;
        doc.nodes[g.id] = g;
        [...el.children].forEach((c) => visit(c, mm, g.id, g.children));
        out.push(g.id);
        return;
      }
      if (SHAPES.has(tag)) {
        const geo = shapeGeometry(el);
        if (!geo || geo.subpaths.length === 0) return;
        const baked = transformGeometry(geo, m);
        const sf = matScaleFactor(m) || 1;
        const fill = resolvePaint(cs.fill, live.ownerDocument);
        const stroke = resolvePaint(cs.stroke, live.ownerDocument);
        const fo = parseColor(cs.fill)?.alpha ?? 1;
        const so = parseColor(cs.stroke)?.alpha ?? 1;
        const node = makePathNode(labelFor(el, `${tag[0].toUpperCase()}${tag.slice(1)} ${++counter}`), baked, parentId, {
          fill,
          stroke,
          fillOpacity: (parseFloat(cs.fillOpacity || '1') || 0) * fo,
          strokeOpacity: (parseFloat(cs.strokeOpacity || '1') || 0) * so,
          strokeWidth: Math.round((parseFloat(cs.strokeWidth || '1') || 0) * sf * 1000) / 1000,
          fillRule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
          lineCap: (cs.strokeLinecap as PathNode['lineCap']) || 'butt',
          lineJoin: (['miter', 'round', 'bevel'].includes(cs.strokeLinejoin) ? cs.strokeLinejoin : 'miter') as PathNode['lineJoin'],
          opacity: isNaN(opacity) ? 1 : opacity,
          visible: !hidden,
        });
        if (fill !== 'none') palette.push(fill);
        if (stroke !== 'none') palette.push(stroke);
        stats.shapes++;
        stats.anchorsBefore += anchorCount(baked);
        doc.nodes[node.id] = node;
        out.push(node.id);
        return;
      }
      if (!stats.unsupported.includes(tag)) stats.unsupported.push(tag);
    };
    visit(live, rootM, null, doc.rootIds);
  } finally {
    host.remove();
  }

  // ── 5. tree cleanup ──
  const removeNode = (id: string) => {
    const n = doc.nodes[id];
    if (n?.type === 'group') n.children.forEach(removeNode);
    delete doc.nodes[id];
  };
  const cleanList = (ids: string[], parentId: string | null): string[] => {
    const result: string[] = [];
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n) continue;
      if (n.type === 'group') {
        n.children = cleanList(n.children, n.id);
        if (n.children.length === 0) {
          removeNode(id);
          stats.removedEmptyGroups++;
          continue;
        }
        if (options.collapseGroups && n.children.length === 1 && n.visible) {
          // Hoist single child; fold the group's opacity into it.
          const child = doc.nodes[n.children[0]];
          child.opacity *= n.opacity;
          child.parentId = parentId;
          if (child.name.match(/^(Path|Rect|Circle|Ellipse|Polygon|Polyline|Line|Group) \d+$/) && !n.name.match(/^Group \d+$/))
            child.name = n.name;
          delete doc.nodes[id];
          stats.collapsedGroups++;
          result.push(child.id);
          continue;
        }
      }
      n.parentId = parentId;
      result.push(id);
    }
    return result;
  };
  doc.rootIds = cleanList(doc.rootIds, null);
  // A single root group that just wraps everything (the <svg> itself) is redundant
  while (options.collapseGroups && doc.rootIds.length === 1) {
    const only = doc.nodes[doc.rootIds[0]];
    if (only.type !== 'group' || only.opacity !== 1) break;
    doc.rootIds = only.children;
    only.children.forEach((c) => (doc.nodes[c].parentId = null));
    delete doc.nodes[only.id];
    stats.collapsedGroups++;
  }

  if (options.simplify && options.simplifyAmount > 0) applySimplification(doc, options.simplifyAmount);
  stats.anchorsAfter = Object.values(doc.nodes).reduce((s, n) => s + (n.type === 'path' ? anchorCount(n.geometry) : 0), 0);
  recenterGroupOrigins(doc);
  doc.palette = palette;
  if (Object.keys(doc.nodes).length === 0) throw new Error('No drawable shapes were found in this SVG.');
  return { doc, stats };
}

/** In-place simplification of every path in the document. */
export function applySimplification(doc: DocumentModel, amount: number) {
  const diag = Math.hypot(doc.width, doc.height);
  for (const id in doc.nodes) {
    const n = doc.nodes[id] as SceneNode;
    if (n.type === 'path') n.geometry = simplifyGeometry(n.geometry, amount, diag);
  }
}

export function simplifiedCopy(doc: DocumentModel, amount: number): DocumentModel {
  const nodes: Record<string, SceneNode> = {};
  const diag = Math.hypot(doc.width, doc.height);
  for (const id in doc.nodes) {
    const n = doc.nodes[id];
    nodes[id] = n.type === 'path' ? { ...n, geometry: simplifyGeometry(n.geometry, amount, diag) } : n;
  }
  return { ...doc, nodes };
}

export const countAnchors = (doc: DocumentModel) =>
  Object.values(doc.nodes).reduce((s, n) => s + (n.type === 'path' ? anchorCount(n.geometry) : 0), 0);

export type { GroupNode };
