// ─────────────────────────────────────────────────────────────────────────────
//  Animated SVG exporter.
//  • Transform / opacity / colour / stroke-width → CSS @keyframes using the
//    individual `translate` / `rotate` / `scale` properties (one animation per
//    property, so each keeps its own easing curve).
//  • Path morphing → SMIL <animate attributeName="d"> with keySplines.
//  • State machine → Idle = default, Hover = :hover, Pressed = :active,
//    custom states = `.vm-state-<name>` classes (toggle from JS).
// ─────────────────────────────────────────────────────────────────────────────
import type { AnimState, DocumentModel, Keyframe, PathGeometry, PathNode, PropKey, SceneNode, Vec } from '../../types/model';
import { easingToCss } from '../easing';
import { round } from '../math';
import { pathString } from '../path';
import { cubicPath, escapeXml, exportIds, keyedProps, normalizeGeometries, slug } from './common';

export interface SvgExportOptions {
  /** Map states to CSS pseudo-classes / classes. When false, only the initial state is exported. */
  interactive: boolean;
  /** Minify whitespace. */
  minify: boolean;
}

const px = (n: number) => `${round(n, 3)}px`;

function cssValue(prop: PropKey, v: unknown): [string, string] | null {
  switch (prop) {
    case 'position': {
      const p = v as Vec;
      return ['translate', `${px(p.x)} ${px(p.y)}`];
    }
    case 'scale': {
      const s = v as Vec;
      return ['scale', `${round(s.x, 4)} ${round(s.y, 4)}`];
    }
    case 'rotation':
      return ['rotate', `${round(v as number, 3)}deg`];
    case 'opacity':
      return ['opacity', `${round(v as number, 4)}`];
    case 'fill':
      return ['fill', v as string];
    case 'stroke':
      return ['stroke', v as string];
    case 'strokeWidth':
      return ['stroke-width', px(v as number)];
  }
  return null;
}

const SELECTOR: Record<string, (root: string) => string> = {
  idle: () => '',
  hover: (r) => `#${r}:hover `,
  pressed: (r) => `#${r}:active `,
};

export function exportAnimatedSvg(doc: DocumentModel, opts: SvgExportOptions = { interactive: true, minify: false }): string {
  const ids = exportIds(doc);
  // No hyphens: SMIL `begin="id.event"` would parse '-' as a time offset
  const rootId = `vmroot_${slug(doc.name).replace(/-/g, '_')}`;
  const initial = doc.states.find((s) => s.id === doc.initialStateId) ?? doc.states[0];
  const states: AnimState[] = opts.interactive ? [initial, ...doc.states.filter((s) => s !== initial)] : [initial];
  const usedKinds = new Set<string>();

  const keyframesCss: string[] = [];
  const ruleCss: string[] = [];
  const smil: Record<string, string[]> = {}; // nodeId → <animate> elements

  states.forEach((state, si) => {
    // Selector prefix for this state
    let prefix = '';
    if (si > 0 || state !== initial) {
      if (state.kind !== 'custom' && SELECTOR[state.kind] && !usedKinds.has(state.kind)) prefix = SELECTOR[state.kind](rootId);
      else prefix = `#${rootId}.vm-state-${slug(state.name)} `;
    }
    usedKinds.add(state.kind);
    const iter = state.loop ? 'infinite' : '1';
    const fillMode = state.loop ? 'none' : 'both';
    const dur = Math.max(1, state.duration);

    // Every node that is animated in *any* exported state needs a rule in every state,
    // so switching state cleanly replaces (or clears) its animations.
    for (const nodeId in doc.nodes) {
      const node = doc.nodes[nodeId];
      const animatedSomewhere = states.some((s) => keyedProps(s, node).some((p) => p !== 'path'));
      if (!animatedSomewhere) continue;
      const anims: string[] = [];
      for (const prop of keyedProps(state, node)) {
        if (prop === 'path') continue;
        const list = state.tracks[nodeId]![prop] as Keyframe[];
        const name = `vm-${slug(state.name)}-${ids[nodeId].slice(3)}-${prop}`;
        const frames: string[] = [];
        const push = (pct: number, value: unknown, easing?: Keyframe['easing']) => {
          const cv = cssValue(prop, value);
          if (!cv) return;
          const tf = easing ? ` animation-timing-function: ${easingToCss(easing)};` : '';
          frames.push(`  ${round(pct, 3)}% { ${cv[0]}: ${cv[1]};${tf} }`);
        };
        if (list[0].time > 0) push(0, list[0].value);
        list.forEach((k, i) => push((Math.min(k.time, dur) / dur) * 100, k.value, i < list.length - 1 ? k.easing : undefined));
        if (list[list.length - 1].time < dur) push(100, list[list.length - 1].value);
        keyframesCss.push(`@keyframes ${name} {\n${frames.join('\n')}\n}`);
        anims.push(`${name} ${dur}ms linear 0ms ${iter} ${fillMode}`);
      }
      ruleCss.push(`${prefix}#${ids[nodeId]} { animation: ${anims.length ? anims.join(', ') : 'none'}; }`);
    }

    // Path morphs → SMIL
    for (const nodeId in doc.nodes) {
      const node = doc.nodes[nodeId];
      if (node.type !== 'path') continue;
      const list = state.tracks[nodeId]?.path as Keyframe<'path'>[] | undefined;
      if (!list?.length) continue;
      const geos = normalizeGeometries(list.map((k) => k.value as PathGeometry));
      const times = list.map((k) => Math.min(1, Math.max(0, k.time / dur)));
      const values = geos.map(cubicPath);
      if (times[0] > 0) {
        times.unshift(0);
        values.unshift(values[0]);
      }
      if (times[times.length - 1] < 1) {
        times.push(1);
        values.push(values[values.length - 1]);
      }
      const splines: string[] = [];
      for (let i = 0; i < times.length - 1; i++) {
        const k = list.find((kf) => Math.abs(kf.time / dur - times[i]) < 1e-6 && i < times.length - 1);
        // SMIL keySplines must lie in [0,1] → overshoot curves are clamped
        splines.push((k && k.easing.type !== 'hold' ? k.easing.bezier : [0, 0, 1, 1]).map((n) => round(Math.min(1, Math.max(0, n)), 4)).join(' '));
      }
      let begin = '0s';
      let end = '';
      if (state !== initial) {
        if (state.kind === 'hover') {
          begin = `${rootId}.mouseenter`;
          end = ` end="${rootId}.mouseleave" restart="whenNotActive"`;
        } else if (state.kind === 'pressed') {
          begin = `${rootId}.mousedown`;
          end = ` end="${rootId}.mouseup" restart="whenNotActive"`;
        } else begin = 'indefinite';
      }
      (smil[nodeId] ??= []).push(
        `<animate attributeName="d" dur="${dur}ms" begin="${begin}"${end} repeatCount="${state.loop ? 'indefinite' : '1'}" fill="${state.loop ? 'remove' : 'freeze'}" calcMode="spline" keyTimes="${times.map((t) => round(t, 5)).join(';')}" keySplines="${splines.join(';')}" values="${values.join(';')}" data-state="${escapeXml(state.name)}"/>`,
      );
    }
  });

  // ── Markup ──
  const nl = opts.minify ? '' : '\n';
  const ind = (d: number) => (opts.minify ? '' : '  '.repeat(d));
  const styleAttr = (n: SceneNode) => {
    const parts = [`transform-origin:${px(n.origin.x)} ${px(n.origin.y)}`];
    if (n.position.x || n.position.y) parts.push(`translate:${px(n.position.x)} ${px(n.position.y)}`);
    if (n.rotation) parts.push(`rotate:${round(n.rotation, 3)}deg`);
    if (n.scale.x !== 1 || n.scale.y !== 1) parts.push(`scale:${round(n.scale.x, 4)} ${round(n.scale.y, 4)}`);
    return parts.join(';');
  };
  const renderNode = (id: string, depth: number): string => {
    const n = doc.nodes[id];
    if (!n) return '';
    const common = `id="${ids[id]}" style="${styleAttr(n)}"${n.opacity !== 1 ? ` opacity="${round(n.opacity, 4)}"` : ''}${n.visible ? '' : ' display="none"'}`;
    if (n.type === 'group') {
      return `${ind(depth)}<g ${common}>${nl}${n.children.map((c) => renderNode(c, depth + 1)).join('')}${ind(depth)}</g>${nl}`;
    }
    const p = n as PathNode;
    const attrs = [
      `d="${pathString(p.geometry)}"`,
      `fill="${p.fill}"`,
      p.fillOpacity !== 1 ? `fill-opacity="${round(p.fillOpacity, 4)}"` : '',
      p.fillRule === 'evenodd' ? 'fill-rule="evenodd"' : '',
      p.stroke !== 'none' ? `stroke="${p.stroke}" stroke-width="${round(p.strokeWidth, 3)}"` : '',
      p.stroke !== 'none' && p.strokeOpacity !== 1 ? `stroke-opacity="${round(p.strokeOpacity, 4)}"` : '',
      p.stroke !== 'none' && p.lineCap !== 'butt' ? `stroke-linecap="${p.lineCap}"` : '',
      p.stroke !== 'none' && p.lineJoin !== 'miter' ? `stroke-linejoin="${p.lineJoin}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const anim = smil[id];
    if (anim?.length) {
      return `${ind(depth)}<path ${common} ${attrs}>${nl}${anim.map((a) => ind(depth + 1) + a + nl).join('')}${ind(depth)}</path>${nl}`;
    }
    return `${ind(depth)}<path ${common} ${attrs}/>${nl}`;
  };

  const css = [
    `#${rootId} * { transform-box: view-box; }`,
    `#${rootId} { cursor: ${opts.interactive && doc.transitions.length ? 'pointer' : 'default'}; }`,
    ...keyframesCss,
    ...ruleCss,
    '@media (prefers-reduced-motion: reduce) { #' + rootId + ' * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; } }',
  ].join(nl);

  const customStates = states.filter((s) => s.kind === 'custom' || ruleCss.some((r) => r.includes(`vm-state-${slug(s.name)}`)));
  const header = `<!-- Exported by VectoWave · ${escapeXml(doc.name)}${
    opts.interactive && customStates.length
      ? ` · Custom states: toggle class "vm-state-<name>" on #${rootId} (${customStates.map((s) => 'vm-state-' + slug(s.name)).join(', ')})`
      : ''
  } -->`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" id="${rootId}" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width}" height="${doc.height}" role="img" aria-label="${escapeXml(doc.name)}">`,
    header,
    `<style>${nl}${css}${nl}</style>`,
    doc.background ? `<rect width="100%" height="100%" fill="${doc.background}"/>` : '',
    doc.rootIds.map((id) => renderNode(id, 1)).join(''),
    '</svg>',
  ]
    .filter(Boolean)
    .join(nl);
}
