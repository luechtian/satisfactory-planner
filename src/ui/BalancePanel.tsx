import { useMemo, useState } from "react";
import type { Db } from "../core/data";
import { fmt } from "../core/solver";
import type { Site, SiteResult } from "../core/types";
import { usePlan } from "../store/planStore";

export function BalancePanel({ db, site, result }: { db: Db; site: Site; result: SiteResult }) {
  const { solve, tidy, addFlow, updateFlow, removeFlow, setSupply } = usePlan();
  const [status, setStatus] = useState<string | null>(null);

  // Raws have their own section with editable supply, so listing them here too would
  // just be noise — every ore would sit in shortages permanently.
  const isRaw = (item: string) => !!db.items[item]?.isRawResource;
  const shortages = result.balances.filter((b) => b.net < -1e-6 && !isRaw(b.item));
  const surpluses = result.balances.filter((b) => b.net > 1e-6 && !isRaw(b.item));

  return (
    <aside className="panel panel--right">
      <div className="panel__head">
        <h2>Balance</h2>
        <span className="muted">{fmt(result.totalPowerMW, 1)} MW</span>
      </div>

      <button
        className="btn btn--primary"
        disabled={!site.targets.length}
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
      <button className="btn" disabled={!site.nodes.length} onClick={() => tidy(db)}>
        Tidy layout
      </button>
      {!site.targets.length && <p className="hint">Add a target below to enable solving.</p>}
      {status && <p className="hint">{status}</p>}

      <FlowEditor
        db={db} title="Targets" kind="targets" flows={site.targets}
        hint="What this site must ship out."
        onAdd={addFlow} onUpdate={updateFlow} onRemove={removeFlow}
      />
      <FlowEditor
        db={db} title="Imports" kind="imports" flows={site.imports.filter((f) => !isRaw(f.item))}
        hint="Manufactured parts belted or trained in, so they aren't counted as short."
        onlyItems={notRaw}
        onAdd={addFlow} onUpdate={updateFlow} onRemove={removeFlow}
      />

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
      <p className="hint">Extraction available on site. Leave at 0 to see what's needed.</p>
      <table className="raw">
        <thead>
          <tr><th>Resource</th><th className="num">Need</th><th className="num">Supply</th><th className="num">Net</th></tr>
        </thead>
        <tbody>
          {raws.map((b) => {
            const need = b.consumed + b.target - b.produced;
            const short = b.net < -1e-6;
            return (
              <tr key={b.item}>
                <td>{db.itemName(b.item)}</td>
                <td className="num muted">{fmt(need)}</td>
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
  db, title, kind, flows, hint, onlyItems, onAdd, onUpdate, onRemove,
}: {
  db: Db;
  title: string;
  kind: FlowKind;
  flows: Site["targets"];
  hint: string;
  /** narrows the picker, e.g. imports offer manufactured parts but not ore */
  onlyItems?: (i: Db["items"][string]) => boolean;
  onAdd: (k: FlowKind, item: string, perMinute: number) => void;
  onUpdate: (k: FlowKind, id: string, patch: { item?: string; perMinute?: number }) => void;
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
          <li key={f.id}>
            <select value={f.item} onChange={(e) => onUpdate(kind, f.id, { item: e.target.value })}>
              {options.map((i) => <option key={i.class} value={i.class}>{i.name}</option>)}
            </select>
            <input
              type="number" min={0} step={10} value={f.perMinute}
              onChange={(e) => onUpdate(kind, f.id, { perMinute: Number(e.target.value) || 0 })}
            />
            <button className="btn btn--icon" onClick={() => onRemove(kind, f.id)}>×</button>
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
