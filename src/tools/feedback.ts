/**
 * Memory Feedback Tool
 *
 * Mark memories as helpful or unhelpful to improve usefulness scores.
 * This is a core component of the MemEvolve evolution system.
 */

import type { FeedbackInput, FeedbackType } from '../types.js';
import { openGlobalDb } from '../db/schema.js';
import { recordFeedback, getMemory, getMemoryFeedback } from '../db/operations.js';

/**
 * MCP Tool Definition for memory_feedback
 */
export const feedbackToolDef = {
  name: 'memory_feedback',
  description: `Mark memories as helpful or unhelpful to improve the evolution system.
Call this after memories were used to indicate if they helped or not.
This trains the system to return better memories over time.`,
  inputSchema: {
    type: 'object',
    properties: {
      memoryIds: {
        type: 'array',
        items: { type: 'number' },
        description: 'IDs of memories to provide feedback for',
      },
      feedback: {
        type: 'string',
        enum: ['helpful', 'unhelpful', 'outdated', 'incorrect'],
        description: 'Type of feedback: helpful (memory was useful), unhelpful (not useful), outdated (info is old), incorrect (info is wrong)',
      },
      context: {
        type: 'string',
        description: 'Optional context about the task when feedback was given',
      },
    },
    required: ['memoryIds', 'feedback'],
  },
};

export interface FeedbackResult {
  success: boolean;
  feedbackRecorded: number;
  memoriesUpdated: Array<{
    id: number;
    newUsefulnessScore: number;
    timesHelpful: number;
    timesUnhelpful: number;
  }>;
  warnings?: string[];
}

/**
 * Record feedback for memories
 */
export async function feedback(input: FeedbackInput): Promise<FeedbackResult> {
  const warnings: string[] = [];
  const memoriesUpdated: FeedbackResult['memoriesUpdated'] = [];

  if (!input.memoryIds || input.memoryIds.length === 0) {
    return {
      success: false,
      feedbackRecorded: 0,
      memoriesUpdated: [],
      warnings: ['No memory IDs provided. Specify memoryIds array.'],
    };
  }

  if (!input.feedback) {
    return {
      success: false,
      feedbackRecorded: 0,
      memoriesUpdated: [],
      warnings: ['No feedback type provided. Use "helpful", "unhelpful", "outdated", or "incorrect".'],
    };
  }

  const db = openGlobalDb();

  try {
    for (const memoryId of input.memoryIds) {
      const memory = getMemory(db, memoryId);

      if (!memory) {
        warnings.push(`Memory #${memoryId} not found`);
        continue;
      }

      // Record the feedback
      recordFeedback(db, memoryId, input.feedback, input.context);

      // Get updated memory stats
      const updatedMemory = getMemory(db, memoryId);
      if (updatedMemory) {
        memoriesUpdated.push({
          id: memoryId,
          newUsefulnessScore: updatedMemory.usefulnessScore,
          timesHelpful: updatedMemory.timesHelpful,
          timesUnhelpful: updatedMemory.timesUnhelpful,
        });
      }
    }

    return {
      success: true,
      feedbackRecorded: memoriesUpdated.length,
      memoriesUpdated,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } finally {
    db.close();
  }
}

/**
 * Get feedback history for a specific memory
 */
export async function getFeedbackHistory(memoryId: number, limit: number = 20): Promise<{
  success: boolean;
  memoryId: number;
  feedback: Array<{
    type: FeedbackType;
    context?: string;
    timestamp: number;
  }>;
  summary: {
    totalHelpful: number;
    totalUnhelpful: number;
    totalOutdated: number;
    totalIncorrect: number;
  };
}> {
  const db = openGlobalDb();

  try {
    const feedbackList = getMemoryFeedback(db, memoryId, limit);

    const summary = {
      totalHelpful: 0,
      totalUnhelpful: 0,
      totalOutdated: 0,
      totalIncorrect: 0,
    };

    for (const fb of feedbackList) {
      if (fb.feedbackType === 'helpful') summary.totalHelpful++;
      else if (fb.feedbackType === 'unhelpful') summary.totalUnhelpful++;
      else if (fb.feedbackType === 'outdated') summary.totalOutdated++;
      else if (fb.feedbackType === 'incorrect') summary.totalIncorrect++;
    }

    return {
      success: true,
      memoryId,
      feedback: feedbackList.map(fb => ({
        type: fb.feedbackType,
        context: fb.context,
        timestamp: fb.timestamp,
      })),
      summary,
    };
  } finally {
    db.close();
  }
}

/**
 * Mark last retrieved memories as helpful (convenience function)
 * This would be called by hooks after successful task completion
 */
export async function markRetrievedAsHelpful(
  memoryIds: number[],
  context: string
): Promise<FeedbackResult> {
  return feedback({
    memoryIds,
    feedback: 'helpful',
    context,
  });
}

/**
 * Mark memories as unhelpful (convenience function)
 */
export async function markAsUnhelpful(
  memoryIds: number[],
  context: string
): Promise<FeedbackResult> {
  return feedback({
    memoryIds,
    feedback: 'unhelpful',
    context,
  });
}
