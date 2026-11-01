// ─────────────────────────────────────────────────────────────────────────────
//  VectoWave workspace theme — fixed OKLCH palette taken from the logo:
//  deep navy  #09122A ≈ oklch(0.19 0.05 266)   lime  #BCF855 ≈ oklch(0.91 0.20 127)
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeTokens = Record<string, [number, number, number]>; // L C H

export const BRAND = {
  navy: '#09122A',
  lime: '#BCF855',
} as const;

const NAVY_H = 266;

export const VECTOWAVE_THEME: ThemeTokens = {
  bg: [0.155, 0.04, NAVY_H],
  panel: [0.2, 0.045, NAVY_H],
  'panel-2': [0.178, 0.042, NAVY_H],
  raised: [0.26, 0.05, NAVY_H],
  line: [0.31, 0.05, NAVY_H],
  fg: [0.96, 0.012, NAVY_H],
  muted: [0.78, 0.03, NAVY_H], // ≈ 7:1 on panel
  faint: [0.62, 0.035, NAVY_H], // hints / icons only
  accent: [0.91, 0.2, 127], // logo lime
  'accent-fg': [0.19, 0.05, NAVY_H], // navy text on lime
  'accent-2': [0.84, 0.13, 175], // aqua: handles, pivots, secondary marks
  danger: [0.7, 0.19, 22],
  key: [0.88, 0.17, 100], // keyframe diamonds (warm lime-yellow)
};

export function applyTheme(tokens: ThemeTokens = VECTOWAVE_THEME, el: HTMLElement = document.documentElement) {
  Object.entries(tokens).forEach(([k, [l, c, h]]) => {
    el.style.setProperty(`--${k}`, `${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)}`);
  });
}
