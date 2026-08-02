import type { Db } from "./data";
import { DISPLAY_EPS, evaluateSite } from "./solver";
import type { ItemBalance, Plan } from "./types";

/** One site's claim on another's output, seen from the producing end. */
export interface ExportClaim {
  item: string;
  perMinute: number;
  toId: string;
  toName: string;
}

/**
 * What `siteId` owes the rest of the plan.
 *
 * Derived from the consumers' imports rather than stored on the producer: one record,
 * so the two ends cannot drift apart. Treated as a target when the site is evaluated or
 * solved, which is what makes a link bind at both ends.
 */
export function exportsOf(plan: Plan, siteId: string): ExportClaim[] {
  const out: ExportClaim[] = [];
  for (const site of plan.sites) {
    if (site.id === siteId) continue;
    for (const f of site.imports) {
      if (f.from === siteId) {
        out.push({ item: f.item, perMinute: f.perMinute, toId: site.id, toName: site.name });
      }
    }
  }
  return out;
}

export interface SiteRef {
  id: string;
  name: string;
  perMinute: number;
}

/** One item seen across every site at once. */
export interface ItemRollup {
  item: string;
  /** sites with more than they consume */
  spareAt: SiteRef[];
  /** sites that come up short */
  shortAt: SiteRef[];
  spare: number;
  short: number;
  /** spare - short; negative means no site can cover the gap */
  net: number;
}

export interface SiteSummary {
  id: string;
  name: string;
  machines: number;
  extractors: number;
  powerMW: number;
  shortages: number;
  surpluses: number;
}

export interface RawRollup {
  item: string;
  /** gross consumption plus targets, all sites */
  need: number;
  /** what extractor nodes and byproducts yield, all sites */
  onSite: number;
  /** declared belt imports, all sites */
  belt: number;
  net: number;
}

/** One source site supplying one item, with everyone drawing on it. */
export interface SupplyLink {
  item: string;
  sourceId: string;
  sourceName: string;
  consumers: Array<{ id: string; name: string; perMinute: number }>;
  /** total claimed by consumers */
  drawn: number;
  /** what the source actually has spare */
  available: number;
  /** drawn beyond available; > 0 means the link is a lie */
  over: number;
}

export interface PlanSummary {
  sites: SiteSummary[];
  totalPowerMW: number;
  raws: RawRollup[];
  /** non-raw items that cross a site boundary, most actionable first */
  items: ItemRollup[];
  /** declared site-to-site links, over-drawn ones first */
  links: SupplyLink[];
  /** imports naming a site that no longer exists */
  brokenLinks: Array<{ siteId: string; siteName: string; item: string }>;
}

/**
 * Roll every site up into one picture.
 *
 * Sites are still evaluated independently — this does not route anything, it only shows
 * where one site's spare output lines up with another's shortfall, which is the question
 * a per-site view structurally cannot answer.
 */
export function summarisePlan(db: Db, plan: Plan): PlanSummary {
  const sites: SiteSummary[] = [];
  const rawAcc = new Map<string, RawRollup>();
  const itemAcc = new Map<string, ItemRollup>();
  /** "siteId|item" -> what that site has spare, for checking link claims later */
  const spareOf = new Map<string, number>();
  let totalPowerMW = 0;

  const isRaw = (item: string) => !!db.items[item]?.isRawResource;

  for (const site of plan.sites) {
    // Evaluated with obligations applied, so a site that has committed its surplus no
    // longer advertises it as spare.
    const owed = exportsOf(plan, site.id);
    const result = evaluateSite(db, site, owed);
    totalPowerMW += result.totalPowerMW;

    const shortages = result.balances.filter((b) => b.net < -DISPLAY_EPS && !isRaw(b.item));
    const surpluses = result.balances.filter((b) => b.net > DISPLAY_EPS && !isRaw(b.item));

    sites.push({
      id: site.id,
      name: site.name,
      machines: site.nodes.filter((n) => n.kind !== "extractor").length,
      extractors: site.nodes.filter((n) => n.kind === "extractor").length,
      powerMW: result.totalPowerMW,
      shortages: shortages.length,
      surpluses: surpluses.length,
    });

    for (const b of result.raws) {
      const row = rawAcc.get(b.item) ?? { item: b.item, need: 0, onSite: 0, belt: 0, net: 0 };
      row.need += b.consumed + b.target;
      row.onSite += b.produced;
      row.belt += b.imported;
      row.net += b.net;
      rawAcc.set(b.item, row);
    }

    const exported = (item: string) =>
      owed.reduce((n, e) => (e.item === item ? n + e.perMinute : n), 0);

    const track = (b: ItemBalance, side: "spareAt" | "shortAt") => {
      const row = itemAcc.get(b.item) ?? {
        item: b.item, spareAt: [], shortAt: [], spare: 0, short: 0, net: 0,
      };
      row[side].push({ id: site.id, name: site.name, perMinute: Math.abs(b.net) });
      if (side === "spareAt") row.spare += b.net;
      else row.short += -b.net;
      row.net = row.spare - row.short;
      itemAcc.set(b.item, row);
    };
    for (const b of surpluses) track(b, "spareAt");
    for (const b of shortages) track(b, "shortAt");
    // Pre-claim spare: net already has the export subtracted, so add it back. Judging a
    // link against post-claim spare would make every satisfied link look over-drawn.
    for (const b of result.balances) {
      if (!isRaw(b.item)) spareOf.set(`${site.id}|${b.item}`, b.net + exported(b.item));
    }
  }

  // Links are checked against sites evaluated independently: a source's surplus is what
  // it has spare on its own, and the draws against it are claims on that. Deliberately
  // not a second solve — sites stay independent, this only says whether the claims fit.
  const byName = new Map(plan.sites.map((s) => [s.id, s.name]));
  const linkAcc = new Map<string, SupplyLink>();
  const brokenLinks: PlanSummary["brokenLinks"] = [];

  for (const site of plan.sites) {
    for (const f of site.imports) {
      if (!f.from) continue;
      const sourceName = byName.get(f.from);
      if (!sourceName) {
        brokenLinks.push({ siteId: site.id, siteName: site.name, item: f.item });
        continue;
      }
      const key = `${f.from}|${f.item}`;
      const link = linkAcc.get(key) ?? {
        item: f.item,
        sourceId: f.from,
        sourceName,
        consumers: [],
        drawn: 0,
        available: spareOf.get(key) ?? 0,
        over: 0,
      };
      link.consumers.push({ id: site.id, name: site.name, perMinute: f.perMinute });
      link.drawn += f.perMinute;
      link.over = Math.max(0, link.drawn - link.available);
      linkAcc.set(key, link);
    }
  }

  return {
    sites,
    totalPowerMW,
    links: [...linkAcc.values()].sort(
      (a, b) => b.over - a.over || db.itemName(a.item).localeCompare(db.itemName(b.item)),
    ),
    brokenLinks,
    raws: [...rawAcc.values()].sort((a, b) =>
      db.itemName(a.item).localeCompare(db.itemName(b.item)),
    ),
    // Gaps nothing covers first, then routable matches, then idle surplus.
    items: [...itemAcc.values()].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.short - a.short ||
        db.itemName(a.item).localeCompare(db.itemName(b.item)),
    ),
  };
}

/** 0 = short with no cover anywhere, 1 = a site could supply it, 2 = spare only. */
export function rank(r: ItemRollup): number {
  if (r.short > DISPLAY_EPS) return r.spare > DISPLAY_EPS ? 1 : 0;
  return 2;
}
