import { useMemo, useState } from "react";
import { alternativesFor, type Db } from "../core/data";
import { fmt, solveSite } from "../core/solver";
import type { Site } from "../core/types";
import { Sheet } from "./Sheet";

/**
 * Set up a solve, then run it.
 *
 * The chain is worked out first and shown as a list of steps, each with the recipes
 * that could make it. That is the moment the choice matters — before the site is
 * rewritten — and it is the only moment the *right* list is knowable, since which items
 * are involved depends on the recipes chosen. Changing one re-solves, so picking Pure
 * Aluminum Ingot drops Silica from the list and adds Water while you watch.
 *
 * The alternative, a standing panel of every item that could be made two ways, showed
 * 76 rows of which two mattered.
 */
export function SolveSheet({
  db, site, exports, trimClocks, onSolve, onClose,
}: {
  db: Db;
  site: Site;
  exports: ReadonlyArray<{ item: string; perMinute: number }>;
  trimClocks: boolean;
  onSolve: (choices: Record<string, string>) => void;
  onClose: () => void;
}) {
  // Starts from what is already pinned, and is only written back if you go through with
  // the solve — backing out leaves the site exactly as it was.
  const [draft, setDraft] = useState<Record<string, string>>(() => site.recipeChoice ?? {});

  const preview = useMemo(
    () => solveSite(db, site, { trimClocks, recipeChoice: draft, exports }),
    [db, site, trimClocks, draft, exports],
  );

  const pick = (item: string, recipe: string | undefined) =>
    setDraft((d) => {
      const next = { ...d };
      if (recipe) next[item] = recipe;
      else delete next[item];
      return next;
    });

  const pinned = Object.keys(draft).length;
  const shortOf = preview.feeds.filter((f) => !db.items[f.item]?.isRawResource);

  return (
    <Sheet
      title="Solve for targets"
      hint="Every step the solve will run. Change any of them and the rest follows — a different recipe needs different inputs."
      onClose={onClose}
      foot={
        <>
          {pinned > 0 && (
            <button className="btn btn--danger" onClick={() => setDraft({})}>
              Reset choices
            </button>
          )}
          <span className="sheet__count">
            {preview.added.length
              ? `adds ${preview.added.length} node${preview.added.length > 1 ? "s" : ""}`
              : "nothing to add"}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSolve(draft)}>Solve</button>
        </>
      }
    >
      {preview.diverged && (
        <p className="sheet__warn">
          The chain did not settle — usually a recipe loop that never closes. Solving
          anyway will give you numbers, but check them.
        </p>
      )}

      {preview.chain.length ? (
        <div className="picks">
          {preview.chain.map(({ item, recipe }) => {
            const alts = alternativesFor(db, item);
            const using = db.recipeByClass[recipe];
            return (
              <div className="pick" key={item}>
                <span className="pick__name">
                  {db.itemName(item)}
                  {draft[item] && <span className="badge badge--replace">pinned</span>}
                </span>

                {alts.length > 1 ? (
                  <select
                    value={draft[item] ?? ""}
                    onChange={(e) => pick(item, e.target.value || undefined)}
                  >
                    <option value="">Default — {alts[0].name}</option>
                    {alts.map((r) => (
                      <option key={r.class} value={r.class}>{r.name}</option>
                    ))}
                  </select>
                ) : (
                  // Only one way to make it. Still listed, because the chain is easier
                  // to read whole than with the single-option steps quietly missing.
                  <span className="pick__only muted">{using?.name ?? recipe} · only way</span>
                )}

                {using && (
                  <span className="pick__meta muted">
                    {fmt(using.products[0]?.perMinute ?? 0)}/min ·{" "}
                    {db.buildings[using.building]?.name ?? "?"} ·{" "}
                    {using.ingredients.map((g) => db.itemName(g.item)).join(" + ") || "no inputs"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted pad">
          Nothing to build — the targets are already covered, or nothing on the canvas
          can make them.
        </p>
      )}

      {shortOf.length > 0 && (
        <p className="sheet__warn">
          Nothing here can make{" "}
          {shortOf.map((f) => `${db.itemName(f.item)} (${fmt(f.perMinute)}/min)`).join(", ")}.
          Add it as an import, or pick a recipe above that does not need it.
        </p>
      )}
    </Sheet>
  );
}
