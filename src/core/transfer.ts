/**
 * Moving sites between plans.
 *
 * Two people working one save exchange sites, not whole plans, so export takes a
 * selection and import merges rather than replaces. Both halves match sites by id: an
 * id is shared exactly when the site originally came from the other person's export,
 * which is precisely when "this is a newer copy of the same thing" is true. Sites the
 * two of them built independently keep different ids and stay separate, however alike
 * their names.
 */

import type { Plan, Site } from "./types";

/* ------------------------------------------------------------------ export */

/**
 * A selection of sites, still shaped as a whole plan.
 *
 * Deliberately not a new file format. A partial export opens on its own like any other
 * plan file, and whole-plan files written before any of this merge back in through the
 * same path.
 */
export function subsetPlan(plan: Plan, ids: readonly string[]): Plan {
  const want = new Set(ids);
  // Spread rather than rebuilt from `version` and `sites`, so selecting everything is
  // byte-identical to the whole-plan export this replaced, and stays that way if the
  // plan ever grows a field.
  return { ...plan, sites: plan.sites.filter((s) => want.has(s.id)) };
}

/**
 * Links that point outside a set of sites.
 *
 * Nothing is ever rewritten to fix these. A `from` naming a site the other end does not
 * have is already reported by `summarisePlan` as a broken link, and it re-forms on its
 * own the day that site is imported too — so carrying the id across and saying so beats
 * silently demoting the link to an anonymous external import, which would lose the fact
 * that it ever had a source.
 *
 * Serves both ends: on export `known` is the selection, on import it is everything the
 * merged plan will contain.
 */
export function looseLinks(
  sites: readonly Site[],
  known: ReadonlySet<string>,
): Array<{ siteId: string; siteName: string; item: string }> {
  const out: Array<{ siteId: string; siteName: string; item: string }> = [];
  for (const s of sites) {
    for (const f of s.imports) {
      if (f.from && !known.has(f.from)) {
        out.push({ siteId: s.id, siteName: s.name, item: f.item });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ import */

/** One incoming site, lined up against what is already here. */
export interface TransferRow {
  site: Site;
  /** the site this would overwrite, when one with the same id is already in the plan */
  replaces?: Site;
}

/** What a file would do, worked out before anything is written. */
export function previewMerge(current: Plan, incoming: Plan): TransferRow[] {
  const mine = new Map(current.sites.map((s) => [s.id, s]));
  return incoming.sites.map((site) => {
    const hit = mine.get(site.id);
    return hit ? { site, replaces: hit } : { site };
  });
}

/**
 * Merge the accepted sites into the plan.
 *
 * Replacements keep their slot in the tab order and whatever position they had been
 * given on the All-sites map: taking a newer copy of a site is an update to its
 * contents, and should not rearrange a board the other person never saw. Everything
 * genuinely new lands on the end.
 */
export function applyMerge(current: Plan, incoming: Plan, accept: readonly string[]): Plan {
  const take = new Set(accept);
  const chosen = incoming.sites.filter((s) => take.has(s.id));
  if (!chosen.length) return current;

  const byId = new Map(chosen.map((s) => [s.id, s]));
  const sites = current.sites.map((mine) => {
    const next = byId.get(mine.id);
    return next ? { ...next, mapPosition: mine.mapPosition ?? next.mapPosition } : mine;
  });

  const already = new Set(current.sites.map((s) => s.id));
  for (const s of chosen) if (!already.has(s.id)) sites.push(s);

  return { ...current, sites };
}

/* ------------------------------------------------------------------ parsing */

const looksLikeSite = (s: unknown): s is Site => {
  const v = s as Site;
  return (
    !!v && typeof v.id === "string" && typeof v.name === "string" &&
    Array.isArray(v.nodes) && Array.isArray(v.targets) && Array.isArray(v.imports)
  );
};

/**
 * Read a plan file, with messages worth showing to someone who has just been handed a
 * file by a colleague. Checked here rather than at the file input because a half-valid
 * site would otherwise crash the forward pass much later, with nothing pointing back at
 * the file that caused it.
 */
export function parsePlan(text: string): Plan {
  let parsed: Plan;
  try {
    parsed = JSON.parse(text) as Plan;
  } catch {
    throw new Error("that is not JSON — is it the right file?");
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.sites)) {
    throw new Error("not a plan file");
  }
  if (!parsed.sites.length) throw new Error("that file has no sites in it");
  if (!parsed.sites.every(looksLikeSite)) throw new Error("that plan file is damaged");
  return parsed;
}
