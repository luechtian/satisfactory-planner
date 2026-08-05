import { useEffect, useMemo, useState } from "react";
import { loadDb, type Db } from "./core/data";
import { exportsOf } from "./core/overview";
import { evaluateSite } from "./core/solver";
import { usePlan } from "./store/planStore";
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
  const [overview, setOverview] = useState(false);

  const site = plan.sites.find((s) => s.id === activeSiteId) ?? plan.sites[0];
  // What other sites draw from this one, so the balance reflects its commitments.
  const owed = useMemo(() => exportsOf(plan, site.id), [plan, site.id]);
  const otherSites = useMemo(
    () => plan.sites.filter((s) => s.id !== site.id).map((s) => ({ id: s.id, name: s.name })),
    [plan.sites, site.id],
  );
  const result = useMemo(() => evaluateSite(db, site, owed), [db, site, owed]);

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
              db={db} site={site} result={result} exports={owed} otherSites={otherSites}
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
          otherSites={otherSites}
        />
      </main>
      )}
    </div>
  );
}

