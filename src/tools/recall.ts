/**
 * memory_recall - Search long-term memory for relevant information
 */

import type Database from 'better-sqlite3';
import type { RecallInput, Memory } from '../types.js';
import { queryMemories } from '../db/operations.js';
import { searchBySimilarity, isEmbeddingsAvailable } from '../db/embeddings.js';
import { decode } from '../aime/index.js';
import { getConfig, hasApiKey } from '../config/index.js';

export interface RecallResult {
  success: boolean;
  memories: Array<{
    id: number;
    content: string;
    type: string;
    importance: number;
    scope: string;
    similarity?: number;
    accessCount: number;
  }>;
  total: number;
  searchMethod: 'semantic' | 'keyword' | 'all';
  warning?: string;
}

/**
 * Recall memories matching a query
 */
export async function recall(
  db: Database.Database,
  input: RecallInput,
  projectHash?: string
): Promise<RecallResult> {
  const config = getConfig();
  const limit = input.limit ?? 10;

  let memories: Array<{ memory: Memory; similarity?: number }> = [];
  let searchMethod: 'semantic' | 'keyword' | 'all' = 'all';
  let warning: string | undefined;

  // Try semantic search if available
  if (hasApiKey() && isEmbeddingsAvailable()) {
    try {
      const results = await searchBySimilarity(db, input.query, {
        limit,
        scope: input.scope,
        projectHash,
        minSimilarity: 0.3,
        model: config.embedding_model,
      });

      if (results.length > 0) {
        memories = results;
        searchMethod = 'semantic';
      }
    } catch (error) {
      warning = `Semantic search failed: ${error}. Falling back to basic query.`;
    }
  } else {
    warning = 'Semantic search unavailable (no API key). Returning all memories sorted by importance.';
  }

  // Fallback to basic query if semantic search didn't work or return results
  if (memories.length === 0) {
    const allMemories = queryMemories(db, {
      scope: input.scope,
      projectHash,
      minImportance: input.minImportance,
      limit,
    });

    memories = allMemories.map(m => ({ memory: m }));
    searchMethod = searchMethod === 'semantic' ? 'semantic' : 'all';
  }

  // Format results
  const formattedMemories = memories.map(({ memory, similarity }) => ({
    id: memory.id,
    content: memory.decodedCache || decode(memory.encoded),
    type: memory.type,
    importance: memory.importance,
    scope: memory.scope,
    similarity,
    accessCount: memory.accessCount,
  }));

  return {
    success: true,
    memories: formattedMemories,
    total: formattedMemories.length,
    searchMethod,
    warning,
  };
}

/**
 * Tool definition for MCP
 */
export const recallToolDef = {
  name: 'memory_recall',
  description: 'Search long-term memory for relevant information. Uses semantic search when available to find the most relevant memories.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for. Can be a question, keywords, or a description of what you need.',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of results to return. Default: 10',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'both'],
        description: 'Search scope: global (all projects), project (current only), or both. Default: both',
      },
      minImportance: {
        type: 'number',
        minimum: 1,
        maximum: 9,
        description: 'Minimum importance level to include in results',
      },
    },
    required: ['query'],
  },
};
