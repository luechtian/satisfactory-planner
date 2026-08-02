import { fitMachines } from "../src/core/solver";
const cases: Array<[number, number]> = [
  [2.5, 100], [1.5, 100], [0.75, 100], [6, 100], [0.1, 100],
  [2.5, 250], [8, 100], [3, 100], [1, 100],
];
console.log("rate  clock-in ->  count x clock   check");
for (const [rate, mc] of cases) {
  const f = fitMachines(rate, mc);
  const back = f.count * (f.clock / 100);
  // Clock rounds up, so a hair of overproduction is expected; a shortfall is not.
  const ok = back >= rate - 1e-9 && back < rate + 1e-4 ? "ok" : `BAD ${back}`;
  console.log(`${String(rate).padStart(4)}  ${String(mc).padStart(4)}      ->  ${f.count} x ${String(f.clock).padStart(7)}%   ${ok}`);
}
