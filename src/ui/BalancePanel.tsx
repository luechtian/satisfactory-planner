import { useMemo, useState } from "react";
import type { Db } from "../core/data";
import type { ExportClaim } from "../core/overview";
import { DISPLAY_EPS, fmt } from "../core/solver";
import type { Site, SiteResult } from "../core/types";
import { usePlan } from "../store/planStore";

export function BalancePanel({
  db, site, result, exports, otherSites,
}: {
  db: Db;
  site: Site;
  result: SiteResult;
  /** what other sites draw from this one */
  exports: ExportClaim[];
  /** every other site, offered as an import source */
  otherSites: Array<{ id: string; name: string }>;
}) {
  const { solve, tidy, addFlow, updateFlow, removeFlow, setSupply } = usePlan();
  const trimClocks = usePlan((s) => s.trimClocks);
  const setTrimClocks = usePlan((s) => s.setTrimClocks);
  const [status, setStatus] = useState<string | null>(null);

  // Raws have their own section with editable supply, so listing them here too would
  // just be noise — every ore would sit in shortages permanently.
  const isRaw = (item: string) => !!db.items[item]?.isRawResource;
  const shortages = result.balances.filter((b) => b.net < -DISPLAY_EPS && !isRaw(b.item));
  const surpluses = result.balances.filter((b) => b.net > DISPLAY_EPS && !isRaw(b.item));

  return (
    <aside className="panel panel--right">
      <div className="panel__head">
        <h2>Balance</h2>
        <span className="muted">{fmt(result.totalPowerMW, 1)} MW</span>
      </div>

      <button
        className="btn btn--primary"
        // An export is demand too — a site that exists only to supply another is
        // still solvable.
        disabled={!site.targets.length && !exports.length}
        onClick={() => {
          const r = solve(db);
          setStatus(
            r.diverged
              ? "Chain did not settle — check for a recipe loop that never closes."
              : `Solved${r.added ? `, added ${r.added} node${r.added > 1 ? "s" : ""}` : ""}.`,
          );
        }}
      >
        Solve for targets
      </button>
      <label className="check" title="Off: whole machines at 100%, surplus accepted.">
        <input
          type="checkbox" checked={trimClocks}
          onChange={(e) => setTrimClocks(e.target.checked)}
        />
        underclock to avoid surplus
      </label>
      <button className="btn" disabled={!site.nodes.length} onClick={() => tidy(db)}>
        Tidy layout
      </button>
      {!site.targets.length && !exports.length && (
        <p className="hint">Add a target below to enable solving.</p>
      )}
      {status && <p className="hint">{status}</p>}

      <FlowEditor
        db={db} title="Targets" kind="targets" flows={site.targets}
        hint="What this site must ship out."
        onAdd={addFlow} onUpdate={updateFlow} onRemove={removeFlow}
      />
      <FlowEditor
        db={db} title="Imports" kind="imports" flows={site.imports.filter((f) => !isRaw(f.item))}
        hint="Manufactured parts belted or trained in, so they aren't counted as short."
        onlyItems={notRaw} sources={otherSites}
        onAdd={addFlow} onUpdate={updateFlow} onRemove={removeFlow}
      />

      {!!exports.length && (
        <section className="section">
          <h3>Exports</h3>
          <p className="hint">
            Claimed by other sites, counted as a target here. Change the amount on the
            site that draws it.
          </p>
          <ul className="feeds">
            {exports.map((e, i) => (
              <li key={`${e.toId}|${e.item}|${i}`}>
                <span>
                  {db.itemName(e.item)} <span className="muted">→ {e.toName}</span>
                </span>
                <strong>{fmt(e.perMinute)}/min</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RawSupply db={db} raws={result.raws} onSet={setSupply} />

      <BalanceTable db={db} title="Shortages" rows={shortages} tone="bad" empty="Nothing short." />
      <BalanceTable db={db} title="Surplus" rows={surpluses} tone="good" empty="Nothing spare." />
    </aside>
  );
}

/**
 * Ores, water and gas the site burns through. Rows appear on their own from what the
 * machines consume; typing a supply rate says how much extraction is actually there.
 *
 * Supply is informational — it settles the balance but does not cap production. Making
 * the solver respect a supply ceiling is the job of the LP phase.
 */
function RawSupply({
  db, raws, onSet,
}: {
  db: Db;
  raws: SiteResult["raws"];
  onSet: (item: string, perMinute: number) => void;
}) {
  if (!raws.length) return null;
  return (
    <section className="section">
      <h3>Raw supply</h3>
      <p className="hint">
        <b>Site</b> is what extractor nodes and byproducts already yield. Use <b>Belt</b>{" "}
        for anything arriving from outside.
      </p>
      <table className="raw">
        <thead>
          <tr>
            <th>Resource</th>
            <th className="num">Need</th>
            <th className="num">Site</th>
            <th className="num">Belt</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {raws.map((b) => {
            // Gross demand, not net — netting extraction out of it hid the fact that a
            // miner was covering the resource at all.
            const need = b.consumed + b.target;
            const short = b.net < -DISPLAY_EPS;
            return (
              <tr key={b.item}>
                <td>{db.itemName(b.item)}</td>
                <td className="num muted">{fmt(need)}</td>
                <td className="num muted">{fmt(b.produced)}</td>
                <td>
                  <input
                    className="raw__in" type="number" min={0} step={30} value={round(b.imported)}
                    onChange={(e) => onSet(b.item, Math.max(0, Number(e.target.value) || 0))}
                  />
                </td>
                <td className={`num ${short ? "neg" : "pos"}`}>{fmt(b.net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Module-level so the picker's useMemo isn't invalidated on every render. */
const notRaw = (i: Db["items"][string]) => !i.isRawResource;

type FlowKind = "targets" | "imports";

function FlowEditor({
  db, title, kind, flows, hint, onlyItems, sources, onAdd, onUpdate, onRemove,
}: {
  db: Db;
  title: string;
  kind: FlowKind;
  flows: Site["targets"];
  hint: string;
  /** narrows the picker, e.g. imports offer manufactured parts but not ore */
  onlyItems?: (i: Db["items"][string]) => boolean;
  /** when given, each row also picks which site it is belted from */
  sources?: Array<{ id: string; name: string }>;
  onAdd: (k: FlowKind, item: string, perMinute: number) => void;
  onUpdate: (
    k: FlowKind, id: string,
    patch: { item?: string; perMinute?: number; from?: string | undefined },
  ) => void;
  onRemove: (k: FlowKind, id: string) => void;
}) {
  const [pick, setPick] = useState("");
  // Only items something can actually make or mine are worth offering.
  const options = useMemo(
    () =>
      Object.values(db.items)
        .filter((i) => (db.producersOf[i.class]?.length || i.isRawResource) && (onlyItems?.(i) ?? true))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db, onlyItems],
  );

  return (
    <section className="section">
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      <ul className="flows">
        {flows.map((f) => (
          <li key={f.id} className={sources ? "flow flow--linked" : "flow"}>
            <div className="flow__main">
              <select value={f.item} onChange={(e) => onUpdate(kind, f.id, { item: e.target.value })}>
                {options.map((i) => <option key={i.class} value={i.class}>{i.name}</option>)}
              </select>
              <input
                type="number" min={0} step={10} value={f.perMinute}
                onChange={(e) => onUpdate(kind, f.id, { perMinute: Number(e.target.value) || 0 })}
              />
              <button className="btn btn--icon" onClick={() => onRemove(kind, f.id)}>×</button>
            </div>
            {sources && (
              <label className="flow__from">
                from
                <select
                  value={f.from ?? ""}
                  onChange={(e) => onUpdate(kind, f.id, { from: e.target.value || undefined })}
                >
                  <option value="">outside the plan</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="flows__add">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">add item…</option>
          {options.map((i) => <option key={i.class} value={i.class}>{i.name}</option>)}
        </select>
        <button
          className="btn" disabled={!pick}
          onClick={() => { onAdd(kind, pick, 60); setPick(""); }}
        >
          Add
        </button>
      </div>
    </section>
  );
}

function BalanceTable({
  db, title, rows, tone, empty,
}: {
  db: Db;
  title: string;
  rows: SiteResult["balances"];
  tone: "good" | "bad";
  empty: string;
}) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {rows.length ? (
        <table className="bal">
          <tbody>
            {rows.map((b) => (
              <tr key={b.item}>
                <td>{db.itemName(b.item)}</td>
                <td className="num muted">{fmt(b.produced)}</td>
                <td className="num muted">−{fmt(b.consumed + b.target)}</td>
                <td className={`num ${tone === "bad" ? "neg" : "pos"}`}>{fmt(b.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted pad">{empty}</p>
      )}
    </section>
  );
}
