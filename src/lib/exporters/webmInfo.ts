// Lightweight helpers (no encoder import) so the export dialog can show sizes instantly.
import type { AnimState, DocumentModel } from '../../types/model';

export interface WebmOptions {
  state: AnimState;
  /** Longest side in pixels. */
  size: number;
  fps: number;
  /** CSS colour, or null for a transparent background. */
  background: string | null;
  /** How many times a looping state is repeated. */
  loops: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export function webmDimensions(doc: DocumentModel, size: number) {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2); // encoders need even sizes
  return doc.width >= doc.height
    ? { width: even(size), height: even((size * doc.height) / doc.width) }
    : { width: even((size * doc.width) / doc.height), height: even(size) };
}

export function webmDurationMs(o: Pick<WebmOptions, 'state' | 'loops'>) {
  return o.state.duration * (o.state.loop ? Math.max(1, o.loops) : 1);
}

/** Rough pre-render size estimate (flat vector art compresses well). */
export function estimateWebmBytes(doc: DocumentModel, o: Pick<WebmOptions, 'state' | 'loops' | 'size' | 'fps'>) {
  const { width, height } = webmDimensions(doc, o.size);
  const seconds = webmDurationMs(o) / 1000;
  return Math.round((width * height * o.fps * seconds * 0.025) / 8 + 4000);
}

export function webmSupported() {
  return typeof window !== 'undefined' && 'VideoEncoder' in window;
}

