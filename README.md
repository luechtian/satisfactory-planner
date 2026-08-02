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
- **Extractors** (miners, pumps, wells) sit above the recipe list. Place one, then pick
  its resource and node purity on the node itself. Solving sizes an extractor just like
  a Constructor, and its power counts toward the total.
- **Anzahl / Clock %** on each node work like the spreadsheet, and every rate updates live.
- **Targets** (right panel) say what the site must ship out. **Solve for targets** works
  backwards through the chain, sets every machine count, and adds any missing steps.
- **Imports** are manufactured parts belted or trained in from another site, so they
  aren't flagged as shortages.
- **Raw supply** lists every ore, fluid and gas the site burns: what it **needs**, what
  the **site** already yields (extractor nodes plus byproducts), and a **belt** box for
  anything trained in from elsewhere. A row settles to 0 when it's covered, or shows the
  shortfall in red. Place extractors for resources you mine here; use the belt column
  for resources that arrive from another site.
- **Shortages / Surplus** is the `Bilanz` column, for manufactured items only — raws are
  excluded so they don't sit in the shortage list permanently.
- Plans live in `localStorage`; **Export**/**Import** writes a JSON file for backup.

## Where your plans live

Sites persist automatically — nodes, counts, clocks, positions, targets and imports all
survive a reload and a browser restart. But `localStorage` is **scoped to the origin**,
so `http://localhost:5199` is effectively the filing cabinet. Consequences worth knowing:

- The dev port is pinned to **5199** with `strictPort`. Change it and your existing plans
  stop appearing (they aren't deleted, just filed under a different origin).
- Per browser **and** per profile. Nothing syncs between Chrome and Firefox, or machines.
- "Clear browsing data" / "cookies and site data" wipes them. Private windows lose them
  on close.
- Last write wins, no history. Two tabs open on the same plan will clobber each other.

**Export** anything you'd be annoyed to lose. That JSON file is the only durable copy.

Italic port names on a node mean nothing on the canvas feeds or takes that item — it
crosses the site boundary. A `by` tag marks a byproduct.

## Hosting on GitHub Pages

The build is fully static, so Pages serves it as-is. `.github/workflows/deploy.yml`
builds and publishes on every push to `main`:

1. Create the repo and push.
2. **Settings → Pages → Source: "GitHub Actions".** Do this before the first run, or
   `configure-pages` fails with `Get Pages site failed … Not Found`. The action has an
   `enablement: true` input that looks like it would handle this, but it needs
   admin/pages-write credentials the default `GITHUB_TOKEN` doesn't carry.
3. Re-run the failed job. It lands at `https://<user>.github.io/<repo>/`.

Two things make this work, both easy to break:

- `base: "./"` in `vite.config.ts`. Pages serves project sites from `/<repo>/`, and
  Vite's default absolute `/assets/...` would resolve to the domain root and 404 into
  a blank page.
- **`public/data.json` is committed.** The runner has no game install, so CI cannot run
  the ETL. Regenerate and commit it after a game patch, or the hosted copy goes stale.

Note that the deployed page is public, and it carries Coffee Stain's item and recipe
names. That is what the game's `CommunityResources` folder exists for and what every
community planner does, but it is worth knowing you are republishing game data.

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
  This is also what would make **Raw supply** a real constraint: today a supply rate
  settles the balance but does not stop the solver asking for more than you have.
- **Live watcher** — comparing plan against the running game needs the
  [FicsIt Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/json/json.html)
  mod, which exposes `/getFactory` over HTTP. Vanilla installs expose nothing.
- Cross-site routing (one site's surplus auto-filling another's imports).
- **Multiple extractors on one resource.** The solver sizes an extractor only when a
  resource has exactly one; several means deliberate hand-placement across differing
  purities, and there's no non-arbitrary way to split a target between them. Those keep
  their manual counts and still count toward the balance.
- Belt and pipe throughput limits (a Mk5 belt caps at 780/min, pipes at 600 m³).

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
