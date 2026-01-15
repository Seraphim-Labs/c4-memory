/**
 * Vector Embeddings for Semantic Search
 */

import type Database from 'better-sqlite3';
import OpenAI from 'openai';
import type { Memory } from '../types.js';
import { getMemory, queryMemories } from './operations.js';

// Cache OpenAI client
let openaiClient: OpenAI | null = null;

/**
 * Initialize OpenAI client with API key
 */
export function initOpenAI(apiKey: string): void {
  openaiClient = new OpenAI({ apiKey });
}

/**
 * Get OpenAI client (throws if not initialized)
 */
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Please set your API key using memory_config.');
  }
  return openaiClient;
}

/**
 * Generate embedding for text using OpenAI
 */
export async function generateEmbedding(
  text: string,
  model: string = 'text-embedding-3-small'
): Promise<Float32Array> {
  const openai = getOpenAI();

  const response = await openai.embeddings.create({
    model,
    input: text,
  });

  const embedding = response.data[0].embedding;
  return new Float32Array(embedding);
}

/**
 * Store embedding for a memory
 */
export function storeEmbedding(
  db: Database.Database,
  memoryId: number,
  vector: Float32Array,
  model: string
): void {
  const buffer = Buffer.from(vector.buffer);

  db.prepare(`
    INSERT OR REPLACE INTO embeddings (memory_id, vector, model)
    VALUES (?, ?, ?)
  `).run(memoryId, buffer, model);
}

/**
 * Get embedding for a memory
 */
export function getEmbedding(
  db: Database.Database,
  memoryId: number
): Float32Array | null {
  const row = db.prepare(`
    SELECT vector FROM embeddings WHERE memory_id = ?
  `).get(memoryId) as { vector: Buffer } | undefined;

  if (!row) return null;

  return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.length / 4);
}

/**
 * Delete embedding for a memory
 */
export function deleteEmbedding(db: Database.Database, memoryId: number): boolean {
  const result = db.prepare('DELETE FROM embeddings WHERE memory_id = ?').run(memoryId);
  return result.changes > 0;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Search memories by semantic similarity
 */
export async function searchBySimilarity(
  db: Database.Database,
  query: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    scope?: 'global' | 'project' | 'both';
    projectHash?: string;
    model?: string;
  } = {}
): Promise<Array<{ memory: Memory; similarity: number }>> {
  const {
    limit = 10,
    minSimilarity = 0.5,
    scope = 'both',
    projectHash,
    model = 'text-embedding-3-small',
  } = options;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query, model);

  // Get all memories with embeddings
  const memories = queryMemories(db, {
    scope,
    projectHash,
    limit: 1000, // Get more than we need, we'll filter by similarity
  });

  // Calculate similarities
  const results: Array<{ memory: Memory; similarity: number }> = [];

  for (const memory of memories) {
    const embedding = getEmbedding(db, memory.id);
    if (!embedding) continue;

    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity >= minSimilarity) {
      results.push({ memory, similarity });
    }
  }

  // Sort by similarity and limit
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

/**
 * Generate and store embedding for a memory
 */
export async function embedMemory(
  db: Database.Database,
  memoryId: number,
  text: string,
  model: string = 'text-embedding-3-small'
): Promise<void> {
  const embedding = await generateEmbedding(text, model);
  storeEmbedding(db, memoryId, embedding, model);
}

/**
 * Batch embed multiple memories
 */
export async function batchEmbedMemories(
  db: Database.Database,
  items: Array<{ memoryId: number; text: string }>,
  model: string = 'text-embedding-3-small'
): Promise<void> {
  const openai = getOpenAI();

  // OpenAI supports batch embeddings
  const response = await openai.embeddings.create({
    model,
    input: items.map(i => i.text),
  });

  // Store each embedding
  for (let i = 0; i < items.length; i++) {
    const embedding = new Float32Array(response.data[i].embedding);
    storeEmbedding(db, items[i].memoryId, embedding, model);
  }
}

/**
 * Check if embeddings are available (OpenAI configured)
 */
export function isEmbeddingsAvailable(): boolean {
  return openaiClient !== null;
}

/**
 * Validate API key by making a test API call
 * Returns status and any error message
 */
export async function validateApiKey(): Promise<{
  valid: boolean;
  error?: string;
  keyConfigured: boolean;
}> {
  if (!openaiClient) {
    return { valid: false, keyConfigured: false, error: 'OpenAI client not initialized. No API key configured.' };
  }

  try {
    // Make a minimal API call to validate the key
    // Using embeddings endpoint with minimal input
    await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'test',
    });
    return { valid: true, keyConfigured: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      keyConfigured: true,
      error: errorMessage.includes('401')
        ? 'API key is invalid or expired. Please update with memory_config.'
        : `API error: ${errorMessage}`,
    };
  }
}

/**
 * Get embedding stats
 */
export function getEmbeddingStats(db: Database.Database): {
  total: number;
  models: Record<string, number>;
} {
  const total = (db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as { count: number }).count;

  const modelRows = db.prepare(`
    SELECT model, COUNT(*) as count FROM embeddings GROUP BY model
  `).all() as { model: string; count: number }[];

  const models: Record<string, number> = {};
  for (const row of modelRows) {
    models[row.model] = row.count;
  }

  return { total, models };
}
