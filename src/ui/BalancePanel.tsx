import { useMemo, useState } from "react";
import type { Db } from "../core/data";
import { fmt } from "../core/solver";
import type { Site, SiteResult } from "../core/types";
import { usePlan } from "../store/planStore";

export function BalancePanel({ db, site, result }: { db: Db; site: Site; result: SiteResult }) {
  const { solve, tidy, addFlow, updateFlow, removeFlow } = usePlan();
  const [status, setStatus] = useState<string | null>(null);

  const shortages = result.balances.filter((b) => b.net < -1e-6);
  const surpluses = result.balances.filter((b) => b.net > 1e-6);

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
        db={db} title="Imports" kind="imports" flows={site.imports}
        hint="Belted or trained in from elsewhere, so it isn't counted as a shortage."
        onAdd={addFlow} onUpdate={updateFlow} onRemove={removeFlow}
      />

      <BalanceTable db={db} title="Shortages" rows={shortages} tone="bad" empty="Nothing short." />
      <BalanceTable db={db} title="Surplus" rows={surpluses} tone="good" empty="Nothing spare." />

      {!!result.rawInputs.length && (
        <section className="section">
          <h3>Raw extraction needed</h3>
          <ul className="feeds">
            {result.rawInputs.map((b) => (
              <li key={b.item}>
                <span>{db.itemName(b.item)}</span>
                <strong>{fmt(-b.net)}/min</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

type FlowKind = "targets" | "imports";

function FlowEditor({
  db, title, kind, flows, hint, onAdd, onUpdate, onRemove,
}: {
  db: Db;
  title: string;
  kind: FlowKind;
  flows: Site["targets"];
  hint: string;
  onAdd: (k: FlowKind, item: string, perMinute: number) => void;
  onUpdate: (k: FlowKind, id: string, patch: { item?: string; perMinute?: number }) => void;
  onRemove: (k: FlowKind, id: string) => void;
}) {
  const [pick, setPick] = useState("");
  // Only items something can actually make or mine are worth offering.
  const options = useMemo(
    () =>
      Object.values(db.items)
        .filter((i) => db.producersOf[i.class]?.length || i.isRawResource)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db],
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
