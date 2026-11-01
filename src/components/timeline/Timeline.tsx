// ─────────────────────────────────────────────────────────────────────────────
//  Timeline: per-state tabs, transport, zoomable ruler with scrubbing, layer
//  tree (drag-to-reorder, expand to property tracks), draggable keyframes.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Circle as CircleIcon,
  Diamond,
  Eye,
  EyeOff,
  Filter,
  Folder,
  FolderOpen,
  GripVertical,
  Lock,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Spline,
  Unlock,
} from 'lucide-react';
import type { Keyframe, PropKey, SceneNode } from '../../types/model';
import { ALL_PROPS, PROP_LABELS } from '../../types/model';
import { activeState, useEditor, type KeyRef } from '../../store/editor';
import { isAnimatable, keyAt, nodeKeyTimes } from '../../lib/animation';
import { stepFrame, togglePlay } from '../../lib/actions';
import { cx, KeyButton } from '../ui/primitives';
import { StateMachinePanel } from '../statemachine/StateMachinePanel';
import { KIND_ICON, PanelTabs } from './shared';

const LEFT = 252;
const ROW = 26;
const X0 = 12; // px padding before t=0

type Row = { kind: 'layer'; id: string; depth: number } | { kind: 'prop'; id: string; prop: PropKey; depth: number };


function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const rest = Math.round(ms % 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
}

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomTab);
  const height = useEditor((s) => s.bottomHeight);
  const set = useEditor((s) => s.set);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => set({ bottomHeight: Math.min(window.innerHeight - 200, Math.max(140, h0 - (ev.clientY - y0))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section style={{ height }} className="relative flex shrink-0 flex-col border-t border-line bg-panel" aria-label="Timeline and states">
      <div onPointerDown={startResize} className="absolute -top-1 left-0 right-0 z-30 h-2 cursor-ns-resize" title="Drag to resize" />
      {tab === 'timeline' ? <Timeline /> : <StateMachinePanel />}
    </section>
  );
}



export function StateTabs() {
  const states = useEditor((s) => s.doc.states);
  const activeId = useEditor((s) => s.activeStateId);
  const initialId = useEditor((s) => s.doc.initialStateId);
  const setActiveState = useEditor((s) => s.setActiveState);
  const addState = useEditor((s) => s.addState);
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Animation states">
      {states.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === activeId}
          onClick={() => setActiveState(s.id)}
          className={cx(
            'flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-2xs font-medium',
            s.id === activeId ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-raised hover:text-fg',
          )}
          title={`${s.name} (${s.kind})${s.id === initialId ? ' · initial state' : ''}`}
        >
          <span aria-hidden>{KIND_ICON[s.kind]}</span>
          {s.name}
        </button>
      ))}
      <button className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg" title="Add custom state" onClick={() => addState('custom')}>
        <Plus size={13} />
      </button>
    </div>
  );
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const state = useEditor((s) => activeState(s));
  const autoKey = useEditor((s) => s.autoKey);
  const animatedOnly = useEditor((s) => s.animatedOnly);
  const zoom = useEditor((s) => s.timelineZoom);
  const set = useEditor((s) => s.set);
  const setTime = useEditor((s) => s.setTime);
  const updateState = useEditor((s) => s.updateState);
  const preview = useEditor((s) => s.preview);
  const [durText, setDurText] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1">
      <button className="tl-btn" title="Go to start (Home)" onClick={() => setTime(0)}>
        <SkipBack size={13} />
      </button>
      <button className="tl-btn" title="Previous frame (←)" onClick={() => stepFrame(-1)}>
        <ChevronLeft size={14} />
      </button>
      <button
        className={cx('grid h-7 w-7 place-items-center rounded-md', playing ? 'bg-accent text-accent-fg' : 'bg-raised text-fg hover:brightness-110')}
        title="Play / Pause (Space)"
        onClick={togglePlay}
        disabled={preview}
      >
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <button className="tl-btn" title="Next frame (→)" onClick={() => stepFrame(1)}>
        <ChevronRight size={14} />
      </button>
      <button className="tl-btn" title="Go to end (End)" onClick={() => setTime(state.duration)}>
        <SkipForward size={13} />
      </button>
      <button className={cx('tl-btn', state.loop && '!text-accent !bg-accent/15')} title="Loop this state" onClick={() => updateState(state.id, { loop: !state.loop })} aria-pressed={state.loop}>
        <Repeat size={13} />
      </button>
      <div className="ml-1 rounded-md bg-panel2 px-2 py-1 font-mono text-2xs text-fg" aria-live="off">
        {fmtTime(time)}
      </div>
      <span className="text-2xs text-faint">/</span>
      <input
        className="h-6 w-16 rounded-md bg-panel2 px-1.5 font-mono text-2xs text-fg outline-none focus:ring-1 focus:ring-accent/60"
        value={durText ?? `${state.duration}ms`}
        onFocus={() => setDurText(String(state.duration))}
        onChange={(e) => setDurText(e.target.value)}
        onBlur={() => {
          const v = parseInt(durText ?? '', 10);
          if (v > 0) updateState(state.id, { duration: Math.min(120000, v) });
          setDurText(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="State duration in milliseconds"
        title="Duration (ms)"
      />
      <div className="mx-1 h-4 w-px bg-line" />
      <button
        className={cx('flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs font-medium', autoKey ? 'bg-danger/20 text-danger' : 'text-muted hover:bg-raised hover:text-fg')}
        onClick={() => set({ autoKey: !autoKey })}
        title="Auto-key: record every change as a keyframe (K)"
        aria-pressed={autoKey}
      >
        <CircleIcon size={9} fill={autoKey ? 'currentColor' : 'none'} /> Auto-key
      </button>
      <button
        className={cx('tl-btn', animatedOnly && '!text-accent !bg-accent/15')}
        onClick={() => set({ animatedOnly: !animatedOnly })}
        title="Show only animated properties when expanded"
        aria-pressed={animatedOnly}
      >
        <Filter size={12} />
      </button>
      <input
        type="range"
        min={60}
        max={1200}
        value={zoom}
        onChange={(e) => set({ timelineZoom: +e.target.value })}
        className="vm-range ml-1 w-20"
        aria-label="Timeline zoom"
        title="Timeline zoom (Ctrl+wheel)"
      />
    </div>
  );
}

export function Timeline() {
  const doc = useEditor((s) => s.doc);
  const state = useEditor((s) => activeState(s));
  const time = useEditor((s) => s.time);
  const pps = useEditor((s) => s.timelineZoom);
  const selection = useEditor((s) => s.selection);
  const expanded = useEditor((s) => s.expanded);
  const keySel = useEditor((s) => s.keySel);
  const animatedOnly = useEditor((s) => s.animatedOnly);
  const st = useEditor.getState;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'above' | 'below' | 'inside' } | null>(null);
  const [viewW, setViewW] = useState(800);

  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = useEditor.getState();
      s.set({ timelineZoom: Math.min(1200, Math.max(60, s.timelineZoom * Math.exp(-e.deltaY * 0.002))) });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (id: string, depth: number) => {
      const n = doc.nodes[id];
      if (!n) return;
      out.push({ kind: 'layer', id, depth });
      if (expanded[id]) {
        ALL_PROPS.filter((p) => isAnimatable(n, p)).forEach((p) => {
          const has = (state.tracks[id]?.[p] as Keyframe[] | undefined)?.length;
          if (!animatedOnly || has) out.push({ kind: 'prop', id, prop: p, depth });
        });
      }
      if (n.type === 'group' && !collapsed[id]) [...n.children].reverse().forEach((c) => walk(c, depth + 1));
    };
    [...doc.rootIds].reverse().forEach((id) => walk(id, 0));
    return out;
  }, [doc, expanded, collapsed, state, animatedOnly]);

  const contentW = Math.max(viewW - LEFT, (state.duration / 1000) * pps + X0 + 120);
  const tx = (ms: number) => X0 + (ms / 1000) * pps;
  const frameMs = 1000 / (doc.fps || 60);

  // ── scrubbing ──
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    st().setFocus('timeline');
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const toT = (cx: number) => {
      const t = ((cx - rect.left - X0) / pps) * 1000;
      const snapped = Math.round(t / frameMs) * frameMs;
      return Math.min(state.duration, Math.max(0, snapped));
    };
    st().setPlaying(false);
    st().setTime(toT(e.clientX));
    const move = (ev: PointerEvent) => st().setTime(toT(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── duration handle ──
  const dragDuration = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const d0 = state.duration;
    let pushed = false;
    const move = (ev: PointerEvent) => {
      if (!pushed) {
        st().checkpoint();
        pushed = true;
      }
      const d = Math.max(100, Math.round((d0 + ((ev.clientX - x0) / pps) * 1000) / 50) * 50);
      st().mutate((dd) => {
        const s = dd.states.find((x) => x.id === state.id);
        if (s) s.duration = d;
      }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── keyframe dragging ──
  const keyDown = (e: React.PointerEvent, refs: KeyRef[]) => {
    e.stopPropagation();
    e.preventDefault();
    st().setFocus('timeline');
    const cur = st().keySel;
    const isSel = refs.every((r) => cur.some((c) => c.id === r.id));
    let next = cur;
    if (e.shiftKey) next = isSel ? cur.filter((c) => !refs.some((r) => r.id === c.id)) : [...cur, ...refs];
    else if (!isSel) next = refs;
    st().setKeySel(next);
    if (refs[0]) st().select([refs[0].nodeId]);
    // snapshot times
    const s = activeState(st());
    const times: Record<string, number> = {};
    next.forEach((r) => {
      const k = (s.tracks[r.nodeId]?.[r.prop] as Keyframe[] | undefined)?.find((x) => x.id === r.id);
      if (k) times[r.id] = k.time;
    });
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) {
        moved = true;
        st().checkpoint();
      }
      let dt = (dx / pps) * 1000;
      if (!ev.altKey) {
        const anchor = times[refs[0]?.id] ?? 0;
        let target = Math.round((anchor + dt) / frameMs) * frameMs;
        if (Math.abs(tx(target) - tx(st().time)) < 6) target = st().time; // snap to playhead
        dt = target - anchor;
      }
      st().moveKeyframes(next, dt, times);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved && !e.shiftKey) {
        const k = times[refs[0]?.id];
        if (k !== undefined) st().setTime(k);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── layer DnD ──
  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/x-vm-node', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!e.dataTransfer.types.includes('text/x-vm-node')) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const isGroup = doc.nodes[id]?.type === 'group';
    const pos = isGroup && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'above' : 'below';
    if (dropHint?.id !== id || dropHint.pos !== pos) setDropHint({ id, pos });
  };
  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/x-vm-node');
    const hint = dropHint;
    setDropHint(null);
    if (!id || id === targetId || !hint) return;
    const target = doc.nodes[targetId];
    if (hint.pos === 'inside' && target.type === 'group') {
      st().moveNode(id, targetId, target.children.length);
      return;
    }
    const sibs = target.parentId ? (doc.nodes[target.parentId] as Extract<SceneNode, { type: 'group' }>).children : doc.rootIds;
    const idx = sibs.indexOf(targetId);
    // display is top-first (reverse paint order): "above" = later in array
    st().moveNode(id, target.parentId, hint.pos === 'above' ? idx + 1 : idx);
  };

  const stTracks = state.tracks;
  const selectedKeyIds = new Set(keySel.map((k) => k.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-2">
        <PanelTabs />
        <div className="h-4 w-px bg-line" />
        <StateTabs />
        <div className="ml-auto">
          <Transport />
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onPointerDown={() => st().setFocus('timeline')}>
        <div className="relative" style={{ width: LEFT + contentW, minHeight: '100%' }}>
          {/* Ruler */}
          <div className="sticky top-0 z-20 flex h-7 border-b border-line bg-panel">
            <div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-panel px-3 text-2xs font-semibold uppercase tracking-wider text-muted" style={{ width: LEFT }}>
              Layers
              <span className="ml-auto font-normal normal-case tracking-normal text-faint">{Object.keys(doc.nodes).length}</span>
            </div>
            <div className="relative cursor-ew-resize" style={{ width: contentW }} onPointerDown={scrub} data-testid="ruler">
              <Ruler pps={pps} width={contentW} duration={state.duration} />
              <div className="absolute top-0 h-full w-2 -translate-x-1 cursor-col-resize bg-faint/40 hover:bg-accent" style={{ left: tx(state.duration) }} onPointerDown={dragDuration} title="Drag to change duration" />
            </div>
          </div>

          {/* Beyond-duration shade */}
          <div className="pointer-events-none absolute bottom-0 top-7 bg-bg/50" style={{ left: LEFT + tx(state.duration), right: 0 }} />

          {/* Rows */}
          {rows.length === 0 && (
            <div className="sticky left-0 p-6 text-xs text-muted" style={{ width: Math.min(viewW, 520) }}>
              No layers yet — import an SVG (drop it on the canvas) or draw with the Pen / Shape tools.
            </div>
          )}
          {rows.map((row) => {
            const n = doc.nodes[row.id];
            if (!n) return null;
            const isSel = selection.includes(row.id);
            if (row.kind === 'layer') {
              const times = nodeKeyTimes(stTracks[row.id]);
              const hint = dropHint?.id === row.id ? dropHint.pos : null;
              return (
                <div key={`l-${row.id}`} className={cx('group flex border-b border-line/40', isSel ? 'bg-accent/10' : 'hover:bg-raised/40')} style={{ height: ROW }}>
                  <div
                    className={cx(
                      'sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line pr-1 text-xs',
                      isSel ? 'bg-[color-mix(in_oklch,oklch(var(--accent))_12%,oklch(var(--panel)))]' : 'bg-panel',
                      hint === 'above' && 'shadow-[inset_0_2px_0_oklch(var(--accent))]',
                      hint === 'below' && 'shadow-[inset_0_-2px_0_oklch(var(--accent))]',
                      hint === 'inside' && 'ring-1 ring-inset ring-accent',
                    )}
                    style={{ width: LEFT, paddingLeft: 4 + row.depth * 14 }}
                    draggable={renaming !== row.id}
                    onDragStart={(e) => onDragStart(e, row.id)}
                    onDragOver={(e) => onDragOver(e, row.id)}
                    onDragLeave={() => setDropHint(null)}
                    onDrop={(e) => onDrop(e, row.id)}
                    onClick={(e) => st().select([row.id], e.shiftKey ? 'toggle' : 'replace')}
                  >
                    <GripVertical size={12} className="shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100" aria-label="Drag to reorder" />
                    <button
                      className="grid h-5 w-4 shrink-0 place-items-center text-faint hover:text-fg"
                      onClick={(e) => {
                        e.stopPropagation();
                        st().set({ expanded: { ...expanded, [row.id]: !expanded[row.id] } });
                      }}
                      title="Show animatable properties"
                      aria-expanded={!!expanded[row.id]}
                    >
                      <ChevronRight size={12} className={cx('transition-transform', expanded[row.id] && 'rotate-90')} />
                    </button>
                    {n.type === 'group' ? (
                      <button
                        className="shrink-0 text-accent2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollapsed({ ...collapsed, [row.id]: !collapsed[row.id] });
                        }}
                        title={collapsed[row.id] ? 'Expand group' : 'Collapse group'}
                      >
                        {collapsed[row.id] ? <Folder size={13} /> : <FolderOpen size={13} />}
                      </button>
                    ) : (
                      <span className="h-3 w-3 shrink-0 rounded-sm border border-line" style={{ background: n.fill !== 'none' ? n.fill : 'transparent', borderColor: n.stroke !== 'none' ? n.stroke : undefined }} />
                    )}
                    {renaming === row.id ? (
                      <input
                        autoFocus
                        defaultValue={n.name}
                        className="h-5 min-w-0 flex-1 rounded bg-panel2 px-1 text-xs text-fg outline-none ring-1 ring-accent"
                        onBlur={(e) => {
                          st().setNodeAttrs(row.id, { name: e.target.value || n.name });
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className={cx('min-w-0 flex-1 truncate', !n.visible && 'text-faint line-through')} onDoubleClick={() => setRenaming(row.id)} title="Double-click to rename">
                        {n.name}
                      </span>
                    )}
                    {hasKeys(stTracks[row.id]) && <Diamond size={8} className="shrink-0 text-key" fill="currentColor" aria-label="animated" />}
                    <button
                      className={cx('grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-raised', n.locked ? 'text-fg' : 'text-faint opacity-0 group-hover:opacity-100')}
                      onClick={(e) => {
                        e.stopPropagation();
                        st().setNodeAttrs(row.id, { locked: !n.locked });
                      }}
                      title={n.locked ? 'Unlock' : 'Lock'}
                    >
                      {n.locked ? <Lock size={11} /> : <Unlock size={11} />}
                    </button>
                    <button
                      className={cx('grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-raised', n.visible ? 'text-faint opacity-0 group-hover:opacity-100' : 'text-fg')}
                      onClick={(e) => {
                        e.stopPropagation();
                        st().setNodeAttrs(row.id, { visible: !n.visible });
                      }}
                      title={n.visible ? 'Hide' : 'Show'}
                    >
                      {n.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </button>
                  </div>
                  <div className="relative" style={{ width: contentW }} onPointerDown={(e) => !e.shiftKey && st().setKeySel([])}>
                    {times.map((t) => {
                      const refs: KeyRef[] = [];
                      Object.entries(stTracks[row.id] ?? {}).forEach(([p, list]) =>
                        (list as Keyframe[]).forEach((k) => Math.round(k.time) === t && refs.push({ nodeId: row.id, prop: p as PropKey, id: k.id })),
                      );
                      const sel = refs.length > 0 && refs.every((r) => selectedKeyIds.has(r.id));
                      return (
                        <button
                          key={t}
                          className="absolute top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center"
                          style={{ left: tx(t) }}
                          onPointerDown={(e) => keyDown(e, refs)}
                          title={`${refs.length} keyframe${refs.length > 1 ? 's' : ''} @ ${Math.round(t)}ms`}
                        >
                          <Diamond size={9} className={sel ? 'text-accent' : 'text-key/70'} fill="currentColor" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            // property row
            const list = (stTracks[row.id]?.[row.prop] as Keyframe[] | undefined) ?? [];
            const k = keyAt(list, time);
            return (
              <div key={`p-${row.id}-${row.prop}`} className={cx('group flex border-b border-line/30', isSel ? 'bg-accent/5' : '')} style={{ height: ROW - 2 }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-panel2 pr-1 text-2xs" style={{ width: LEFT, paddingLeft: 40 + row.depth * 14 }}>
                  {row.prop === 'path' && <Spline size={10} className="text-accent2" />}
                  <span className={cx('flex-1 truncate', list.length ? 'text-fg' : 'text-muted')}>{PROP_LABELS[row.prop]}</span>
                  {list.length > 0 && (
                    <>
                      <button className="text-faint hover:text-fg" title="Previous keyframe" onClick={() => {
                        const prev = [...list].reverse().find((x) => x.time < time - 0.5);
                        if (prev) st().setTime(prev.time);
                      }}>
                        <ChevronLeft size={11} />
                      </button>
                      <button className="text-faint hover:text-fg" title="Next keyframe" onClick={() => {
                        const nx = list.find((x) => x.time > time + 0.5);
                        if (nx) st().setTime(nx.time);
                      }}>
                        <ChevronRight size={11} />
                      </button>
                    </>
                  )}
                  <KeyButton state={k ? 'key' : list.length ? 'animated' : 'none'} onClick={() => st().toggleKeyframe(row.id, row.prop)} />
                </div>
                <div className="relative" style={{ width: contentW }} onPointerDown={(e) => !e.shiftKey && st().setKeySel([])}>
                  {list.slice(0, -1).map((a, i) => {
                    const b = list[i + 1];
                    return (
                      <div
                        key={`seg-${a.id}`}
                        className={cx('absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full', a.easing.type === 'hold' ? 'bg-line' : 'bg-accent/40')}
                        style={{ left: tx(a.time), width: tx(b.time) - tx(a.time) }}
                        title={a.easing.type}
                      />
                    );
                  })}
                  {list.map((kf) => {
                    const sel = selectedKeyIds.has(kf.id);
                    return (
                      <button
                        key={kf.id}
                        data-testid="keyframe"
                        className="absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
                        style={{ left: tx(kf.time) }}
                        onPointerDown={(e) => keyDown(e, [{ nodeId: row.id, prop: row.prop, id: kf.id }])}
                        title={`${PROP_LABELS[row.prop]} @ ${Math.round(kf.time)}ms · ${kf.easing.type}`}
                      >
                        <Diamond size={11} strokeWidth={2} className={sel ? 'text-accent' : 'text-key'} fill={sel ? 'currentColor' : 'oklch(var(--panel))'} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-accent" style={{ left: LEFT + tx(time) }}>
            <div className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b-sm bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

function hasKeys(t: Record<string, unknown> | undefined) {
  return !!t && Object.values(t).some((l) => Array.isArray(l) && l.length > 0);
}

function Ruler({ pps, width, duration }: { pps: number; width: number; duration: number }) {
  // choose tick spacing ≥ 60px
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const major = steps.find((s) => (s / 1000) * pps >= 64) ?? 5000;
  const minor = major / 5;
  const ticks: JSX.Element[] = [];
  const maxT = ((width - X0) / pps) * 1000;
  for (let t = 0; t <= maxT; t += minor) {
    const x = X0 + (t / 1000) * pps;
    const isMajor = Math.round(t) % major === 0;
    ticks.push(<line key={t} x1={x} x2={x} y1={isMajor ? 12 : 20} y2={28} className={t > duration ? 'stroke-line/60' : 'stroke-faint/70'} strokeWidth={1} />);
    if (isMajor)
      ticks.push(
        <text key={`t${t}`} x={x + 3} y={11} className={cx('font-mono', t > duration ? 'fill-faint/60' : 'fill-muted')} fontSize={9}>
          {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}s` : `${Math.round(t)}ms`}
        </text>,
      );
  }
  return (
    <svg width={width} height={28} className="block select-none">
      {ticks}
    </svg>
  );
}
