import type { Db } from "./data";
import { isExtractor } from "./types";
import type { PlanNode, Site } from "./types";

// Wide enough that a manifold node fits in the gap between columns.
const COL_W = 460;
const ROW_H = 250;

const label = (db: Db, n: PlanNode) =>
  isExtractor(n) ? db.itemName(n.resource) : (db.recipeByClass[n.recipe]?.name ?? "");

/**
 * Layered left-to-right layout: raw-fed machines on the left, final product on the
 * right, one column per production depth.
 *
 * Depth is the longest path from an input-fed node. Satisfactory chains contain real
 * cycles (Alumina Solution drinks water that Aluminum Scrap gives back), so the walk
 * carries an in-progress set and treats a back edge as depth 0 rather than recursing.
 */
export function layoutSite(db: Db, site: Site): Record<string, { x: number; y: number }> {
  const producersOf = new Map<string, string[]>();
  const add = (item: string, id: string) => {
    const list = producersOf.get(item);
    if (list) list.push(id);
    else producersOf.set(item, [id]);
  };
  for (const n of site.nodes) {
    if (isExtractor(n)) {
      add(n.resource, n.id);
      continue;
    }
    for (const p of db.recipeByClass[n.recipe]?.products ?? []) add(p.item, n.id);
  }

  const byId = new Map(site.nodes.map((n) => [n.id, n]));
  const feeders = (id: string): string[] => {
    const n = byId.get(id)!;
    if (isExtractor(n)) return []; // extraction is where the chain starts
    const r = db.recipeByClass[n.recipe];
    if (!r) return [];
    const out = new Set<string>();
    for (const g of r.ingredients) {
      for (const src of producersOf.get(g.item) ?? []) if (src !== id) out.add(src);
    }
    return [...out];
  };

  const depth = new Map<string, number>();
  const active = new Set<string>();
  const depthOf = (id: string): number => {
    const seen = depth.get(id);
    if (seen !== undefined) return seen;
    if (active.has(id)) return 0; // back edge in a byproduct loop
    active.add(id);
    const d = feeders(id).reduce((max, f) => Math.max(max, depthOf(f) + 1), 0);
    active.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of site.nodes) depthOf(n.id);

  const columns = new Map<number, PlanNode[]>();
  for (const n of site.nodes) {
    const d = depth.get(n.id) ?? 0;
    const col = columns.get(d);
    if (col) col.push(n);
    else columns.set(d, [n]);
  }

  // Imported material is drawn in a column of its own to the left, so machines start
  // one column in rather than at the origin where those nodes would end up off-view.
  const originX = 60 + (site.imports.length ? COL_W : 0);

  const positions: Record<string, { x: number; y: number }> = {};
  const tallest = Math.max(...[...columns.values()].map((c) => c.length), 1);
  for (const [d, col] of columns) {
    // Centre short columns against the tallest one so the graph reads as a spine.
    const offset = ((tallest - col.length) * ROW_H) / 2;
    col.sort((a, b) => label(db, a).localeCompare(label(db, b)));
    col.forEach((n, i) => {
      positions[n.id] = { x: originX + d * COL_W, y: 60 + offset + i * ROW_H };
    });
  }
  return positions;
}
