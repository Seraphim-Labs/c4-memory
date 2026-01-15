#!/usr/bin/env node
/**
 * C4-Memory CLI
 *
 * Command-line interface for setting up and managing C4-Memory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const CLAUDE_DIR = join(homedir(), '.claude');
const MEMORY_DIR = join(CLAUDE_DIR, 'memory');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const CONFIG_PATH = join(MEMORY_DIR, 'config.json');
const HOOKS_DIR = join(CLAUDE_DIR, 'hooks');

// Package info
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message: string): void {
  log(`✓ ${message}`, 'green');
}

function info(message: string): void {
  log(`ℹ ${message}`, 'blue');
}

function warn(message: string): void {
  log(`⚠ ${message}`, 'yellow');
}

function error(message: string): void {
  log(`✗ ${message}`, 'red');
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
${colors.bright}C4-Memory${colors.reset} v${packageJson.version}
Persistent memory for Claude Code

${colors.cyan}Usage:${colors.reset}
  c4-memory <command> [options]

${colors.cyan}Commands:${colors.reset}
  init              Set up C4-Memory for Claude Code
  config            Manage configuration
  stats             View memory statistics
  evolve            Run memory evolution (consolidate, prune, decay)
  version           Show version
  help              Show this help

${colors.cyan}Init Options:${colors.reset}
  --with-hooks      Install enforcement hooks
  --force           Overwrite existing configuration

${colors.cyan}Config Options:${colors.reset}
  --show            Show current configuration
  --set-key <key>   Set OpenAI API key

${colors.cyan}Evolve Options:${colors.reset}
  --dry-run         Preview changes without applying them
  --consolidate     Only run memory consolidation
  --prune           Only run memory pruning
  --decay           Only apply decay to usefulness scores

${colors.cyan}Examples:${colors.reset}
  c4-memory init
  c4-memory init --with-hooks
  c4-memory config --show
  c4-memory config --set-key sk-your-key
  c4-memory stats
  c4-memory evolve --dry-run
`);
}

/**
 * Initialize C4-Memory
 */
function init(args: string[]): void {
  const withHooks = args.includes('--with-hooks');
  const force = args.includes('--force');

  log('\n🧠 C4-Memory Setup\n', 'bright');

  // Create directories
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
    success('Created memory directory');
  } else {
    info('Memory directory already exists');
  }

  // Create default config
  if (!existsSync(CONFIG_PATH) || force) {
    const defaultConfig = {
      embedding_model: 'text-embedding-3-small',
      auto_learn: true,
      default_scope: 'global',
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    success('Created configuration file');
  } else {
    info('Configuration file already exists');
  }

  // Update Claude Code settings
  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch {
      warn('Could not parse existing settings.json, will create new one');
    }
  }

  // Add MCP server configuration
  const mcpServers = (settings.mcpServers as Record<string, unknown>) || {};
  const serverPath = join(__dirname, 'index.js');

  if (!mcpServers.memory || force) {
    mcpServers.memory = {
      command: 'node',
      args: [serverPath],
    };
    settings.mcpServers = mcpServers;

    // Ensure claude directory exists
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true });
    }

    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    success('Added C4-Memory to Claude Code settings');
  } else {
    info('C4-Memory already configured in Claude Code');
  }

  // Install hooks if requested
  if (withHooks) {
    installHooks(force);
  }

  // Final instructions
  log('\n✨ Setup complete!\n', 'bright');

  if (process.env.OPENAI_API_KEY) {
    success('OpenAI API key detected in environment');
  } else {
    warn('OpenAI API key not set. Semantic search will be disabled.');
    info('Set it with: c4-memory config --set-key sk-your-key');
    info('Or set OPENAI_API_KEY environment variable');
  }

  log('\nNext steps:', 'cyan');
  log('  1. Restart Claude Code to load the memory server');
  log('  2. Ask Claude to "remember" something');
  log('  3. Start a new session and ask about it!\n');
}

/**
 * Install enforcement hooks (v2.0 with auto-feedback)
 */
function installHooks(force: boolean): void {
  if (!existsSync(HOOKS_DIR)) {
    mkdirSync(HOOKS_DIR, { recursive: true });
  }

  // Copy hook scripts to hooks directory
  const hookFiles = ['memory-inject.cjs', 'memory-auto-feedback.cjs', 'memory-continuous.cjs', 'memory-enforced.cjs', 'memory-auto-inject.cjs'];
  const sourceHooksDir = join(__dirname, 'hooks');

  // Get the c4-memory installation path (parent of dist directory)
  const c4MemoryPath = join(__dirname, '..');

  for (const hookFile of hookFiles) {
    const sourcePath = join(sourceHooksDir, hookFile);
    const destPath = join(HOOKS_DIR, hookFile);

    if (existsSync(sourcePath) && (!existsSync(destPath) || force)) {
      const content = readFileSync(sourcePath, 'utf-8');
      writeFileSync(destPath, content);
      success(`Installed ${hookFile}`);
    }
  }

  // Read current settings
  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  }

  const hooks = (settings.hooks as Record<string, unknown[]>) || {};
  const autoInjectHookPath = join(HOOKS_DIR, 'memory-auto-inject.cjs');
  // Set environment variable for hook to find better-sqlite3
  const envPrefix = process.platform === 'win32'
    ? `set "CLAUDE_MEMORY_PATH=${c4MemoryPath}" && `
    : `CLAUDE_MEMORY_PATH="${c4MemoryPath}" `;

  // Session start - AUTO-INJECT memories
  if (!hooks.SessionStart || force) {
    hooks.SessionStart = [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `${envPrefix}node "${autoInjectHookPath}" SessionStart`,
          },
        ],
      },
    ];
  }

  // User prompt - AUTO-INJECT relevant memories
  if (!hooks.UserPromptSubmit || force) {
    hooks.UserPromptSubmit = [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `${envPrefix}node "${autoInjectHookPath}" UserPromptSubmit`,
          },
        ],
      },
    ];
  }

  // Pre tool use - AUTO-INJECT relevant memories
  if (!hooks.PreToolUse || force) {
    hooks.PreToolUse = [
      {
        matcher: 'Edit|Write|Bash',
        hooks: [
          {
            type: 'command',
            command: `${envPrefix}node "${autoInjectHookPath}" PreToolUse`,
          },
        ],
      },
    ];
  }

  // Post tool use - AUTO-INJECT solutions on errors
  if (!hooks.PostToolUse || force) {
    hooks.PostToolUse = [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `${envPrefix}node "${autoInjectHookPath}" PostToolUse`,
          },
        ],
      },
    ];
  }

  // Stop - Remind about storing learnings
  if (!hooks.Stop || force) {
    hooks.Stop = [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `${envPrefix}node "${autoInjectHookPath}" Stop`,
          },
        ],
      },
    ];
  }

  settings.hooks = hooks;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  success('Installed AUTO-INJECT memory hooks');
  info('Memory is now AUTOMATIC:');
  log('  - Relevant memories injected at session start');
  log('  - Relevant memories injected for each message');
  log('  - Relevant memories injected before Edit/Write/Bash');
  log('  - Error solutions injected when errors occur');
  log('  - Fix reminders when errors are resolved');
  log('  - Learnings reminder before session ends');
}

/**
 * Manage configuration
 */
function config(args: string[]): void {
  if (args.includes('--show')) {
    showConfig();
    return;
  }

  const keyIndex = args.indexOf('--set-key');
  if (keyIndex !== -1 && args[keyIndex + 1]) {
    setApiKey(args[keyIndex + 1]);
    return;
  }

  // Default: show config
  showConfig();
}

/**
 * Show current configuration
 */
function showConfig(): void {
  log('\n📋 C4-Memory Configuration\n', 'bright');

  if (!existsSync(CONFIG_PATH)) {
    warn('No configuration file found. Run: c4-memory init');
    return;
  }

  const configData = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

  log('Config file: ' + CONFIG_PATH, 'cyan');
  log('');

  for (const [key, value] of Object.entries(configData)) {
    if (key === 'openai_api_key' && typeof value === 'string') {
      log(`  ${key}: sk-...${value.slice(-4)}`);
    } else {
      log(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  // Check environment variable
  if (process.env.OPENAI_API_KEY) {
    log('');
    info('OPENAI_API_KEY environment variable is set');
  }

  log('');
}

/**
 * Set OpenAI API key
 */
function setApiKey(key: string): void {
  if (!key.startsWith('sk-')) {
    error('Invalid API key format. Key should start with "sk-"');
    return;
  }

  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }

  let configData: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    configData = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }

  configData.openai_api_key = key;
  writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2));

  success(`API key set (ending in ...${key.slice(-4)})`);
  info('Restart Claude Code to apply changes');
}

/**
 * Show memory statistics
 */
function stats(): void {
  log('\n📊 C4-Memory Statistics\n', 'bright');

  const globalDbPath = join(MEMORY_DIR, 'global.db');

  if (!existsSync(globalDbPath)) {
    warn('No memory database found. Start using C4-Memory to create memories.');
    return;
  }

  // Import better-sqlite3 dynamically
  import('better-sqlite3').then((sqlite) => {
    const Database = sqlite.default;
    const db = new Database(globalDbPath, { readonly: true });

    try {
      // Count memories by type
      const typeStats = db
        .prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type')
        .all() as Array<{ type: string; count: number }>;

      // Count by scope
      const scopeStats = db
        .prepare('SELECT scope, COUNT(*) as count FROM memories GROUP BY scope')
        .all() as Array<{ scope: string; count: number }>;

      // Total count
      const total = db
        .prepare('SELECT COUNT(*) as count FROM memories')
        .get() as { count: number };

      // Embeddings count
      const embeddings = db
        .prepare('SELECT COUNT(*) as count FROM embeddings')
        .get() as { count: number };

      log('Global Database:', 'cyan');
      log(`  Total memories: ${total.count}`);
      log(`  With embeddings: ${embeddings.count}`);
      log('');

      if (typeStats.length > 0) {
        log('By type:', 'cyan');
        for (const row of typeStats) {
          log(`  ${row.type}: ${row.count}`);
        }
        log('');
      }

      if (scopeStats.length > 0) {
        log('By scope:', 'cyan');
        for (const row of scopeStats) {
          log(`  ${row.scope}: ${row.count}`);
        }
        log('');
      }

      // Recent memories
      const recent = db
        .prepare(
          'SELECT type, decoded_cache, importance FROM memories ORDER BY created_at DESC LIMIT 3'
        )
        .all() as Array<{ type: string; decoded_cache: string; importance: number }>;

      if (recent.length > 0) {
        log('Recent memories:', 'cyan');
        for (const mem of recent) {
          const preview =
            mem.decoded_cache?.slice(0, 60) || '(no preview)';
          log(`  [${mem.type}] (imp: ${mem.importance}) ${preview}...`);
        }
        log('');
      }

      db.close();
    } catch (err) {
      error(`Failed to read database: ${err}`);
      db.close();
    }
  }).catch((err) => {
    error(`Failed to load database module: ${err}`);
  });
}

/**
 * Run memory evolution (consolidate, prune, decay)
 */
async function evolve(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const onlyConsolidate = args.includes('--consolidate');
  const onlyPrune = args.includes('--prune');
  const onlyDecay = args.includes('--decay');

  // If none specified, run all
  const runAll = !onlyConsolidate && !onlyPrune && !onlyDecay;
  const runConsolidate = runAll || onlyConsolidate;
  const runPrune = runAll || onlyPrune;
  const runDecay = runAll || onlyDecay;

  log('\n🧬 C4-Memory Evolution\n', 'bright');

  if (dryRun) {
    info('Dry run mode - no changes will be made\n');
  }

  const globalDbPath = join(MEMORY_DIR, 'global.db');

  if (!existsSync(globalDbPath)) {
    warn('No memory database found. Start using C4-Memory to create memories.');
    return;
  }

  // Import required modules dynamically
  const sqlite = await import('better-sqlite3');
  const Database = sqlite.default;
  const db = new Database(globalDbPath);

  try {
    // 1. Apply decay to usefulness scores
    if (runDecay) {
      log('📉 Applying decay to usefulness scores...', 'cyan');

      const memories = db
        .prepare("SELECT id, importance, times_helpful, times_unhelpful, accessed_at, access_count FROM memories WHERE status = 'active'")
        .all() as Array<{
          id: number;
          importance: number;
          times_helpful: number;
          times_unhelpful: number;
          accessed_at: number;
          access_count: number;
        }>;

      let decayCount = 0;
      for (const mem of memories) {
        const timesHelpful = mem.times_helpful ?? 0;
        const timesUnhelpful = mem.times_unhelpful ?? 0;
        const accessCount = mem.access_count ?? 0;
        const daysSinceAccess = (Date.now() - mem.accessed_at) / (1000 * 60 * 60 * 24);

        // Calculate new usefulness score
        const helpfulRatio = (timesHelpful + 1) / (timesHelpful + timesUnhelpful + 2);
        const recencyBoost = Math.pow(0.98, Math.min(daysSinceAccess, 365));
        const accessBoost = Math.log(accessCount + 1) / 10;
        const usefulnessScore = Math.min(9.0, Math.max(1.0,
          mem.importance * (0.5 + helpfulRatio * 0.3 + recencyBoost * 0.15 + accessBoost * 0.05)
        ));

        if (!dryRun) {
          db.prepare('UPDATE memories SET usefulness_score = ?, last_decay = ? WHERE id = ?')
            .run(usefulnessScore, Date.now(), mem.id);
        }
        decayCount++;
      }

      success(`Applied decay to ${decayCount} memories`);
      log('');
    }

    // 2. Run pruning
    if (runPrune) {
      log('🗑️  Identifying low-value memories for pruning...', 'cyan');

      const minUsefulness = 2.0;
      const maxDays = 90;
      const recentCutoff = 7;
      const cutoffTime = Date.now() - (maxDays * 24 * 60 * 60 * 1000);

      const candidates = db.prepare(`
        SELECT id, type, decoded_cache, usefulness_score, accessed_at, importance
        FROM memories
        WHERE status = 'active'
          AND usefulness_score < ?
          AND accessed_at < ?
          AND importance < 8
        ORDER BY usefulness_score ASC
        LIMIT 50
      `).all(minUsefulness, cutoffTime) as Array<{
        id: number;
        type: string;
        decoded_cache: string;
        usefulness_score: number;
        accessed_at: number;
        importance: number;
      }>;

      // Filter out recently accessed
      const toPrune = candidates.filter(m => {
        const days = Math.floor((Date.now() - m.accessed_at) / (1000 * 60 * 60 * 24));
        return days >= recentCutoff;
      });

      if (toPrune.length === 0) {
        info('No memories eligible for pruning');
      } else {
        log(`Found ${toPrune.length} memories to prune:`, 'yellow');
        for (const mem of toPrune.slice(0, 5)) {
          const preview = (mem.decoded_cache || '').slice(0, 50);
          const days = Math.floor((Date.now() - mem.accessed_at) / (1000 * 60 * 60 * 24));
          log(`  #${mem.id} [${mem.type}] score=${mem.usefulness_score.toFixed(2)} age=${days}d: ${preview}...`);
        }
        if (toPrune.length > 5) {
          log(`  ... and ${toPrune.length - 5} more`);
        }

        if (!dryRun) {
          for (const mem of toPrune) {
            db.prepare("UPDATE memories SET status = 'archived' WHERE id = ?").run(mem.id);
          }
          success(`Archived ${toPrune.length} low-value memories`);
        }
      }
      log('');
    }

    // 3. Run consolidation (simplified version - needs embeddings for full version)
    if (runConsolidate) {
      log('🔗 Checking for consolidation opportunities...', 'cyan');

      // Count active L1 memories
      const l1Count = db
        .prepare("SELECT COUNT(*) as count FROM memories WHERE status = 'active' AND level = 1")
        .get() as { count: number };

      // Check if embeddings exist
      const embeddingCount = db
        .prepare('SELECT COUNT(*) as count FROM embeddings')
        .get() as { count: number };

      if (embeddingCount.count === 0) {
        warn('No embeddings found. Set OpenAI API key for semantic consolidation.');
        info(`${l1Count.count} Level 1 memories available for future consolidation.`);
      } else {
        info(`${l1Count.count} Level 1 memories with ${embeddingCount.count} embeddings available.`);
        info('Use memory_consolidate tool in Claude Code for semantic consolidation.');
      }
      log('');
    }

    // Summary
    log('📊 Evolution Summary', 'bright');

    const statusStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM memories GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const levelStats = db.prepare(`
      SELECT level, COUNT(*) as count FROM memories WHERE status = 'active' GROUP BY level
    `).all() as Array<{ level: number; count: number }>;

    for (const stat of statusStats) {
      log(`  ${stat.status}: ${stat.count} memories`);
    }
    log('');
    log('  Active memories by level:', 'cyan');
    for (const stat of levelStats) {
      const levelName = stat.level === 1 ? 'Raw' : stat.level === 2 ? 'Pattern' : 'Principle';
      log(`    L${stat.level} (${levelName}): ${stat.count}`);
    }
    log('');

    db.close();
  } catch (err) {
    error(`Evolution failed: ${err}`);
    db.close();
  }
}

/**
 * Main CLI entry point
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      init(args.slice(1));
      break;
    case 'config':
      config(args.slice(1));
      break;
    case 'stats':
      stats();
      break;
    case 'evolve':
      evolve(args.slice(1)).catch(err => {
        error(`Evolution failed: ${err}`);
        process.exit(1);
      });
      break;
    case 'version':
    case '-v':
    case '--version':
      console.log(`c4-memory v${packageJson.version}`);
      break;
    case 'help':
    case '-h':
    case '--help':
    case undefined:
      showHelp();
      break;
    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main();
