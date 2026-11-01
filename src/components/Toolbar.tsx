import { Circle, Grid3x3, Hand, Magnet, Maximize, MousePointer2, PenTool, Spline, Square, ZoomIn, ZoomOut } from 'lucide-react';
import { useEditor, type Tool } from '../store/editor';
import { cx } from './ui/primitives';

const TOOLS: { id: Tool; icon: typeof Circle; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select & Transform', key: 'V' },
  { id: 'direct', icon: Spline, label: 'Sub-select (anchor points)', key: 'A' },
  { id: 'pen', icon: PenTool, label: 'Pen', key: 'P' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
  { id: 'hand', icon: Hand, label: 'Hand (or hold Space)', key: 'H' },
];

function ToolBtn({ active, onClick, label, children }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'group relative grid h-9 w-9 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        active ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-raised hover:text-fg',
      )}
    >
      {children}
      <span className="pointer-events-none absolute left-11 z-50 hidden whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-2xs text-fg shadow-lg group-hover:block">
        {label}
      </span>
    </button>
  );
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const preview = useEditor((s) => s.preview);
  const showGrid = useEditor((s) => s.showGrid);
  const snap = useEditor((s) => s.snap);
  const set = useEditor((s) => s.set);
  const setTool = useEditor((s) => s.setTool);
  const zoomBy = useEditor((s) => s.zoomBy);
  const fitView = useEditor((s) => s.fitView);

  return (
    <nav aria-label="Tools" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
      {TOOLS.map((t) => (
        <ToolBtn key={t.id} active={tool === t.id && !preview} onClick={() => !preview && setTool(t.id)} label={`${t.label} (${t.key})`}>
          <t.icon size={17} />
        </ToolBtn>
      ))}
      <div className="my-1 h-px w-6 bg-line" />
      <ToolBtn onClick={() => zoomBy(1.25)} label="Zoom in (+)">
        <ZoomIn size={16} />
      </ToolBtn>
      <ToolBtn onClick={() => zoomBy(0.8)} label="Zoom out (−)">
        <ZoomOut size={16} />
      </ToolBtn>
      <ToolBtn onClick={fitView} label="Zoom to fit (Shift+1)">
        <Maximize size={16} />
      </ToolBtn>
      <div className="flex-1" />
      <ToolBtn active={showGrid} onClick={() => set({ showGrid: !showGrid })} label="Toggle grid (G)">
        <Grid3x3 size={16} />
      </ToolBtn>
      <ToolBtn active={snap} onClick={() => set({ snap: !snap })} label="Snap to pixels">
        <Magnet size={16} />
      </ToolBtn>
    </nav>
  );
}
