# Satisfactory Planner

Plan production for [Satisfactory](https://www.satisfactorygame.com/) as a node graph.
Say what a factory should ship, and it works out the machine counts, power draw, raw
extraction and every item balance — across as many sites as you want to build.

**→ [Try it](https://luechtian.github.io/satisfactory-planner/)** · no install, no account

![The planner with a solved aluminium chain](docs/screenshot.png)

Runs entirely in your browser. Nothing is uploaded, there is no backend, and recipe data
comes from the game's own files rather than a hand-maintained list.

## What it does

**Solves backwards from a target.** Ask for 360 Aluminum Ingot/min and one click turns an
empty canvas into a complete factory: every machine count, the intermediate steps you
forgot, and miners for the ores nothing else covers.

**Counts whole machines.** You cannot build 1.5 Refineries, so it doesn't pretend you
can. Rounding a stage up raises demand on the stage above it, and the counts are
re-derived from each other until they settle — the same arithmetic you would do by hand.
Prefer exact rates? Tick *underclock to avoid surplus* and each stage is clocked onto its
demand instead.

**Knows about byproducts and loops.** Alumina Solution drinks water that Aluminum Scrap
hands back; the solve nets that out. Asking for Silica reaches for Raw Quartz rather than
scaling Alumina Solution to nine refineries to farm the byproduct.

**Handles extractors properly.** Miners, pumps and wells are nodes with a node purity and
a clock, and their power counts toward the total — leaving it out understates a
factory's draw by around 40%.

**Scales to a whole save.** Split work across sites, link one site's surplus to another's
shortfall, and see the lot on an **All sites** page: a map of which site feeds which,
power per group, raw extraction rolled up, and every item that crosses a boundary sorted
into what nothing covers, what could be routed, and what is simply spare.

**Draws the belts, or lets you.** One machine feeding one other gets a plain arrow; where
several make an item and several take it, they meet at a manifold. Drag between ports to
wire something specific — that is how you say two water extractors are separate
sub-factories rather than a shared pool. A machine that recycles its own input, like the
Blender making Encased Uranium Cells, is shown as a net consumer until you wire one of
those ports; then both run at gross rates so the returned fluid can go where you send it.
You can wire straight to a manifold too, which puts that machine on the pool and shows
both its arms rather than one netted figure. Manifolds, imports, exports and targets can
all be dragged where you want them; **Tidy layout** puts them back.

## Quick start

Requires Node 20.19+ (Vite 8) and, only for regenerating recipe data, Python 3.9+.

```bash
git clone https://github.com/luechtian/satisfactory-planner
cd satisfactory-planner
npm install
npm run dev            # http://localhost:5199
```

`public/data.json` is committed, so this works without the game installed. To regenerate
it from your own copy — after a game update, say:

```bash
python scripts/extract_docs.py
```

It looks for the usual Steam library paths. If yours is elsewhere:

```bash
python scripts/extract_docs.py "D:/Steam/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json"
```

## Where plans are stored

In `localStorage`, scoped to the origin. Sites, machine counts, clocks, node positions,
targets, imports and hand-drawn belts all survive a reload and a browser restart, but:

- they are per browser **and** per profile, and never sync anywhere;
- clearing site data wipes them, and private windows lose them on close;
- two tabs on the same plan will clobber each other, last write wins.

**Export** writes a JSON file. That is the only durable copy, and the only way to hand a
plan to someone else.

## How the solver works

`src/core/solver.ts`, two passes.

**Forward** — `evaluateSite` takes machine counts and sums production against consumption
per item.

**Backward** — `solveSite` takes targets and finds counts that meet them. An iterative
pass discovers which recipes the chain needs, the resulting square system is solved
exactly by Gaussian elimination, and the rates are then turned into whole machines. Three
things a naive expansion gets wrong:

- **Byproducts credit, they never justify.** A recipe is scaled for its primary product
  only, otherwise a byproduct becomes a reason to overbuild its parent.
- **Whole machines change the answer upstream.** 1.5 Aluminum Scrap refineries become 2,
  and 2 of them eat 480 Alumina rather than 360 — which is 4 Alumina refineries, not 3.
- **Loops must close.** The iterative pass alone overshoots, because rates only climb and
  one gets locked in before the byproduct credit arrives.

## Tests

```bash
npm test
```

Vitest, no browser, ~300ms. Two suites:

- `tests/solver.test.ts` — balances, whole-machine derivation, byproduct credit, water
  loops, idempotent solving, cross-site links and derived exports.
- `tests/routing.test.ts` — what the canvas connects to what. Every case in it is a bug
  that shipped: a machine recycling its own input becoming unreachable, hand-drawn belts
  being silently topped up from elsewhere, import and export nodes losing their wires.

That second file is why `src/core/routing.ts` exists as its own module. The logic used to
live inside a `useMemo` in the canvas component, where none of it could be tested — and
every routing bug so far has been pure logic rather than rendering.

## Recipe data

`scripts/extract_docs.py` reads `Docs.json`, which the game ships in
`CommunityResources` for exactly this purpose, and normalises the awkward parts:

- UTF-16, with nested structs stored as Unreal property-blob strings.
- Fluids and gases recorded in litres, 1000× the in-game m³ display.
- Most alternate recipes carry a `Recipe_Alternate_` class prefix — but some, such as
  `Recipe_PureAluminumIngot_C`, are only marked in the display name.
- Buildings, paint and handcraft-only entries filtered out.

Current dump: **291 recipes** (111 alternate), 168 items, 17 machines.

## Not built yet

- **LP optimiser** — "maximise X given these ore nodes", choosing among alternates. The
  data model is ready; HiGHS-WASM over the same recipe matrix would do it. It is also
  what would make raw supply a real constraint rather than a note.
- **Route-aware solving.** The solver works on site-level totals, so it can call a site
  balanced while a belt you drew by hand is short. The belt turns red, but the plan does
  not.
- **Joint solving across links.** Links are checked, not solved together: if A draws from
  B while B draws from A, each number is sensible on its own but the pair never resolves.
- **Live comparison against a running game**, which would need the
  [FicsIt Remote Monitoring](https://docs.ficsit.app/ficsitremotemonitoring/latest/json/json.html)
  mod. Vanilla installs expose nothing.
- **Belt and pipe throughput limits** — a Mk.6 belt caps at 1200/min and a Mk.2 pipe at
  600 m³/min, so a plan can call for more than one line can physically carry.

## Project layout

```
scripts/extract_docs.py   Docs.json -> public/data.json
src/core/types.ts         data + plan model
src/core/data.ts          indexing, search, power
src/core/solver.ts        forward + backward passes
src/core/layout.ts        layered auto-layout
src/core/routing.ts       what connects to what, and at what rate
src/core/overview.ts      cross-site rollup and links
src/store/planStore.ts    zustand state, localStorage
src/ui/                   canvas, nodes, panels, tabs
```

Built with [React Flow](https://reactflow.dev), [Zustand](https://zustand-demo.pmnd.rs)
and [Vite](https://vite.dev).

## Deploying

`npm run build` produces a static `dist/`. `.github/workflows/deploy.yml` publishes to
GitHub Pages on every push to `main` — set **Settings → Pages → Source: GitHub Actions**
before the first run, or `configure-pages` fails with `Get Pages site failed … Not Found`.

`base: "./"` in `vite.config.ts` is what lets it work from a `/<repo>/` subpath.

## Licence and attribution


Satisfactory is a game by [Coffee Stain Studios](https://www.coffeestainstudios.com/).
This project is unofficial and unaffiliated. Item and recipe names come from the game's
own `CommunityResources` data dump, which exists for community tools like this one.

The planner itself is [MIT licensed](LICENSE) — use it, fork it, ship it.
