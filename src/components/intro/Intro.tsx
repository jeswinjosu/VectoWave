// ─────────────────────────────────────────────────────────────────────────────
//  Intro / home screen: animated logo, three start options with live previews,
//  and a short description of the app.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { FilePlus2, History, PlayCircle } from 'lucide-react';
import type { DocumentModel } from '../../types/model';
import { useEditor } from '../../store/editor';
import { loadWork, type SavedWork } from '../../lib/autosave';
import { createEmptyDoc } from '../../lib/doc';
import { buildDemoDoc } from '../../lib/demo';
import { Logo } from '../brand/Logo';
import { DocPreview } from './DocPreview';
import { cx } from '../ui/primitives';

function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function Card({
  title,
  detail,
  icon: Icon,
  preview,
  onClick,
  disabled,
  delay,
  testId,
}: {
  title: string;
  detail: string;
  icon: typeof History;
  preview: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  delay: number;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        'vw-card group flex flex-col overflow-hidden rounded-2xl border text-left transition',
        'border-white/10 bg-[oklch(0.22_0.05_266/0.72)] backdrop-blur-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-1 hover:border-accent/70 hover:shadow-[0_18px_50px_-12px_oklch(0.91_0.2_127/0.35)]',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[oklch(0.17_0.045_266)]">
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(oklch(0.4_0.06_266)_1px,transparent_1px)] [background-size:14px_14px]" />
        <div className="absolute inset-4">{preview}</div>
      </div>
      <div className="flex items-start gap-3 p-4">
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', disabled ? 'bg-white/10 text-muted' : 'bg-accent text-accent-fg')}>
          <Icon size={17} />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[15px] font-semibold text-fg">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted">{detail}</span>
        </span>
      </div>
    </button>
  );
}

export function Intro() {
  const loadDoc = useEditor((s) => s.loadDoc);
  const [saved, setSaved] = useState<SavedWork | null | undefined>(undefined);
  const demo = useMemo<DocumentModel>(() => buildDemoDoc(), []);
  const blank = useMemo(() => createEmptyDoc(), []);

  useEffect(() => {
    loadWork().then(setSaved);
  }, []);

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#09122A] text-fg" data-testid="intro">
      {/* Atmosphere: drifting glows in the logo's lime / aqua / navy shades */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="vw-glow absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,oklch(0.91_0.2_127/0.55),transparent_65%)]" />
        <div className="vw-glow absolute -bottom-56 -right-40 h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle,oklch(0.8_0.14_175/0.45),transparent_65%)] [animation-delay:-6s]" />
        <div className="vw-glow absolute left-1/3 top-1/4 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,oklch(0.5_0.2_266/0.55),transparent_65%)] [animation-delay:-11s]" />
        <svg className="absolute bottom-0 left-0 h-48 w-[200%] opacity-60" viewBox="0 0 2400 200" preserveAspectRatio="none">
          <path className="vw-wave-line" d="M0 120 C200 60 400 180 600 120 S1000 60 1200 120 S1600 180 1800 120 S2200 60 2400 120" fill="none" stroke="oklch(0.91 0.2 127 / 0.35)" strokeWidth="2" />
          <path className="vw-wave-line [animation-duration:18s]" d="M0 150 C200 100 400 200 600 150 S1000 100 1200 150 S1600 200 1800 150 S2200 100 2400 150" fill="none" stroke="oklch(0.84 0.13 175 / 0.3)" strokeWidth="2" />
        </svg>
      </div>

      <main className="relative mx-auto flex min-h-full max-w-5xl flex-col items-center gap-10 px-[max(16px,env(safe-area-inset-left,0px))] py-12 md:py-16">
        <header className="flex flex-col items-center text-center">
          <div className="vw-logo-glow">
            <Logo size={150} tile={false} animated />
          </div>
          <h1 className="vw-rise mt-3 font-display text-5xl font-bold tracking-tight text-fg md:text-6xl" style={{ animationDelay: '250ms' }}>
            Vecto<span className="text-accent">Wave</span>
          </h1>
          <p className="vw-rise mt-2 text-sm text-muted" style={{ animationDelay: '380ms' }}>
            Motion studio for SVG
          </p>
        </header>

        <div className="grid w-full gap-5 md:grid-cols-3">
          <Card
            testId="intro-continue"
            title="Continue previous work"
            icon={History}
            disabled={!saved}
            delay={480}
            detail={saved === undefined ? 'Looking for saved work…' : saved ? `${saved.doc.name || 'Untitled'} · saved ${timeAgo(saved.savedAt)}` : 'No saved work yet. Edits are saved automatically'}
            preview={saved ? <DocPreview doc={saved.doc} /> : <div className="grid h-full place-items-center text-xs text-faint">Nothing saved yet</div>}
            onClick={() => saved && loadDoc(saved.doc)}
          />
          <Card
            testId="intro-new"
            title="New blank document"
            icon={FilePlus2}
            delay={580}
            detail="512 × 512 artboard with Idle, Hover and Pressed states"
            preview={
              <div className="grid h-full place-items-center">
                <div className="grid aspect-square h-full max-h-full place-items-center rounded-lg border-2 border-dashed border-accent/50 bg-[oklch(0.2_0.045_266)]">
                  <FilePlus2 size={34} className="text-accent" />
                </div>
              </div>
            }
            onClick={() => loadDoc(blank)}
          />
          <Card
            testId="intro-demo"
            title="Open demo"
            icon={PlayCircle}
            delay={680}
            detail="Animated badge with hover morph and press states"
            preview={<DocPreview doc={demo} />}
            onClick={() => loadDoc(buildDemoDoc())}
          />
        </div>

        <section className="vw-rise max-w-2xl text-center" style={{ animationDelay: '800ms' }}>
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-accent">What VectoWave does</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Import an SVG, clean it up and reshape it point by point, then animate position, scale, rotation, colour and shape morphs on a
            timeline. Give it Idle, Hover and Pressed states, test them live, and export as animated SVG, Lottie, dotLottie or WebM video.
            Your work is saved in this browser as you go.
          </p>
        </section>
      </main>
    </div>
  );
}
