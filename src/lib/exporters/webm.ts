// ─────────────────────────────────────────────────────────────────────────────
//  WebM video export. Frames are rendered offline (exact timing, faster than
//  real time) and encoded with WebCodecs (VP9/VP8) via mediabunny. Transparent
//  backgrounds keep their alpha channel where the browser's encoder supports it.
// ─────────────────────────────────────────────────────────────────────────────
import { BufferTarget, CanvasSource, Output, QUALITY_HIGH, WebMOutputFormat, getFirstEncodableVideoCodec } from 'mediabunny';
import type { DocumentModel } from '../../types/model';
import { webmDimensions, webmDurationMs, webmSupported, type WebmOptions } from './webmInfo';
import { evaluateDoc } from '../animation';
import { frameSvg } from './frame';

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // revoke after decode; the decoded bitmap stays usable
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function exportWebm(doc: DocumentModel, o: WebmOptions): Promise<Blob> {
  if (!webmSupported()) throw new Error('This browser can’t encode video. Use a recent Chrome, Edge or Firefox.');
  const { width, height } = webmDimensions(doc, o.size);
  const transparent = o.background === null;
  const codec = await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width, height });
  if (!codec) throw new Error('No WebM video encoder (VP9/VP8) is available in this browser.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: transparent })!;

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, alpha: transparent ? 'keep' : 'discard' });
  output.addVideoTrack(source, { frameRate: o.fps });
  await output.start();

  const totalMs = webmDurationMs(o);
  const frames = Math.max(1, Math.round((totalMs / 1000) * o.fps));
  const dur = Math.max(1, o.state.duration);
  try {
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = (i / o.fps) * 1000;
      const local = o.state.loop ? t % dur : Math.min(t, dur);
      const svg = frameSvg(doc, evaluateDoc(doc, o.state, local), width, height, o.background);
      const img = await loadSvgImage(svg);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      await source.add(i / o.fps, 1 / o.fps);
      o.onProgress?.((i + 1) / frames);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([target.buffer!], { type: 'video/webm' });
}
