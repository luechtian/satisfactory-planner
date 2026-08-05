import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Db } from "../core/data";
import { fmt } from "../core/solver";

export interface OutputNodeData extends Record<string, unknown> {
  db: Db;
  item: string;
  perMinute: number;
  /** site name this is belted to, or undefined for "leaves the plan" */
  toName?: string;
  /** how much of it the site is short, 0 when covered */
  short: number;
  /** nothing on the canvas makes this item at all */
  orphan: boolean;
  onOpen?: () => void;
}

/**
 * Where material leaves the site — a target shipped out of the plan, or an export
 * claimed by another site.
 *
 * Never stored. Targets live in `site.targets` and exports are derived from the
 * consuming site's import, so these are rebuilt from the plan on every render. That
 * keeps one record per link; a stored node would be a second copy to keep in sync.
 */
export function OutputNodeView({ data, selected }: NodeProps & { data: OutputNodeData }) {
  const { db, item, perMinute, toName, short, orphan, onOpen } = data;
  const bad = short > 0 || orphan;

  return (
    <div className={`node node--output ${bad ? "node--output-short" : ""} ${selected ? "node--selected" : ""}`}>
      <Handle type="target" position={Position.Left} id={`in-${item}`} />
      <header className="node__head">
        <div>
          <div className="node__title">{db.itemName(item)}</div>
          <div className="node__building">
            {toName ? (
              <button className="node__link" onClick={onOpen} title={`Open ${toName}`}>
                → {toName}
              </button>
            ) : (
              "ships out of the plan"
            )}
          </div>
        </div>
      </header>

      <div className="node__out">
        <span className="node__outrate">{fmt(perMinute)}</span>
        <span className="muted">/min</span>
      </div>

      {orphan ? (
        <footer className="node__foot node__foot--bad">nothing here makes this</footer>
      ) : short > 0 ? (
        <footer className="node__foot node__foot--bad">short {fmt(short)}/min</footer>
      ) : (
        <footer className="node__foot node__foot--ok">covered</footer>
      )}
    </div>
  );
}
