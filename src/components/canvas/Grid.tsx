import type { View } from '../../store/editor';

/** Adaptive two-level grid in screen space; spacing snaps to 1/5/10/50… artboard units. */
export function Grid({ view }: { view: View }) {
  let unit = 10;
  while (unit * view.zoom < 12) unit *= 5;
  while (unit * view.zoom > 80) unit /= 5;
  const minor = unit * view.zoom;
  const major = minor * 5;
  const ox = ((view.x % major) + major) % major;
  const oy = ((view.y % major) + major) % major;
  return (
    <>
      <defs>
        <pattern id="vm-grid-minor" width={minor} height={minor} patternUnits="userSpaceOnUse">
          <path d={`M ${minor} 0 L 0 0 0 ${minor}`} fill="none" className="stroke-line/40" strokeWidth={1} />
        </pattern>
        <pattern id="vm-grid-major" width={major} height={major} patternUnits="userSpaceOnUse" x={ox} y={oy}>
          <rect width={major} height={major} fill="url(#vm-grid-minor)" />
          <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" className="stroke-line/80" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#vm-grid-major)" pointerEvents="none" />
    </>
  );
}
