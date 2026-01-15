#!/usr/bin/env node
/**
 * Continuous Memory Hook (v2.0)
 *
 * Makes memory usage continuous throughout long-running tasks:
 * - Checks memory before major operations (Edit, Write, Bash)
 * - Auto-stores learnings when patterns are detected
 * - Triggers periodic memory refresh during extended sessions
 *
 * This ensures Claude references and updates memory throughout
 * multi-hour sessions, not just at session start.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_DIR = path.join(os.homedir(), '.claude', 'memory');
const STATE_FILE = path.join(MEMORY_DIR, 'continuous-state.json');

/**
 * Load continuous state
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {
    lastMemoryCheck: 0,
    lastMemoryStore: 0,
    currentContext: [],
    pendingLearnings: [],
    errorsSeen: [],
    fixesApplied: [],
    decisionseMade: [],
    toolCallCount: 0,
  };
}

/**
 * Save state
 */
function saveState(state) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

/**
 * Detect if output contains an error
 */
function detectError(output) {
  const errorPatterns = [
    /error[:\s]/i,
    /exception/i,
    /failed/i,
    /cannot find/i,
    /not found/i,
    /undefined/i,
    /null pointer/i,
    /TS\d{4}/,
    /SyntaxError/,
    /TypeError/,
    /ReferenceError/,
  ];

  for (const pattern of errorPatterns) {
    const match = output.match(pattern);
    if (match) {
      // Extract error context (100 chars around match)
      const idx = output.indexOf(match[0]);
      const start = Math.max(0, idx - 50);
      const end = Math.min(output.length, idx + 100);
      return output.substring(start, end).trim();
    }
  }
  return null;
}

/**
 * Detect if this looks like a fix being applied
 */
function detectFix(toolName, input) {
  if (toolName === 'Edit' || toolName === 'Write') {
    // Check if the edit mentions fixing something
    const content = JSON.stringify(input).toLowerCase();
    if (/fix|resolve|correct|update|change|add import|remove|patch/i.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect architectural/design decisions
 */
function detectDecision(toolName, input, output) {
  const decisionPatterns = [
    /decided to/i,
    /choosing/i,
    /using .* instead/i,
    /approach.*:/i,
    /architecture/i,
    /design.*:/i,
    /pattern.*:/i,
    /will use/i,
    /going with/i,
  ];

  const text = JSON.stringify(input) + ' ' + (output || '');
  for (const pattern of decisionPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract learnable content from error+fix pair
 */
function extractLearning(error, fix) {
  return {
    type: 'error_fix',
    content: `Error: ${error}\nFix: ${fix}`,
    timestamp: Date.now(),
  };
}

/**
 * Generate memory recall suggestion
 */
function suggestRecall(context) {
  return {
    tool: 'memory_recall',
    args: {
      query: context.slice(0, 100),
      limit: 3,
    },
    reason: 'Check memory before proceeding',
  };
}

/**
 * Generate memory store suggestion
 */
function suggestStore(learning) {
  return {
    tool: 'memory_learn',
    args: {
      content: learning.content,
      context: learning.type,
    },
    reason: 'Store this learning for future reference',
  };
}

/**
 * Main hook handler
 */
function handleHook(hookType, data) {
  const state = loadState();
  const now = Date.now();

  switch (hookType) {
    case 'PreToolUse': {
      const toolName = data.tool || '';
      const toolInput = data.input || {};

      state.toolCallCount++;

      // For major operations, ALWAYS suggest checking memory first
      if (['Edit', 'Write', 'Bash'].includes(toolName)) {
        // Extract context from the operation
        let context = '';
        if (toolName === 'Edit' || toolName === 'Write') {
          context = toolInput.file_path || '';
          // Also include the content being edited for better context
          if (toolInput.old_string) {
            context += ' ' + toolInput.old_string.substring(0, 100);
          }
        } else if (toolName === 'Bash') {
          context = toolInput.command || '';
        }

        // Detect if this might be fixing an error we saw
        if (state.errorsSeen.length > 0 && detectFix(toolName, toolInput)) {
          const lastError = state.errorsSeen[state.errorsSeen.length - 1];
          state.fixesApplied.push({
            error: lastError,
            fix: JSON.stringify(toolInput).substring(0, 200),
            timestamp: now,
          });

          // Create a pending learning
          state.pendingLearnings.push(extractLearning(
            lastError.text,
            JSON.stringify(toolInput).substring(0, 200)
          ));
        }

        state.lastMemoryCheck = now;
        saveState(state);

        // Always suggest memory recall for Edit/Write/Bash
        return {
          success: true,
          message: `[Memory] Checking relevant memories for ${toolName}...`,
          suggestedAction: suggestRecall(context),
        };
      }

      return { success: true };
    }

    case 'PostToolUse': {
      const toolName = data.tool || '';
      const toolOutput = data.output || '';

      // Check for errors in Bash output
      if (toolName === 'Bash') {
        const error = detectError(toolOutput);
        if (error) {
          state.errorsSeen.push({
            text: error,
            timestamp: now,
          });
          // Keep only last 10 errors
          state.errorsSeen = state.errorsSeen.slice(-10);
          saveState(state);

          // Immediately suggest checking memory for this error
          return {
            success: true,
            message: '[Memory] Error detected! Checking memory for solutions...',
            suggestedAction: suggestRecall(error),
          };
        }

        // If no error and we had pending fixes, the fix worked! Store immediately.
        if (state.fixesApplied.length > 0 && !error) {
          const lastFix = state.fixesApplied[state.fixesApplied.length - 1];
          if (now - lastFix.timestamp < 120000) { // Within last 2 minutes
            // Store this confirmed fix immediately
            const learning = {
              type: 'confirmed_fix',
              content: `Error "${lastFix.error.text}" was fixed by: ${lastFix.fix}`,
              timestamp: now,
              confirmed: true,
            };

            // Clear the fix from pending
            state.fixesApplied = state.fixesApplied.filter(f => f !== lastFix);
            state.lastMemoryStore = now;
            saveState(state);

            return {
              success: true,
              message: '[Memory] Fix confirmed! Storing this solution...',
              suggestedAction: suggestStore(learning),
            };
          }
        }
      }

      // Detect decisions being made - store immediately
      if (detectDecision(toolName, data.input || {}, toolOutput)) {
        const learning = {
          type: 'decision',
          content: `Decision: ${toolOutput.substring(0, 300)}`,
          timestamp: now,
        };
        state.lastMemoryStore = now;
        saveState(state);

        return {
          success: true,
          message: '[Memory] Decision detected. Storing for future reference...',
          suggestedAction: suggestStore(learning),
        };
      }

      // If we have any pending learnings, store them immediately
      if (state.pendingLearnings.length > 0) {
        const learning = state.pendingLearnings.shift();
        state.lastMemoryStore = now;
        saveState(state);

        return {
          success: true,
          message: '[Memory] Storing learning...',
          suggestedAction: suggestStore(learning),
        };
      }

      return { success: true };
    }

    case 'Stop': {
      // On session end, store any remaining learnings
      if (state.pendingLearnings.length > 0) {
        // Combine all pending learnings
        const combined = state.pendingLearnings
          .map(l => `[${l.type}] ${l.content}`)
          .join('\n\n');

        state.pendingLearnings = [];
        saveState(state);

        return {
          success: true,
          message: '[Memory] Storing session learnings before exit...',
          suggestedAction: {
            tool: 'memory_learn',
            args: {
              content: combined,
              context: 'End of session learnings',
            },
          },
        };
      }

      return { success: true };
    }

    default:
      return { success: true };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const hookType = args[0] || 'PreToolUse';
  const data = args[1] ? JSON.parse(args[1]) : {};

  const result = handleHook(hookType, data);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { handleHook };
