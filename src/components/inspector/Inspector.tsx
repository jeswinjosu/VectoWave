import { useMemo, useState } from 'react';
import { Crosshair, Link2, Trash2, Unlink2, Wand2 } from 'lucide-react';
import type { Easing, GroupNode, HandleMode, Keyframe, PathNode, PropKey, PropValueMap, SceneNode } from '../../types/model';
import { activeState, useEditor } from '../../store/editor';
import { evaluateNode, keyAt, localBBox, evaluateDoc } from '../../lib/animation';
import { anchorCount, cloneGeometry, deleteAnchors, setAnchorMode } from '../../lib/path';
import { simplifyGeometry } from '../../lib/simplify';
import { boxCenter, boxValid } from '../../lib/math';
import { BezierEditor } from './BezierEditor';
import { Button, ColorField, Field, KeyButton, NumberField, Section, Segmented, Select } from '../ui/primitives';

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const keySel = useEditor((s) => s.keySel);
  const doc = useEditor((s) => s.doc);
  const preview = useEditor((s) => s.preview);
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as SceneNode[];

  return (
    <aside aria-label="Inspector" className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3 text-xs font-semibold text-fg">
        {nodes.length === 1 ? nodes[0].name : nodes.length > 1 ? `${nodes.length} layers` : 'Document'}
        {preview && <span className="ml-auto rounded bg-accent/20 px-1.5 py-0.5 text-2xs text-accent">Preview</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {keySel.length > 0 && <KeyframeSection />}
        {nodes.length === 1 && <NodeInspector node={nodes[0]} />}
        {nodes.length > 1 && <MultiInspector nodes={nodes} />}
        {nodes.length === 0 && <DocumentInspector />}
      </div>
    </aside>
  );
}

/** Generic animated-property helpers bound to the active state + playhead. */
function useAnimated(node: SceneNode) {
  const time = useEditor((s) => s.time);
  const state = useEditor((s) => activeState(s));
  const setProp = useEditor((s) => s.setProp);
  const checkpoint = useEditor((s) => s.checkpoint);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const tracks = state.tracks[node.id];
  const ev = useMemo(() => evaluateNode(node, tracks, time), [node, tracks, time]);
  const keyState = (p: PropKey): 'none' | 'animated' | 'key' => {
    const list = tracks?.[p] as Keyframe[] | undefined;
    if (!list?.length) return 'none';
    return keyAt(list, time) ? 'key' : 'animated';
  };
  const set = <P extends PropKey>(p: P, v: PropValueMap[P], final: boolean) => setProp(node.id, p, v, final);
  return { ev, keyState, set, checkpoint, toggle: (p: PropKey) => toggleKeyframe(node.id, p) };
}

function NodeInspector({ node }: { node: SceneNode }) {
  const { ev, keyState, set, checkpoint, toggle } = useAnimated(node);
  const setNodeAttrs = useEditor((s) => s.setNodeAttrs);
  const doc = useEditor((s) => s.doc);
  const [linkScale, setLinkScale] = useState(true);

  const setOrigin = useEditor((s) => s.setOrigin);
  const centerOrigin = () => {
    const evals = evaluateDoc(doc, undefined, 0);
    const b = localBBox(doc, evals, node.id);
    if (boxValid(b)) setOrigin(node.id, boxCenter(b));
  };

  return (
    <>
      <Section title="Layer">
        <Field label="Name">
          <input
            className="h-7 w-full rounded-md bg-panel2 px-2 text-xs text-fg outline-none focus:ring-1 focus:ring-accent/60"
            value={node.name}
            onChange={(e) => setNodeAttrs(node.id, { name: e.target.value }, false)}
          />
        </Field>
        <p className="text-2xs text-faint">
          {node.type === 'group' ? `Group · ${(node as GroupNode).children.length} children` : `Path · ${anchorCount((node as PathNode).geometry)} anchors`}
        </p>
      </Section>

      <Section title="Transform">
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Position</span>
          <NumberField label="X" value={ev.position.x} onScrubStart={checkpoint} onChange={(v, f) => set('position', { ...ev.position, x: v }, f)} />
          <NumberField label="Y" value={ev.position.y} onScrubStart={checkpoint} onChange={(v, f) => set('position', { ...ev.position, y: v }, f)} />
          <KeyButton state={keyState('position')} onClick={() => toggle('position')} />
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Scale</span>
          <NumberField
            label="X"
            value={ev.scale.x * 100}
            suffix="%"
            precision={1}
            onScrubStart={checkpoint}
            onChange={(v, f) => {
              const sx = v / 100;
              const ratio = ev.scale.x ? sx / ev.scale.x : 1;
              set('scale', { x: sx, y: linkScale ? ev.scale.y * ratio : ev.scale.y }, f);
            }}
          />
          <NumberField
            label="Y"
            value={ev.scale.y * 100}
            suffix="%"
            precision={1}
            onScrubStart={checkpoint}
            onChange={(v, f) => {
              const sy = v / 100;
              const ratio = ev.scale.y ? sy / ev.scale.y : 1;
              set('scale', { x: linkScale ? ev.scale.x * ratio : ev.scale.x, y: sy }, f);
            }}
          />
          <KeyButton state={keyState('scale')} onClick={() => toggle('scale')} />
        </div>
        <div className="flex items-center justify-end">
          <button className="flex items-center gap-1 text-2xs text-faint hover:text-fg" onClick={() => setLinkScale(!linkScale)}>
            {linkScale ? <Link2 size={11} /> : <Unlink2 size={11} />} {linkScale ? 'Proportional' : 'Free'} scale
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Rotation</span>
          <NumberField label="°" value={ev.rotation} precision={1} onScrubStart={checkpoint} onChange={(v, f) => set('rotation', v, f)} />
          <KeyButton state={keyState('rotation')} onClick={() => toggle('rotation')} />
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={ev.opacity}
            onPointerDown={checkpoint}
            onChange={(e) => set('opacity', +e.target.value, false)}
            className="vm-range flex-1"
            aria-label="Opacity"
          />
          <span className="w-9 text-right font-mono text-2xs text-muted">{Math.round(ev.opacity * 100)}%</span>
          <KeyButton state={keyState('opacity')} onClick={() => toggle('opacity')} />
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted" title="Pivot for rotation & scale (not animatable)">
            Origin
          </span>
          <NumberField label="X" value={node.origin.x} onScrubStart={checkpoint} onChange={(v, f) => setOrigin(node.id, { ...node.origin, x: v }, f)} />
          <NumberField label="Y" value={node.origin.y} onScrubStart={checkpoint} onChange={(v, f) => setOrigin(node.id, { ...node.origin, y: v }, f)} />
          <button className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-fg" title="Center origin on content" onClick={centerOrigin}>
            <Crosshair size={12} />
          </button>
        </div>
      </Section>

      {node.type === 'path' && <AppearanceSection node={node as PathNode} />}
      {node.type === 'path' && <PathSection node={node as PathNode} />}
    </>
  );
}

function AppearanceSection({ node }: { node: PathNode }) {
  const { ev, keyState, set, checkpoint, toggle } = useAnimated(node);
  const setNodeAttrs = useEditor((s) => s.setNodeAttrs);
  return (
    <Section title="Appearance">
      <div className="flex items-center gap-1">
        <span className="w-14 shrink-0 text-2xs text-muted">Fill</span>
        <ColorField value={ev.fill} onStart={checkpoint} onChange={(v, f) => set('fill', v, f)} />
        <KeyButton state={keyState('fill')} onClick={() => toggle('fill')} />
      </div>
      {ev.fill !== 'none' && (
        <div className="flex items-center gap-1 pl-[60px]">
          <NumberField label="α" value={node.fillOpacity * 100} suffix="%" min={0} max={100} onScrubStart={checkpoint} onChange={(v, f) => setNodeAttrs(node.id, { fillOpacity: v / 100 }, f)} />
          <Select value={node.fillRule} onChange={(v) => setNodeAttrs(node.id, { fillRule: v })} options={[{ value: 'nonzero', label: 'Non-zero' }, { value: 'evenodd', label: 'Even-odd' }]} />
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="w-14 shrink-0 text-2xs text-muted">Stroke</span>
        <ColorField value={ev.stroke} onStart={checkpoint} onChange={(v, f) => set('stroke', v, f)} />
        <KeyButton state={keyState('stroke')} onClick={() => toggle('stroke')} />
      </div>
      <div className="flex items-center gap-1">
        <span className="w-14 shrink-0 text-2xs text-muted">Width</span>
        <NumberField label="W" value={ev.strokeWidth} min={0} step={0.25} onScrubStart={checkpoint} onChange={(v, f) => set('strokeWidth', v, f)} />
        <KeyButton state={keyState('strokeWidth')} onClick={() => toggle('strokeWidth')} />
      </div>
      {ev.stroke !== 'none' && (
        <div className="grid grid-cols-2 gap-1 pl-[60px]">
          <Select title="Line cap" value={node.lineCap} onChange={(v) => setNodeAttrs(node.id, { lineCap: v })} options={['butt', 'round', 'square'].map((v) => ({ value: v as PathNode['lineCap'], label: `Cap: ${v}` }))} />
          <Select title="Line join" value={node.lineJoin} onChange={(v) => setNodeAttrs(node.id, { lineJoin: v })} options={['miter', 'round', 'bevel'].map((v) => ({ value: v as PathNode['lineJoin'], label: `Join: ${v}` }))} />
        </div>
      )}
    </Section>
  );
}

const MODE_OPTIONS: { value: HandleMode; label: string; title: string }[] = [
  { value: 'corner', label: 'Corner', title: 'No handles' },
  { value: 'mirrored', label: 'Mirror', title: 'Handles mirrored (same angle & length)' },
  { value: 'asymmetric', label: 'Asym', title: 'Same angle, independent length' },
  { value: 'disconnected', label: 'Free', title: 'Handles move independently' },
];

function PathSection({ node }: { node: PathNode }) {
  const { ev, keyState, toggle } = useAnimated(node);
  const anchorSel = useEditor((s) => s.anchorSel).filter((a) => a.nodeId === node.id);
  const editGeometry = useEditor((s) => s.editGeometry);
  const setAnchorSel = useEditor((s) => s.setAnchorSel);
  const checkpoint = useEditor((s) => s.checkpoint);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const doc = useEditor((s) => s.doc);
  const [amount, setAmount] = useState(30);
  const geo = ev.geometry ?? node.geometry;
  const first = anchorSel[0];
  const anchor = first ? geo.subpaths[first.sub]?.anchors[first.idx] : undefined;
  const modes = new Set(anchorSel.map((a) => geo.subpaths[a.sub]?.anchors[a.idx]?.mode));
  const mode = modes.size === 1 ? ([...modes][0] as HandleMode) : null;
  const diag = Math.hypot(doc.width, doc.height);
  const preview = useMemo(() => anchorCount(simplifyGeometry(geo, amount, diag)), [geo, amount, diag]);

  return (
    <Section title="Path & Morphing">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-2xs text-muted">
          Path data keyframe <span className="text-faint">({anchorCount(geo)} anchors)</span>
        </span>
        <KeyButton state={keyState('path')} onClick={() => toggle('path')} title="Keyframe path shape (morph)" />
      </div>
      {tool !== 'direct' ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setTool('direct')}>
          Edit anchor points (A)
        </Button>
      ) : anchorSel.length === 0 ? (
        <p className="rounded-md bg-panel2 p-2 text-2xs leading-relaxed text-muted">
          Click an anchor to select it. Drag anchors/handles to reshape — with a path keyframe (or Auto-key), edits are recorded at the playhead to create a morph.
        </p>
      ) : (
        <>
          <p className="text-2xs text-muted">{anchorSel.length} anchor{anchorSel.length > 1 ? 's' : ''} selected</p>
          <Segmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={(m) =>
              editGeometry(node.id, (g) => {
                const out = cloneGeometry(g);
                anchorSel.forEach((a) => {
                  const sp = out.subpaths[a.sub];
                  if (sp?.anchors[a.idx]) sp.anchors[a.idx] = setAnchorMode(sp, a.idx, m);
                });
                return out;
              }, false)
            }
          />
          {anchor && anchorSel.length === 1 && (
            <div className="flex items-center gap-1">
              <span className="w-14 shrink-0 text-2xs text-muted">Anchor</span>
              {(['x', 'y'] as const).map((k) => (
                <NumberField
                  key={k}
                  label={k.toUpperCase()}
                  value={anchor[k]}
                  onScrubStart={checkpoint}
                  onChange={(v, f) =>
                    editGeometry(node.id, (g) => {
                      const out = cloneGeometry(g);
                      out.subpaths[first.sub].anchors[first.idx][k] = v;
                      return out;
                    }, false, f)
                  }
                />
              ))}
            </div>
          )}
          <Button
            variant="danger"
            size="sm"
            className="w-full"
            onClick={() => {
              editGeometry(node.id, (g) => deleteAnchors(g, anchorSel), true);
              setAnchorSel([]);
            }}
          >
            <Trash2 size={12} /> Delete anchor{anchorSel.length > 1 ? 's' : ''}
          </Button>
        </>
      )}
      <div className="space-y-1 rounded-md border border-line/70 p-2">
        <div className="flex items-center justify-between text-2xs text-muted">
          <span className="flex items-center gap-1">
            <Wand2 size={11} /> Simplify
          </span>
          <span className="font-mono">
            {anchorCount(geo)} → {preview}
          </span>
        </div>
        <input type="range" min={0} max={100} value={amount} onChange={(e) => setAmount(+e.target.value)} className="vm-range w-full" aria-label="Simplify amount" />
        <Button
          variant="outline"
          size="xs"
          className="w-full"
          disabled={preview >= anchorCount(geo)}
          onClick={() => {
            editGeometry(node.id, (g) => simplifyGeometry(g, amount, diag), false);
            setAnchorSel([]);
          }}
        >
          Apply simplification
        </Button>
      </div>
    </Section>
  );
}

function MultiInspector({ nodes }: { nodes: SceneNode[] }) {
  const st = useEditor();
  return (
    <Section title="Selection">
      <p className="text-2xs text-muted">{nodes.map((n) => n.name).join(', ')}</p>
      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" size="sm" onClick={st.groupSelection}>
          Group
        </Button>
        <Button variant="outline" size="sm" onClick={st.duplicateSelection}>
          Duplicate
        </Button>
      </div>
    </Section>
  );
}

function KeyframeSection() {
  const keySel = useEditor((s) => s.keySel);
  const state = useEditor((s) => activeState(s));
  const doc = useEditor((s) => s.doc);
  const setKeyframeEasing = useEditor((s) => s.setKeyframeEasing);
  const deleteKeyframes = useEditor((s) => s.deleteKeyframes);
  const moveKeyframes = useEditor((s) => s.moveKeyframes);
  const checkpoint = useEditor((s) => s.checkpoint);
  const set = useEditor((s) => s.set);
  const keys = keySel
    .map((r) => (state.tracks[r.nodeId]?.[r.prop] as Keyframe[] | undefined)?.find((k) => k.id === r.id))
    .filter(Boolean) as Keyframe[];
  const [live, setLive] = useState<Easing | null>(null);
  if (!keys.length) return null;
  const easing = live ?? keys[0].easing;
  const single = keys.length === 1 ? keys[0] : null;
  const ref = keySel[0];

  return (
    <Section
      title={`Keyframe${keys.length > 1 ? `s (${keys.length})` : ''}`}
      right={
        <button className="text-faint hover:text-danger" title="Delete keyframes" onClick={() => deleteKeyframes(keySel)}>
          <Trash2 size={12} />
        </button>
      }
    >
      {single && (
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Time</span>
          <NumberField
            value={single.time}
            suffix="ms"
            precision={0}
            min={0}
            step={10}
            onScrubStart={checkpoint}
            onChange={(v, f) => {
              if (f) checkpoint();
              moveKeyframes([ref], v - single.time, { [single.id]: single.time });
              set({ time: v });
            }}
          />
          <span className="truncate text-2xs text-faint">{doc.nodes[ref.nodeId]?.name}</span>
        </div>
      )}
      <p className="text-2xs text-muted">Interpolation to next keyframe</p>
      <BezierEditor
        value={easing}
        onChange={(e, final) => {
          if (final) {
            setLive(null);
            setKeyframeEasing(keySel, e);
          } else setLive(e);
        }}
      />
    </Section>
  );
}

function DocumentInspector() {
  const doc = useEditor((s) => s.doc);
  const mutate = useEditor((s) => s.mutate);
  return (
    <>
      <Section title="Artboard">
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Size</span>
          <NumberField label="W" value={doc.width} min={1} onChange={(v, f) => mutate((d) => void (d.width = v), f)} />
          <NumberField label="H" value={doc.height} min={1} onChange={(v, f) => mutate((d) => void (d.height = v), f)} />
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Background</span>
          <ColorField value={doc.background ?? 'none'} onChange={(v, f) => mutate((d) => void (d.background = v === 'none' ? null : v), f)} />
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-2xs text-muted">Frame rate</span>
          <Select value={String(doc.fps)} onChange={(v) => mutate((d) => void (d.fps = +v))} options={['24', '25', '30', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))} className="flex-1" />
        </div>
      </Section>
      <Section title="Tips" defaultOpen={false}>
        <ul className="list-disc space-y-1 pl-4 text-2xs leading-relaxed text-muted">
          <li>Drop an .svg anywhere to import it.</li>
          <li>Each state (Idle, Hover, Pressed, custom) has its own timeline — switch via the tabs above the timeline.</li>
          <li>Turn on Auto-key (K) to record every change as a keyframe at the playhead.</li>
          <li>Use the Sub-select tool (A) and keyframe “Path” to morph shapes.</li>
          <li>Drag the pivot (crosshair) with the Select tool to move only the origin point.</li>
        </ul>
      </Section>
    </>
  );
}
