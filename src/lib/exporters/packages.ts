// ─────────────────────────────────────────────────────────────────────────────
//  Packaged formats:
//   • dotLottie (.lottie) — a real ZIP container: manifest.json + one animation
//     per state + a dotLottie v2-style state machine definition.
//   • Lottie zip — one Lottie JSON per state.
// ─────────────────────────────────────────────────────────────────────────────
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { AnimState, DocumentModel, Transition } from '../../types/model';
import { round } from '../math';
import { slug } from './common';
import { exportLottie } from './lottie';

// ── dotLottie ────────────────────────────────────────────────────────────────

const INPUT_FOR: Partial<Record<Transition['trigger'], { input: string; type: 'Boolean'; value: boolean }>> = {
  pointerEnter: { input: 'isHovered', type: 'Boolean', value: true },
  pointerLeave: { input: 'isHovered', type: 'Boolean', value: false },
  pointerDown: { input: 'isPressed', type: 'Boolean', value: true },
  pointerUp: { input: 'isPressed', type: 'Boolean', value: false },
};

const INTERACTION_TYPE: Record<string, string> = {
  pointerEnter: 'PointerEnter',
  pointerLeave: 'PointerExit',
  pointerDown: 'PointerDown',
  pointerUp: 'PointerUp',
  click: 'Click',
};

function inputName(t: Transition, doc: DocumentModel): string {
  const base = INPUT_FOR[t.trigger]?.input;
  if (t.trigger === 'custom') return t.customName ?? 'trigger';
  if (t.trigger === 'click') return t.targetNodeId ? `click_${slug(doc.nodes[t.targetNodeId]?.name ?? 'layer')}` : 'click';
  if (t.trigger === 'complete') return 'complete';
  return t.targetNodeId ? `${base}_${slug(doc.nodes[t.targetNodeId]?.name ?? 'layer')}` : base!;
}

export function buildDotLottieStateMachine(doc: DocumentModel) {
  const stateName = (id: string) => doc.states.find((s) => s.id === id)?.name ?? id;
  const inputs = new Map<string, Record<string, unknown>>();
  const interactions: Record<string, unknown>[] = [];
  const seenInteraction = new Set<string>();

  for (const t of doc.transitions) {
    const name = inputName(t, doc);
    const bool = INPUT_FOR[t.trigger];
    if (bool) inputs.set(name, { type: 'Boolean', name, value: false });
    else inputs.set(name, { type: 'Event', name });
    const layerName = t.targetNodeId ? doc.nodes[t.targetNodeId]?.name : undefined;
    const key = `${t.trigger}|${name}|${layerName ?? ''}`;
    if (seenInteraction.has(key)) continue;
    seenInteraction.add(key);
    if (INTERACTION_TYPE[t.trigger]) {
      interactions.push({
        type: INTERACTION_TYPE[t.trigger],
        ...(layerName ? { layerName } : {}),
        actions: [bool ? { type: 'SetBoolean', inputName: name, value: bool.value } : { type: 'Fire', inputName: name }],
      });
    } else if (t.trigger === 'complete') {
      interactions.push({ type: 'OnComplete', stateName: stateName(t.from), actions: [{ type: 'Fire', inputName: name }] });
    }
  }

  const guardFor = (t: Transition) => {
    const name = inputName(t, doc);
    const bool = INPUT_FOR[t.trigger];
    return bool
      ? { type: 'Boolean', conditionType: 'Equal', inputName: name, compareTo: bool.value }
      : { type: 'Event', inputName: name };
  };
  const tx = (t: Transition) => ({
    type: 'Tweened',
    toState: stateName(t.to),
    duration: round(t.duration / 1000, 3),
    easing: t.easing.type === 'linear' ? [0, 0, 1, 1] : t.easing.bezier,
    guards: [guardFor(t)],
  });

  const anyTransitions = doc.transitions.filter((t) => t.from === '*');
  return {
    initial: stateName(doc.initialStateId),
    states: doc.states.map((s) => ({
      type: 'PlaybackState',
      name: s.name,
      animation: slug(s.name),
      loop: s.loop,
      autoplay: true,
      mode: 'Forward',
      speed: 1,
      transitions: [...doc.transitions.filter((t) => t.from === s.id), ...anyTransitions.filter((t) => t.to !== s.id)].map(tx),
    })),
    interactions,
    inputs: [...inputs.values()],
  };
}

export function buildDotLottie(doc: DocumentModel): Uint8Array {
  const files: Zippable = {};
  const animations = doc.states.map((s) => ({ id: slug(s.name), state: s }));
  animations.forEach(({ id, state }) => {
    files[`a/${id}.json`] = strToU8(JSON.stringify(exportLottie(doc, state)));
  });
  const initialId = slug(doc.states.find((s) => s.id === doc.initialStateId)?.name ?? doc.states[0].name);
  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        version: '2',
        generator: 'VectoWave 1.0',
        animations: [
          ...animations.filter((a) => a.id === initialId),
          ...animations.filter((a) => a.id !== initialId),
        ].map(({ id, state }) => ({ id, ...(state.loop ? { loop: true } : {}) })),
        stateMachines: [{ id: 'main' }],
        initial: { stateMachine: 'main' },
      },
      null,
      2,
    ),
  );
  files['s/main.json'] = strToU8(JSON.stringify(buildDotLottieStateMachine(doc), null, 2));
  return zipSync(files, { level: 6 });
}

// ── Lottie: every state in one zip ───────────────────────────────────────────

/** File name for a state's Lottie JSON: start state → "<name>.json", others → "<name>.<state>.json". */
export function lottieFileName(doc: DocumentModel, state: AnimState) {
  const base = slug(doc.name);
  return state.id === doc.initialStateId ? `${base}.json` : `${base}.${slug(state.name)}.json`;
}

export function buildLottieZip(doc: DocumentModel): Uint8Array {
  const files: Zippable = {};
  doc.states.forEach((s) => (files[lottieFileName(doc, s)] = strToU8(JSON.stringify(exportLottie(doc, s)))));
  return zipSync(files, { level: 6 });
}
