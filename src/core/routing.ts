import { DISPLAY_EPS } from "./solver";
import type { SiteConnection } from "./types";

/** One end of a belt: who, how much of the item they move, and where they sit. */
export interface RoutePort {
  nodeId: string;
  rate: number;
  x: number;
  y: number;
}

export interface RouteEdge {
  id: string;
  from: string;
  to: string;
  item: string;
  /** what actually travels along this arrow */
  rate: number;
  /** hand-drawn, or an arm of a manifold */
  kind: "direct" | "manual" | "into-hub" | "from-hub";
  /** the item is short across the whole site */
  short: boolean;
  /** a hand-drawn belt that cannot deliver; how far it falls short */
  under: number;
  /** drawn as deliberate — hand-wired, or wired onto the pool */
  manual: boolean;
}

export interface RouteHub {
  id: string;
  item: string;
  supply: number;
  demand: number;
}

export interface RouteInput {
  /** gross rates per node per item, before any netting */
  flows: Array<{ item: string; nodeId: string; out: number; in: number }>;
  /** targets and exports — ends of the chain, so they only ever draw */
  sinks: Array<{ key: string; item: string; perMinute: number }>;
  /** imports — ends of the chain, so they only ever supply */
  sources: Array<{ key: string; item: string; perMinute: number }>;
  connections: SiteConnection[];
  positionOf: (id: string) => { x: number; y: number };
  isShort: (item: string) => boolean;
}

/**
 * Ids for the nodes the canvas derives rather than stores.
 *
 * Written here beside the hub ids because more than one place has to agree on them: the
 * canvas builds these nodes, and the balance panel has to be able to name one to send
 * you to it. They were string literals in the canvas until the second caller appeared.
 */
export const hubId = (item: string) => `hub:${item}`;
export const exportId = (toId: string, item: string) => `export:${toId}:${item}`;
export const importId = (flowId: string) => `import:${flowId}`;

export const isHubId = (id: string | null | undefined) => !!id?.startsWith("hub:");
/**
 * True for any node the canvas synthesised, none of which match a stored PlanNode.
 *
 * `target:` is still recognised though nothing builds one any more: plans saved while
 * targets drew a node can carry remembered positions and hand-drawn belts pointing at
 * one, and those are better ignored than mistaken for a real node.
 */
export const isDerivedId = (id: string) =>
  id.startsWith("target:") || id.startsWith("export:") ||
  id.startsWith("import:") || id.startsWith("hub:");

/**
 * Decide what connects to what, and at what rate.
 *
 * Kept out of the canvas component because every routing bug so far has been pure
 * logic — a building excluded from one side, a loop of derived nodes dropped — and none
 * of it was reachable by a test while it lived inside a `useMemo`.
 *
 * The rules, in order:
 *
 *  1. A building is *netted* per item, so one that recycles its own input sits on a
 *     single side and cannot be belted to itself. Wiring either of its ports by hand
 *     opts it out: it then appears on both sides at gross rates.
 *  2. Hand-drawn belts are served first and take their endpoints out of the pool
 *     entirely, so a belt that cannot keep up is reported short rather than quietly
 *     topped up from elsewhere.
 *  3. Whatever is left over meets in the middle: one-to-one gets a plain arrow, and
 *     anything busier gets a manifold, because rates alone cannot say which building
 *     feeds which.
 */
export function routeGraph(input: RouteInput): { edges: RouteEdge[]; hubs: RouteHub[] } {
  const { connections: drawn, positionOf, isShort } = input;

  const supplyBy = new Map<string, RoutePort[]>();
  const demandBy = new Map<string, RoutePort[]>();

  for (const f of input.flows) {
    const at = positionOf(f.nodeId);
    const wired = drawn.some(
      (c) => c.item === f.item && (c.from === f.nodeId || c.to === f.nodeId),
    );
    if (wired) {
      if (f.out > DISPLAY_EPS) push(supplyBy, f.item, { nodeId: f.nodeId, rate: f.out, ...at });
      if (f.in > DISPLAY_EPS) push(demandBy, f.item, { nodeId: f.nodeId, rate: f.in, ...at });
      continue;
    }
    const net = f.out - f.in;
    if (net > DISPLAY_EPS) push(supplyBy, f.item, { nodeId: f.nodeId, rate: net, ...at });
    else if (net < -DISPLAY_EPS) push(demandBy, f.item, { nodeId: f.nodeId, rate: -net, ...at });
  }

  for (const s of input.sinks) {
    push(demandBy, s.item, { nodeId: s.key, rate: s.perMinute, ...positionOf(s.key) });
  }
  for (const s of input.sources) {
    push(supplyBy, s.item, { nodeId: s.key, rate: s.perMinute, ...positionOf(s.key) });
  }

  const edges: RouteEdge[] = [];
  const hubs: RouteHub[] = [];

  for (const [item, allSupply] of supplyBy) {
    const supply = allSupply.filter((s) => s.rate > DISPLAY_EPS);
    const demand = (demandBy.get(item) ?? []).filter((d) => d.rate > DISPLAY_EPS);
    if (!supply.length || !demand.length) continue;

    const short = isShort(item);
    const spare = new Map(supply.map((s) => [s.nodeId, s.rate]));
    const wanted = new Map(demand.map((d) => [d.nodeId, d.rate]));

    // Wiring a port to the manifold says "this one is on the pool" rather than naming a
    // partner, so it keeps its place in the pooling below instead of being claimed.
    const pooled = new Set<string>();
    for (const c of drawn) {
      if (c.item !== item) continue;
      if (isHubId(c.from)) pooled.add(c.to);
      else if (isHubId(c.to)) pooled.add(c.from);
    }

    const mine = drawn.filter(
      (c) =>
        c.item === item && !isHubId(c.from) && !isHubId(c.to) &&
        spare.has(c.from) && wanted.has(c.to),
    );
    const alloc = mine.map((c) => {
      const flow = Math.min(spare.get(c.from)!, wanted.get(c.to)!);
      spare.set(c.from, spare.get(c.from)! - flow);
      wanted.set(c.to, wanted.get(c.to)! - flow);
      return { c, flow };
    });

    const claimedIn = new Set(mine.map((c) => c.to));
    const claimedOut = new Set(mine.map((c) => c.from));

    for (const { c, flow } of alloc) {
      edges.push({
        id: c.id, from: c.from, to: c.to, item, rate: flow,
        kind: "manual", manual: true, short,
        under: Math.max(0, wanted.get(c.to) ?? 0),
      });
    }

    const leftIn = supply.filter(
      (s) => !claimedOut.has(s.nodeId) && (spare.get(s.nodeId) ?? 0) > DISPLAY_EPS,
    );
    const leftOut = demand.filter(
      (d) => !claimedIn.has(d.nodeId) && (wanted.get(d.nodeId) ?? 0) > DISPLAY_EPS,
    );
    if (!leftIn.length || !leftOut.length) continue;
    // A wired building appears on both sides at gross rates; never belt it to itself.
    if (leftIn.length === 1 && leftOut.length === 1 && leftIn[0].nodeId === leftOut[0].nodeId) {
      continue;
    }

    if (leftIn.length === 1 && leftOut.length === 1) {
      const [s] = leftIn, [d] = leftOut;
      edges.push({
        id: `${s.nodeId}->${d.nodeId}:${item}`,
        from: s.nodeId, to: d.nodeId, item,
        rate: Math.min(spare.get(s.nodeId)!, wanted.get(d.nodeId)!),
        kind: "direct", manual: false, short, under: 0,
      });
      continue;
    }

    const hub = hubId(item);
    hubs.push({
      id: hub, item,
      supply: leftIn.reduce((n, s) => n + spare.get(s.nodeId)!, 0),
      demand: leftOut.reduce((n, d) => n + wanted.get(d.nodeId)!, 0),
    });
    for (const s of leftIn) {
      edges.push({
        id: `${s.nodeId}->${hub}`, from: s.nodeId, to: hub, item,
        rate: spare.get(s.nodeId)!, kind: "into-hub",
        manual: pooled.has(s.nodeId), short, under: 0,
      });
    }
    for (const d of leftOut) {
      edges.push({
        id: `${hub}->${d.nodeId}`, from: hub, to: d.nodeId, item,
        rate: wanted.get(d.nodeId)!, kind: "from-hub",
        manual: pooled.has(d.nodeId), short, under: 0,
      });
    }
  }

  return { edges, hubs };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
