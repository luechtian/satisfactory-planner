import { useRef, useState } from "react";
import type { Plan } from "../core/types";
import { usePlan } from "../store/planStore";
import { SiteSearch } from "./SiteSearch";

/** How far the pointer must travel before a click becomes a drag. */
const DRAG_SLOP = 5;

/**
 * The tab bar.
 *
 * Sites keep one flat order and a group is only a heading that appears wherever the
 * group name changes from the tab before it. So grouping is really "keep these
 * adjacent", and dragging a tab is how you do both — no separate notion of moving a
 * site *into* a group, and no nesting to unpick later.
 *
 * Reordering uses pointer events rather than HTML5 drag-and-drop, which brings drag
 * images and cross-browser quirks along with it and does not work by touch at all.
 */
export function SiteTabs({
  plan, activeSiteId, overview, onOpenOverview, onOpenSite,
}: {
  plan: Plan;
  activeSiteId: string;
  overview: boolean;
  onOpenOverview: () => void;
  onOpenSite: (id: string) => void;
}) {
  const { addSite, renameSite, removeSite, moveSite, toggleGroup } = usePlan();
  const collapsed = usePlan((s) => s.collapsedGroups);
  const nav = useRef<HTMLElement>(null);
  const start = useRef<{ id: string; x: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const rename = (id: string, name: string, group?: string) => {
    // One prompt for both, split on the first slash: "Nuclear / Uranium prep".
    const answer = prompt(
      "Site name — prefix with a group to head a run of tabs, e.g. Nuclear / Uranium prep",
      group ? `${group} / ${name}` : name,
    );
    if (answer === null) return;
    const cut = answer.indexOf("/");
    if (cut < 0) renameSite(id, answer.trim() || name, undefined);
    else renameSite(id, answer.slice(cut + 1).trim() || name, answer.slice(0, cut).trim());
  };

  /** Which slot the pointer currently sits in, by measuring the rendered tabs. */
  const slotAt = (clientX: number) => {
    const tabs = [...(nav.current?.querySelectorAll("[data-site-tab]") ?? [])];
    for (let i = 0; i < tabs.length; i++) {
      const box = tabs[i].getBoundingClientRect();
      if (clientX < box.left + box.width / 2) return i;
    }
    return tabs.length;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    if (!dragging && Math.abs(e.clientX - start.current.x) < DRAG_SLOP) return;
    setDragging(start.current.id);
    setDropAt(slotAt(e.clientX));
  };

  const onPointerUp = () => {
    if (dragging && dropAt !== null) {
      const from = plan.sites.findIndex((x) => x.id === dragging);
      moveSite(dragging, dropAt > from ? dropAt - 1 : dropAt);
    }
    start.current = null;
    setDragging(null);
    setDropAt(null);
  };

  return (
    <nav
      className="tabs"
      ref={nav}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <button
        className={`tab tab--overview ${overview ? "tab--active" : ""}`}
        onClick={onOpenOverview}
        title="Everything across all sites"
      >
        ◱ All sites
      </button>
      <span className="tabs__sep" />

      {plan.sites.map((s, i) => {
        const startsRun = !!s.group && s.group !== plan.sites[i - 1]?.group;
        const folded = !!s.group && collapsed.includes(s.group);
        // The active tab stays put even inside a folded group, so folding never loses
        // your place.
        const hidden = folded && !(s.id === activeSiteId && !overview);
        const runSize = s.group
          ? plan.sites.filter((x, j) => x.group === s.group && j >= i && sameRun(plan, i, j)).length
          : 0;

        return (
        <span className={`tabs__slot ${hidden ? "tabs__slot--folded" : ""}`} key={s.id}>
          {startsRun && (
            <button
              className="tabs__group"
              onClick={() => toggleGroup(s.group!)}
              title={folded ? `Show ${s.group}` : `Hide ${s.group}`}
            >
              <span className="tabs__caret">{folded ? "▸" : "▾"}</span>
              {s.group}
              {folded && <span className="tabs__count">{runSize}</span>}
            </button>
          )}
          {dropAt === i && <span className="tabs__marker" />}
          <button
            data-site-tab={s.id}
            className={`tab ${s.id === activeSiteId && !overview ? "tab--active" : ""} ${
              dragging === s.id ? "tab--dragging" : ""
            }`}
            onPointerDown={(e) => {
              start.current = { id: s.id, x: e.clientX };
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
            // A drag ends on pointerup, so swallow the click it would otherwise fire.
            onClick={() => { if (!dragging) onOpenSite(s.id); }}
            onDoubleClick={() => rename(s.id, s.name, s.group)}
            title="Drag to reorder · double-click to rename or group"
          >
            {s.name}
            {s.id === activeSiteId && !overview && plan.sites.length > 1 && (
              <span
                className="tab__x"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete site "${s.name}"?`)) removeSite(s.id);
                }}
              >
                ×
              </span>
            )}
          </button>
        </span>
        );
      })}
      {dropAt === plan.sites.length && <span className="tabs__marker" />}

      <button className="tab tab--add" onClick={() => addSite(`Site ${plan.sites.length + 1}`)}>
        +
      </button>
      <SiteSearch plan={plan} onOpenSite={onOpenSite} />
    </nav>
  );
}

/** True while sites i..j form one unbroken run of the same group. */
function sameRun(plan: Plan, i: number, j: number) {
  const g = plan.sites[i].group;
  for (let k = i; k <= j; k++) if (plan.sites[k].group !== g) return false;
  return true;
}
