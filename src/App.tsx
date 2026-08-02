import { useEffect, useMemo, useRef, useState } from "react";
import { loadDb, type Db } from "./core/data";
import { evaluateSite } from "./core/solver";
import type { Plan } from "./core/types";
import { usePlan } from "./store/planStore";
import { BalancePanel } from "./ui/BalancePanel";
import { Canvas } from "./ui/Canvas";
import { Sidebar } from "./ui/Sidebar";
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
  const { setActiveSite, addSite, renameSite, removeSite, replacePlan } = usePlan();

  const theme = usePlan((s) => s.theme);
  const toggleTheme = usePlan((s) => s.toggleTheme);

  const site = plan.sites.find((s) => s.id === activeSiteId) ?? plan.sites[0];
  const result = useMemo(() => evaluateSite(db, site), [db, site]);

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

        <nav className="tabs">
          {plan.sites.map((s) => (
            <button
              key={s.id}
              className={`tab ${s.id === activeSiteId ? "tab--active" : ""}`}
              onClick={() => setActiveSite(s.id)}
              onDoubleClick={() => {
                const name = prompt("Site name", s.name);
                if (name) renameSite(s.id, name);
              }}
              title="Double-click to rename"
            >
              {s.name}
              {s.id === activeSiteId && plan.sites.length > 1 && (
                <span
                  className="tab__x"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete site "${s.name}"?`)) removeSite(s.id);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button className="tab tab--add" onClick={() => addSite(`Site ${plan.sites.length + 1}`)}>
            +
          </button>
        </nav>

        <div className="io">
          <button
            className="btn btn--icon"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <PlanIO plan={plan} onLoad={replacePlan} />
        </div>
      </header>

      <main className="layout">
        <Sidebar db={db} />
        <section className="canvas">
          {site.nodes.length ? (
            <Canvas db={db} site={site} result={result} />
          ) : (
            <div className="empty">
              <h2>{site.name} is empty</h2>
              <p>
                Add recipes from the left, or set a target on the right and hit <b>Solve</b>.
              </p>
            </div>
          )}
        </section>
        <BalancePanel db={db} site={site} result={result} />
      </main>
    </div>
  );
}

/** Plans live in localStorage; this is the escape hatch for backup and sharing. */
function PlanIO({ plan, onLoad }: { plan: Plan; onLoad: (p: Plan) => void }) {
  const file = useRef<HTMLInputElement>(null);

  const save = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "satisfactory-plan.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const load = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as Plan;
      if (parsed?.version !== 1 || !Array.isArray(parsed.sites)) throw new Error("bad plan file");
      onLoad(parsed);
    } catch (e) {
      alert(`Could not load plan: ${(e as Error).message}`);
    }
  };

  return (
    <div className="io">
      <button className="btn" onClick={save}>Export</button>
      <button className="btn" onClick={() => file.current?.click()}>Import</button>
      <input
        ref={file} type="file" accept="application/json" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) load(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
