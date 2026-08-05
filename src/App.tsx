import { useEffect, useMemo, useState } from "react";
import { loadDb, type Db } from "./core/data";
import { exportsOf } from "./core/overview";
import { routeSite, underfedBelts } from "./core/routing";
import { evaluateSite } from "./core/solver";
import { overCapacity } from "./core/throughput";
import { selectCanRedo, selectCanUndo, usePlan } from "./store/planStore";
import { BalancePanel } from "./ui/BalancePanel";
import { Canvas } from "./ui/Canvas";
import { Overview } from "./ui/Overview";
import { PlanTransfer } from "./ui/PlanTransfer";
import { Sidebar } from "./ui/Sidebar";
import { SiteTabs } from "./ui/SiteTabs";
import "./styles.css";

export default function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDb().then(setDb, (e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="boot boot--error">{error}</div>;
  if (!db) return <div className="boot">Loading game data…</div>;
  return <Planner db={db} />;
}

function Planner({ db }: { db: Db }) {
  const plan = usePlan((s) => s.plan);
  const activeSiteId = usePlan((s) => s.activeSiteId);
  const { setActiveSite } = usePlan();

  const theme = usePlan((s) => s.theme);
  const toggleTheme = usePlan((s) => s.toggleTheme);
  const capacity = usePlan((s) => s.capacity);
  const [overview, setOverview] = useState(false);

  const site = plan.sites.find((s) => s.id === activeSiteId) ?? plan.sites[0];
  // What other sites draw from this one, so the balance reflects its commitments.
  const owed = useMemo(() => exportsOf(plan, site.id), [plan, site.id]);
  const otherSites = useMemo(
    () => plan.sites.filter((s) => s.id !== site.id).map((s) => ({ id: s.id, name: s.name })),
    [plan.sites, site.id],
  );
  const result = useMemo(() => evaluateSite(db, site, owed), [db, site, owed]);
  // Routed once here rather than inside the canvas, because the balance panel needs the
  // same answer to report on belts in words.
  const routed = useMemo(() => routeSite(site, result, owed), [site, result, owed]);
  const over = useMemo(
    () => overCapacity(db, routed.edges, capacity),
    [db, routed.edges, capacity],
  );
  const overLines = useMemo(
    () => new Map(over.map((o) => [o.edge.id, o.lines])),
    [over],
  );
  const underfed = useMemo(() => underfedBelts(routed.edges), [routed.edges]);

  // The palette hangs off a data-theme attribute on <html>, so native widgets and
  // scrollbars pick up color-scheme along with everything else.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">◆</span>
          Satisfactory Planner
        </div>

        <SiteTabs
          plan={plan}
          activeSiteId={activeSiteId}
          overview={overview}
          onOpenOverview={() => setOverview(true)}
          onOpenSite={(id) => { setOverview(false); setActiveSite(id); }}
        />

        <div className="io">
          <UndoRedo />
          <button
            className="btn btn--icon"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <PlanTransfer plan={plan} />
        </div>
      </header>

      {overview ? (
        <main className="layout layout--overview">
          <Overview
            db={db}
            plan={plan}
            onOpenSite={(id) => { setOverview(false); setActiveSite(id); }}
          />
        </main>
      ) : (
      <main className="layout">
        <Sidebar db={db} />
        <section className="canvas">
          {site.nodes.length ? (
            <Canvas
              db={db} site={site} result={result} routed={routed} overLines={overLines}
              exports={owed} otherSites={otherSites}
              onOpenSite={(id) => { setOverview(false); setActiveSite(id); }}
            />
          ) : (
            <div className="empty">
              <h2>{site.name} is empty</h2>
              <p>
                Add recipes from the left, or set a target on the right and hit <b>Solve</b>.
              </p>
            </div>
          )}
        </section>
        <BalancePanel
          db={db} site={site} result={result} exports={owed}
          otherSites={otherSites} over={over} underfed={underfed}
        />
      </main>
      )}
    </div>
  );
}

/**
 * Step back and forward through plan edits.
 *
 * The shortcut is bound on the window rather than a focused element, since the thing
 * you want to take back is usually a drag on the canvas, which leaves focus nowhere in
 * particular.
 */
function UndoRedo() {
  const undo = usePlan((s) => s.undo);
  const redo = usePlan((s) => s.redo);
  const canUndo = usePlan(selectCanUndo);
  const canRedo = usePlan(selectCanRedo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // While typing, Ctrl+Z belongs to the field — taking it would undo a plan edit
      // behind someone halfway through correcting a rate.
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <>
      <button
        className="btn btn--icon"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        className="btn btn--icon"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        ↷
      </button>
    </>
  );
}

