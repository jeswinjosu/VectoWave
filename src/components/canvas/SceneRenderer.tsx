import { memo } from 'react';
import type { DocumentModel, PathNode } from '../../types/model';
import type { EvalMap } from '../../lib/animation';
import { localMatrix } from '../../lib/animation';
import { matToString } from '../../lib/math';
import { pathString } from '../../lib/path';

interface Props {
  doc: DocumentModel;
  evals: EvalMap;
  /** Adds data-node-id + transparent hit areas for thin/unfilled paths. */
  interactive?: boolean;
  zoom?: number;
}

/** Renders the scene graph as live SVG using evaluated (animated) values. */
export const SceneRenderer = memo(function SceneRenderer({ doc, evals, interactive = true, zoom = 1 }: Props) {
  const render = (id: string): JSX.Element | null => {
    const n = doc.nodes[id];
    const e = evals[id];
    if (!n || !e || !n.visible) return null;
    const transform = matToString(localMatrix(n, e));
    if (n.type === 'group') {
      return (
        <g key={id} transform={transform} opacity={e.opacity} data-node-id={interactive ? id : undefined}>
          {n.children.map(render)}
        </g>
      );
    }
    const p = n as PathNode;
    const d = pathString(e.geometry ?? p.geometry);
    const thin = e.fill === 'none' || e.strokeWidth * zoom < 6;
    return (
      <g key={id} transform={transform} opacity={e.opacity}>
        <path
          d={d}
          data-node-id={interactive ? id : undefined}
          fill={e.fill}
          fillOpacity={p.fillOpacity}
          fillRule={p.fillRule}
          stroke={e.stroke}
          strokeOpacity={p.strokeOpacity}
          strokeWidth={e.strokeWidth}
          strokeLinecap={p.lineCap}
          strokeLinejoin={p.lineJoin}
        />
        {interactive && thin && (
          <path d={d} data-node-id={id} fill="none" stroke="transparent" strokeWidth={10 / zoom} pointerEvents="stroke" />
        )}
      </g>
    );
  };
  return <>{doc.rootIds.map(render)}</>;
});
