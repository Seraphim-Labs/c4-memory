/**
 * memory_recall - Search long-term memory for relevant information
 */

import type Database from 'better-sqlite3';
import type { RecallInput, Memory, MemoryRelationship } from '../types.js';
import {
  queryMemories,
  queryMemoriesWithKeywords,
  extractKeywords,
  getMemoryRelationships,
  getMemory,
  updateMemoryAccess,
  recordCoAccess,
  getSuggestedMemories,
} from '../db/operations.js';
import { searchBySimilarity, isEmbeddingsAvailable } from '../db/embeddings.js';
import { decode } from '../aime/index.js';
import { getConfig, hasApiKey } from '../config/index.js';

/**
 * Truncate content to max length, adding ellipsis if truncated
 */
function truncateContent(content: string, maxLength: number): string {
  if (maxLength <= 0 || content.length <= maxLength) return content;
  return content.substring(0, maxLength) + '... (truncated)';
}

export interface LinkedMemory {
  id: number;
  content: string;
  type: string;
  importance: number;
  relationship: string;
  strength: number;
}

export interface SuggestedMemory {
  id: number;
  content: string;
  type: string;
  importance: number;
  reason: string;
}

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
    linkedMemories?: LinkedMemory[];
  }>;
  total: number;
  searchMethod: 'semantic' | 'keyword' | 'all';
  linkedCount?: number;
  suggestedMemories?: SuggestedMemory[];
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
  const maxContentLength = input.maxContentLength ?? 500;  // Truncate long memories
  const includeLinked = input.includeLinked ?? false;      // Off by default to save tokens
  const includeSuggestions = input.includeSuggestions ?? false;  // Off by default

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

  // Fallback to keyword-based query if semantic search didn't work or return results
  if (memories.length === 0) {
    // Extract keywords from query for better fallback matching
    const keywords = extractKeywords(input.query);

    const allMemories = keywords.length > 0
      ? queryMemoriesWithKeywords(db, keywords, {
          scope: input.scope,
          projectHash,
          minImportance: input.minImportance,
          limit,
        })
      : queryMemories(db, {
          scope: input.scope,
          projectHash,
          minImportance: input.minImportance,
          limit,
        });

    memories = allMemories.map(m => ({ memory: m }));
    searchMethod = keywords.length > 0 ? 'keyword' : 'all';
  }

  // Fetch linked memories for each result (only if requested)
  let totalLinkedCount = 0;
  const formattedMemories = memories.map(({ memory, similarity }) => {
    let linkedMemories: LinkedMemory[] | undefined;

    // Only fetch linked memories if explicitly requested
    if (includeLinked) {
      const relationships = getMemoryRelationships(db, memory.id);

      if (relationships.length > 0) {
        linkedMemories = [];
        const seenIds = new Set([memory.id]);

        for (const rel of relationships.slice(0, 5)) {  // Limit to 5 linked per memory
          // Get the linked memory (could be source or target)
          const linkedId = rel.sourceId === memory.id ? rel.targetId : rel.sourceId;
          if (seenIds.has(linkedId)) continue;
          seenIds.add(linkedId);

          const linkedMem = getMemory(db, linkedId);
          if (linkedMem && linkedMem.status === 'active') {
            const linkedContent = linkedMem.decodedCache || decode(linkedMem.encoded);
            linkedMemories.push({
              id: linkedMem.id,
              content: truncateContent(linkedContent, maxContentLength),
              type: linkedMem.type,
              importance: linkedMem.importance,
              relationship: rel.relationship,
              strength: rel.strength,
            });
            totalLinkedCount++;
          }
        }

        // Only include if there are actual linked memories
        if (linkedMemories.length === 0) {
          linkedMemories = undefined;
        }
      }
    }

    // Update access count for retrieved memory
    updateMemoryAccess(db, memory.id);

    const rawContent = memory.decodedCache || decode(memory.encoded);
    return {
      id: memory.id,
      content: truncateContent(rawContent, maxContentLength),
      type: memory.type,
      importance: memory.importance,
      scope: memory.scope,
      similarity,
      accessCount: memory.accessCount + 1,  // Reflect the update we just made
      linkedMemories,
    };
  });

  // Record co-access pattern for learning
  const memoryIds = formattedMemories.map(m => m.id);
  if (memoryIds.length >= 2) {
    recordCoAccess(db, memoryIds, 0.1);
  }

  // Get suggested memories based on access patterns (only if requested)
  let suggestedMemories: SuggestedMemory[] | undefined;
  if (includeSuggestions && memoryIds.length > 0) {
    const suggestions = getSuggestedMemories(db, memoryIds, 3);
    if (suggestions.length > 0) {
      suggestedMemories = suggestions.map(mem => {
        const suggestedContent = mem.decodedCache || decode(mem.encoded);
        return {
          id: mem.id,
          content: truncateContent(suggestedContent, maxContentLength),
          type: mem.type,
          importance: mem.importance,
          reason: 'Frequently accessed with similar queries',
        };
      });
    }
  }

  return {
    success: true,
    memories: formattedMemories,
    total: formattedMemories.length,
    searchMethod,
    linkedCount: totalLinkedCount > 0 ? totalLinkedCount : undefined,
    suggestedMemories,
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
      maxContentLength: {
        type: 'number',
        minimum: 50,
        maximum: 10000,
        description: 'Maximum characters per memory content. Longer content is truncated. Default: 500. Use 0 for no limit.',
      },
      includeLinked: {
        type: 'boolean',
        description: 'Include linked/related memories in results. Default: false (saves tokens)',
      },
      includeSuggestions: {
        type: 'boolean',
        description: 'Include suggested memories based on access patterns. Default: false (saves tokens)',
      },
    },
    required: ['query'],
  },
};
