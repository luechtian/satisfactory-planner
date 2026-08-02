/** Sanity check for the solver: `npx tsx scripts/smoke.ts` */
import { readFileSync } from "node:fs";
import { indexDb } from "../src/core/data";
import { evaluateSite, solveSite, fmt } from "../src/core/solver";
import type { Site } from "../src/core/types";

const db = indexDb(JSON.parse(readFileSync("public/data.json", "utf8")));
const byName = (n: string) => {
  const r = db.recipes.find((r) => r.name === n && !r.alternate);
  if (!r) throw new Error(`no recipe ${n}`);
  return r.class;
};
const item = (n: string) => {
  const i = Object.values(db.items).find((i) => i.name === n);
  if (!i) throw new Error(`no item ${n}`);
  return i.class;
};

// The "alu" sheet, transcribed: 4 + 2 refineries and 6 foundries.
const alu: Site = {
  id: "alu", name: "alu", targets: [], imports: [],
  nodes: [
    { id: "a", recipe: byName("Alumina Solution"), count: 4, clock: 100, position: { x: 0, y: 0 } },
    { id: "b", recipe: byName("Aluminum Scrap"), count: 2, clock: 100, position: { x: 0, y: 0 } },
    { id: "c", recipe: byName("Aluminum Ingot"), count: 6, clock: 100, position: { x: 0, y: 0 } },
  ],
};

console.log("=== forward pass, counts from the spreadsheet ===");
const fwd = evaluateSite(db, alu);
for (const b of fwd.balances) {
  console.log(
    `  ${db.itemName(b.item).padEnd(18)} prod ${fmt(b.produced).padStart(7)}` +
    `  cons ${fmt(b.consumed).padStart(7)}  net ${fmt(b.net).padStart(8)}`,
  );
}
console.log(`  power: ${fmt(fwd.totalPowerMW, 1)} MW`);

console.log("\n=== backward pass, target 360 Aluminum Ingot/min ===");
const target: Site = { ...alu, targets: [{ id: "t", item: item("Aluminum Ingot"), perMinute: 360 }] };
const sol = solveSite(db, target);
for (const n of target.nodes) {
  console.log(`  ${db.recipeByClass[n.recipe].name.padEnd(18)} ${fmt(sol.counts[n.id], 4)} machines`);
}
for (const n of sol.added) {
  console.log(`  + ${db.recipeByClass[n.recipe].name.padEnd(16)} ${fmt(n.count, 4)} machines (added)`);
}
console.log("  feeds required:");
for (const f of sol.feeds) console.log(`    ${db.itemName(f.item).padEnd(16)} ${fmt(f.perMinute)}/min`);
console.log(`  diverged: ${sol.diverged}`);
