/**
 * memory_import - Import memories from .brain files
 *
 * Imports memories from shareable .brain files created by memory_export.
 * Validates the file format and adds memories to the local database.
 */

import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createMemory, queryMemoriesWithKeywords, extractKeywords } from '../db/operations.js';
import { quickEncode, decode } from '../aime/index.js';
import type { MemoryType, ImportanceLevel } from '../types.js';
import type { BrainFile, BrainFileMemory } from './export.js';

// Map .brain file types to internal types
const TYPE_MAP: Record<string, MemoryType> = {
  lesson: 'lesson',
  error: 'error',
  pattern: 'relation',  // patterns map to relations
  fact: 'entity',       // facts map to entities
};

// Supported brain file format versions
const SUPPORTED_VERSIONS = ['1.0'];

export interface ImportInput {
  /** Path to the .brain file to import */
  inputPath: string;
  /** Scope for imported memories: global or project */
  scope?: 'global' | 'project';
  /** Skip duplicates (memories with very similar content) */
  skipDuplicates?: boolean;
  /** Override importance levels (use value from file if false) */
  importanceOverride?: number;
  /** Prefix to add to all imported memory content */
  prefix?: string;
  /** Only import memories of these types */
  filterTypes?: Array<'lesson' | 'error' | 'pattern' | 'fact'>;
  /** Minimum importance from file to import */
  minImportance?: number;
  /** Dry run - validate and report but don't actually import */
  dryRun?: boolean;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  total: number;
  brainFile?: {
    name: string;
    description?: string;
    author?: string;
    version: string;
    exportedAt: string;
  };
  errors?: string[];
  warnings?: string[];
}

/**
 * Validate a brain file structure
 */
function validateBrainFile(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Invalid brain file: not a valid JSON object');
    return { valid: false, errors };
  }

  const file = data as Record<string, unknown>;

  // Check required fields
  if (!file.version || typeof file.version !== 'string') {
    errors.push('Missing or invalid "version" field');
  } else if (!SUPPORTED_VERSIONS.includes(file.version)) {
    errors.push(`Unsupported brain file version: ${file.version}. Supported: ${SUPPORTED_VERSIONS.join(', ')}`);
  }

  if (!file.name || typeof file.name !== 'string') {
    errors.push('Missing or invalid "name" field');
  }

  if (!file.memories || !Array.isArray(file.memories)) {
    errors.push('Missing or invalid "memories" array');
  } else {
    // Validate each memory
    const memories = file.memories as unknown[];
    for (let i = 0; i < memories.length; i++) {
      const mem = memories[i] as Record<string, unknown>;
      if (!mem || typeof mem !== 'object') {
        errors.push(`Memory ${i}: invalid structure`);
        continue;
      }
      if (!mem.content || typeof mem.content !== 'string') {
        errors.push(`Memory ${i}: missing or invalid "content"`);
      }
      if (!mem.type || !['lesson', 'error', 'pattern', 'fact'].includes(mem.type as string)) {
        errors.push(`Memory ${i}: invalid "type" (must be lesson, error, pattern, or fact)`);
      }
      if (typeof mem.importance !== 'number' || mem.importance < 1 || mem.importance > 9) {
        errors.push(`Memory ${i}: invalid "importance" (must be 1-9)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a memory is likely a duplicate of existing content
 */
function isDuplicate(
  db: Database.Database,
  content: string,
  existingMemories: Map<string, boolean>
): boolean {
  // Simple check: normalize and compare first 100 chars
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);

  if (existingMemories.has(normalized)) {
    return true;
  }

  existingMemories.set(normalized, true);
  return false;
}

/**
 * Import memories from a .brain file
 */
export async function importMemories(
  db: Database.Database,
  input: ImportInput,
  projectHash?: string
): Promise<ImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Resolve input path
    const absolutePath = path.isAbsolute(input.inputPath)
      ? input.inputPath
      : path.join(process.cwd(), input.inputPath);

    // Check file exists
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        total: 0,
        errors: [`File not found: ${absolutePath}`],
      };
    }

    // Read and parse the file
    const fileContent = fs.readFileSync(absolutePath, 'utf-8');
    let brainFile: BrainFile;

    try {
      brainFile = JSON.parse(fileContent);
    } catch (e) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        total: 0,
        errors: ['Invalid JSON in brain file'],
      };
    }

    // Validate structure
    const validation = validateBrainFile(brainFile);
    if (!validation.valid) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        total: 0,
        errors: validation.errors,
      };
    }

    // Filter memories based on input options
    let memoriesToImport = brainFile.memories;

    // Filter by type
    if (input.filterTypes && input.filterTypes.length > 0) {
      memoriesToImport = memoriesToImport.filter(m => input.filterTypes!.includes(m.type));
    }

    // Filter by importance
    const minImportance = input.minImportance ?? 1;
    memoriesToImport = memoriesToImport.filter(m => m.importance >= minImportance);

    // Track existing memories for duplicate detection
    const existingMemories = new Map<string, boolean>();

    // Pre-load some existing memories for duplicate checking
    if (input.skipDuplicates !== false) {
      const keywords = extractKeywords(brainFile.sourceTopic || brainFile.name);
      if (keywords.length > 0) {
        const existing = queryMemoriesWithKeywords(db, keywords, { limit: 100 });
        for (const mem of existing) {
          const normalized = (mem.decodedCache || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
          existingMemories.set(normalized, true);
        }
      }
    }

    // Import memories
    let imported = 0;
    let skipped = 0;
    const scope = input.scope ?? 'global';

    for (const mem of memoriesToImport) {
      // Check for duplicates
      if (input.skipDuplicates !== false && isDuplicate(db, mem.content, existingMemories)) {
        skipped++;
        continue;
      }

      // Prepare content with optional prefix
      let content = mem.content;
      if (input.prefix) {
        content = `[${input.prefix}] ${content}`;
      }

      // Determine importance
      const importance = input.importanceOverride ?? mem.importance;

      // Skip if dry run
      if (input.dryRun) {
        imported++;
        continue;
      }

      // Add to database
      try {
        // Map external type to internal type
        const internalType = TYPE_MAP[mem.type] || 'entity';
        // Clamp importance to valid range
        const validImportance = Math.max(1, Math.min(9, importance)) as ImportanceLevel;
        // Encode the content using quickEncode
        const encoded = quickEncode(content, mem.type, validImportance);
        const decoded = decode(encoded);

        createMemory(db, {
          type: internalType,
          encoded,
          decodedCache: decoded,
          importance: validImportance,
          scope,
          projectHash: scope === 'project' ? projectHash : undefined,
        });
        imported++;
      } catch (e) {
        errors.push(`Failed to import memory: ${e}`);
        skipped++;
      }
    }

    return {
      success: true,
      imported,
      skipped,
      total: brainFile.memories.length,
      brainFile: {
        name: brainFile.name,
        description: brainFile.description,
        author: brainFile.author,
        version: brainFile.version,
        exportedAt: brainFile.exportedAt,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      imported: 0,
      skipped: 0,
      total: 0,
      errors: [`Import failed: ${error}`],
    };
  }
}

/**
 * Tool definition for MCP
 */
export const importToolDef = {
  name: 'memory_import',
  description: 'Import memories from a .brain file. Use this to load shared knowledge packs or memories exported from another c4-memory instance.',
  inputSchema: {
    type: 'object',
    properties: {
      inputPath: {
        type: 'string',
        description: 'Path to the .brain file to import.',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        description: 'Scope for imported memories. Default: global',
      },
      skipDuplicates: {
        type: 'boolean',
        description: 'Skip memories that appear to already exist. Default: true',
      },
      importanceOverride: {
        type: 'number',
        minimum: 1,
        maximum: 9,
        description: 'Override importance level for all imported memories. If not set, uses values from the file.',
      },
      prefix: {
        type: 'string',
        description: 'Prefix to add to all imported memory content (e.g., "React Patterns").',
      },
      filterTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['lesson', 'error', 'pattern', 'fact'],
        },
        description: 'Only import memories of these types.',
      },
      minImportance: {
        type: 'number',
        minimum: 1,
        maximum: 9,
        description: 'Only import memories with at least this importance level.',
      },
      dryRun: {
        type: 'boolean',
        description: 'Validate and report what would be imported without actually importing.',
      },
    },
    required: ['inputPath'],
  },
};
