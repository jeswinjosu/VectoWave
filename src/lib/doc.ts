import type { AnimState, DocumentModel, GroupNode, PathGeometry, PathNode, SceneNode, StateKind, Transition } from '../types/model';
import { staticLocalBBox } from './animation';
import { makeEasing } from './easing';
import { boxCenter, boxValid, uid } from './math';
import { geometryBBox } from './path';

export function makeState(name: string, kind: StateKind, graph = { x: 0, y: 0 }): AnimState {
  return { id: uid('s'), name, kind, duration: 2000, loop: kind === 'idle', tracks: {}, graph };
}

export function makeTransition(from: string, to: string, trigger: Transition['trigger'], extra: Partial<Transition> = {}): Transition {
  return {
    id: uid('t'),
    from,
    to,
    trigger,
    targetNodeId: null,
    duration: 250,
    easing: makeEasing('easeOut'),
    ...extra,
  };
}

/** Default state machine: Idle ⇄ Hover ⇄ Pressed. */
export function defaultStateMachine(): Pick<DocumentModel, 'states' | 'transitions' | 'initialStateId' | 'customTriggers'> {
  const idle = makeState('Idle', 'idle', { x: 110, y: 70 });
  const hover = makeState('Hover', 'hover', { x: 420, y: 16 });
  const pressed = makeState('Pressed', 'pressed', { x: 420, y: 150 });
  hover.duration = 600;
  pressed.duration = 400;
  return {
    states: [idle, hover, pressed],
    initialStateId: idle.id,
    customTriggers: [],
    transitions: [
      makeTransition(idle.id, hover.id, 'pointerEnter'),
      makeTransition(hover.id, idle.id, 'pointerLeave'),
      makeTransition(hover.id, pressed.id, 'pointerDown', { duration: 120 }),
      makeTransition(pressed.id, hover.id, 'pointerUp', { duration: 200 }),
      makeTransition(pressed.id, idle.id, 'pointerLeave'),
    ],
  };
}

export function createEmptyDoc(width = 512, height = 512, name = 'Untitled'): DocumentModel {
  return {
    version: 1,
    name,
    width,
    height,
    background: null,
    fps: 60,
    nodes: {},
    rootIds: [],
    palette: [],
    ...defaultStateMachine(),
  };
}

export function makePathNode(name: string, geometry: PathGeometry, parentId: string | null, style: Partial<PathNode> = {}): PathNode {
  const b = geometryBBox(geometry);
  return {
    id: uid('p'),
    name,
    type: 'path',
    parentId,
    visible: true,
    locked: false,
    origin: boxValid(b) ? boxCenter(b) : { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    geometry,
    fill: '#7c8cff',
    fillOpacity: 1,
    stroke: 'none',
    strokeOpacity: 1,
    strokeWidth: 1,
    fillRule: 'nonzero',
    lineCap: 'butt',
    lineJoin: 'miter',
    ...style,
  };
}

export function makeGroupNode(name: string, parentId: string | null, children: string[] = []): GroupNode {
  return {
    id: uid('g'),
    name,
    type: 'group',
    parentId,
    visible: true,
    locked: false,
    origin: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    children,
  };
}

/** Recompute group pivots as the centre of their content. */
export function recenterGroupOrigins(doc: DocumentModel) {
  for (const id in doc.nodes) {
    const n = doc.nodes[id];
    if (n.type !== 'group') continue;
    const b = staticLocalBBox(doc, id);
    if (boxValid(b)) n.origin = boxCenter(b);
  }
}

export function siblingsOf(doc: DocumentModel, node: SceneNode): string[] {
  if (!node.parentId) return doc.rootIds;
  const p = doc.nodes[node.parentId];
  return p && p.type === 'group' ? p.children : doc.rootIds;
}

export function isDescendant(doc: DocumentModel, id: string, ancestorId: string): boolean {
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}
