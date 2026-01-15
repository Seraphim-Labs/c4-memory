#!/usr/bin/env node
/**
 * ENFORCED Memory Hook (v2.0)
 *
 * This hook ENFORCES memory usage - not suggestions, REQUIREMENTS.
 * Memory operations are injected as system instructions that Claude MUST follow.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_DIR = path.join(os.homedir(), '.claude', 'memory');
const STATE_FILE = path.join(MEMORY_DIR, 'enforced-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {
    errorsSeen: [],
    fixesApplied: [],
    lastRecallTopic: '',
    toolCallCount: 0,
  };
}

function saveState(state) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

function detectError(output) {
  const patterns = [
    /error[:\s]/i, /exception/i, /failed/i, /cannot find/i,
    /not found/i, /undefined/i, /TS\d{4}/, /SyntaxError/,
    /TypeError/, /ReferenceError/, /ENOENT/, /EACCES/,
  ];
  for (const p of patterns) {
    const match = output.match(p);
    if (match) {
      const idx = output.indexOf(match[0]);
      return output.substring(Math.max(0, idx - 30), Math.min(output.length, idx + 120)).trim();
    }
  }
  return null;
}

function extractKeywords(text) {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
    'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'where', 'when', 'why',
    'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'and', 'but', 'if', 'or', 'because', 'as', 'of', 'at', 'by', 'for', 'with',
    'about', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
    'please', 'help', 'want', 'need', 'make', 'get', 'let', 'me', 'my']);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 8).join(' ');
}

function handleHook(hookType, data) {
  const state = loadState();
  const now = Date.now();

  switch (hookType) {
    case 'SessionStart': {
      // Reset state
      saveState({
        errorsSeen: [],
        fixesApplied: [],
        lastRecallTopic: '',
        toolCallCount: 0,
      });

      // ENFORCE memory recall at session start
      return {
        success: true,
        suppressOutput: false,
        message: `MANDATORY: Before starting any work, you MUST call memory_refresh with topic "project conventions errors patterns" to load relevant context. Do this NOW before responding to the user.`,
      };
    }

    case 'UserPromptSubmit': {
      const userMessage = data.message || '';
      if (userMessage.length < 10) return { success: true };

      const keywords = extractKeywords(userMessage);

      // Don't repeat the same recall
      if (keywords === state.lastRecallTopic) {
        return { success: true };
      }

      state.lastRecallTopic = keywords;
      saveState(state);

      // ENFORCE memory recall for user's topic
      return {
        success: true,
        suppressOutput: false,
        message: `MANDATORY: Before responding, you MUST call memory_recall with query "${keywords}" to check for relevant stored knowledge. Do this FIRST.`,
      };
    }

    case 'PreToolUse': {
      const toolName = data.tool || '';
      const toolInput = data.input || {};

      if (!['Edit', 'Write', 'Bash'].includes(toolName)) {
        return { success: true };
      }

      state.toolCallCount++;

      // Extract context
      let context = '';
      if (toolName === 'Edit' || toolName === 'Write') {
        const filePath = toolInput.file_path || '';
        const fileName = filePath.split(/[/\\]/).pop() || '';
        context = fileName;
        if (toolInput.old_string) {
          context += ' ' + toolInput.old_string.substring(0, 50);
        }
      } else if (toolName === 'Bash') {
        context = (toolInput.command || '').substring(0, 80);
      }

      const keywords = extractKeywords(context);

      // ENFORCE memory check before operations
      if (keywords && keywords !== state.lastRecallTopic) {
        state.lastRecallTopic = keywords;
        saveState(state);

        return {
          success: true,
          suppressOutput: false,
          message: `MANDATORY: Before this ${toolName} operation, call memory_recall with query "${keywords}" to check for relevant patterns or previous solutions.`,
        };
      }

      return { success: true };
    }

    case 'PostToolUse': {
      const toolName = data.tool || '';
      const toolOutput = data.output || '';

      // Detect errors - ENFORCE recall for solutions
      if (toolName === 'Bash') {
        const error = detectError(toolOutput);
        if (error) {
          state.errorsSeen.push({ text: error, timestamp: now });
          state.errorsSeen = state.errorsSeen.slice(-10);
          saveState(state);

          const errorKeywords = extractKeywords(error);

          return {
            success: true,
            suppressOutput: false,
            message: `MANDATORY: Error detected! You MUST call memory_recall with query "${errorKeywords}" to check for known solutions. Then call memory_learn to store any fix you find.`,
          };
        }

        // Success after error - ENFORCE storing the fix
        if (state.errorsSeen.length > 0) {
          const lastError = state.errorsSeen[state.errorsSeen.length - 1];
          if (now - lastError.timestamp < 180000) { // Within 3 minutes
            state.errorsSeen = state.errorsSeen.filter(e => e !== lastError);
            saveState(state);

            return {
              success: true,
              suppressOutput: false,
              message: `MANDATORY: The previous error "${lastError.text.substring(0, 60)}..." was just fixed. You MUST call memory_learn with content describing this error and its fix so it's remembered for next time.`,
            };
          }
        }
      }

      return { success: true };
    }

    case 'Stop': {
      // ENFORCE storing any learnings before exit
      if (state.errorsSeen.length > 0 || state.toolCallCount > 10) {
        return {
          success: true,
          suppressOutput: false,
          message: `MANDATORY: Before ending this session, call memory_learn with a summary of key learnings, decisions made, or patterns discovered during this session.`,
        };
      }

      return { success: true };
    }

    default:
      return { success: true };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hookType = args[0] || 'SessionStart';
  const data = args[1] ? JSON.parse(args[1]) : {};
  const result = handleHook(hookType, data);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { handleHook };
