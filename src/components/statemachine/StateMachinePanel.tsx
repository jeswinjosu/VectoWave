// ─────────────────────────────────────────────────────────────────────────────
//  State machine editor: visual graph (drag states, drag from a port to link),
//  transition rule list (trigger, target layer, blend), custom triggers and a
//  live preview console.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react';
import { MousePointerClick, Play, Plus, Square, Trash2, Zap } from 'lucide-react';
import type { AnimState, StateKind, Transition, TriggerType } from '../../types/model';
import { useEditor } from '../../store/editor';
import { usePreview, togglePreview } from '../../store/preview';
import { EASING_LABELS, makeEasing } from '../../lib/easing';
import { Button, NumberField, Select, cx } from '../ui/primitives';
import { KIND_ICON, PanelTabs } from '../timeline/shared';

const NODE_W = 136;
const NODE_H = 44;
const ANY_POS = { x: 20, y: 150 };
const ENTRY_POS = { x: 20, y: 20 };

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  pointerEnter: 'On Hover (enter)',
  pointerLeave: 'On Hover End (leave)',
  pointerDown: 'On Press',
  pointerUp: 'On Release',
  click: 'On Click',
  custom: 'Custom Trigger',
  complete: 'On Animation Complete',
};
const TRIGGER_SHORT: Record<TriggerType, string> = {
  pointerEnter: 'hover',
  pointerLeave: 'leave',
  pointerDown: 'press',
  pointerUp: 'release',
  click: 'click',
  custom: 'trigger',
  complete: 'complete',
};

export function StateMachinePanel() {
  const doc = useEditor((s) => s.doc);
  const activeId = useEditor((s) => s.activeStateId);
  const [selTr, setSelTr] = useState<string | null>(null);
  const runtime = usePreview((s) => s.runtime);
  usePreview((s) => (s.runtime ? Math.floor(s.tick / 10) : 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-2">
        <PanelTabs />
        <div className="h-4 w-px bg-line" />
        <span className="text-2xs text-muted">
          {doc.states.length} states · {doc.transitions.length} transitions
        </span>
        <div className="ml-auto flex items-center gap-2">
          {runtime && (
            <span className="flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-2xs text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Live: {runtime.state?.name}
            </span>
          )}
          <Button variant={runtime ? 'solid' : 'outline'} size="xs" onClick={togglePreview}>
            {runtime ? <Square size={11} /> : <Play size={11} />} {runtime ? 'Stop preview' : 'Test interactively'}
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Graph selTr={selTr} setSelTr={setSelTr} activeId={activeId} liveId={runtime?.stateId ?? null} />
        <div className="w-[440px] shrink-0 overflow-y-auto border-l border-line">
          <StatesList />
          <TransitionsList selTr={selTr} setSelTr={setSelTr} />
          <TriggersAndConsole />
        </div>
      </div>
    </div>
  );
}

function Graph({ selTr, setSelTr, activeId, liveId }: { selTr: string | null; setSelTr: (id: string | null) => void; activeId: string; liveId: string | null }) {
  const doc = useEditor((s) => s.doc);
  const st = useEditor.getState;
  const svgRef = useRef<SVGSVGElement>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [hoverState, setHoverState] = useState<string | null>(null);

  const pos = (id: string) => (id === '*' ? ANY_POS : (doc.states.find((s) => s.id === id)?.graph ?? { x: 0, y: 0 }));
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const dragNode = (e: React.PointerEvent, s: AnimState) => {
    e.stopPropagation();
    const p0 = local(e);
    const g0 = { ...s.graph };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
      if (!moved) {
        moved = true;
        st().checkpoint();
      }
      st().mutate((d) => {
        const x = d.states.find((q) => q.id === s.id);
        if (x) x.graph = { x: Math.max(0, g0.x + p.x - p0.x), y: Math.max(0, g0.y + p.y - p0.y) };
      }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) st().setActiveState(s.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startLink = (e: React.PointerEvent, from: string) => {
    e.stopPropagation();
    const p = local(e);
    setLink({ from, ...p });
    const move = (ev: PointerEvent) => setLink({ from, ...local(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLink(null);
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-state]');
      const to = el?.getAttribute('data-state');
      if (to && to !== from) {
        const target = doc.states.find((s) => s.id === to);
        const trigger: TriggerType = target?.kind === 'hover' ? 'pointerEnter' : target?.kind === 'pressed' ? 'pointerDown' : 'click';
        st().addTransition({ from, to, trigger });
        setSelTr(st().doc.transitions[st().doc.transitions.length - 1]?.id ?? null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // group transitions between same pair to offset curves
  const pairs = useMemo(() => {
    const m = new Map<string, Transition[]>();
    doc.transitions.forEach((t) => {
      const k = [t.from, t.to].sort().join('|');
      m.set(k, [...(m.get(k) ?? []), t]);
    });
    return m;
  }, [doc.transitions]);

  const edge = (t: Transition) => {
    const a = pos(t.from);
    const b = pos(t.to);
    const ac = { x: a.x + NODE_W / 2, y: a.y + NODE_H / 2 };
    const bc = { x: b.x + NODE_W / 2, y: b.y + NODE_H / 2 };
    const group = pairs.get([t.from, t.to].sort().join('|')) ?? [t];
    const i = group.indexOf(t);
    const off = (i - (group.length - 1) / 2) * 44;
    // normal is computed on the canonical (sorted) direction so paired edges fan out on opposite sides
    const [ca, cb] = t.from < t.to ? [ac, bc] : [bc, ac];
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mid = { x: (ac.x + bc.x) / 2 + nx * off, y: (ac.y + bc.y) / 2 + ny * off };
    // clip end at node border
    const clip = (c: { x: number; y: number }, toward: { x: number; y: number }) => {
      const vx = toward.x - c.x;
      const vy = toward.y - c.y;
      const s = Math.min(Math.abs(NODE_W / 2 / (vx || 1e-6)), Math.abs(NODE_H / 2 / (vy || 1e-6)));
      return { x: c.x + vx * Math.min(1, s), y: c.y + vy * Math.min(1, s) };
    };
    const start = clip(ac, mid);
    const end = clip(bc, mid);
    const sel = selTr === t.id;
    return (
      <g key={t.id} onPointerDown={(e) => (e.stopPropagation(), setSelTr(t.id))} className="cursor-pointer">
        <path d={`M${start.x} ${start.y} Q${mid.x * 2 - (start.x + end.x) / 2} ${mid.y * 2 - (start.y + end.y) / 2} ${end.x} ${end.y}`} fill="none" stroke="transparent" strokeWidth={12} />
        <path
          d={`M${start.x} ${start.y} Q${mid.x * 2 - (start.x + end.x) / 2} ${mid.y * 2 - (start.y + end.y) / 2} ${end.x} ${end.y}`}
          fill="none"
          className={sel ? 'stroke-accent' : 'stroke-faint'}
          strokeWidth={sel ? 2 : 1.5}
          markerEnd={sel ? 'url(#sm-arrow-sel)' : 'url(#sm-arrow)'}
        />
        <g transform={`translate(${mid.x} ${mid.y})`}>
          <rect x={-30} y={-9} width={60} height={18} rx={9} className={sel ? 'fill-accent' : 'fill-raised stroke-line'} />
          <text textAnchor="middle" y={3.5} fontSize={9.5} className={sel ? 'fill-accent-fg' : 'fill-muted'}>
            {t.trigger === 'custom' ? (t.customName ?? 'trigger') : TRIGGER_SHORT[t.trigger]}
          </text>
        </g>
      </g>
    );
  };

  const init = doc.states.find((s) => s.id === doc.initialStateId);

  return (
    <div className="relative min-w-0 flex-1 overflow-auto bg-bg">
      <svg ref={svgRef} className="h-full min-h-[260px] w-full min-w-[640px]" onPointerDown={() => setSelTr(null)}>
        <defs>
          <pattern id="sm-dots" width={16} height={16} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} className="fill-line" />
          </pattern>
          {(['sm-arrow', 'sm-arrow-sel'] as const).map((id) => (
            <marker key={id} id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className={id === 'sm-arrow' ? 'fill-faint' : 'fill-accent'} />
            </marker>
          ))}
        </defs>
        <rect width="100%" height="100%" fill="url(#sm-dots)" />
        {/* Entry → initial */}
        <g>
          <rect x={ENTRY_POS.x} y={ENTRY_POS.y} width={64} height={24} rx={12} className="fill-panel stroke-accent2" />
          <text x={ENTRY_POS.x + 32} y={ENTRY_POS.y + 16} textAnchor="middle" fontSize={10} className="fill-accent2">
            Entry
          </text>
          {init && (
            <path
              d={`M${ENTRY_POS.x + 64} ${ENTRY_POS.y + 12} L${init.graph.x} ${init.graph.y + NODE_H / 2}`}
              className="stroke-accent2"
              strokeDasharray="4 3"
              fill="none"
              markerEnd="url(#sm-arrow)"
            />
          )}
        </g>
        {/* Any state */}
        <g data-state="*">
          <rect x={ANY_POS.x} y={ANY_POS.y} width={NODE_W} height={NODE_H} rx={10} className="fill-panel stroke-line" strokeDasharray="4 3" />
          <text x={ANY_POS.x + 12} y={ANY_POS.y + 27} fontSize={11} className="fill-muted">
            Any State
          </text>
          <circle cx={ANY_POS.x + NODE_W} cy={ANY_POS.y + NODE_H / 2} r={6} className="cursor-crosshair fill-panel stroke-accent" strokeWidth={1.5} onPointerDown={(e) => startLink(e, '*')}>
            <title>Drag to a state to create a transition</title>
          </circle>
        </g>
        {doc.transitions.map(edge)}
        {doc.states.map((s) => {
          const active = s.id === activeId;
          const live = s.id === liveId;
          return (
            <g key={s.id} data-state={s.id} onPointerEnter={() => setHoverState(s.id)} onPointerLeave={() => setHoverState(null)}>
              <rect
                x={s.graph.x}
                y={s.graph.y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                className={cx(live ? 'fill-accent/30 stroke-accent' : active ? 'fill-raised stroke-accent' : 'fill-panel stroke-line', 'cursor-move')}
                strokeWidth={active || live ? 2 : 1}
                onPointerDown={(e) => dragNode(e, s)}
              />
              <text x={s.graph.x + 12} y={s.graph.y + 19} fontSize={11.5} fontWeight={600} className="pointer-events-none fill-fg">
                {KIND_ICON[s.kind]} {s.name}
              </text>
              <text x={s.graph.x + 12} y={s.graph.y + 34} fontSize={9.5} className="pointer-events-none fill-muted">
                {s.kind} · {s.duration}ms{s.loop ? ' · loop' : ''}
                {s.id === doc.initialStateId ? ' · initial' : ''}
              </text>
              <circle
                cx={s.graph.x + NODE_W}
                cy={s.graph.y + NODE_H / 2}
                r={6}
                className={cx('cursor-crosshair fill-panel stroke-accent transition-opacity', hoverState === s.id || link ? 'opacity-100' : 'opacity-40')}
                strokeWidth={1.5}
                onPointerDown={(e) => startLink(e, s.id)}
              >
                <title>Drag to another state to add a transition</title>
              </circle>
            </g>
          );
        })}
        {link && (
          <line x1={pos(link.from).x + NODE_W} y1={pos(link.from).y + NODE_H / 2} x2={link.x} y2={link.y} className="stroke-accent" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#sm-arrow-sel)" />
        )}
      </svg>
      <p className="pointer-events-none absolute right-3 top-2 max-w-[60%] text-right text-2xs text-faint">Click a state to edit its timeline · drag states to arrange · drag a port (●) onto another state to link</p>
    </div>
  );
}

function StatesList() {
  const doc = useEditor((s) => s.doc);
  const st = useEditor.getState;
  return (
    <div className="border-b border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted">States</h3>
        <div className="flex gap-1">
          {(['hover', 'pressed', 'custom'] as StateKind[]).map((k) => (
            <Button key={k} size="xs" variant="outline" onClick={() => st().addState(k)}>
              <Plus size={10} /> {k[0].toUpperCase() + k.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        {doc.states.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            <input
              className="h-7 w-28 rounded-md bg-panel2 px-2 text-xs text-fg outline-none focus:ring-1 focus:ring-accent/60"
              value={s.name}
              onChange={(e) => st().mutate((d) => void (d.states.find((x) => x.id === s.id)!.name = e.target.value), false)}
              aria-label="State name"
            />
            <Select
              value={s.kind}
              onChange={(v) => st().updateState(s.id, { kind: v })}
              options={(['idle', 'hover', 'pressed', 'custom'] as StateKind[]).map((k) => ({ value: k, label: k }))}
              className="w-[76px]"
            />
            <NumberField value={s.duration} suffix="ms" precision={0} step={10} min={50} onChange={(v, f) => f && st().updateState(s.id, { duration: v })} className="max-w-[86px]" />
            <button className={cx('h-7 rounded-md px-1.5 text-2xs', s.loop ? 'bg-accent/20 text-accent' : 'text-faint hover:bg-raised')} onClick={() => st().updateState(s.id, { loop: !s.loop })} title="Loop">
              loop
            </button>
            <button
              className={cx('h-7 rounded-md px-1.5 text-2xs', doc.initialStateId === s.id ? 'bg-accent2/20 text-accent2' : 'text-faint hover:bg-raised')}
              onClick={() => st().mutate((d) => void (d.initialStateId = s.id))}
              title="Set as initial (entry) state"
            >
              init
            </button>
            <button className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-danger/15 hover:text-danger" onClick={() => st().deleteState(s.id)} title="Delete state">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransitionsList({ selTr, setSelTr }: { selTr: string | null; setSelTr: (id: string | null) => void }) {
  const doc = useEditor((s) => s.doc);
  const st = useEditor.getState;
  const stateOpts = doc.states.map((s) => ({ value: s.id, label: s.name }));
  const layerOpts = [{ value: '', label: 'Whole artboard' }, ...Object.values(doc.nodes).map((n) => ({ value: n.id, label: `Layer: ${n.name}` }))];
  return (
    <div className="border-b border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted">Interactions & Transitions</h3>
        <Button size="xs" variant="outline" onClick={() => st().addTransition()}>
          <Plus size={10} /> Add
        </Button>
      </div>
      {doc.transitions.length === 0 && <p className="text-2xs text-faint">No transitions yet. Add one, or drag between states in the graph.</p>}
      <div className="space-y-1.5">
        {doc.transitions.map((t) => (
          <div
            key={t.id}
            onClick={() => setSelTr(t.id)}
            className={cx('space-y-1.5 rounded-lg border p-2', selTr === t.id ? 'border-accent bg-accent/5' : 'border-line/70')}
          >
            <div className="flex items-center gap-1">
              <Select value={t.trigger} onChange={(v) => st().updateTransition(t.id, { trigger: v, customName: v === 'custom' ? (t.customName ?? doc.customTriggers[0] ?? 'fire') : undefined })} options={(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => ({ value: k, label: TRIGGER_LABELS[k] }))} className="flex-1" />
              <button className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-danger/15 hover:text-danger" onClick={() => st().deleteTransition(t.id)} title="Delete transition">
                <Trash2 size={12} />
              </button>
            </div>
            <div className="flex items-center gap-1 text-2xs text-muted">
              <Select value={t.from} onChange={(v) => st().updateTransition(t.id, { from: v })} options={[{ value: '*', label: 'Any state' }, ...stateOpts]} className="flex-1" />
              <span>→</span>
              <Select value={t.to} onChange={(v) => st().updateTransition(t.id, { to: v })} options={stateOpts} className="flex-1" />
            </div>
            {t.trigger === 'custom' ? (
              <div className="flex items-center gap-1">
                <span className="w-14 text-2xs text-muted">Trigger</span>
                <input
                  list="vm-triggers"
                  className="h-7 min-w-0 flex-1 rounded-md bg-panel2 px-2 text-xs text-fg outline-none focus:ring-1 focus:ring-accent/60"
                  value={t.customName ?? ''}
                  onChange={(e) => st().updateTransition(t.id, { customName: e.target.value })}
                  onBlur={(e) => e.target.value && st().addCustomTrigger(e.target.value)}
                  placeholder="trigger name"
                />
              </div>
            ) : (
              t.trigger !== 'complete' && (
                <div className="flex items-center gap-1">
                  <span className="w-14 text-2xs text-muted">Target</span>
                  <Select value={t.targetNodeId ?? ''} onChange={(v) => st().updateTransition(t.id, { targetNodeId: v || null })} options={layerOpts} className="min-w-0 flex-1" />
                </div>
              )
            )}
            <div className="flex items-center gap-1">
              <span className="w-14 text-2xs text-muted">Blend</span>
              <NumberField value={t.duration} suffix="ms" precision={0} step={10} min={0} onChange={(v, f) => f && st().updateTransition(t.id, { duration: v })} className="max-w-[90px]" />
              <Select value={t.easing.type} onChange={(v) => st().updateTransition(t.id, { easing: makeEasing(v) })} options={(Object.keys(EASING_LABELS) as (keyof typeof EASING_LABELS)[]).filter((k) => k !== 'custom').map((k) => ({ value: k, label: EASING_LABELS[k] }))} className="flex-1" />
            </div>
          </div>
        ))}
      </div>
      <datalist id="vm-triggers">
        {doc.customTriggers.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

function TriggersAndConsole() {
  const doc = useEditor((s) => s.doc);
  const st = useEditor.getState;
  const runtime = usePreview((s) => s.runtime);
  const [name, setName] = useState('');
  return (
    <div className="p-3">
      <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">Custom Triggers</h3>
      <form
        className="mb-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          st().addCustomTrigger(name);
          setName('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. success, error, toggle" className="h-7 min-w-0 flex-1 rounded-md bg-panel2 px-2 text-xs text-fg outline-none focus:ring-1 focus:ring-accent/60" />
        <Button size="sm" variant="outline" type="submit">
          <Plus size={11} /> Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-1">
        {doc.customTriggers.map((c) => (
          <span key={c} className="flex items-center gap-1 rounded-full border border-line bg-panel2 py-0.5 pl-2 pr-1 text-2xs text-fg">
            <Zap size={10} className="text-key" />
            {c}
            {runtime && (
              <button className="rounded-full bg-accent px-1.5 text-accent-fg" onClick={() => runtime.custom(c)} title="Fire in preview">
                fire
              </button>
            )}
            <button className="px-1 text-faint hover:text-danger" onClick={() => st().removeCustomTrigger(c)} aria-label={`Remove ${c}`}>
              ×
            </button>
          </span>
        ))}
        {!doc.customTriggers.length && <span className="text-2xs text-faint">None. Custom triggers can be fired from code (exports) or in preview.</span>}
      </div>
      <h3 className="mb-1 mt-4 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted">
        <MousePointerClick size={11} /> Preview console
      </h3>
      <div className="h-24 overflow-y-auto rounded-md bg-panel2 p-2 font-mono text-2xs text-muted">
        {!runtime && 'Start “Test interactively” then hover/click the artwork.'}
        {runtime?.log.map((l, i) => (
          <div key={i} className={i === 0 ? 'text-fg' : ''}>
            {(l.at / 1000).toFixed(2)}s · {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
