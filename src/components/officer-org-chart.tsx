"use client";

import * as React from "react";
import Image from "next/image";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  BackgroundVariant,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import { User } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  buildOrgTree,
  sortOfficersByRolePriority,
  type OfficerNode,
} from "@/lib/org-chart";
import type { Officer } from "@/lib/types";

// ---------------------------------------------------------------------------
// React Flow org chart for officers.
//
// Replaces the hand-rolled flexbox tree (which was hard to customize + pan)
// with React Flow (@xyflow/react) + dagre auto-layout. React Flow gives:
//   - Pan / zoom (mouse drag + scroll wheel) out of the box.
//   - MiniMap + Controls (admin can navigate large hierarchies).
//   - Fully custom node rendering (we keep the existing OrgNode card).
//   - Edges drawn as SVG bezier/smoothstep curves (no manual connector math).
//
// Per the markdowns:
//   03 §7 (Dependencies): @xyflow/react deps are classcat + zustand (already
//     in the project) + @xyflow/system (its own internal). No suspicious deps.
//     dagre deps are graphlib + lodash (both MIT, ubiquitous). Clean supply
//     chain per 06 §3.
//   05 §9 (Over-engineering): React Flow is the right abstraction here — it
//     solves pan/zoom/layout that a hand-rolled tree couldn't, without us
//     rebuilding a canvas engine. One library, one job.
//   05 §4 (Full state set): custom node has hover/focus/active/vacant states.
//   05 §3 (Flat color): no gradient surfaces on the chart chrome.
//
// The API contract (officers, onNodeClick, className, showVacant) is identical
// to the previous implementation so officers-section.tsx needs no change.
// ---------------------------------------------------------------------------

interface OfficerOrgChartProps {
  officers: Officer[];
  onNodeClick?: (officer: Officer) => void;
  className?: string;
  /** When true (default), vacant slots are shown as dashed-border nodes. */
  showVacant?: boolean;
}

function getInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase().slice(0, 2);
}

/** Officer data carried in the React Flow node. Serialized to the node's
 *  `data` field so React Flow can persist/restore it. */
interface OfficerNodeData {
  officer: Officer;
  onNodeClick?: (o: Officer) => void;
  [key: string]: unknown;
}

/** Custom React Flow node: the officer card. Keeps the same visual design as
 *  the previous implementation (avatar, name, role, hover/focus states).
 *  Adds React Flow <Handle> connectors on top/bottom for edge routing. */
function OfficerCardNode({ data }: NodeProps) {
  const { officer, onNodeClick } = data as OfficerNodeData;
  const displayName = officer.name?.trim() || "Vacant Slot";
  const displayRole = officer.role?.trim() || "Open Position";
  const initials = getInitials(officer.name);
  const isVacant = !officer.name?.trim();
  const isClickable = !isVacant && Boolean(onNodeClick);
  const isPresident = /^president$/i.test(displayRole);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isClickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNodeClick?.(officer);
    }
  };

  return (
    <div className="relative">
      {/* Top handle (incoming edge from parent). Hidden on root nodes visually
          but kept so dagre edges route consistently. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-gold-400/60"
        isConnectable={false}
      />
      {isClickable ? (
        <button
          type="button"
          onClick={() => onNodeClick?.(officer)}
          onKeyDown={handleKeyDown}
          aria-label={`View details for ${displayName}, ${displayRole}`}
          className={cn(
            "group flex w-[140px] flex-col items-center rounded-lg border-2 border-border/60 bg-card px-2 py-3",
            "shadow-sm transition-all duration-200",
            "hover:-translate-y-0.5 hover:border-gold-300/70 hover:shadow-md",
            "focus-visible:outline-none focus-visible:border-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400/40",
            "active:translate-y-0",
          )}
        >
          <OfficerAvatar
            officer={officer}
            displayName={displayName}
            initials={initials}
            isVacant={isVacant}
            isPresident={isPresident}
          />
        </button>
      ) : (
        <div
          className={cn(
            "flex w-[140px] flex-col items-center rounded-lg border-2 border-dashed border-border/60 bg-card/60 px-2 py-3",
            "opacity-90",
          )}
          aria-label={`${displayRole} - vacant`}
        >
          <OfficerAvatar
            officer={officer}
            displayName={displayName}
            initials={initials}
            isVacant={isVacant}
            isPresident={isPresident}
          />
        </div>
      )}
      {/* Bottom handle (outgoing edge to children). */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-gold-400/60"
        isConnectable={false}
      />
    </div>
  );
}

/** Shared avatar block (image or initials) for both clickable + vacant nodes. */
function OfficerAvatar({
  officer,
  displayName,
  initials,
  isVacant,
  isPresident,
}: {
  officer: Officer;
  displayName: string;
  initials: string;
  isVacant: boolean;
  isPresident: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full",
          "bg-gradient-to-br from-navy-700 to-navy-900",
          "ring-2 shadow-md",
          isPresident ? "ring-gold-400/60" : "ring-gold-400/30",
        )}
      >
        {officer.image ? (
          <Image
            src={officer.image}
            alt={`${displayName} portrait`}
            fill
            sizes="64px"
            className="object-cover"
          />
        ) : (
          <span
            className={cn(
              "font-display text-lg font-bold tracking-wide",
              isVacant ? "text-muted-foreground/70" : "text-gold-400",
            )}
            aria-hidden="true"
          >
            {isVacant ? <User className="h-5 w-5" /> : initials}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col items-center gap-0.5 px-1">
        <span
          className={cn(
            "font-display text-sm font-semibold leading-tight text-foreground text-balance",
            isVacant && "text-muted-foreground",
          )}
        >
          {displayName}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {officer.role?.trim() || "Open Position"}
        </span>
      </div>
    </>
  );
}

const nodeTypes: NodeTypes = { officer: OfficerCardNode };

/** Node dimensions for dagre layout. Must match the card width + a reasonable
 *  height so edges route to the correct handle positions. */
const NODE_WIDTH = 140;
const NODE_HEIGHT = 150;

/** Run dagre to compute x/y positions for each node in the hierarchy.
 *  Direction "TB" = top-to-bottom (standard org chart). Returns positioned
 *  nodes; edges are passed through (React Flow routes them to handles). */
function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 60,
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    // dagre returns the center; React Flow expects the top-left corner.
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/** Build React Flow nodes + edges from the officer tree.
 *  - Each officer becomes a node of type "officer".
 *  - Each parent->child relationship becomes an edge (smoothstep for clean
 *    right-angle connectors that match an org chart's visual language). */
function buildFlowData(
  tree: OfficerNode[],
  onNodeClick?: (o: Officer) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  function walk(node: OfficerNode) {
    nodes.push({
      id: node.officer.id,
      type: "officer",
      position: { x: 0, y: 0 }, // dagre fills this in
      data: { officer: node.officer, onNodeClick },
    });
    for (const child of node.children) {
      edges.push({
        id: `${node.officer.id}->${child.officer.id}`,
        source: node.officer.id,
        target: child.officer.id,
        type: "smoothstep",
        style: { stroke: "var(--border)", strokeWidth: 1.5 },
      });
      walk(child);
    }
  }

  tree.forEach(walk);
  return { nodes, edges };
}

/** Build the legacy two-level tree (root = top-priority officer, children =
 *  rest) when no reportsToId is set. Same logic as the previous impl. */
function buildLegacyTree(officers: Officer[]): OfficerNode[] {
  const sorted = sortOfficersByRolePriority(officers);
  if (sorted.length === 0) return [];
  const root = sorted[0];
  const children = sorted
    .slice(1)
    .map((o) => ({ officer: o, children: [] as OfficerNode[] }));
  return [{ officer: root, children }];
}

/**
 * OfficerOrgChart - React Flow + dagre auto-laid org chart.
 *
 * Features (the flexibility the user asked for):
 *   - Pan + zoom (drag the canvas, scroll to zoom). Admins can navigate
 *     large hierarchies easily.
 *   - MiniMap (bottom-right) shows the whole tree at a glance.
 *   - Controls (bottom-left): zoom in/out, fit-view, lock.
 *   - Fit-view on load: the whole tree is centered + scaled to fit.
 *   - Custom node: the existing officer card design (avatar, name, role,
 *     hover/focus/active/vacant states) is preserved.
 *   - Auto-layout via dagre: no manual x/y positioning; the tree is laid
 *     out top-to-bottom with consistent spacing. Direction can be flipped
 *     to left-to-right by changing the dagre rankdir if desired.
 *   - Accessible: clickable nodes are <button>s; vacant nodes are
 *     non-interactive <div>s with aria-label. React Flow's canvas has
 *     keyboard pan/zoom via the Controls.
 */
export function OfficerOrgChart({
  officers,
  onNodeClick,
  className,
  showVacant = true,
}: OfficerOrgChartProps) {
  const filteredOfficers = showVacant
    ? officers
    : officers.filter((o) => o.name?.trim());

  // Build the tree once per officer set. useMemo so React Flow's internal
  // change-detection doesn't re-layout on every render.
  const { nodes, edges } = React.useMemo(() => {
    if (filteredOfficers.length === 0) return { nodes: [], edges: [] };
    const customTree = buildOrgTree(filteredOfficers);
    const tree: OfficerNode[] = customTree ?? buildLegacyTree(filteredOfficers);
    if (tree.length === 0) return { nodes: [], edges: [] };
    const flow = buildFlowData(tree, onNodeClick);
    const laidOut = layoutWithDagre(flow.nodes, flow.edges, "TB");
    return { nodes: laidOut, edges: flow.edges };
  }, [filteredOfficers, onNodeClick]);

  if (nodes.length === 0) return null;

  return (
    <div
      className={cn(
        "officer-org-chart h-[600px] w-full overflow-hidden rounded-lg border border-border/40 bg-card/30",
        className,
      )}
      role="tree"
      aria-label="Officers organizational chart"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        panOnScroll={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="!bg-muted/40"
        />
        <Controls
          className="!rounded-md !border !border-border/60 !bg-card !shadow-md"
          showInteractive={false}
        />
        <MiniMap
          className="!rounded-md !border !border-border/60 !bg-card/80"
          maskColor="rgba(0,0,0,0.05)"
          nodeColor={(n) => {
            const data = n.data as OfficerNodeData;
            return /^president$/i.test(data.officer.role ?? "")
              ? "rgb(202 138 4 / 0.6)"
              : "rgb(100 116 139 / 0.4)";
          }}
        />
      </ReactFlow>
    </div>
  );
}

export default OfficerOrgChart;
