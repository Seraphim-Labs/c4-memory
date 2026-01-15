// Memory types
export type MemoryType = 'entity' | 'lesson' | 'error' | 'relation';
export type MemoryScope = 'global' | 'project';
export type ImportanceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type MemoryStatus = 'active' | 'archived' | 'consolidated';
export type MemoryLevel = 1 | 2 | 3;  // 1=raw, 2=pattern, 3=principle
export type FeedbackType = 'helpful' | 'unhelpful' | 'outdated' | 'incorrect';
export type RelationshipType = 'similar' | 'supersedes' | 'contradicts' | 'derived_from';

export interface Memory {
  id: number;
  type: MemoryType;
  encoded: string;           // AIME encoded content
  decodedCache?: string;     // Cached decoded version
  scope: MemoryScope;
  projectHash?: string;
  importance: ImportanceLevel;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  // Evolution tracking (v2)
  usefulnessScore: number;   // Calculated usefulness (default 5.0)
  timesHelpful: number;      // Count of helpful feedback
  timesUnhelpful: number;    // Count of unhelpful feedback
  status: MemoryStatus;      // active, archived, or consolidated
  parentId?: number;         // ID of parent memory (for consolidated)
  level: MemoryLevel;        // 1=raw, 2=pattern, 3=principle
  lastDecay?: number;        // Timestamp of last decay calculation
}

export interface MemoryFeedback {
  id: number;
  memoryId: number;
  feedbackType: FeedbackType;
  context?: string;
  timestamp: number;
}

export interface MemoryRelationship {
  id: number;
  sourceId: number;
  targetId: number;
  relationship: RelationshipType;
  strength: number;
  createdAt: number;
}

export interface MemoryEmbedding {
  memoryId: number;
  vector: Float32Array;
  model: string;
}

export interface AutoLearnLog {
  id: number;
  triggerType: 'error_fix' | 'correction' | 'pattern' | 'decision' | 'explicit';
  context: string;
  memoryId?: number;
  timestamp: number;
}

// AIME encoding types
export interface AIMEToken {
  type: 'structural' | 'entity' | 'action' | 'relation' | 'modifier' | 'pattern' | 'error' | 'literal';
  symbol: string;
  value?: string;
}

export interface AIMERecord {
  recordType: 'entity' | 'relation' | 'lesson' | 'error';
  tokens: AIMEToken[];
}

export interface AIMEFrame {
  version: string;
  records: AIMERecord[];
}

// Configuration
export interface MemoryConfig {
  openai_api_key?: string;
  embedding_model: string;
  auto_learn: boolean;
  default_scope: 'global' | 'project' | 'both';
}

export const DEFAULT_CONFIG: MemoryConfig = {
  embedding_model: 'text-embedding-3-small',
  auto_learn: true,
  default_scope: 'both',
};

// MCP Tool inputs
export interface RememberInput {
  content: string;
  type?: 'lesson' | 'error' | 'pattern' | 'fact';
  importance?: number;
  scope?: 'global' | 'project';
}

export interface RecallInput {
  query: string;
  limit?: number;
  scope?: 'global' | 'project' | 'both';
  minImportance?: number;
  maxContentLength?: number;      // Truncate content to this length (default: 500)
  includeLinked?: boolean;        // Include linked memories (default: false)
  includeSuggestions?: boolean;   // Include suggested memories (default: false)
}

export interface RefreshInput {
  topic: string;
  depth?: 'shallow' | 'deep';
}

export interface ForgetInput {
  query?: string;
  ids?: number[];
}

export interface ConfigInput {
  openai_api_key?: string;
  auto_learn?: boolean;
  show?: boolean;
}

// Learnable event for auto-learning
export interface LearnableEvent {
  type: 'error_fix' | 'correction' | 'pattern' | 'decision' | 'explicit';
  content: string;
  context: string;
  confidence: number;
}

// Evolution tool inputs (v2)
export interface FeedbackInput {
  memoryIds?: number[];      // Specific memories, or last retrieved
  feedback: FeedbackType;
  context?: string;
}

export interface ConsolidateInput {
  topic?: string;            // Consolidate memories on this topic
  threshold?: number;        // Similarity threshold (default 0.85)
  dryRun?: boolean;          // Preview only
}

export interface PruneInput {
  minUsefulness?: number;    // Remove below this score (default 2.0)
  maxAge?: number;           // Days without access (default 90)
  dryRun?: boolean;          // Preview only
  permanent?: boolean;       // Permanently delete instead of archiving
}

export interface EvolveInput {
  consolidate?: boolean;     // Run consolidation (default true)
  prune?: boolean;           // Run pruning (default true)
  decay?: boolean;           // Apply decay (default true)
  dryRun?: boolean;          // Preview only
}
