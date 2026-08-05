import { beforeEach, describe, expect, it, vi } from "vitest";

// The store is built with persist(), which takes hold of localStorage as it is imported
// and warns on every write when there is none. Hoisted so it is in place first; nothing
// here reads it back.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
});

import { readFileSync } from "node:fs";
import { indexDb, type Db } from "../src/core/data";
import { emptyHistory } from "../src/core/history";
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

describe("solving with chosen recipes", () => {
  const IRON = "Desc_IronIngot_C";
  const PURE = "Recipe_Alternate_PureIronIngot_C";

  const withTarget = () =>
    usePlan.setState({
      plan: {
        version: 1,
        sites: [{ ...site("a"), targets: [{ id: "t", item: IRON, perMinute: 60 }] }, site("b")],
      },
      activeSiteId: "a",
      history: emptyHistory(),
    });

  it("writes the choices along with the solved nodes", () => {
    withTarget();
    st().solve(db, { [IRON]: PURE });

    const solved = st().plan.sites[0];
    expect(solved.recipeChoice).toEqual({ [IRON]: PURE });
    expect(solved.nodes.some((n) => !isExtractor(n) && n.recipe === PURE)).toBe(true);
  });

  it("is one undo step, not one for the choice and one for the solve", () => {
    withTarget();
    st().solve(db, { [IRON]: PURE });

    st().undo();
    expect(st().plan.sites[0].recipeChoice).toBeUndefined();
    expect(st().plan.sites[0].nodes).toHaveLength(0);
  });

  it("stores nothing at all rather than an empty map", () => {
    // So a site solved with everything left on Default serialises exactly like one from
    // before any of this existed, instead of growing a "recipeChoice": {}.
    withTarget();
    st().solve(db, {});
    expect(st().plan.sites[0].recipeChoice).toBeUndefined();
  });

  it("keeps existing pins when solved without any choices", () => {
    withTarget();
    st().solve(db, { [IRON]: PURE });
    st().solve(db);
    expect(st().plan.sites[0].recipeChoice).toEqual({ [IRON]: PURE });
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
