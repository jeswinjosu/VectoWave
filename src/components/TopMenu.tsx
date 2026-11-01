import { useCallback, useState } from 'react';
import { Cloud, Download, MousePointerClick, Play, Redo2, Square, Undo2 } from 'lucide-react';
import { Logo } from './brand/Logo';
import { useEditor } from '../store/editor';
import { usePreview } from '../store/preview';
import { deleteSelected, newDocument, openProjectDialog, openSvgDialog, saveProject, togglePlay, togglePreview } from '../lib/actions';
import { Button, cx, useClickOutside } from './ui/primitives';

type Item = { label: string; shortcut?: string; action: () => void; disabled?: boolean; checked?: boolean } | 'sep';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function Menu({ label, items, open, onOpen, onClose, hoverOpen }: { label: string; items: Item[]; open: boolean; onOpen: () => void; onClose: () => void; hoverOpen: boolean }) {
  const ref = useClickOutside(onClose, open);
  return (
    <div ref={ref} className="relative">
      <button
        className={cx('h-7 rounded-md px-2.5 text-xs', open ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg')}
        onClick={() => (open ? onClose() : onOpen())}
        onMouseEnter={() => hoverOpen && onOpen()}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-50 min-w-[220px] rounded-lg border border-line bg-panel p-1 shadow-2xl">
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  it.action();
                }}
                className="flex h-7 w-full items-center justify-between gap-6 rounded-md px-2 text-left text-xs text-fg hover:bg-accent hover:text-accent-fg disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="flex items-center gap-2">
                  <span className="w-3 text-accent">{it.checked ? '✓' : ''}</span>
                  {it.label}
                </span>
                {it.shortcut && <span className="font-mono text-2xs opacity-60">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function TopMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const st = useEditor();
  const runtime = usePreview((s) => s.runtime);
  const close = useCallback(() => setOpen(null), []);

  const menus: Record<string, Item[]> = {
    File: [
      { label: 'Home Screen', action: () => st.set({ screen: 'intro', playing: false }) },
      'sep',
      { label: 'New Blank Document', action: () => newDocument(false) },
      { label: 'New from Demo', action: () => newDocument(true) },
      'sep',
      { label: 'Import SVG…', shortcut: `${mod}I`, action: openSvgDialog },
      { label: 'Open Project…', shortcut: `${mod}O`, action: openProjectDialog },
      { label: 'Save Project', shortcut: `${mod}S`, action: saveProject },
      'sep',
      { label: 'Export…', shortcut: `${mod}E`, action: () => st.set({ exportOpen: true }) },
    ],
    Edit: [
      { label: 'Undo', shortcut: `${mod}Z`, action: st.undo, disabled: !st.past.length },
      { label: 'Redo', shortcut: `${mod}⇧Z`, action: st.redo, disabled: !st.future.length },
      'sep',
      { label: 'Duplicate', shortcut: `${mod}D`, action: st.duplicateSelection, disabled: !st.selection.length },
      { label: 'Delete', shortcut: 'Del', action: deleteSelected },
      { label: 'Group', shortcut: `${mod}G`, action: st.groupSelection, disabled: !st.selection.length },
      { label: 'Ungroup', shortcut: `${mod}⇧G`, action: st.ungroupSelection, disabled: !st.selection.length },
      'sep',
      { label: 'Bring Forward', shortcut: `${mod}]`, action: () => st.bringForward(1) },
      { label: 'Send Backward', shortcut: `${mod}[`, action: () => st.bringForward(-1) },
      { label: 'Select All', shortcut: `${mod}A`, action: () => st.select(Object.keys(st.doc.nodes).filter((id) => st.doc.nodes[id].type === 'path')) },
    ],
    View: [
      { label: 'Zoom In', shortcut: '+', action: () => st.zoomBy(1.25) },
      { label: 'Zoom Out', shortcut: '−', action: () => st.zoomBy(0.8) },
      { label: 'Zoom to Fit', shortcut: '⇧1', action: st.fitView },
      { label: 'Actual Size', shortcut: '⇧0', action: () => st.zoomBy(1 / st.view.zoom) },
      'sep',
      { label: 'Show Grid', shortcut: 'G', checked: st.showGrid, action: () => st.set({ showGrid: !st.showGrid }) },
      { label: 'Snap to Pixels', checked: st.snap, action: () => st.set({ snap: !st.snap }) },
    ],
    Animation: [
      { label: st.playing ? 'Pause' : 'Play', shortcut: 'Space', action: togglePlay },
      { label: 'Auto-key (record)', shortcut: 'K', checked: st.autoKey, action: () => st.set({ autoKey: !st.autoKey }) },
      'sep',
      { label: 'Add Hover State', action: () => st.addState('hover') },
      { label: 'Add Pressed State', action: () => st.addState('pressed') },
      { label: 'Add Custom State', action: () => st.addState('custom') },
      { label: 'Open State Machine', action: () => st.set({ bottomTab: 'states' }) },
      'sep',
      { label: runtime ? 'Stop Interactive Preview' : 'Interactive Preview', shortcut: '⇧P', action: togglePreview },
    ],
    Help: [
      { label: 'Keyboard Shortcuts', shortcut: '?', action: () => st.set({ shortcutsOpen: true }) },
    ],
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <div className="flex items-center gap-2 pr-2">
        <button onClick={() => st.set({ screen: 'intro', playing: false })} title="Home screen" className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <Logo size={28} />
          <span className="hidden font-display text-[15px] font-bold tracking-tight text-fg sm:inline">
            Vecto<span className="text-accent">Wave</span>
          </span>
        </button>
      </div>
      <nav className="flex items-center" aria-label="Main menu">
        {Object.entries(menus).map(([label, items]) => (
          <Menu key={label} label={label} items={items} open={open === label} onOpen={() => setOpen(label)} onClose={close} hoverOpen={open !== null} />
        ))}
      </nav>
      <div className="flex items-center gap-0.5 pl-2">
        <Button size="sm" onClick={st.undo} disabled={!st.past.length} aria-label="Undo" title="Undo">
          <Undo2 size={14} />
        </Button>
        <Button size="sm" onClick={st.redo} disabled={!st.future.length} aria-label="Redo" title="Redo">
          <Redo2 size={14} />
        </Button>
      </div>
      <div className="mx-auto min-w-0 px-2">
        <input
          className="w-48 truncate rounded-md bg-transparent px-2 py-1 text-center text-xs text-muted outline-none hover:bg-raised focus:bg-panel2 focus:text-fg"
          value={st.doc.name}
          onChange={(e) => st.mutate((d) => void (d.name = e.target.value), false)}
          aria-label="Document name"
        />
        <span className="ml-1 inline-flex items-center gap-1 text-2xs text-faint" title="Your work is saved in this browser automatically" data-testid="autosave">
          <Cloud size={11} /> {st.savedAt ? `Saved ${new Date(st.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave on'}
        </span>
      </div>
      <Button variant={runtime ? 'solid' : 'outline'} size="sm" onClick={togglePreview} title="Interactive preview (Shift+P)">
        {runtime ? <Square size={12} /> : <MousePointerClick size={14} />}
        {runtime ? 'Stop Preview' : 'Preview'}
      </Button>
      <Button variant="ghost" size="sm" onClick={togglePlay} disabled={!!runtime} title="Play timeline (Space)">
        <Play size={14} />
      </Button>
      <Button variant="solid" size="sm" onClick={() => st.set({ exportOpen: true })}>
        <Download size={14} /> Export
      </Button>
    </header>
  );
}
