import { describe, expect, it } from "vitest";
import { routeGraph, underfedBelts, type RouteInput } from "../src/core/routing";
import type { SiteConnection } from "../src/core/types";

/**
 * Every case here is a bug that shipped. The routing used to live inside the canvas
 * component, where none of it was reachable by a test.
 */

const WATER = "Desc_Water_C";
const ACID = "Desc_SulfuricAcid_C";

let seq = 0;
const conn = (from: string, to: string, item: string): SiteConnection =>
  ({ id: `c${seq++}`, from, to, item });

function route(over: Partial<RouteInput>) {
  const input: RouteInput = {
    flows: [], sinks: [], sources: [], connections: [],
    isShort: () => false,
    ...over,
  };
  const { edges, hubs } = routeGraph(input);
  return {
    edges, hubs,
    /** "from->to" pairs, for readable assertions */
    pairs: edges.map((e) => `${e.from}->${e.to}`).sort(),
    rateOf: (from: string, to: string) =>
      edges.find((e) => e.from === from && e.to === to)?.rate,
  };
}

const makes = (nodeId: string, item: string, out: number) => ({ item, nodeId, out, in: 0 });
const takes = (nodeId: string, item: string, into: number) => ({ item, nodeId, out: 0, in: into });

describe("basic shapes", () => {
  it("draws a plain arrow for one producer and one consumer", () => {
    const r = route({ flows: [makes("a", WATER, 120), takes("b", WATER, 120)] });
    expect(r.pairs).toEqual(["a->b"]);
    expect(r.hubs).toHaveLength(0);
    expect(r.edges[0].kind).toBe("direct");
  });

  it("pools into a manifold when several make and several take", () => {
    const r = route({
      flows: [
        makes("e1", WATER, 120), makes("e2", WATER, 120),
        takes("c1", WATER, 100), takes("c2", WATER, 140),
      ],
    });
    expect(r.hubs).toHaveLength(1);
    // Four arms, not a four-edge mesh — and every building gets exactly one.
    expect(r.pairs).toEqual([
      "e1->hub:Desc_Water_C", "e2->hub:Desc_Water_C",
      "hub:Desc_Water_C->c1", "hub:Desc_Water_C->c2",
    ]);
    expect(r.hubs[0]).toMatchObject({ supply: 240, demand: 240 });
  });

  it("gives every producer an arm, never leaving one unconnected", () => {
    // Three extractors into one consumer: the surplus must not orphan the last one.
    const r = route({
      flows: [
        makes("e1", WATER, 120), makes("e2", WATER, 120), makes("e3", WATER, 120),
        takes("c1", WATER, 180),
      ],
    });
    expect(r.edges.filter((e) => e.to.startsWith("hub:"))).toHaveLength(3);
  });
});

describe("buildings that recycle their own input", () => {
  // Encased Uranium Cell: 40 Sulfuric Acid in, 10 back out.
  const blender = { item: ACID, nodeId: "euc", out: 10, in: 40 };

  it("nets to one side, so nothing belts it to itself", () => {
    const r = route({ flows: [blender, makes("refinery", ACID, 50)] });
    expect(r.pairs).toEqual(["refinery->euc"]);
    expect(r.rateOf("refinery", "euc")).toBe(30);
  });

  it("is still reachable from another producer", () => {
    // Regression: excluding it from demand for also being a producer made its acid
    // input unreachable by anything at all.
    const r = route({ flows: [blender, makes("refinery", ACID, 50)] });
    expect(r.edges.some((e) => e.to === "euc")).toBe(true);
  });

  it("switches to gross rates once a port is wired by hand", () => {
    const r = route({
      flows: [blender, makes("refinery", ACID, 50)],
      connections: [conn("refinery", "euc", ACID)],
    });
    expect(r.rateOf("refinery", "euc")).toBe(40); // gross, not the netted 30
  });

  it("can send its returned acid somewhere specific", () => {
    // Regression: a belt drawn from its output was stored but never rendered.
    const r = route({
      flows: [blender, takes("scrap", ACID, 50)],
      connections: [conn("euc", "scrap", ACID)],
    });
    const belt = r.edges.find((e) => e.from === "euc" && e.to === "scrap");
    expect(belt).toBeDefined();
    expect(belt!.rate).toBe(10);
    expect(belt!.under).toBe(40); // scrap wanted 50
  });

  it("shows both arms when wired onto the pool", () => {
    const r = route({
      flows: [blender, makes("refinery", ACID, 50), takes("scrap", ACID, 50)],
      connections: [conn("euc", `hub:${ACID}`, ACID)],
    });
    expect(r.hubs[0]).toMatchObject({ supply: 60, demand: 90 });
    expect(r.rateOf("euc", `hub:${ACID}`)).toBe(10);
    expect(r.rateOf(`hub:${ACID}`, "euc")).toBe(40);
  });
});

describe("hand-drawn belts", () => {
  it("splits two chains that would otherwise share a pool", () => {
    const r = route({
      flows: [
        makes("w1", WATER, 120), makes("w2", WATER, 120),
        takes("acid", WATER, 50), takes("sheet", WATER, 22.5),
      ],
      connections: [conn("w1", "acid", WATER), conn("w2", "sheet", WATER)],
    });
    expect(r.hubs).toHaveLength(0);
    expect(r.pairs).toEqual(["w1->acid", "w2->sheet"]);
  });

  it("goes short rather than reaching for another source", () => {
    const r = route({
      flows: [makes("w1", WATER, 120), makes("w2", WATER, 120), takes("acid", WATER, 200)],
      connections: [conn("w1", "acid", WATER)],
    });
    const belt = r.edges.find((e) => e.from === "w1")!;
    expect(belt.rate).toBe(120);
    expect(belt.under).toBe(80);
    // w2 is never wired in behind your back.
    expect(r.edges.some((e) => e.from === "w2")).toBe(false);
  });

  it("still pools whatever is left unwired", () => {
    const r = route({
      flows: [
        makes("w1", WATER, 120), makes("w2", WATER, 120),
        takes("a", WATER, 60), takes("b", WATER, 60), takes("c", WATER, 60),
      ],
      connections: [conn("w1", "a", WATER)],
    });
    expect(r.edges.find((e) => e.from === "w1" && e.to === "a")!.rate).toBe(60);
    expect(r.hubs).toHaveLength(1); // w1 leftover + w2 feeding b and c
  });

  it("ignores a belt whose endpoint has gone", () => {
    const r = route({
      flows: [makes("a", WATER, 120), takes("b", WATER, 120)],
      connections: [conn("a", "deleted", WATER)],
    });
    expect(r.pairs).toEqual(["a->b"]);
  });
});

describe("derived import and export nodes", () => {
  // Regression: a wide edit dropped sinks and sources from the routing maps, so
  // import and export nodes rendered with no wires at all.
  it("wires a target node to whatever makes the item", () => {
    const r = route({
      flows: [makes("a", WATER, 120)],
      sinks: [{ key: "target:Desc_Water_C", item: WATER, perMinute: 120 }],
    });
    expect(r.pairs).toEqual(["a->target:Desc_Water_C"]);
  });

  it("wires an import node to whatever consumes the item", () => {
    const r = route({
      flows: [takes("b", WATER, 120)],
      sources: [{ key: "import:i1", item: WATER, perMinute: 120 }],
    });
    expect(r.pairs).toEqual(["import:i1->b"]);
  });

  it("treats a sink as one more consumer when pooling", () => {
    const r = route({
      flows: [makes("a", WATER, 100), makes("b", WATER, 100)],
      sinks: [{ key: "export:s2:Desc_Water_C", item: WATER, perMinute: 200 }],
    });
    expect(r.hubs).toHaveLength(1);
    expect(r.rateOf(`hub:${WATER}`, "export:s2:Desc_Water_C")).toBe(200);
  });

  it("never nets a sink against a source of the same item", () => {
    // An import and an export of one item are separate ends of the chain, not a
    // building that recycles.
    const r = route({
      sources: [{ key: "import:i1", item: WATER, perMinute: 100 }],
      sinks: [{ key: "target:Desc_Water_C", item: WATER, perMinute: 100 }],
    });
    expect(r.pairs).toEqual(["import:i1->target:Desc_Water_C"]);
  });
});

describe("flags carried to the renderer", () => {
  it("marks every edge of a short item", () => {
    const r = route({
      flows: [makes("a", WATER, 60), takes("b", WATER, 120)],
      isShort: (i) => i === WATER,
    });
    expect(r.edges.every((e) => e.short)).toBe(true);
  });

  it("marks pool-wired arms as deliberate but generated ones as not", () => {
    const r = route({
      flows: [makes("a", WATER, 60), makes("b", WATER, 60), takes("c", WATER, 120)],
      connections: [conn("a", `hub:${WATER}`, WATER)],
    });
    expect(r.edges.find((e) => e.from === "a")!.manual).toBe(true);
    expect(r.edges.find((e) => e.from === "b")!.manual).toBe(false);
  });

  it("only lets hand-drawn belts be deleted", () => {
    const r = route({
      flows: [makes("a", WATER, 120), takes("b", WATER, 60), takes("c", WATER, 60)],
      connections: [conn("a", "b", WATER)],
    });
    expect(r.edges.find((e) => e.kind === "manual")).toBeDefined();
    expect(r.edges.filter((e) => e.kind !== "manual").every((e) => !e.manual)).toBe(true);
  });
});

describe("belts that cannot deliver", () => {
  it("finds a hand-drawn belt whose source cannot keep up", () => {
    // The case a site-level balance cannot see: 240 Water on site, plenty for the 200
    // the refinery wants, but the belt you drew comes off one extractor making 120.
    const r = route({
      flows: [makes("w1", WATER, 120), makes("w2", WATER, 120), takes("acid", WATER, 200)],
      connections: [conn("w1", "acid", WATER)],
    });
    const short = underfedBelts(r.edges);
    expect(short).toHaveLength(1);
    expect(short[0].under).toBe(80);
    expect(short[0].from).toBe("w1");
  });

  it("says nothing about a belt that delivers", () => {
    const r = route({
      flows: [makes("w1", WATER, 200), takes("acid", WATER, 200)],
      connections: [conn("w1", "acid", WATER)],
    });
    expect(underfedBelts(r.edges)).toEqual([]);
  });

  it("never blames a manifold arm", () => {
    // An arm carries whatever the pool had, so it cannot come up short by construction.
    // Only a belt someone drew can promise more than its source has.
    const r = route({
      flows: [
        makes("a", WATER, 60), makes("b", WATER, 60),
        takes("c", WATER, 500), takes("d", WATER, 500),
      ],
    });
    expect(r.hubs).toHaveLength(1);
    expect(underfedBelts(r.edges)).toEqual([]);
  });

  it("puts the worst shortfall first", () => {
    const r = route({
      flows: [
        makes("s1", WATER, 10), takes("t1", WATER, 100),
        makes("s2", ACID, 10), takes("t2", ACID, 200),
      ],
      connections: [conn("s1", "t1", WATER), conn("s2", "t2", ACID)],
    });
    expect(underfedBelts(r.edges).map((e) => e.under)).toEqual([190, 90]);
  });
});
