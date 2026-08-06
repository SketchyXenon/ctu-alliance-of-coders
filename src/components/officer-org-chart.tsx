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
  type Connection,
  type EdgeChange,
  BackgroundVariant,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import { User, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  buildOrgTree,
  sortOfficersByRolePriority,
  type OfficerNode,
} from "@/lib/org-chart";
import type { Officer } from "@/lib/types";

interface OfficerOrgChartProps {
  officers: Officer[];
  onNodeClick?: (officer: Officer) => void;
  className?: string;
  showVacant?: boolean;
  editable?: boolean;

  onConnect?: (parentId: string, childId: string) => void | Promise<void>;

  onEdgeDelete?: (childId: string) => void | Promise<void>;
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

interface OfficerNodeData {
  officer: Officer;
  onNodeClick?: (o: Officer) => void;
  [key: string]: unknown;
}

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

const NODE_WIDTH = 140;
const NODE_HEIGHT = 150;

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

function buildLegacyTree(officers: Officer[]): OfficerNode[] {
  const sorted = sortOfficersByRolePriority(officers);
  if (sorted.length === 0) return [];
  const root = sorted[0];
  const children = sorted
    .slice(1)
    .map((o) => ({ officer: o, children: [] as OfficerNode[] }));
  return [{ officer: root, children }];
}

export function OfficerOrgChart({
  officers,
  onNodeClick,
  className,
  showVacant = true,
  editable = false,
  onConnect,
  onEdgeDelete,
}: OfficerOrgChartProps) {
  const filteredOfficers = showVacant
    ? officers
    : officers.filter((o) => o.name?.trim());

  const { nodes, edges } = React.useMemo(() => {
    if (filteredOfficers.length === 0) return { nodes: [], edges: [] };
    const customTree = buildOrgTree(filteredOfficers);
    const tree: OfficerNode[] = customTree ?? buildLegacyTree(filteredOfficers);
    if (tree.length === 0) return { nodes: [], edges: [] };
    const flow = buildFlowData(tree, onNodeClick);
    const laidOut = layoutWithDagre(flow.nodes, flow.edges, "TB");
    return { nodes: laidOut, edges: flow.edges };
  }, [filteredOfficers, onNodeClick]);

  const handleConnect = React.useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      if (params.source === params.target) return; // no self-loop
      void onConnect?.(params.source, params.target);
    },
    [onConnect],
  );

  const handleEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      if (!onEdgeDelete) return;
      for (const change of changes) {
        if (change.type === "remove") {
          // Edge id format: "parentId->childId"
          const childId = change.id.split("->")[1];
          if (childId) void onEdgeDelete(childId);
        }
      }
    },
    [onEdgeDelete],
  );

  if (nodes.length === 0) return null;

  const chartThemeVars = {
    "--xy-controls-button-background-color": "var(--card)",
    "--xy-controls-button-background-color-hover": "var(--muted)",
    "--xy-controls-button-border-color": "var(--border)",
    "--xy-controls-button-color": "var(--foreground)",
    "--xy-controls-button-color-hover": "var(--foreground)",
    "--xy-controls-box-shadow": "var(--shadow-md)",
    "--xy-minimap-background-color": "var(--card)",
    "--xy-minimap-mask-background-color": "rgba(127, 127, 127, 0.12)",
  } as React.CSSProperties;

  return (
    <div
      className={cn(
        "officer-org-chart relative h-[600px] w-full overflow-hidden rounded-lg border bg-card/30",
        editable
          ? "border-gold-400/50 ring-1 ring-gold-400/20"
          : "border-border/40",
        className,
      )}
      style={chartThemeVars}
      role="tree"
      aria-label="Officers organizational chart"
    >
      {editable && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-gold-500/15 px-2.5 py-1 text-xs font-semibold text-gold-700 dark:text-gold-300 ring-1 ring-gold-400/30">
          <Pencil className="h-3 w-3" aria-hidden="true" />
          Edit mode
          <span className="ml-1 hidden font-normal text-muted-foreground sm:inline">
            — drag handles to set reporting lines
          </span>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        edgesFocusable={editable}
        onConnect={editable ? handleConnect : undefined}
        onEdgesChange={editable ? handleEdgesChange : undefined}
        deleteKeyCode={editable ? ["Backspace", "Delete"] : []}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        panOnScroll={false}
        connectionLineStyle={{
          stroke: "var(--color-gold-400, #eab308)",
          strokeWidth: 2,
          strokeDasharray: "4 4",
        }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "var(--border)", strokeWidth: 1.5 },
        }}
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
