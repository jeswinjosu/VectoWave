import { ListTree, Workflow } from 'lucide-react';
import type { StateKind } from '../../types/model';
import { useEditor } from '../../store/editor';
import { cx } from '../ui/primitives';

export const KIND_ICON: Record<StateKind, string> = { idle: '◉', hover: '◎', pressed: '●', custom: '◆' };

export function PanelTabs() {
  const tab = useEditor((s) => s.bottomTab);
  const set = useEditor((s) => s.set);
  return (
    <div className="flex rounded-md bg-panel2 p-0.5">
      {(
        [
          ['timeline', 'Timeline', ListTree],
          ['states', 'State Machine', Workflow],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          onClick={() => set({ bottomTab: id })}
          className={cx('flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium', tab === id ? 'bg-raised text-fg shadow' : 'text-muted hover:text-fg')}
        >
          <Icon size={12} /> {label}
        </button>
      ))}
    </div>
  );
}
