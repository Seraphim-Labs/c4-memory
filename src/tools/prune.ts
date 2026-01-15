/**
 * Memory Pruning Tool
 *
 * Removes low-value memories to keep the memory system efficient.
 * This is a core component of the MemEvolve evolution system.
 *
 * Safety rules:
 * - Never prune memories with importance >= 8
 * - Never prune memories accessed in the last 7 days
 * - Archive before permanent deletion (recoverable)
 */

import type Database from 'better-sqlite3';
import type { Memory, PruneInput } from '../types.js';
import {
  getLowUsefulnessMemories,
  updateMemoryStatus,
  deleteMemory,
} from '../db/operations.js';

/**
 * MCP Tool Definition for memory_prune
 */
export const pruneToolDef = {
  name: 'memory_prune',
  description: `Remove low-value memories to keep the memory system efficient.

Pruning targets memories that:
- Have low usefulness scores (default < 2.0)
- Haven't been accessed recently (default > 90 days)
- Are not marked as high importance (< 8)

Pruned memories are first archived (status='archived'), making them recoverable.
Use dryRun=true to preview what would be pruned without making changes.

SAFETY: High-importance memories (8-9) and recently accessed memories are NEVER pruned.`,
  inputSchema: {
    type: 'object',
    properties: {
      minUsefulness: {
        type: 'number',
        description: 'Remove memories below this usefulness score (default 2.0)',
        minimum: 0.5,
        maximum: 5.0,
      },
      maxAge: {
        type: 'number',
        description: 'Days without access before eligible for pruning (default 90)',
        minimum: 7,
        maximum: 365,
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview pruning without making changes',
      },
      permanent: {
        type: 'boolean',
        description: 'Permanently delete instead of archiving (use with caution)',
      },
    },
  },
};

export interface PruneResult {
  success: boolean;
  dryRun: boolean;
  memoriesPruned: number;
  spaceSaved: {
    memories: number;
    estimatedBytes: number;
  };
  prunedMemories?: Array<{
    id: number;
    type: string;
    usefulnessScore: number;
    daysSinceAccess: number;
    importance: number;
    preview: string;
  }>;
  warnings?: string[];
}

/**
 * Calculate days since last access
 */
function daysSinceAccess(accessedAt: number): number {
  return Math.floor((Date.now() - accessedAt) / (1000 * 60 * 60 * 24));
}

/**
 * Estimate memory size in bytes
 */
function estimateMemorySize(memory: Memory): number {
  let size = 0;
  size += memory.encoded.length;
  size += memory.decodedCache?.length || 0;
  size += 100; // Overhead for other fields
  return size;
}

/**
 * Prune low-value memories
 */
export async function prune(
  db: Database.Database,
  input: PruneInput,
  projectHash?: string
): Promise<PruneResult> {
  const warnings: string[] = [];
  const minUsefulness = input.minUsefulness ?? 2.0;
  const maxAge = input.maxAge ?? 90;
  const dryRun = input.dryRun ?? false;
  const permanent = input.permanent ?? false;

  // Get memories eligible for pruning
  const candidates = getLowUsefulnessMemories(db, minUsefulness, maxAge, 200);

  // Filter by project if specified
  let filtered = candidates;
  if (projectHash) {
    // Include both project-specific and global memories
    filtered = candidates.filter(m =>
      m.scope === 'global' || m.projectHash === projectHash
    );
  }

  // Additional safety filter: exclude recently accessed and high importance
  const recentCutoff = 7; // Never prune memories accessed in last 7 days
  const safeMemories = filtered.filter(m => {
    const days = daysSinceAccess(m.accessedAt);

    // Safety rules
    if (m.importance >= 8) {
      warnings.push(`Skipping high-importance memory #${m.id} (importance=${m.importance})`);
      return false;
    }

    if (days < recentCutoff) {
      warnings.push(`Skipping recently accessed memory #${m.id} (${days} days ago)`);
      return false;
    }

    return true;
  });

  if (safeMemories.length === 0) {
    return {
      success: true,
      dryRun,
      memoriesPruned: 0,
      spaceSaved: { memories: 0, estimatedBytes: 0 },
      warnings: warnings.length > 0 ? warnings : ['No memories eligible for pruning.'],
    };
  }

  // Calculate space savings
  let totalBytes = 0;
  const prunedDetails: PruneResult['prunedMemories'] = [];

  for (const memory of safeMemories) {
    totalBytes += estimateMemorySize(memory);

    const preview = (memory.decodedCache || memory.encoded).substring(0, 100);

    prunedDetails.push({
      id: memory.id,
      type: memory.type,
      usefulnessScore: Math.round(memory.usefulnessScore * 100) / 100,
      daysSinceAccess: daysSinceAccess(memory.accessedAt),
      importance: memory.importance,
      preview: preview.length === 100 ? preview + '...' : preview,
    });
  }

  // Dry run - just return what would be pruned
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      memoriesPruned: safeMemories.length,
      spaceSaved: {
        memories: safeMemories.length,
        estimatedBytes: totalBytes,
      },
      prunedMemories: prunedDetails,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  // Actually prune the memories
  let prunedCount = 0;

  for (const memory of safeMemories) {
    if (permanent) {
      // Permanently delete
      deleteMemory(db, memory.id);
    } else {
      // Archive (recoverable)
      updateMemoryStatus(db, memory.id, 'archived');
    }
    prunedCount++;
  }

  return {
    success: true,
    dryRun: false,
    memoriesPruned: prunedCount,
    spaceSaved: {
      memories: prunedCount,
      estimatedBytes: totalBytes,
    },
    prunedMemories: prunedDetails,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Get pruning candidates without actually pruning
 */
export function getPruneCandidates(
  db: Database.Database,
  minUsefulness: number = 2.0,
  maxAge: number = 90
): Memory[] {
  return getLowUsefulnessMemories(db, minUsefulness, maxAge, 200);
}

/**
 * Restore an archived memory
 */
export function restoreArchivedMemory(
  db: Database.Database,
  memoryId: number
): boolean {
  return updateMemoryStatus(db, memoryId, 'active');
}

/**
 * Get all archived memories
 */
export function getArchivedMemories(
  db: Database.Database,
  limit: number = 100
): Memory[] {
  const rows = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance,
           created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    WHERE status = 'archived'
    ORDER BY accessed_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    type: string;
    encoded: string;
    decoded_cache: string | null;
    scope: string;
    project_hash: string | null;
    importance: number;
    created_at: number;
    accessed_at: number;
    access_count: number;
    usefulness_score: number | null;
    times_helpful: number | null;
    times_unhelpful: number | null;
    status: string | null;
    parent_id: number | null;
    level: number | null;
    last_decay: number | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    type: row.type as Memory['type'],
    encoded: row.encoded,
    decodedCache: row.decoded_cache ?? undefined,
    scope: row.scope as Memory['scope'],
    projectHash: row.project_hash ?? undefined,
    importance: row.importance as Memory['importance'],
    createdAt: row.created_at,
    accessedAt: row.accessed_at,
    accessCount: row.access_count,
    usefulnessScore: row.usefulness_score ?? 5.0,
    timesHelpful: row.times_helpful ?? 0,
    timesUnhelpful: row.times_unhelpful ?? 0,
    status: (row.status ?? 'active') as Memory['status'],
    parentId: row.parent_id ?? undefined,
    level: (row.level ?? 1) as Memory['level'],
    lastDecay: row.last_decay ?? undefined,
  }));
}
