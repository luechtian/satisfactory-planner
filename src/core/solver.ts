import { powerFor, type Db } from "./data";
import type {
  ItemBalance, NodeResult, PlanNode, Recipe, Site, SiteResult,
} from "./types";

const EPS = 1e-6;

/** count * clock/100 — how many 100%-machines a node is worth. */
export const effectiveOf = (n: PlanNode) => n.count * (n.clock / 100);

/* -------------------------------------------------------------- forward */

/**
 * Forward pass: given machine counts, work out every rate and the site balance.
 * This is the direct replacement for the hand-written `Bilanz` formulas.
 */
export function evaluateSite(db: Db, site: Site): SiteResult {
  const nodes: NodeResult[] = [];
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  for (const n of site.nodes) {
    const recipe = db.recipeByClass[n.recipe];
    if (!recipe) continue;
    const eff = effectiveOf(n);

    const scale = (ports: Recipe["ingredients"], sink: Record<string, number>) =>
      ports.map((p) => {
        const perMinute = p.perMinute * eff;
        sink[p.item] = (sink[p.item] ?? 0) + perMinute;
        return { ...p, perMinute };
      });

    nodes.push({
      nodeId: n.id,
      effective: eff,
      inputs: scale(recipe.ingredients, consumed),
      outputs: scale(recipe.products, produced),
      powerMW: powerFor(db, recipe, n.count, n.clock),
    });
  }

  const imported: Record<string, number> = {};
  for (const f of site.imports) imported[f.item] = (imported[f.item] ?? 0) + f.perMinute;
  const targeted: Record<string, number> = {};
  for (const f of site.targets) targeted[f.item] = (targeted[f.item] ?? 0) + f.perMinute;

  const keys = new Set([
    ...Object.keys(produced), ...Object.keys(consumed),
    ...Object.keys(imported), ...Object.keys(targeted),
  ]);

  const balances: ItemBalance[] = [...keys]
    .map((item) => {
      const p = produced[item] ?? 0, c = consumed[item] ?? 0;
      const i = imported[item] ?? 0, t = targeted[item] ?? 0;
      return { item, produced: p, consumed: c, imported: i, target: t, net: p + i - c - t };
    })
    .sort((a, b) => a.net - b.net || db.itemName(a.item).localeCompare(db.itemName(b.item)));

  return {
    nodes,
    balances,
    // Short raw resources are the ones that need miners, wells or a belt from outside;
    // short intermediates just need more machines, and show up under shortages instead.
    // Water counts here even though Aluminum Scrap hands some back.
    rawInputs: balances.filter((b) => b.net < -EPS && db.items[b.item]?.isRawResource),
    totalPowerMW: nodes.reduce((s, n) => s + n.powerMW, 0),
  };
}

/* ------------------------------------------------------------- backward */

export interface SolveResult {
  /** node id -> new machine count */
  counts: Record<string, number>;
  /** nodes the solver had to invent because nothing on the canvas made the item */
  added: PlanNode[];
  /** items nothing can produce — raw ores, or a missing recipe */
  feeds: Array<{ item: string; perMinute: number }>;
  /** true if the chain failed to settle, e.g. a recipe loop that never closes */
  diverged: boolean;
}

export interface SolveOptions {
  /** prefer these recipes for these items, overriding what is on the canvas */
  recipeChoice?: Record<string, string>;
  /** treat these as freely available even though a recipe exists (e.g. bussed in) */
  treatAsRaw?: string[];
}

/**
 * Backward pass: scale the chain until it meets `site.targets`.
 *
 * Rates only ever increase, which keeps the fixed point reachable, and lets
 * byproducts pay for downstream demand — the water that Aluminum Scrap gives
 * back correctly reduces the Water Extractors needed by Alumina Solution.
 */
export function solveSite(db: Db, site: Site, opts: SolveOptions = {}): SolveResult {
  // Only a recipe's primary product makes it "the way to get" that item. Byproducts
  // are credited in the balance but never justify scaling a machine up.
  const chosen: Record<string, string> = {};
  for (const n of site.nodes) {
    const r = db.recipeByClass[n.recipe];
    const primary = r?.products[0]?.item;
    if (primary) chosen[primary] ??= r.class;
  }
  Object.assign(chosen, opts.recipeChoice ?? {});

  const available = new Set(opts.treatAsRaw ?? []);
  for (const f of site.imports) available.add(f.item);
  for (const [cls, it] of Object.entries(db.items)) if (it.isRawResource) available.add(cls);

  const demand: Record<string, number> = {};
  for (const f of site.targets) demand[f.item] = (demand[f.item] ?? 0) + f.perMinute;

  const rates: Record<string, number> = {};
  const rateOf = (rc: string) => rates[rc] ?? 0;
  const outPerMin = (rc: string, item: string) =>
    db.recipeByClass[rc]?.products.find((p) => p.item === item)?.perMinute ?? 0;

  let diverged = true;
  for (let iter = 0; iter < 300; iter++) {
    const produced: Record<string, number> = {};
    const consumed: Record<string, number> = {};
    for (const [rc, x] of Object.entries(rates)) {
      const r = db.recipeByClass[rc];
      if (!r || x <= 0) continue;
      for (const p of r.products) produced[p.item] = (produced[p.item] ?? 0) + p.perMinute * x;
      for (const i of r.ingredients) consumed[i.item] = (consumed[i.item] ?? 0) + i.perMinute * x;
    }

    let changed = false;
    const wanted = new Set([...Object.keys(demand), ...Object.keys(consumed)]);
    for (const item of wanted) {
      if (available.has(item)) continue;
      const rc = chosen[item] ?? db.producersOf[item]?.[0]?.class;
      if (!rc) continue; // nothing makes it; falls out as a required feed below

      const need = (demand[item] ?? 0) + (consumed[item] ?? 0);
      const have = produced[item] ?? 0;
      if (have >= need - EPS) continue;

      const per = outPerMin(rc, item);
      if (per <= 0) continue;
      // Other recipes may already yield this item as a byproduct; only cover the rest.
      const fromElsewhere = have - rateOf(rc) * per;
      const target = (need - fromElsewhere) / per;
      if (target > rateOf(rc) + EPS) {
        rates[rc] = target;
        chosen[item] ??= rc;
        changed = true;
      }
    }
    if (!changed) {
      diverged = false;
      break;
    }
  }

  // The pass above discovers *which* recipes the chain needs, but because rates only
  // ever climb it overshoots: Silica gets locked in before Alumina Solution's byproduct
  // credit shows up. Now that the recipe set is known the system is square — one chosen
  // recipe per item — so solve it exactly and let byproducts and loops net out.
  const exact = solveExact(db, rates, chosen, available, demand);
  if (exact) Object.assign(rates, exact);

  // Distribute solved rates back onto nodes, keeping each node's clock setting.
  const nodesByRecipe: Record<string, PlanNode[]> = {};
  for (const n of site.nodes) (nodesByRecipe[n.recipe] ??= []).push(n);

  const counts: Record<string, number> = {};
  const added: PlanNode[] = [];
  let lane = 0;

  for (const [rc, rate] of Object.entries(rates)) {
    const existing = nodesByRecipe[rc];
    if (existing?.length) {
      // Split across duplicates in their current proportion, evenly if all are zero.
      const total = existing.reduce((s, n) => s + n.count, 0);
      for (const n of existing) {
        const share = total > EPS ? n.count / total : 1 / existing.length;
        counts[n.id] = round4((rate * share) / (n.clock / 100));
      }
    } else {
      added.push({
        id: `n${Date.now().toString(36)}${lane}`,
        recipe: rc,
        count: round4(rate),
        clock: 100,
        position: { x: 40 + (lane % 4) * 300, y: 40 + Math.floor(lane / 4) * 220 },
      });
      lane++;
    }
  }
  // Recipes on the canvas the targets don't need at all go to zero.
  for (const n of site.nodes) counts[n.id] ??= 0;

  // Re-run the forward pass over the solved plan to report what must be fed in.
  const solved: Site = {
    ...site,
    nodes: [...site.nodes.map((n) => ({ ...n, count: counts[n.id] ?? n.count })), ...added],
  };
  const feeds = evaluateSite(db, solved)
    .balances.filter((b) => b.net < -EPS)
    .map((b) => ({ item: b.item, perMinute: -b.net }));

  return { counts, added, feeds, diverged };
}

/**
 * Exact solve of the discovered chain. Variables are the recipes in `rates`; each is
 * the chosen producer of exactly one item, so there is one equation per variable:
 *
 *     sum_over_recipes( net rate of item i in recipe j ) * x_j  =  external demand for i
 *
 * Byproducts appear as positive coefficients and loops as off-diagonal terms, so both
 * fall out of the solve rather than needing special cases. Returns null and leaves the
 * conservative iterative answer in place if the system is singular or goes negative.
 */
function solveExact(
  db: Db,
  rates: Record<string, number>,
  chosen: Record<string, string>,
  available: Set<string>,
  demand: Record<string, number>,
): Record<string, number> | null {
  const recipeList = Object.keys(rates).filter((rc) => rates[rc] > EPS);
  if (!recipeList.length) return null;

  // Equation order must match variable order: item -> its chosen recipe.
  const primaryOf: Record<string, string> = {};
  for (const [item, rc] of Object.entries(chosen)) {
    if (rates[rc] > EPS && db.recipeByClass[rc]?.products[0]?.item === item) primaryOf[rc] = item;
  }
  const items = recipeList.map((rc) => primaryOf[rc]);
  if (items.some((i) => !i || available.has(i))) return null;

  const n = recipeList.length;
  const col = Object.fromEntries(recipeList.map((rc, j) => [rc, j]));
  const row = Object.fromEntries(items.map((it, i) => [it, i]));

  // Augmented matrix [A | d].
  const m: number[][] = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const rc of recipeList) {
    const r = db.recipeByClass[rc];
    const j = col[rc];
    for (const p of r.products) if (row[p.item] !== undefined) m[row[p.item]][j] += p.perMinute;
    for (const g of r.ingredients) if (row[g.item] !== undefined) m[row[g.item]][j] -= g.perMinute;
  }
  for (const [item, d] of Object.entries(demand)) if (row[item] !== undefined) m[row[item]][n] = d;

  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-9) return null; // singular
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }

  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const x = m[i][n] / m[i][i];
    if (!Number.isFinite(x) || x < -EPS) return null; // a negative machine count is nonsense
    out[recipeList[i]] = Math.max(0, x);
  }
  return out;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Trailing zeros make a balance table much harder to scan. */
export function fmt(v: number, digits = 2): string {
  if (Math.abs(v) < 1e-9) return "0";
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, "");
}
