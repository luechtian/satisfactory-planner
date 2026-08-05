import { describe, expect, it } from "vitest";
import {
  applyMerge, looseLinks, parsePlan, previewMerge, subsetPlan,
} from "../src/core/transfer";
import type { Plan, Site } from "../src/core/types";

/**
 * Exchanging sites between two people working one save. The thing every case here is
 * really guarding is that importing someone else's work never quietly takes yours with
 * it — the whole reason export stopped being all-or-nothing.
 */

const IRON = "Desc_OreIron_C";

const site = (id: string, over: Partial<Site> = {}): Site => ({
  id, name: id, nodes: [], targets: [], imports: [], ...over,
});
const plan = (...sites: Site[]): Plan => ({ version: 1, sites });
const ids = (p: Plan) => p.sites.map((s) => s.id);

/** An import drawn from another site, i.e. a cross-site link. */
const drawnFrom = (from: string, perMinute = 120) => ({
  id: `f${from}`, item: IRON, perMinute, from,
});

describe("choosing what to export", () => {
  it("keeps only the selection, in plan order", () => {
    const p = plan(site("a"), site("b"), site("c"));
    expect(ids(subsetPlan(p, ["c", "a"]))).toEqual(["a", "c"]);
  });

  it("writes a whole plan file, so a partial export still opens on its own", () => {
    const out = subsetPlan(plan(site("a"), site("b")), ["a"]);
    expect(out.version).toBe(1);
    expect(() => parsePlan(JSON.stringify(out))).not.toThrow();
  });

  it("selecting everything reproduces the whole plan exactly", () => {
    // The default state of the export dialog, and the backup path it replaced.
    const p = plan(site("a"), site("b"), site("c"));
    expect(subsetPlan(p, p.sites.map((s) => s.id))).toEqual(p);
  });

  it("flags a link whose source is not coming along", () => {
    const p = plan(site("mine"), site("smelt", { imports: [drawnFrom("mine")] }));
    expect(looseLinks(subsetPlan(p, ["smelt"]).sites, new Set(["smelt"]))).toEqual([
      { siteId: "smelt", siteName: "smelt", item: IRON },
    ]);
  });

  it("says nothing when the source travels too", () => {
    const p = plan(site("mine"), site("smelt", { imports: [drawnFrom("mine")] }));
    expect(looseLinks(p.sites, new Set(["mine", "smelt"]))).toEqual([]);
  });
});

describe("previewing a file", () => {
  it("separates sites that are new from ones that would overwrite", () => {
    const rows = previewMerge(plan(site("a")), plan(site("a"), site("b")));
    expect(rows.map((r) => [r.site.id, !!r.replaces])).toEqual([["a", true], ["b", false]]);
  });

  it("hands back the site that would be lost, so the dialog can name it", () => {
    const rows = previewMerge(plan(site("a", { name: "mine" })), plan(site("a", { name: "theirs" })));
    expect(rows[0].replaces?.name).toBe("mine");
  });
});

describe("merging", () => {
  it("leaves out anything not accepted — the whole point", () => {
    const mine = plan(site("power", { name: "my power" }));
    const theirs = plan(site("power", { name: "their power" }), site("new"));
    const merged = applyMerge(mine, theirs, ["new"]);
    expect(merged.sites.find((s) => s.id === "power")!.name).toBe("my power");
    expect(ids(merged)).toEqual(["power", "new"]);
  });

  it("replaces in place rather than shuffling the tab order", () => {
    const mine = plan(site("a"), site("b"), site("c"));
    const merged = applyMerge(mine, plan(site("b", { name: "updated" })), ["b"]);
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged.sites[1].name).toBe("updated");
  });

  it("appends genuinely new sites at the end", () => {
    const merged = applyMerge(plan(site("a")), plan(site("z")), ["z"]);
    expect(ids(merged)).toEqual(["a", "z"]);
  });

  it("keeps where you had put the site on the map", () => {
    // An update to a site's contents should not rearrange a board they never saw.
    const mine = plan(site("a", { mapPosition: { x: 10, y: 20 } }));
    const theirs = plan(site("a", { name: "updated", mapPosition: { x: 900, y: 900 } }));
    const merged = applyMerge(mine, theirs, ["a"]);
    expect(merged.sites[0]).toMatchObject({ name: "updated", mapPosition: { x: 10, y: 20 } });
  });

  it("takes the incoming map position when you never placed it", () => {
    const merged = applyMerge(
      plan(site("a")), plan(site("a", { mapPosition: { x: 5, y: 5 } })), ["a"],
    );
    expect(merged.sites[0].mapPosition).toEqual({ x: 5, y: 5 });
  });

  it("accepting nothing changes nothing", () => {
    const mine = plan(site("a"));
    expect(applyMerge(mine, plan(site("b")), [])).toBe(mine);
  });

  it("never drops a site you already had", () => {
    const merged = applyMerge(plan(site("a"), site("b")), plan(site("c")), ["c"]);
    expect(ids(merged)).toEqual(["a", "b", "c"]);
  });
});

describe("links across a partial exchange", () => {
  it("carries a dangling link rather than stripping it", () => {
    // Their smelter draws from a mining site you have not been given yet.
    const merged = applyMerge(
      plan(site("mine-of-my-own")),
      plan(site("smelt", { imports: [drawnFrom("theirmine")] })),
      ["smelt"],
    );
    expect(merged.sites.find((s) => s.id === "smelt")!.imports[0].from).toBe("theirmine");
  });

  it("re-forms on its own once the other end arrives", () => {
    const first = applyMerge(
      plan(site("a")),
      plan(site("smelt", { imports: [drawnFrom("theirmine")] })),
      ["smelt"],
    );
    const second = applyMerge(first, plan(site("theirmine")), ["theirmine"]);
    const known = new Set(ids(second));
    expect(looseLinks(second.sites, known)).toEqual([]);
  });
});

describe("reading a file", () => {
  it("accepts a plan it just wrote", () => {
    const p = plan(site("a"));
    expect(parsePlan(JSON.stringify(p))).toEqual(p);
  });

  it.each([
    ["not JSON at all", "{{{"],
    ["a different version", JSON.stringify({ version: 2, sites: [] })],
    ["no sites", JSON.stringify({ version: 1, sites: [] })],
    ["a site missing its arrays", JSON.stringify({ version: 1, sites: [{ id: "a", name: "a" }] })],
  ])("rejects %s", (_label, text) => {
    expect(() => parsePlan(text)).toThrow();
  });
});
