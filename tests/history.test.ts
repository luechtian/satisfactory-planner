import { describe, expect, it } from "vitest";
import {
  canRedo, canUndo, emptyHistory, record, redo, undo, type History, type Step,
} from "../src/core/history";
import type { Plan } from "../src/core/types";

/**
 * What counts as one step. Dragging a node fires an update per pointer move, so the
 * difference between a usable undo and an unusable one is entirely in the coalescing
 * rules below.
 */

const plan = (marker: string): Plan => ({
  version: 1,
  sites: [{ id: marker, name: marker, nodes: [], targets: [], imports: [] }],
});
const step = (marker: string, siteId = "here"): Step => ({ plan: plan(marker), siteId });
const marks = (steps: Step[]) => steps.map((s) => s.plan.sites[0].name);

/** Record a run of edits, each `gap` ms after the last. */
function run(entries: Array<[marker: string, tag?: string]>, gap = 100): History {
  let h = emptyHistory();
  entries.forEach(([marker, tag], i) => {
    h = record(h, step(marker), tag, i * gap);
  });
  return h;
}

describe("what becomes a step", () => {
  it("keeps one entry per discrete edit", () => {
    const h = run([["a"], ["b"], ["c"]]);
    expect(marks(h.past)).toEqual(["a", "b", "c"]);
  });

  it("collapses a run sharing a tag into the state before it started", () => {
    // A drag: forty pointer moves, one thing to undo.
    const h = run([["a", "move:n1"], ["b", "move:n1"], ["c", "move:n1"]]);
    expect(marks(h.past)).toEqual(["a"]);
  });

  it("starts a new step once the gesture pauses", () => {
    const h = run([["a", "move:n1"], ["b", "move:n1"]], 5000);
    expect(marks(h.past)).toEqual(["a", "b"]);
  });

  it("keeps different tags apart", () => {
    // Dragging one node then another is two steps, however quickly they follow.
    const h = run([["a", "move:n1"], ["b", "move:n2"]]);
    expect(marks(h.past)).toEqual(["a", "b"]);
  });

  it("never collapses untagged edits, however fast they arrive", () => {
    // Solve, then delete a site: each is a single thing to take back.
    const h = run([["a"], ["b"]], 0);
    expect(marks(h.past)).toEqual(["a", "b"]);
  });

  it("does not collapse a tagged edit into an untagged one before it", () => {
    const h = run([["a"], ["b", "move:n1"]], 0);
    expect(marks(h.past)).toEqual(["a", "b"]);
  });
});

describe("stepping back and forward", () => {
  it("hands back the previous state and banks the current one", () => {
    const h = run([["a"], ["b"]]);
    const back = undo(h, step("now"))!;
    expect(back.step.plan.sites[0].name).toBe("b");
    expect(marks(back.history.past)).toEqual(["a"]);
    expect(marks(back.history.future)).toEqual(["now"]);
  });

  it("walks all the way back and all the way forward again", () => {
    let h = run([["a"], ["b"]]);
    const first = undo(h, step("now"))!;
    h = first.history;
    const second = undo(h, first.step)!;
    expect(second.step.plan.sites[0].name).toBe("a");

    const forward = redo(second.history, second.step)!;
    expect(forward.step.plan.sites[0].name).toBe("b");
    expect(marks(redo(forward.history, forward.step)!.history.past)).toEqual(["a", "b"]);
  });

  it("returns null at either end rather than throwing", () => {
    expect(undo(emptyHistory(), step("now"))).toBeNull();
    expect(redo(emptyHistory(), step("now"))).toBeNull();
    expect(canUndo(emptyHistory())).toBe(false);
    expect(canRedo(emptyHistory())).toBe(false);
  });

  it("throws the future away as soon as you edit instead of redoing", () => {
    const back = undo(run([["a"], ["b"]]), step("now"))!;
    expect(canRedo(back.history)).toBe(true);
    expect(canRedo(record(back.history, step("elsewhere"), undefined, 999))).toBe(false);
  });

  it("does not let the next edit coalesce into the state it just restored", () => {
    // Undo mid-drag, then drag again: the restored state must survive as its own step
    // rather than being swallowed by a tag that happens to match.
    const dragged = run([["a", "move:n1"], ["b", "move:n1"]]);
    const back = undo(dragged, step("now"))!;
    const after = record(back.history, step("restored"), "move:n1", 150);
    expect(marks(after.past)).toEqual(["restored"]);
  });
});

describe("remembering where you were", () => {
  it("carries the site each change was made on", () => {
    const h = record(emptyHistory(), step("a", "smelting"), undefined, 0);
    expect(undo(h, step("now", "power"))!.step.siteId).toBe("smelting");
  });

  it("sends you forward to where the redone change belongs", () => {
    const back = undo(record(emptyHistory(), step("a", "smelting"), undefined, 0), step("b", "power"))!;
    expect(redo(back.history, back.step)!.step.siteId).toBe("power");
  });
});

describe("bounds", () => {
  it("drops the oldest steps rather than growing without limit", () => {
    const h = run(Array.from({ length: 200 }, (_, i) => [`e${i}`] as [string]));
    expect(h.past.length).toBeLessThanOrEqual(60);
    // The most recent are the ones kept.
    expect(h.past[h.past.length - 1].plan.sites[0].name).toBe("e199");
  });
});
