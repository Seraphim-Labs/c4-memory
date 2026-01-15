#!/usr/bin/env node
/**
 * Memory Auto-Feedback Hook
 *
 * Automatically tracks memory usage and provides feedback based on task outcomes.
 * This hook detects when memories helped or didn't help and updates their scores.
 *
 * How it works:
 * 1. Tracks memory IDs retrieved during the session (from tool outputs)
 * 2. Detects success patterns (errors fixed, tasks completed)
 * 3. Detects failure patterns (same error recurring, user corrections)
 * 4. Automatically calls memory_feedback with appropriate feedback type
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Session state file to track retrieved memories
const STATE_DIR = path.join(os.homedir(), '.claude', 'memory');
const STATE_FILE = path.join(STATE_DIR, 'session-state.json');

/**
 * Load session state
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore errors, return default state
  }
  return {
    retrievedMemoryIds: [],
    lastErrors: [],
    sessionStart: Date.now(),
  };
}

/**
 * Save session state
 */
function saveState(state) {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save session state:', e.message);
  }
}

/**
 * Extract memory IDs from tool output (recall, refresh results)
 */
function extractMemoryIds(toolOutput) {
  const ids = [];

  // Look for memory ID patterns in the output
  // Pattern 1: "id": 123
  const idMatches = toolOutput.match(/"id"\s*:\s*(\d+)/g) || [];
  for (const match of idMatches) {
    const id = parseInt(match.match(/\d+/)[0]);
    if (id > 0) ids.push(id);
  }

  // Pattern 2: Memory #123
  const hashMatches = toolOutput.match(/Memory #(\d+)/gi) || [];
  for (const match of hashMatches) {
    const id = parseInt(match.match(/\d+/)[0]);
    if (id > 0) ids.push(id);
  }

  return [...new Set(ids)]; // Dedupe
}

/**
 * Detect if this looks like an error message
 */
function detectError(text) {
  const errorPatterns = [
    /error[:\s]/i,
    /exception/i,
    /failed/i,
    /cannot find/i,
    /undefined is not/i,
    /null pointer/i,
    /type.*mismatch/i,
    /TS\d{4}/,  // TypeScript errors
    /SyntaxError/,
    /ReferenceError/,
    /TypeError/,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect success patterns
 */
function detectSuccess(text) {
  const successPatterns = [
    /fixed/i,
    /resolved/i,
    /working now/i,
    /tests pass/i,
    /build succeed/i,
    /completed successfully/i,
    /that worked/i,
    /perfect/i,
    /thanks.*helped/i,
  ];

  for (const pattern of successPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect user corrections (memories were wrong)
 */
function detectCorrection(text) {
  const correctionPatterns = [
    /actually.*should/i,
    /that's (wrong|incorrect|outdated)/i,
    /no,?\s*(it's|that's|use)/i,
    /don't use that/i,
    /that's old/i,
    /deprecated/i,
  ];

  for (const pattern of correctionPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate feedback command for Claude to execute
 */
function generateFeedbackPrompt(memoryIds, feedbackType, context) {
  if (memoryIds.length === 0) return null;

  return {
    tool: 'memory_feedback',
    args: {
      memoryIds: memoryIds,
      feedback: feedbackType,
      context: context,
    },
  };
}

/**
 * Main hook handler
 */
function handleHook(hookType, data) {
  const state = loadState();

  switch (hookType) {
    case 'SessionStart':
      // Reset session state
      saveState({
        retrievedMemoryIds: [],
        lastErrors: [],
        sessionStart: Date.now(),
      });
      return { success: true };

    case 'PostToolUse':
      // Track memory IDs from recall/refresh results
      if (data.tool === 'memory_recall' || data.tool === 'memory_refresh') {
        const ids = extractMemoryIds(data.output || '');
        if (ids.length > 0) {
          state.retrievedMemoryIds = [...new Set([...state.retrievedMemoryIds, ...ids])];
          saveState(state);
        }
      }

      // Check for error patterns in Bash output
      if (data.tool === 'Bash' && data.output) {
        if (detectError(data.output)) {
          state.lastErrors.push({
            text: data.output.substring(0, 200),
            timestamp: Date.now(),
          });
          // Keep only last 5 errors
          state.lastErrors = state.lastErrors.slice(-5);
          saveState(state);
        }
      }
      return { success: true };

    case 'UserPromptSubmit':
      const userMessage = data.message || '';

      // Check for success signals
      if (detectSuccess(userMessage) && state.retrievedMemoryIds.length > 0) {
        return {
          success: true,
          message: `Detected success! Consider marking retrieved memories as helpful.`,
          suggestedAction: generateFeedbackPrompt(
            state.retrievedMemoryIds,
            'helpful',
            'Task completed successfully'
          ),
        };
      }

      // Check for correction signals
      if (detectCorrection(userMessage) && state.retrievedMemoryIds.length > 0) {
        return {
          success: true,
          message: `Detected correction. Consider marking memories as incorrect.`,
          suggestedAction: generateFeedbackPrompt(
            state.retrievedMemoryIds.slice(-3), // Last 3 memories
            'incorrect',
            'User corrected the information'
          ),
        };
      }

      return { success: true };

    case 'Stop':
      // On session end, if we had retrieved memories and no errors, mark as helpful
      const sessionDuration = Date.now() - (state.sessionStart || 0);
      const hadMemories = (state.retrievedMemoryIds || []).length > 0;
      const recentErrors = (state.lastErrors || []).filter(
        e => Date.now() - e.timestamp < 60000 // Errors in last minute
      );

      if (hadMemories && recentErrors.length === 0 && sessionDuration > 30000) {
        return {
          success: true,
          message: 'Session ended successfully with retrieved memories.',
          suggestedAction: generateFeedbackPrompt(
            state.retrievedMemoryIds,
            'helpful',
            'Session completed without errors'
          ),
        };
      }
      return { success: true };

    default:
      return { success: true };
  }
}

// CLI interface for testing
if (require.main === module) {
  const args = process.argv.slice(2);
  const hookType = args[0] || 'SessionStart';
  const data = args[1] ? JSON.parse(args[1]) : {};

  const result = handleHook(hookType, data);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { handleHook, loadState, saveState };
