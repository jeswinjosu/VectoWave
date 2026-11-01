import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, FileCode2, FileJson, Film, Package, Video } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { exportAnimatedSvg } from '../../lib/exporters/animatedSvg';
import { exportLottie } from '../../lib/exporters/lottie';
import { buildDotLottie, buildDotLottieStateMachine, buildLottieZip, lottieFileName } from '../../lib/exporters/packages';
import { estimateWebmBytes, webmDimensions, webmDurationMs, webmSupported } from '../../lib/exporters/webmInfo';
import { download, slug } from '../../lib/exporters/common';
import { Button, ColorField, Select, Toggle, cx } from '../ui/primitives';
import { Modal } from './Modal';

type Format = 'svg' | 'lottie' | 'dotlottie' | 'webm';

const FORMATS: { id: Format; title: string; tip: string; icon: typeof Film }[] = [
  {
    id: 'svg',
    title: 'Animated SVG',
    tip: 'Best for websites: the smallest file, sharp at any size, and hover/press work with no JavaScript or player.',
    icon: FileCode2,
  },
  {
    id: 'lottie',
    title: 'Lottie JSON',
    tip: 'Choose this for apps that already use a Lottie player (iOS, Android, React Native, web); you get one file per state.',
    icon: FileJson,
  },
  {
    id: 'dotlottie',
    title: 'dotLottie',
    tip: 'Best for interactive Lottie: every state plus the hover/press state machine in one compressed file.',
    icon: Package,
  },
  {
    id: 'webm',
    title: 'WebM video',
    tip: 'Use for social posts, slides or video editors; it plays anywhere but isn’t interactive or scalable.',
    icon: Video,
  },
];

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

export function ExportModal() {
  const doc = useEditor((s) => s.doc);
  const set = useEditor((s) => s.set);
  const [format, setFormat] = useState<Format>('svg');
  const [stateId, setStateId] = useState(doc.initialStateId);
  const [interactive, setInteractive] = useState(true);
  const [minify, setMinify] = useState(false);
  const [copied, setCopied] = useState(false);
  // WebM settings
  const [vSize, setVSize] = useState('1080');
  const [vFps, setVFps] = useState('30');
  const [vTransparent, setVTransparent] = useState(false);
  const [vBg, setVBg] = useState(doc.background ?? '#ffffff');
  const [vLoops, setVLoops] = useState('2');
  const [video, setVideo] = useState<{ blob: Blob; url: string; key: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const base = slug(doc.name);
  const state = doc.states.find((s) => s.id === stateId) ?? doc.states[0];
  const webmOpts = { state, size: +vSize, fps: +vFps, loops: +vLoops, background: vTransparent ? null : vBg };
  const videoKey = JSON.stringify([state.id, vSize, vFps, vLoops, vTransparent, vBg]);

  // Outputs + sizes for every option (shown on the cards)
  const outputs = useMemo(() => {
    const svgText = exportAnimatedSvg(doc, { interactive, minify });
    const lottieJson = exportLottie(doc, state);
    const lottieText = JSON.stringify(lottieJson); // compact: what gets downloaded
    const lottiePretty = JSON.stringify(lottieJson, null, 2); // readable code preview
    const lottieAllBytes = doc.states.reduce((n, s) => n + new Blob([JSON.stringify(exportLottie(doc, s))]).size, 0);
    const dot = buildDotLottie(doc);
    return {
      svg: { text: svgText, bytes: new Blob([svgText]).size },
      lottie: { text: lottieText, pretty: lottiePretty, bytes: new Blob([lottieText]).size, allBytes: lottieAllBytes },
      dotlottie: { text: JSON.stringify(buildDotLottieStateMachine(doc), null, 2), bytes: dot.length, data: dot },
    };
  }, [doc, interactive, minify, state]);


  const sizeLabel: Record<Format, string> = {
    svg: formatBytes(outputs.svg.bytes),
    lottie: `${formatBytes(outputs.lottie.bytes)} this state · ${formatBytes(outputs.lottie.allBytes)} all ${doc.states.length}`,
    dotlottie: formatBytes(outputs.dotlottie.bytes),
    webm: video && video.key === videoKey ? formatBytes(video.blob.size) : `≈ ${formatBytes(estimateWebmBytes(doc, webmOpts))} (estimate)`,
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (video) URL.revokeObjectURL(video.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderVideo = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setVideoError(null);
    setProgress(0);
    try {
      const { exportWebm } = await import('../../lib/exporters/webm'); // encoder loads on demand
      const blob = await exportWebm(doc, { ...webmOpts, onProgress: setProgress, signal: ac.signal });
      if (video) URL.revokeObjectURL(video.url);
      setVideo({ blob, url: URL.createObjectURL(blob), key: videoKey });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setVideoError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const doDownload = () => {
    switch (format) {
      case 'svg':
        return download(`${base}.animated.svg`, outputs.svg.text, 'image/svg+xml');
      case 'lottie':
        return download(lottieFileName(doc, state), outputs.lottie.text, 'application/json');
      case 'dotlottie':
        return download(`${base}.lottie`, outputs.dotlottie.data as BlobPart, 'application/zip');
      case 'webm':
        if (video) download(`${base}.${slug(state.name)}.webm`, video.blob, 'video/webm');
    }
  };

  const codeText = format === 'svg' ? outputs.svg.text : format === 'lottie' ? outputs.lottie.pretty : format === 'dotlottie' ? outputs.dotlottie.text : '';
  const { width: vw, height: vh } = webmDimensions(doc, +vSize);

  return (
    <Modal
      title="Export"
      subtitle={`${doc.name} · ${doc.states.length} states · ${Object.keys(doc.nodes).length} layers`}
      onClose={() => set({ exportOpen: false })}
      width="max-w-5xl"
      footer={
        <>
          {codeText && (
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                navigator.clipboard?.writeText(codeText).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy code'}
            </Button>
          )}
          {format === 'lottie' && doc.states.length > 1 && (
            <Button variant="outline" size="md" onClick={() => download(`${base}-lottie.zip`, buildLottieZip(doc) as BlobPart, 'application/zip')}>
              <Download size={14} /> All states (.zip)
            </Button>
          )}
          <Button variant="solid" size="md" onClick={doDownload} disabled={format === 'webm' && (!video || video.key !== videoKey)} data-testid="export-download">
            <Download size={14} /> Download{format === 'lottie' ? ` ${state.name}` : ''}
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-[300px_1fr]">
        <div className="space-y-1.5 border-b border-line p-3 md:border-b-0 md:border-r" role="radiogroup" aria-label="Export format">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={format === f.id}
              onClick={() => setFormat(f.id)}
              className={cx('flex w-full gap-2.5 rounded-lg border p-2.5 text-left transition-colors', format === f.id ? 'border-accent bg-accent/10' : 'border-line/70 hover:bg-raised')}
            >
              <f.icon size={16} className={format === f.id ? 'mt-0.5 shrink-0 text-accent' : 'mt-0.5 shrink-0 text-muted'} />
              <span className="min-w-0">
                <span className="flex items-center justify-between gap-2 text-xs font-medium text-fg">{f.title}</span>
                <span className="mt-0.5 block text-2xs leading-snug text-muted">{f.tip}</span>
                <span className="mt-1 block font-mono text-2xs text-accent" data-testid={`size-${f.id}`}>
                  {sizeLabel[f.id]}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex min-h-[440px] min-w-0 flex-col">
          {/* Per-format options */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-3">
            {format === 'svg' && (
              <>
                <Toggle checked={interactive} onChange={setInteractive} label="Include hover / pressed states" />
                <Toggle checked={minify} onChange={setMinify} label="Minify" />
              </>
            )}
            {(format === 'lottie' || format === 'webm') && (
              <label className="flex items-center gap-2 text-2xs text-muted">
                State
                <Select value={stateId} onChange={(v) => setStateId(v)} options={doc.states.map((s) => ({ value: s.id, label: s.name }))} />
              </label>
            )}
            {format === 'lottie' && <span className="font-mono text-2xs text-faint">{lottieFileName(doc, state)}</span>}
            {format === 'dotlottie' && <span className="text-2xs text-muted">Contains {doc.states.map((s) => s.name).join(', ')} and the state machine below.</span>}
            {format === 'webm' && (
              <>
                <label className="flex items-center gap-2 text-2xs text-muted">
                  Size
                  <Select value={vSize} onChange={setVSize} options={['512', '720', '1080', '1440'].map((v) => ({ value: v, label: `${v}px` }))} />
                </label>
                <label className="flex items-center gap-2 text-2xs text-muted">
                  Frame rate
                  <Select value={vFps} onChange={setVFps} options={['24', '30', '60'].map((v) => ({ value: v, label: `${v} fps` }))} />
                </label>
                {state.loop && (
                  <label className="flex items-center gap-2 text-2xs text-muted">
                    Loops
                    <Select value={vLoops} onChange={setVLoops} options={['1', '2', '3', '5'].map((v) => ({ value: v, label: `×${v}` }))} />
                  </label>
                )}
                <Toggle checked={vTransparent} onChange={setVTransparent} label="Transparent" />
                {!vTransparent && (
                  <div className="flex w-44 items-center gap-2 text-2xs text-muted">
                    Background <ColorField allowNone={false} value={vBg} onChange={(v) => setVBg(v)} />
                  </div>
                )}
              </>
            )}
          </div>

          {format === 'svg' && (
            <div className="grid h-56 shrink-0 place-items-center border-b border-line bg-bg p-3">
              <div className="h-[200px] w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: outputs.svg.text }} data-testid="svg-preview" />
            </div>
          )}

          {format === 'webm' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5">
              {!webmSupported() ? (
                <p className="max-w-sm text-center text-xs text-danger">This browser can’t encode video. Use a recent Chrome, Edge or Firefox to export WebM.</p>
              ) : video && video.key === videoKey ? (
                <>
                  <video src={video.url} controls loop autoPlay muted className="max-h-72 max-w-full rounded-lg border border-line" style={{ background: 'repeating-conic-gradient(#2a2f45 0 25%, #353b55 0 50%) 0 0/16px 16px' }} data-testid="webm-preview" />
                  <p className="font-mono text-2xs text-muted">
                    {vw}×{vh} · {vFps} fps · {(webmDurationMs(webmOpts) / 1000).toFixed(2)} s · {formatBytes(video.blob.size)}
                  </p>
                </>
              ) : (
                <>
                  <p className="max-w-md text-center text-xs text-muted">
                    Renders <b className="text-fg">{state.name}</b> at {vw}×{vh}, {vFps} fps, {(webmDurationMs(webmOpts) / 1000).toFixed(2)} s
                    {vTransparent ? ' with a transparent background (VP9 alpha)' : ''}. Rendering runs on your device and takes a few seconds.
                  </p>
                  {progress === null ? (
                    <Button variant="solid" size="md" onClick={renderVideo} data-testid="webm-render">
                      <Film size={14} /> Render video
                    </Button>
                  ) : (
                    <div className="w-64 space-y-1.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-2xs text-muted">
                        <span>Rendering… {Math.round(progress * 100)}%</span>
                        <button className="hover:text-fg" onClick={() => abortRef.current?.abort()}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {videoError && <p className="max-w-md text-center text-xs text-danger">{videoError}</p>}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-1.5 text-2xs text-faint">
                <span>{format === 'dotlottie' ? 'State machine (s/main.json)' : 'Code'}</span>
                <span className="font-mono">{formatBytes(new Blob([codeText]).size)}</span>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto bg-panel2 px-4 py-3 font-mono text-[11px] leading-relaxed text-muted" data-testid="export-code">
                {codeText.length > 60000 ? codeText.slice(0, 60000) + '\n… (truncated preview — download for the full file)' : codeText}
              </pre>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
