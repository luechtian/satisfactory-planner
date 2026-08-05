import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexDb, type Db } from "../src/core/data";
import type { RouteEdge } from "../src/core/routing";
import { linesFor, overCapacity, type Capacity } from "../src/core/throughput";

const db: Db = indexDb(JSON.parse(readFileSync("public/data.json", "utf8")));
const item = (name: string) => Object.values(db.items).find((i) => i.name === name)!.class;

const IRON = item("Iron Ore");
const WATER = item("Water");
const GAS = item("Nitrogen Gas");

/** Mk.5 belt, Mk.2 pipe — the defaults. */
const cap: Capacity = { belt: 780, pipe: 600 };

const edge = (over: Partial<RouteEdge>): RouteEdge => ({
  id: "e", from: "a", to: "b", item: IRON, rate: 0,
  kind: "direct", short: false, under: 0, manual: false, ...over,
});

describe("which limit applies", () => {
  it("puts solids on belts and fluids in pipes", () => {
    // 700/min fits a Mk.5 belt but not a Mk.2 pipe: the same number, two answers.
    expect(linesFor(db, IRON, 700, cap)).toBe(1);
    expect(linesFor(db, WATER, 700, cap)).toBe(2);
  });

  it("treats a gas as a fluid", () => {
    // Gases are m³ like liquids. Checked against the belt limit they would look fine at
    // any rate at all, which is the sort of thing that only shows up in the game.
    expect(linesFor(db, GAS, 700, cap)).toBe(2);
  });
});

describe("counting lines", () => {
  it("needs none for nothing", () => {
    expect(linesFor(db, IRON, 0, cap)).toBe(0);
  });

  it("fits exactly one line at exactly the limit", () => {
    expect(linesFor(db, IRON, 780, cap)).toBe(1);
  });

  it("needs a second line a hair over", () => {
    expect(linesFor(db, IRON, 780.5, cap)).toBe(2);
  });

  it("rounds up to whole lines, since half a belt is not a thing", () => {
    expect(linesFor(db, IRON, 1561, cap)).toBe(3);
  });

  it("says nothing about an item it has never heard of", () => {
    expect(() => linesFor(db, "Desc_Nonsense_C", 100, cap)).not.toThrow();
  });
});

describe("finding the arrows that do not fit", () => {
  it("keeps only what one line cannot carry, worst first", () => {
    const found = overCapacity(db, [
      edge({ id: "ok", rate: 600 }),
      edge({ id: "double", rate: 900 }),
      edge({ id: "triple", rate: 2000 }),
    ], cap);
    expect(found.map((o) => o.edge.id)).toEqual(["triple", "double"]);
    expect(found[0].lines).toBe(3);
    expect(found[0].limit).toBe(780);
  });

  it("checks each arm of a manifold on its own", () => {
    // Three arms of 500 are three belts, not one 1500 belt — the pool is not a line.
    const found = overCapacity(db, [
      edge({ id: "a", to: "hub:x", kind: "into-hub", rate: 500 }),
      edge({ id: "b", to: "hub:x", kind: "into-hub", rate: 500 }),
      edge({ id: "c", to: "hub:x", kind: "into-hub", rate: 500 }),
    ], cap);
    expect(found).toEqual([]);
  });

  it("follows the tier you actually have", () => {
    const mk1: Capacity = { belt: 60, pipe: 300 };
    expect(overCapacity(db, [edge({ rate: 120 })], cap)).toEqual([]);
    expect(overCapacity(db, [edge({ rate: 120 })], mk1)[0].lines).toBe(2);
  });
});
