import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Db } from "../core/data";
import { fmt } from "../core/solver";

export interface ImportNodeData extends Record<string, unknown> {
  db: Db;
  item: string;
  perMinute: number;
  /** site it is belted from, or undefined for "arrives from outside the plan" */
  fromName?: string;
  /** how much of it nothing on the canvas takes */
  unused: number;
  /** no machine here consumes this at all */
  orphan: boolean;
  onOpen?: () => void;
}

/**
 * Where material enters the site by belt or train.
 *
 * The mirror of OutputNode, and derived the same way: the record lives in
 * `site.imports`, this is only its picture. Without it an imported item has no source
 * on the canvas, so machines living entirely on imports drew no edges at all and their
 * ports read as unfed while the balance said they were fine.
 */
export function ImportNodeView({ data, selected }: NodeProps & { data: ImportNodeData }) {
  const { db, item, perMinute, fromName, unused, orphan, onOpen } = data;
  const idle = orphan || unused > 0;

  return (
    <div className={`node node--input ${idle ? "node--input-idle" : ""} ${selected ? "node--selected" : ""}`}>
      <header className="node__head">
        <div>
          <div className="node__title">{db.itemName(item)}</div>
          <div className="node__machine">
            {fromName ? (
              <button className="node__link" onClick={onOpen} title={`Open ${fromName}`}>
                ← {fromName}
              </button>
            ) : (
              "arrives from outside"
            )}
          </div>
        </div>
      </header>

      <div className="node__out">
        <span className="node__outrate">{fmt(perMinute)}</span>
        <span className="muted">/min</span>
      </div>

      {orphan ? (
        <footer className="node__foot node__foot--bad">nothing here takes this</footer>
      ) : unused > 0 ? (
        <footer className="node__foot node__foot--bad">{fmt(unused)}/min unused</footer>
      ) : (
        <footer className="node__foot node__foot--ok">all used</footer>
      )}
      <Handle type="source" position={Position.Right} id={`out-${item}`} />
    </div>
  );
}
