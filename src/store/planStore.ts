import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Db } from "../core/data";
import { layoutSite } from "../core/layout";
import { exportsOf } from "../core/overview";
import { solveSite } from "../core/solver";
import type {
  ExtractorNode, MachineNode, Plan, PlanFlow, PlanNode, Purity, Site,
} from "../core/types";

const uid = () => Math.random().toString(36).slice(2, 9);

export const emptySite = (name: string): Site => ({
  id: uid(), name, nodes: [], targets: [], imports: [],
});

export type Theme = "dark" | "light";

/** First visit follows the OS; after that the toggle wins and is remembered. */
const systemTheme = (): Theme =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";

interface PlanState {
  plan: Plan;
  activeSiteId: string;
  selectedNodeId: string | null;
  theme: Theme;
  toggleTheme: () => void;
  /** underclock solved nodes to kill surplus; off by default */
  trimClocks: boolean;
  setTrimClocks: (v: boolean) => void;
  /** group headings folded shut in the tab bar */
  collapsedGroups: string[];
  toggleGroup: (name: string) => void;

  site: () => Site;
  setActiveSite: (id: string) => void;
  setSelectedNode: (id: string | null) => void;

  addSite: (name: string) => void;
  renameSite: (id: string, name: string, group?: string) => void;
  /** move a site to a new index in the tab order */
  moveSite: (id: string, toIndex: number) => void;
  removeSite: (id: string) => void;

  addNode: (recipe: string, position?: { x: number; y: number }) => void;
  addExtractor: (building: string, resource: string, purity: Purity) => void;
  updateNode: (id: string, patch: Partial<MachineNode> & Partial<ExtractorNode>) => void;
  removeNode: (id: string) => void;

  addFlow: (kind: "targets" | "imports", item: string, perMinute: number) => void;
  /** create an import on `targetSiteId` drawing from `sourceSiteId` — used by the overview */
  linkSites: (targetSiteId: string, sourceSiteId: string, item: string, perMinute: number) => void;
  updateFlow: (kind: "targets" | "imports", id: string, patch: Partial<PlanFlow>) => void;
  removeFlow: (kind: "targets" | "imports", id: string) => void;
  setSupply: (item: string, perMinute: number) => void;

  /** remember where a derived target/export node was dragged */
  setSinkPosition: (key: string, position: { x: number; y: number }) => void;
  addConnection: (from: string, to: string, item: string) => void;
  removeConnection: (id: string) => void;

  solve: (db: Db) => { added: number; diverged: boolean };
  tidy: (db: Db) => void;
  replacePlan: (plan: Plan) => void;
}

const initial: Plan = { version: 1, sites: [emptySite("New site")] };

export const usePlan = create<PlanState>()(
  persist(
    (set, get) => {
      /** Apply `fn` to one site by id and write it back. */
      const mutateSite = (id: string, fn: (s: Site) => Site) =>
        set((st) => ({
          plan: { ...st.plan, sites: st.plan.sites.map((s) => (s.id === id ? fn(s) : s)) },
        }));

      /** Apply `fn` to the active site and write it back. */
      const mutate = (fn: (s: Site) => Site) => mutateSite(get().activeSiteId, fn);

      return {
        plan: initial,
        activeSiteId: initial.sites[0].id,
        selectedNodeId: null,
        theme: systemTheme(),
        toggleTheme: () => set((st) => ({ theme: st.theme === "dark" ? "light" : "dark" })),
        trimClocks: false,
        setTrimClocks: (v) => set({ trimClocks: v }),
        collapsedGroups: [],
        toggleGroup: (name) =>
          set((st) => ({
            collapsedGroups: st.collapsedGroups.includes(name)
              ? st.collapsedGroups.filter((g) => g !== name)
              : [...st.collapsedGroups, name],
          })),

        site: () => {
          const st = get();
          return st.plan.sites.find((s) => s.id === st.activeSiteId) ?? st.plan.sites[0];
        },
        setActiveSite: (id) => set({ activeSiteId: id, selectedNodeId: null }),
        setSelectedNode: (id) => set({ selectedNodeId: id }),

        addSite: (name) =>
          set((st) => {
            const s = emptySite(name);
            return { plan: { ...st.plan, sites: [...st.plan.sites, s] }, activeSiteId: s.id };
          }),
        renameSite: (id, name, group) =>
          set((st) => ({
            plan: {
              ...st.plan,
              sites: st.plan.sites.map((s) =>
                s.id === id ? { ...s, name, group: group || undefined } : s,
              ),
            },
          })),
        moveSite: (id, toIndex) =>
          set((st) => {
            const sites = [...st.plan.sites];
            const from = sites.findIndex((s) => s.id === id);
            if (from < 0) return st;
            const [moved] = sites.splice(from, 1);
            sites.splice(Math.max(0, Math.min(sites.length, toIndex)), 0, moved);
            return { plan: { ...st.plan, sites } };
          }),
        removeSite: (id) =>
          set((st) => {
            const sites = st.plan.sites.filter((s) => s.id !== id);
            if (!sites.length) sites.push(emptySite("New site"));
            return {
              plan: { ...st.plan, sites },
              activeSiteId: st.activeSiteId === id ? sites[0].id : st.activeSiteId,
            };
          }),

        addNode: (recipe, position) =>
          mutate((s) => {
            // Drop new nodes into the next free column so they don't stack on each other.
            const i = s.nodes.length;
            return {
              ...s,
              nodes: [...s.nodes, {
                id: uid(), recipe, count: 1, clock: 100,
                position: position ?? { x: 60 + (i % 4) * 320, y: 60 + Math.floor(i / 4) * 240 },
              }],
            };
          }),
        addExtractor: (building, resource, purity) =>
          mutate((s) => {
            const i = s.nodes.length;
            return {
              ...s,
              nodes: [...s.nodes, {
                kind: "extractor", id: uid(), building, resource, purity,
                count: 1, clock: 100,
                position: { x: 60 + (i % 4) * 320, y: 60 + Math.floor(i / 4) * 240 },
              }],
            };
          }),
        // Patches only ever touch fields shared by both node kinds or fields of the
        // node's own kind, but the spread widens the union, so it needs re-narrowing.
        updateNode: (id, patch) =>
          mutate((s) => ({
            ...s,
            nodes: s.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as PlanNode) : n)),
          })),
        removeNode: (id) =>
          mutate((s) => ({
            ...s,
            nodes: s.nodes.filter((n) => n.id !== id),
            // Otherwise a hand-drawn belt would dangle off a node that no longer exists.
            connections: (s.connections ?? []).filter((c) => c.from !== id && c.to !== id),
          })),

        addFlow: (kind, item, perMinute) =>
          mutate((s) => ({ ...s, [kind]: [...s[kind], { id: uid(), item, perMinute }] })),

        // Folds into any existing import of the same item from the same source rather
        // than stacking a second row, so clicking Link twice is harmless.
        linkSites: (targetSiteId, sourceSiteId, item, perMinute) =>
          mutateSite(targetSiteId, (s) => {
            const existing = s.imports.find((f) => f.item === item && f.from === sourceSiteId);
            return existing
              ? {
                  ...s,
                  imports: s.imports.map((f) =>
                    f.id === existing.id ? { ...f, perMinute } : f,
                  ),
                }
              : { ...s, imports: [...s.imports, { id: uid(), item, perMinute, from: sourceSiteId }] };
          }),
        updateFlow: (kind, id, patch) =>
          mutate((s) => ({
            ...s,
            [kind]: s[kind].map((f) => (f.id === id ? { ...f, ...patch } : f)),
          })),
        removeFlow: (kind, id) =>
          mutate((s) => ({ ...s, [kind]: s[kind].filter((f) => f.id !== id) })),

        // Raw supply rows appear on their own from what the machines consume, so the
        // input has to upsert: create the entry on first edit, drop it back to implicit
        // when cleared. Stored in `imports` so availability stays one concept.
        setSupply: (item, perMinute) =>
          mutate((s) => {
            const rest = s.imports.filter((f) => f.item !== item);
            return perMinute > 0
              ? { ...s, imports: [...rest, { id: uid(), item, perMinute }] }
              : { ...s, imports: rest };
          }),

        setSinkPosition: (key, position) =>
          mutate((s) => ({ ...s, sinkPositions: { ...s.sinkPositions, [key]: position } })),

        addConnection: (from, to, item) =>
          mutate((s) => {
            const dupe = (s.connections ?? []).some(
              (c) => c.from === from && c.to === to && c.item === item,
            );
            return dupe
              ? s
              : { ...s, connections: [...(s.connections ?? []), { id: uid(), from, to, item }] };
          }),
        removeConnection: (id) =>
          mutate((s) => ({ ...s, connections: (s.connections ?? []).filter((c) => c.id !== id) })),

        solve: (db) => {
          const st = get();
          const result = solveSite(db, st.site(), {
            trimClocks: st.trimClocks,
            // A link is an obligation: solving the source must cover what it owes.
            exports: exportsOf(st.plan, st.activeSiteId),
          });
          mutate((s) => {
            const nodes: PlanNode[] = [
              ...s.nodes.map((n) => ({
                ...n,
                count: result.counts[n.id] ?? n.count,
                clock: result.clocks[n.id] ?? n.clock,
              })),
              ...result.added,
            ];
            // Solver-added nodes land in a cramped row, so re-flow the whole site.
            const pos = layoutSite(db, { ...s, nodes });
            return { ...s, nodes: nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) };
          });
          return { added: result.added.length, diverged: result.diverged };
        },

        // Tidy also drops remembered sink positions, so they fall back to being placed
        // beside whatever feeds them. That doubles as a cleanup for keys left behind by
        // links that have since been deleted.
        tidy: (db) =>
          mutate((s) => {
            const pos = layoutSite(db, s);
            return {
              ...s,
              nodes: s.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
              sinkPositions: {},
            };
          }),

        replacePlan: (plan) =>
          set({ plan, activeSiteId: plan.sites[0]?.id ?? "", selectedNodeId: null }),
      };
    },
    {
      name: "satisfactory-planner",
      // theme rides along here rather than in the plan, so it never lands in an export.
      partialize: (st) => ({
        plan: st.plan, activeSiteId: st.activeSiteId,
        theme: st.theme, trimClocks: st.trimClocks,
        collapsedGroups: st.collapsedGroups,
      }),
    },
  ),
);
