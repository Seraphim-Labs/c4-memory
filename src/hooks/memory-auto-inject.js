#!/usr/bin/env node
/**
 * Auto Memory Injection Hook
 *
 * This hook DOES the memory lookup itself and injects results directly.
 * Claude doesn't choose - memories are already in context.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Find better-sqlite3 - check multiple locations
let Database;
const searchPaths = [
  path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),  // Relative to hook in dist
  path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'),  // If hook is deeper
  path.join(os.homedir(), '.claude', 'memory', 'node_modules', 'better-sqlite3'),  // User install
];

// Also check CLAUDE_MEMORY_PATH env var
if (process.env.CLAUDE_MEMORY_PATH) {
  searchPaths.unshift(path.join(process.env.CLAUDE_MEMORY_PATH, 'node_modules', 'better-sqlite3'));
}

for (const p of searchPaths) {
  try {
    Database = require(p);
    break;
  } catch (e) {}
}

// Fallback: try global require
if (!Database) {
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    // Silent fail - no memories will be injected
    process.exit(0);
  }
}

const DB_PATH = path.join(os.homedir(), '.claude', 'memory', 'global.db');
const STATE_PATH = path.join(os.homedir(), '.claude', 'memory', 'inject-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch(e) {}
  return { lastQuery: '', errors: [] };
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch(e) {}
}

function extractKeywords(text) {
  const stop = new Set(['the','a','an','is','are','was','were','be','been','have','has','had',
    'do','does','did','will','would','could','should','can','this','that','what','which',
    'who','where','when','why','how','and','but','if','or','of','at','by','for','with',
    'to','from','in','out','on','please','help','want','need','make','get','me','my','i','you',
    'it','we','they','just','like','know','think','see','look','use','find','give','tell']);
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w)).slice(0, 8);
}

function searchMemories(keywords, limit = 5) {
  if (!fs.existsSync(DB_PATH)) return [];

  try {
    const db = new Database(DB_PATH, { readonly: true });

    // Build search query - search in decoded_cache
    const conditions = keywords.map(() => "decoded_cache LIKE ?").join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    const query = `
      SELECT id, type, decoded_cache, importance, usefulness_score
      FROM memories
      WHERE status = 'active' AND (${conditions})
      ORDER BY usefulness_score DESC, importance DESC, accessed_at DESC
      LIMIT ?
    `;

    const rows = db.prepare(query).all(...params, limit);
    db.close();

    return rows;
  } catch(e) {
    return [];
  }
}

function searchErrors(errorText, limit = 3) {
  if (!fs.existsSync(DB_PATH)) return [];

  try {
    const db = new Database(DB_PATH, { readonly: true });

    const keywords = extractKeywords(errorText);
    if (keywords.length === 0) return [];

    const conditions = keywords.map(() => "decoded_cache LIKE ?").join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    const query = `
      SELECT id, decoded_cache, importance
      FROM memories
      WHERE status = 'active' AND type = 'error' AND (${conditions})
      ORDER BY usefulness_score DESC, importance DESC
      LIMIT ?
    `;

    const rows = db.prepare(query).all(...params, limit);
    db.close();

    return rows;
  } catch(e) {
    return [];
  }
}

function updateAccessCount(memoryIds) {
  if (!fs.existsSync(DB_PATH) || memoryIds.length === 0) return;

  try {
    const db = new Database(DB_PATH);
    const stmt = db.prepare('UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?');
    const now = Date.now();
    for (const id of memoryIds) {
      stmt.run(now, id);
    }
    db.close();
  } catch(e) {}
}

function formatMemories(memories) {
  if (memories.length === 0) return '';

  let output = '\n📚 RELEVANT MEMORIES (use this knowledge):\n';
  for (const mem of memories) {
    const content = (mem.decoded_cache || '').substring(0, 300);
    output += `\n[#${mem.id} ${mem.type} imp:${mem.importance}] ${content}\n`;
  }
  output += '\n---\n';
  return output;
}

// Main
const hookType = process.argv[2] || 'UserPromptSubmit';
let input = {};
try {
  if (process.argv[3]) input = JSON.parse(process.argv[3]);
} catch(e) {}

const state = loadState();

switch (hookType) {
  case 'SessionStart': {
    // Load project context memories
    const memories = searchMemories(['project', 'convention', 'pattern', 'config', 'setup'], 5);
    if (memories.length > 0) {
      updateAccessCount(memories.map(m => m.id));
      console.log(formatMemories(memories));
    }
    break;
  }

  case 'UserPromptSubmit': {
    const msg = input.message || input.prompt || '';
    if (msg.length < 5) break;

    const keywords = extractKeywords(msg);
    if (keywords.length === 0) break;

    const queryKey = keywords.join(' ');
    if (queryKey === state.lastQuery) break; // Don't repeat same query

    state.lastQuery = queryKey;
    saveState(state);

    const memories = searchMemories(keywords, 5);
    if (memories.length > 0) {
      updateAccessCount(memories.map(m => m.id));
      console.log(formatMemories(memories));
    } else {
      // Always remind Claude to use memory, even if nothing found
      console.log(`\n🔍 No memories found for: "${keywords.join(' ')}"\n→ After answering, consider: memory_remember if this is worth storing.\n`);
    }
    break;
  }

  case 'PreToolUse': {
    const tool = input.tool || '';
    if (!['Edit', 'Write', 'Bash'].includes(tool)) break;

    let context = '';
    if (tool === 'Bash') {
      context = input.input?.command || '';
    } else {
      context = input.input?.file_path || '';
      if (input.input?.old_string) context += ' ' + input.input.old_string;
    }

    const keywords = extractKeywords(context);
    if (keywords.length === 0) break;

    const queryKey = keywords.join(' ');
    if (queryKey === state.lastQuery) break;

    state.lastQuery = queryKey;
    saveState(state);

    const memories = searchMemories(keywords, 3);
    if (memories.length > 0) {
      updateAccessCount(memories.map(m => m.id));
      console.log(formatMemories(memories));
    }
    break;
  }

  case 'PostToolUse': {
    const tool = input.tool || '';
    const output = input.output || '';

    // Detect errors and find solutions
    if (tool === 'Bash' && /error|failed|exception|cannot find|not found|TS\d{4}/i.test(output)) {
      state.errors.push({ text: output.substring(0, 200), time: Date.now() });
      state.errors = state.errors.slice(-5);
      saveState(state);

      const errorMemories = searchErrors(output, 3);
      if (errorMemories.length > 0) {
        updateAccessCount(errorMemories.map(m => m.id));
        console.log('\n🔴 ERROR DETECTED - Found relevant solutions:');
        console.log(formatMemories(errorMemories));
      }
    }

    // Detect fix after error - remind to store
    if (tool === 'Bash' && state.errors.length > 0 && !/error|failed/i.test(output)) {
      const lastErr = state.errors[state.errors.length - 1];
      if (lastErr && Date.now() - lastErr.time < 180000) {
        state.errors.pop();
        saveState(state);
        console.log(`\n✅ Fix worked! IMPORTANT: Call memory_learn to store this fix: "${lastErr.text.substring(0,50)}..."\n`);
      }
    }
    break;
  }

  case 'Stop': {
    // Reminder to store learnings
    if (state.errors.length > 0) {
      console.log('\n⚠️ Session ending with unresolved errors. Consider storing learnings with memory_learn.\n');
    }
    break;
  }
}
