/**
 * memory_learn - Automatically extract and store learnable content
 *
 * Claude calls this to analyze conversation content and automatically
 * store anything worth remembering.
 */

import type Database from 'better-sqlite3';
import { processForAutoLearning, mightBeLearnable } from '../auto/index.js';
import type { LearnableEvent } from '../types.js';

export interface LearnInput {
  content: string;
  context?: string;
}

export interface LearnResult {
  success: boolean;
  analyzed: boolean;
  memoriesCreated: number;
  events: Array<{
    type: string;
    content: string;
    confidence: number;
  }>;
  message: string;
}

/**
 * Analyze content and automatically store learnable items
 */
export async function learn(
  db: Database.Database,
  input: LearnInput,
  projectHash?: string
): Promise<LearnResult> {
  const fullContent = input.context
    ? `${input.context}\n\n${input.content}`
    : input.content;

  // Quick check if content might be learnable
  if (!mightBeLearnable(fullContent)) {
    return {
      success: true,
      analyzed: true,
      memoriesCreated: 0,
      events: [],
      message: 'Content analyzed but nothing worth storing was detected.',
    };
  }

  // Process for auto-learning
  const result = await processForAutoLearning(db, fullContent, projectHash);

  if (result.memoriesCreated === 0) {
    return {
      success: true,
      analyzed: true,
      memoriesCreated: 0,
      events: [],
      message: 'Content analyzed but confidence was too low to store.',
    };
  }

  return {
    success: true,
    analyzed: true,
    memoriesCreated: result.memoriesCreated,
    events: result.events.map(e => ({
      type: e.type,
      content: e.content,
      confidence: e.confidence,
    })),
    message: `Learned ${result.memoriesCreated} new item(s) from the content.`,
  };
}

/**
 * Tool definition for MCP
 */
export const learnToolDef = {
  name: 'memory_learn',
  description: `Automatically analyze content and store anything worth remembering. Call this after:
- Fixing a bug or error
- Receiving a correction from the user
- Discovering a project convention
- Making an architecture decision
- Any significant learning moment

The system will detect patterns, errors, solutions, and lessons automatically.`,
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to analyze for learnable items. Can be error messages, solutions, conversations, or any text.',
      },
      context: {
        type: 'string',
        description: 'Optional additional context to help understand the content.',
      },
    },
    required: ['content'],
  },
};
