"use client";

import * as React from "react";
import Image from "next/image";
import { Tree, TreeNode } from "react-organizational-chart";
import { User } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Officer } from "@/lib/types";

interface OfficerOrgChartProps {
  officers: Officer[];
  onNodeClick?: (officer: Officer) => void;
  className?: string;
}

/**
 * Role priority for the org-chart tree. Lower number = higher in the tree.
 * Sort is (priority asc, sortOrder asc, name asc). The Officer type has no
 * reportsTo field, so the hierarchy is two-level: root = top-priority officer
 * (usually President), children = everyone else ordered by this map.
 */
const ROLE_PRIORITY: Array<{ match: RegExp; priority: number }> = [
  { match: /^president$/i, priority: 0 },
  { match: /vice[\s-]*president/i, priority: 10 },
  { match: /^secretary$/i, priority: 20 },
  { match: /^treasurer$/i, priority: 30 },
  { match: /^auditor$/i, priority: 40 },
  { match: /public\s*information/i, priority: 50 },
  { match: /representative|^rep\.?$/i, priority: 80 },
  { match: /member/i, priority: 90 },
];

const DEFAULT_PRIORITY = 60;

function getRolePriority(role: string): number {
  const r = (role ?? "").trim();
  if (!r) return DEFAULT_PRIORITY;
  for (const entry of ROLE_PRIORITY) {
    if (entry.match.test(r)) return entry.priority;
  }
  return DEFAULT_PRIORITY;
}

function getInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase().slice(0, 2);
}

function sortOfficers(list: Officer[]): Officer[] {
  return list.slice().sort((a, b) => {
    const pa = getRolePriority(a.role);
    const pb = getRolePriority(b.role);
    if (pa !== pb) return pa - pb;
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
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
          isPresident ? "ring-gold-400/60" : "ring-gold-400/30"
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
              isVacant ? "text-muted-foreground/70" : "text-gold-400"
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
            isVacant && "text-muted-foreground"
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
          "opacity-90"
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
        "active:translate-y-0"
      )}
    >
      {avatar}
    </button>
  );
}

/**
 * OfficerOrgChart - hierarchical tree view of officers for a single year.
 * Builds a two-level tree (root + children) from the officer role + sortOrder
 * fields. No schema changes required; admin CRUD auto-reflects here.
 */
export function OfficerOrgChart({
  officers,
  onNodeClick,
  className,
}: OfficerOrgChartProps) {
  if (officers.length === 0) return null;

  const sorted = sortOfficers(officers);
  const root = sorted[0];
  const children = sorted.slice(1);

  // Muted connector color that adapts to light/dark via existing tokens.
  const lineColor = "var(--color-border-mid, var(--border))";

  return (
    <div
      className={cn(
        "officer-org-chart overflow-x-auto scrollbar-thin",
        className
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

export default OfficerOrgChart;
