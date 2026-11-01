import { create } from 'zustand';
import { StateMachineRuntime } from '../lib/runtime';
import { useEditor } from './editor';

/** Interactive-preview runtime (separate store: it ticks every frame). */
interface PreviewState {
  runtime: StateMachineRuntime | null;
  tick: number;
}

export const usePreview = create<PreviewState>(() => ({ runtime: null, tick: 0 }));

let raf = 0;
let last = 0;

function loop(now: number) {
  const { runtime } = usePreview.getState();
  if (!runtime) return;
  const dt = Math.min(64, now - last);
  last = now;
  runtime.tick(dt);
  usePreview.setState({ tick: usePreview.getState().tick + 1 });
  raf = requestAnimationFrame(loop);
}

export function startPreview() {
  const doc = useEditor.getState().doc;
  const runtime = new StateMachineRuntime(doc);
  usePreview.setState({ runtime });
  useEditor.setState({ preview: true, playing: false, tool: 'select' });
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(loop);
}

export function stopPreview() {
  cancelAnimationFrame(raf);
  usePreview.setState({ runtime: null });
  useEditor.setState({ preview: false });
}

export function togglePreview() {
  if (usePreview.getState().runtime) stopPreview();
  else startPreview();
}

// Keep the runtime's document in sync with edits made while previewing
useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc) usePreview.getState().runtime?.setDoc(s.doc);
});
