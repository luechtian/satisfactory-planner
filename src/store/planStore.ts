import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Db } from "../core/data";
import { layoutSite } from "../core/layout";
import { solveSite } from "../core/solver";
import type {
  ExtractorNode, MachineNode, Plan, PlanFlow, PlanNode, Purity, Site,
} from "../core/types";

const uid = () => Math.random().toString(36).slice(2, 9);

export const emptySite = (name: string): Site => ({
  id: uid(), name, nodes: [], targets: [], imports: [],
});

interface PlanState {
  plan: Plan;
  activeSiteId: string;
  selectedNodeId: string | null;

  site: () => Site;
  setActiveSite: (id: string) => void;
  setSelectedNode: (id: string | null) => void;

  addSite: (name: string) => void;
  renameSite: (id: string, name: string) => void;
  removeSite: (id: string) => void;

  addNode: (recipe: string, position?: { x: number; y: number }) => void;
  addExtractor: (building: string, resource: string, purity: Purity) => void;
  updateNode: (id: string, patch: Partial<MachineNode> & Partial<ExtractorNode>) => void;
  removeNode: (id: string) => void;

  addFlow: (kind: "targets" | "imports", item: string, perMinute: number) => void;
  updateFlow: (kind: "targets" | "imports", id: string, patch: Partial<PlanFlow>) => void;
  removeFlow: (kind: "targets" | "imports", id: string) => void;
  setSupply: (item: string, perMinute: number) => void;

  solve: (db: Db) => { added: number; diverged: boolean };
  tidy: (db: Db) => void;
  replacePlan: (plan: Plan) => void;
}

const initial: Plan = { version: 1, sites: [emptySite("New site")] };

export const usePlan = create<PlanState>()(
  persist(
    (set, get) => {
      /** Apply `fn` to the active site and write it back. */
      const mutate = (fn: (s: Site) => Site) =>
        set((st) => ({
          plan: {
            ...st.plan,
            sites: st.plan.sites.map((s) => (s.id === st.activeSiteId ? fn(s) : s)),
          },
        }));

      return {
        plan: initial,
        activeSiteId: initial.sites[0].id,
        selectedNodeId: null,

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
        renameSite: (id, name) =>
          set((st) => ({
            plan: { ...st.plan, sites: st.plan.sites.map((s) => (s.id === id ? { ...s, name } : s)) },
          })),
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
          mutate((s) => ({ ...s, nodes: s.nodes.filter((n) => n.id !== id) })),

        addFlow: (kind, item, perMinute) =>
          mutate((s) => ({ ...s, [kind]: [...s[kind], { id: uid(), item, perMinute }] })),
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

        solve: (db) => {
          const result = solveSite(db, get().site());
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

        tidy: (db) =>
          mutate((s) => {
            const pos = layoutSite(db, s);
            return { ...s, nodes: s.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) };
          }),

        replacePlan: (plan) =>
          set({ plan, activeSiteId: plan.sites[0]?.id ?? "", selectedNodeId: null }),
      };
    },
    {
      name: "satisfactory-planner",
      partialize: (st) => ({ plan: st.plan, activeSiteId: st.activeSiteId }),
    },
  ),
);
