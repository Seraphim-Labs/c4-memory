/**
 * memory_forget - Remove incorrect or outdated memories
 */

import type Database from 'better-sqlite3';
import type { ForgetInput } from '../types.js';
import { deleteMemory, deleteMemoriesByQuery, queryMemories } from '../db/operations.js';
import { searchBySimilarity, isEmbeddingsAvailable, deleteEmbedding } from '../db/embeddings.js';
import { decode } from '../aime/index.js';
import { hasApiKey, getConfig } from '../config/index.js';

export interface ForgetResult {
  success: boolean;
  deletedCount: number;
  deletedIds: number[];
  message: string;
}

/**
 * Forget (delete) memories
 */
export async function forget(
  db: Database.Database,
  input: ForgetInput,
  projectHash?: string
): Promise<ForgetResult> {
  const deletedIds: number[] = [];

  // Delete by specific IDs
  if (input.ids && input.ids.length > 0) {
    for (const id of input.ids) {
      const success = deleteMemory(db, id);
      if (success) {
        deleteEmbedding(db, id);
        deletedIds.push(id);
      }
    }

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      message: `Deleted ${deletedIds.length} memories by ID.`,
    };
  }

  // Delete by query (search first, then confirm)
  if (input.query) {
    let memoriesToDelete: Array<{ id: number; content: string }> = [];

    // Try semantic search first
    if (hasApiKey() && isEmbeddingsAvailable()) {
      try {
        const config = getConfig();
        const results = await searchBySimilarity(db, input.query, {
          limit: 50,
          minSimilarity: 0.6, // Higher threshold for deletion
          scope: 'both',
          projectHash,
          model: config.embedding_model,
        });

        memoriesToDelete = results.map(r => ({
          id: r.memory.id,
          content: r.memory.decodedCache || decode(r.memory.encoded),
        }));
      } catch (error) {
        // Fall back to basic query
      }
    }

    // Basic fallback: just get recent memories
    if (memoriesToDelete.length === 0) {
      const memories = queryMemories(db, {
        scope: 'both',
        projectHash,
        limit: 50,
      });

      // Simple text matching
      const queryLower = input.query.toLowerCase();
      memoriesToDelete = memories
        .filter(m => {
          const content = (m.decodedCache || decode(m.encoded)).toLowerCase();
          return content.includes(queryLower);
        })
        .map(m => ({
          id: m.id,
          content: m.decodedCache || decode(m.encoded),
        }));
    }

    if (memoriesToDelete.length === 0) {
      return {
        success: true,
        deletedCount: 0,
        deletedIds: [],
        message: `No memories found matching "${input.query}".`,
      };
    }

    // Delete the found memories
    for (const m of memoriesToDelete) {
      const success = deleteMemory(db, m.id);
      if (success) {
        deleteEmbedding(db, m.id);
        deletedIds.push(m.id);
      }
    }

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      message: `Deleted ${deletedIds.length} memories matching "${input.query}".`,
    };
  }

  return {
    success: false,
    deletedCount: 0,
    deletedIds: [],
    message: 'No query or IDs provided. Please specify what to forget.',
  };
}

/**
 * Tool definition for MCP
 */
export const forgetToolDef = {
  name: 'memory_forget',
  description: 'Remove incorrect or outdated memories. Use this when you learn that previously stored information was wrong or is no longer relevant.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to find and delete matching memories. Uses semantic search when available.',
      },
      ids: {
        type: 'array',
        items: { type: 'number' },
        description: 'Specific memory IDs to delete. Use this when you know exactly which memories to remove.',
      },
    },
  },
};
