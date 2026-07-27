// Pure helpers for the Officer org-chart hierarchy.
// Kept client-safe (no Prisma imports) so they can be unit-tested and shared
// between the API (cycle validation) and the UI (tree building).
// Per 03 section 1 (DRY) + 04 section 2 (unit-test pure logic).

import type { Officer } from "./types";

/**
 * Detect whether setting `newReportsToId` on `officerId` would create a
 * cycle in the reporting chain. A cycle = following reportsToId from the
 * proposed parent eventually leads back to `officerId`.
 *
 * Per 06 section 3 (IDOR/authorization) and 02 section 6 (atomic ops): the
 * API must reject self-references and any ancestor-of-self as parent, since
 * a cycle would break the org-chart render and let a child "own" its parent.
 *
 * @param officerId  the officer being updated
 * @param newReportsToId  the proposed parent (may be null = root, always safe)
 * @param officers  all officers in the SAME year (cross-year parents are
 *                  rejected separately by the API)
 * @returns true if assigning newReportsToId would create a cycle
 */
export function wouldCreateCycle(
  officerId: string,
  newReportsToId: string | null,
  officers: Pick<Officer, "id" | "reportsToId">[]
): boolean {
  if (!newReportsToId) return false; // clearing parent = root, never a cycle
  if (newReportsToId === officerId) return true; // self-reference

  // Walk up the chain from the proposed parent. If we reach officerId, it's
  // a cycle. Cap iterations at the roster size so a pre-existing corrupt
  // cycle can't lock the API in an infinite loop (defense in depth).
  const byId = new Map(officers.map((o) => [o.id, o.reportsToId ?? null]));
  let cursor: string | null = newReportsToId;
  const seen = new Set<string>();
  for (let i = 0; i < officers.length + 1; i++) {
    if (cursor === null) return false; // reached a root — no cycle
    if (cursor === officerId) return true; // back to the starting node — cycle
    if (seen.has(cursor)) return false; // a different pre-existing cycle — not ours; bail
    seen.add(cursor);
    cursor = byId.get(cursor) ?? null;
  }
  return false;
}

/**
 * Build a multi-level org-chart tree from a flat officer list using reportsToId.
 *
 * Root nodes are officers whose reportsToId is null/undefined or points to an
 * id NOT in the list (orphan guard). Children are sorted by the same
 * role-priority + sortOrder + name scheme the legacy flat chart used, so the
 * visual order stays stable when admins haven't set reportsTo yet.
 *
 * If NO officer has a reportsToId set, returns null so the caller can fall
 * back to the legacy role-priority two-level tree (backward compat).
 */
export interface OfficerNode {
  officer: Officer;
  children: OfficerNode[];
}

const ROLE_PRIORITY: Array<{ match: RegExp; priority: number }> = [
  { match: /^president$/i, priority: 0 },
  { match: /vice[\s-]*president/i, priority: 10 },
  { match: /^secretary$/i, priority: 20 },
  { match: /^treasurer$/i, priority: 30 },
  { match: /^auditor/i, priority: 40 },
  { match: /public\s*information/i, priority: 50 },
  { match: /representative|^rep\.?$/i, priority: 80 },
  { match: /member/i, priority: 90 },
];
const DEFAULT_PRIORITY = 60;

export function getRolePriority(role: string): number {
  const r = (role ?? "").trim();
  if (!r) return DEFAULT_PRIORITY;
  for (const entry of ROLE_PRIORITY) {
    if (entry.match.test(r)) return entry.priority;
  }
  return DEFAULT_PRIORITY;
}

/** Sort officers by role-priority, then sortOrder, then name. Used by the
 *  legacy two-level org-chart fallback (when no reportsToId is set). */
export function sortOfficersByRolePriority(list: Officer[]): Officer[] {
  return list.slice().sort(compareOfficers);
}

function compareOfficers(a: Officer, b: Officer): number {
  const pa = getRolePriority(a.role);
  const pb = getRolePriority(b.role);
  if (pa !== pb) return pa - pb;
  const sa = a.sortOrder ?? 0;
  const sb = b.sortOrder ?? 0;
  if (sa !== sb) return sa - sb;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function buildOrgTree(officers: Officer[]): OfficerNode[] | null {
  if (officers.length === 0) return null;

  const hasAnyReportsTo = officers.some((o) => o.reportsToId);
  if (!hasAnyReportsTo) return null; // fall back to legacy two-level tree

  const byId = new Map(officers.map((o) => [o.id, o]));
  // Roots: reportsToId null/undefined, OR points to an id not in this year's set.
  const roots = officers.filter(
    (o) => !o.reportsToId || !byId.has(o.reportsToId)
  );
  const childrenOf = (parentId: string): Officer[] =>
    officers.filter((o) => o.reportsToId === parentId);

  function buildNode(officer: Officer): OfficerNode {
    const kids = childrenOf(officer.id).slice().sort(compareOfficers);
    return { officer, children: kids.map(buildNode) };
  }

  return roots.slice().sort(compareOfficers).map(buildNode);
}

/**
 * Flatten an OfficerNode tree back to a list (pre-order traversal). Useful for
 * rendering an indented list view as an alternative to the tree component.
 */
export function flattenOrgTree(nodes: OfficerNode[], depth = 0): { officer: Officer; depth: number }[] {
  const out: { officer: Officer; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ officer: n.officer, depth });
    out.push(...flattenOrgTree(n.children, depth + 1));
  }
  return out;
}
