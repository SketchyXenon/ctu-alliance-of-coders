"use client";

import * as React from "react";
import Image from "next/image";
import { User } from "lucide-react";

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
  /** When true (default), vacant slots (officers with no name) are shown as
   *  dashed-border nodes. When false, vacant slots are hidden. Per 05 §4:
   *  full state set — the toggle lets admins choose a clean view for
   *  presentation vs. a complete view for planning. */
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

interface OrgNodeProps {
  officer: Officer;
  onNodeClick?: (officer: Officer) => void;
  /** Depth from root (0 = root). Deeper nodes get a subtly smaller avatar to
   *  reinforce hierarchy visually (05 §4: meaningful state differentiation). */
  depth?: number;
}

/**
 * OrgNode - compact officer card rendered as a tree node.
 * Clickable officers render as a <button> (Tab focus + Enter/Space activate);
 * vacant slots render as a non-interactive <div>.
 *
 * Per 05 §4: full state set (hover, focus, active, disabled-vacant).
 * Per 05 §3: flat color, no gradient surfaces (avatar gradient is a light
 * effect on a dark surface, acceptable per §3 exception).
 */
function OrgNode({ officer, onNodeClick, depth = 0 }: OrgNodeProps) {
  const displayName = officer.name?.trim() || "Vacant Slot";
  const displayRole = officer.role?.trim() || "Open Position";
  const initials = getInitials(officer.name);
  const isVacant = !officer.name?.trim();
  const isClickable = !isVacant && Boolean(onNodeClick);
  const isPresident = /^president$/i.test(displayRole);
  // Subtle depth-based sizing: root = 16, each level down shrinks the avatar
  // by 4px (min 12). Reinforces hierarchy without breaking the layout.
  const avatarSize = Math.max(12, 16 - depth * 4);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isClickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNodeClick?.(officer);
    }
  };

  const avatar = (
    <>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
          "bg-gradient-to-br from-navy-700 to-navy-900",
          "ring-2 shadow-md",
          isPresident ? "ring-gold-400/60" : "ring-gold-400/30",
        )}
        style={{ height: `${avatarSize * 4}px`, width: `${avatarSize * 4}px` }}
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
              "font-display font-bold tracking-wide",
              isVacant ? "text-muted-foreground/70" : "text-gold-400",
            )}
            style={{ fontSize: `${avatarSize}px` }}
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
          {displayRole}
        </span>
      </div>
    </>
  );

  if (!isClickable) {
    return (
      <div
        className={cn(
          "flex w-[128px] flex-col items-center rounded-lg border-2 border-dashed border-border/60 bg-card/60 px-2 py-3",
          "opacity-90",
        )}
        aria-label={`${displayRole} - vacant`}
      >
        {avatar}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNodeClick?.(officer)}
      onKeyDown={handleKeyDown}
      aria-label={`View details for ${displayName}, ${displayRole}`}
      className={cn(
        "group flex w-[128px] flex-col items-center rounded-lg border-2 border-border/60 bg-card px-2 py-3",
        "shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-gold-300/70 hover:shadow-md",
        "focus-visible:outline-none focus-visible:border-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400/40",
        "active:translate-y-0",
      )}
    >
      {avatar}
    </button>
  );
}

/**
 * OfficerOrgChart - hierarchical tree view of officers for a single year.
 *
 * Zero-dependency implementation: CSS Grid lays out each level horizontally,
 * and an SVG layer draws the connectors. Replaces `react-organizational-chart`
 * (rigid TreeNode API, no customization) with ~150 lines of fully-customizable
 * code. Per Z.md ("no external libraries unless absolutely necessary"), 03 §7
 * (dependencies are liabilities), 05 §9 (native elements before abstractions),
 * 06 §3 (supply-chain surface).
 *
 * Two modes (auto-selected, same as before):
 *   - If any officer has reportsToId set, the chart is built from the
 *     admin-defined hierarchy (buildOrgTree). Multi-level, arbitrary depth.
 *   - Otherwise, falls back to a two-level tree (root = top-priority officer,
 *     usually President; children = everyone else by role priority + sortOrder).
 *
 * Accessibility (05 §4, WCAG):
 *   - role="tree" / role="treeitem" semantics.
 *   - Clickable nodes are <button>s (Tab + Enter/Space).
 *   - Vacant nodes are non-interactive <div>s with aria-label.
 *
 * Responsive: the chart scrolls horizontally on small screens (overflow-x-auto)
 * so deep trees don't break the layout. Per 05 §4: "responsive layout tested at
 * real breakpoints, not a squeeze-to-fit afterthought."
 */
export function OfficerOrgChart({
  officers,
  onNodeClick,
  className,
  showVacant = true,
}: OfficerOrgChartProps) {
  // Filter out vacant slots when showVacant is false.
  const filteredOfficers = showVacant
    ? officers
    : officers.filter((o) => o.name?.trim());

  if (filteredOfficers.length === 0) return null;

  // Try the customizable hierarchy first.
  const customTree = buildOrgTree(filteredOfficers);
  const tree: OfficerNode[] = customTree ?? buildLegacyTree(filteredOfficers);

  if (tree.length === 0) return null;

  return (
    <div
      className={cn(
        "officer-org-chart overflow-x-auto scrollbar-thin",
        className,
      )}
      role="tree"
      aria-label="Officers organizational chart"
    >
      <div className="min-w-max px-2 py-4">
        {tree.map((root) => (
          <ChartLevel
            key={root.officer.id}
            node={root}
            onNodeClick={onNodeClick}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

/** Build the legacy two-level tree (root = top-priority officer, children = rest).
 *  Used when no officer has reportsToId set (backward compat). */
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
 * ChartLevel - renders one node + its children recursively.
 *
 * Layout: a vertical flex column. The node sits on top; below it is a
 * connector area (a horizontal line spanning all children, with vertical
 * drops to each child); below that, a horizontal CSS Grid of child levels.
 *
 * The connector is pure CSS (a centered vertical line + a horizontal line
 * across the children row), so it scales with any node count and stays crisp
 * without SVG coordinate math. Per 05 §3: flat color, no decorative gradients.
 */
function ChartLevel({
  node,
  onNodeClick,
  depth,
}: {
  node: OfficerNode;
  onNodeClick?: (o: Officer) => void;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? true : undefined}
      aria-selected={false}
      className="flex flex-col items-center"
    >
      <OrgNode officer={node.officer} onNodeClick={onNodeClick} depth={depth} />

      {hasChildren && (
        <>
          {/* Vertical drop from this node down to the children's horizontal bus. */}
          <div className="h-6 w-px bg-border" aria-hidden="true" />
          {/* Horizontal bus + vertical drops to each child. Rendered as a flex
              row where each child cell has a top vertical line; the row's
              top border draws the horizontal bus. */}
          <div className="relative flex justify-center gap-4 pt-6" role="group">
            {/* Horizontal bus line spanning from the first child center to the
                last child center. Drawn with a top border on a wrapper that
                starts at the first child's horizontal center. */}
            <div
              className="absolute left-1/2 top-0 h-px -translate-x-1/2 bg-border"
              style={{
                width: `calc(100% - 128px)`,
                minWidth: `128px`,
              }}
              aria-hidden="true"
            />
            {node.children.map((child) => (
              <div
                key={child.officer.id}
                className="relative flex flex-col items-center"
              >
                {/* Vertical drop from the bus down to this child. */}
                <div
                  className="absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-border"
                  aria-hidden="true"
                />
                <ChartLevel
                  node={child}
                  onNodeClick={onNodeClick}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default OfficerOrgChart;
