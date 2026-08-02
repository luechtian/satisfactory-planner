import type { Db } from "./data";
import { DISPLAY_EPS, evaluateSite } from "./solver";
import type { ItemBalance, Plan } from "./types";

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

export interface PlanSummary {
  sites: SiteSummary[];
  totalPowerMW: number;
  raws: RawRollup[];
  /** non-raw items that cross a site boundary, most actionable first */
  items: ItemRollup[];
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
  let totalPowerMW = 0;

  const isRaw = (item: string) => !!db.items[item]?.isRawResource;

  for (const site of plan.sites) {
    const result = evaluateSite(db, site);
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
  }

  return {
    sites,
    totalPowerMW,
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
