import { useMemo, useState } from "react";
import { searchRecipes, type Db } from "../core/data";
import { fmt } from "../core/solver";
import { usePlan } from "../store/planStore";

export function Sidebar({ db }: { db: Db }) {
  const [query, setQuery] = useState("");
  const [showAlt, setShowAlt] = useState(true);
  const addNode = usePlan((s) => s.addNode);

  const results = useMemo(
    () => searchRecipes(db, query).filter((r) => showAlt || !r.alternate),
    [db, query, showAlt],
  );

  return (
    <aside className="panel panel--left">
      <div className="panel__head">
        <h2>Recipes</h2>
        <span className="muted">{db.recipes.length} total</span>
      </div>

      <input
        className="search"
        placeholder="Search recipe, product or machine…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <label className="check">
        <input type="checkbox" checked={showAlt} onChange={(e) => setShowAlt(e.target.checked)} />
        show alternates
      </label>

      <ul className="reclist">
        {results.map((r) => (
          <li key={r.class}>
            <button className="reclist__item" onClick={() => addNode(r.class)}>
              <div className="reclist__top">
                <span className="reclist__name">{r.name}</span>
                {r.alternate && <span className="tag tag--alt">ALT</span>}
              </div>
              <div className="reclist__machine">{db.buildings[r.machine]?.name}</div>
              <div className="reclist__io">
                <span>{r.ingredients.map((p) => `${db.itemName(p.item)} ${fmt(p.perMinute)}`).join(", ") || "—"}</span>
                <span className="arrow">→</span>
                <span>{r.products.map((p) => `${db.itemName(p.item)} ${fmt(p.perMinute)}`).join(", ")}</span>
              </div>
            </button>
          </li>
        ))}
        {!results.length && <li className="muted pad">no match</li>}
      </ul>
    </aside>
  );
}
