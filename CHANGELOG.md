# Changelog

All notable changes to C4-Memory will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.5] - 2025-01-15

### Added

- **Working Memory Layer** (`src/db/working-memory.ts`)
  - Hot memory tier (10-minute TTL) for recent actions
  - Warm memory tier (24-hour TTL) for session state
  - Automatic session persistence to disk
  - Resume context generation for session continuation
  - Survives Claude Code auto-compact

- **Access Pattern Learning**
  - `recordCoAccess()` - Track memories accessed together
  - `getSuggestedMemories()` - Predict relevant memories based on patterns
  - `getFrequentlyCoAccessedMemories()` - Find co-accessed memory clusters
  - `learnFromAccessPatterns()` - Strengthen relationships automatically
  - `decayRelationshipStrengths()` - Let unused patterns fade

- **Memory Linking in Recall**
  - Recall now includes `linkedMemories` from relationships
  - Recall includes `suggestedMemories` based on access patterns
  - Automatic access count updates on retrieval

- **Keyword Fallback Search**
  - `extractKeywords()` - Extract meaningful search terms
  - `queryMemoriesWithKeywords()` - SQL LIKE-based fallback
  - Works when semantic search is unavailable

- **API Key Health Check**
  - `validateApiKey()` - Test API key validity
  - `memory_stats` now includes health status
  - Warns about invalid/expired API keys

- **Auto-Store Config Changes**
  - Config changes automatically stored as memories
  - Never forget API key configuration again

- **Hook Improvements**
  - Correction detection (triggers on "actually", "wrong", etc.)
  - Resume state injection at session start
  - File-triggered auto-recall in PreToolUse
  - Frontend file detection with UI/UX guidelines

### Fixed

- Hook files renamed to `.cjs` to fix ESM/CommonJS compatibility
- CLI updated to use `.cjs` hook extensions

## [2.0.0] - 2025-01-15

### Added

- **MemEvolve Enhancement** - Self-evolving memory system based on [MemEvolve paper](https://arxiv.org/abs/2512.18746)

- **New Tools**
  - `memory_feedback` - Mark memories as helpful/unhelpful/outdated/incorrect
  - `memory_consolidate` - Merge similar memories into higher-level abstractions (PLANNED)
  - `memory_prune` - Archive low-value memories (PLANNED)

- **Usefulness Tracking**
  - `usefulness_score` - Tracks memory effectiveness over time
  - `times_helpful` / `times_unhelpful` - Feedback counters
  - Multi-factor retrieval scoring (semantic + usefulness + recency + importance)

- **Memory Evolution Schema**
  - `status` column (active/archived/consolidated)
  - `parent_id` for consolidated memory hierarchy
  - `level` for knowledge abstraction (1=raw, 2=pattern, 3=principle)
  - `memory_feedback` table for tracking feedback events
  - `memory_relationships` table for memory connections

- **Auto-Inject Hooks**
  - `memory-auto-inject.js` - Automatically queries database and injects relevant memories
  - No Claude intervention needed - memories appear in context automatically
  - Error detection with automatic solution lookup
  - Fix detection with learning reminders

- **CLI Evolve Command**
  - `c4-memory evolve` - Run memory evolution cycle
  - `--dry-run` - Preview changes without applying
  - `--consolidate` - Run consolidation only
  - `--prune` - Run pruning only
  - `--decay` - Apply usefulness decay only

### Changed

- Improved retrieval scoring with multi-factor algorithm
- Enhanced hook installation with portable path resolution
- `CLAUDE_MEMORY_PATH` environment variable support for hooks

### Technical

- Schema v2 migration with backward compatibility
- Better-sqlite3 portable path searching in hooks

## [1.0.0] - 2025-01-13

### Added

- Initial public release
- **7 Memory Tools**
  - `memory_remember` - Store information with type and importance
  - `memory_recall` - Semantic search with configurable limit
  - `memory_refresh` - Load all memories on a topic
  - `memory_forget` - Remove memories by ID or query
  - `memory_stats` - View memory statistics by scope
  - `memory_config` - Manage settings and API keys
  - `memory_learn` - Auto-extract learnable content

- **AIME Compression**
  - Novel AI-optimized symbolic encoding
  - 2-5x compression ratio
  - Structural, entity, relation, and modifier symbols
  - Pattern and error category support
  - Language-specific encodings

- **Semantic Search**
  - OpenAI embeddings integration
  - Cosine similarity matching
  - Graceful fallback to keyword search

- **Auto-Learning**
  - Error + fix pattern detection
  - Correction detection
  - Best practice pattern detection
  - Decision detection
  - Explicit remember requests
  - Confidence scoring
  - Importance estimation

- **Scope Control**
  - Global memories (shared across projects)
  - Project-specific memories
  - Automatic project hashing

- **CLI**
  - `c4-memory init` - Setup wizard
  - `c4-memory config` - Configuration management
  - `c4-memory stats` - View statistics

- **Hook Integration**
  - SessionStart hook
  - UserPromptSubmit hook
  - PreToolUse hook
  - PostToolUse hook
  - Stop hook

### Technical

- TypeScript with strict mode
- SQLite via better-sqlite3
- MCP SDK v1.25.2
- Cross-platform support (Windows, macOS, Linux)
