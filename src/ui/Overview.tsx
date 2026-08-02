import { useMemo } from "react";
import type { Db } from "../core/data";
import { groupSites, rank, summarisePlan, type ItemRollup } from "../core/overview";
import { DISPLAY_EPS, fmt } from "../core/solver";
import type { Plan } from "../core/types";
import { usePlan } from "../store/planStore";

export function Overview({
  db, plan, onOpenSite,
}: {
  db: Db;
  plan: Plan;
  onOpenSite: (id: string) => void;
}) {
  const s = useMemo(() => summarisePlan(db, plan), [db, plan]);
  const linkSites = usePlan((st) => st.linkSites);

  const gaps = s.items.filter((r) => rank(r) === 0);
  const routable = s.items.filter((r) => rank(r) === 1);
  const spare = s.items.filter((r) => rank(r) === 2);

  return (
    <div className="overview">
      <header className="overview__head">
        <h1>All sites</h1>
        <div className="overview__stats">
          <Stat label="Sites" value={String(s.sites.length)} />
          <Stat label="Total power" value={`${fmt(s.totalPowerMW, 1)} MW`} accent />
          <Stat
            label="Machines"
            value={String(s.sites.reduce((n, x) => n + x.machines + x.extractors, 0))}
          />
        </div>
      </header>

      <section className="overview__block">
        <h2>Between sites</h2>
        <p className="hint">
          Sites are still planned independently — nothing is routed for you. This is where
          one site's spare output lines up with another's shortfall.
        </p>
        {s.items.length ? (
          <>
            <RollupTable
              db={db} rows={gaps} onOpenSite={onOpenSite}
              title="Nothing covers these" tone="bad"
            />
            <RollupTable
              db={db} rows={routable} onOpenSite={onOpenSite}
              title="Could be routed" tone="warn"
              onLink={(r) => {
                // Wire the biggest shortfall to the biggest surplus and cover as much
                // of it as that source actually has.
                const need = [...r.shortAt].sort((a, b) => b.perMinute - a.perMinute)[0];
                const src = [...r.spareAt].sort((a, b) => b.perMinute - a.perMinute)[0];
                if (need && src) linkSites(need.id, src.id, r.item, Math.min(need.perMinute, src.perMinute));
              }}
            />
            <RollupTable
              db={db} rows={spare} onOpenSite={onOpenSite}
              title="Spare, unclaimed" tone="good"
            />
          </>
        ) : (
          <p className="muted pad">Every site balances on its own. Nothing crosses a boundary.</p>
        )}
      </section>

      <section className="overview__block">
        <h2>Links</h2>
        <p className="hint">
          Imports that name a source site. A link is a claim on that site's surplus, not a
          re-plan — if the source stops covering it, both ends say so here.
        </p>
        {s.links.length ? (
          <table className="rollup">
            <thead>
              <tr>
                <th>Item</th><th>From</th><th>To</th>
                <th className="num">Drawn</th><th className="num">Available at source</th>
              </tr>
            </thead>
            <tbody>
              {s.links.map((l) => (
                <tr key={`${l.sourceId}|${l.item}`}>
                  <td>{db.itemName(l.item)}</td>
                  <td>
                    <button className="chip chip--pos" onClick={() => onOpenSite(l.sourceId)}>
                      {l.sourceName}
                    </button>
                  </td>
                  <td>
                    <SiteChips refs={l.consumers} onOpenSite={onOpenSite} tone="neg" />
                  </td>
                  <td className="num">{fmt(l.drawn)}</td>
                  <td className={`num ${l.over > DISPLAY_EPS ? "neg" : "pos"}`}>
                    {fmt(l.available)}
                    {l.over > DISPLAY_EPS && <span className="over"> short {fmt(l.over)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted pad">
            No links yet. Use <b>Link</b> above, or set a source on an import.
          </p>
        )}
        {!!s.brokenLinks.length && (
          <p className="hint neg">
            {s.brokenLinks.length} import{s.brokenLinks.length > 1 ? "s" : ""} point at a site
            that no longer exists:{" "}
            {s.brokenLinks.map((b) => `${b.siteName} → ${db.itemName(b.item)}`).join(", ")}
          </p>
        )}
      </section>

      <section className="overview__block">
        <h2>Raw extraction, all sites</h2>
        {s.raws.length ? (
          <table className="raw">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="num">Need</th>
                <th className="num">On site</th>
                <th className="num">Belt</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {s.raws.map((r) => (
                <tr key={r.item}>
                  <td>{db.itemName(r.item)}</td>
                  <td className="num muted">{fmt(r.need)}</td>
                  <td className="num muted">{fmt(r.onSite)}</td>
                  <td className="num muted">{fmt(r.belt)}</td>
                  <td className={`num ${r.net < -DISPLAY_EPS ? "neg" : "pos"}`}>{fmt(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted pad">No site consumes a raw resource yet.</p>
        )}
      </section>

      <section className="overview__block">
        <h2>Per site</h2>
        {groupSites(s.sites).map((g) => (
          <div className="sitegroup" key={g.group ?? "__none"}>
            {g.group ? (
              <h3 className="sitegroup__head">
                {g.group}
                <span className="sitegroup__power">{fmt(g.powerMW, 1)} MW</span>
                <span className="muted">
                  {g.sites.length} site{g.sites.length === 1 ? "" : "s"}
                </span>
              </h3>
            ) : (
              s.sites.some((x) => x.group) && <h3 className="sitegroup__head">Ungrouped</h3>
            )}
            <div className="sitecards">
              {g.sites.map((x) => (
                <button key={x.id} className="sitecard" onClick={() => onOpenSite(x.id)}>
                  <div className="sitecard__name">{x.name}</div>
                  <div className="sitecard__power">{fmt(x.powerMW, 1)} MW</div>
                  <div className="sitecard__meta muted">
                    {x.machines} machine{x.machines === 1 ? "" : "s"}
                    {x.extractors > 0 && ` · ${x.extractors} extractor${x.extractors === 1 ? "" : "s"}`}
                  </div>
                  <div className="sitecard__flags">
                    {x.shortages > 0 && <span className="neg">{x.shortages} short</span>}
                    {x.surpluses > 0 && <span className="pos">{x.surpluses} spare</span>}
                    {!x.shortages && !x.surpluses && <span className="muted">balanced</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className={`stat__value ${accent ? "stat__value--accent" : ""}`}>{value}</div>
    </div>
  );
}

function RollupTable({
  db, rows, title, tone, onOpenSite, onLink,
}: {
  db: Db;
  rows: ItemRollup[];
  title: string;
  tone: "good" | "bad" | "warn";
  onOpenSite: (id: string) => void;
  onLink?: (r: ItemRollup) => void;
}) {
  if (!rows.length) return null;
  return (
    <>
      <h3 className={`rollup__title rollup__title--${tone}`}>{title}</h3>
      <table className="rollup">
        <thead>
          <tr>
            <th>Item</th>
            <th>Short at</th>
            <th>Spare at</th>
            <th className="num">Balance</th>
            {onLink && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item}>
              <td>{db.itemName(r.item)}</td>
              <td>
                <SiteChips refs={r.shortAt} onOpenSite={onOpenSite} tone="neg" />
              </td>
              <td>
                <SiteChips refs={r.spareAt} onOpenSite={onOpenSite} tone="pos" />
              </td>
              <td className={`num ${r.net < -DISPLAY_EPS ? "neg" : "pos"}`}>{fmt(r.net)}</td>
              {onLink && (
                <td className="num">
                  <button className="btn btn--icon" onClick={() => onLink(r)}>Link</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function SiteChips({
  refs, onOpenSite, tone,
}: {
  refs: Array<{ id: string; name: string; perMinute: number }>;
  onOpenSite: (id: string) => void;
  tone: "pos" | "neg";
}) {
  if (!refs.length) return <span className="muted">—</span>;
  return (
    <span className="chips">
      {refs.map((x) => (
        <button key={x.id} className={`chip chip--${tone}`} onClick={() => onOpenSite(x.id)}>
          {x.name} <b>{fmt(x.perMinute)}</b>
        </button>
      ))}
    </span>
  );
}
