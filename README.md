<p align="center">
  <h1 align="center">C4-Memory v2.1.1</h1>
  <p align="center">
    <strong>Persistent memory for Claude Code</strong><br>
    Give Claude a brain that remembers <em>and evolves</em>
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/c4-memory"><img src="https://img.shields.io/npm/v/c4-memory.svg" alt="npm version"></a>
  <a href="https://github.com/Seraphim-Labs/c4-memory/actions"><img src="https://github.com/Seraphim-Labs/c4-memory/workflows/CI/badge.svg" alt="CI Status"></a>
  <a href="https://github.com/Seraphim-Labs/c4-memory/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/c4-memory.svg" alt="License"></a>
</p>

---

Ever frustrated that Claude forgets your project conventions between sessions? Or that you have to re-explain the same error fixes? **C4-Memory solves this.**

C4-Memory is an MCP (Model Context Protocol) server that gives Claude Code persistent memory across sessions. It automatically learns from errors, corrections, and patterns - and uses semantic search to recall relevant knowledge exactly when needed.

## Example
After telling Claude Code to research and rememebr how to make good non-AI-slop UI/UX, I then asked it to build me a newletter in a separate session. Here is what it did WITHOUT the frontenddesign skill...
<img width="2947" height="1630" alt="image" src="https://github.com/user-attachments/assets/66bce98c-2116-4ddc-aa3b-ed4337e8d323" />
I truly believe c4 is the future of Claude Code.

## Features

### Core Features
- **10 Memory Tools** - Full CRUD plus evolution tools (remember, recall, refresh, forget, stats, config, learn, feedback, consolidate, prune)
- **AIME Compression** - Novel AI-optimized symbolic encoding that compresses memories while preserving meaning
- **Semantic Search** - Vector embeddings via OpenAI for intelligent memory retrieval
- **Auto-Learning** - Automatically detects errors, fixes, patterns, and corrections
- **Scope Control** - Global memories shared everywhere, or project-specific memories

### v2.0: MemEvolve Features
Inspired by the [MemEvolve paper](https://arxiv.org/abs/2512.18746), v2.0 introduces self-evolving memory:

- **Usefulness Tracking** - Memories are scored based on helpfulness, recency, and access patterns
- **Memory Feedback** - Mark memories as helpful/unhelpful to train the system
- **Memory Consolidation** - Similar memories are merged into higher-level abstractions
- **Memory Pruning** - Low-value memories are automatically archived
- **Hierarchical Knowledge** - Memories evolve from raw facts (L1) → patterns (L2) → principles (L3)
- **Multi-factor Retrieval** - Results ranked by usefulness_score × importance × recency
- **Auto-Inject Hooks** - Memories are automatically injected into Claude's context - no manual recall needed!

### v2.1.1: CI/Type Safety Fix
- **Zero ESLint Warnings** - Fixed all type safety warnings and unused imports
- **Proper TypeScript Types** - Replaced `any` casts with proper input types throughout
- **CI Pipeline Passing** - All 35 tests pass with no linting errors

### v2.1.0: Memory Import/Export
Share knowledge with others via `.brain` files:

- **`memory_export`** - Export memories about any topic to shareable `.brain` files
- **`memory_import`** - Import `.brain` files from others or community packs
- **Automatic Sanitization** - Personal data (paths, usernames, emails, API keys) stripped by default
- **Portable Format** - JSON-based `.brain` files work across tools and platforms

```bash
# Export everything you know about React
memory_export({ topic: "React patterns", outputPath: "react.brain" })

# Import someone else's knowledge
memory_import({ inputPath: "typescript-tips.brain" })
```

### v2.0.7: Token Overflow Prevention
Prevents `memory_recall` from exceeding context limits:

- **Content Truncation** - New `maxContentLength` parameter (default: 500 chars) truncates long memories
- **Optional Linked Memories** - `includeLinked` now defaults to `false` to save tokens
- **Optional Suggestions** - `includeSuggestions` now defaults to `false` to save tokens
- **Linked Memory Limit** - Max 5 linked memories per result when enabled

This fixes the "result exceeds maximum allowed tokens" error that occurred with large memory databases.

### v2.0.6: Hook Stability Fix
- **Robust State Loading** - `loadState()` now merges defaults with saved state, preventing crashes when state file is from older version
- **Fixes "Cannot read properties of undefined"** - SessionStart hook no longer crashes when `filesWorkedOn` or other properties are missing

### v2.0.5: Context Loss Prevention
Designed to survive Claude Code's auto-compact and prevent context loss:

- **Working Memory Layer** - Three-tier memory system (hot/warm/cold) that survives auto-compact
  - Hot memory: Last 10 minutes of actions (auto-expires)
  - Warm memory: Session state persisted to disk (24-hour TTL)
  - Cold memory: Permanent database storage
- **Access Pattern Learning** - Tracks which memories are used together and suggests related memories
- **Memory Linking** - Recall includes linked memories from relationships
- **Keyword Fallback Search** - Works when semantic search is unavailable (no API key needed)
- **API Key Health Check** - Validates OpenAI key and warns about issues
- **Auto-Store Config** - Configuration changes are automatically stored as memories
- **Enhanced Hooks**:
  - Correction detection (triggers on "actually", "wrong", etc.)
  - Resume state injection at session start
  - File-triggered auto-recall when reading/editing files
  - Frontend file detection with UI/UX guidelines

## Quick Start

### 1. Install

```bash
npm install -g c4-memory
```

### 2. Initialize

```bash
c4-memory init
```

This sets up:
- Memory database at `~/.claude/memory/`
- Claude Code configuration in `~/.claude/settings.json`
- Optional enforcement hooks

### 3. Configure OpenAI (for semantic search)

```bash
# Set your API key
c4-memory config --set-key sk-your-openai-key
```

Or use an environment variable:
```bash
export OPENAI_API_KEY=sk-your-key
```

### 4. Use with Claude Code

That's it! Claude now has persistent memory. Try asking:

> "Remember that this project uses Tailwind CSS v4 with the new @theme syntax"

Then in a new session:

> "What CSS framework does this project use?"

Claude will recall the memory automatically.

## Memory Tools

C4-Memory provides 10 tools to Claude:

### Core Tools
| Tool | Description |
|------|-------------|
| `memory_remember` | Store new information |
| `memory_recall` | Search memories semantically |
| `memory_refresh` | Load all memories on a topic |
| `memory_forget` | Remove memories by ID or query |
| `memory_stats` | View memory statistics |
| `memory_config` | Manage settings |
| `memory_learn` | Auto-extract learnable content |

### Evolution Tools (v2.0)
| Tool | Description |
|------|-------------|
| `memory_feedback` | Mark memories as helpful/unhelpful |
| `memory_consolidate` | Merge similar memories into abstractions |
| `memory_prune` | Archive low-value memories |

### Example Usage

```
User: Remember that our API uses JWT tokens with 24h expiration

Claude: [Calls memory_remember]
Stored memory #42 with importance 7 (scope: project)

---

User: How do we handle authentication?

Claude: [Calls memory_recall with "authentication API tokens"]
Retrieved memory #42: "API uses JWT tokens with 24h expiration"
```

## AIME Compression

C4-Memory uses **AIME** (AI Memory Encoding) - a novel symbolic compression format optimized for AI comprehension.

### How It Works

Instead of storing raw text, AIME encodes memories using semantic symbols:

```
Raw:     "When you see error TS2304 'Cannot find name', the fix is to add the missing import"
AIME:    ◊v1.0§ΕtypΞe"TS2304"⊳λts⊳→"add import"◊
```

**Benefits:**
- 2-5x compression ratio
- Preserves semantic meaning
- Optimized for AI pattern matching
- Fast encoding/decoding

### Symbol Categories

| Category | Examples | Purpose |
|----------|----------|---------|
| Structural | ◊ ◆ § | Frame/record delimiters |
| Entities | Ξf Ξc Ξm | Functions, classes, modules |
| Relations | Ψ→ Ψ⊂ Ψ≡ | Dependencies, containment |
| Modifiers | Ω! Ω? | Certainty, importance |
| Patterns | Πsg Πfc | Singleton, factory, etc. |
| Errors | Εsyn Εtyp | Syntax, type errors |

## Auto-Inject Hooks (v2.0)

The v2.0 hooks don't just remind Claude to use memory - they **automatically query the database and inject relevant memories directly into Claude's context**. No manual recall needed!

```bash
c4-memory init --with-hooks
```

### How It Works

| Hook | Trigger | What Happens |
|------|---------|--------------|
| SessionStart | New session | Injects project/convention memories |
| UserPromptSubmit | Each message | Searches your message for keywords, injects matching memories |
| PreToolUse | Before Edit/Write/Bash | Injects relevant patterns for the file/command |
| PostToolUse | After errors | Automatically looks up error solutions from past fixes |
| Stop | Session end | Reminds to store any new learnings |

### Example Flow

```
You: "How do I fix TS2304 errors?"

[Hook automatically queries database]
[Injects: "📚 RELEVANT MEMORIES - USE THIS KNOWLEDGE:
  Memory #114: TS2304 means missing import - check import statements..."]

Claude: Based on my stored knowledge, TS2304 errors mean...
```

The hooks are optional but highly recommended for a truly "memory-enhanced" Claude experience.

## Configuration

### Settings File

Configuration is stored at `~/.claude/memory/config.json`:

```json
{
  "openai_api_key": "sk-...",
  "embedding_model": "text-embedding-3-small",
  "auto_learn": true,
  "default_scope": "global"
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings |
| `CLAUDE_MEMORY_AUTO_LEARN` | Enable auto-learning (`true`/`false`) |
| `CLAUDE_PROJECT_PATH` | Override project path detection |

### CLI Commands

```bash
c4-memory init              # Set up C4-Memory
c4-memory config --show     # Show current config
c4-memory config --set-key  # Set OpenAI key
c4-memory stats             # View memory statistics
c4-memory evolve            # Run memory evolution (consolidate, prune, decay)
c4-memory evolve --dry-run  # Preview evolution without changes
```

## Manual Setup

If you prefer manual configuration, add this to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/c4-memory/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-key"
      }
    }
  }
}
```

## How Auto-Learning Works

C4-Memory can automatically detect learnable content:

| Pattern Type | Detection Examples |
|--------------|-------------------|
| Error + Fix | "Error TS2304... fixed by adding import" |
| Correction | "Actually, you should use X instead" |
| Pattern | "Best practice: always validate input" |
| Decision | "Architecture decision: using PostgreSQL" |
| Explicit | "Remember this: API rate limit is 100/min" |

Each detection gets a confidence score (0.7-1.0) and estimated importance (1-9).

## Memory Organization

### Scopes

- **Global** (`~/.claude/memory/global.db`) - Available in all projects
- **Project** (`~/.claude/memory/projects/<hash>.db`) - Specific to working directory

### Memory Types

| Type | Use Case |
|------|----------|
| `fact` | General information |
| `lesson` | Something learned |
| `error` | Error + solution pair |
| `pattern` | Code pattern or convention |

### Importance Levels

| Level | Meaning |
|-------|---------|
| 1-3 | Low priority, nice-to-know |
| 4-6 | Medium priority, useful context |
| 7-9 | High priority, critical knowledge |

## Memory Evolution (v2.0)

The evolution system helps memories get better over time:

### Usefulness Score

Each memory has a usefulness score (1.0-9.0) calculated from:
- **Helpful ratio**: How often it's been marked helpful vs unhelpful
- **Recency boost**: Recently accessed memories score higher
- **Access boost**: Frequently accessed memories score higher

```
usefulness = importance × (helpful_ratio × 0.3 + recency × 0.15 + access × 0.05)
```

### Memory Levels

| Level | Name | Description |
|-------|------|-------------|
| L1 | Raw | Individual facts, errors, lessons |
| L2 | Pattern | Consolidated from similar L1 memories |
| L3 | Principle | High-level abstractions from L2 |

### Evolution Workflow

```bash
# Preview what would change
c4-memory evolve --dry-run

# Run full evolution
c4-memory evolve

# Or run individual steps
c4-memory evolve --decay        # Update usefulness scores
c4-memory evolve --prune        # Archive low-value memories
c4-memory evolve --consolidate  # Merge similar memories
```

### Using Feedback

Tell Claude when memories helped:
> "That last memory about JWT tokens was helpful, mark it as helpful"

Or mark unhelpful memories:
> "The memory about React hooks was outdated, mark it as incorrect"

## Troubleshooting

### Memory not being recalled?

1. Check if memories exist: `c4-memory stats`
2. Verify OpenAI key: `c4-memory config --show`
3. Try explicit recall: Ask Claude to "recall memories about X"

### Semantic search not working?

Without an OpenAI key, C4-Memory falls back to keyword search. For best results:
```bash
c4-memory config --set-key sk-your-openai-key
```

### Hooks not firing?

Verify hooks are installed:
```bash
cat ~/.claude/settings.json | grep hooks
```

Reinstall with:
```bash
c4-memory init --with-hooks --force
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone the repo
git clone https://github.com/Seraphim-Labs/c4-memory.git
cd c4-memory

# Install dependencies
npm install

# Run in development
npm run dev

# Run tests
npm test
```

## License

MIT - see [LICENSE](LICENSE)

---

<p align="center">
  Made for the Claude Code community<br>
  <a href="https://github.com/Seraphim-Labs/c4-memory">Star on GitHub</a>
</p>
