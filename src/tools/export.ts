/**
 * memory_export - Export memories to shareable .brain files
 *
 * Exports memories matching a topic query to a portable format
 * that can be shared with others and imported into their c4-memory.
 *
 * By default, all personal data is sanitized (paths, usernames, etc.)
 */

import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { queryMemoriesWithKeywords, extractKeywords, queryMemories } from '../db/operations.js';
import { searchBySimilarity, isEmbeddingsAvailable } from '../db/embeddings.js';
import { decode } from '../aime/index.js';
import { getConfig, hasApiKey } from '../config/index.js';
import { sanitizeContent, containsSensitiveData, type SanitizeOptions } from '../sanitize/index.js';
import type { MemoryType, Memory } from '../types.js';

// .brain file format version
const BRAIN_FORMAT_VERSION = '1.0';

// External types for .brain files (more human-readable)
export type BrainMemoryType = 'lesson' | 'error' | 'pattern' | 'fact';

// Map internal types to external .brain file types
const EXTERNAL_TYPE_MAP: Record<MemoryType, BrainMemoryType> = {
  lesson: 'lesson',
  error: 'error',
  relation: 'pattern',  // relations export as patterns
  entity: 'fact',       // entities export as facts
};

export interface BrainFileMemory {
  type: BrainMemoryType;
  importance: number;
  content: string;
  tags?: string[];
}

export interface BrainFile {
  /** Format version for compatibility */
  version: string;
  /** Name/title of this brain file */
  name: string;
  /** Description of what this brain file contains */
  description?: string;
  /** Author (optional, for attribution) */
  author?: string;
  /** Tags for categorization */
  tags: string[];
  /** The query/topic used to generate this export */
  sourceTopic: string;
  /** When this was exported */
  exportedAt: string;
  /** Tool that created this (for compatibility) */
  exportedBy: string;
  /** The actual memories */
  memories: BrainFileMemory[];
  /** Metadata */
  meta: {
    totalExported: number;
    sanitized: boolean;
    sourceMemoryCount?: number;
  };
}

export interface ExportInput {
  /** Topic/query to search for memories to export */
  topic: string;
  /** Output file path (defaults to <topic>.brain in current dir) */
  outputPath?: string;
  /** Name for the brain file (defaults to topic) */
  name?: string;
  /** Description */
  description?: string;
  /** Author attribution */
  author?: string;
  /** Additional tags */
  tags?: string[];
  /** Maximum memories to export */
  limit?: number;
  /** Minimum importance to include */
  minImportance?: number;
  /** Skip sanitization (include personal data) - USE WITH CAUTION */
  includeSensitive?: boolean;
  /** Keep file paths in content */
  keepPaths?: boolean;
  /** Keep usernames/emails in content */
  keepIdentifiers?: boolean;
}

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  exported: number;
  sanitized: boolean;
  warnings?: string[];
  error?: string;
}

/**
 * Export memories to a .brain file
 */
export async function exportMemories(
  db: Database.Database,
  input: ExportInput,
  _projectHash?: string
): Promise<ExportResult> {
  const warnings: string[] = [];

  try {
    const config = getConfig();
    const limit = input.limit ?? 50;
    const minImportance = input.minImportance ?? 5;  // Default to important memories only

    // Search for relevant memories
    let memories: Array<{ memory: Memory; similarity?: number }> = [];

    // Try semantic search first
    if (hasApiKey() && isEmbeddingsAvailable()) {
      try {
        memories = await searchBySimilarity(db, input.topic, {
          limit,
          minSimilarity: 0.3,
          model: config.embedding_model,
        });
      } catch {
        warnings.push(`Semantic search failed, falling back to keyword search`);
      }
    }

    // Fall back to keyword search
    if (memories.length === 0) {
      const keywords = extractKeywords(input.topic);
      if (keywords.length > 0) {
        const results = queryMemoriesWithKeywords(db, keywords, {
          minImportance,
          limit,
        });
        memories = results.map(m => ({ memory: m }));
      } else {
        // Last resort: get all memories above importance threshold
        const results = queryMemories(db, { minImportance, limit });
        memories = results.map(m => ({ memory: m }));
      }
    }

    if (memories.length === 0) {
      return {
        success: false,
        exported: 0,
        sanitized: false,
        error: `No memories found matching topic: "${input.topic}"`,
      };
    }

    // Filter by importance
    memories = memories.filter(({ memory }) => memory.importance >= minImportance);

    // Prepare sanitization options
    const sanitizeOpts: SanitizeOptions = {
      keepPaths: input.keepPaths ?? false,
      keepIdentifiers: input.keepIdentifiers ?? false,
    };

    const shouldSanitize = !input.includeSensitive;

    // Convert memories to brain file format
    const brainMemories: BrainFileMemory[] = memories.map(({ memory }) => {
      let content = memory.decodedCache || decode(memory.encoded);

      // Check for sensitive data
      if (shouldSanitize) {
        const sensitiveCheck = containsSensitiveData(content);
        if (sensitiveCheck.hasSensitiveData) {
          content = sanitizeContent(content, sanitizeOpts);
        }
      }

      return {
        type: EXTERNAL_TYPE_MAP[memory.type as MemoryType] || 'fact',
        importance: memory.importance,
        content,
        tags: extractKeywords(content).slice(0, 5),
      };
    });

    // Build the brain file
    const topicSlug = input.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    const defaultName = input.name || `${topicSlug}-knowledge`;

    const brainFile: BrainFile = {
      version: BRAIN_FORMAT_VERSION,
      name: defaultName,
      description: input.description || `Exported knowledge about: ${input.topic}`,
      author: input.author,
      tags: input.tags || extractKeywords(input.topic),
      sourceTopic: input.topic,
      exportedAt: new Date().toISOString(),
      exportedBy: 'c4-memory',
      memories: brainMemories,
      meta: {
        totalExported: brainMemories.length,
        sanitized: shouldSanitize,
        sourceMemoryCount: memories.length,
      },
    };

    // Determine output path
    const outputPath = input.outputPath || `${topicSlug}.brain`;
    const absolutePath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(process.cwd(), outputPath);

    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write the file
    fs.writeFileSync(absolutePath, JSON.stringify(brainFile, null, 2), 'utf-8');

    return {
      success: true,
      outputPath: absolutePath,
      exported: brainMemories.length,
      sanitized: shouldSanitize,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      exported: 0,
      sanitized: false,
      error: `Export failed: ${error}`,
    };
  }
}

/**
 * Tool definition for MCP
 */
export const exportToolDef = {
  name: 'memory_export',
  description: 'Export memories about a topic to a shareable .brain file. Personal data (paths, usernames, etc.) is automatically sanitized unless you specify includeSensitive=true.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'The topic/query to search for. All memories matching this topic will be exported.',
      },
      outputPath: {
        type: 'string',
        description: 'Output file path. Defaults to <topic>.brain in current directory.',
      },
      name: {
        type: 'string',
        description: 'Name for the brain file. Defaults to topic slug.',
      },
      description: {
        type: 'string',
        description: 'Description of what this brain file contains.',
      },
      author: {
        type: 'string',
        description: 'Author attribution (optional).',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization.',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 500,
        description: 'Maximum memories to export. Default: 50',
      },
      minImportance: {
        type: 'number',
        minimum: 1,
        maximum: 9,
        description: 'Minimum importance level to include. Default: 5',
      },
      includeSensitive: {
        type: 'boolean',
        description: 'CAUTION: Skip sanitization and include personal data (paths, usernames, etc.). Default: false',
      },
      keepPaths: {
        type: 'boolean',
        description: 'Keep file paths in exported content. Default: false',
      },
      keepIdentifiers: {
        type: 'boolean',
        description: 'Keep usernames/emails in exported content. Default: false',
      },
    },
    required: ['topic'],
  },
};
