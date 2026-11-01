import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { activeState, useEditor } from './store/editor';
import { stopPreview, togglePreview } from './store/preview';
import { TopMenu } from './components/TopMenu';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/canvas/Canvas';
import { Inspector } from './components/inspector/Inspector';
import { BottomPanel } from './components/timeline/Timeline';
import { ImportModal } from './components/modals/ImportModal';
import { ExportModal } from './components/modals/ExportModal';
import { ShortcutsModal } from './components/modals/ShortcutsModal';
import { Toast } from './components/ui/primitives';
import { Intro } from './components/intro/Intro';
import { deleteSelected, jumpToKey, openFile, openProjectDialog, openSvgDialog, saveProject, spaceGesture, stepFrame, togglePlay } from './lib/actions';
import { cloneGeometry } from './lib/path';
import { evaluateNode } from './lib/animation';

function usePlaybackLoop() {
  const playing = useEditor((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = useEditor.getState();
      const s = activeState(st);
      const dt = Math.min(64, now - last);
      last = now;
      let t = st.time + dt;
      if (t >= s.duration) {
        if (s.loop) t = s.duration > 0 ? t % s.duration : 0;
        else {
          st.set({ time: s.duration, playing: false });
          return;
        }
      }
      st.set({ time: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function nudge(dx: number, dy: number) {
  const st = useEditor.getState();
  if (st.tool === 'direct' && st.anchorSel.length) {
    const byNode = new Map<string, typeof st.anchorSel>();
    st.anchorSel.forEach((a) => byNode.set(a.nodeId, [...(byNode.get(a.nodeId) ?? []), a]));
    st.checkpoint();
    byNode.forEach((refs, id) =>
      st.editGeometry(id, (g) => {
        const out = cloneGeometry(g);
        refs.forEach(({ sub, idx }) => {
          const a = out.subpaths[sub]?.anchors[idx];
          if (a) {
            a.x += dx;
            a.y += dy;
          }
        });
        return out;
      }, false, false),
    );
    return;
  }
  if (!st.selection.length) return;
  st.checkpoint();
  const s = activeState(st);
  st.selection.forEach((id) => {
    const n = st.doc.nodes[id];
    if (!n || n.locked) return;
    const pos = evaluateNode(n, s.tracks[id], st.time).position;
    st.setProp(id, 'position', { x: pos.x + dx, y: pos.y + dy }, false);
  });
}

function useShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      const st = useEditor.getState();
      if (st.importFile || st.exportOpen || st.shortcutsOpen || st.screen === 'intro') return;
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (e.code === 'Space') {
        if (!e.repeat) {
          spaceGesture.down = performance.now();
          spaceGesture.panned = false;
        }
        e.preventDefault();
        return;
      }
      if (mod) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? st.redo() : st.undo()),
          y: st.redo,
          d: st.duplicateSelection,
          g: () => (e.shiftKey ? st.ungroupSelection() : st.groupSelection()),
          s: saveProject,
          o: openProjectDialog,
          i: openSvgDialog,
          e: () => st.set({ exportOpen: true }),
          a: () => st.select(Object.keys(st.doc.nodes).filter((id) => st.doc.nodes[id].type === 'path')),
          ']': () => st.bringForward(1),
          '[': () => st.bringForward(-1),
        };
        if (map[k]) {
          e.preventDefault();
          map[k]();
        }
        return;
      }
      if (e.shiftKey && e.key === '!') return st.fitView();
      if (e.shiftKey && (e.code === 'Digit1')) return st.fitView();
      if (e.shiftKey && e.code === 'Digit0') return st.zoomBy(1 / st.view.zoom);
      if (e.shiftKey && k === 'p') return togglePreview();
      if (e.key === '?') return st.set({ shortcutsOpen: true });

      switch (e.key) {
        case 'Escape':
          if (st.preview) return stopPreview();
          if (st.editingPathId) return st.set({ editingPathId: null });
          if (st.anchorSel.length) return st.setAnchorSel([]);
          if (st.keySel.length) return st.setKeySel([]);
          return st.select([]);
        case 'Enter':
          if (st.editingPathId) st.set({ editingPathId: null });
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          return deleteSelected();
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          if (st.focus === 'timeline' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return stepFrame(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
          return nudge(dx, dy);
        }
        case ',':
          return stepFrame(-1, e.shiftKey);
        case '.':
          return stepFrame(1, e.shiftKey);
        case 'Home':
          return st.setTime(0);
        case 'End':
          return st.setTime(activeState(st).duration);
        case '+':
        case '=':
          return st.zoomBy(1.25);
        case '-':
          return st.zoomBy(0.8);
      }
      if (st.preview) return;
      const tools: Record<string, Parameters<typeof st.setTool>[0]> = { v: 'select', a: 'direct', p: 'pen', r: 'rect', o: 'ellipse', h: 'hand' };
      if (tools[k] && !e.shiftKey && !e.altKey) return st.setTool(tools[k]);
      if (k === 'g') return st.set({ showGrid: !st.showGrid });
      if (k === 'k') return st.set({ autoKey: !st.autoKey });
      if (k === 'j') return jumpToKey(-1);
      if (k === 'l') return jumpToKey(1);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      // Tap Space = play/pause; hold Space + drag = pan
      if (!spaceGesture.panned && performance.now() - spaceGesture.down < 350) togglePlay();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}

export default function App() {
  const importFile = useEditor((s) => s.importFile);
  const exportOpen = useEditor((s) => s.exportOpen);
  const shortcutsOpen = useEditor((s) => s.shortcutsOpen);
  const [dragging, setDragging] = useState(false);
  usePlaybackLoop();
  useShortcuts();

  const screen = useEditor((s) => s.screen);

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden bg-bg font-sans text-fg"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        openFile(e.dataTransfer.files[0]);
      }}
    >
      {screen === 'intro' ? (
        <Intro />
      ) : (
        <>
          <TopMenu />
          <div className="flex min-h-0 flex-1">
            <Toolbar />
            <main className="relative min-w-0 flex-1">
              <Canvas />
            </main>
            <Inspector />
          </div>
          <BottomPanel />
        </>
      )}
      {importFile && <ImportModal />}
      {exportOpen && <ExportModal />}
      {shortcutsOpen && <ShortcutsModal />}
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-[80] grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 text-accent">
            <FileUp size={36} />
            <p className="text-sm font-medium">Drop an SVG to import · or a .vwave.json project</p>
          </div>
        </div>
      )}
      <Toast />
    </div>
  );
}
