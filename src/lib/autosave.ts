// ─────────────────────────────────────────────────────────────────────────────
//  Autosave: the document being edited is cached in IndexedDB (falls back to
//  localStorage) so an accidentally closed tab can be resumed from the intro
//  screen. Saving starts only after the first edit, so merely opening the demo
//  or a blank document never overwrites earlier work.
// ─────────────────────────────────────────────────────────────────────────────
import type { DocumentModel } from '../types/model';
import { useEditor } from '../store/editor';

export interface SavedWork {
  doc: DocumentModel;
  savedAt: number;
}

const DB_NAME = 'vectowave';
const STORE = 'autosave';
const KEY = 'current';
const LS_KEY = 'vectowave:autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWork(doc: DocumentModel): Promise<number> {
  const record: SavedWork = { doc, savedAt: Date.now() };
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(record));
    } catch {
      /* storage unavailable (private mode / quota) */
    }
  }
  return record.savedAt;
}

export async function loadWork(): Promise<SavedWork | null> {
  try {
    const db = await openDb();
    const rec = await new Promise<SavedWork | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as SavedWork | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (rec?.doc?.version === 1) return rec;
  } catch {
    /* fall through to localStorage */
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    const rec = raw ? (JSON.parse(raw) as SavedWork) : null;
    return rec?.doc?.version === 1 ? rec : null;
  } catch {
    return null;
  }
}

let timer = 0;
let pending: DocumentModel | null = null;

function flush() {
  window.clearTimeout(timer);
  if (!pending) return;
  const doc = pending;
  pending = null;
  saveWork(doc).then((savedAt) => useEditor.setState({ savedAt }));
}

/** Call once at startup. */
export function startAutosave() {
  useEditor.subscribe((s, prev) => {
    if (s.screen !== 'editor' || s.doc === prev.doc || s.doc === s.loadedDoc) return;
    pending = s.doc;
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 600);
  });
  // Save immediately if the tab is being hidden or closed
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}
