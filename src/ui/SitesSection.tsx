import { useMemo } from "react";
import type { Db } from "../core/data";
import { groupSites, summarisePlan, type ItemFlow, type SiteSummary } from "../core/overview";
import { fmt } from "../core/solver";
import { usePlan } from "../store/planStore";
import { Section } from "./Section";

/** How many items a tooltip names before it stops being readable. */
const MAX_LISTED = 8;

/**
 * Every site in the plan, grouped, with the one signal worth having at a glance.
 *
 * The tab bar already navigates. What it cannot tell you is that a site you are *not*
 * looking at has gone short — and finding that out currently means leaving the site you
 * are working on. The **All sites** page stays the deep view with the map and the
 * rollups; this is the ambient one.
 *
 * Subscribed to `plan` in its own component so the recipe list beside it does not
 * re-render on every edit made anywhere in the plan.
 */
export function SitesSection({ db }: { db: Db }) {
  const plan = usePlan((s) => s.plan);
  const activeSiteId = usePlan((s) => s.activeSiteId);
  const setActiveSite = usePlan((s) => s.setActiveSite);
  const collapsed = usePlan((s) => s.collapsedSections);
  const toggleSection = usePlan((s) => s.toggleSection);

  // ~1ms for fifty sites, and only on a plan change — the panel re-renders far more
  // often than the plan changes.
  const summary = useMemo(() => summarisePlan(db, plan), [db, plan]);
  const groups = useMemo(() => groupSites(summary.sites), [summary.sites]);

  const list = (label: string, flows: ItemFlow[], sign: string) => {
    if (!flows.length) return "";
    const shown = flows.slice(0, MAX_LISTED);
    const rest = flows.length - shown.length;
    return [
      label,
      ...shown.map((f) => `  ${sign}${fmt(f.perMinute)} ${db.itemName(f.item)}`),
      rest > 0 ? `  …and ${rest} more` : "",
    ].filter(Boolean).join("\n");
  };

  /** Native title rather than a component: it is the tooltip the rest of the app uses. */
  const tip = (s: SiteSummary) => {
    const parts = [list("Short of:", s.short, "−"), list("Spare:", s.spare, "+")].filter(Boolean);
    return parts.length
      ? parts.join("\n\n")
      : `${s.name} balances — nothing short, nothing spare`;
  };

  return (
    <Section name="Sites" count={summary.sites.length} first>
      {groups.map((g) => {
        // Namespaced so a group called "Imports" cannot fold the panel section of that
        // name out from under you.
        const key = `Sites/${g.group}`;
        const folded = !!g.group && collapsed.includes(key);
        const shortInGroup = g.sites.filter((s) => s.short.length > 0).length;

        return (
        <div className="sitelist" key={g.group ?? "__none"}>
          {g.group && (
            <button
              className="sitelist__group"
              onClick={() => toggleSection(key)}
              aria-expanded={!folded}
              title={folded ? `Show ${g.group}` : `Hide ${g.group}`}
            >
              <span className="sitelist__caret">{folded ? "▸" : "▾"}</span>
              <span className="sitelist__groupname">{g.group}</span>
              {/* Folding a group must not be a way to stop knowing something inside it
                  is broken. */}
              {folded && shortInGroup > 0 && (
                <span className="sitelist__short">{shortInGroup}</span>
              )}
              <span className="muted">{fmt(g.powerMW, 1)} MW</span>
            </button>
          )}
          {g.sites
            // The site you are on stays put inside a folded group, so folding never
            // loses your place — the same rule the tab bar follows.
            .filter((s) => !folded || s.id === activeSiteId)
            .map((s) => (
            <button
              key={s.id}
              className={`sitelist__site ${s.id === activeSiteId ? "sitelist__site--on" : ""}`}
              onClick={() => setActiveSite(s.id)}
              title={tip(s)}
            >
              <span className="sitelist__name">{s.name}</span>
              <span className="sitelist__mw muted">{fmt(s.powerMW, 1)} MW</span>
              {/* Only shortages get a badge. Spare is worth knowing but never urgent,
                  and two badges at this width is a row of numbers, not a signal. */}
              {s.short.length > 0 && (
                <span className="sitelist__short">{s.short.length}</span>
              )}
            </button>
          ))}
        </div>
        );
      })}
    </Section>
  );
}
