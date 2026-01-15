/**
 * Database CRUD Operations
 */

import type Database from 'better-sqlite3';
import type {
  Memory, MemoryType, MemoryScope, ImportanceLevel, AutoLearnLog,
  MemoryFeedback, MemoryRelationship, FeedbackType, RelationshipType, MemoryStatus, MemoryLevel
} from '../types.js';

export interface CreateMemoryInput {
  type: MemoryType;
  encoded: string;
  decodedCache?: string;
  scope: MemoryScope;
  projectHash?: string;
  importance?: ImportanceLevel;
}

export interface UpdateMemoryInput {
  id: number;
  encoded?: string;
  decodedCache?: string;
  importance?: ImportanceLevel;
}

export interface QueryMemoriesInput {
  scope?: MemoryScope | 'both';
  projectHash?: string;
  types?: MemoryType[];
  minImportance?: number;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;  // v2: include archived/consolidated memories
}

/**
 * Create a new memory
 */
export function createMemory(db: Database.Database, input: CreateMemoryInput): Memory {
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO memories (type, encoded, decoded_cache, scope, project_hash, importance, created_at, accessed_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    input.type,
    input.encoded,
    input.decodedCache ?? null,
    input.scope,
    input.projectHash ?? null,
    input.importance ?? 5,
    now,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    type: input.type,
    encoded: input.encoded,
    decodedCache: input.decodedCache,
    scope: input.scope,
    projectHash: input.projectHash,
    importance: (input.importance ?? 5) as ImportanceLevel,
    createdAt: now,
    accessedAt: now,
    accessCount: 0,
    // Evolution tracking (v2) - defaults
    usefulnessScore: 5.0,
    timesHelpful: 0,
    timesUnhelpful: 0,
    status: 'active',
    level: 1,
  };
}

/**
 * Get a memory by ID
 */
export function getMemory(db: Database.Database, id: number): Memory | null {
  const row = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance, created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    WHERE id = ?
  `).get(id) as DbMemoryRow | undefined;

  if (!row) return null;

  // Update access time and count
  db.prepare(`
    UPDATE memories
    SET accessed_at = ?, access_count = access_count + 1
    WHERE id = ?
  `).run(Date.now(), id);

  return rowToMemory(row);
}

/**
 * Query memories with filters
 */
export function queryMemories(db: Database.Database, input: QueryMemoriesInput): Memory[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // By default, only return active memories (v2)
  if (!input.includeArchived) {
    conditions.push("status = 'active'");
  }

  // Scope filter
  if (input.scope && input.scope !== 'both') {
    conditions.push('scope = ?');
    params.push(input.scope);
  }

  // Project hash filter
  if (input.projectHash) {
    conditions.push('(project_hash = ? OR scope = ?)');
    params.push(input.projectHash, 'global');
  }

  // Type filter
  if (input.types && input.types.length > 0) {
    const placeholders = input.types.map(() => '?').join(', ');
    conditions.push(`type IN (${placeholders})`);
    params.push(...input.types);
  }

  // Importance filter
  if (input.minImportance !== undefined) {
    conditions.push('importance >= ?');
    params.push(input.minImportance);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;

  const rows = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance, created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    ${whereClause}
    ORDER BY usefulness_score DESC, importance DESC, accessed_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as DbMemoryRow[];

  return rows.map(rowToMemory);
}

/**
 * Extract keywords from text for fallback search
 */
export function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'this', 'that',
    'what', 'which', 'who', 'where', 'when', 'why', 'how', 'and', 'but', 'if', 'or',
    'of', 'at', 'by', 'for', 'with', 'to', 'from', 'in', 'out', 'on', 'please', 'help',
    'want', 'need', 'make', 'get', 'me', 'my', 'i', 'you', 'it', 'we', 'they', 'just',
    'like', 'know', 'think', 'see', 'look', 'use', 'find', 'give', 'tell', 'about',
    'all', 'any', 'some', 'memory', 'memories', 'recall', 'remember', 'search'
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 10); // Limit to 10 keywords
}

/**
 * Query memories with keyword matching (fallback when semantic search fails)
 */
export function queryMemoriesWithKeywords(
  db: Database.Database,
  keywords: string[],
  input: QueryMemoriesInput
): Memory[] {
  if (keywords.length === 0) {
    return queryMemories(db, input);
  }

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // By default, only return active memories
  if (!input.includeArchived) {
    conditions.push("status = 'active'");
  }

  // Keyword matching on decoded_cache
  const keywordConditions = keywords.map(() => "decoded_cache LIKE ?").join(' OR ');
  conditions.push(`(${keywordConditions})`);
  params.push(...keywords.map(k => `%${k}%`));

  // Scope filter
  if (input.scope && input.scope !== 'both') {
    conditions.push('scope = ?');
    params.push(input.scope);
  }

  // Project hash filter
  if (input.projectHash) {
    conditions.push('(project_hash = ? OR scope = ?)');
    params.push(input.projectHash, 'global');
  }

  // Type filter
  if (input.types && input.types.length > 0) {
    const placeholders = input.types.map(() => '?').join(', ');
    conditions.push(`type IN (${placeholders})`);
    params.push(...input.types);
  }

  // Importance filter
  if (input.minImportance !== undefined) {
    conditions.push('importance >= ?');
    params.push(input.minImportance);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;

  const rows = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance, created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    ${whereClause}
    ORDER BY usefulness_score DESC, importance DESC, accessed_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as DbMemoryRow[];

  return rows.map(rowToMemory);
}

/**
 * Update a memory
 */
export function updateMemory(db: Database.Database, input: UpdateMemoryInput): boolean {
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (input.encoded !== undefined) {
    updates.push('encoded = ?');
    params.push(input.encoded);
  }

  if (input.decodedCache !== undefined) {
    updates.push('decoded_cache = ?');
    params.push(input.decodedCache);
  }

  if (input.importance !== undefined) {
    updates.push('importance = ?');
    params.push(input.importance);
  }

  if (updates.length === 0) return false;

  updates.push('accessed_at = ?');
  params.push(Date.now());

  params.push(input.id);

  const result = db.prepare(`
    UPDATE memories
    SET ${updates.join(', ')}
    WHERE id = ?
  `).run(...params);

  return result.changes > 0;
}

/**
 * Delete a memory by ID
 */
export function deleteMemory(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Delete memories matching a query
 */
export function deleteMemoriesByQuery(
  db: Database.Database,
  ids: number[]
): number {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  const result = db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

/**
 * Update memory access timestamp and count
 * Called when a memory is retrieved to track usage patterns
 */
export function updateMemoryAccess(db: Database.Database, id: number): void {
  db.prepare(`
    UPDATE memories
    SET accessed_at = ?, access_count = access_count + 1
    WHERE id = ?
  `).run(Date.now(), id);
}

/**
 * Get memory count and stats
 */
export function getMemoryStats(db: Database.Database, projectHash?: string): {
  total: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  avgImportance: number;
} {
  const whereClause = projectHash
    ? 'WHERE project_hash = ? OR scope = ?'
    : '';
  const params = projectHash ? [projectHash, 'global'] : [];

  const total = (db.prepare(`
    SELECT COUNT(*) as count FROM memories ${whereClause}
  `).get(...params) as { count: number }).count;

  const byTypeRows = db.prepare(`
    SELECT type, COUNT(*) as count FROM memories ${whereClause} GROUP BY type
  `).all(...params) as { type: string; count: number }[];

  const byScopeRows = db.prepare(`
    SELECT scope, COUNT(*) as count FROM memories ${whereClause} GROUP BY scope
  `).all(...params) as { scope: string; count: number }[];

  const avgRow = db.prepare(`
    SELECT AVG(importance) as avg FROM memories ${whereClause}
  `).get(...params) as { avg: number | null };

  const byType: Record<string, number> = {};
  for (const row of byTypeRows) {
    byType[row.type] = row.count;
  }

  const byScope: Record<string, number> = {};
  for (const row of byScopeRows) {
    byScope[row.scope] = row.count;
  }

  return {
    total,
    byType,
    byScope,
    avgImportance: avgRow.avg ?? 0,
  };
}

/**
 * Log an auto-learn event
 */
export function logAutoLearn(
  db: Database.Database,
  triggerType: string,
  context: string,
  memoryId?: number
): void {
  db.prepare(`
    INSERT INTO auto_learn_log (trigger_type, context, memory_id, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(triggerType, context, memoryId ?? null, Date.now());
}

/**
 * Get recent auto-learn events
 */
export function getAutoLearnLog(db: Database.Database, limit: number = 50): AutoLearnLog[] {
  const rows = db.prepare(`
    SELECT id, trigger_type, context, memory_id, timestamp
    FROM auto_learn_log
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as DbAutoLearnRow[];

  return rows.map(row => ({
    id: row.id,
    triggerType: row.trigger_type as AutoLearnLog['triggerType'],
    context: row.context,
    memoryId: row.memory_id ?? undefined,
    timestamp: row.timestamp,
  }));
}

// Internal types for database rows
interface DbMemoryRow {
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
  // Evolution tracking (v2)
  usefulness_score: number;
  times_helpful: number;
  times_unhelpful: number;
  status: string;
  parent_id: number | null;
  level: number;
  last_decay: number | null;
}

interface DbAutoLearnRow {
  id: number;
  trigger_type: string;
  context: string;
  memory_id: number | null;
  timestamp: number;
}

function rowToMemory(row: DbMemoryRow): Memory {
  return {
    id: row.id,
    type: row.type as MemoryType,
    encoded: row.encoded,
    decodedCache: row.decoded_cache ?? undefined,
    scope: row.scope as MemoryScope,
    projectHash: row.project_hash ?? undefined,
    importance: row.importance as ImportanceLevel,
    createdAt: row.created_at,
    accessedAt: row.accessed_at,
    accessCount: row.access_count,
    // Evolution tracking (v2)
    usefulnessScore: row.usefulness_score ?? 5.0,
    timesHelpful: row.times_helpful ?? 0,
    timesUnhelpful: row.times_unhelpful ?? 0,
    status: (row.status ?? 'active') as MemoryStatus,
    parentId: row.parent_id ?? undefined,
    level: (row.level ?? 1) as MemoryLevel,
    lastDecay: row.last_decay ?? undefined,
  };
}

// ============================================
// EVOLUTION TRACKING FUNCTIONS (v2)
// ============================================

/**
 * Record feedback for a memory
 */
export function recordFeedback(
  db: Database.Database,
  memoryId: number,
  feedbackType: FeedbackType,
  context?: string
): MemoryFeedback {
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO memory_feedback (memory_id, feedback_type, context, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(memoryId, feedbackType, context ?? null, now);

  // Update memory's helpfulness counts
  if (feedbackType === 'helpful') {
    db.prepare(`
      UPDATE memories SET times_helpful = times_helpful + 1 WHERE id = ?
    `).run(memoryId);
  } else if (feedbackType === 'unhelpful' || feedbackType === 'incorrect') {
    db.prepare(`
      UPDATE memories SET times_unhelpful = times_unhelpful + 1 WHERE id = ?
    `).run(memoryId);
  }

  // Recalculate usefulness score
  updateUsefulnessScore(db, memoryId);

  return {
    id: result.lastInsertRowid as number,
    memoryId,
    feedbackType,
    context,
    timestamp: now,
  };
}

/**
 * Calculate and update usefulness score for a memory
 * Formula: base_importance * (helpful_ratio + recency_boost + access_boost)
 */
export function updateUsefulnessScore(db: Database.Database, memoryId: number): number {
  const row = db.prepare(`
    SELECT importance, times_helpful, times_unhelpful, accessed_at, access_count
    FROM memories WHERE id = ?
  `).get(memoryId) as { importance: number; times_helpful: number; times_unhelpful: number; accessed_at: number; access_count: number } | undefined;

  if (!row) return 5.0;

  const baseImportance = row.importance;
  const timesHelpful = row.times_helpful ?? 0;
  const timesUnhelpful = row.times_unhelpful ?? 0;
  const accessCount = row.access_count ?? 0;
  const daysSinceAccess = (Date.now() - row.accessed_at) / (1000 * 60 * 60 * 24);

  // Helpful ratio: Bayesian average with prior of 0.5
  const helpfulRatio = (timesHelpful + 1) / (timesHelpful + timesUnhelpful + 2);

  // Recency boost: exponential decay (0.98^days)
  const recencyBoost = Math.pow(0.98, Math.min(daysSinceAccess, 365));

  // Access boost: logarithmic (more accesses = slightly higher)
  const accessBoost = Math.log(accessCount + 1) / 10;

  // Final score: base importance weighted by factors
  const usefulnessScore = Math.min(9.0, Math.max(1.0,
    baseImportance * (0.5 + helpfulRatio * 0.3 + recencyBoost * 0.15 + accessBoost * 0.05)
  ));

  db.prepare(`
    UPDATE memories SET usefulness_score = ?, last_decay = ? WHERE id = ?
  `).run(usefulnessScore, Date.now(), memoryId);

  return usefulnessScore;
}

/**
 * Apply decay to all memories (batch operation)
 */
export function applyDecayToAll(db: Database.Database): number {
  const memories = db.prepare(`
    SELECT id FROM memories WHERE status = 'active'
  `).all() as { id: number }[];

  for (const mem of memories) {
    updateUsefulnessScore(db, mem.id);
  }

  return memories.length;
}

/**
 * Update memory status (active, archived, consolidated)
 */
export function updateMemoryStatus(
  db: Database.Database,
  memoryId: number,
  status: MemoryStatus,
  parentId?: number
): boolean {
  const result = db.prepare(`
    UPDATE memories SET status = ?, parent_id = ? WHERE id = ?
  `).run(status, parentId ?? null, memoryId);

  return result.changes > 0;
}

/**
 * Create a relationship between memories
 */
export function createRelationship(
  db: Database.Database,
  sourceId: number,
  targetId: number,
  relationship: RelationshipType,
  strength: number = 1.0
): MemoryRelationship {
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO memory_relationships (source_id, target_id, relationship, strength, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sourceId, targetId, relationship, strength, now);

  return {
    id: result.lastInsertRowid as number,
    sourceId,
    targetId,
    relationship,
    strength,
    createdAt: now,
  };
}

/**
 * Get relationships for a memory
 */
export function getMemoryRelationships(
  db: Database.Database,
  memoryId: number
): MemoryRelationship[] {
  const rows = db.prepare(`
    SELECT id, source_id, target_id, relationship, strength, created_at
    FROM memory_relationships
    WHERE source_id = ? OR target_id = ?
  `).all(memoryId, memoryId) as {
    id: number;
    source_id: number;
    target_id: number;
    relationship: string;
    strength: number;
    created_at: number;
  }[];

  return rows.map(row => ({
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationship: row.relationship as RelationshipType,
    strength: row.strength,
    createdAt: row.created_at,
  }));
}

/**
 * Get feedback history for a memory
 */
export function getMemoryFeedback(
  db: Database.Database,
  memoryId: number,
  limit: number = 20
): MemoryFeedback[] {
  const rows = db.prepare(`
    SELECT id, memory_id, feedback_type, context, timestamp
    FROM memory_feedback
    WHERE memory_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(memoryId, limit) as {
    id: number;
    memory_id: number;
    feedback_type: string;
    context: string | null;
    timestamp: number;
  }[];

  return rows.map(row => ({
    id: row.id,
    memoryId: row.memory_id,
    feedbackType: row.feedback_type as FeedbackType,
    context: row.context ?? undefined,
    timestamp: row.timestamp,
  }));
}

/**
 * Get memories by status
 */
export function getMemoriesByStatus(
  db: Database.Database,
  status: MemoryStatus,
  limit: number = 100
): Memory[] {
  const rows = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance,
           created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    WHERE status = ?
    ORDER BY usefulness_score DESC
    LIMIT ?
  `).all(status, limit) as DbMemoryRow[];

  return rows.map(rowToMemory);
}

/**
 * Get low-usefulness memories for pruning
 */
export function getLowUsefulnessMemories(
  db: Database.Database,
  maxUsefulness: number,
  maxDaysSinceAccess: number,
  limit: number = 100
): Memory[] {
  const cutoffTime = Date.now() - (maxDaysSinceAccess * 24 * 60 * 60 * 1000);

  const rows = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance,
           created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    WHERE status = 'active'
      AND usefulness_score < ?
      AND accessed_at < ?
      AND importance < 8
    ORDER BY usefulness_score ASC
    LIMIT ?
  `).all(maxUsefulness, cutoffTime, limit) as DbMemoryRow[];

  return rows.map(rowToMemory);
}

/**
 * Get children of a consolidated memory
 */
export function getChildMemories(db: Database.Database, parentId: number): Memory[] {
  const rows = db.prepare(`
    SELECT id, type, encoded, decoded_cache, scope, project_hash, importance,
           created_at, accessed_at, access_count,
           usefulness_score, times_helpful, times_unhelpful, status, parent_id, level, last_decay
    FROM memories
    WHERE parent_id = ?
  `).all(parentId) as DbMemoryRow[];

  return rows.map(rowToMemory);
}

// ==================== ACCESS PATTERN LEARNING ====================

/**
 * Record that memories were accessed together (co-access pattern)
 * Creates/strengthens implicit relationships between memories accessed at similar times
 */
export function recordCoAccess(
  db: Database.Database,
  memoryIds: number[],
  strength: number = 0.1
): void {
  if (memoryIds.length < 2) return;

  const now = Date.now();

  // For each pair of memories, create or strengthen a relationship
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      const [sourceId, targetId] = memoryIds[i] < memoryIds[j]
        ? [memoryIds[i], memoryIds[j]]
        : [memoryIds[j], memoryIds[i]];

      // Check if relationship exists
      const existing = db.prepare(`
        SELECT id, strength FROM memory_relationships
        WHERE source_id = ? AND target_id = ? AND relationship = 'similar'
      `).get(sourceId, targetId) as { id: number; strength: number } | undefined;

      if (existing) {
        // Strengthen existing relationship (cap at 10)
        const newStrength = Math.min(10, existing.strength + strength);
        db.prepare(`
          UPDATE memory_relationships
          SET strength = ?
          WHERE id = ?
        `).run(newStrength, existing.id);
      } else {
        // Create new relationship
        db.prepare(`
          INSERT INTO memory_relationships (source_id, target_id, relationship, strength, created_at)
          VALUES (?, ?, 'similar', ?, ?)
        `).run(sourceId, targetId, strength, now);
      }
    }
  }
}

/**
 * Get frequently co-accessed memories for a given memory
 * Returns memories that are often accessed together with the input memory
 */
export function getFrequentlyCoAccessedMemories(
  db: Database.Database,
  memoryId: number,
  minStrength: number = 0.5,
  limit: number = 5
): Array<{ memory: Memory; coAccessStrength: number }> {
  // Query relationships where this memory is involved, ordered by strength
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN source_id = ? THEN target_id
        ELSE source_id
      END as related_id,
      strength
    FROM memory_relationships
    WHERE (source_id = ? OR target_id = ?)
      AND relationship = 'similar'
      AND strength >= ?
    ORDER BY strength DESC
    LIMIT ?
  `).all(memoryId, memoryId, memoryId, minStrength, limit) as { related_id: number; strength: number }[];

  const results: Array<{ memory: Memory; coAccessStrength: number }> = [];

  for (const row of rows) {
    const memory = getMemory(db, row.related_id);
    if (memory && memory.status === 'active') {
      results.push({
        memory,
        coAccessStrength: row.strength,
      });
    }
  }

  return results;
}

/**
 * Get memories accessed in a time window
 * Useful for finding patterns of what memories are typically needed together
 */
export function getRecentlyAccessedTogether(
  db: Database.Database,
  windowMs: number = 60000,  // 1 minute default
  minCount: number = 2
): Map<number, number[]> {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Get all memories accessed in the window
  const rows = db.prepare(`
    SELECT id, accessed_at
    FROM memories
    WHERE accessed_at > ?
    ORDER BY accessed_at DESC
  `).all(cutoff) as { id: number; accessed_at: number }[];

  if (rows.length < minCount) return new Map();

  // Group by access time buckets (within 5 seconds = same access batch)
  const buckets = new Map<number, number[]>();
  const bucketSize = 5000; // 5 seconds

  for (const row of rows) {
    const bucketKey = Math.floor(row.accessed_at / bucketSize) * bucketSize;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(row.id);
  }

  // Filter to buckets with multiple memories (co-access patterns)
  const patterns = new Map<number, number[]>();
  for (const [key, ids] of buckets) {
    if (ids.length >= minCount) {
      patterns.set(key, ids);
    }
  }

  return patterns;
}

/**
 * Learn from recent access patterns
 * Analyzes recent memory accesses and strengthens relationships between co-accessed memories
 */
export function learnFromAccessPatterns(
  db: Database.Database,
  windowMs: number = 300000  // 5 minutes default
): number {
  const patterns = getRecentlyAccessedTogether(db, windowMs, 2);
  let relationshipsUpdated = 0;

  for (const [, memoryIds] of patterns) {
    recordCoAccess(db, memoryIds, 0.1);
    relationshipsUpdated += (memoryIds.length * (memoryIds.length - 1)) / 2;
  }

  return relationshipsUpdated;
}

/**
 * Decay relationship strengths over time
 * Should be called periodically to let unused patterns fade
 */
export function decayRelationshipStrengths(
  db: Database.Database,
  decayFactor: number = 0.95,
  minStrength: number = 0.1
): number {
  // Reduce all relationship strengths by decay factor
  const result = db.prepare(`
    UPDATE memory_relationships
    SET strength = strength * ?
    WHERE strength > ?
  `).run(decayFactor, minStrength);

  // Remove relationships that have decayed below minimum
  db.prepare(`
    DELETE FROM memory_relationships
    WHERE strength < ?
  `).run(minStrength);

  return result.changes;
}

/**
 * Get suggested memories based on access patterns
 * Given a set of currently accessed memories, predict what else might be needed
 */
export function getSuggestedMemories(
  db: Database.Database,
  currentMemoryIds: number[],
  limit: number = 3
): Memory[] {
  if (currentMemoryIds.length === 0) return [];

  // Find memories that are frequently accessed with any of the current memories
  const placeholders = currentMemoryIds.map(() => '?').join(', ');

  const rows = db.prepare(`
    SELECT
      CASE
        WHEN source_id IN (${placeholders}) THEN target_id
        ELSE source_id
      END as related_id,
      SUM(strength) as total_strength
    FROM memory_relationships
    WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      AND relationship = 'similar'
    GROUP BY related_id
    HAVING related_id NOT IN (${placeholders})
    ORDER BY total_strength DESC
    LIMIT ?
  `).all(
    ...currentMemoryIds,
    ...currentMemoryIds,
    ...currentMemoryIds,
    ...currentMemoryIds,
    limit
  ) as { related_id: number; total_strength: number }[];

  const memories: Memory[] = [];
  for (const row of rows) {
    const memory = getMemory(db, row.related_id);
    if (memory && memory.status === 'active') {
      memories.push(memory);
    }
  }

  return memories;
}
