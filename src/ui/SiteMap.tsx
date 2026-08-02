import { useMemo } from "react";
import {
  Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeProps, type NodeChange,
} from "@xyflow/react";
import type { Db } from "../core/data";
import type { PlanSummary } from "../core/overview";
import { DISPLAY_EPS, fmt } from "../core/solver";
import type { Plan } from "../core/types";
import { usePlan } from "../store/planStore";

const COL_W = 300;
const ROW_H = 150;
const NODE_H = 110;

interface SiteNodeData extends Record<string, unknown> {
  name: string;
  group?: string;
  powerMW: number;
  short: number;
  spare: number;
  /** demand no other site covers, so it has to come from outside the plan */
  unmet: number;
}

function SiteNodeView({ data, selected }: NodeProps & { data: SiteNodeData }) {
  const { name, group, powerMW, short, spare, unmet } = data;
  return (
    <div className={`sitenode ${short ? "sitenode--short" : ""} ${selected ? "sitenode--on" : ""}`}>
      <Handle type="target" position={Position.Left} />
      {group && <div className="sitenode__group">{group}</div>}
      <div className="sitenode__name">{name}</div>
      <div className="sitenode__power">{fmt(powerMW, 1)} MW</div>
      <div className="sitenode__flags">
        {short > 0 && <span className="neg">{short} short</span>}
        {spare > 0 && <span className="pos">{spare} spare</span>}
        {!short && !spare && <span className="muted">balanced</span>}
      </div>
      {unmet > 0 && <div className="sitenode__unmet">{unmet} from outside</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { site: SiteNodeView };

/**
 * The plan one level up: a site per node, links as edges.
 *
 * The tables below answer "what is short"; this answers "how does the base hang
 * together" — which sites are hubs, which are dead ends, whether supply loops back on
 * itself. Sites are laid out by how deep they sit in the supply chain until dragged,
 * after which the position sticks.
 */
export function SiteMap({
  db, plan, summary, onOpenSite,
}: {
  db: Db;
  plan: Plan;
  summary: PlanSummary;
  onOpenSite: (id: string) => void;
}) {
  const setMapPosition = usePlan((s) => s.setMapPosition);

  const { nodes, edges, height, zoom, shape } = useMemo(() => {
    const feeders = new Map<string, Set<string>>();
    for (const l of summary.links) {
      for (const c of l.consumers) {
        if (!feeders.has(c.id)) feeders.set(c.id, new Set());
        feeders.get(c.id)!.add(l.sourceId);
      }
    }

    // Depth = longest chain of suppliers behind a site. A cycle is broken by treating
    // the back edge as depth 0, the same trick the per-site layout uses.
    const depth = new Map<string, number>();
    const active = new Set<string>();
    const depthOf = (id: string): number => {
      const seen = depth.get(id);
      if (seen !== undefined) return seen;
      if (active.has(id)) return 0;
      active.add(id);
      const d = [...(feeders.get(id) ?? [])].reduce((m, f) => Math.max(m, depthOf(f) + 1), 0);
      active.delete(id);
      depth.set(id, d);
      return d;
    };
    for (const s of summary.sites) depthOf(s.id);

    const rows = new Map<number, number>();
    const nodes: Node[] = summary.sites.map((s) => {
      const d = depth.get(s.id) ?? 0;
      const row = rows.get(d) ?? 0;
      rows.set(d, row + 1);
      const stored = plan.sites.find((x) => x.id === s.id)?.mapPosition;
      return {
        id: s.id,
        type: "site",
        position: stored ?? { x: 40 + d * COL_W, y: 40 + row * ROW_H },
        data: {
          name: s.name, group: s.group, powerMW: s.powerMW,
          short: s.shortages, spare: s.surpluses,
          // Shortages nobody else supplies — the plan's true external inputs.
          unmet: summary.items.filter(
            (r) => r.shortAt.some((x) => x.id === s.id) && r.spare <= DISPLAY_EPS,
          ).length,
        } satisfies SiteNodeData,
      };
    });

    const edges: Edge[] = summary.links.flatMap((l) =>
      l.consumers.map((c) => ({
        id: `${l.sourceId}->${c.id}:${l.item}`,
        source: l.sourceId,
        target: c.id,
        label: `${db.itemName(l.item)} ${fmt(c.perMinute)}/min`,
        className: l.over > DISPLAY_EPS ? "edge--short" : undefined,
        animated: l.over > DISPLAY_EPS,
      })),
    );

    // Height is derived rather than fitted. React Flow's fitView runs before it has
    // measured the nodes, so it lands off-centre and clips; the measured re-fit never
    // fired at all. Since this layout is ours, the extent is already known — size the
    // frame to it and leave the viewport alone. The fit button covers manual panning.
    const rowCount = Math.max(...[...rows.values()], 1);
    const height = Math.min(620, Math.max(240, rowCount * ROW_H + 70));
    // Past the height cap, zoom out rather than clip. Only the vertical extent is
    // worth scaling for: columns grow with chain depth, which stays small, whereas
    // unlinked sites all pile into one column.
    const contentH = (rowCount - 1) * ROW_H + NODE_H;
    const zoom = Math.max(0.3, Math.min(1, (height - 40) / contentH));

    return { nodes, edges, height, zoom, shape: `${rowCount}x${rows.size}` };
  }, [db, plan.sites, summary]);

  if (!summary.sites.length) return null;

  return (
    <div className="sitemap" style={{ height }}>
      <ReactFlowProvider>
      <ReactFlow
        // Remount when the shape changes so the derived viewport is reapplied; panning
        // is otherwise left entirely to the user.
        key={shape}
        defaultViewport={{ x: 24, y: 20, zoom }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        onNodeClick={(_, n) => onOpenSite(n.id)}
        onNodesChange={(changes: NodeChange[]) => {
          for (const c of changes) {
            if (c.type === "position" && c.position) setMapPosition(c.id, c.position);
          }
        }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="var(--edge)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
