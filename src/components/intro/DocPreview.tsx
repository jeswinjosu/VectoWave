import { useEffect, useMemo, useState } from 'react';
import type { DocumentModel } from '../../types/model';
import { evaluateDoc } from '../../lib/animation';
import { SceneRenderer } from '../canvas/SceneRenderer';

/** Live, looping thumbnail of a document's start state. */
export function DocPreview({ doc, playing = true }: { doc: DocumentModel; playing?: boolean }) {
  const state = doc.states.find((s) => s.id === doc.initialStateId) ?? doc.states[0];
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!playing || !state || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(now - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, state]);
  const local = state ? (state.loop ? t % Math.max(1, state.duration) : Math.min(t, state.duration)) : 0;
  const evals = useMemo(() => evaluateDoc(doc, state, local), [doc, state, local]);
  return (
    <svg viewBox={`0 0 ${doc.width} ${doc.height}`} className="h-full w-full" role="img" aria-label={`Preview of ${doc.name}`}>
      {doc.background && <rect width={doc.width} height={doc.height} fill={doc.background} />}
      <SceneRenderer doc={doc} evals={evals} interactive={false} />
    </svg>
  );
}
