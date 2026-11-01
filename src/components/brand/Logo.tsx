// VectoWave logo — vectorised from the brand artwork (wave tub, curl and bubbles).
import { BRAND } from '../../lib/theme';

export const LOGO_BODY =
  'M514.6 579.3C522.3 576.7 529.7 568.6 534.4 557.5C536.5 552.5 547 528.2 557.7 503.5C604.4 395.6 622 347.4 633.2 297C636.3 283.2 636.4 281.5 636.4 261.5C636.4 241.5 636.3 240.1 633.7 231.7C618.8 183.4 576 164 512.9 176.9C489.8 181.7 472.1 188.9 453.3 201.2L445 206.6L454.3 209.4C482.8 218 503.5 233 512.8 251.8C516.3 259 516.5 259.9 516.8 270.9C517.1 279.8 516.7 284.9 515 293C502.8 352.9 458.3 407 407.2 424C391.1 429.3 384 430.4 365.5 430.3C316.9 430 254.2 412.8 197 384C183.4 377.1 180.3 376 171.7 374.5C162.4 373 161.8 373 157.7 374.8C151.4 377.6 148.6 382.5 149.3 389.3C149.8 394.3 204.2 550 209.5 561.8C212.8 569 215.2 572.2 219.9 575.4C228.2 581.2 219.9 580.9 370.6 581C498.1 581 510.1 580.9 514.6 579.3Z';
export const LOGO_CURL =
  'M418.3 276.4C420.1 275.5 427.4 269 434.5 261.9C451.1 245.7 454.7 243.7 470 243.2C477.8 242.9 483 243.3 490.5 244.9C495.9 246 500.6 246.8 500.7 246.6C501.6 245.8 486.3 232.7 480.3 229.1C468 221.8 463.4 220.6 447.5 220.6C433.8 220.5 433.3 220.6 424.3 224.1C407.8 230.5 396 239.3 392 248.2C389.3 254.2 389.4 261.6 392.3 267.1C397 276 409.9 280.6 418.3 276.4Z';
/** Lime bubbles outside the wave: [cx, cy, r] */
export const LOGO_BUBBLES: [number, number, number][] = [
  [460.9, 162.4, 10],
  [407.4, 209.4, 7.7],
  [478.8, 266.1, 7.7],
  [210, 321.8, 15.3],
  [295.6, 362.6, 19.4],
  [372.9, 362.6, 10.7],
];
/** Navy bubbles inside the wave */
export const LOGO_HOLES: [number, number, number][] = [
  [484.7, 381.1, 4.5],
  [463.3, 413.2, 7.8],
  [449.4, 443.8, 12.9],
  [414, 437.2, 5.3],
];
export const LOGO_VIEWBOX = '132 110 520 520';

interface Props {
  size?: number | string;
  /** Draw the navy rounded tile behind the mark. */
  tile?: boolean;
  animated?: boolean;
  className?: string;
  title?: string;
}

export function Logo({ size = 28, tile = true, animated = false, className, title = 'VectoWave' }: Props) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      width={size}
      height={size}
      className={[animated ? 'vw-logo-anim' : '', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={title}
    >
      {tile && <rect x={132} y={110} width={520} height={520} rx={118} fill={BRAND.navy} />}
      <g className="vw-wave">
        <path className="vw-body" d={LOGO_BODY} fill={BRAND.lime} />
        <path className="vw-curl" d={LOGO_CURL} fill={BRAND.lime} />
        {LOGO_HOLES.map(([cx, cy, r], i) => (
          <circle key={`h${i}`} className="vw-hole" style={{ animationDelay: `${i * 0.45}s` }} cx={cx} cy={cy} r={r} fill={BRAND.navy} />
        ))}
      </g>
      {LOGO_BUBBLES.map(([cx, cy, r], i) => (
        <circle key={`b${i}`} className="vw-bubble" style={{ animationDelay: `${(i * 0.37) % 1.8}s` }} cx={cx} cy={cy} r={r} fill={BRAND.lime} />
      ))}
    </svg>
  );
}

/** SVG markup for favicons / data URIs. */
export function logoSvgString(tile = true) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}">${
    tile ? `<rect x="132" y="110" width="520" height="520" rx="118" fill="${BRAND.navy}"/>` : ''
  }<path d="${LOGO_BODY}" fill="${BRAND.lime}"/><path d="${LOGO_CURL}" fill="${BRAND.lime}"/>${LOGO_HOLES.map(
    ([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${BRAND.navy}"/>`,
  ).join('')}${LOGO_BUBBLES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${BRAND.lime}"/>`).join('')}</svg>`;
}
