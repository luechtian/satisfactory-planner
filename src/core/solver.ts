import {
  defaultExtractorFor, extractorPower, extractorRate, extractorRateFor, powerFor, type Db,
} from "./data";
import { isExtractor } from "./types";
import type {
  ExtractorNode, ItemBalance, NodeResult, PlanNode, Purity, Recipe, Site, SiteResult,
} from "./types";

const EPS = 1e-6;

/**
 * Threshold for calling a balance short or spare. Deliberately looser than EPS: whole
 * buildings mean clocks land on 4 decimals, so rates carry a ten-thousandth of leftover
 * that is neither real nor actionable. Anything under a thousandth of an item per
 * minute is noise.
 */
export const DISPLAY_EPS = 1e-3;

/** count * clock/100 — how many 100%-buildings a node is worth. */
export const effectiveOf = (n: PlanNode) => n.count * (n.clock / 100);

/* -------------------------------------------------------------- forward */

/**
 * Forward pass: given building counts, work out every rate and the site balance.
 * This is the direct replacement for the hand-written `Bilanz` formulas.
 */
export function evaluateSite(
  db: Db,
  site: Site,
  /**
   * Demand from outside the site's own machinery — normally just what other sites
   * import from here, which are obligations and so count against the balance.
   *
   * Composed by the caller rather than read off the site, because the two callers want
   * different things: the panel judges a site on what it owes, while `solveSite` folds
   * the site's own targets in here so it can still tell you when nothing can make one.
   */
  demand: ReadonlyArray<{ item: string; perMinute: number }> = [],
): SiteResult {
  const nodes: NodeResult[] = [];
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  for (const n of site.nodes) {
    const eff = effectiveOf(n);

    if (isExtractor(n)) {
      const perMinute = extractorRate(db, n) * eff;
      produced[n.resource] = (produced[n.resource] ?? 0) + perMinute;
      nodes.push({
        nodeId: n.id,
        effective: eff,
        inputs: [],
        outputs: [{ item: n.resource, amount: perMinute, perMinute }],
        powerMW: extractorPower(db, n),
      });
      continue;
    }

    const recipe = db.recipeByClass[n.recipe];
    if (!recipe) continue;

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
  const committed: Record<string, number> = {};
  for (const f of demand) committed[f.item] = (committed[f.item] ?? 0) + f.perMinute;

  const keys = new Set([
    ...Object.keys(produced), ...Object.keys(consumed),
    ...Object.keys(imported), ...Object.keys(committed),
  ]);

  const balances: ItemBalance[] = [...keys]
    .map((item) => {
      const p = produced[item] ?? 0, c = consumed[item] ?? 0;
      const i = imported[item] ?? 0, t = committed[item] ?? 0;
      return { item, produced: p, consumed: c, imported: i, committed: t, net: p + i - c - t };
    })
    .sort((a, b) => a.net - b.net || db.itemName(a.item).localeCompare(db.itemName(b.item)));

  return {
    nodes,
    balances,
    // Every raw the site touches, whether or not supply covers it — the panel needs the
    // satisfied ones too so their declared rate stays visible and editable.
    // Sorted by name, not by net: these rows carry text inputs, and net-ordering makes
    // a row jump down the table the moment you finish typing a supply into it.
    raws: balances
      .filter(
        (b) =>
          db.items[b.item]?.isRawResource &&
          (b.consumed > EPS || b.imported > EPS || b.committed > EPS),
      )
      .sort((a, b) => db.itemName(a.item).localeCompare(db.itemName(b.item))),
    totalPowerMW: nodes.reduce((s, n) => s + n.powerMW, 0),
  };
}

/**
 * Which nodes on this canvas take an item in, and which put it out.
 *
 * A site-level balance says an item is short or spare but not who goes without or where
 * it is piling up, which is the next thing you want to know and the one thing the number
 * itself cannot tell you.
 *
 * Named for nodes rather than producers and consumers because `Db.producersOf` and
 * `Db.consumersOf` already mean something else and adjacent — the *recipes* that could
 * make or take an item, rather than the buildings on this site that do.
 */
export const nodesTaking = (result: SiteResult, item: string) => ranked(result, item, "inputs");
export const nodesMaking = (result: SiteResult, item: string) => ranked(result, item, "outputs");

/** Biggest first, so the building most responsible is the one you land on. */
function ranked(result: SiteResult, item: string, side: "inputs" | "outputs"): string[] {
  return result.nodes
    .map((n) => ({
      id: n.nodeId,
      rate: n[side].find((p) => p.item === item)?.perMinute ?? 0,
    }))
    .filter((n) => n.rate > DISPLAY_EPS)
    .sort((a, b) => b.rate - a.rate)
    .map((n) => n.id);
}

/* ------------------------------------------------------------- backward */

export interface SolveResult {
  /** node id -> new building count, always a whole number */
  counts: Record<string, number>;
  /** node id -> clock that makes those whole buildings hit the required rate */
  clocks: Record<string, number>;
  /** nodes the solver had to invent because nothing on the canvas made the item */
  added: PlanNode[];
  /** items nothing can produce — raw ores, or a missing recipe */
  feeds: Array<{ item: string; perMinute: number }>;
  /**
   * Every step the solve actually runs, item and the recipe making it.
   *
   * The iterative pass already discovers this on the way to an answer; handing it back
   * is what lets a caller offer the choice of recipe for each step without re-deriving
   * the chain, or guessing at it from whatever happens to be on the canvas.
   */
  chain: Array<{ item: string; recipe: string }>;
  /** true if the chain failed to settle, e.g. a recipe loop that never closes */
  diverged: boolean;
}

export interface SolveOptions {
  /** prefer these recipes for these items, overriding what is on the canvas */
  recipeChoice?: Record<string, string>;
  /** treat these as freely available even though a recipe exists (e.g. bussed in) */
  treatAsRaw?: string[];
  /** place miners and pumps for uncovered raws; on by default */
  autoExtractors?: boolean;
  /** rates other sites draw from this one — solved for exactly like a target */
  exports?: ReadonlyArray<{ item: string; perMinute: number }>;
  /** underclock nodes so output lands exactly on demand instead of overshooting */
  trimClocks?: boolean;
}

/**
 * What an auto-placed extractor assumes. A normal-purity node is the honest middle
 * guess, and Mk3 matches how new building nodes default to clock 100 rather than to
 * whatever is cheapest. Both are a dropdown away on the node itself.
 */
const DEFAULT_PURITY: Purity = "normal";

/**
 * Backward pass: scale the chain until it meets `site.targets`.
 *
 * Rates only ever increase, which keeps the fixed point reachable, and lets
 * byproducts pay for downstream demand — the water that Aluminum Scrap gives
 * back correctly reduces the Water Extractors needed by Alumina Solution.
 */
export function solveSite(db: Db, site: Site, opts: SolveOptions = {}): SolveResult {
  // Extractors become one-product, no-ingredient pseudo-recipes so the rest of the
  // solver can size a miner exactly as it sizes a Constructor.
  //
  // Only when a resource has a single extractor node, though. Several nodes on one
  // resource means deliberate hand-placement across differing purities, and there is no
  // non-arbitrary way to split a target between them — so those are left alone and the
  // resource stays externally available. Their output still counts in the balance.
  const extractorsByResource = new Map<string, ExtractorNode[]>();
  for (const n of site.nodes) {
    if (!isExtractor(n)) continue;
    const list = extractorsByResource.get(n.resource);
    if (list) list.push(n);
    else extractorsByResource.set(n.resource, [n]);
  }

  const synthetic: Record<string, Recipe> = {};
  const solvedExtractors = new Map<string, ExtractorNode>(); // synthetic class -> node
  for (const [resource, list] of extractorsByResource) {
    if (list.length !== 1) continue;
    const node = list[0];
    const perMinute = extractorRate(db, node);
    if (perMinute <= 0) continue;
    const cls = `extract:${node.id}`;
    synthetic[cls] = {
      class: cls,
      name: db.itemName(resource),
      alternate: false,
      durationSec: 60,
      building: node.building,
      ingredients: [],
      products: [{ item: resource, amount: perMinute, perMinute }],
      variablePowerConstant: 0,
      variablePowerFactor: 0,
    };
    solvedExtractors.set(cls, node);
  }
  // Shadow db so every lookup below resolves synthetics too.
  const sdb: Db = { ...db, recipeByClass: { ...db.recipeByClass, ...synthetic } };

  // Only a recipe's primary product makes it "the way to get" that item. Byproducts
  // are credited in the balance but never justify scaling a building up.
  const chosen: Record<string, string> = {};
  for (const n of site.nodes) {
    if (isExtractor(n)) continue;
    const r = db.recipeByClass[n.recipe];
    const primary = r?.products[0]?.item;
    if (primary) chosen[primary] ??= r.class;
  }
  for (const [cls, node] of solvedExtractors) chosen[node.resource] = cls;
  Object.assign(chosen, opts.recipeChoice ?? {});

  const available = new Set(opts.treatAsRaw ?? []);
  for (const f of site.imports) available.add(f.item);
  for (const [cls, it] of Object.entries(db.items)) {
    // A resource with its own miner is produced on site, not handed to us for free.
    if (it.isRawResource && !solvedExtractors.has(chosen[cls] ?? "")) available.add(cls);
  }

  const demand: Record<string, number> = {};
  for (const f of site.targets) demand[f.item] = (demand[f.item] ?? 0) + f.perMinute;
  for (const f of opts.exports ?? []) demand[f.item] = (demand[f.item] ?? 0) + f.perMinute;

  const rates: Record<string, number> = {};
  const rateOf = (rc: string) => rates[rc] ?? 0;
  const outPerMin = (rc: string, item: string) =>
    sdb.recipeByClass[rc]?.products.find((p) => p.item === item)?.perMinute ?? 0;

  let diverged = true;
  for (let iter = 0; iter < 300; iter++) {
    const produced: Record<string, number> = {};
    const consumed: Record<string, number> = {};
    for (const [rc, x] of Object.entries(rates)) {
      const r = sdb.recipeByClass[rc];
      if (!r || x <= 0) continue;
      for (const p of r.products) produced[p.item] = (produced[p.item] ?? 0) + p.perMinute * x;
      for (const i of r.ingredients) consumed[i.item] = (consumed[i.item] ?? 0) + i.perMinute * x;
    }

    let changed = false;
    const wanted = new Set([...Object.keys(demand), ...Object.keys(consumed)]);
    for (const item of wanted) {
      if (available.has(item)) continue;
      const rc = chosen[item] ?? sdb.producersOf[item]?.[0]?.class;
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
  const exact = solveExact(sdb, rates, chosen, available, demand);
  if (exact) Object.assign(rates, exact);

  // Distribute solved rates back onto nodes, keeping each node's clock setting.
  const nodesByRecipe: Record<string, PlanNode[]> = {};
  for (const n of site.nodes) {
    (nodesByRecipe[isExtractor(n) ? `extract:${n.id}` : n.recipe] ??= []).push(n);
  }
  // Two distinct strategies, never mixed — mixing exact rates with re-derived counts is
  // what produced a 114% Silica clock.
  //
  //   default: whole buildings at 100%, surplus accepted. Rounding one stage up raises
  //            demand on the stage above, so counts are re-derived from each other.
  //   trimmed: ceil each stage from the exact rate and underclock it onto the number.
  //            No re-derivation needed, because nothing overshoots.
  const trim = !!opts.trimClocks;
  const buildings = trim
    ? Object.fromEntries(
        Object.entries(rates).map(([rc, rate]) => [rc, buildingsFor(rate, 100)]),
      )
    : integerise(sdb, rates, chosen, available, demand, () => 100);

  const counts: Record<string, number> = {};
  const added: PlanNode[] = [];
  let lane = 0;

  for (const [rc, count] of Object.entries(buildings)) {
    const existing = nodesByRecipe[rc];
    if (existing?.length) {
      // Split across duplicates in their current proportion, evenly if all are zero.
      const total = existing.reduce((s, n) => s + n.count, 0);
      let left = count;
      existing.forEach((n, i) => {
        const share = total > EPS ? n.count / total : 1 / existing.length;
        // Whole buildings cannot be split proportionally without drift, so round each
        // and hand the remainder to the last node.
        const give = i === existing.length - 1 ? left : Math.min(left, Math.round(count * share));
        counts[n.id] = Math.max(0, give);
        left -= counts[n.id];
      });
    } else {
      added.push({
        id: `n${Date.now().toString(36)}${lane}`,
        recipe: rc,
        count,
        clock: 100,
        position: { x: 40 + (lane % 4) * 300, y: 40 + Math.floor(lane / 4) * 220 },
      });
      lane++;
    }
  }

  // Clock is written either way, so the option is reversible: unticking it and solving
  // again puts everything back to 100% instead of stranding the trimmed values. The
  // cost is that a deliberate overclock does not survive a solve.
  const clocks: Record<string, number> = {};
  for (const [rc, count] of Object.entries(buildings)) {
    const rate = rates[rc] ?? 0;
    for (const n of nodesByRecipe[rc] ?? []) {
      const mine = counts[n.id] ?? 0;
      clocks[n.id] =
        trim && mine > 0 ? clockToHit((rate * mine) / (count || 1), mine) : 100;
    }
  }
  if (trim) {
    for (const n of added) {
      const rate = rates[isExtractor(n) ? `extract:${n.id}` : n.recipe];
      if (rate && n.count > 0) n.clock = clockToHit(rate, n.count);
    }
  }
  // Recipes on the canvas the targets don't need at all go to zero — but hand-placed
  // extractors the solver deliberately left alone keep the count they were given.
  for (const n of site.nodes) {
    counts[n.id] ??= isExtractor(n) && !solvedExtractors.has(`extract:${n.id}`) ? n.count : 0;
  }

  // Re-run the forward pass over the solved plan to see what is still missing.
  const scaled = site.nodes.map(
    (n) => ({ ...n, count: counts[n.id] ?? n.count, clock: clocks[n.id] ?? n.clock }) as PlanNode,
  );
  // The same targets-and-exports the solve was aimed at, handed to the forward pass so
  // it judges the result against what was asked for. This is the *only* place a site's
  // own targets count as demand: without them here, a site that cannot make its target
  // at all would report nothing wrong, since nothing consumes the item either — the
  // deficit exists only because you asked for it.
  const asked = Object.entries(demand).map(([item, perMinute]) => ({ item, perMinute }));

  let solved: Site = { ...site, nodes: [...scaled, ...added] };
  let balances = evaluateSite(db, solved, asked).balances;

  // Building counts were fixed above treating uncovered raws as freely available, so an
  // extractor sized to the exact shortfall closes it without disturbing the chain.
  // Resources the user already put an extractor on are left alone — placing a second
  // one behind their back would fight a deliberate choice.
  if (opts.autoExtractors !== false) {
    for (const b of balances) {
      if (b.net >= -DISPLAY_EPS || !db.items[b.item]?.isRawResource) continue;
      if (extractorsByResource.has(b.item)) continue;

      const building = defaultExtractorFor(db, b.item);
      if (!building) continue;
      const perBuilding = extractorRateFor(db, building, DEFAULT_PURITY);
      if (perBuilding <= 0) continue;

      const wanted = -b.net / perBuilding;
      const count = buildingsFor(wanted, 100);
      added.push({
        kind: "extractor",
        id: `x${Date.now().toString(36)}${lane}`,
        building,
        resource: b.item,
        purity: DEFAULT_PURITY,
        count,
        clock: opts.trimClocks ? clockToHit(wanted, count) : 100,
        position: { x: 40 + (lane % 4) * 300, y: 40 + Math.floor(lane / 4) * 220 },
      });
      lane++;
    }
    solved = { ...site, nodes: [...scaled, ...added] };
    balances = evaluateSite(db, solved, asked).balances;
  }

  const feeds = balances
    .filter((b) => b.net < -DISPLAY_EPS)
    .map((b) => ({ item: b.item, perMinute: -b.net }));

  // Extractors are left out: a miner is not a recipe anybody chooses between, and the
  // purity dropdown on the node is where that decision already lives.
  const chain = Object.entries(rates)
    .filter(([rc, rate]) => rate > EPS && !solvedExtractors.has(rc))
    .map(([rc]) => ({ recipe: rc, item: sdb.recipeByClass[rc]?.products[0]?.item ?? "" }))
    .filter((c) => c.item)
    .sort((a, b) => db.itemName(a.item).localeCompare(db.itemName(b.item)));

  return { counts, clocks, added, feeds, diverged, chain };
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
    if (!Number.isFinite(x) || x < -EPS) return null; // a negative building count is nonsense
    out[recipeList[i]] = Math.max(0, x);
  }
  return out;
}

/** Whole buildings needed to cover `rate` building-equivalents, at a given clock. */
export function buildingsFor(rate: number, clock: number): number {
  if (rate <= EPS) return 0;
  // Nudge by EPS so a clean 6.0000000001 does not demand a seventh building.
  return Math.max(1, Math.ceil(rate / (clock / 100) - EPS));
}

/**
 * Clock that makes `count` buildings deliver exactly `rate`. Rounded up to the game's 4
 * decimal places, because under-delivering by a rounding hair reads as a phantom
 * shortage while a hair of overproduction is invisible.
 */
export function clockToHit(rate: number, count: number): number {
  if (count <= 0) return 100;
  return Math.ceil((rate / count) * 1e6) / 1e4;
}

/**
 * Re-derive building counts as whole numbers.
 *
 * Rounding up is not enough on its own, because a rounded stage consumes more than the
 * fraction it replaced: 1.5 Aluminum Scrap refineries become 2, and 2 of them eat 480
 * Alumina rather than 360 — which is 4 Alumina refineries, not 3. So the counts are
 * recomputed from each other until they stop moving, exactly reproducing the numbers
 * you would work out by hand.
 *
 * Counts may fall as well as rise, since a rounded-up byproduct source can make a
 * downstream building unnecessary. Cyclic chains could in principle oscillate by one, so
 * the last stretch of iterations only ever increases, which always terminates.
 */
function integerise(
  db: Db,
  seed: Record<string, number>,
  chosen: Record<string, string>,
  available: Set<string>,
  demand: Record<string, number>,
  clockOf: (rc: string) => number,
): Record<string, number> {
  const buildings: Record<string, number> = {};
  for (const [rc, rate] of Object.entries(seed)) buildings[rc] = buildingsFor(rate, clockOf(rc));

  const effective = (rc: string) => (buildings[rc] ?? 0) * (clockOf(rc) / 100);
  const outPerMin = (rc: string, item: string) =>
    db.recipeByClass[rc]?.products.find((p) => p.item === item)?.perMinute ?? 0;

  const MAX = 100;
  for (let iter = 0; iter < MAX; iter++) {
    const produced: Record<string, number> = {};
    const consumed: Record<string, number> = {};
    for (const rc of Object.keys(buildings)) {
      const r = db.recipeByClass[rc];
      const x = effective(rc);
      if (!r || x <= 0) continue;
      for (const p of r.products) produced[p.item] = (produced[p.item] ?? 0) + p.perMinute * x;
      for (const g of r.ingredients) consumed[g.item] = (consumed[g.item] ?? 0) + g.perMinute * x;
    }

    let changed = false;
    for (const [item, rc] of Object.entries(chosen)) {
      if (available.has(item) || buildings[rc] === undefined) continue;
      const per = outPerMin(rc, item);
      if (per <= 0) continue;

      const need = (demand[item] ?? 0) + (consumed[item] ?? 0);
      const fromElsewhere = (produced[item] ?? 0) - effective(rc) * per;
      const want = buildingsFor(Math.max(0, need - fromElsewhere) / per, clockOf(rc));
      // Past the halfway mark, refuse to shrink so a cycle cannot ping-pong forever.
      const next = iter < MAX / 2 ? want : Math.max(want, buildings[rc]);
      if (next !== buildings[rc]) {
        buildings[rc] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return buildings;
}

/** Trailing zeros make a balance table much harder to scan. */
export function fmt(v: number, digits = 2): string {
  if (Math.abs(v) < 1e-9) return "0";
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, "");
}
