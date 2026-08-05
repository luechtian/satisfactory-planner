import { usePlan } from "../store/planStore";

/**
 * A foldable block of a side panel.
 *
 * The heading doubles as the key its folded state is stored under, so the two cannot
 * drift apart — which does mean two sections in the same panel must not share a name.
 *
 * `count` shows only while folded. Folding Shortages must not become a way to stop
 * knowing you have three, and the same goes for anything else worth a number.
 */
export function Section({
  name, count, first, children,
}: {
  name: string;
  count?: number;
  /** drops the divider above, for the block that opens a panel */
  first?: boolean;
  children: React.ReactNode;
}) {
  const collapsed = usePlan((s) => s.collapsedSections.includes(name));
  const toggle = usePlan((s) => s.toggleSection);

  return (
    <section className={`section ${first ? "section--first" : ""}`}>
      {/* A folded section is nothing but its heading, so it should not go on reserving
          the gap that would have separated it from its contents. */}
      <h3 className={`section__title ${collapsed ? "section__title--folded" : ""}`}>
        <button
          className="section__head"
          onClick={() => toggle(name)}
          aria-expanded={!collapsed}
          title={collapsed ? `Show ${name}` : `Hide ${name}`}
        >
          <span className="section__caret">{collapsed ? "▸" : "▾"}</span>
          {name}
          {collapsed && !!count && <span className="section__count">{count}</span>}
        </button>
      </h3>
      {!collapsed && children}
    </section>
  );
}
