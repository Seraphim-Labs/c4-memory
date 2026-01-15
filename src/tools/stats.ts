/**
 * memory_stats - Get statistics about stored memories
 */

import type Database from 'better-sqlite3';
import { getMemoryStats } from '../db/operations.js';
import { getEmbeddingStats, validateApiKey, isEmbeddingsAvailable } from '../db/embeddings.js';
import { getDatabasePaths } from '../db/schema.js';
import { getConfig, hasApiKey } from '../config/index.js';

export interface StatsResult {
  success: boolean;
  stats: {
    total: number;
    byType: Record<string, number>;
    byScope: Record<string, number>;
    avgImportance: number;
    embeddings: {
      total: number;
      models: Record<string, number>;
    };
    storage: {
      globalDb: string;
      projectsDir: string;
    };
    config: {
      apiKeyConfigured: boolean;
      autoLearn: boolean;
      embeddingModel: string;
    };
    health?: {
      semanticSearchAvailable: boolean;
      apiKeyValid?: boolean;
      warning?: string;
    };
  };
}

/**
 * Get memory statistics
 */
export async function stats(
  db: Database.Database,
  scope?: 'global' | 'project' | 'both',
  projectHash?: string
): Promise<StatsResult> {
  const config = getConfig();
  const paths = getDatabasePaths();

  // Get memory stats
  const memoryStats = getMemoryStats(db, scope === 'project' ? projectHash : undefined);

  // Get embedding stats
  const embeddingStats = getEmbeddingStats(db);

  // Build health status
  const health: StatsResult['stats']['health'] = {
    semanticSearchAvailable: isEmbeddingsAvailable(),
  };

  // Only validate API key if one is configured (to avoid unnecessary API calls)
  if (hasApiKey() && isEmbeddingsAvailable()) {
    const validation = await validateApiKey();
    health.apiKeyValid = validation.valid;
    if (!validation.valid && validation.error) {
      health.warning = validation.error;
    }
  } else if (hasApiKey() && !isEmbeddingsAvailable()) {
    health.warning = 'API key configured but OpenAI client not initialized. Restart may be needed.';
  } else {
    health.warning = 'No API key configured. Semantic search disabled. Using keyword fallback.';
  }

  return {
    success: true,
    stats: {
      total: memoryStats.total,
      byType: memoryStats.byType,
      byScope: memoryStats.byScope,
      avgImportance: Math.round(memoryStats.avgImportance * 10) / 10,
      embeddings: embeddingStats,
      storage: {
        globalDb: paths.global,
        projectsDir: paths.projects,
      },
      config: {
        apiKeyConfigured: hasApiKey(),
        autoLearn: config.auto_learn,
        embeddingModel: config.embedding_model,
      },
      health,
    },
  };
}

/**
 * Tool definition for MCP
 */
export const statsToolDef = {
  name: 'memory_stats',
  description: 'Get statistics about stored memories including counts by type, scope, and configuration status.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['global', 'project', 'both'],
        description: 'Filter stats by scope. Default: both',
      },
    },
  },
};
