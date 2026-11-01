import { useRef } from 'react';
import type { Easing, EasingType } from '../../types/model';
import { EASING_LABELS, makeEasing } from '../../lib/easing';
import { NumberField, cx } from '../ui/primitives';

const W = 216;
const H = 160;
const PAD = 26;
// y range shown: -0.5 … 1.5 so overshoot curves are editable
const Y_MIN = -0.5;
const Y_MAX = 1.5;

const sx = (x: number) => PAD + x * (W - PAD * 2);

/** Custom cubic-bezier curve editor with presets and a live motion preview. */
export function BezierEditor({ value, onChange }: { value: Easing; onChange: (e: Easing, final: boolean) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [x1, y1, x2, y2] = value.bezier;

  // map y into drawable area (0..1 occupies middle half)
  const py = (y: number) => {
    const inner = H - PAD * 2;
    return PAD + inner * (1 - (y - Y_MIN) / (Y_MAX - Y_MIN));
  };

  const drag = (which: 1 | 2) => (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left - PAD) / (W - PAD * 2)));
      const inner = H - PAD * 2;
      const y = Math.min(Y_MAX, Math.max(Y_MIN, Y_MIN + (1 - (ev.clientY - rect.top - PAD) / inner) * (Y_MAX - Y_MIN)));
      const r = (n: number) => Math.round(n * 100) / 100;
      const b: Easing['bezier'] = which === 1 ? [r(x), r(y), x2, y2] : [x1, y1, r(x), r(y)];
      onChange({ type: 'custom', bezier: b }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onChange({ type: 'custom', bezier: [...value.bezier] as Easing['bezier'] }, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const p0 = { x: sx(0), y: py(0) };
  const p3 = { x: sx(1), y: py(1) };
  const c1 = { x: sx(x1), y: py(y1) };
  const c2 = { x: sx(x2), y: py(y2) };
  const hold = value.type === 'hold';
  const curve = hold ? `M${p0.x} ${p0.y} H${p3.x} V${p3.y}` : `M${p0.x} ${p0.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`;
  const cssEase = hold ? 'steps(1, end)' : `cubic-bezier(${x1}, ${Math.max(-2, y1)}, ${x2}, ${Math.max(-2, y2)})`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(EASING_LABELS) as EasingType[]).map((t) => (
          <button
            key={t}
            onClick={() => onChange(t === 'custom' ? { type: 'custom', bezier: [...value.bezier] as Easing['bezier'] } : makeEasing(t), true)}
            className={cx('h-6 rounded text-2xs', value.type === t ? 'bg-accent text-accent-fg' : 'bg-panel2 text-muted hover:text-fg')}
          >
            {EASING_LABELS[t]}
          </button>
        ))}
      </div>
      <svg ref={svgRef} width={W} height={H} className="w-full rounded-md bg-panel2" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Easing curve editor">
        <rect x={sx(0)} y={py(1)} width={sx(1) - sx(0)} height={py(0) - py(1)} className="fill-raised/50" />
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={sx(g)} x2={sx(g)} y1={py(Y_MIN)} y2={py(Y_MAX)} className="stroke-line/60" strokeWidth={0.5} />
        ))}
        <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} className="stroke-line" strokeDasharray="2 3" />
        {!hold && (
          <>
            <line x1={p0.x} y1={p0.y} x2={c1.x} y2={c1.y} className="stroke-accent2" strokeWidth={1} />
            <line x1={p3.x} y1={p3.y} x2={c2.x} y2={c2.y} className="stroke-accent2" strokeWidth={1} />
          </>
        )}
        <path d={curve} fill="none" className="stroke-accent" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={p0.x} cy={p0.y} r={3} className="fill-fg" />
        <circle cx={p3.x} cy={p3.y} r={3} className="fill-fg" />
        {!hold && (
          <>
            <circle cx={c1.x} cy={c1.y} r={6} className="cursor-grab fill-accent2 stroke-panel" strokeWidth={2} onPointerDown={drag(1)} />
            <circle cx={c2.x} cy={c2.y} r={6} className="cursor-grab fill-accent2 stroke-panel" strokeWidth={2} onPointerDown={drag(2)} />
          </>
        )}
      </svg>
      {/* live motion preview */}
      <div className="relative h-4 overflow-hidden rounded bg-panel2">
        <div key={cssEase} className="absolute top-1 h-2 w-2 rounded-full bg-accent" style={{ animation: `vm-ease-demo 1.4s ${cssEase} infinite alternate` }} />
      </div>
      {!hold && (
        <div className="grid grid-cols-4 gap-1">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((k, i) => (
            <NumberField
              key={k}
              label={k}
              value={value.bezier[i]}
              step={0.01}
              min={i % 2 === 0 ? 0 : -2}
              max={i % 2 === 0 ? 1 : 3}
              onChange={(v, final) => {
                const b = [...value.bezier] as Easing['bezier'];
                b[i] = v;
                onChange({ type: 'custom', bezier: b }, final);
              }}
            />
          ))}
        </div>
      )}
      <p className="font-mono text-2xs text-faint">{value.type === 'linear' ? 'linear' : hold ? 'hold (step)' : `cubic-bezier(${value.bezier.join(', ')})`}</p>
    </div>
  );
}

