# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                      # node_modules is not committed; nothing runs without this
npm run dev                      # http://localhost:5199 — strictPort, a clash fails loudly
npm test                         # vitest run, no browser, under a second
npm run test:watch
npm run lint                     # oxlint (not eslint)
npm run build                    # tsc -b && vite build — this is also the typecheck
npm run preview                  # serve dist/ on 5199
```

Single test file or case:

```bash
npx vitest run tests/routing.test.ts
npx vitest run -t "goes short rather than reaching for another source"
```

CI (`.github/workflows/ci.yml`) runs lint, test, build on Node 22. `.github/workflows/deploy.yml`
publishes `dist/` to GitHub Pages on push to `main`.

Regenerating recipe data needs Python 3.9+ and a game install; `public/data.json` is committed, so
this is only for game updates:

```bash
python scripts/extract_docs.py                          # probes the usual Steam paths
python scripts/extract_docs.py "<path>/Docs/en-US.json"  # or say where it is
```

## Architecture

The README covers what the app does and how the solver reasons. What follows is the structural
shape that spans files.

### Pure core, React shell

`src/core/*` imports no React and touches no DOM. Every rule that could be wrong lives there and is
callable from a test; `src/ui/*` turns the results into React Flow shapes. `src/core/routing.ts`
exists as its own module *because* of this — the logic used to live inside a `useMemo` in
`Canvas.tsx` where none of it was reachable by a test. Resist moving decisions back up into
components.

### Data flow

`loadDb()` fetches `public/data.json` and `indexDb()` builds the `Db` once at startup. The ranking
in `producersOf` is load-bearing, not cosmetic: index 0 must be "the obvious way to make this"
(primary product beats byproduct, standard beats alternate), and the solver's default recipe choice
reads straight off it.

Everything downstream is derived per render from `plan` + `db`:

```
plan (zustand/localStorage)
  └─ evaluateSite(db, site, owed)  → SiteResult (per-node rates, balances, power)
       ├─ Canvas → routeGraph()    → edges + manifolds
       ├─ BalancePanel
       └─ summarisePlan(db, plan)  → the All-sites page
```

### Derived, never stored

A recurring rule, and the source of several past bugs:

- **Exports** are read off the *consuming* site's import (`exportsOf` in `core/overview.ts`), so a
  link has one record and the two ends cannot drift.
- **Sink, source and manifold nodes** are synthesised every render with synthetic ids —
  `target:`, `export:`, `import:`, `hub:`. They match no `PlanNode`, so `Canvas.onNodesChange` must
  route them away from `updateNode`; only their drag position is kept, in `site.sinkPositions`.
- Hand-drawn belts (`site.connections`) *are* stored, because rates alone cannot say whether two
  water extractors feed one pool or two sub-factories.

### Exchanging sites (`core/transfer.ts`)

Two people share one save by swapping sites, so export takes a selection and import
merges. **Sites are identified by id, never by name** — an id is shared exactly when the
site came from the other person's export, which is when "newer copy of the same thing" is
true. A partial export is still a `{version: 1, sites}` plan, deliberately not a second
file format, so it opens standalone and old whole-plan files merge in through the same
path.

Cross-site links (`imports[].from`) are **never rewritten** on the way through. A `from`
naming an absent site stays dangling, is already reported by `summarisePlan.brokenLinks`,
and re-forms by itself when that site later arrives. Stripping it would lose the fact it
ever had a source.

### Solver shape (`core/solver.ts`)

`solveSite` runs: iterative discovery of which recipes the chain needs → `solveExact` (Gaussian
elimination on the now-square system, which is what nets out byproducts and loops) → whole-building
derivation. That last step has **two strategies that are never mixed** — default `integerise`
(re-derive counts from each other at 100% clock) or `trimClocks` (ceil once and underclock onto the
number). Mixing exact rates with re-derived counts is what produced a 114% Silica clock.

Extractors become synthetic one-product recipes (`extract:<nodeId>`) so a miner sizes like a
Constructor — but only where a resource has exactly one extractor node, since splitting a target
across differing purities is arbitrary.

`EPS` (1e-6) is arithmetic tolerance; `DISPLAY_EPS` (1e-3) is what counts as short or spare. Use
`DISPLAY_EPS` for anything the user sees, or 4-decimal clocks leave phantom shortages.

### State (`store/planStore.ts`)

Zustand with `persist` under key `satisfactory-planner`. `partialize` deliberately keeps `theme`
and `trimClocks` out of the plan so they never land in an export, and keeps `history` out of
storage entirely — undo is a session thing.

**Every plan write goes through the local `write()` helper**, via `mutate` / `mutateSite` or
directly. That is load-bearing rather than stylistic: `write` is what records undo history, so a
new action reaching for `set({ plan })` is silently not undoable. It also defines "nothing
changed" — returning the same plan reference records no step, which is how no-ops like re-adding
an existing belt avoid spending an undo.

### Undo (`core/history.ts`)

Snapshots, not inverse operations. The plan is plain data updated by spreading, so untouched sites
are shared between snapshots and keeping 60 costs little; writing an inverse for two dozen actions
would be a lot of code whose bugs show up as silent corruption.

The rule worth knowing is **coalescing**. `write` takes a `tag`, and edits sharing one within
600ms collapse into a single step. A node drag fires an update per pointer move and typing a rate
fires one per digit — untagged, undo would walk back through a drag pixel by pixel. `updateNode`
tags by node id *plus the patched field names*, so a drag coalesces with the rest of that drag but
not with the count changed straight after it. Discrete actions (solve, delete, import) pass no tag
and never coalesce.

Undo also restores `activeSiteId` from the snapshot, so taking back a change made on another site
takes you there — an edit you cannot see being undone reads as nothing happening.

`Plan.version` is 1 and import rejects anything else. Two fields are optional purely for
backwards compatibility with saved plans — `ManufacturerNode.kind` (never written by this app; only
extractors are marked) and `Site.connections` — so keep reading them defensively.

## Conventions

- **Comments carry the why, not the what.** Nearly every non-obvious block explains the failure it
  prevents or the alternative it rejects. Match that density; a change that removes a reason
  usually removes the only record of a bug.
- **Terminology: "buildings" in the interface, `Manufacturer` in the code.** The visible word for a
  Constructor, Refinery or Smelter is *building*. The type is `ManufacturerNode`, after the game's
  own `FGBuildableManufacturer` grouping, because "building" is equally true of an `ExtractorNode`
  and could not tell the two apart — and because one of the eleven is itself called the
  Manufacturer, which rules it out as a label. Don't reintroduce "machine".
- **Regression tests go in `tests/routing.test.ts`.** Every case in that file is a bug that
  shipped, and new routing fixes belong there in the same style.
- `tsconfig.app.json` includes only `src`, so `tsc -b` does **not** typecheck `tests/`. Type errors
  there surface only when vitest runs them.
- Fluids and gases are m³/min everywhere in the app; `extract_docs.py` divides the game's litres by
  1000 at the boundary, so nothing downstream should be scaling by 1000.
- Theming is CSS custom properties keyed off `data-theme` on `<html>`. React Flow's `Background`
  and `MiniMap` take colors as props, so they read the same variables via `var(--…)` rather than
  hardcoding a palette.
