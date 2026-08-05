import { useMemo, useState } from "react";
import { resourcesFor, searchRecipes, type Db } from "../core/data";
import { fmt } from "../core/solver";
import { usePlan } from "../store/planStore";
import { Section } from "./Section";
import { SitesSection } from "./SitesSection";

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
      <SitesSection db={db} />
      <Extractors db={db} />

      {/* Counted by what the search actually turned up, not the 291 in the dump — that
          number never changes and so never tells you anything. */}
      <Section name="Recipes" count={results.length}>
        <input
          className="search"
          placeholder="Search recipe, product or building…"
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
                <div className="reclist__building">{db.buildings[r.building]?.name}</div>
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
      </Section>
    </aside>
  );
}

/**
 * Miners, pumps and wells. Kept separate from the recipe list because they are
 * buildings rather than recipes — the resource and node purity are chosen on the node
 * once it is placed.
 */
function Extractors({ db }: { db: Db }) {
  const addExtractor = usePlan((s) => s.addExtractor);
  const extractors = useMemo(
    () =>
      Object.values(db.buildings)
        .filter((b) => b.kind === "extractor")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db],
  );

  return (
    <Section name="Extractors" count={extractors.length}>
      <div className="extractors">
        {extractors.map((b) => {
          const first = resourcesFor(db, b.class)[0];
          return (
            <button
              key={b.class}
              className="extractors__btn"
              disabled={!first}
              title={`${b.baseRatePerMin}/min at normal purity · ${b.powerMW} MW`}
              onClick={() => first && addExtractor(b.class, first.class, "normal")}
            >
              <span>{b.name}</span>
              <span className="muted">{b.baseRatePerMin}/min</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
