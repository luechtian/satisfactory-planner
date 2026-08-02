import { useMemo } from "react";
import {
  Background, Controls, MiniMap, ReactFlow,
  type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Db } from "../core/data";
import { fmt } from "../core/solver";
import { isExtractor } from "../core/types";
import type { Site, SiteResult } from "../core/types";
import { usePlan } from "../store/planStore";
import { ExtractorNodeView } from "./ExtractorNode";
import { RecipeNode } from "./RecipeNode";

const nodeTypes = { recipe: RecipeNode, extractor: ExtractorNodeView };

export function Canvas({ db, site, result }: { db: Db; site: Site; result: SiteResult }) {
  const { updateNode, removeNode, setSelectedNode } = usePlan();

  const { nodes, edges } = useMemo(() => {
    const resultById = new Map(result.nodes.map((r) => [r.nodeId, r]));

    // Wire producers to consumers per item. Everything the plan already routes
    // internally gets an edge; whatever is left over is flagged on the port itself
    // so an unconnected input reads as "this has to come from outside".
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

    const edges: Edge[] = [];
    for (const [item, from] of producers) {
      for (const source of from) {
        for (const target of consumers.get(item) ?? []) {
          if (source === target) continue;
          const bal = result.balances.find((b) => b.item === item);
          edges.push({
            id: `${source}->${target}:${item}`,
            source, target,
            sourceHandle: `out-${item}`, targetHandle: `in-${item}`,
            label: `${db.itemName(item)} ${fmt(Math.min(
              resultById.get(source)?.outputs.find((p) => p.item === item)?.perMinute ?? 0,
              resultById.get(target)?.inputs.find((p) => p.item === item)?.perMinute ?? 0,
            ))}/min`,
            className: bal && bal.net < -1e-6 ? "edge--short" : undefined,
            animated: !!bal && bal.net < -1e-6,
          });
        }
      }
    }

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

    return { nodes, edges };
  }, [db, site, result, updateNode, removeNode]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position) updateNode(c.id, { position: c.position });
      if (c.type === "select") setSelectedNode(c.selected ? c.id : null);
      if (c.type === "remove") removeNode(c.id);
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      nodesConnectable={false}
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

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
