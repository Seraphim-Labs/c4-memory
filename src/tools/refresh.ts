/**
 * memory_refresh - Load all memories about a topic into context
 */

import type Database from 'better-sqlite3';
import type { RefreshInput, Memory } from '../types.js';
import { queryMemories } from '../db/operations.js';
import { searchBySimilarity, isEmbeddingsAvailable } from '../db/embeddings.js';
import { decode } from '../aime/index.js';
import { getConfig, hasApiKey } from '../config/index.js';

export interface RefreshResult {
  success: boolean;
  topic: string;
  memories: Array<{
    id: number;
    type: string;
    content: string;
    importance: number;
  }>;
  summary: string;
  total: number;
}

/**
 * Refresh context on a topic by loading all related memories
 */
export async function refresh(
  db: Database.Database,
  input: RefreshInput,
  projectHash?: string
): Promise<RefreshResult> {
  const config = getConfig();
  const depth = input.depth ?? 'shallow';

  // Determine how many memories to load based on depth
  const limit = depth === 'deep' ? 50 : 20;
  const minSimilarity = depth === 'deep' ? 0.2 : 0.4;

  let memories: Memory[] = [];

  // Try semantic search if available
  if (hasApiKey() && isEmbeddingsAvailable()) {
    try {
      const results = await searchBySimilarity(db, input.topic, {
        limit,
        minSimilarity,
        scope: 'both',
        projectHash,
        model: config.embedding_model,
      });

      memories = results.map(r => r.memory);
    } catch {
      // Fall back to basic query
    }
  }

  // Fallback: get recent memories sorted by importance
  if (memories.length === 0) {
    memories = queryMemories(db, {
      scope: 'both',
      projectHash,
      limit,
    });
  }

  // Format memories for output
  const formattedMemories = memories.map(m => ({
    id: m.id,
    type: m.type,
    content: m.decodedCache || decode(m.encoded),
    importance: m.importance,
  }));

  // Generate a summary
  const summary = generateSummary(input.topic, formattedMemories);

  return {
    success: true,
    topic: input.topic,
    memories: formattedMemories,
    summary,
    total: formattedMemories.length,
  };
}

/**
 * Generate a summary of the memories for the topic
 */
function generateSummary(
  topic: string,
  memories: Array<{ type: string; content: string; importance: number }>
): string {
  if (memories.length === 0) {
    return `No memories found about "${topic}".`;
  }

  const byType = {
    entity: 0,
    lesson: 0,
    error: 0,
    relation: 0,
  };

  for (const m of memories) {
    byType[m.type as keyof typeof byType]++;
  }

  const parts: string[] = [];
  parts.push(`Found ${memories.length} memories about "${topic}":`);

  if (byType.entity > 0) parts.push(`- ${byType.entity} facts/entities`);
  if (byType.lesson > 0) parts.push(`- ${byType.lesson} lessons learned`);
  if (byType.error > 0) parts.push(`- ${byType.error} error solutions`);
  if (byType.relation > 0) parts.push(`- ${byType.relation} patterns/relations`);

  const highImportance = memories.filter(m => m.importance >= 7);
  if (highImportance.length > 0) {
    parts.push(`\nHigh importance items: ${highImportance.length}`);
  }

  return parts.join('\n');
}

/**
 * Tool definition for MCP
 */
export const refreshToolDef = {
  name: 'memory_refresh',
  description: 'Load all memories about a topic into context. Use this to refresh your understanding of a topic before working on related tasks.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'The topic to refresh on. Can be a concept, technology, project area, or any subject.',
      },
      depth: {
        type: 'string',
        enum: ['shallow', 'deep'],
        description: 'shallow: load most relevant (faster), deep: load more context (slower but more complete)',
      },
    },
    required: ['topic'],
  },
};
