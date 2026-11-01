// ─────────────────────────────────────────────────────────────────────────────
//  State-machine runtime used by Interactive Preview. Plays the active state's
//  timeline, listens for pointer / custom triggers and cross-blends between
//  states over each transition's duration + easing.
// ─────────────────────────────────────────────────────────────────────────────
import type { DocumentModel, Transition, TriggerType } from '../types/model';
import { blendEval, evaluateDoc, type EvalMap } from './animation';
import { applyEasing } from './easing';

export interface RuntimeEvent {
  at: number;
  label: string;
}

export class StateMachineRuntime {
  doc: DocumentModel;
  stateId: string;
  time = 0;
  private blend: { from: EvalMap; elapsed: number; tr: Transition } | null = null;
  private completed = false;
  private hovered = new Set<string>();
  private inside = false;
  log: RuntimeEvent[] = [];
  private clock = 0;

  constructor(doc: DocumentModel) {
    this.doc = doc;
    this.stateId = doc.initialStateId;
  }

  get state() {
    return this.doc.states.find((s) => s.id === this.stateId) ?? this.doc.states[0];
  }

  setDoc(doc: DocumentModel) {
    this.doc = doc;
    if (!doc.states.some((s) => s.id === this.stateId)) this.reset();
  }

  reset() {
    this.stateId = this.doc.initialStateId;
    this.time = 0;
    this.blend = null;
    this.completed = false;
    this.hovered.clear();
    this.inside = false;
    this.log = [];
  }

  tick(dtMs: number) {
    this.clock += dtMs;
    const st = this.state;
    if (!st) return;
    this.time += dtMs;
    if (st.loop && st.duration > 0) {
      this.time %= st.duration;
    } else if (this.time >= st.duration) {
      this.time = st.duration;
      if (!this.completed) {
        this.completed = true;
        this.fire('complete', null);
      }
    }
    if (this.blend) {
      this.blend.elapsed += dtMs;
      if (this.blend.elapsed >= this.blend.tr.duration) this.blend = null;
    }
  }

  evaluate(): EvalMap {
    const cur = evaluateDoc(this.doc, this.state, this.time);
    if (!this.blend || this.blend.tr.duration <= 0) return cur;
    const t = applyEasing(this.blend.tr.easing, Math.min(1, this.blend.elapsed / this.blend.tr.duration));
    const out: EvalMap = {};
    for (const id in cur) out[id] = this.blend.from[id] ? blendEval(this.blend.from[id], cur[id], t) : cur[id];
    return out;
  }

  /** Pointer moved; `chain` = hovered node + its ancestors (empty if over background). */
  pointerMove(insideArtboard: boolean, chain: string[]) {
    if (insideArtboard !== this.inside) {
      this.inside = insideArtboard;
      this.fire(insideArtboard ? 'pointerEnter' : 'pointerLeave', null);
    }
    const next = new Set(insideArtboard ? chain : []);
    this.hovered.forEach((id) => !next.has(id) && this.fire('pointerLeave', id));
    next.forEach((id) => !this.hovered.has(id) && this.fire('pointerEnter', id));
    this.hovered = next;
  }

  pointer(trigger: 'pointerDown' | 'pointerUp' | 'click', chain: string[]) {
    this.fire(trigger, null, undefined, chain);
  }

  custom(name: string) {
    this.fire('custom', null, name);
  }

  /**
   * @param nodeId For enter/leave: the node the pointer entered/left (null = artboard).
   * @param chain  For down/up/click: hit node + ancestors.
   */
  fire(trigger: TriggerType, nodeId: string | null, customName?: string, chain?: string[]) {
    const candidates = this.doc.transitions.filter((t) => {
      if (t.trigger !== trigger) return false;
      if (t.from !== '*' && t.from !== this.stateId) return false;
      if (t.to === this.stateId && t.from === '*') return false;
      if (trigger === 'custom') return t.customName === customName;
      if (trigger === 'pointerEnter' || trigger === 'pointerLeave') return t.targetNodeId === nodeId;
      if (trigger === 'complete') return true;
      return t.targetNodeId === null || (chain ?? []).includes(t.targetNodeId);
    });
    // Prefer transitions explicitly leaving the current state over "any state" ones
    candidates.sort((a, b) => (a.from === '*' ? 1 : 0) - (b.from === '*' ? 1 : 0));
    const tr = candidates[0];
    const label =
      trigger === 'custom' ? `trigger “${customName}”` : `${trigger}${nodeId ? ` · ${this.doc.nodes[nodeId]?.name ?? ''}` : ''}`;
    if (!tr) {
      if (trigger === 'custom') this.push(`${label} (no transition)`);
      return;
    }
    const target = this.doc.states.find((s) => s.id === tr.to);
    if (!target) return;
    const from = this.evaluate();
    this.blend = tr.duration > 0 ? { from, elapsed: 0, tr } : null;
    this.stateId = target.id;
    this.time = 0;
    this.completed = false;
    this.push(`${label} → ${target.name}`);
  }

  private push(label: string) {
    this.log = [{ at: this.clock, label }, ...this.log].slice(0, 30);
  }
}
