import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Diamond } from 'lucide-react';
import { useEditor } from '../../store/editor';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  variant?: 'ghost' | 'solid' | 'outline' | 'danger';
  size?: 'xs' | 'sm' | 'md';
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { active, variant = 'ghost', size = 'sm', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40 disabled:pointer-events-none',
        size === 'xs' && 'h-6 px-1.5 text-2xs',
        size === 'sm' && 'h-7 px-2 text-xs',
        size === 'md' && 'h-9 px-3 text-sm',
        variant === 'ghost' && (active ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-raised hover:text-fg'),
        variant === 'solid' && 'bg-accent text-accent-fg hover:brightness-110',
        variant === 'outline' && (active ? 'border border-accent bg-accent/15 text-accent' : 'border border-line text-fg hover:bg-raised'),
        variant === 'danger' && 'text-danger hover:bg-danger/15',
        className,
      )}
    >
      {children}
    </button>
  );
});

export function IconButton({ label, children, className, ...rest }: BtnProps & { label: string }) {
  return (
    <Button aria-label={label} title={label} className={cx('!px-0 w-7', className)} {...rest}>
      {children}
    </Button>
  );
}

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line/70">
      <header className="flex h-8 items-center justify-between px-3">
        <button className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted hover:text-fg" onClick={() => setOpen(!open)}>
          <span className={cx('inline-block transition-transform', open ? 'rotate-90' : '')}>›</span>
          {title}
        </button>
        {right}
      </header>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex items-center gap-2', className)}>
      <span className="w-16 shrink-0 text-2xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </label>
  );
}

/** Numeric input with drag-to-scrub label (Figma-style). */
export function NumberField({
  value,
  onChange,
  onCommit,
  onScrubStart,
  label,
  step = 1,
  min,
  max,
  precision = 2,
  suffix,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number, final: boolean) => void;
  onCommit?: () => void;
  onScrubStart?: () => void;
  label?: string;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const clampV = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const display = Number.isFinite(value) ? String(Math.round(value * 10 ** precision) / 10 ** precision) : '—';

  const startScrub = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) {
        moved = true;
        onScrubStart?.();
      }
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      onChange(clampV(start + dx * step * mult), false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) onCommit?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commit = () => {
    setEditing(false);
    const v = parseFloat(text);
    if (!isNaN(v) && v !== value) onChange(clampV(v), true);
  };

  return (
    <div className={cx('flex h-7 min-w-0 flex-1 items-center rounded-md border border-transparent bg-panel2 focus-within:border-accent/60 hover:border-line', disabled && 'opacity-50', className)}>
      {label && (
        <span onPointerDown={startScrub} className="cursor-ew-resize select-none pl-2 pr-1 text-2xs font-medium text-faint hover:text-accent" title="Drag to scrub (Shift ×10, Alt ×0.1)">
          {label}
        </span>
      )}
      <input
        disabled={disabled}
        className="w-full min-w-0 bg-transparent px-1.5 font-mono text-xs text-fg outline-none"
        value={editing ? text : display}
        onFocus={(e) => {
          setEditing(true);
          setText(display);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clampV(value + d), true);
            setText(String(Math.round((value + d) * 10 ** precision) / 10 ** precision));
          }
        }}
      />
      {suffix && <span className="pr-2 text-2xs text-faint">{suffix}</span>}
    </div>
  );
}

export function ColorField({ value, onChange, onStart, allowNone = true }: { value: string; onChange: (v: string, final: boolean) => void; onStart?: () => void; allowNone?: boolean }) {
  const isNone = value === 'none';
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <label
        className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line"
        style={{ background: isNone ? 'repeating-conic-gradient(#666 0 25%, #999 0 50%) 0 0/8px 8px' : value }}
        onPointerDown={onStart}
      >
        <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={isNone ? '#000000' : value} onChange={(e) => onChange(e.target.value, false)} aria-label="Pick colour" />
      </label>
      <input
        className="h-7 min-w-0 flex-1 rounded-md bg-panel2 px-2 font-mono text-xs uppercase text-fg outline-none focus:ring-1 focus:ring-accent/60"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const t = text.trim().toLowerCase();
          if (t === 'none' && allowNone) onChange('none', true);
          else if (/^#?[0-9a-f]{6}$/.test(t)) onChange(t.startsWith('#') ? t : `#${t}`, true);
          else setText(value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {allowNone && (
        <button className={cx('h-7 rounded-md px-1.5 text-2xs', isNone ? 'bg-accent/20 text-accent' : 'text-faint hover:bg-raised hover:text-fg')} onClick={() => onChange(isNone ? '#888888' : 'none', true)} title="Toggle none">
          ∅
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-raised border border-line')}
      >
        <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-fg transition-all', checked ? 'left-3.5 !bg-accent-fg' : 'left-0.5')} />
      </button>
      <span className="text-xs leading-tight text-fg">
        {label}
        {hint && <span className="mt-0.5 block text-2xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, className, title }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; title?: string }) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx('h-7 min-w-0 rounded-md border border-line bg-panel2 px-1.5 text-xs text-fg outline-none focus:border-accent/60', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T | null; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="flex rounded-md bg-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx('flex h-6 flex-1 items-center justify-center rounded px-1.5 text-2xs', value === o.value ? 'bg-raised text-fg shadow' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Keyframe toggle: outline = not animated, ring = animated, filled = key at playhead. */
export function KeyButton({ state, onClick, title }: { state: 'none' | 'animated' | 'key'; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title ?? (state === 'key' ? 'Remove keyframe' : 'Add keyframe at playhead')}
      className={cx('grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-raised', state === 'none' ? 'text-faint' : 'text-key')}
    >
      <Diamond size={11} strokeWidth={2.5} fill={state === 'key' ? 'currentColor' : 'none'} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel2 px-1 font-mono text-2xs text-muted">{children}</kbd>;
}

/** Click-outside helper for menus/popovers. */
export function useClickOutside(onOutside: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [active, onOutside]);
  return ref;
}

export function Toast() {
  const toast = useEditor((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      className={cx(
        'pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-lg border px-4 py-2 text-xs shadow-2xl',
        toast.kind === 'error' ? 'border-danger/50 bg-panel text-danger' : 'border-line bg-raised text-fg',
      )}
    >
      {toast.msg}
    </div>
  );
}
