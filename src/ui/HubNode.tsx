import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Db } from "../core/data";
import { DISPLAY_EPS, fmt } from "../core/solver";

export interface HubNodeData extends Record<string, unknown> {
  db: Db;
  item: string;
  /** everything produced into the manifold */
  supply: number;
  /** everything drawn out of it */
  demand: number;
}

/**
 * A manifold for one item.
 *
 * When several buildings make something and several take it, there is no fact of the
 * matter about which feeds which — the plan records rates, not belts. Pairing them off
 * invents a topology and produces edges carrying oddly-scaled fractions. In-game you
 * would run the lot into a bus anyway, so that is what gets drawn: every producer puts
 * its full output in, every consumer draws its full input out, and the difference is
 * stated here rather than smeared across the arrows.
 */
export function HubNodeView({ data }: NodeProps & { data: HubNodeData }) {
  const { db, item, supply, demand } = data;
  const net = supply - demand;
  const short = net < -DISPLAY_EPS;
  const spare = net > DISPLAY_EPS;

  return (
    <div className={`hub ${short ? "hub--short" : ""}`}>
      <Handle type="target" position={Position.Left} id={`in-${item}`} />
      <div className="hub__name">{db.itemName(item)}</div>
      <div className="hub__flow">
        <span>{fmt(supply)}</span>
        <span className="hub__arrow">→</span>
        <span>{fmt(demand)}</span>
      </div>
      {(short || spare) && (
        <div className={`hub__net ${short ? "neg" : "pos"}`}>
          {short ? `short ${fmt(-net)}` : `+${fmt(net)} spare`}
        </div>
      )}
      <Handle type="source" position={Position.Right} id={`out-${item}`} />
    </div>
  );
}
