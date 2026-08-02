import { Handle, Position, type NodeProps } from "@xyflow/react";
import { extractorRate, hasPurity, resourcesFor, type Db } from "../core/data";
import { fmt } from "../core/solver";
import { PURITY_MULTIPLIER, type ExtractorNode as ExtractorNodeData, type NodeResult, type Purity } from "../core/types";

export interface ExtractorNodeProps extends Record<string, unknown> {
  db: Db;
  node: ExtractorNodeData;
  result?: NodeResult;
  /** true when nothing on the canvas takes what this pulls out of the ground */
  loose: boolean;
  onChange: (patch: Partial<ExtractorNodeData>) => void;
  onRemove: () => void;
}

const PURITIES: Purity[] = ["impure", "normal", "pure"];

export function ExtractorNodeView({ data, selected }: NodeProps & { data: ExtractorNodeProps }) {
  const { db, node, result, loose, onChange, onRemove } = data;
  const building = db.buildings[node.building];
  const options = resourcesFor(db, node.building);
  const perMachine = extractorRate(db, node);
  const output = result?.outputs[0]?.perMinute ?? 0;

  return (
    <div
      className={`node node--extractor ${selected ? "node--selected" : ""} ${node.count <= 0 ? "node--off" : ""}`}
    >
      <header className="node__head">
        <div>
          <div className="node__title">{db.itemName(node.resource)}</div>
          <div className="node__machine">{building?.name}</div>
        </div>
        <button className="node__x" onClick={onRemove} title="Remove">×</button>
      </header>

      <div className="node__controls nodrag">
        <label>
          Machines
          {/* Whole buildings only — a part-machine is expressed as a lower clock. */}
          <input
            type="number" min={0} step={1} value={node.count}
            onChange={(e) => onChange({ count: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
          />
        </label>
        <label>
          Clock %
          <input
            type="number" min={1} max={250} step={5} value={round(node.clock)}
            onChange={(e) => onChange({ clock: clamp(Number(e.target.value) || 100, 1, 250) })}
          />
        </label>
      </div>

      <div className="node__controls nodrag">
        <label>
          Resource
          <select value={node.resource} onChange={(e) => onChange({ resource: e.target.value })}>
            {options.map((i) => <option key={i.class} value={i.class}>{i.name}</option>)}
          </select>
        </label>
        {hasPurity(node.building) ? (
          <label>
            Node purity
            <select
              value={node.purity}
              onChange={(e) => onChange({ purity: e.target.value as Purity })}
            >
              {PURITIES.map((p) => (
                <option key={p} value={p}>
                  {p} ×{PURITY_MULTIPLIER[p]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Node purity
            <span className="node__na">n/a</span>
          </label>
        )}
      </div>

      <div className="node__ports">
        <div className="node__rate">{fmt(perMachine)}/min each</div>
        <ul className="ports ports--out">
          <li className={loose ? "port port--loose" : "port"}>
            <span className="port__rate">{fmt(output)}</span>
            <span className="port__name">{db.itemName(node.resource)}</span>
            <Handle type="source" position={Position.Right} id={`out-${node.resource}`} />
          </li>
        </ul>
      </div>

      <footer className="node__foot">{fmt(result?.powerMW ?? 0, 1)} MW</footer>
    </div>
  );
}

const round = (v: number) => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
