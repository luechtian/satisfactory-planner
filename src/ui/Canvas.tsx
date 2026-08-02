import { useMemo } from "react";
import {
  Background, Controls, MiniMap, ReactFlow,
  type Connection, type Edge, type IsValidConnection, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Db } from "../core/data";
import type { ExportClaim } from "../core/overview";
import { DISPLAY_EPS, fmt } from "../core/solver";
import { isExtractor } from "../core/types";
import type { Site, SiteResult } from "../core/types";
import { usePlan } from "../store/planStore";
import { ExtractorNodeView } from "./ExtractorNode";
import { HubNodeView } from "./HubNode";
import { ImportNodeView } from "./ImportNode";
import { OutputNodeView } from "./OutputNode";
import { RecipeNode } from "./RecipeNode";

// "output" would collide with one of React Flow's built-in node types, whose default
// stylesheet then paints a white box behind ours.
const nodeTypes = {
  recipe: RecipeNode, extractor: ExtractorNodeView,
  sink: OutputNodeView, source: ImportNodeView, hub: HubNodeView,
};

const OUT_COL_GAP = 460;
const NODE_W = 260;
const MIN_GAP = 96;

/**
 * Nudge overlapping items apart vertically, keeping their order. Derived nodes are
 * placed relative to whatever they connect to, so several can land on the same spot.
 */
function spread<T extends { y: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap < MIN_GAP) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + MIN_GAP };
  }
  return sorted;
}

/** One end of a belt: who, and how much of the item they push or pull. */
interface Port {
  nodeId: string;
  rate: number;
  x: number;
  y: number;
}

export function Canvas({
  db, site, result, exports, otherSites, onOpenSite,
}: {
  db: Db;
  site: Site;
  result: SiteResult;
  exports: ExportClaim[];
  /** other sites, for naming where an import comes from */
  otherSites: Array<{ id: string; name: string }>;
  onOpenSite: (id: string) => void;
}) {
  const {
    updateNode, removeNode, setSelectedNode, setSinkPosition,
    addConnection, removeConnection,
  } = usePlan();

  const { nodes, edges } = useMemo(() => {
    const resultById = new Map(result.nodes.map((r) => [r.nodeId, r]));
    const siteNames = new Map(otherSites.map((s) => [s.id, s.name]));

    // Who makes and who takes each item — used for the "nothing feeds this" port flag.
    const producers = new Map<string, string[]>();
    const consumers = new Map<string, string[]>();
    for (const n of site.nodes) {
      if (isExtractor(n)) {
        push(producers, n.resource, n.id);
        continue;
      }
      const r = db.recipeByClass[n.recipe];
      if (!r) continue;
      for (const p of r.products) push(producers, p.item, n.id);
      for (const g of r.ingredients) push(consumers, g.item, n.id);
    }

    // Belted-in material needs a source on the canvas, or machines fed entirely by
    // imports draw no edges and their ports read as unfed.
    const sources = site.imports.map((f) => ({
      key: `import:${f.id}`,
      item: f.item,
      perMinute: f.perMinute,
      fromId: f.from,
      fromName: f.from ? siteNames.get(f.from) : undefined,
    }));
    for (const s of sources) push(producers, s.item, s.key);

    const nodes: Node[] = site.nodes.map((n) => {
      const common = {
        id: n.id,
        position: n.position,
        onChange: (patch: object) => updateNode(n.id, patch),
        onRemove: () => removeNode(n.id),
      };

      if (isExtractor(n)) {
        return {
          id: common.id,
          type: "extractor",
          position: common.position,
          data: {
            db, node: n, result: resultById.get(n.id),
            loose: !(consumers.get(n.resource) ?? []).length,
            onChange: common.onChange, onRemove: common.onRemove,
          },
        };
      }

      const r = db.recipeByClass[n.recipe];
      return {
        id: common.id,
        type: "recipe",
        position: common.position,
        data: {
          db, node: n, result: resultById.get(n.id),
          loose: {
            inputs: new Set((r?.ingredients ?? [])
              .filter((g) => !(producers.get(g.item) ?? []).some((id) => id !== n.id))
              .map((g) => g.item)),
            outputs: new Set((r?.products ?? [])
              .filter((p) => !(consumers.get(p.item) ?? []).some((id) => id !== n.id))
              .map((p) => p.item)),
          },
          onChange: common.onChange, onRemove: common.onRemove,
        },
      };
    });

    // Where material leaves: targets shipped out, plus exports other sites claim.
    // Derived every render — see OutputNode for why these are never stored.
    const sinks = [
      ...site.targets.map((f) => ({
        key: `target:${f.item}`, item: f.item, perMinute: f.perMinute,
        toName: undefined as string | undefined, toId: undefined as string | undefined,
      })),
      ...exports.map((e) => ({
        key: `export:${e.toId}:${e.item}`, item: e.item, perMinute: e.perMinute,
        toName: e.toName, toId: e.toId,
      })),
    ];

    const right = Math.max(...site.nodes.map((n) => n.position.x), 0);
    const feederY = (item: string) => {
      const ys = (producers.get(item) ?? [])
        .map((id) => site.nodes.find((n) => n.id === id)?.position.y)
        .filter((y): y is number => y !== undefined);
      return ys.length ? ys.reduce((a, y) => a + y, 0) / ys.length : 0;
    };
    const placed = spread(sinks.map((s) => ({ ...s, y: feederY(s.item) || 60 })));

    const sinkPos = new Map<string, { x: number; y: number }>();
    placed.forEach((s) => {
      const at = site.sinkPositions?.[s.key] ?? { x: right + OUT_COL_GAP, y: s.y };
      sinkPos.set(s.key, at);
      const bal = result.balances.find((b) => b.item === s.item);
      nodes.push({
        id: s.key,
        type: "sink",
        // Auto-placed beside its feeder until dragged, then remembered.
        position: at,
        deletable: false,
        data: {
          db, item: s.item, perMinute: s.perMinute, toName: s.toName,
          short: bal && bal.net < -DISPLAY_EPS ? -bal.net : 0,
          orphan: !(producers.get(s.item) ?? []).length,
          onOpen: s.toId ? () => onOpenSite(s.toId!) : undefined,
        },
      });
    });

    const leftEdge = site.nodes.length
      ? Math.min(...site.nodes.map((n) => n.position.x))
      : OUT_COL_GAP;
    const takerY = (item: string) => {
      const ys = (consumers.get(item) ?? [])
        .map((id) => site.nodes.find((n) => n.id === id)?.position.y)
        .filter((y): y is number => y !== undefined);
      return ys.length ? ys.reduce((a, y) => a + y, 0) / ys.length : 0;
    };
    const srcPos = new Map<string, { x: number; y: number }>();
    for (const s of spread(sources.map((s) => ({ ...s, y: takerY(s.item) || 60 })))) {
      const at = site.sinkPositions?.[s.key] ?? { x: leftEdge - OUT_COL_GAP, y: s.y };
      srcPos.set(s.key, at);
      const taken = (consumers.get(s.item) ?? []).filter((id) => id !== s.key).length;
      const bal = result.balances.find((b) => b.item === s.item);
      nodes.push({
        id: s.key,
        type: "source",
        position: at,
        deletable: false,
        data: {
          db, item: s.item, perMinute: s.perMinute, fromName: s.fromName,
          unused: !taken ? 0 : Math.max(0, Math.min(s.perMinute, bal ? bal.net : 0)),
          orphan: !taken,
          onOpen: s.fromId ? () => onOpenSite(s.fromId!) : undefined,
        },
      });
    }

    // Wire each item up, treating sinks as just another consumer.
    const posOf = (id: string) =>
      site.nodes.find((n) => n.id === id)?.position ??
      sinkPos.get(id) ?? srcPos.get(id) ?? { x: 0, y: 0 };

    // Net each machine per item before deciding which side it is on. A Blender making
    // Encased Uranium Cells drinks 40 Sulfuric Acid and hands 10 back, so it is a net
    // consumer of 30 and belongs solely on the demand side. Listing it as both would
    // invite an edge from itself to itself; excluding it from demand for being a
    // producer — which is what this used to do — left its acid input unreachable to
    // anything at all, by hand or otherwise.
    const netBy = new Map<string, Map<string, number>>();
    const bump = (item: string, nodeId: string, by: number) => {
      const per = netBy.get(item) ?? new Map<string, number>();
      per.set(nodeId, (per.get(nodeId) ?? 0) + by);
      netBy.set(item, per);
    };
    for (const r of result.nodes) {
      for (const p of r.outputs) bump(p.item, r.nodeId, p.perMinute);
      for (const p of r.inputs) bump(p.item, r.nodeId, -p.perMinute);
    }

    const supplyBy = new Map<string, Port[]>();
    const demandBy = new Map<string, Port[]>();
    for (const [item, perNode] of netBy) {
      for (const [nodeId, net] of perNode) {
        const at = posOf(nodeId);
        if (net > DISPLAY_EPS) push(supplyBy, item, { nodeId, rate: net, ...at });
        else if (net < -DISPLAY_EPS) push(demandBy, item, { nodeId, rate: -net, ...at });
      }
    }
    for (const s of sinks) {
      const at = sinkPos.get(s.key) ?? { x: 0, y: 0 };
      push(demandBy, s.item, { nodeId: s.key, rate: s.perMinute, ...at });
    }
    for (const s of sources) {
      const at = srcPos.get(s.key) ?? { x: 0, y: 0 };
      push(supplyBy, s.item, { nodeId: s.key, rate: s.perMinute, ...at });
    }

    const edges: Edge[] = [];
    const hubs: Array<{
      id: string; item: string; x: number; y: number; supply: number; demand: number;
    }> = [];

    const drawn = site.connections ?? [];

    for (const [item, allSupply] of supplyBy) {
      const supply = allSupply.filter((s) => s.rate > DISPLAY_EPS);
      const demand = (demandBy.get(item) ?? []).filter((d) => d.rate > DISPLAY_EPS);
      if (!supply.length || !demand.length) continue;

      const bal = result.balances.find((b) => b.item === item);
      const short = !!bal && bal.net < -DISPLAY_EPS;
      const cls = (toSink: boolean, manual: boolean) =>
        [short ? "edge--short" : "", toSink ? "edge--sink" : "", manual ? "edge--manual" : ""]
          .filter(Boolean).join(" ") || undefined;

      // Hand-drawn belts are taken as fact and served first.
      const spare = new Map(supply.map((s) => [s.nodeId, s.rate]));
      const wanted = new Map(demand.map((d) => [d.nodeId, d.rate]));

      const mine = drawn.filter(
        (c) => c.item === item && spare.has(c.from) && wanted.has(c.to),
      );
      const alloc = mine.map((c) => {
        const flow = Math.min(spare.get(c.from)!, wanted.get(c.to)!);
        spare.set(c.from, spare.get(c.from)! - flow);
        wanted.set(c.to, wanted.get(c.to)! - flow);
        return { c, flow };
      });

      // Wiring a port is a statement about where that item comes from or goes. So a
      // machine you have wired is off limits to the pooling below: if the belt cannot
      // keep up, it is drawn red and left short rather than quietly topped up from
      // whatever else happens to make the same thing.
      const claimedIn = new Set(mine.map((c) => c.to));
      const claimedOut = new Set(mine.map((c) => c.from));

      for (const { c, flow } of alloc) {
        const missing = wanted.get(c.to) ?? 0;
        const under = missing > DISPLAY_EPS;
        edges.push({
          id: c.id,
          source: c.from, target: c.to,
          sourceHandle: `out-${item}`, targetHandle: `in-${item}`,
          label: under
            ? `${db.itemName(item)} ${fmt(flow)}/min · short ${fmt(missing)}`
            : `${db.itemName(item)} ${fmt(flow)}/min`,
          className: [
            "edge--manual",
            under ? "edge--under" : "",
            isSynthetic(c.to) ? "edge--sink" : "",
          ].filter(Boolean).join(" "),
          deletable: true,
          animated: under,
        });
      }

      const leftIn = supply.filter(
        (s) => !claimedOut.has(s.nodeId) && (spare.get(s.nodeId) ?? 0) > DISPLAY_EPS,
      );
      const leftOut = demand.filter(
        (d) => !claimedIn.has(d.nodeId) && (wanted.get(d.nodeId) ?? 0) > DISPLAY_EPS,
      );
      if (!leftIn.length || !leftOut.length) continue;

      // One producer, one consumer: no ambiguity, so no manifold.
      if (leftIn.length === 1 && leftOut.length === 1) {
        const [s] = leftIn, [d] = leftOut;
        edges.push({
          id: `${s.nodeId}->${d.nodeId}:${item}`,
          source: s.nodeId, target: d.nodeId,
          sourceHandle: `out-${item}`, targetHandle: `in-${item}`,
          label: `${db.itemName(item)} ${fmt(Math.min(spare.get(s.nodeId)!, wanted.get(d.nodeId)!))}/min`,
          className: cls(isSynthetic(d.nodeId), false),
          deletable: false,
          animated: short,
        });
        continue;
      }

      // Otherwise the remainder meets in the middle, each arrow carrying its real rate.
      const hubId = `hub:${item}`;
      const both = [...leftIn, ...leftOut];
      hubs.push({
        id: hubId,
        item,
        x: Math.max(...leftIn.map((s) => s.x)) + NODE_W + 40,
        y: both.reduce((n, m) => n + m.y, 0) / both.length + 30,
        supply: leftIn.reduce((n, s) => n + spare.get(s.nodeId)!, 0),
        demand: leftOut.reduce((n, d) => n + wanted.get(d.nodeId)!, 0),
      });

      for (const s of leftIn) {
        edges.push({
          id: `${s.nodeId}->${hubId}`,
          source: s.nodeId, target: hubId,
          sourceHandle: `out-${item}`, targetHandle: `in-${item}`,
          label: `${fmt(spare.get(s.nodeId)!)}/min`,
          className: cls(false, false),
          deletable: false,
        });
      }
      for (const d of leftOut) {
        edges.push({
          id: `${hubId}->${d.nodeId}`,
          source: hubId, target: d.nodeId,
          sourceHandle: `out-${item}`, targetHandle: `in-${item}`,
          label: `${fmt(wanted.get(d.nodeId)!)}/min`,
          className: cls(isSynthetic(d.nodeId), false),
          deletable: false,
          animated: short,
        });
      }
    }

    // Several manifolds can land in the same gutter, so separate them by column first.
    const byColumn = new Map<number, typeof hubs>();
    for (const h of hubs) push(byColumn, h.x, h);
    for (const column of byColumn.values()) {
      for (const h of spread(column)) {
        nodes.push({
          id: h.id,
          type: "hub",
          position: { x: h.x, y: h.y },
          draggable: false,
          deletable: false,
          selectable: false,
          data: { db, item: h.item, supply: h.supply, demand: h.demand },
        });
      }
    }

    return { nodes, edges };
  }, [db, site, result, exports, otherSites, onOpenSite, updateNode, removeNode]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      // Output nodes are synthesised, not stored — their ids match no PlanNode, so a
      // change for one must never reach updateNode. Dragging is the exception: the
      // position is layout, and gets remembered separately.
      if ("id" in c && isSynthetic(c.id)) {
        if (c.type === "position" && c.position) setSinkPosition(c.id, c.position);
        continue;
      }
      if (c.type === "position" && c.position) updateNode(c.id, { position: c.position });
      if (c.type === "select") setSelectedNode(c.selected ? c.id : null);
      if (c.type === "remove") removeNode(c.id);
    }
  };

  /** Handles are `out-<item>` / `in-<item>`, so both ends must name the same item. */
  const itemOf = (handle: string | null | undefined) => handle?.replace(/^(in|out)-/, "");
  const isValidConnection: IsValidConnection = (c) => {
    const item = itemOf(c.sourceHandle);
    return (
      !!item && item === itemOf(c.targetHandle) &&
      c.source !== c.target &&
      // A manifold is generated, not wired — belts attach to real endpoints.
      !c.source?.startsWith("hub:") && !c.target?.startsWith("hub:")
    );
  };

  const onConnect = (c: Connection) => {
    const item = itemOf(c.sourceHandle);
    if (item && c.source && c.target) addConnection(c.source, c.target, item);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      // Edge selection needs onEdgesChange, which controlled mode does not give us, so
      // the Delete key never fires. Double-click removes a hand-drawn belt instead;
      // generated ones have no stored record and simply ignore it.
      onEdgeDoubleClick={(_, e) => {
        if (e.className?.includes("edge--manual")) removeConnection(e.id);
      }}
      nodesConnectable
      fitView
      // Without a cap, a two-node site fills the screen at 4x.
      fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
      minZoom={0.15}
      proOptions={{ hideAttribution: false }}
    >
      {/* React Flow takes these as props rather than CSS, so they are read back off
          the theme variables instead of being hardcoded per palette. */}
      <Background gap={20} size={1} color="var(--edge)" />
      <Controls />
      <MiniMap
        pannable zoomable
        nodeColor="var(--minimap-node)"
        nodeStrokeWidth={0}
        maskColor="var(--minimap-mask)"
        bgColor="var(--bg-2)"
      />
    </ReactFlow>
  );
}

const isSynthetic = (id: string) =>
  id.startsWith("target:") || id.startsWith("export:") ||
  id.startsWith("import:") || id.startsWith("hub:");

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
