/**
 * memory_remember - Store information in long-term memory
 */

import type Database from 'better-sqlite3';
import type { RememberInput, Memory, MemoryType } from '../types.js';
import { createMemory } from '../db/operations.js';
import { embedMemory, isEmbeddingsAvailable } from '../db/embeddings.js';
import { quickEncode, decode } from '../aime/index.js';
import { getConfig, hasApiKey } from '../config/index.js';

export interface RememberResult {
  success: boolean;
  memoryId?: number;
  encoded?: string;
  compressionRatio?: number;
  warning?: string;
}

/**
 * Map user-facing type to internal memory type
 */
function mapType(type?: string): MemoryType {
  switch (type) {
    case 'lesson':
      return 'lesson';
    case 'error':
      return 'error';
    case 'pattern':
      return 'relation'; // Store patterns as relations
    case 'fact':
    default:
      return 'entity';
  }
}

/**
 * Store a memory
 */
export async function remember(
  db: Database.Database,
  input: RememberInput,
  projectHash?: string
): Promise<RememberResult> {
  const config = getConfig();

  // Encode the content
  const memoryType = mapType(input.type);
  const importance = input.importance ?? 5;
  const encoded = quickEncode(input.content, input.type || 'fact', importance);
  const decoded = decode(encoded);

  // Calculate compression ratio
  const compressionRatio = input.content.length / encoded.length;

  // Determine scope - resolve 'both' to 'global' for storage
  const inputScope = input.scope ?? config.default_scope;
  const scope = inputScope === 'both' ? 'global' : inputScope;

  // Create the memory
  const memory = createMemory(db, {
    type: memoryType,
    encoded,
    decodedCache: decoded,
    scope,
    projectHash: scope === 'project' ? projectHash : undefined,
    importance: importance as any,
  });

  // Generate embedding if API key is available
  let warning: string | undefined;
  if (hasApiKey() && isEmbeddingsAvailable()) {
    try {
      await embedMemory(db, memory.id, input.content, config.embedding_model);
    } catch (error) {
      warning = `Memory stored but embedding failed: ${error}`;
    }
  } else {
    warning = 'OpenAI API key not configured. Memory stored without embedding (semantic search disabled).';
  }

  return {
    success: true,
    memoryId: memory.id,
    encoded,
    compressionRatio,
    warning,
  };
}

/**
 * Tool definition for MCP
 */
export const rememberToolDef = {
  name: 'memory_remember',
  description: 'Store information in long-term memory. The content will be compressed using AIME encoding and stored for future recall.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember. Can be facts, lessons learned, error solutions, or patterns.',
      },
      type: {
        type: 'string',
        enum: ['lesson', 'error', 'pattern', 'fact'],
        description: 'Type of memory: lesson (something learned), error (error + solution), pattern (code pattern), fact (general information)',
      },
      importance: {
        type: 'number',
        minimum: 1,
        maximum: 9,
        description: 'Importance level 1-9. Higher importance memories are prioritized in recall. Default: 5',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        description: 'Scope of memory: global (available in all projects) or project (only this project)',
      },
    },
    required: ['content'],
  },
};
