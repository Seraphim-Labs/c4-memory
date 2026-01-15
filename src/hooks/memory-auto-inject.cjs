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

const DEFAULT_STATE = {
  lastQuery: '',
  errors: [],
  sessionStart: null,
  filesWorkedOn: [],
  lastUserMessage: '',
  lastAction: '',
  currentTask: '',
  frontendInjectedThisSession: false,
};

function loadState() {
  const defaults = { ...DEFAULT_STATE };
  try {
    if (fs.existsSync(STATE_PATH)) {
      const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      // Merge defaults with saved state to handle missing properties
      return { ...defaults, ...saved };
    }
  } catch(e) {}
  return defaults;
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

/**
 * Intelligent topic extraction - detects domains and generates semantic queries
 * Returns topics that should trigger memory_recall calls
 */
function extractTopics(text) {
  const topics = new Set();
  const lowerText = text.toLowerCase();

  // Technology/Framework detection → best practices queries
  const techPatterns = {
    'nextjs|next.js|next js': ['NextJS best practices', 'NextJS patterns', 'React server components'],
    'react': ['React patterns', 'React hooks', 'React best practices'],
    'vue|vuejs': ['Vue best practices', 'Vue composition API'],
    'svelte|sveltekit': ['Svelte patterns', 'SvelteKit'],
    'typescript|ts': ['TypeScript patterns', 'TypeScript best practices'],
    'tailwind': ['Tailwind CSS patterns', 'Tailwind best practices'],
    'prisma': ['Prisma patterns', 'database schema'],
    'supabase': ['Supabase patterns', 'Supabase auth'],
    'firebase': ['Firebase patterns', 'Firebase auth'],
    'mongodb|mongoose': ['MongoDB patterns', 'database design'],
    'postgres|postgresql': ['PostgreSQL patterns', 'database design'],
    'graphql': ['GraphQL patterns', 'API design'],
    'trpc': ['tRPC patterns', 'type-safe API'],
    'express': ['Express patterns', 'Node.js API'],
    'fastapi': ['FastAPI patterns', 'Python API'],
    'django': ['Django patterns', 'Python web'],
    'electron': ['Electron patterns', 'desktop app'],
    'netlify': ['Netlify deployment', 'Netlify functions', 'Netlify configuration'],
    'vercel': ['Vercel deployment', 'serverless functions'],
    'docker': ['Docker patterns', 'containerization'],
    'aws|lambda': ['AWS patterns', 'serverless'],
  };

  for (const [pattern, relatedTopics] of Object.entries(techPatterns)) {
    if (new RegExp(pattern, 'i').test(text)) {
      relatedTopics.forEach(t => topics.add(t));
    }
  }

  // Domain detection → domain-specific queries
  const domainPatterns = {
    'dashboard|analytics|charts|metrics|visualization': ['dashboard design', 'data visualization', 'UI/UX dashboards'],
    'auth|login|signup|register|password|session': ['authentication patterns', 'auth security', 'session management'],
    'form|input|validation|submit': ['form validation', 'form patterns', 'UX forms'],
    'api|endpoint|rest|fetch|axios': ['API design', 'REST patterns', 'error handling'],
    'database|db|query|schema|model': ['database design', 'data modeling', 'query optimization'],
    'test|testing|jest|vitest|cypress': ['testing patterns', 'test best practices'],
    'deploy|deployment|ci|cd|pipeline': ['deployment patterns', 'CI/CD'],
    'style|css|design|ui|ux|layout': ['UI/UX design', 'CSS patterns', 'frontend aesthetics'],
    'animation|transition|motion|framer': ['animation patterns', 'motion design'],
    'responsive|mobile|breakpoint': ['responsive design', 'mobile-first'],
    'error|exception|catch|handling': ['error handling patterns'],
    'state|redux|zustand|context|store': ['state management', 'React state'],
    'cache|caching|redis|memoiz': ['caching strategies', 'performance optimization'],
    'websocket|realtime|socket|live': ['realtime patterns', 'WebSocket'],
    'upload|file|image|media|blob': ['file upload patterns', 'media handling'],
    'email|notification|alert': ['notification patterns', 'email integration'],
    'payment|stripe|checkout|billing': ['payment integration', 'Stripe patterns'],
    'search|filter|sort|pagination': ['search patterns', 'filtering UX'],
    'chat|message|conversation': ['chat UI patterns', 'messaging'],
    'map|location|geo': ['geolocation', 'maps integration'],
  };

  for (const [pattern, relatedTopics] of Object.entries(domainPatterns)) {
    if (new RegExp(pattern, 'i').test(text)) {
      relatedTopics.forEach(t => topics.add(t));
    }
  }

  // Quality/style modifiers
  if (/cool|awesome|beautiful|stunning|modern|sleek|professional/i.test(text)) {
    topics.add('UI/UX design');
    topics.add('frontend aesthetics');
  }
  if (/fast|performance|optimize|speed/i.test(text)) {
    topics.add('performance optimization');
  }
  if (/secure|security|safe/i.test(text)) {
    topics.add('security best practices');
  }
  if (/scalable|scale|growth/i.test(text)) {
    topics.add('scalability patterns');
  }

  return Array.from(topics).slice(0, 6); // Max 6 topics
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

  let output = '\n<user-prompt-submit-hook>\n📚 RELEVANT MEMORIES - USE THIS KNOWLEDGE IN YOUR RESPONSE:\n';
  for (const mem of memories) {
    const content = (mem.decoded_cache || '').substring(0, 300);
    output += `\n[Memory #${mem.id} | ${mem.type} | importance:${mem.importance}]\n${content}\n`;
  }
  output += '\n</user-prompt-submit-hook>\n';
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
    // Check if we have resume state from previous session
    const hasResumeContext = state.lastUserMessage || state.filesWorkedOn.length > 0 || state.currentTask;

    if (hasResumeContext) {
      let resumeInfo = '\n<session-resume>\n📋 RESUMING FROM PREVIOUS SESSION:\n';

      if (state.currentTask) {
        resumeInfo += `\n🎯 Last task: ${state.currentTask}\n`;
      }
      if (state.lastUserMessage) {
        resumeInfo += `\n💬 Last user message: "${state.lastUserMessage.substring(0, 200)}${state.lastUserMessage.length > 200 ? '...' : ''}"\n`;
      }
      if (state.lastAction) {
        resumeInfo += `\n🔧 Last action: ${state.lastAction}\n`;
      }
      if (state.filesWorkedOn.length > 0) {
        const recentFiles = state.filesWorkedOn.slice(-5);
        resumeInfo += `\n📁 Recent files:\n${recentFiles.map(f => `   - ${f}`).join('\n')}\n`;
      }
      if (state.errors.length > 0) {
        resumeInfo += `\n⚠️ Unresolved errors from last session: ${state.errors.length}\n`;
      }

      resumeInfo += '\nUse this context to continue seamlessly. Ask user if unclear.\n</session-resume>\n';
      console.log(resumeInfo);
    }

    // Reset flags for new session but preserve resume info
    state.frontendInjectedThisSession = false;
    state.sessionStart = Date.now();
    saveState(state);

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

    // Track session context for resume
    state.lastUserMessage = msg.substring(0, 500);

    // Detect task patterns and update current task
    const taskPatterns = [
      /(?:help\s+(?:me\s+)?)?(?:implement|create|build|add|fix|update|refactor|debug|write|make)\s+(.{10,80})/i,
      /(?:can\s+you|please|i\s+need|i\s+want)\s+(.{10,80})/i,
    ];
    for (const pattern of taskPatterns) {
      const match = msg.match(pattern);
      if (match) {
        state.currentTask = match[1].substring(0, 100);
        break;
      }
    }
    saveState(state);

    // CORRECTION DETECTION - User correcting Claude's behavior/assumptions
    const correctionPatterns = /\b(actually|no[,.]?\s|wrong|not\s+\w+[,.]?\s+but|instead\s+of|don't\s+use|never\s+use|always\s+use|stop\s+using|we\s+use|prefer\s+\w+\s+over|that's\s+not\s+right|incorrect)\b/i;
    if (correctionPatterns.test(msg)) {
      console.log(`
<user-prompt-submit-hook>
⚠️ CORRECTION DETECTED - MANDATORY ACTION:
The user is correcting your behavior or assumptions.
You MUST store this correction using memory_remember with importance=9, scope='global'.
Example: memory_remember({ content: "[Correction details]", importance: 9, type: "lesson" })
DO NOT FORGET TO STORE THIS. User corrections are the most valuable memories.
</user-prompt-submit-hook>
`);
    }

    // INTELLIGENT TOPIC EXTRACTION - Generate semantic queries
    const topics = extractTopics(msg);
    const keywords = extractKeywords(msg);

    // Combine topics and keywords for comprehensive search
    const allSearchTerms = [...new Set([...topics, ...keywords])];

    const queryKey = allSearchTerms.join(' ');
    if (queryKey === state.lastQuery) break;
    state.lastQuery = queryKey;
    saveState(state);

    // Search memories with both keywords and topics
    const memories = searchMemories(keywords, 5);

    // Build output with EXPLICIT recall instructions
    let output = '\n<user-prompt-submit-hook>\n';

    // Always show detected topics and FORCE explicit recalls
    if (topics.length > 0) {
      output += '🧠 MANDATORY MEMORY RECALLS - Execute these BEFORE coding:\n';
      output += topics.map(t => `   → memory_recall("${t}")`).join('\n');
      output += '\n\n';
    }

    // Show pre-fetched relevant memories
    if (memories.length > 0) {
      updateAccessCount(memories.map(m => m.id));
      output += '📚 PRE-FETCHED RELEVANT MEMORIES:\n';
      for (const mem of memories) {
        const content = (mem.decoded_cache || '').substring(0, 300);
        output += `\n[Memory #${mem.id} | ${mem.type} | importance:${mem.importance}]\n${content}\n`;
      }
    } else if (topics.length === 0) {
      output += `🔍 No stored memories found for: "${keywords.join(' ')}"\n`;
      output += 'ACTION: After completing task, store useful learnings with memory_remember.\n';
    }

    output += '</user-prompt-submit-hook>\n';
    console.log(output);
    break;
  }

  case 'PreToolUse': {
    const tool = input.tool || '';
    if (!['Edit', 'Write', 'Bash', 'Read'].includes(tool)) break;

    let context = '';
    let filePath = '';
    if (tool === 'Bash') {
      context = input.input?.command || '';
      state.lastAction = `Bash: ${context.substring(0, 50)}`;
    } else if (tool === 'Read') {
      filePath = input.input?.file_path || '';
      context = filePath;
      state.lastAction = `Read: ${path.basename(filePath)}`;
    } else {
      filePath = input.input?.file_path || '';
      context = filePath;
      if (input.input?.old_string) context += ' ' + input.input.old_string;
      state.lastAction = `${tool}: ${path.basename(filePath)}`;
    }

    // Track files worked on for session resume
    if (filePath && !state.filesWorkedOn.includes(filePath)) {
      state.filesWorkedOn.push(filePath);
      // Keep only last 20 files
      if (state.filesWorkedOn.length > 20) {
        state.filesWorkedOn = state.filesWorkedOn.slice(-20);
      }
    }
    saveState(state);

    // FILE-SPECIFIC MEMORY RECALL - Search for memories mentioning this file
    if (filePath) {
      const fileName = path.basename(filePath);
      const fileDir = path.dirname(filePath).split(path.sep).slice(-2).join('/');
      const fileMemories = searchMemories([fileName, fileDir], 2);
      if (fileMemories.length > 0) {
        console.log(`\n<file-context>\n📁 Memories related to ${fileName}:`);
        updateAccessCount(fileMemories.map(m => m.id));
        console.log(formatMemories(fileMemories));
        console.log('</file-context>\n');
      }
    }

    // FRONTEND FILE DETECTION - Always inject UI/UX guidelines
    const frontendExtensions = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html|astro)$/i;
    const isFrontendFile = frontendExtensions.test(filePath);

    if (isFrontendFile && !state.frontendInjectedThisSession) {
      state.frontendInjectedThisSession = true;
      saveState(state);

      console.log(`
<pre-tool-use-hook>
🎨 FRONTEND FILE DETECTED - MANDATORY UI/UX GUIDELINES:

⛔ NEVER USE THESE FONTS: Inter, Roboto, Open Sans, Lato, Arial, system fonts
⛔ NEVER USE: Purple gradients on white, solid color backgrounds, #3B82F6 blue
⛔ NEVER USE: Cookie-cutter layouts, predictable patterns

✅ TYPOGRAPHY: Use distinctive fonts (Clash Display, Satoshi, Playfair Display, JetBrains Mono)
   - Weight extremes: 100/200 vs 800/900 (NOT 400 vs 600)
   - Size jumps of 3x+ (not 1.5x)

✅ COLOR: Dominant colors with SHARP accents, draw from IDE themes (Dracula, Nord, Catppuccin)
   - Use CSS variables for consistency

✅ BACKGROUNDS: Layer CSS gradients, geometric patterns, atmospheric depth
   - NEVER default to solid colors

✅ MOTION: One orchestrated page load with staggered animation-delay > scattered micro-interactions

✅ APPROACH: Design like it belongs on Awwwards. Make unexpected choices.

This is MANDATORY. Failure to follow = rejection.
</pre-tool-use-hook>
`);
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
    // Avoid false positives: "no errors", "0 errors", "without error"
    const hasRealError = /error|failed|exception|cannot find|not found|TS\d{4}|ERR!|ENOENT|EACCES|npm ERR/i.test(output) &&
      !/\b(no|0|zero|without|free of)\s*(errors?|issues?|problems?)/i.test(output) &&
      !/success|passed|completed successfully/i.test(output);

    if (tool === 'Bash' && hasRealError) {
      // Extract error signature for better searching
      const errorSignatures = [];

      // TypeScript errors
      const tsMatch = output.match(/TS\d{4}/g);
      if (tsMatch) errorSignatures.push(...tsMatch);

      // Common error patterns
      const errorPhrases = output.match(/(?:error|failed|cannot|not found|undefined|null)[^.\n]{0,50}/gi);
      if (errorPhrases) errorSignatures.push(...errorPhrases.slice(0, 3));

      // Module/package errors
      const moduleMatch = output.match(/(?:module|package|dependency)\s+['"]?([^'">\s]+)/gi);
      if (moduleMatch) errorSignatures.push(...moduleMatch);

      state.errors.push({
        text: output.substring(0, 300),
        signatures: errorSignatures,
        time: Date.now()
      });
      state.errors = state.errors.slice(-5);
      saveState(state);

      const errorMemories = searchErrors(output, 3);

      let errorOutput = '\n<post-tool-use-hook>\n🔴 ERROR DETECTED\n\n';

      // FORCE explicit memory_recall for the error
      if (errorSignatures.length > 0) {
        errorOutput += '🧠 MANDATORY: Search memory for this error:\n';
        errorOutput += errorSignatures.slice(0, 3).map(sig =>
          `   → memory_recall("${sig.substring(0, 50).replace(/"/g, '')}")`
        ).join('\n');
        errorOutput += '\n\n';
      }

      if (errorMemories.length > 0) {
        updateAccessCount(errorMemories.map(m => m.id));
        errorOutput += '📚 FOUND RELEVANT ERROR SOLUTIONS:\n';
        for (const mem of errorMemories) {
          const content = (mem.decoded_cache || '').substring(0, 400);
          errorOutput += `\n[Memory #${mem.id} | importance:${mem.importance}]\n${content}\n`;
        }
      } else {
        errorOutput += '⚠️ No stored solution found. After fixing, store with:\n';
        errorOutput += `   memory_learn("${errorSignatures[0] || 'error'}: <your fix here>")\n`;
      }

      errorOutput += '</post-tool-use-hook>\n';
      console.log(errorOutput);
    }

    // Detect fix after error - remind to store
    // Check for success indicators OR absence of real errors
    const looksLikeSuccess = /success|passed|completed|built|done|ok|✓|✔/i.test(output) ||
      /\b(no|0|zero|without|free of)\s*(errors?|issues?|problems?)/i.test(output) ||
      !hasRealError;

    if (tool === 'Bash' && state.errors.length > 0 && looksLikeSuccess && !hasRealError) {
      const lastErr = state.errors[state.errors.length - 1];
      if (lastErr && Date.now() - lastErr.time < 300000) { // 5 min window
        state.errors.pop();
        saveState(state);

        const signatures = lastErr.signatures || [];
        console.log(`
<post-tool-use-hook>
✅ ERROR FIXED! MANDATORY: Store this fix now:

   memory_learn("${signatures[0] || 'Error'}: <describe your fix>")

Original error: "${lastErr.text.substring(0, 100)}..."

DO NOT SKIP THIS. Future you will thank present you.
</post-tool-use-hook>
`);
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
