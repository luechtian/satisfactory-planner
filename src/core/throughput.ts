/**
 * What one belt or pipe can physically carry.
 *
 * The solver happily calls for 1800 Iron Ore a minute down one arrow; the game caps a
 * Mk.6 belt at 1200. Nothing else in the planner knows that a line has a limit, so a
 * plan can be perfectly balanced and still unbuildable.
 *
 * The tiers are hardcoded rather than extracted. `scripts/extract_docs.py` keeps only
 * manufacturers and extractors, so belts and pipes are not in `data.json` at all, and
 * adding them cannot be verified without a game install to regenerate against. These
 * eight numbers are stable across patches and easy to check by eye — but they are the
 * one piece of game data here that did not come from the game.
 */

import type { Db } from "./data";
import type { RouteEdge } from "./routing";
import { DISPLAY_EPS } from "./solver";

export interface Tier {
  name: string;
  /** items per minute for a belt, m³ per minute for a pipe */
  rate: number;
}

export const BELTS: Tier[] = [
  { name: "Mk.1", rate: 60 },
  { name: "Mk.2", rate: 120 },
  { name: "Mk.3", rate: 270 },
  { name: "Mk.4", rate: 480 },
  { name: "Mk.5", rate: 780 },
  { name: "Mk.6", rate: 1200 },
];

export const PIPES: Tier[] = [
  { name: "Mk.1", rate: 300 },
  { name: "Mk.2", rate: 600 },
];

export interface Capacity {
  /** items/min one belt carries */
  belt: number;
  /** m³/min one pipe carries */
  pipe: number;
}

/** What the planner assumes until told otherwise: mid-game belts, best pipes. */
export const DEFAULT_CAPACITY: Capacity = { belt: 780, pipe: 600 };

/**
 * Which limit applies to an item. Solids ride belts; liquids and gases go down pipes,
 * and both are measured in m³/min — a gas checked against a belt limit would read as
 * fine at any rate at all.
 */
export const limitFor = (db: Db, item: string, cap: Capacity) =>
  db.items[item]?.form === "solid" ? cap.belt : cap.pipe;

/**
 * How many parallel lines a rate needs. One or fewer means it fits.
 *
 * Whole lines, because half a belt is not a thing you can build — the same reasoning
 * that makes the solver count whole buildings.
 */
export function linesFor(db: Db, item: string, rate: number, cap: Capacity): number {
  const limit = limitFor(db, item, cap);
  if (!(limit > 0) || rate <= DISPLAY_EPS) return 0;
  return Math.ceil(rate / limit - DISPLAY_EPS / limit);
}

export interface OverCapacity {
  edge: RouteEdge;
  /** lines the rate needs */
  lines: number;
  /** what one line of this kind carries */
  limit: number;
}

/**
 * Every arrow carrying more than one line can.
 *
 * Each arm of a manifold is checked on its own, because each is a separate line into or
 * out of the pool; the pool's total is not a line and is not checked. Sorted worst
 * first, since the arrow needing four lines is the one that changes your build.
 */
export function overCapacity(
  db: Db,
  edges: readonly RouteEdge[],
  cap: Capacity,
): OverCapacity[] {
  return edges
    .map((edge) => ({
      edge,
      lines: linesFor(db, edge.item, edge.rate, cap),
      limit: limitFor(db, edge.item, cap),
    }))
    .filter((o) => o.lines > 1)
    .sort((a, b) => b.lines - a.lines || b.edge.rate - a.edge.rate);
}
