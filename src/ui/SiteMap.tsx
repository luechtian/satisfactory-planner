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
const NODE_W = 170;
const BAND_GAP = 46;
const BAND_PAD = 22;

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

/** A labelled backdrop wrapping one group's sites. */
function BandView({ data }: NodeProps & { data: { label: string } }) {
  return (
    <div className="band">
      <span className="band__label">{data.label}</span>
    </div>
  );
}

const nodeTypes = { site: SiteNodeView, band: BandView };

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

    // Lay out in horizontal bands, one per group: x still carries supply depth, y now
    // carries membership. Ungrouped sites drop to the bottom band, matching the card
    // list below.
    const bandOrder: Array<string | undefined> = [];
    const members = new Map<string | undefined, typeof summary.sites>();
    for (const s of summary.sites) {
      if (!members.has(s.group)) { members.set(s.group, []); bandOrder.push(s.group); }
      members.get(s.group)!.push(s);
    }
    bandOrder.sort((a, b) => Number(a === undefined) - Number(b === undefined));

    const at = new Map<string, { x: number; y: number }>();
    const rows = new Map<number, number>();
    let bandTop = 40;
    for (const group of bandOrder) {
      const inBand = members.get(group)!;
      const perDepth = new Map<number, number>();
      for (const s of inBand) {
        const d = depth.get(s.id) ?? 0;
        const row = perDepth.get(d) ?? 0;
        perDepth.set(d, row + 1);
        at.set(s.id, { x: 40 + d * COL_W, y: bandTop + row * ROW_H });
      }
      const tall = Math.max(...perDepth.values(), 1);
      rows.set(rows.size, tall);
      bandTop += tall * ROW_H + BAND_GAP;
    }

    const nodes: Node[] = summary.sites.map((s) => {
      const stored = plan.sites.find((x) => x.id === s.id)?.mapPosition;
      return {
        id: s.id,
        type: "site",
        position: stored ?? at.get(s.id) ?? { x: 40, y: 40 },
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

    // Bands are measured from where the sites actually are, so a dragged site drags
    // its band with it rather than leaving the label stranded.
    const byId = new Map(nodes.map((n) => [n.id, n.position]));
    for (const group of bandOrder) {
      if (!group) continue;
      const pts = members.get(group)!.map((s) => byId.get(s.id)!).filter(Boolean);
      if (!pts.length) continue;
      const x = Math.min(...pts.map((p) => p.x)) - BAND_PAD;
      const y = Math.min(...pts.map((p) => p.y)) - BAND_PAD - 14;
      nodes.unshift({
        id: `band:${group}`,
        type: "band",
        position: { x, y },
        draggable: false,
        selectable: false,
        deletable: false,
        zIndex: -1,
        style: {
          width: Math.max(...pts.map((p) => p.x)) + NODE_W + BAND_PAD - x,
          height: Math.max(...pts.map((p) => p.y)) + NODE_H + BAND_PAD - y,
        },
        data: { label: group },
      });
    }

    // One arrow per pair of sites, not per item. Two links between the same two sites
    // produce two edges along an identical path, so they land exactly on top of each
    // other and read as one — the second is invisible and its label overlaps the first.
    // Topology is the map's job; the Links table below carries the per-item detail.
    const pairs = new Map<string, { from: string; to: string; parts: string[]; over: boolean }>();
    for (const l of summary.links) {
      for (const c of l.consumers) {
        const key = `${l.sourceId}->${c.id}`;
        const pair = pairs.get(key) ?? { from: l.sourceId, to: c.id, parts: [], over: false };
        pair.parts.push(`${db.itemName(l.item)} ${fmt(c.perMinute)}/min`);
        pair.over ||= l.over > DISPLAY_EPS;
        pairs.set(key, pair);
      }
    }

    const edges: Edge[] = [...pairs].map(([id, pair]) => ({
      id,
      source: pair.from,
      target: pair.to,
      // Naming three items is still readable; past that a count is more use than a wall.
      label: pair.parts.length <= 3 ? pair.parts.join(" · ") : `${pair.parts.length} items`,
      className: pair.over ? "edge--short" : undefined,
      animated: pair.over,
    }));

    // Height is derived rather than fitted. React Flow's fitView runs before it has
    // measured the nodes, so it lands off-centre and clips; the measured re-fit never
    // fired at all. Since this layout is ours, the extent is already known — size the
    // frame to it and leave the viewport alone. The fit button covers manual panning.
    const rowCount = [...rows.values()].reduce((n, r) => n + r, 0) || 1;
    const height = Math.min(620, Math.max(240, rowCount * ROW_H + 70));
    // Past the height cap, zoom out rather than clip. Only the vertical extent is
    // worth scaling for: columns grow with chain depth, which stays small, whereas
    // unlinked sites all pile into one column.
    const contentH = (rowCount - 1) * ROW_H + NODE_H + bandOrder.length * BAND_GAP;
    const zoom = Math.max(0.3, Math.min(1, (height - 40) / contentH));

    return { nodes, edges, height, zoom, shape: `${rowCount}x${rows.size}x${bandOrder.length}` };
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
