// ─────────────────────────────────────────────────────────────────────────────
//  Core document model. Everything that is saved / exported / undone lives here.
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec {
  x: number;
  y: number;
}

/**
 * Handle behaviour for an anchor point.
 * - corner:       no handles (sharp point)
 * - mirrored:     handles are collinear and equal length
 * - asymmetric:   handles are collinear, lengths independent
 * - disconnected: both handles move freely
 */
export type HandleMode = 'corner' | 'mirrored' | 'asymmetric' | 'disconnected';

/** Anchor with Bezier handles stored *relative* to the anchor (same convention as Lottie i/o). */
export interface Anchor {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
  mode: HandleMode;
}

export interface SubPath {
  anchors: Anchor[];
  closed: boolean;
}

export interface PathGeometry {
  subpaths: SubPath[];
}

export type NodeType = 'group' | 'path';
export type FillRule = 'nonzero' | 'evenodd';

export interface BaseNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  /** Transform pivot in the node's local coordinate space. */
  origin: Vec;
  /** Offset applied after the pivot transform (animatable "Position"). */
  position: Vec;
  scale: Vec;
  /** Degrees. */
  rotation: number;
  opacity: number;
}

export interface GroupNode extends BaseNode {
  type: 'group';
  children: string[];
}

export interface PathNode extends BaseNode {
  type: 'path';
  geometry: PathGeometry;
  fill: string; // '#rrggbb' or 'none'
  fillOpacity: number;
  stroke: string; // '#rrggbb' or 'none'
  strokeOpacity: number;
  strokeWidth: number;
  fillRule: FillRule;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
}

export type SceneNode = GroupNode | PathNode;

// ── Animation ────────────────────────────────────────────────────────────────

export type PropKey =
  | 'position'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'path';

export interface PropValueMap {
  position: Vec;
  scale: Vec;
  rotation: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  path: PathGeometry;
}

export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold' | 'custom';

export interface Easing {
  type: EasingType;
  /** cubic-bezier(x1, y1, x2, y2) — always populated (presets fill it in). */
  bezier: [number, number, number, number];
}

export interface Keyframe<P extends PropKey = PropKey> {
  id: string;
  /** Milliseconds from state start. */
  time: number;
  value: PropValueMap[P];
  /** Easing for the segment that *leaves* this keyframe. */
  easing: Easing;
}

export type NodeTracks = { [P in PropKey]?: Keyframe<P>[] };

export type StateKind = 'idle' | 'hover' | 'pressed' | 'custom';

export interface AnimState {
  id: string;
  name: string;
  kind: StateKind;
  duration: number; // ms
  loop: boolean;
  tracks: Record<string, NodeTracks>;
  /** Position in the state-machine graph editor. */
  graph: Vec;
}

export type TriggerType =
  | 'pointerEnter'
  | 'pointerLeave'
  | 'pointerDown'
  | 'pointerUp'
  | 'click'
  | 'custom'
  | 'complete';

export interface Transition {
  id: string;
  /** '*' means "from any state". */
  from: string;
  to: string;
  trigger: TriggerType;
  /** Name of custom trigger (when trigger === 'custom'). */
  customName?: string;
  /** Restrict pointer triggers to a layer (and its descendants). null = whole artboard. */
  targetNodeId: string | null;
  /** Blend duration in ms. */
  duration: number;
  easing: Easing;
}

export interface DocumentModel {
  version: 1;
  name: string;
  width: number;
  height: number;
  background: string | null;
  fps: number;
  nodes: Record<string, SceneNode>;
  rootIds: string[];
  states: AnimState[];
  transitions: Transition[];
  initialStateId: string;
  customTriggers: string[];
  /** Colours extracted from artwork (hex), used for theming. */
  palette: string[];
}

/** Fully-resolved values for a node at a point in time. */
export interface EvaluatedNode {
  position: Vec;
  scale: Vec;
  rotation: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  geometry: PathGeometry | null;
}

export const SHAPE_ONLY_PROPS: PropKey[] = ['fill', 'stroke', 'strokeWidth', 'path'];
export const ALL_PROPS: PropKey[] = [
  'position',
  'scale',
  'rotation',
  'opacity',
  'fill',
  'stroke',
  'strokeWidth',
  'path',
];

export const PROP_LABELS: Record<PropKey, string> = {
  position: 'Position',
  scale: 'Scale',
  rotation: 'Rotation',
  opacity: 'Opacity',
  fill: 'Fill Color',
  stroke: 'Stroke Color',
  strokeWidth: 'Stroke Width',
  path: 'Path (Morph)',
};
