#!/usr/bin/env node
/**
 * Memory Injection Hook
 *
 * Automatically injects relevant memories into Claude's context.
 * Uses the v2.0 multi-factor scoring (usefulness + importance + recency).
 *
 * Triggers:
 * - SessionStart: Recalls project-relevant memories
 * - UserPromptSubmit: Recalls memories relevant to the user's message
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Paths
const MEMORY_DIR = path.join(os.homedir(), '.claude', 'memory');
const STATE_FILE = path.join(MEMORY_DIR, 'session-state.json');

/**
 * Load session state
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore errors
  }
  return {
    retrievedMemoryIds: [],
    lastTopics: [],
    sessionStart: Date.now(),
  };
}

/**
 * Save session state
 */
function saveState(state) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Extract keywords from text for memory recall
 */
function extractKeywords(text) {
  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
    'who', 'whom', 'where', 'when', 'why', 'how', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
    'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of',
    'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
    'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
    'how', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now',
    'please', 'help', 'want', 'need', 'make', 'get', 'let', 'me', 'my',
  ]);

  // Extract words
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Also extract potential technical terms (camelCase, snake_case, etc.)
  const technicalTerms = text.match(/[A-Z][a-z]+(?=[A-Z])|[a-z]+(?=[A-Z])|[a-zA-Z_][a-zA-Z0-9_]+/g) || [];

  return [...new Set([...words, ...technicalTerms.map(t => t.toLowerCase())])].slice(0, 10);
}

/**
 * Detect if this is an error-related message
 */
function isErrorRelated(text) {
  const errorPatterns = [
    /error/i, /bug/i, /fix/i, /issue/i, /problem/i, /broken/i,
    /doesn't work/i, /not working/i, /failed/i, /crash/i,
    /TS\d{4}/, /exception/i, /undefined/i, /null/i,
  ];
  return errorPatterns.some(p => p.test(text));
}

/**
 * Generate memory recall suggestion
 */
function generateRecallSuggestion(keywords, context) {
  if (keywords.length === 0) return null;

  const query = keywords.slice(0, 5).join(' ');

  return {
    tool: 'memory_recall',
    args: {
      query: query,
      limit: 5,
      scope: 'both',
    },
    reason: context,
  };
}

/**
 * Main hook handler
 */
function handleHook(hookType, data) {
  const state = loadState();

  switch (hookType) {
    case 'SessionStart':
      // Reset state for new session
      const newState = {
        retrievedMemoryIds: [],
        lastTopics: [],
        sessionStart: Date.now(),
      };
      saveState(newState);

      // Suggest recalling project-relevant memories
      return {
        success: true,
        message: 'Memory system active. Checking for relevant memories...',
        suggestedAction: {
          tool: 'memory_refresh',
          args: {
            topic: 'project conventions patterns',
            depth: 'shallow',
          },
          reason: 'Load project context at session start',
        },
      };

    case 'UserPromptSubmit':
      const userMessage = data.message || '';

      // Skip very short messages
      if (userMessage.length < 10) {
        return { success: true };
      }

      // Extract keywords
      const keywords = extractKeywords(userMessage);

      // Check if this is error-related (higher priority)
      if (isErrorRelated(userMessage)) {
        // For errors, suggest specific error recall
        const errorKeywords = keywords.filter(k =>
          /error|bug|fix|issue|ts\d+/i.test(k) ||
          userMessage.toLowerCase().includes(k)
        );

        if (errorKeywords.length > 0) {
          state.lastTopics = errorKeywords;
          saveState(state);

          return {
            success: true,
            message: 'Detected error context. Checking memory for solutions...',
            suggestedAction: generateRecallSuggestion(
              errorKeywords,
              'Recall error solutions'
            ),
          };
        }
      }

      // For general messages, check if topics have changed
      const newTopics = keywords.filter(k => !state.lastTopics.includes(k));

      if (newTopics.length >= 2) {
        state.lastTopics = keywords;
        saveState(state);

        return {
          success: true,
          message: 'New topic detected. Checking relevant memories...',
          suggestedAction: generateRecallSuggestion(
            keywords,
            'Recall relevant context'
          ),
        };
      }

      return { success: true };

    case 'Stop':
      // Session ending - no action needed
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

module.exports = { handleHook, extractKeywords };
