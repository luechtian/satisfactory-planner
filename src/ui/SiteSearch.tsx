import { useEffect, useMemo, useRef, useState } from "react";
import type { Plan } from "../core/types";

/**
 * Quick switcher for the tab bar.
 *
 * A filter over the tabs themselves would still leave the bar overflowing once there
 * are enough sites, so this is a list instead: type, arrow through, Enter to jump.
 */
export function SiteSearch({ plan, onOpenSite }: { plan: Plan; onOpenSite: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plan.sites.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.group?.toLowerCase().includes(q),
    );
  }, [plan.sites, query]);

  useEffect(() => {
    if (open) input.current?.focus();
    else { setQuery(""); setCursor(0); }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (id: string) => { onOpenSite(id); setOpen(false); };

  return (
    <div className="sitesearch" ref={box}>
      <button
        className={`btn btn--icon ${open ? "btn--on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Find a site"
        aria-label="Find a site"
      >
        ⌕
      </button>

      {open && (
        <div className="sitesearch__pop">
          <input
            ref={input}
            className="search"
            placeholder="Find a site…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === "Enter" && hits[cursor]) pick(hits[cursor].id);
            }}
          />
          <ul className="sitesearch__list">
            {hits.map((s, i) => (
              <li key={s.id}>
                <button
                  className={`sitesearch__hit ${i === cursor ? "sitesearch__hit--on" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(s.id)}
                >
                  <span>{s.name}</span>
                  {s.group && <span className="muted">{s.group}</span>}
                </button>
              </li>
            ))}
            {!hits.length && <li className="muted pad">no match</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
