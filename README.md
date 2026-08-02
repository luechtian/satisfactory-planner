# Satisfactory Planner

Production planner for Satisfactory. Plan sites as a node graph, set a target output,
and let it derive machine counts, power draw and item balances — the automated version
of hand-tuning `Anzahl` and `Bilanz` columns in a spreadsheet.

Runs entirely in the browser. No backend, no account, no network calls.

## Setup

Recipe data comes from the game's own data dump, so nothing is hardcoded and it survives
game patches. Generate it once:

```bash
python scripts/extract_docs.py          # auto-detects the Steam install
npm install
npm run dev
```

If the script can't find your install, pass the path:

```bash
python scripts/extract_docs.py "H:/steam/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json"
```

Re-run it after a game update to pick up new or changed recipes.

## Using it

- **Sites** are the tabs across the top — one per factory location. Double-click to rename.
- **Add recipes** from the left panel; search matches recipe, product or machine name.
- **Anzahl / Clock %** on each node work like the spreadsheet, and every rate updates live.
- **Targets** (right panel) say what the site must ship out. **Solve for targets** works
  backwards through the chain, sets every machine count, and adds any missing steps.
- **Imports** are items belted or trained in from another site, so they aren't flagged
  as shortages.
- **Shortages / Surplus** is the `Bilanz` column. **Raw extraction needed** is what has
  to come out of the ground.
- Plans live in `localStorage`; **Export**/**Import** writes a JSON file for backup.

Italic port names on a node mean nothing on the canvas feeds or takes that item — it
crosses the site boundary. A `by` tag marks a byproduct.

## How the solver works

Two passes, in `src/core/solver.ts`:

**Forward** (`evaluateSite`) — given machine counts, sum production and consumption per
item. Direct replacement for hand-written balance formulas.

**Backward** (`solveSite`) — given targets, find the machine counts that meet them.
An iterative pass discovers which recipes the chain needs, then the resulting square
system is solved exactly by Gaussian elimination. Two details a naive expansion gets
wrong:

- **Byproducts only credit, never justify.** A recipe is scaled for its primary product
  only. Otherwise asking for Silica scales Alumina Solution to 9 refineries to farm the
  byproduct instead of reaching for Raw Quartz.
- **Loops close properly.** Alumina Solution drinks water that Aluminum Scrap hands back.
  The exact solve nets this out; the iterative pass alone overshoots, because rates only
  climb and one gets locked in before the credit arrives.

## Data notes

`scripts/extract_docs.py` handles the awkward parts of `Docs.json`:

- UTF-16, with nested structs stored as Unreal property-blob strings.
- Fluids and gases are recorded in litres, 1000x the in-game m³ display.
- Most alternate recipes carry a `Recipe_Alternate_` class prefix, but some
  (e.g. `Recipe_PureAluminumIngot_C`) are only marked in the display name.
- Buildings, paint and handcraft-only entries are filtered out of the recipe list.

Current dump: **291 recipes** (111 alternate), 168 items, 17 machines.

## Not built yet

- **LP optimizer** — "maximize X given these ore nodes", choosing among alternates.
  The data model is ready for it; drop in HiGHS-WASM over the same recipe matrix.
- **Live watcher** — comparing plan against the running game needs the
  [FicsIt Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/json/json.html)
  mod, which exposes `/getFactory` over HTTP. Vanilla installs expose nothing.
- Cross-site routing (one site's surplus auto-filling another's imports).
- Miner/extractor nodes with node purity and clock.

## Layout

```
scripts/extract_docs.py   Docs.json -> public/data.json
scripts/smoke.ts          solver sanity check (npx tsx scripts/smoke.ts)
src/core/types.ts         data + plan model
src/core/data.ts          indexing, search, power
src/core/solver.ts        forward + backward passes
src/core/layout.ts        layered auto-layout
src/store/planStore.ts    zustand state, localStorage
src/ui/                   canvas, nodes, panels
```
