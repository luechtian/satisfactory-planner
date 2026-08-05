import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Somewhere for persist() to write.
 *
 * It defaults to `window.localStorage` — not the bare global — so under Node there is no
 * storage at all: every write warns, and nothing is stored. Stubbing `localStorage`
 * alone does nothing, which is worth knowing before wondering why a persistence test
 * never sees its own data. Hoisted so it is in place before the store is imported.
 */
vi.hoisted(() => {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
  (globalThis as { window?: unknown }).window = { localStorage: store };
  globalThis.localStorage = store;
});

import { readFileSync } from "node:fs";
import { indexDb, type Db } from "../src/core/data";
import { emptyHistory } from "../src/core/history";
import { evaluateSite } from "../src/core/solver";
import { isExtractor, type Plan, type Site } from "../src/core/types";
import { usePlan } from "../src/store/planStore";

const db: Db = indexDb(JSON.parse(readFileSync("public/data.json", "utf8")));

/**
 * The store side of undo: that every action actually routes through the one write path,
 * and that stepping back puts you somewhere sensible. The rules themselves are covered
 * in history.test.ts; this is the wiring.
 */

const site = (id: string): Site => ({ id, name: id, nodes: [], targets: [], imports: [] });
const start = (): Plan => ({ version: 1, sites: [site("a"), site("b")] });

const st = () => usePlan.getState();
const nodeCount = (id: string) => st().plan.sites.find((s) => s.id === id)!.nodes.length;

beforeEach(() => {
  usePlan.setState({
    plan: start(),
    activeSiteId: "a",
    selectedNodeId: null,
    history: emptyHistory(),
    collapsedSections: [],
  });
});

describe("recording", () => {
  it("takes back an added node, and puts it back on redo", () => {
    st().addNode("Recipe_IronIngot_C");
    expect(nodeCount("a")).toBe(1);

    st().undo();
    expect(nodeCount("a")).toBe(0);

    st().redo();
    expect(nodeCount("a")).toBe(1);
  });

  it("spends no step on an action that changed nothing", () => {
    st().addNode("Recipe_IronIngot_C");
    const id = st().plan.sites[0].nodes[0].id;
    st().addConnection(id, id, "Desc_Water_C");
    st().addConnection(id, id, "Desc_Water_C"); // the duplicate is refused

    st().undo(); // back past the one connection
    st().undo(); // back past the node
    expect(nodeCount("a")).toBe(0);
    expect(st().history.past).toHaveLength(0);
  });

  it("collapses a drag into a single step", () => {
    st().addNode("Recipe_IronIngot_C");
    const id = st().plan.sites[0].nodes[0].id;
    const dropped = st().plan.sites[0].nodes[0].position;
    for (let x = 1; x <= 20; x++) st().updateNode(id, { position: { x, y: 0 } });

    // One undo, not twenty: back to where the node was before the drag began.
    st().undo();
    expect(st().plan.sites[0].nodes[0].position).toEqual(dropped);
  });

  it("keeps a drag and the count typed straight after it apart", () => {
    st().addNode("Recipe_IronIngot_C");
    const id = st().plan.sites[0].nodes[0].id;
    st().updateNode(id, { position: { x: 5, y: 5 } });
    st().updateNode(id, { count: 4 });

    st().undo();
    const n = st().plan.sites[0].nodes[0];
    expect(n.count).toBe(1);
    expect(n.position).toEqual({ x: 5, y: 5 }); // the drag survived
  });
});

describe("folding panel sections", () => {
  it("toggles shut and open again", () => {
    st().toggleSection("Shortages");
    expect(st().collapsedSections).toEqual(["Shortages"]);
    st().toggleSection("Shortages");
    expect(st().collapsedSections).toEqual([]);
  });

  it("is not a plan edit, so it spends no undo step", () => {
    const before = st().history.past.length;
    st().toggleSection("Surplus");
    expect(st().history.past).toHaveLength(before);
  });

  it("survives a reload", async () => {
    // Read back out of the storage the middleware actually wrote to. `partialize`
    // decides what gets that far, and leaving a field out of it fails silently — the
    // state just quietly resets on the next load.
    st().toggleSection("Shortages");
    // persist writes through a promise, so the write lands a microtask after the set.
    await Promise.resolve();

    const saved = JSON.parse(globalThis.localStorage.getItem("satisfactory-planner") ?? "{}");
    expect(saved.state.collapsedSections).toEqual(["Shortages"]);
  });
});

describe("solving", () => {
  const IRON = "Desc_IronIngot_C";
  const PURE = "Recipe_Alternate_PureIronIngot_C";
  const target = (perMinute: number) => [{ id: "t", item: IRON, perMinute }];

  const bare = () =>
    usePlan.setState({
      plan: { version: 1, sites: [site("a"), site("b")] },
      activeSiteId: "a",
      history: emptyHistory(),
    });

  it("writes the recipes it was told to use", () => {
    bare();
    st().solve(db, { targets: target(60), recipeChoice: { [IRON]: PURE } });

    const solved = st().plan.sites[0];
    expect(solved.recipeChoice).toEqual({ [IRON]: PURE });
    expect(solved.nodes.some((n) => !isExtractor(n) && n.recipe === PURE)).toBe(true);
  });

  it("remembers the target without letting it bind", () => {
    bare();
    st().solve(db, { targets: target(60) });

    // Kept, so the dialog opens where you left it and the site records its intent...
    expect(st().plan.sites[0].targets).toEqual(target(60));
    // ...but the balance judges the site on what it makes, not what it was asked for.
    const bal = evaluateSite(db, st().plan.sites[0]).balances.find((b) => b.item === IRON)!;
    expect(bal.committed).toBe(0);
    expect(bal.net).toBeGreaterThanOrEqual(60);
  });

  it("is one undo step, not one per thing it was given", () => {
    bare();
    st().solve(db, { targets: target(60), recipeChoice: { [IRON]: PURE } });

    st().undo();
    const back = st().plan.sites[0];
    expect(back.targets).toEqual([]);
    expect(back.recipeChoice).toBeUndefined();
    expect(back.nodes).toHaveLength(0);
  });

  it("stores no recipes at all rather than an empty map", () => {
    // So a site solved with everything left on Default serialises exactly like one from
    // before any of this existed, instead of growing a "recipeChoice": {}.
    bare();
    st().solve(db, { targets: target(60), recipeChoice: {} });
    expect(st().plan.sites[0].recipeChoice).toBeUndefined();
  });

  it("keeps what the site already had when solved with nothing new", () => {
    bare();
    st().solve(db, { targets: target(60), recipeChoice: { [IRON]: PURE } });
    st().solve(db);
    expect(st().plan.sites[0].recipeChoice).toEqual({ [IRON]: PURE });
    expect(st().plan.sites[0].targets).toEqual(target(60));
  });
});

describe("where undo leaves you", () => {
  it("returns to the site the change was made on", () => {
    st().setActiveSite("b");
    st().addNode("Recipe_IronIngot_C");
    st().setActiveSite("a");

    st().undo();
    expect(st().activeSiteId).toBe("b");
    expect(nodeCount("b")).toBe(0);
  });

  it("brings back a deleted site and opens it", () => {
    st().removeSite("a");
    expect(st().plan.sites.map((s) => s.id)).toEqual(["b"]);
    expect(st().activeSiteId).toBe("b");

    st().undo();
    expect(st().plan.sites.map((s) => s.id)).toEqual(["a", "b"]);
    expect(st().activeSiteId).toBe("a");
  });

  it("stays put when the site the change added no longer exists", () => {
    st().addSite("c");
    const added = st().activeSiteId;
    st().undo();
    expect(st().plan.sites.some((s) => s.id === added)).toBe(false);
    expect(st().plan.sites.some((s) => s.id === st().activeSiteId)).toBe(true);
  });
});

describe("taking back a whole-plan change", () => {
  it("undoes an import that merged sites in", () => {
    st().mergePlan({ version: 1, sites: [site("c"), site("d")] }, ["c", "d"]);
    expect(st().plan.sites.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);

    st().undo();
    expect(st().plan.sites.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("undoes a plan that replaced everything", () => {
    st().replacePlan({ version: 1, sites: [site("z")] });
    expect(st().plan.sites.map((s) => s.id)).toEqual(["z"]);

    st().undo();
    expect(st().plan.sites.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
