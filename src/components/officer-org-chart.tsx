"use client";

import * as React from "react";
import Image from "next/image";
import { Tree, TreeNode } from "react-organizational-chart";
import { User } from "lucide-react";

import { cn } from "@/lib/utils";
import { buildOrgTree, sortOfficersByRolePriority } from "@/lib/org-chart";
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
}

/**
 * OrgNode - compact officer card rendered as a tree node label.
 * Clickable officers render as a <button> (Tab focus + Enter/Space activate);
 * vacant slots render as a non-interactive <div>.
 */
function OrgNode({ officer, onNodeClick }: OrgNodeProps) {
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

  const avatar = (
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
 * Two modes (auto-selected):
 *   - If any officer has reportsToId set, the chart is built from the
 *     admin-defined hierarchy (buildOrgTree). This is the "customizable"
 *     org chart: admins set who reports to whom via the officer modal.
 *   - Otherwise, falls back to a two-level tree (root = top-priority officer,
 *     usually President; children = everyone else by role priority + sortOrder).
 *     Backward compat for years created before reportsTo existed.
 */
export function OfficerOrgChart({
  officers,
  onNodeClick,
  className,
  showVacant = true,
}: OfficerOrgChartProps) {
  // Filter out vacant slots when showVacant is false. A vacant slot is one
  // with no name (just a role placeholder). Per 05 §4: the toggle gives the
  // admin a clean presentation view (no vacant slots) vs. a planning view.
  const filteredOfficers = showVacant
    ? officers
    : officers.filter((o) => o.name?.trim());

  if (filteredOfficers.length === 0) return null;

  const lineColor = "var(--color-border-mid, var(--border))";

  // Try the customizable hierarchy first.
  const customTree = buildOrgTree(filteredOfficers);
  if (customTree) {
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
          {customTree.map((root) => (
            <Tree
              key={root.officer.id}
              label={
                <OrgNode officer={root.officer} onNodeClick={onNodeClick} />
              }
              lineColor={lineColor}
              lineWidth="1.5px"
              lineHeight="24px"
              lineBorderRadius="6px"
              nodePadding="12px"
            >
              {root.children.map((child) => renderSubtree(child, onNodeClick))}
            </Tree>
          ))}
        </div>
      </div>
    );
  }

  // Legacy two-level fallback (no reportsTo set on any officer).
  const sorted = sortOfficersByRolePriority(filteredOfficers);
  const root = sorted[0];
  const children = sorted.slice(1);

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
        <Tree
          label={<OrgNode officer={root} onNodeClick={onNodeClick} />}
          lineColor={lineColor}
          lineWidth="1.5px"
          lineHeight="24px"
          lineBorderRadius="6px"
          nodePadding="12px"
        >
          {children.map((officer) => (
            <TreeNode
              key={officer.id}
              label={<OrgNode officer={officer} onNodeClick={onNodeClick} />}
            />
          ))}
        </Tree>
      </div>
    </div>
  );
}

/** Render a non-root subtree (recursive). Extracted so the main component
 *  stays readable; the root uses <Tree>, children use <TreeNode>. */
function renderSubtree(
  node: {
    officer: Officer;
    children: { officer: Officer; children: unknown[] }[];
  },
  onNodeClick?: (o: Officer) => void,
): React.ReactNode {
  const label = <OrgNode officer={node.officer} onNodeClick={onNodeClick} />;
  if (node.children.length === 0) {
    return <TreeNode key={node.officer.id} label={label} />;
  }
  return (
    <TreeNode key={node.officer.id} label={label}>
      {node.children.map((c) => renderSubtree(c as typeof node, onNodeClick))}
    </TreeNode>
  );
}

export default OfficerOrgChart;
