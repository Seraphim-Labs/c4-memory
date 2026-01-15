/**
 * Auto-Learning Triggers
 *
 * Handles automatic memory creation based on detected events.
 */

import type Database from 'better-sqlite3';
import type { LearnableEvent } from '../types.js';
import { remember } from '../tools/remember.js';
import { logAutoLearn } from '../db/operations.js';
import { getConfig } from '../config/index.js';
import {
  detectLearnableEvents,
  detectExplicitRemember,
  detectCorrection,
  estimateImportance,
} from './detector.js';

export interface AutoLearnResult {
  triggered: boolean;
  memoriesCreated: number;
  events: LearnableEvent[];
}

/**
 * Process content for auto-learning
 * Called after significant interactions to extract and store learnable content
 */
export async function processForAutoLearning(
  db: Database.Database,
  content: string,
  projectHash?: string
): Promise<AutoLearnResult> {
  const config = getConfig();

  // Check if auto-learning is enabled
  if (!config.auto_learn) {
    return {
      triggered: false,
      memoriesCreated: 0,
      events: [],
    };
  }

  const events: LearnableEvent[] = [];
  let memoriesCreated = 0;

  // Check for explicit remember requests (highest priority)
  const explicit = detectExplicitRemember(content);
  if (explicit) {
    events.push(explicit);
  }

  // Check for corrections
  const correction = detectCorrection(content);
  if (correction) {
    events.push(correction);
  }

  // Detect other learnable events
  const detected = detectLearnableEvents(content);
  events.push(...detected);

  // Filter to unique, high-confidence events
  const uniqueEvents = deduplicateByContent(events);

  // Store each event as a memory
  for (const event of uniqueEvents) {
    try {
      const importance = estimateImportance(event);
      const memoryType = mapEventTypeToMemoryType(event.type);

      const result = await remember(
        db,
        {
          content: event.content,
          type: memoryType,
          importance,
          scope: event.type === 'explicit' ? 'global' : 'project',
        },
        projectHash
      );

      if (result.success && result.memoryId) {
        memoriesCreated++;

        // Log the auto-learn event
        logAutoLearn(db, event.type, event.context, result.memoryId);
      }
    } catch (error) {
      console.error('Auto-learn failed for event:', error);
    }
  }

  return {
    triggered: events.length > 0,
    memoriesCreated,
    events: uniqueEvents,
  };
}

/**
 * Map event types to memory types
 */
function mapEventTypeToMemoryType(
  eventType: LearnableEvent['type']
): 'lesson' | 'error' | 'pattern' | 'fact' {
  switch (eventType) {
    case 'error_fix':
      return 'error';
    case 'correction':
      return 'lesson';
    case 'pattern':
      return 'pattern';
    case 'decision':
      return 'lesson';
    case 'explicit':
      return 'fact';
    default:
      return 'fact';
  }
}

/**
 * Deduplicate events by content similarity
 */
function deduplicateByContent(events: LearnableEvent[]): LearnableEvent[] {
  const seen = new Map<string, LearnableEvent>();

  for (const event of events) {
    const key = event.content.toLowerCase().trim().substring(0, 100);

    const existing = seen.get(key);
    if (!existing || event.confidence > existing.confidence) {
      seen.set(key, event);
    }
  }

  return Array.from(seen.values());
}

/**
 * Analyze a conversation turn for auto-learning
 * This is a convenience function that combines detection and processing
 */
export async function analyzeAndLearn(
  db: Database.Database,
  userMessage: string,
  assistantMessage: string,
  projectHash?: string
): Promise<AutoLearnResult> {
  // Combine both messages for analysis
  const combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;

  return processForAutoLearning(db, combined, projectHash);
}

/**
 * Check if content likely contains something worth learning
 * Quick check before doing full analysis
 */
export function mightBeLearnable(content: string): boolean {
  const quickPatterns = [
    /error|exception|failed|fix|bug|issue/i,
    /solution|resolved|the fix/i,
    /lesson|remember|important|note/i,
    /pattern|best practice|convention/i,
    /decision|chose|architecture/i,
    /wrong|incorrect|actually|correction/i,
  ];

  for (const pattern of quickPatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}
