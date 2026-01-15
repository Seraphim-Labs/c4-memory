/**
 * Auto-Learning Detector
 *
 * Detects learnable events from context and conversation.
 * This module provides heuristics to identify what's worth remembering.
 */

import type { LearnableEvent } from '../types.js';

// Patterns for detecting different types of learnable content
const ERROR_PATTERNS = [
  /error:\s*(.+)/i,
  /exception:\s*(.+)/i,
  /failed:\s*(.+)/i,
  /fix(?:ed)?:\s*(.+)/i,
  /bug:\s*(.+)/i,
  /issue:\s*(.+)/i,
];

const SOLUTION_PATTERNS = [
  /solution:\s*(.+)/i,
  /fix(?:ed)?\s+(?:by|with):\s*(.+)/i,
  /resolved\s+by:\s*(.+)/i,
  /the\s+(?:solution|fix)\s+(?:is|was):\s*(.+)/i,
];

const LESSON_PATTERNS = [
  /lesson(?:\s+learned)?:\s*(.+)/i,
  /remember(?:\s+that)?:\s*(.+)/i,
  /important:\s*(.+)/i,
  /note:\s*(.+)/i,
  /(?:always|never)\s+(.+)/i,
];

const PATTERN_PATTERNS = [
  /pattern:\s*(.+)/i,
  /best\s+practice:\s*(.+)/i,
  /convention:\s*(.+)/i,
  /standard:\s*(.+)/i,
  /(?:use|prefer)\s+(.+)\s+(?:instead|over)/i,
];

const DECISION_PATTERNS = [
  /decision:\s*(.+)/i,
  /decided\s+to:\s*(.+)/i,
  /chose\s+(.+)\s+because/i,
  /architecture:\s*(.+)/i,
  /design:\s*(.+)/i,
];

/**
 * Detect learnable events from text content
 */
export function detectLearnableEvents(content: string): LearnableEvent[] {
  const events: LearnableEvent[] = [];

  // Check for error patterns
  for (const pattern of ERROR_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      events.push({
        type: 'error_fix',
        content: match[1].trim(),
        context: content,
        confidence: 0.7,
      });
    }
  }

  // Check for solution patterns
  for (const pattern of SOLUTION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      // Boost confidence if we also found an error
      const hasError = events.some(e => e.type === 'error_fix');
      events.push({
        type: 'error_fix',
        content: match[1].trim(),
        context: content,
        confidence: hasError ? 0.9 : 0.75,
      });
    }
  }

  // Check for lesson patterns
  for (const pattern of LESSON_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      events.push({
        type: 'pattern',
        content: match[1].trim(),
        context: content,
        confidence: 0.8,
      });
    }
  }

  // Check for pattern patterns
  for (const pattern of PATTERN_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      events.push({
        type: 'pattern',
        content: match[1].trim(),
        context: content,
        confidence: 0.75,
      });
    }
  }

  // Check for decision patterns
  for (const pattern of DECISION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      events.push({
        type: 'decision',
        content: match[1].trim(),
        context: content,
        confidence: 0.8,
      });
    }
  }

  // Deduplicate and filter by confidence
  return deduplicateEvents(events).filter(e => e.confidence >= 0.7);
}

/**
 * Detect if content contains an explicit "remember this" request
 */
export function detectExplicitRemember(content: string): LearnableEvent | null {
  const patterns = [
    /remember\s+(?:this|that):\s*(.+)/i,
    /save\s+(?:this|that):\s*(.+)/i,
    /store\s+(?:this|that):\s*(.+)/i,
    /note\s+(?:this|that):\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return {
        type: 'explicit',
        content: match[1].trim(),
        context: content,
        confidence: 1.0,
      };
    }
  }

  return null;
}

/**
 * Detect corrections (when Claude is told something is wrong)
 */
export function detectCorrection(content: string): LearnableEvent | null {
  const patterns = [
    /(?:that'?s?\s+)?(?:wrong|incorrect|not\s+(?:right|correct))[\.,]?\s*(.+)/i,
    /actually[\.,]?\s*(.+)/i,
    /no[\.,]\s+(?:it'?s?\s+)?(.+)/i,
    /correction:\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1].length > 10) {
      return {
        type: 'correction',
        content: match[1].trim(),
        context: content,
        confidence: 0.85,
      };
    }
  }

  return null;
}

/**
 * Remove duplicate events based on content similarity
 */
function deduplicateEvents(events: LearnableEvent[]): LearnableEvent[] {
  const seen = new Set<string>();
  const result: LearnableEvent[] = [];

  for (const event of events) {
    // Normalize content for comparison
    const normalized = event.content.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(event);
    } else {
      // If we've seen similar content, keep the one with higher confidence
      const existingIndex = result.findIndex(
        e => e.content.toLowerCase().replace(/\s+/g, ' ').trim() === normalized
      );
      if (existingIndex >= 0 && event.confidence > result[existingIndex].confidence) {
        result[existingIndex] = event;
      }
    }
  }

  return result;
}

/**
 * Estimate importance based on content analysis
 */
export function estimateImportance(event: LearnableEvent): number {
  let importance = 5; // Default

  // Explicit requests are high importance
  if (event.type === 'explicit') {
    importance = 9;
  }

  // Corrections are high importance
  if (event.type === 'correction') {
    importance = 8;
  }

  // Error fixes are medium-high importance
  if (event.type === 'error_fix') {
    importance = 7;
  }

  // Decisions are medium-high importance
  if (event.type === 'decision') {
    importance = 7;
  }

  // Boost importance based on confidence
  if (event.confidence > 0.9) {
    importance = Math.min(9, importance + 1);
  }

  // Keywords that suggest high importance
  const highImportanceKeywords = [
    'critical', 'important', 'always', 'never', 'must', 'security',
    'performance', 'bug', 'crash', 'data loss', 'production',
  ];

  const contentLower = event.content.toLowerCase();
  for (const keyword of highImportanceKeywords) {
    if (contentLower.includes(keyword)) {
      importance = Math.min(9, importance + 1);
      break;
    }
  }

  return importance;
}
