// Shared imperative actions used by menus, shortcuts and drop handlers.
import type { DocumentModel } from '../types/model';
import { activeState, useEditor } from '../store/editor';
import { stopPreview, togglePreview } from '../store/preview';
import { createEmptyDoc } from './doc';
import { buildDemoDoc } from './demo';
import { download, slug } from './exporters/common';
import { deleteAnchors } from './path';

function pickFile(accept: string, cb: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => input.files?.[0] && cb(input.files[0]);
  input.click();
}

export async function openFile(file: File) {
  const text = await file.text();
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml' || text.trimStart().startsWith('<')) {
    stopPreview();
    useEditor.setState({ importFile: { name: file.name, text } });
    return;
  }
  try {
    loadProject(JSON.parse(text));
  } catch {
    useEditor.getState().notify(`Couldn’t open “${file.name}” — expected an .svg or .vwave.json file.`, 'error');
  }
}

export const openSvgDialog = () => pickFile('.svg,image/svg+xml', openFile);
export const openProjectDialog = () => pickFile('.json,.vwave,.vmotion', openFile);

export function loadProject(data: unknown) {
  const d = data as DocumentModel;
  if (!d || d.version !== 1 || !d.nodes || !Array.isArray(d.states)) {
    useEditor.getState().notify('Not a VectoWave project file.', 'error');
    return;
  }
  stopPreview();
  useEditor.getState().loadDoc(d);
  useEditor.getState().notify(`Opened “${d.name}”`);
}

export function saveProject() {
  const { doc } = useEditor.getState();
  download(`${slug(doc.name)}.vwave.json`, JSON.stringify(doc, null, 1), 'application/json');
}

export function newDocument(demo = false) {
  stopPreview();
  useEditor.getState().loadDoc(demo ? buildDemoDoc() : createEmptyDoc());
}

export function deleteSelected() {
  const st = useEditor.getState();
  if (st.focus === 'timeline' && st.keySel.length) return st.deleteKeyframes(st.keySel);
  if (st.anchorSel.length && st.tool === 'direct') {
    const byNode = new Map<string, { sub: number; idx: number }[]>();
    st.anchorSel.forEach((a) => byNode.set(a.nodeId, [...(byNode.get(a.nodeId) ?? []), a]));
    st.checkpoint();
    byNode.forEach((refs, nodeId) => st.editGeometry(nodeId, (g) => deleteAnchors(g, refs), true, false));
    st.setAnchorSel([]);
    return;
  }
  if (st.keySel.length && !st.selection.length) return st.deleteKeyframes(st.keySel);
  st.deleteSelection();
}

export function togglePlay() {
  const st = useEditor.getState();
  if (st.preview) return;
  st.setPlaying(!st.playing);
}

export function stepFrame(dir: 1 | -1, big = false) {
  const st = useEditor.getState();
  const frame = 1000 / (st.doc.fps || 60);
  const dur = activeState(st).duration;
  st.setTime(Math.min(dur, Math.max(0, st.time + dir * (big ? frame * 10 : frame))));
}

export function jumpToKey(dir: 1 | -1) {
  const st = useEditor.getState();
  const s = activeState(st);
  const ids = st.selection.length ? st.selection : Object.keys(s.tracks);
  const times = new Set<number>();
  ids.forEach((id) => Object.values(s.tracks[id] ?? {}).forEach((l) => l?.forEach((k) => times.add(k.time))));
  const sorted = [...times].sort((a, b) => a - b);
  const t = dir > 0 ? sorted.find((x) => x > st.time + 0.5) : [...sorted].reverse().find((x) => x < st.time - 0.5);
  if (t !== undefined) st.setTime(t);
}

export { togglePreview };

/** Distinguishes Space tap (play/pause) from Space-hold panning. */
export const spaceGesture = { down: 0, panned: false };

