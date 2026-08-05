import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Db } from "../core/data";
import { fmt } from "../core/solver";
import type { ManufacturerNode, NodeResult } from "../core/types";

export interface RecipeNodeData extends Record<string, unknown> {
  db: Db;
  node: ManufacturerNode;
  result?: NodeResult;
  /** items this node emits that nothing downstream takes, and inputs nothing feeds */
  loose: { inputs: Set<string>; outputs: Set<string> };
  onChange: (patch: Partial<ManufacturerNode>) => void;
  onRemove: () => void;
}

export function RecipeNode({ data, selected }: NodeProps & { data: RecipeNodeData }) {
  const { db, node, result, loose, onChange, onRemove } = data;
  const recipe = db.recipeByClass[node.recipe];
  if (!recipe) return <div className="node node--error">unknown recipe {node.recipe}</div>;

  const building = db.buildings[recipe.building];
  const rate = (item: string, ports: typeof recipe.ingredients) =>
    ports.find((p) => p.item === item)?.perMinute ?? 0;

  return (
    <div className={`node ${selected ? "node--selected" : ""} ${node.count <= 0 ? "node--off" : ""}`}>
      <header className="node__head">
        <div>
          <div className="node__title">{recipe.name}</div>
          <div className="node__building">
            {building?.name}
            {recipe.alternate && <span className="tag tag--alt">ALT</span>}
          </div>
        </div>
        <button className="node__x" onClick={onRemove} title="Remove">×</button>
      </header>

      <div className="node__controls nodrag">
        <label>
          Buildings
          {/* Whole buildings only — a part-building is expressed as a lower clock. */}
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

      <div className="node__ports">
        <ul className="ports ports--in">
          {recipe.ingredients.map((p) => (
            <li key={p.item} className={loose.inputs.has(p.item) ? "port port--loose" : "port"}>
              <Handle type="target" position={Position.Left} id={`in-${p.item}`} />
              <span className="port__name">{db.itemName(p.item)}</span>
              <span className="port__rate">{fmt(rate(p.item, result?.inputs ?? []))}</span>
            </li>
          ))}
          {!recipe.ingredients.length && <li className="port port--none">no inputs</li>}
        </ul>
        <ul className="ports ports--out">
          {recipe.products.map((p, i) => (
            <li key={p.item} className={loose.outputs.has(p.item) ? "port port--loose" : "port"}>
              <span className="port__rate">{fmt(rate(p.item, result?.outputs ?? []))}</span>
              <span className="port__name">
                {db.itemName(p.item)}
                {i > 0 && <span className="tag tag--by">by</span>}
              </span>
              <Handle type="source" position={Position.Right} id={`out-${p.item}`} />
            </li>
          ))}
        </ul>
      </div>

      <footer className="node__foot">{fmt(result?.powerMW ?? 0, 1)} MW</footer>
    </div>
  );
}

const round = (v: number) => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
