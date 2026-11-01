import { useDeferredValue, useMemo, useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import type { DocumentModel, GroupNode } from '../../types/model';
import { useEditor } from '../../store/editor';
import { countAnchors, DEFAULT_IMPORT_OPTIONS, parseSvgString, simplifiedCopy, type ImportOptions, type ImportResult } from '../../lib/svgImport';
import { evaluateDoc, worldMatrices } from '../../lib/animation';
import { apply } from '../../lib/math';
import { makeGroupNode, recenterGroupOrigins } from '../../lib/doc';
import { SceneRenderer } from '../canvas/SceneRenderer';
import { Button, Toggle, cx } from '../ui/primitives';
import { Modal } from './Modal';

export function ImportModal() {
  const file = useEditor((s) => s.importFile)!;
  const set = useEditor((s) => s.set);
  const [opts, setOpts] = useState<ImportOptions>({ ...DEFAULT_IMPORT_OPTIONS });
  const [showAnchors, setShowAnchors] = useState(true);
  const amount = useDeferredValue(opts.simplify ? opts.simplifyAmount : 0);

  // Re-parse when cleanup options change (simplification is applied separately for live preview)
  const parsed = useMemo<{ result?: ImportResult; error?: string }>(() => {
    try {
      return { result: parseSvgString(file.text, { ...opts, simplify: false }, file.name) };
    } catch (e) {
      return { error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, opts.collapseGroups, opts.removeHidden, opts.stripMetadata]);

  const previewDoc = useMemo(() => (parsed.result ? simplifiedCopy(parsed.result.doc, amount) : null), [parsed.result, amount]);
  const before = parsed.result ? countAnchors(parsed.result.doc) : 0;
  const after = previewDoc ? countAnchors(previewDoc) : 0;
  const evals = useMemo(() => (previewDoc ? evaluateDoc(previewDoc, undefined, 0) : {}), [previewDoc]);
  const worlds = useMemo(() => (previewDoc ? worldMatrices(previewDoc, evals) : {}), [previewDoc, evals]);
  const close = () => set({ importFile: null });

  const finalize = (mode: 'replace' | 'merge') => {
    if (!previewDoc) return;
    const doc: DocumentModel = JSON.parse(JSON.stringify(previewDoc));
    const st = useEditor.getState();
    if (mode === 'replace') {
      st.loadDoc(doc);
      st.notify(`Imported ${Object.keys(doc.nodes).length} layers · ${after} anchors`);
    } else {
      const group: GroupNode = makeGroupNode(doc.name || 'Imported', null, doc.rootIds);
      st.mutate((d) => {
        Object.values(doc.nodes).forEach((n) => {
          if (n.parentId === null) n.parentId = group.id;
          d.nodes[n.id] = n;
        });
        d.nodes[group.id] = group;
        d.rootIds.push(group.id);
        d.palette.push(...doc.palette);
        recenterGroupOrigins(d as DocumentModel);
      });
      st.select([group.id]);
      st.notify(`Added “${group.name}” to the document`);
    }
    close();
  };

  const s = parsed.result?.stats;
  const reduction = before ? Math.round((1 - after / before) * 100) : 0;

  return (
    <Modal
      title="Import Settings"
      subtitle={
        <span className="flex items-center gap-1">
          <FileUp size={12} /> {file.name} · {(file.text.length / 1024).toFixed(1)} KB
        </span>
      }
      onClose={close}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <Button variant="outline" size="md" onClick={() => finalize('merge')} disabled={!previewDoc}>
            Add to current document
          </Button>
          <Button variant="solid" size="md" onClick={() => finalize('replace')} disabled={!previewDoc} data-testid="import-confirm">
            Import as new document
          </Button>
        </>
      }
    >
      {parsed.error ? (
        <div className="flex items-center gap-2 p-6 text-sm text-danger">
          <AlertTriangle size={16} /> {parsed.error}
        </div>
      ) : (
        <div className="grid gap-0 md:grid-cols-[1fr_320px]">
          {/* Preview */}
          <div className="relative min-h-[360px] border-b border-line bg-bg p-4 md:border-b-0 md:border-r">
            {previewDoc && (
              <svg viewBox={`-8 -8 ${previewDoc.width + 16} ${previewDoc.height + 16}`} className="h-full max-h-[56vh] w-full" role="img" aria-label="Import preview">
                <defs>
                  <pattern id="imp-checker" width={16} height={16} patternUnits="userSpaceOnUse">
                    <rect width={16} height={16} fill="#2a2a30" />
                    <rect width={8} height={8} fill="#33333a" />
                    <rect x={8} y={8} width={8} height={8} fill="#33333a" />
                  </pattern>
                </defs>
                <rect width={previewDoc.width} height={previewDoc.height} fill="url(#imp-checker)" />
                <SceneRenderer doc={previewDoc} evals={evals} interactive={false} />
                {showAnchors &&
                  Object.values(previewDoc.nodes).map((n) =>
                    n.type === 'path'
                      ? n.geometry.subpaths.flatMap((sp, si) =>
                          sp.anchors.map((a, i) => {
                            const p = apply(worlds[n.id], a);
                            const r = Math.max(previewDoc.width, previewDoc.height) / 260;
                            return <circle key={`${n.id}-${si}-${i}`} cx={p.x} cy={p.y} r={r} className="fill-accent2 stroke-bg" strokeWidth={r / 3} />;
                          }),
                        )
                      : null,
                  )}
              </svg>
            )}
            <div className="absolute left-4 top-4 rounded-md bg-panel/90 px-2 py-1 font-mono text-2xs text-muted">
              {previewDoc?.width} × {previewDoc?.height}
            </div>
            <label className="absolute bottom-3 left-4 flex items-center gap-1.5 rounded-md bg-panel/90 px-2 py-1 text-2xs text-muted">
              <input type="checkbox" checked={showAnchors} onChange={(e) => setShowAnchors(e.target.checked)} className="accent-[oklch(var(--accent))]" /> Show anchor points
            </label>
          </div>

          {/* Options */}
          <div className="space-y-4 p-4">
            <div>
              <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">Optimization</h3>
              <Toggle checked={opts.simplify} onChange={(v) => setOpts({ ...opts, simplify: v })} label="Simplify shapes" hint="Douglas–Peucker anchor reduction + least-squares Bezier refit" />
              <div className={cx('mt-2 space-y-1.5 rounded-lg border border-line p-2.5', !opts.simplify && 'opacity-40')}>
                <div className="flex items-center justify-between text-2xs">
                  <span className="text-muted">Strength</span>
                  <span className="font-mono text-fg">{opts.simplifyAmount}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={opts.simplifyAmount}
                  disabled={!opts.simplify}
                  onChange={(e) => setOpts({ ...opts, simplifyAmount: +e.target.value })}
                  className="vm-range w-full"
                  aria-label="Simplification strength"
                  data-testid="simplify-slider"
                />
                <div className="flex items-center justify-between font-mono text-2xs">
                  <span className="text-muted">
                    Anchors {before} → <span className="text-fg" data-testid="anchors-after">{after}</span>
                  </span>
                  <span className={reduction > 0 ? 'text-accent' : 'text-faint'}>−{reduction}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${before ? (after / before) * 100 : 100}%` }} />
                </div>
              </div>
            </div>
            <div>
              <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">Cleanup</h3>
              <Toggle checked={opts.stripMetadata} onChange={(v) => setOpts({ ...opts, stripMetadata: v })} label="Strip metadata & editor data" hint="<metadata>, <title>, comments, Inkscape/Sodipodi tags" />
              <Toggle checked={opts.removeHidden} onChange={(v) => setOpts({ ...opts, removeHidden: v })} label="Remove hidden elements" />
              <Toggle checked={opts.collapseGroups} onChange={(v) => setOpts({ ...opts, collapseGroups: v })} label="Collapse redundant groups" hint="Single-child and wrapper groups are flattened" />
            </div>
            {s && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-panel2 p-2.5 text-2xs">
                <dt className="text-muted">Shapes</dt>
                <dd className="text-right font-mono text-fg">{s.shapes}</dd>
                <dt className="text-muted">Metadata removed</dt>
                <dd className="text-right font-mono text-fg">{s.removedMetadata}</dd>
                <dt className="text-muted">Hidden removed</dt>
                <dd className="text-right font-mono text-fg">{s.removedHidden}</dd>
                <dt className="text-muted">Empty groups removed</dt>
                <dd className="text-right font-mono text-fg">{s.removedEmptyGroups}</dd>
                <dt className="text-muted">Groups collapsed</dt>
                <dd className="text-right font-mono text-fg">{s.collapsedGroups}</dd>
              </dl>
            )}
            {s && s.unsupported.length > 0 && (
              <p className="flex gap-1.5 text-2xs text-key">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Skipped unsupported elements: {s.unsupported.map((t) => `<${t}>`).join(', ')}. Gradients are flattened to an averaged solid colour.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
