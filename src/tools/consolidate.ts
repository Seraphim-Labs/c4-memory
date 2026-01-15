/**
 * Memory Consolidation Tool
 *
 * Merges similar memories into higher-level abstractions.
 * This is a core component of the MemEvolve evolution system.
 *
 * Process:
 * 1. Find clusters of similar memories (cosine similarity > threshold)
 * 2. For each cluster, create a Level 2 (pattern) memory
 * 3. Link original memories via parent_id
 * 4. Mark originals as status='consolidated'
 */

import type Database from 'better-sqlite3';
import type { Memory, ConsolidateInput, MemoryLevel } from '../types.js';
import { openGlobalDb } from '../db/schema.js';
import {
  queryMemories,
  createMemory,
  updateMemoryStatus,
  createRelationship,
} from '../db/operations.js';
import {
  getEmbedding,
  cosineSimilarity,
  isEmbeddingsAvailable,
  embedMemory,
} from '../db/embeddings.js';
import { quickEncode } from '../aime/encoder.js';

/**
 * MCP Tool Definition for memory_consolidate
 */
export const consolidateToolDef = {
  name: 'memory_consolidate',
  description: `Merge similar memories into higher-level abstractions.
This reduces redundancy and creates more powerful pattern-level knowledge.

The consolidation process:
1. Finds clusters of semantically similar memories
2. Creates a Level 2 (pattern) or Level 3 (principle) memory summarizing the cluster
3. Links original memories to the new abstraction
4. Archives the original memories (still searchable but deprioritized)

Use dryRun=true to preview what would be consolidated without making changes.`,
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Optional topic to focus consolidation on. If not provided, consolidates all similar memories.',
      },
      threshold: {
        type: 'number',
        description: 'Similarity threshold (0.0-1.0). Default 0.85. Higher = stricter matching.',
        minimum: 0.5,
        maximum: 0.99,
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview consolidation without making changes',
      },
    },
  },
};

export interface ConsolidationCluster {
  memories: Memory[];
  averageSimilarity: number;
  combinedImportance: number;
  suggestedAbstraction: string;
}

export interface ConsolidateResult {
  success: boolean;
  dryRun: boolean;
  clustersFound: number;
  memoriesConsolidated: number;
  abstractionsCreated: Array<{
    id: number;
    level: MemoryLevel;
    content: string;
    sourceCount: number;
    combinedImportance: number;
  }>;
  clusters?: ConsolidationCluster[];  // Only in dryRun mode
  warnings?: string[];
}

/**
 * Find clusters of similar memories using embeddings
 */
function findSimilarClusters(
  db: Database.Database,
  memories: Memory[],
  threshold: number
): ConsolidationCluster[] {
  const clusters: ConsolidationCluster[] = [];
  const assigned = new Set<number>();

  // Get all embeddings
  const memoryEmbeddings = new Map<number, Float32Array>();
  for (const memory of memories) {
    const embedding = getEmbedding(db, memory.id);
    if (embedding) {
      memoryEmbeddings.set(memory.id, embedding);
    }
  }

  // Build clusters using simple greedy algorithm
  for (const memory of memories) {
    if (assigned.has(memory.id)) continue;

    const embedding = memoryEmbeddings.get(memory.id);
    if (!embedding) continue;

    const cluster: Memory[] = [memory];
    assigned.add(memory.id);

    // Find similar memories
    for (const other of memories) {
      if (assigned.has(other.id)) continue;

      const otherEmbedding = memoryEmbeddings.get(other.id);
      if (!otherEmbedding) continue;

      const similarity = cosineSimilarity(embedding, otherEmbedding);
      if (similarity >= threshold) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    // Only create cluster if we found 2+ similar memories
    if (cluster.length >= 2) {
      // Calculate average pairwise similarity
      let totalSim = 0;
      let pairCount = 0;
      for (let i = 0; i < cluster.length; i++) {
        const embI = memoryEmbeddings.get(cluster[i].id);
        if (!embI) continue;
        for (let j = i + 1; j < cluster.length; j++) {
          const embJ = memoryEmbeddings.get(cluster[j].id);
          if (!embJ) continue;
          totalSim += cosineSimilarity(embI, embJ);
          pairCount++;
        }
      }
      const avgSimilarity = pairCount > 0 ? totalSim / pairCount : 0;

      // Combine importance (use max + boost for having multiple sources)
      const maxImportance = Math.max(...cluster.map(m => m.importance));
      const combinedImportance = Math.min(9, maxImportance + Math.floor(Math.log2(cluster.length)));

      // Generate abstraction from the memories' content
      const suggestedAbstraction = generateAbstraction(cluster);

      clusters.push({
        memories: cluster,
        averageSimilarity: avgSimilarity,
        combinedImportance,
        suggestedAbstraction,
      });
    }
  }

  return clusters;
}

/**
 * Generate an abstraction from a cluster of memories
 * This creates a higher-level summary of the common pattern
 */
function generateAbstraction(memories: Memory[]): string {
  // Extract the content from each memory
  const contents: string[] = [];
  for (const memory of memories) {
    const content = memory.decodedCache || memory.encoded;
    contents.push(content);
  }

  // Find common patterns in the content
  // For now, we create a simple summary - ideally this would use an LLM
  const types = [...new Set(memories.map(m => m.type))];
  const typeStr = types.length === 1 ? types[0] : 'mixed';

  // Create a pattern description
  const prefix = `[PATTERN from ${memories.length} ${typeStr} memories]`;

  // Use the first memory's content as the base, noting it represents a pattern
  const firstContent = memories[0].decodedCache || memories[0].encoded;

  // Truncate if too long
  const maxLen = 500;
  const truncatedContent = firstContent.length > maxLen
    ? firstContent.substring(0, maxLen) + '...'
    : firstContent;

  return `${prefix}\n\nCommon pattern:\n${truncatedContent}\n\n(Consolidated from ${memories.length} similar memories)`;
}

/**
 * Consolidate memories - the main function
 */
export async function consolidate(
  db: Database.Database,
  input: ConsolidateInput,
  projectHash?: string
): Promise<ConsolidateResult> {
  const warnings: string[] = [];
  const threshold = input.threshold ?? 0.85;
  const dryRun = input.dryRun ?? false;

  // Check if embeddings are available
  if (!isEmbeddingsAvailable()) {
    return {
      success: false,
      dryRun,
      clustersFound: 0,
      memoriesConsolidated: 0,
      abstractionsCreated: [],
      warnings: ['Embeddings not available. Set OpenAI API key using memory_config to enable consolidation.'],
    };
  }

  // Get active Level 1 memories (raw memories that can be consolidated)
  let memories = queryMemories(db, {
    projectHash,
    limit: 500,
    includeArchived: false,
  }).filter(m => m.level === 1);

  // If topic specified, we'd filter by topic using semantic search
  // For now, we process all memories
  if (input.topic) {
    warnings.push(`Topic filtering not yet implemented. Processing all ${memories.length} memories.`);
  }

  if (memories.length < 2) {
    return {
      success: true,
      dryRun,
      clustersFound: 0,
      memoriesConsolidated: 0,
      abstractionsCreated: [],
      warnings: ['Not enough memories to consolidate (need at least 2).'],
    };
  }

  // Find clusters of similar memories
  const clusters = findSimilarClusters(db, memories, threshold);

  if (clusters.length === 0) {
    return {
      success: true,
      dryRun,
      clustersFound: 0,
      memoriesConsolidated: 0,
      abstractionsCreated: [],
      warnings: [`No similar memory clusters found at threshold ${threshold}. Try lowering the threshold.`],
    };
  }

  // Dry run - just return what would be consolidated
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      clustersFound: clusters.length,
      memoriesConsolidated: clusters.reduce((sum, c) => sum + c.memories.length, 0),
      abstractionsCreated: clusters.map((c, i) => ({
        id: -1 - i,  // Placeholder IDs for dry run
        level: 2 as MemoryLevel,
        content: c.suggestedAbstraction,
        sourceCount: c.memories.length,
        combinedImportance: c.combinedImportance,
      })),
      clusters,
    };
  }

  // Actually perform consolidation
  const abstractionsCreated: ConsolidateResult['abstractionsCreated'] = [];
  let totalConsolidated = 0;

  for (const cluster of clusters) {
    // Determine level: 2 (pattern) if consolidating L1, 3 (principle) if consolidating L2
    const sourceLevel = Math.max(...cluster.memories.map(m => m.level));
    const newLevel = Math.min(3, sourceLevel + 1) as MemoryLevel;

    // Determine scope: global if any source is global, otherwise project
    const hasGlobal = cluster.memories.some(m => m.scope === 'global');
    const scope = hasGlobal ? 'global' : 'project';

    // Create the consolidated memory
    const encoded = quickEncode(cluster.suggestedAbstraction, 'pattern', cluster.combinedImportance);

    const newMemory = createMemory(db, {
      type: 'lesson',  // Consolidated memories are lessons/patterns
      encoded,
      decodedCache: cluster.suggestedAbstraction,
      scope,
      projectHash: scope === 'project' ? projectHash : undefined,
      importance: cluster.combinedImportance as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    });

    // Update the new memory's level
    db.prepare('UPDATE memories SET level = ? WHERE id = ?').run(newLevel, newMemory.id);

    // Generate embedding for the new memory
    try {
      await embedMemory(db, newMemory.id, cluster.suggestedAbstraction);
    } catch (error) {
      warnings.push(`Failed to embed consolidated memory #${newMemory.id}: ${error}`);
    }

    // Link source memories to the new abstraction
    for (const source of cluster.memories) {
      // Mark as consolidated and set parent
      updateMemoryStatus(db, source.id, 'consolidated', newMemory.id);

      // Create relationship
      createRelationship(db, source.id, newMemory.id, 'derived_from', cluster.averageSimilarity);
    }

    abstractionsCreated.push({
      id: newMemory.id,
      level: newLevel,
      content: cluster.suggestedAbstraction.substring(0, 200) + '...',
      sourceCount: cluster.memories.length,
      combinedImportance: cluster.combinedImportance,
    });

    totalConsolidated += cluster.memories.length;
  }

  return {
    success: true,
    dryRun: false,
    clustersFound: clusters.length,
    memoriesConsolidated: totalConsolidated,
    abstractionsCreated,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Helper to consolidate memories by topic
 */
export async function consolidateByTopic(
  topic: string,
  threshold: number = 0.85,
  dryRun: boolean = false
): Promise<ConsolidateResult> {
  const db = openGlobalDb();
  try {
    return await consolidate(db, { topic, threshold, dryRun });
  } finally {
    db.close();
  }
}
