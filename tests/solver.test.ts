import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexDb, type Db } from "../src/core/data";
import { evaluateSite, solveSite } from "../src/core/solver";
import { exportsOf, summarisePlan } from "../src/core/overview";
import { isExtractor, type Plan, type PlanNode, type Site } from "../src/core/types";

const db: Db = indexDb(JSON.parse(readFileSync("public/data.json", "utf8")));

const recipe = (name: string) => {
  const r = db.recipes.find((x) => x.name === name);
  if (!r) throw new Error(`no recipe "${name}"`);
  return r.class;
};
const item = (name: string) => {
  const i = Object.values(db.items).find((x) => x.name === name);
  if (!i) throw new Error(`no item "${name}"`);
  return i.class;
};

let seq = 0;
const machine = (name: string, count: number, clock = 100): PlanNode => ({
  id: `n${seq++}`, recipe: recipe(name), count, clock, position: { x: 0, y: 0 },
});
const site = (over: Partial<Site> = {}): Site => ({
  id: `s${seq++}`, name: "site", nodes: [], targets: [], imports: [], ...over,
});

/** Machine counts keyed by recipe name, for readable assertions. */
function counts(db: Db, s: Site, solved: ReturnType<typeof solveSite>) {
  const out: Record<string, number> = {};
  for (const n of [...s.nodes, ...solved.added]) {
    const c = solved.counts[n.id] ?? n.count;
    if (c <= 0) continue;
    const label = isExtractor(n) ? db.itemName(n.resource) : db.recipeByClass[n.recipe].name;
    out[label] = (out[label] ?? 0) + c;
  }
  return out;
}
const net = (s: Site, name: string, exports?: Parameters<typeof evaluateSite>[2]) =>
  evaluateSite(db, s, exports).balances.find((b) => b.item === item(name))?.net ?? 0;

describe("forward pass", () => {
  const alu = site({
    nodes: [
      machine("Alumina Solution", 4), machine("Aluminum Scrap", 2), machine("Aluminum Ingot", 6),
    ],
  });

  it("reproduces a hand-built balance sheet", () => {
    expect(net(alu, "Alumina Solution")).toBe(0);
    expect(net(alu, "Silica")).toBe(-250);
    expect(net(alu, "Aluminum Scrap")).toBe(180);
    expect(net(alu, "Water")).toBe(-480);
    expect(net(alu, "Aluminum Ingot")).toBe(360);
  });

  it("counts extractor power, not just machines", () => {
    const withMiner = site({
      nodes: [
        machine("Aluminum Ingot", 1),
        { id: "x1", kind: "extractor", building: "Build_MinerMk3_C", resource: item("Bauxite"),
          purity: "normal", count: 2, clock: 100, position: { x: 0, y: 0 } },
      ],
    });
    // Foundry 16 MW + 2 Mk3 miners at 45 MW each.
    expect(evaluateSite(db, withMiner).totalPowerMW).toBeCloseTo(16 + 90, 5);
  });

  it("scales a node by clock as well as count", () => {
    const half = site({ nodes: [machine("Iron Ingot", 2, 50)] });
    expect(net(half, "Iron Ingot")).toBe(30); // 2 smelters at 50% = 1 at 100%
  });
});

describe("backward pass", () => {
  it("re-derives whole machines up the chain", () => {
    // Scrap rounds 1.5 -> 2, which pushes Alumina 3 -> 4. Matches the spreadsheet.
    const s = site({ targets: [{ id: "t", item: item("Aluminum Ingot"), perMinute: 360 }] });
    const r = solveSite(db, s);
    expect(counts(db, s, r)).toMatchObject({
      "Aluminum Ingot": 6, "Aluminum Scrap": 2, "Alumina Solution": 4, Silica: 7,
    });
    expect(r.diverged).toBe(false);
  });

  it("leaves nothing unfed once extractors are placed", () => {
    const s = site({ targets: [{ id: "t", item: item("Aluminum Ingot"), perMinute: 360 }] });
    expect(solveSite(db, s).feeds).toEqual([]);
  });

  it("reaches for Raw Quartz rather than farming Silica as a byproduct", () => {
    const s = site({ targets: [{ id: "t", item: item("Silica"), perMinute: 150 }] });
    const c = counts(db, site({ ...s }), solveSite(db, s));
    expect(c).toHaveProperty("Silica");
    expect(c).not.toHaveProperty("Alumina Solution");
  });

  it("credits the water Aluminum Scrap hands back", () => {
    const s = site({ targets: [{ id: "t", item: item("Aluminum Ingot"), perMinute: 360 }] });
    const r = solveSite(db, s);
    const solved = site({
      ...s,
      nodes: [...s.nodes.map((n) => ({ ...n, count: r.counts[n.id] ?? n.count })), ...r.added],
    });
    // 4 Alumina drink 720; Scrap returns 240; 4 Water Extractors cover the other 480.
    expect(counts(db, s, r).Water).toBe(4);
    expect(net(solved, "Water")).toBeCloseTo(0, 6);
  });

  it("is idempotent — solving twice does not stack machines", () => {
    const s = site({ targets: [{ id: "t", item: item("Aluminum Ingot"), perMinute: 360 }] });
    const first = solveSite(db, s);
    const after = site({
      ...s,
      nodes: [...s.nodes.map((n) => ({ ...n, count: first.counts[n.id] ?? n.count })), ...first.added],
    });
    const second = solveSite(db, after);
    expect(second.added).toEqual([]);
    expect(counts(db, after, second)).toEqual(counts(db, s, first));
  });

  it("never emits a fractional machine", () => {
    const s = site({ targets: [{ id: "t", item: item("Reinforced Iron Plate"), perMinute: 17 }] });
    const r = solveSite(db, s);
    for (const c of Object.values(counts(db, s, r))) expect(c % 1).toBe(0);
  });

  it("with trimClocks, underclocks instead and never exceeds 100%", () => {
    const s = site({ targets: [{ id: "t", item: item("Aluminum Ingot"), perMinute: 360 }] });
    const r = solveSite(db, s, { trimClocks: true });
    const clocks = [...Object.values(r.clocks), ...r.added.map((n) => n.clock)];
    expect(clocks.length).toBeGreaterThan(0);
    for (const c of clocks) expect(c).toBeLessThanOrEqual(100);
  });

  it("solves for an export the same as for a target", () => {
    const s = site({ nodes: [machine("Copper Sheet", 1)] });
    const owed = [{ item: item("Copper Sheet"), perMinute: 100 }];
    const r = solveSite(db, s, { exports: owed });
    expect(counts(db, s, r)["Copper Sheet"]).toBe(10); // 10/min each
  });
});

describe("cross-site links", () => {
  const build = (): Plan => {
    const source = site({ id: "src", name: "Source", nodes: [machine("Copper Sheet", 5)] });
    const consumer = site({
      id: "dst", name: "Consumer", nodes: [machine("AI Limiter", 1)],
      imports: [{ id: "i1", item: item("Copper Sheet"), perMinute: 25, from: "src" }],
    });
    return { version: 1, sites: [source, consumer] };
  };

  it("derives an export on the source from the consumer's import", () => {
    const plan = build();
    expect(exportsOf(plan, "src")).toEqual([
      { item: item("Copper Sheet"), perMinute: 25, toId: "dst", toName: "Consumer" },
    ]);
    expect(exportsOf(plan, "dst")).toEqual([]);
  });

  it("counts the export against the source's balance", () => {
    const plan = build();
    const src = plan.sites[0];
    expect(net(src, "Copper Sheet")).toBe(50);
    expect(net(src, "Copper Sheet", exportsOf(plan, "src"))).toBe(25);
  });

  it("reports a shortfall at the source when it cannot cover the draw", () => {
    const plan = build();
    plan.sites[0].nodes[0].count = 2; // 20/min against a 25/min claim
    const s = summarisePlan(db, plan);
    const link = s.links.find((l) => l.item === item("Copper Sheet"))!;
    expect(link.drawn).toBe(25);
    expect(link.available).toBe(20);
    expect(link.over).toBe(5);
    // The source reports it itself, rather than the consumer believing it is supplied.
    expect(net(plan.sites[0], "Copper Sheet", exportsOf(plan, "src"))).toBe(-5);
    expect(net(plan.sites[1], "Copper Sheet")).toBe(0);
  });

  it("flags an import pointing at a site that no longer exists", () => {
    const plan = build();
    plan.sites = [plan.sites[1]];
    expect(summarisePlan(db, plan).brokenLinks).toHaveLength(1);
  });

  it("stops advertising surplus that a link has already claimed", () => {
    const spare = summarisePlan(db, build()).items.find((r) => r.item === item("Copper Sheet"));
    expect(spare?.spare).toBe(25); // 50 produced, 25 committed
  });
});

describe("recipes that recycle their own input", () => {
  it("nets Encased Uranium Cell to a single side of the acid balance", () => {
    const s = site({ nodes: [machine("Encased Uranium Cell", 1)] });
    const bal = evaluateSite(db, s).balances.find((b) => b.item === item("Sulfuric Acid"))!;
    expect(bal.produced).toBe(10);
    expect(bal.consumed).toBe(40);
    expect(bal.net).toBe(-30);
  });
});
