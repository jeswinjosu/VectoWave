// Starter artwork + animation so the editor opens with something to explore.
import type { DocumentModel, GroupNode, Keyframe, PathGeometry, PathNode, PropKey, PropValueMap } from '../types/model';
import { makeEasing } from './easing';
import { cloneGeometry } from './path';
import { DEFAULT_IMPORT_OPTIONS, parseSvgString } from './svgImport';
import { uid } from './math';

function star(cx: number, cy: number, r1: number, r2: number, n = 5) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (Math.PI / n) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

export const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Demo badge</title>
  <metadata>generated</metadata>
  <g id="Badge">
    <circle id="Glow" cx="256" cy="256" r="196" fill="#4f46e5" opacity="0.35"/>
    <circle id="Disc" cx="256" cy="256" r="172" fill="#6d5dfc"/>
    <circle id="Ring" cx="256" cy="256" r="140" fill="none" stroke="#c4b5fd" stroke-width="6"/>
  </g>
  <polygon id="Star" points="${star(256, 256, 104, 46)}" fill="#ffd166" stroke="#ffb020" stroke-width="4" stroke-linejoin="round"/>
  <g id="Orbit">
    <circle id="Moon" cx="256" cy="54" r="16" fill="#5eead4"/>
  </g>
  <g id="hidden-guide" style="display:none"><rect x="0" y="0" width="512" height="512"/></g>
</svg>`;

const byName = (doc: DocumentModel, name: string) => Object.values(doc.nodes).find((n) => n.name === name);

function key<P extends PropKey>(time: number, value: PropValueMap[P], ease = makeEasing('easeInOut')): Keyframe<P> {
  return { id: uid('k'), time, value, easing: ease };
}

export function buildDemoDoc(): DocumentModel {
  const { doc } = parseSvgString(DEMO_SVG, { ...DEFAULT_IMPORT_OPTIONS, collapseGroups: true }, 'Demo badge.svg');
  doc.name = 'Demo Badge';
  const [idle, hover, pressed] = doc.states;
  const starNode = byName(doc, 'Star') as PathNode | undefined;
  const disc = byName(doc, 'Disc') as PathNode | undefined;
  const glow = byName(doc, 'Glow') as PathNode | undefined;
  const orbit = (byName(doc, 'Orbit') ?? byName(doc, 'Moon')) as GroupNode | PathNode | undefined;
  const badge = byName(doc, 'Badge') as GroupNode | undefined;
  if (!starNode || !disc || !orbit || !glow) return doc;

  // Orbit and star pivot around the artboard centre
  orbit.origin = { x: 256, y: 256 };
  starNode.origin = { x: 256, y: 256 };

  // Rounded "blob" version of the star for morphing (pull inner points outward, add smooth handles)
  const blob: PathGeometry = cloneGeometry(starNode.geometry);
  blob.subpaths[0].anchors.forEach((a, i) => {
    const dx = a.x - 256;
    const dy = a.y - 256;
    const r = Math.hypot(dx, dy);
    const target = i % 2 ? 78 : 92;
    a.x = 256 + (dx / r) * target;
    a.y = 256 + (dy / r) * target;
    const tx = -dy / r;
    const ty = dx / r;
    const h = target * 0.28;
    a.inX = -tx * h;
    a.inY = -ty * h;
    a.outX = tx * h;
    a.outY = ty * h;
    a.mode = 'mirrored';
  });

  // ── Idle: gentle breathing + orbit
  idle.duration = 3000;
  idle.loop = true;
  idle.tracks[orbit.id] = { rotation: [key(0, 0, makeEasing('linear')), key(3000, 360)] };
  idle.tracks[starNode.id] = {
    scale: [key(0, { x: 1, y: 1 }), key(1500, { x: 1.06, y: 1.06 }), key(3000, { x: 1, y: 1 })],
  };
  idle.tracks[glow.id] = { opacity: [key(0, 0.25), key(1500, 0.55), key(3000, 0.25)] };

  // ── Hover: morph star into a blob, warm colours, spin
  hover.duration = 700;
  hover.loop = false;
  hover.tracks[starNode.id] = {
    path: [key(0, starNode.geometry, makeEasing('custom', [0.34, 1.56, 0.64, 1])), key(700, blob)],
    rotation: [key(0, 0, makeEasing('easeOut')), key(700, 72)],
    fill: [key(0, '#ffd166'), key(700, '#ff8fab')],
  };
  hover.tracks[disc.id] = { fill: [key(0, '#6d5dfc'), key(700, '#ec4899')] };
  hover.tracks[glow.id] = { opacity: [key(0, 0.35), key(700, 0.7)], fill: [key(0, '#4f46e5'), key(700, '#f472b6')] };
  hover.tracks[orbit.id] = { rotation: [key(0, 0, makeEasing('easeOut')), key(700, 180)] };

  // ── Pressed: squish
  pressed.duration = 400;
  pressed.loop = false;
  const target = badge ?? disc;
  pressed.tracks[target.id] = {
    scale: [key(0, { x: 1, y: 1 }, makeEasing('custom', [0.2, 0.8, 0.2, 1.2])), key(400, { x: 0.92, y: 0.92 })],
  };
  pressed.tracks[starNode.id] = {
    path: [key(0, blob)],
    rotation: [key(0, 72)],
    fill: [key(0, '#ff8fab')],
    scale: [key(0, { x: 1, y: 1 }, makeEasing('easeOut')), key(400, { x: 0.8, y: 0.8 })],
  };
  pressed.tracks[disc.id] = { fill: [key(0, '#ec4899'), key(400, '#be185d')] };
  return doc;
}
