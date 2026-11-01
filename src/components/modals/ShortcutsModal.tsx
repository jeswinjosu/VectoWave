import { useEditor } from '../../store/editor';
import { Kbd } from '../ui/primitives';
import { Modal } from './Modal';

const GROUPS: [string, [string, string][]][] = [
  ['Tools', [['V', 'Select & transform'], ['A', 'Sub-select anchors'], ['P', 'Pen'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['H / Space', 'Pan']]],
  ['Canvas', [['Scroll', 'Zoom at cursor'], ['Shift+Scroll', 'Pan horizontally'], ['Shift+1', 'Zoom to fit'], ['G', 'Toggle grid'], ['Double-click', 'Edit anchors / add anchor on segment']]],
  ['Editing', [['⌘/Ctrl+Z', 'Undo'], ['⌘/Ctrl+Shift+Z', 'Redo'], ['⌘/Ctrl+D', 'Duplicate'], ['⌘/Ctrl+G', 'Group'], ['Delete', 'Delete selection / anchors / keyframes'], ['Arrows', 'Nudge (Shift ×10)'], ['Alt+drag handle', 'Break handle symmetry']]],
  ['Animation', [['Space', 'Play / pause'], ['K', 'Toggle auto-key'], [', / .', 'Previous / next frame'], ['J / L', 'Previous / next keyframe'], ['Home / End', 'Start / end'], ['Shift+P', 'Interactive preview']]],
];

export function ShortcutsModal() {
  const set = useEditor((s) => s.set);
  return (
    <Modal title="Keyboard Shortcuts" onClose={() => set({ shortcutsOpen: false })} width="max-w-2xl">
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        {GROUPS.map(([g, items]) => (
          <div key={g}>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">{g}</h3>
            <ul className="space-y-1.5">
              {items.map(([k, d]) => (
                <li key={k} className="flex items-center justify-between gap-3 text-xs text-fg">
                  {d} <Kbd>{k}</Kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
