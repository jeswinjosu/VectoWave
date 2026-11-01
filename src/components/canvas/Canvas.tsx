// ─────────────────────────────────────────────────────────────────────────────
//  Infinite canvas: pan (Space/Hand/middle-drag), wheel zoom about cursor, grid,
//  selection + transform handles, sub-selection anchor editing, pen & shapes.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor, PathGeometry, PathNode, Vec } from '../../types/model';
import { activeState, useEditor, type AnchorRef } from '../../store/editor';
import { usePreview } from '../../store/preview';
import { evaluateDoc, localBBox, worldMatrices, type EvalMap } from '../../lib/animation';
import {
  type Mat,
  apply,
  boxCenter,
  boxValid,
  dist,
  IDENTITY,
  invert,
  multiply,
  sub,
  transformBox,
} from '../../lib/math';
import {
  cloneGeometry,
  constrainHandles,
  ellipseGeometry,
  geometryBBox,
  insertAnchor,
  nearestOnCubic,
  pathString,
  rectGeometry,
  segmentCount,
  segmentCubic,
} from '../../lib/path';
import { makePathNode } from '../../lib/doc';
import { spaceGesture } from '../../lib/actions';
import { SceneRenderer } from './SceneRenderer';
import { Grid } from './Grid';
import { cx } from '../ui/primitives';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Vec; items: { id: string; pos: Vec; inv: Mat }[]; moved: boolean }
  | { kind: 'marquee'; start: Vec; cur: Vec; additive: boolean; anchors: boolean }
  | { kind: 'scale'; id: string; handle: string; c: Vec; rot: number; h: Vec; startScale: Vec; inv: Mat }
  | { kind: 'rotate'; id: string; c: Vec; startAngle: number; startRot: number; inv: Mat }
  | { kind: 'origin'; id: string; inv: Mat; snaps: Vec[]; scale: number }
  | { kind: 'anchors'; nodeId: string; startGeo: PathGeometry; refs: AnchorRef[]; startLocal: Vec; inv: Mat; moved: boolean }
  | { kind: 'handle'; nodeId: string; sub: number; idx: number; side: 'in' | 'out'; startGeo: PathGeometry; inv: Mat; breakMode: boolean }
  | { kind: 'pull'; nodeId: string; sub: number; idx: number; startGeo: PathGeometry; inv: Mat }
  | { kind: 'shape'; id: string; start: Vec; type: 'rect' | 'ellipse' };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_CURSOR: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

export function Canvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const anchorSel = useEditor((s) => s.anchorSel);
  const time = useEditor((s) => s.time);
  const showGrid = useEditor((s) => s.showGrid);
  const preview = useEditor((s) => s.preview);
  const editingPathId = useEditor((s) => s.editingPathId);
  const state = useEditor((s) => activeState(s));
  usePreview((s) => s.tick); // re-render each runtime frame while previewing
  const runtime = usePreview((s) => s.runtime);

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [space, setSpace] = useState(false);

  const evals: EvalMap = useMemo(
    () => (preview && runtime ? runtime.evaluate() : evaluateDoc(doc, state, time)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, state, time, preview, runtime, usePreview.getState().tick],
  );
  const worlds = useMemo(() => worldMatrices(doc, evals), [doc, evals]);
  const parentWorld = useCallback((id: string): Mat => {
    const p = doc.nodes[id]?.parentId;
    return p ? worlds[p] ?? IDENTITY : IDENTITY;
  }, [doc, worlds]);

  // ── viewport size ──
  useEffect(() => {
    const el = hostRef.current!;
    let first = true;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      useEditor.getState().setViewport(r.width, r.height);
      if (first && r.width > 0) {
        first = false;
        useEditor.getState().fitView(); // fit once the real size is known
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── wheel zoom (non-passive) ──
  useEffect(() => {
    const el = hostRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const st = useEditor.getState();
      if (e.shiftKey) {
        st.setView({ x: st.view.x - (e.deltaY || e.deltaX), y: st.view.y });
        return;
      }
      const k = e.ctrlKey ? 0.012 : 0.0018;
      st.zoomBy(Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── space-to-pan ──
  useEffect(() => {
    const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement?.tagName ?? '').toUpperCase());
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const screenPt = (e: { clientX: number; clientY: number }): Vec => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (s: Vec): Vec => {
    const v = useEditor.getState().view;
    return { x: (s.x - v.x) / v.zoom, y: (s.y - v.y) / v.zoom };
  };
  const toScreen = (p: Vec): Vec => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y });
  const snapV = (p: Vec): Vec => (useEditor.getState().snap ? { x: Math.round(p.x), y: Math.round(p.y) } : p);

  const nodeChain = (id: string | null) => {
    const out: string[] = [];
    let cur = id;
    while (cur) {
      out.push(cur);
      cur = doc.nodes[cur]?.parentId ?? null;
    }
    return out;
  };

  const currentGeometry = (id: string): PathGeometry => evals[id]?.geometry ?? (doc.nodes[id] as PathNode).geometry;

  const startDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ── pointer down ──
  const onPointerDown = (e: React.PointerEvent) => {
    const st = useEditor.getState();
    st.setFocus('canvas');
    (document.activeElement as HTMLElement | null)?.blur?.();
    const s = screenPt(e);
    const w = toWorld(s);
    const target = e.target as Element;

    if (e.button === 1 || space || tool === 'hand') {
      e.preventDefault();
      spaceGesture.panned = true;
      startDrag({ kind: 'pan', sx: s.x, sy: s.y, vx: st.view.x, vy: st.view.y });
      return;
    }
    if (e.button !== 0) return;

    if (preview && runtime) {
      const hit = target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
      runtime.pointer('pointerDown', nodeChain(hit));
      return;
    }

    const handleEl = target.closest('[data-handle]');
    const anchorEl = target.closest('[data-a]');
    const ctrlEl = target.closest('[data-h]');
    const hitId = target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;

    // Transform handles
    if (handleEl && selection.length === 1) {
      const id = selection[0];
      const n = doc.nodes[id];
      const e0 = evals[id];
      const inv = invert(parentWorld(id));
      const c = { x: e0.position.x + n.origin.x, y: e0.position.y + n.origin.y };
      const h = handleEl.getAttribute('data-handle')!;
      st.checkpoint();
      if (h === 'origin') {
        // Move only the pivot: work in the node's own coordinates (its world matrix stays fixed)
        const m = worlds[id] ?? IDENTITY;
        const b = localBBox(doc, evals, id);
        const snaps = boxValid(b)
          ? [0, 0.5, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: b.minX + (b.maxX - b.minX) * fx, y: b.minY + (b.maxY - b.minY) * fy })))
          : [];
        startDrag({ kind: 'origin', id, inv: invert(m), snaps, scale: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * st.view.zoom || 1 });
        return;
      }
      if (h === 'rot') {
        const q = apply(inv, w);
        startDrag({ kind: 'rotate', id, c, startAngle: (Math.atan2(q.y - c.y, q.x - c.x) * 180) / Math.PI, startRot: e0.rotation, inv });
      } else {
        const b = localBBox(doc, evals, id);
        const hx = h.includes('w') ? b.minX : h.includes('e') ? b.maxX : n.origin.x;
        const hy = h.includes('n') ? b.minY : h.includes('s') ? b.maxY : n.origin.y;
        startDrag({ kind: 'scale', id, handle: h, c, rot: e0.rotation, h: { x: hx - n.origin.x, y: hy - n.origin.y }, startScale: e0.scale, inv });
      }
      return;
    }

    // ── Direct selection: anchors & handles ──
    if (tool === 'direct' || (tool === 'pen' && !editingPathId && (anchorEl || ctrlEl))) {
      if (ctrlEl) {
        const [nodeId, subS, idxS, side] = ctrlEl.getAttribute('data-h')!.split('|');
        st.checkpoint();
        startDrag({ kind: 'handle', nodeId, sub: +subS, idx: +idxS, side: side as 'in' | 'out', startGeo: currentGeometry(nodeId), inv: invert(worlds[nodeId]), breakMode: e.altKey });
        return;
      }
      if (anchorEl) {
        const [nodeId, subS, idxS] = anchorEl.getAttribute('data-a')!.split('|');
        const ref = { nodeId, sub: +subS, idx: +idxS };
        const isSel = anchorSel.some((a) => a.nodeId === nodeId && a.sub === ref.sub && a.idx === ref.idx);
        let refs = anchorSel;
        if (e.shiftKey) refs = isSel ? anchorSel.filter((a) => !(a.nodeId === nodeId && a.sub === ref.sub && a.idx === ref.idx)) : [...anchorSel, ref];
        else if (!isSel) refs = [ref];
        st.setAnchorSel(refs);
        const inv = invert(worlds[nodeId]);
        st.checkpoint();
        if (e.altKey) {
          startDrag({ kind: 'pull', nodeId, sub: ref.sub, idx: ref.idx, startGeo: currentGeometry(nodeId), inv });
        } else {
          startDrag({ kind: 'anchors', nodeId, startGeo: currentGeometry(nodeId), refs: refs.filter((r) => r.nodeId === nodeId), startLocal: apply(inv, w), inv, moved: false });
        }
        return;
      }
    }

    // ── Pen tool ──
    if (tool === 'pen') {
      penDown(w, e.altKey);
      return;
    }

    // ── Shapes ──
    if (tool === 'rect' || tool === 'ellipse') {
      const p = snapV(w);
      const node = makePathNode(tool === 'rect' ? 'Rectangle' : 'Ellipse', rectGeometry(p.x, p.y, 0.01, 0.01), null, { fill: '#8b9cff' });
      st.addNode(node);
      startDrag({ kind: 'shape', id: node.id, start: p, type: tool });
      return;
    }

    // ── Select / direct: clicking a shape ──
    if (hitId) {
      const node = doc.nodes[hitId];
      if (node?.locked) return;
      if (tool === 'direct') {
        if (!selection.includes(hitId)) {
          st.select([hitId], e.shiftKey ? 'add' : 'replace');
          st.setAnchorSel([]);
        }
      } else if (e.shiftKey) {
        st.select([hitId], 'toggle');
        return;
      } else if (!selection.includes(hitId)) st.select([hitId]);
      const ids = tool === 'direct' ? [hitId] : selection.includes(hitId) ? selection : [hitId];
      const items = ids
        .filter((id) => doc.nodes[id] && !doc.nodes[id].locked)
        // Don't double-move descendants of moved groups
        .filter((id) => !nodeChain(doc.nodes[id].parentId).some((a) => ids.includes(a)))
        .map((id) => ({ id, pos: evals[id].position, inv: invert(parentWorld(id)) }));
      startDrag({ kind: 'move', start: w, items, moved: false });
      return;
    }

    // ── Empty canvas → marquee ──
    if (!e.shiftKey) {
      if (tool === 'direct' && anchorSel.length) st.setAnchorSel([]);
      else if (tool !== 'direct') st.select([]);
    }
    startDrag({ kind: 'marquee', start: s, cur: s, additive: e.shiftKey, anchors: tool === 'direct' && selection.length > 0 });
  };

  // ── Pen ──
  const penDown = (w: Vec, alt: boolean) => {
    const st = useEditor.getState();
    const p = snapV(w);
    const editing = st.editingPathId ? (st.doc.nodes[st.editingPathId] as PathNode | undefined) : undefined;
    if (!editing) {
      // Click on a selected path's segment → insert anchor (Illustrator-style)
      if (selection.length === 1 && doc.nodes[selection[0]]?.type === 'path' && !alt) {
        const hit = findSegment(selection[0], w);
        if (hit) {
          st.editGeometry(selection[0], (g) => insertAnchor(g, hit.sub, hit.seg, hit.t), true);
          return;
        }
      }
      st.checkpoint();
      const node = makePathNode('Pen Path', { subpaths: [{ closed: false, anchors: [{ x: p.x, y: p.y, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' }] }] }, null, {
        fill: 'none',
        stroke: '#e2e8f0',
        strokeWidth: 3,
        lineCap: 'round',
        lineJoin: 'round',
      });
      useEditor.setState({ doc: { ...st.doc, nodes: { ...st.doc.nodes, [node.id]: node }, rootIds: [...st.doc.rootIds, node.id] }, selection: [node.id], editingPathId: node.id, anchorSel: [{ nodeId: node.id, sub: 0, idx: 0 }] });
      startDrag({ kind: 'pull', nodeId: node.id, sub: 0, idx: 0, startGeo: node.geometry, inv: IDENTITY });
      return;
    }
    const inv = invert(worlds[editing.id] ?? IDENTITY);
    const local = apply(inv, p);
    const sp = editing.geometry.subpaths[editing.geometry.subpaths.length - 1];
    const first = sp.anchors[0];
    const firstScreen = toScreen(apply(worlds[editing.id] ?? IDENTITY, first));
    if (sp.anchors.length > 2 && dist(firstScreen, toScreen(p)) < 10) {
      st.editGeometry(editing.id, (g) => {
        const out = cloneGeometry(g);
        out.subpaths[out.subpaths.length - 1].closed = true;
        return out;
      }, true);
      useEditor.setState({ editingPathId: null });
      recenterOrigin(editing.id);
      return;
    }
    st.checkpoint();
    const si = editing.geometry.subpaths.length - 1;
    const idx = sp.anchors.length;
    const next = cloneGeometry(editing.geometry);
    next.subpaths[si].anchors.push({ x: local.x, y: local.y, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' });
    st.setNodeAttrs(editing.id, { geometry: next }, false);
    st.setAnchorSel([{ nodeId: editing.id, sub: si, idx }]);
    startDrag({ kind: 'pull', nodeId: editing.id, sub: si, idx, startGeo: next, inv });
  };

  const recenterOrigin = (id: string) => {
    const n = useEditor.getState().doc.nodes[id];
    if (!n || n.type !== 'path') return;
    const b = geometryBBox(n.geometry);
    if (!boxValid(b)) return;
    // Keep visual position stable: origin only matters with rotation/scale ≠ identity
    if (n.rotation === 0 && n.scale.x === 1 && n.scale.y === 1) useEditor.getState().setNodeAttrs(id, { origin: boxCenter(b) }, false);
  };

  /** Nearest segment on a path (in screen tolerance). */
  const findSegment = (id: string, w: Vec) => {
    const n = doc.nodes[id];
    if (!n || n.type !== 'path') return null;
    const g = currentGeometry(id);
    const m = worlds[id] ?? IDENTITY;
    const local = apply(invert(m), w);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * view.zoom || 1;
    let best: { sub: number; seg: number; t: number; d: number } | null = null;
    g.subpaths.forEach((sp, si) => {
      for (let i = 0; i < segmentCount(sp); i++) {
        const r = nearestOnCubic(segmentCubic(sp, i), local);
        if (r.t > 0.02 && r.t < 0.98 && (!best || r.d < best.d)) best = { sub: si, seg: i, t: r.t, d: r.d };
      }
    });
    const b = best as { sub: number; seg: number; t: number; d: number } | null;
    return b && b.d * scale < 8 ? b : null;
  };

  // ── pointer move / up (window-level while dragging) ──
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const st = useEditor.getState();
      const s = screenPt(e);
      const w = toWorld(s);
      switch (d.kind) {
        case 'pan':
          st.setView({ x: d.vx + (s.x - d.sx), y: d.vy + (s.y - d.sy) });
          break;
        case 'move': {
          const delta = sub(w, d.start);
          if (!d.moved) {
            if (Math.hypot(delta.x, delta.y) * st.view.zoom < 3) return;
            d.moved = true;
            st.checkpoint();
          }
          d.items.forEach((it) => {
            const dl = { x: it.inv[0] * delta.x + it.inv[2] * delta.y, y: it.inv[1] * delta.x + it.inv[3] * delta.y };
            st.setProp(it.id, 'position', snapV({ x: it.pos.x + dl.x, y: it.pos.y + dl.y }), false);
          });
          break;
        }
        case 'marquee':
          d.cur = s;
          setDrag({ ...d });
          break;
        case 'scale': {
          const q = apply(d.inv, w);
          const r = (-d.rot * Math.PI) / 180;
          const rel = { x: q.x - d.c.x, y: q.y - d.c.y };
          const u = { x: rel.x * Math.cos(r) - rel.y * Math.sin(r), y: rel.x * Math.sin(r) + rel.y * Math.cos(r) };
          let sx = d.startScale.x;
          let sy = d.startScale.y;
          const affectsX = /[ew]/.test(d.handle);
          const affectsY = /[ns]/.test(d.handle);
          if (affectsX && Math.abs(d.h.x) > 1e-6) sx = u.x / d.h.x;
          if (affectsY && Math.abs(d.h.y) > 1e-6) sy = u.y / d.h.y;
          if (e.shiftKey) {
            const kx = sx / (d.startScale.x || 1);
            const ky = sy / (d.startScale.y || 1);
            const k = affectsX && affectsY ? (kx + ky) / 2 : affectsX ? kx : ky;
            sx = d.startScale.x * k;
            sy = d.startScale.y * k;
          }
          const rnd = (v: number) => Math.round(v * 1000) / 1000;
          st.setProp(d.id, 'scale', { x: rnd(sx), y: rnd(sy) }, false);
          break;
        }
        case 'origin': {
          let o = apply(d.inv, w);
          // Snap to the content's centre / corners / edge midpoints (hold Alt to disable)
          if (!e.altKey) {
            const near = d.snaps.find((p) => Math.hypot(p.x - o.x, p.y - o.y) * d.scale < 8);
            if (near) o = near;
            else if (st.snap) o = { x: Math.round(o.x), y: Math.round(o.y) };
          }
          st.setOrigin(d.id, o, false);
          break;
        }
        case 'rotate': {
          const q = apply(d.inv, w);
          const a = (Math.atan2(q.y - d.c.y, q.x - d.c.x) * 180) / Math.PI;
          let rot = d.startRot + (a - d.startAngle);
          if (e.shiftKey) rot = Math.round(rot / 15) * 15;
          st.setProp(d.id, 'rotation', Math.round(rot * 100) / 100, false);
          break;
        }
        case 'anchors': {
          const local = apply(d.inv, w);
          let delta = sub(local, d.startLocal);
          if (!d.moved) {
            if (Math.hypot(delta.x, delta.y) * st.view.zoom < 2) return;
            d.moved = true;
          }
          if (st.snap) delta = { x: Math.round(delta.x), y: Math.round(delta.y) };
          const set = new Set(d.refs.map((r) => `${r.sub}|${r.idx}`));
          st.editGeometry(d.nodeId, () => {
            const g = cloneGeometry(d.startGeo);
            g.subpaths.forEach((sp, si) =>
              sp.anchors.forEach((a, i) => {
                if (set.has(`${si}|${i}`)) {
                  a.x += delta.x;
                  a.y += delta.y;
                }
              }),
            );
            return g;
          }, false, false);
          break;
        }
        case 'handle': {
          const local = apply(d.inv, w);
          st.editGeometry(d.nodeId, () => {
            const g = cloneGeometry(d.startGeo);
            const sp = g.subpaths[d.sub];
            let a: Anchor = sp.anchors[d.idx];
            if (d.breakMode || e.altKey) a = { ...a, mode: 'disconnected' };
            else if (a.mode === 'corner') a = { ...a, mode: 'asymmetric' };
            if (d.side === 'in') {
              a.inX = local.x - a.x;
              a.inY = local.y - a.y;
            } else {
              a.outX = local.x - a.x;
              a.outY = local.y - a.y;
            }
            sp.anchors[d.idx] = constrainHandles(a, d.side);
            return g;
          }, false, false);
          break;
        }
        case 'pull': {
          const local = apply(d.inv, w);
          st.editGeometry(d.nodeId, () => {
            const g = cloneGeometry(d.startGeo);
            const a = g.subpaths[d.sub].anchors[d.idx];
            const ox = local.x - a.x;
            const oy = local.y - a.y;
            if (Math.hypot(ox, oy) * st.view.zoom < 3) return g;
            g.subpaths[d.sub].anchors[d.idx] = { ...a, outX: ox, outY: oy, inX: -ox, inY: -oy, mode: e.altKey && st.tool === 'pen' ? 'disconnected' : 'mirrored' };
            return g;
          }, false, false);
          break;
        }
        case 'shape': {
          let p = snapV(w);
          if (e.shiftKey) {
            const side = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y));
            p = { x: d.start.x + Math.sign(p.x - d.start.x || 1) * side, y: d.start.y + Math.sign(p.y - d.start.y || 1) * side };
          }
          const x = Math.min(p.x, d.start.x);
          const y = Math.min(p.y, d.start.y);
          const wd = Math.max(0.01, Math.abs(p.x - d.start.x));
          const ht = Math.max(0.01, Math.abs(p.y - d.start.y));
          const geo = d.type === 'rect' ? rectGeometry(x, y, wd, ht) : ellipseGeometry(x + wd / 2, y + ht / 2, wd / 2, ht / 2);
          st.setNodeAttrs(d.id, { geometry: geo, origin: { x: x + wd / 2, y: y + ht / 2 } }, false);
          break;
        }
      }
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const st = useEditor.getState();
      if (d.kind === 'marquee') finishMarquee(d);
      if (d.kind === 'shape') {
        const n = st.doc.nodes[d.id] as PathNode | undefined;
        const b = n ? geometryBBox(n.geometry) : null;
        if (!b || b.maxX - b.minX < 2 || b.maxY - b.minY < 2) {
          // Treat as a click: create a default-size shape
          const s = 100;
          const geo = d.type === 'rect' ? rectGeometry(d.start.x - s / 2, d.start.y - s / 2, s, s) : ellipseGeometry(d.start.x, d.start.y, s / 2, s / 2);
          st.setNodeAttrs(d.id, { geometry: geo, origin: d.start }, false);
        }
        st.setTool('select');
      }
      if (d.kind === 'pull' && st.editingPathId) recenterOrigin(d.nodeId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind]);

  const finishMarquee = (d: Extract<Drag, { kind: 'marquee' }>) => {
    const st = useEditor.getState();
    const a = toWorld(d.start);
    const b = toWorld(d.cur);
    const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    if (Math.abs(d.cur.x - d.start.x) < 3 && Math.abs(d.cur.y - d.start.y) < 3) return;
    if (d.anchors) {
      const refs: AnchorRef[] = d.additive ? [...st.anchorSel] : [];
      st.selection.forEach((id) => {
        const n = st.doc.nodes[id];
        if (n?.type !== 'path') return;
        const m = worlds[id] ?? IDENTITY;
        currentGeometry(id).subpaths.forEach((sp, si) =>
          sp.anchors.forEach((an, i) => {
            const p = apply(m, an);
            if (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) refs.push({ nodeId: id, sub: si, idx: i });
          }),
        );
      });
      st.setAnchorSel(refs);
      return;
    }
    const hits = Object.values(st.doc.nodes)
      .filter((n) => n.type === 'path' && n.visible && !n.locked)
      .filter((n) => {
        const wb = transformBox(localBBox(st.doc, evals, n.id), worlds[n.id] ?? IDENTITY);
        return boxValid(wb) && wb.minX <= box.maxX && wb.maxX >= box.minX && wb.minY <= box.maxY && wb.maxY >= box.minY;
      })
      .map((n) => n.id);
    st.select(hits, d.additive ? 'add' : 'replace');
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (preview) return;
    const st = useEditor.getState();
    const hitId = (e.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id');
    const anchorEl = (e.target as Element).closest('[data-a]');
    if (anchorEl) {
      // Toggle corner ↔ smooth
      const [nodeId, subS, idxS] = anchorEl.getAttribute('data-a')!.split('|');
      st.editGeometry(nodeId, (g) => {
        const out = cloneGeometry(g);
        const sp = out.subpaths[+subS];
        const a = sp.anchors[+idxS];
        const toSmooth = a.mode === 'corner';
        sp.anchors[+idxS] = toSmooth ? smoothAnchor(sp.anchors, +idxS, sp.closed) : { ...a, inX: 0, inY: 0, outX: 0, outY: 0, mode: 'corner' };
        return out;
      }, false);
      return;
    }
    if (tool === 'select' && hitId && doc.nodes[hitId]?.type === 'path') {
      st.setTool('direct');
      st.select([hitId]);
      return;
    }
    if (tool === 'direct' && selection.length) {
      const w = toWorld(screenPt(e));
      for (const id of selection) {
        const hit = findSegment(id, w);
        if (hit) {
          st.editGeometry(id, (g) => insertAnchor(g, hit.sub, hit.seg, hit.t), true);
          st.setAnchorSel([{ nodeId: id, sub: hit.sub, idx: hit.seg + 1 }]);
          return;
        }
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) return;
    const target = e.target as Element;
    const id = target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
    if (preview && runtime) {
      const s = screenPt(e);
      const w = toWorld(s);
      const inside = w.x >= 0 && w.y >= 0 && w.x <= doc.width && w.y <= doc.height;
      runtime.pointerMove(inside, nodeChain(id));
      return;
    }
    if (id !== hover) setHover(id);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (preview && runtime) {
      const id = (e.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
      runtime.pointer('pointerUp', nodeChain(id));
      runtime.pointer('click', nodeChain(id));
    }
  };

  // ── overlays ──
  const zoom = view.zoom;
  const rootTransform = `translate(${view.x} ${view.y}) scale(${zoom})`;

  const selectionOverlay = () => {
    if (preview || !selection.length || tool === 'pen') return null;
    const items = selection.filter((id) => doc.nodes[id] && evals[id]);
    if (!items.length) return null;
    const single = items.length === 1 ? items[0] : null;
    if (single) {
      const n = doc.nodes[single];
      const b = localBBox(doc, evals, single);
      if (!boxValid(b)) return null;
      const m = multiply([zoom, 0, 0, zoom, view.x, view.y], worlds[single] ?? IDENTITY);
      const pts = {
        nw: apply(m, { x: b.minX, y: b.minY }),
        n: apply(m, { x: (b.minX + b.maxX) / 2, y: b.minY }),
        ne: apply(m, { x: b.maxX, y: b.minY }),
        e: apply(m, { x: b.maxX, y: (b.minY + b.maxY) / 2 }),
        se: apply(m, { x: b.maxX, y: b.maxY }),
        s: apply(m, { x: (b.minX + b.maxX) / 2, y: b.maxY }),
        sw: apply(m, { x: b.minX, y: b.maxY }),
        w: apply(m, { x: b.minX, y: (b.minY + b.maxY) / 2 }),
      };
      const origin = apply(m, n.origin);
      const up = sub(pts.n, pts.s);
      const ul = Math.hypot(up.x, up.y) || 1;
      const rotPt = { x: pts.n.x + (up.x / ul) * 26, y: pts.n.y + (up.y / ul) * 26 };
      const showHandles = tool === 'select' && !n.locked;
      return (
        <g>
          <polygon points={[pts.nw, pts.ne, pts.se, pts.sw].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-accent" strokeWidth={1} />
          {showHandles && (
            <>
              <line x1={pts.n.x} y1={pts.n.y} x2={rotPt.x} y2={rotPt.y} className="stroke-accent" strokeWidth={1} />
              <circle data-handle="rot" cx={rotPt.x} cy={rotPt.y} r={5} className="fill-panel stroke-accent" strokeWidth={1.5} style={{ cursor: 'grab' }}>
                <title>Rotate (Shift snaps 15°)</title>
              </circle>
              {HANDLES.map((h) => (
                <rect key={h} data-handle={h} x={pts[h].x - 4} y={pts[h].y - 4} width={8} height={8} rx={1.5} className="fill-fg stroke-accent" strokeWidth={1.5} style={{ cursor: HANDLE_CURSOR[h] }}>
                  <title>Scale about origin (Shift = uniform)</title>
                </rect>
              ))}
            </>
          )}
          <g
            transform={`translate(${origin.x} ${origin.y})`}
            data-handle={showHandles ? 'origin' : undefined}
            pointerEvents={showHandles ? 'all' : 'none'}
            style={{ cursor: 'move' }}
            data-testid="origin-handle"
          >
            <title>Drag to move the origin (pivot) only · snaps to centre and corners, Alt to move freely</title>
            <circle r={9} fill="transparent" />
            <circle r={4.5} className={drag?.kind === 'origin' ? 'fill-accent2 stroke-accent2' : 'fill-panel stroke-accent2'} strokeWidth={1.5} />
            <line x1={-9} x2={-5} className="stroke-accent2" strokeWidth={1.5} />
            <line x1={5} x2={9} className="stroke-accent2" strokeWidth={1.5} />
            <line y1={-9} y2={-5} className="stroke-accent2" strokeWidth={1.5} />
            <line y1={5} y2={9} className="stroke-accent2" strokeWidth={1.5} />
          </g>
        </g>
      );
    }
    // multi: union of world boxes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    items.forEach((id) => {
      const wb = transformBox(localBBox(doc, evals, id), worlds[id] ?? IDENTITY);
      if (!boxValid(wb)) return;
      minX = Math.min(minX, wb.minX);
      minY = Math.min(minY, wb.minY);
      maxX = Math.max(maxX, wb.maxX);
      maxY = Math.max(maxY, wb.maxY);
    });
    if (!isFinite(minX)) return null;
    const a = toScreen({ x: minX, y: minY });
    const b2 = toScreen({ x: maxX, y: maxY });
    return <rect x={a.x} y={a.y} width={b2.x - a.x} height={b2.y - a.y} fill="none" className="stroke-accent" strokeDasharray="4 3" strokeWidth={1} />;
  };

  const outline = (id: string, cls: string, w = 1) => {
    const n = doc.nodes[id];
    if (!n || n.type !== 'path' || !worlds[id]) return null;
    const m = multiply([zoom, 0, 0, zoom, view.x, view.y], worlds[id]);
    return (
      <path
        key={`o-${id}-${cls}`}
        d={pathString(currentGeometry(id))}
        transform={`matrix(${m.join(' ')})`}
        fill="none"
        className={cls}
        strokeWidth={w}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    );
  };

  const pathEditOverlay = () => {
    if (preview) return null;
    const ids = tool === 'direct' ? selection : tool === 'pen' && editingPathId ? [editingPathId] : [];
    return ids.map((id) => {
      const n = doc.nodes[id];
      if (!n || n.type !== 'path') return null;
      const g = currentGeometry(id);
      const m = multiply([zoom, 0, 0, zoom, view.x, view.y], worlds[id] ?? IDENTITY);
      const selSet = new Set(anchorSel.filter((a) => a.nodeId === id).map((a) => `${a.sub}|${a.idx}`));
      const showAll = g.subpaths.reduce((s, sp) => s + sp.anchors.length, 0) <= 16;
      return (
        <g key={`pe-${id}`}>
          {outline(id, 'stroke-accent', 1.25)}
          {g.subpaths.map((sp, si) =>
            sp.anchors.map((a, i) => {
              const n2 = sp.anchors.length;
              const prevSel = selSet.has(`${si}|${(i - 1 + n2) % n2}`) && (sp.closed || i > 0);
              const nextSel = selSet.has(`${si}|${(i + 1) % n2}`) && (sp.closed || i < n2 - 1);
              const sel = selSet.has(`${si}|${i}`);
              const p = apply(m, a);
              const handles: JSX.Element[] = [];
              const showIn = (sel || prevSel || showAll) && (a.inX || a.inY);
              const showOut = (sel || nextSel || showAll) && (a.outX || a.outY);
              ([['in', a.inX, a.inY, showIn], ['out', a.outX, a.outY, showOut]] as const).forEach(([side, hx, hy, show]) => {
                if (!show) return;
                const hp = apply(m, { x: a.x + hx, y: a.y + hy });
                handles.push(
                  <g key={side}>
                    <line x1={p.x} y1={p.y} x2={hp.x} y2={hp.y} className="stroke-accent2" strokeWidth={1} pointerEvents="none" />
                    <circle data-h={`${id}|${si}|${i}|${side}`} cx={hp.x} cy={hp.y} r={4} className="fill-panel stroke-accent2 hover:fill-accent2" strokeWidth={1.5} style={{ cursor: 'move' }}>
                      <title>Drag handle (Alt breaks symmetry)</title>
                    </circle>
                  </g>,
                );
              });
              const isCorner = a.mode === 'corner';
              return (
                <g key={`${si}-${i}`}>
                  {handles}
                  {isCorner ? (
                    <rect data-a={`${id}|${si}|${i}`} x={p.x - 4} y={p.y - 4} width={8} height={8} className={sel ? 'fill-accent stroke-accent' : 'fill-panel stroke-accent'} strokeWidth={1.5} style={{ cursor: 'pointer' }} />
                  ) : (
                    <circle data-a={`${id}|${si}|${i}`} cx={p.x} cy={p.y} r={4.5} className={sel ? 'fill-accent stroke-accent' : 'fill-panel stroke-accent'} strokeWidth={1.5} style={{ cursor: 'pointer' }} />
                  )}
                </g>
              );
            }),
          )}
        </g>
      );
    });
  };

  const cursor = drag?.kind === 'pan' ? 'grabbing' : space || tool === 'hand' ? 'grab' : preview ? 'default' : tool === 'pen' || tool === 'rect' || tool === 'ellipse' ? 'crosshair' : 'default';
  const marquee = drag?.kind === 'marquee' ? drag : null;
  const ab0 = toScreen({ x: 0, y: 0 });

  return (
    <div
      ref={hostRef}
      className={cx('relative h-full w-full overflow-hidden bg-bg', preview && 'ring-2 ring-inset ring-accent/40')}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => preview && runtime?.pointerMove(false, [])}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="canvas"
    >
      <svg ref={svgRef} className="absolute inset-0 h-full w-full select-none" style={{ touchAction: 'none' }}>
        <defs>
          <pattern id="vm-checker" width={16} height={16} patternUnits="userSpaceOnUse">
            <rect width={16} height={16} fill="#2a2a30" />
            <rect width={8} height={8} fill="#33333a" />
            <rect x={8} y={8} width={8} height={8} fill="#33333a" />
          </pattern>
          <filter id="vm-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx={0} dy={8} stdDeviation={14} floodColor="#000" floodOpacity={0.45} />
          </filter>
        </defs>
        {showGrid && <Grid view={view} />}
        {/* Artboard */}
        <rect x={ab0.x} y={ab0.y} width={doc.width * zoom} height={doc.height * zoom} fill={doc.background ?? 'url(#vm-checker)'} filter="url(#vm-shadow)" />
        <g transform={rootTransform}>
          <SceneRenderer doc={doc} evals={evals} zoom={zoom} />
        </g>
        <rect x={ab0.x} y={ab0.y} width={doc.width * zoom} height={doc.height * zoom} fill="none" className="stroke-line" strokeWidth={1} pointerEvents="none" />
        {/* Overlays in screen space */}
        <g>
          {!preview && hover && !selection.includes(hover) && tool !== 'hand' && outline(hover, 'stroke-accent/70', 1.5)}
          {!preview && tool === 'select' && selection.filter((id) => doc.nodes[id]?.type === 'path').map((id) => outline(id, 'stroke-accent/50', 1))}
          {selectionOverlay()}
          {pathEditOverlay()}
          {marquee && (
            <rect
              x={Math.min(marquee.start.x, marquee.cur.x)}
              y={Math.min(marquee.start.y, marquee.cur.y)}
              width={Math.abs(marquee.cur.x - marquee.start.x)}
              height={Math.abs(marquee.cur.y - marquee.start.y)}
              className="fill-accent/10 stroke-accent"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </g>
      </svg>
      <CanvasHud />
    </div>
  );
}

function smoothAnchor(anchors: Anchor[], i: number, closed: boolean): Anchor {
  const a = anchors[i];
  const n = anchors.length;
  const prev = closed || i > 0 ? anchors[(i - 1 + n) % n] : a;
  const next = closed || i < n - 1 ? anchors[(i + 1) % n] : a;
  let tx = next.x - prev.x;
  let ty = next.y - prev.y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const l = (dist(a, prev) + dist(a, next)) / 6 || 20;
  return { ...a, inX: -tx * l, inY: -ty * l, outX: tx * l, outY: ty * l, mode: 'mirrored' };
}

function CanvasHud() {
  const zoom = useEditor((s) => s.view.zoom);
  const tool = useEditor((s) => s.tool);
  const preview = useEditor((s) => s.preview);
  const editing = useEditor((s) => s.editingPathId);
  const runtime = usePreview((s) => s.runtime);
  usePreview((s) => (s.runtime ? Math.floor(s.tick / 6) : 0));
  const hint = preview
    ? 'Interactive preview — hover, press and click the artwork'
    : tool === 'direct'
      ? 'Click anchors · Shift multi-select · Alt+drag pulls handles · Double-click segment adds anchor · Double-click anchor toggles smooth/corner · Delete removes'
      : tool === 'pen'
        ? editing
          ? 'Click to add · Drag for curves · Click first point to close · Enter/Esc to finish'
          : 'Click to start a path · Click a selected path segment to insert an anchor'
        : tool === 'rect' || tool === 'ellipse'
          ? 'Drag to draw · Shift constrains proportions'
          : 'Space+Drag to pan · Scroll to zoom · Double-click a shape to edit its anchors · Drag the pivot to move the origin';
  return (
    <>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-panel/90 px-2 py-1 text-2xs text-muted shadow">{hint}</div>
      <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 rounded-md bg-panel/90 px-2 py-1 font-mono text-2xs text-muted shadow">
        {preview && runtime && (
          <span className="text-accent">
            ● {runtime.state?.name}
          </span>
        )}
        {Math.round(zoom * 100)}%
      </div>
    </>
  );
}
