// ─────────────────────────────────────────────────────────────────────────────
//  Global editor store (zustand + immer). The `doc` is the undoable source of
//  truth; everything else is transient UI state.
// ─────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { produce, setAutoFreeze, type Draft } from 'immer';
import type {
  AnimState,
  DocumentModel,
  Easing,
  GroupNode,
  Keyframe,
  PathGeometry,
  PathNode,
  PropKey,
  PropValueMap,
  SceneNode,
  StateKind,
  Transition,
  Vec,
} from '../types/model';
import {
  baseValue,
  evaluateNode,
  forEachDescendant,
  isAnimatable,
  keyAt,
  KEY_TIME_EPS,
  sampleTrack,
  staticLocalBBox,
  upsertKeyframe,
} from '../lib/animation';
import { createEmptyDoc, makeGroupNode, makeState, makeTransition, siblingsOf, isDescendant } from '../lib/doc';
import { boxCenter, boxValid, uid } from '../lib/math';
import { compatible } from '../lib/path';

setAutoFreeze(false);

export type Tool = 'select' | 'direct' | 'pen' | 'rect' | 'ellipse' | 'hand';
export interface AnchorRef {
  nodeId: string;
  sub: number;
  idx: number;
}
export interface KeyRef {
  nodeId: string;
  prop: PropKey;
  id: string;
}
export type NodeAttrs = Partial<Omit<PathNode, 'type' | 'id'>> & Partial<Omit<GroupNode, 'type' | 'id'>>;
export type FocusArea = 'canvas' | 'timeline' | 'graph' | 'inspector';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

interface EditorState {
  doc: DocumentModel;
  past: DocumentModel[];
  future: DocumentModel[];

  tool: Tool;
  selection: string[];
  anchorSel: AnchorRef[];
  keySel: KeyRef[];
  activeStateId: string;
  time: number;
  playing: boolean;
  view: View;
  viewport: { w: number; h: number };
  timelineZoom: number; // px per second
  expanded: Record<string, boolean>;
  animatedOnly: boolean;
  autoKey: boolean;
  preview: boolean;
  showGrid: boolean;
  snap: boolean;
  focus: FocusArea;
  bottomTab: 'timeline' | 'states';
  bottomHeight: number;
  /** Intro (home) screen vs the editor. */
  screen: 'intro' | 'editor';
  /** Document as last loaded — autosave only kicks in once the doc differs from it. */
  loadedDoc: DocumentModel | null;
  /** Last autosave time (ms since epoch). */
  savedAt: number | null;
  importFile: { name: string; text: string } | null;
  exportOpen: boolean;
  shortcutsOpen: boolean;
  toast: { msg: string; kind: 'info' | 'error' } | null;
  editingPathId: string | null;

  // ── doc / history
  mutate: (fn: (d: Draft<DocumentModel>) => void, history?: boolean) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  loadDoc: (doc: DocumentModel, fit?: boolean) => void;

  // ── selection & tools
  setTool: (t: Tool) => void;
  select: (ids: string[], mode?: 'replace' | 'add' | 'toggle') => void;
  setAnchorSel: (refs: AnchorRef[]) => void;
  setKeySel: (refs: KeyRef[]) => void;
  setFocus: (f: FocusArea) => void;

  // ── properties
  setProp: <P extends PropKey>(nodeId: string, prop: P, value: PropValueMap[P], history?: boolean) => void;
  setNodeAttrs: (nodeId: string, attrs: NodeAttrs, history?: boolean) => void;
  editGeometry: (nodeId: string, fn: (g: PathGeometry) => PathGeometry, structural: boolean, history?: boolean) => void;
  toggleKeyframe: (nodeId: string, prop: PropKey) => void;
  moveKeyframes: (refs: KeyRef[], dt: number, snapshotTimes: Record<string, number>) => void;
  deleteKeyframes: (refs: KeyRef[]) => void;
  setKeyframeEasing: (refs: KeyRef[], easing: Easing) => void;
  clearTrack: (nodeId: string, prop: PropKey) => void;

  // ── nodes
  addNode: (node: SceneNode, select?: boolean) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  moveNode: (id: string, parentId: string | null, index: number) => void;
  bringForward: (dir: 1 | -1) => void;

  // ── states / transitions
  setActiveState: (id: string) => void;
  addState: (kind: StateKind, name?: string) => void;
  updateState: (id: string, patch: Partial<AnimState>) => void;
  deleteState: (id: string) => void;
  addTransition: (t?: Partial<Transition>) => void;
  updateTransition: (id: string, patch: Partial<Transition>) => void;
  deleteTransition: (id: string) => void;
  addCustomTrigger: (name: string) => void;
  removeCustomTrigger: (name: string) => void;

  // ── playback & view
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setView: (v: Partial<View>) => void;
  setViewport: (w: number, h: number) => void;
  fitView: () => void;
  zoomBy: (factor: number, cx?: number, cy?: number) => void;
  set: (patch: Partial<EditorState>) => void;
  notify: (msg: string, kind?: 'info' | 'error') => void;
  /** Move a node's pivot without moving its artwork (position is compensated). */
  setOrigin: (nodeId: string, origin: Vec, history?: boolean) => void;
}

export const activeState = (s: Pick<EditorState, 'doc' | 'activeStateId'>): AnimState =>
  s.doc.states.find((st) => st.id === s.activeStateId) ?? s.doc.states[0];

const HISTORY_LIMIT = 120;
const INITIAL_DOC = createEmptyDoc();

export const useEditor = create<EditorState>()((set, get) => {
  const pushHistory = () => {
    const { doc, past } = get();
    set({ past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [] });
  };

  const mutate = (fn: (d: Draft<DocumentModel>) => void, history = true) => {
    if (history) pushHistory();
    set({ doc: produce(get().doc, fn) });
  };

  /** Current track list for (active state, node, prop). */
  const trackOf = (d: DocumentModel | Draft<DocumentModel>, nodeId: string, prop: PropKey) => {
    const st = d.states.find((s) => s.id === get().activeStateId) ?? d.states[0];
    return st?.tracks[nodeId]?.[prop] as Keyframe[] | undefined;
  };

  return {
    doc: INITIAL_DOC,
    past: [],
    future: [],
    tool: 'select',
    selection: [],
    anchorSel: [],
    keySel: [],
    activeStateId: INITIAL_DOC.initialStateId,
    time: 0,
    playing: false,
    view: { x: 0, y: 0, zoom: 1 },
    viewport: { w: 800, h: 600 },
    timelineZoom: 220,
    expanded: {},
    animatedOnly: false,
    autoKey: false,
    preview: false,
    showGrid: true,
    snap: true,
    focus: 'canvas',
    bottomTab: 'timeline',
    bottomHeight: 280,
    screen: 'intro',
    loadedDoc: null,
    savedAt: null,
    importFile: null,
    exportOpen: false,
    shortcutsOpen: false,
    toast: null,
    editingPathId: null,

    mutate,
    checkpoint: pushHistory,
    undo: () => {
      const { past, doc, future } = get();
      if (!past.length) return;
      set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], anchorSel: [], keySel: [] });
      get().set({ selection: get().selection.filter((id) => get().doc.nodes[id]) });
    },
    redo: () => {
      const { past, doc, future } = get();
      if (!future.length) return;
      set({ doc: future[0], future: future.slice(1), past: [...past, doc], anchorSel: [], keySel: [] });
      get().set({ selection: get().selection.filter((id) => get().doc.nodes[id]) });
    },
    loadDoc: (doc, fit = true) => {
      set({
        doc,
        loadedDoc: doc,
        screen: 'editor',
        past: [],
        future: [],
        selection: [],
        anchorSel: [],
        keySel: [],
        activeStateId: doc.initialStateId || doc.states[0]?.id,
        time: 0,
        playing: false,
        expanded: {},
        preview: false,
      });
      if (fit) requestAnimationFrame(() => get().fitView());
    },

    setTool: (tool) =>
      set({ tool, editingPathId: tool === 'pen' ? get().editingPathId : null, anchorSel: tool === 'direct' || tool === 'pen' ? get().anchorSel : [] }),
    select: (ids, mode = 'replace') => {
      const cur = get().selection;
      let next = ids;
      if (mode === 'add') next = [...new Set([...cur, ...ids])];
      if (mode === 'toggle') next = cur.includes(ids[0]) ? cur.filter((i) => i !== ids[0]) : [...cur, ...ids];
      set({ selection: next, anchorSel: get().anchorSel.filter((a) => next.includes(a.nodeId)) });
    },
    setAnchorSel: (anchorSel) => set({ anchorSel }),
    setKeySel: (keySel) => set({ keySel }),
    setFocus: (focus) => get().focus !== focus && set({ focus }),

    setProp: (nodeId, prop, value, history = true) => {
      const { autoKey, time } = get();
      mutate((d) => {
        const node = d.nodes[nodeId];
        if (!node || !isAnimatable(node as SceneNode, prop)) return;
        const st = d.states.find((s) => s.id === get().activeStateId) ?? d.states[0];
        const existing = st.tracks[nodeId]?.[prop] as Keyframe[] | undefined;
        if ((existing && existing.length) || autoKey) {
          st.tracks[nodeId] ??= {};
          let list = existing;
          // First auto-keyed change after t=0: anchor the current (base) value at 0 so the edit animates
          if (!existing?.length && time > KEY_TIME_EPS) list = upsertKeyframe(undefined, 0, baseValue(node as SceneNode, prop) as never);
          (st.tracks[nodeId] as Record<string, Keyframe[]>)[prop] = upsertKeyframe(list, time, value as never);
          if (time > st.duration) st.duration = Math.ceil(time / 100) * 100;
          return;
        }
        const field = prop === 'path' ? 'geometry' : prop;
        (node as unknown as Record<string, unknown>)[field] = value;
      }, history);
    },

    setNodeAttrs: (nodeId, attrs, history = true) =>
      mutate((d) => {
        const n = d.nodes[nodeId];
        if (n) Object.assign(n, attrs);
      }, history),

    editGeometry: (nodeId, fn, structural, history = true) => {
      const { doc, time, autoKey } = get();
      const node = doc.nodes[nodeId];
      if (!node || node.type !== 'path') return;
      if (structural) {
        const ref = node.geometry;
        mutate((d) => {
          const n = d.nodes[nodeId] as PathNode;
          n.geometry = fn(n.geometry as PathGeometry);
          for (const st of d.states) {
            const list = st.tracks[nodeId]?.path as Keyframe<'path'>[] | undefined;
            list?.forEach((k) => {
              if (compatible(k.value as PathGeometry, ref)) k.value = fn(k.value as PathGeometry);
            });
          }
        }, history);
        return;
      }
      const track = trackOf(doc, nodeId, 'path') as Keyframe<'path'>[] | undefined;
      if ((track && track.length) || autoKey) {
        const current = sampleTrack('path', track, time, node.geometry);
        get().setProp(nodeId, 'path', fn(current), history);
      } else {
        mutate((d) => {
          const n = d.nodes[nodeId] as PathNode;
          n.geometry = fn(n.geometry as PathGeometry);
        }, history);
      }
    },

    toggleKeyframe: (nodeId, prop) => {
      const { doc, time } = get();
      const node = doc.nodes[nodeId];
      if (!node) return;
      const st = activeState(get());
      const track = st.tracks[nodeId]?.[prop] as Keyframe[] | undefined;
      const existing = keyAt(track, time);
      mutate((d) => {
        const s = d.states.find((x) => x.id === st.id)!;
        s.tracks[nodeId] ??= {};
        const t = s.tracks[nodeId] as Record<string, Keyframe[]>;
        if (existing) {
          t[prop] = (t[prop] ?? []).filter((k) => k.id !== existing.id);
          if (!t[prop].length) delete t[prop];
        } else {
          const value = sampleTrack(prop, track as never, time, baseValue(node, prop));
          t[prop] = upsertKeyframe(t[prop], time, value as never);
          if (time > s.duration) s.duration = Math.ceil(time / 100) * 100;
        }
      });
      if (!existing) set({ expanded: { ...get().expanded, [nodeId]: true } });
    },

    moveKeyframes: (refs, dt, snapshotTimes) => {
      const ids = new Set(refs.map((r) => r.id));
      mutate((d) => {
        const st = d.states.find((s) => s.id === get().activeStateId)!;
        const touched = new Set<string>();
        refs.forEach((r) => touched.add(`${r.nodeId}|${r.prop}`));
        touched.forEach((key) => {
          const [nodeId, prop] = key.split('|');
          const list = (st.tracks[nodeId] as Record<string, Keyframe[]> | undefined)?.[prop];
          if (!list) return;
          list.forEach((k) => {
            if (ids.has(k.id) && snapshotTimes[k.id] !== undefined) k.time = Math.max(0, Math.round(snapshotTimes[k.id] + dt));
          });
          // Resolve collisions: moving keys win over stationary ones at the same time
          const moving = list.filter((k) => ids.has(k.id));
          const filtered = list.filter((k) => ids.has(k.id) || !moving.some((m) => Math.abs(m.time - k.time) < KEY_TIME_EPS));
          filtered.sort((a, b) => a.time - b.time);
          (st.tracks[nodeId] as Record<string, Keyframe[]>)[prop] = filtered;
        });
        const maxT = Math.max(0, ...Object.values(st.tracks).flatMap((t) => Object.values(t).flatMap((l) => (l as Keyframe[]).map((k) => k.time))));
        if (maxT > st.duration) st.duration = Math.ceil(maxT / 100) * 100;
      }, false);
    },

    deleteKeyframes: (refs) => {
      const ids = new Set(refs.map((r) => r.id));
      mutate((d) => {
        const st = d.states.find((s) => s.id === get().activeStateId)!;
        refs.forEach(({ nodeId, prop }) => {
          const t = st.tracks[nodeId] as Record<string, Keyframe[]> | undefined;
          if (!t?.[prop]) return;
          t[prop] = t[prop].filter((k) => !ids.has(k.id));
          if (!t[prop].length) delete t[prop];
        });
      });
      set({ keySel: [] });
    },

    setKeyframeEasing: (refs, easing) => {
      const ids = new Set(refs.map((r) => r.id));
      mutate((d) => {
        const st = d.states.find((s) => s.id === get().activeStateId)!;
        refs.forEach(({ nodeId, prop }) => {
          (st.tracks[nodeId] as Record<string, Keyframe[]> | undefined)?.[prop]?.forEach((k) => {
            if (ids.has(k.id)) k.easing = { type: easing.type, bezier: [...easing.bezier] as Easing['bezier'] };
          });
        });
      });
    },

    clearTrack: (nodeId, prop) =>
      mutate((d) => {
        const st = d.states.find((s) => s.id === get().activeStateId)!;
        const t = st.tracks[nodeId] as Record<string, unknown> | undefined;
        if (t) delete t[prop];
      }),

    addNode: (node, select = true) => {
      mutate((d) => {
        d.nodes[node.id] = node as Draft<SceneNode>;
        if (node.parentId && d.nodes[node.parentId]?.type === 'group') (d.nodes[node.parentId] as GroupNode).children.push(node.id);
        else d.rootIds.push(node.id);
      });
      if (select) set({ selection: [node.id] });
    },

    deleteSelection: () => {
      const { selection, anchorSel, keySel, focus } = get();
      if (focus === 'timeline' && keySel.length) return get().deleteKeyframes(keySel);
      if (anchorSel.length) {
        // handled by Canvas (needs geometry helpers) — fallthrough guard
        return;
      }
      if (!selection.length) return;
      mutate((d) => {
        const remove = new Set<string>();
        selection.forEach((id) => forEachDescendant(d as DocumentModel, id, (n) => remove.add(n.id)));
        remove.forEach((id) => {
          const n = d.nodes[id];
          if (!n) return;
          const sibs = n.parentId ? (d.nodes[n.parentId] as GroupNode | undefined)?.children : d.rootIds;
          if (sibs) {
            const i = sibs.indexOf(id);
            if (i >= 0) sibs.splice(i, 1);
          }
        });
        remove.forEach((id) => {
          delete d.nodes[id];
          d.states.forEach((s) => delete s.tracks[id]);
          d.transitions.forEach((t) => t.targetNodeId === id && (t.targetNodeId = null));
        });
      });
      set({ selection: [], anchorSel: [] });
    },

    duplicateSelection: () => {
      const { selection, doc } = get();
      if (!selection.length) return;
      const newIds: string[] = [];
      mutate((d) => {
        const clone = (id: string, parentId: string | null): string => {
          const src = doc.nodes[id];
          const nid = uid(src.type === 'group' ? 'g' : 'p');
          const copy = JSON.parse(JSON.stringify(src)) as SceneNode;
          copy.id = nid;
          copy.parentId = parentId;
          copy.name = `${src.name} copy`;
          if (copy.type === 'group') copy.children = (src as GroupNode).children.map((c) => clone(c, nid));
          d.nodes[nid] = copy as Draft<SceneNode>;
          d.states.forEach((s) => {
            if (s.tracks[id]) s.tracks[nid] = JSON.parse(JSON.stringify(s.tracks[id]));
          });
          return nid;
        };
        selection.forEach((id) => {
          const src = doc.nodes[id];
          if (!src) return;
          const nid = clone(id, src.parentId);
          (d.nodes[nid] as SceneNode).position = { x: src.position.x + 16, y: src.position.y + 16 };
          const sibs = src.parentId ? (d.nodes[src.parentId] as GroupNode).children : d.rootIds;
          sibs.splice(sibs.indexOf(id) + 1, 0, nid);
          newIds.push(nid);
        });
      });
      set({ selection: newIds });
    },

    groupSelection: () => {
      const { selection, doc } = get();
      if (!selection.length) return;
      const first = doc.nodes[selection[0]];
      const parentId = first.parentId;
      const ids = selection.filter((id) => doc.nodes[id]?.parentId === parentId);
      const g = makeGroupNode('Group', parentId, []);
      mutate((d) => {
        const sibs = parentId ? (d.nodes[parentId] as GroupNode).children : d.rootIds;
        const ordered = sibs.filter((s) => ids.includes(s));
        const insertAt = Math.max(...ordered.map((id) => sibs.indexOf(id)));
        sibs.splice(insertAt + 1, 0, g.id);
        ordered.forEach((id) => sibs.splice(sibs.indexOf(id), 1));
        g.children = ordered;
        d.nodes[g.id] = g;
        ordered.forEach((id) => (d.nodes[id].parentId = g.id));
        const b = staticLocalBBox(d as DocumentModel, g.id);
        if (boxValid(b)) (d.nodes[g.id] as GroupNode).origin = boxCenter(b);
      });
      set({ selection: [g.id], expanded: { ...get().expanded, [g.id]: true } });
    },

    ungroupSelection: () => {
      const { selection, doc } = get();
      const groups = selection.filter((id) => doc.nodes[id]?.type === 'group');
      if (!groups.length) return;
      const released: string[] = [];
      mutate((d) => {
        groups.forEach((gid) => {
          const g = d.nodes[gid] as GroupNode;
          const sibs = g.parentId ? (d.nodes[g.parentId] as GroupNode).children : d.rootIds;
          const at = sibs.indexOf(gid);
          sibs.splice(at, 1, ...g.children);
          g.children.forEach((c) => {
            const child = d.nodes[c];
            child.parentId = g.parentId;
            // fold simple group transform into child (position offset + opacity)
            child.position = { x: child.position.x + g.position.x, y: child.position.y + g.position.y };
            child.opacity *= g.opacity;
            released.push(c);
          });
          delete d.nodes[gid];
          d.states.forEach((s) => delete s.tracks[gid]);
        });
      });
      set({ selection: released });
    },

    moveNode: (id, parentId, index) => {
      const { doc } = get();
      if (id === parentId || (parentId && isDescendant(doc, parentId, id))) return;
      mutate((d) => {
        const n = d.nodes[id];
        const from = siblingsOf(d as DocumentModel, n as SceneNode);
        const oldIdx = from.indexOf(id);
        from.splice(oldIdx, 1);
        const to = parentId ? (d.nodes[parentId] as GroupNode).children : d.rootIds;
        let i = index;
        if (from === to && oldIdx < index) i--;
        to.splice(Math.max(0, Math.min(to.length, i)), 0, id);
        n.parentId = parentId;
      });
    },

    bringForward: (dir) => {
      const { selection, doc } = get();
      if (selection.length !== 1) return;
      const n = doc.nodes[selection[0]];
      const sibs = siblingsOf(doc, n);
      const i = sibs.indexOf(n.id);
      const j = i + dir;
      if (j < 0 || j >= sibs.length) return;
      get().moveNode(n.id, n.parentId, dir > 0 ? j + 1 : j);
    },

    setActiveState: (id) => set({ activeStateId: id, time: 0, keySel: [], playing: false }),
    addState: (kind, name) => {
      const n = get().doc.states.length;
      const st = makeState(name ?? (kind === 'custom' ? `State ${n + 1}` : kind[0].toUpperCase() + kind.slice(1)), kind, {
        x: 60 + (n % 3) * 220,
        y: 40 + Math.floor(n / 3) * 120,
      });
      st.loop = false;
      mutate((d) => {
        d.states.push(st);
      });
      set({ activeStateId: st.id, time: 0 });
    },
    updateState: (id, patch) =>
      mutate((d) => {
        const s = d.states.find((x) => x.id === id);
        if (s) Object.assign(s, patch);
      }),
    deleteState: (id) => {
      const { doc } = get();
      if (doc.states.length <= 1) return get().notify('A document needs at least one state.', 'error');
      mutate((d) => {
        d.states = d.states.filter((s) => s.id !== id);
        d.transitions = d.transitions.filter((t) => t.from !== id && t.to !== id);
        if (d.initialStateId === id) d.initialStateId = d.states[0].id;
      });
      if (get().activeStateId === id) set({ activeStateId: get().doc.states[0].id });
    },
    addTransition: (t) => {
      const { doc, activeStateId } = get();
      const to = doc.states.find((s) => s.id !== activeStateId)?.id ?? activeStateId;
      const tr = makeTransition(t?.from ?? activeStateId, t?.to ?? to, t?.trigger ?? 'click', t);
      mutate((d) => {
        d.transitions.push(tr);
      });
    },
    updateTransition: (id, patch) =>
      mutate((d) => {
        const t = d.transitions.find((x) => x.id === id);
        if (t) Object.assign(t, patch);
      }),
    deleteTransition: (id) =>
      mutate((d) => {
        d.transitions = d.transitions.filter((t) => t.id !== id);
      }),
    addCustomTrigger: (name) => {
      const clean = name.trim();
      if (!clean || get().doc.customTriggers.includes(clean)) return;
      mutate((d) => {
        d.customTriggers.push(clean);
      });
    },
    removeCustomTrigger: (name) =>
      mutate((d) => {
        d.customTriggers = d.customTriggers.filter((c) => c !== name);
        d.transitions = d.transitions.filter((t) => !(t.trigger === 'custom' && t.customName === name));
      }),

    setTime: (t) => set({ time: Math.max(0, t) }),
    setPlaying: (playing) => {
      const st = activeState(get());
      if (playing && !st.loop && get().time >= st.duration) set({ time: 0 });
      set({ playing });
    },
    setView: (v) => set({ view: { ...get().view, ...v } }),
    setViewport: (w, h) => set({ viewport: { w, h } }),
    fitView: () => {
      const { doc, viewport } = get();
      const pad = 64;
      const zoom = Math.max(0.05, Math.min((viewport.w - pad * 2) / doc.width, (viewport.h - pad * 2) / doc.height, 8));
      set({ view: { zoom, x: (viewport.w - doc.width * zoom) / 2, y: (viewport.h - doc.height * zoom) / 2 } });
    },
    zoomBy: (factor, cx, cy) => {
      const { view, viewport } = get();
      const px = cx ?? viewport.w / 2;
      const py = cy ?? viewport.h / 2;
      const zoom = Math.max(0.05, Math.min(64, view.zoom * factor));
      const k = zoom / view.zoom;
      set({ view: { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k } });
    },
    set: (patch) => set(patch as Partial<EditorState>),
    notify: (msg, kind = 'info') => {
      set({ toast: { msg, kind } });
      const current = get().toast;
      setTimeout(() => get().toast === current && set({ toast: null }), 3200);
    },
    setOrigin: (nodeId, origin, history = true) => {
      const { doc, time } = get();
      const node = doc.nodes[nodeId];
      if (!node) return;
      const st = activeState(get());
      const ev = evaluateNode(node, st.tracks[nodeId], time);
      // Keep the artwork fixed: p' = p + (I − R·S)(o − o')  (using the current rotation/scale)
      const r = (ev.rotation * Math.PI) / 180;
      const dx = node.origin.x - origin.x;
      const dy = node.origin.y - origin.y;
      const mx = Math.cos(r) * ev.scale.x * dx - Math.sin(r) * ev.scale.y * dy;
      const my = Math.sin(r) * ev.scale.x * dx + Math.cos(r) * ev.scale.y * dy;
      const off = { x: dx - mx, y: dy - my };
      mutate((d) => {
        const n = d.nodes[nodeId];
        n.origin = { x: origin.x, y: origin.y };
        n.position = { x: n.position.x + off.x, y: n.position.y + off.y };
        d.states.forEach((s) =>
          (s.tracks[nodeId]?.position as Keyframe<'position'>[] | undefined)?.forEach((k) => {
            const v = k.value as Vec;
            k.value = { x: v.x + off.x, y: v.y + off.y };
          }),
        );
      }, history);
    },
  };
});

/** Convenience selector for the currently-edited state's object. */
export const useActiveState = () => useEditor((s) => activeState(s));
