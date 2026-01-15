/**
 * Auto-Learning Detector Tests
 */

import { describe, it, expect } from 'vitest';
import {
  detectLearnableEvents,
  detectExplicitRemember,
  detectCorrection,
  estimateImportance,
} from '../src/auto/detector.js';

describe('Auto-Learning Detector', () => {
  describe('detectLearnableEvents', () => {
    it('should detect error patterns', () => {
      const content = 'Error: Cannot find module "@types/node"';
      const events = detectLearnableEvents(content);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('error_fix');
    });

    it('should detect fix patterns', () => {
      const content = 'Fixed: Added missing dependency to package.json';
      const events = detectLearnableEvents(content);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('error_fix');
    });

    it('should detect lesson patterns', () => {
      const content = 'Remember: React hooks must be called at top level';
      const events = detectLearnableEvents(content);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('pattern');
    });

    it('should detect best practice patterns', () => {
      const content = 'Best practice: always use TypeScript strict mode';
      const events = detectLearnableEvents(content);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('pattern');
    });

    it('should detect decision patterns', () => {
      const content = 'Architecture decision: use PostgreSQL for persistence';
      const events = detectLearnableEvents(content);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('decision');
    });

    it('should boost confidence when error and solution are found together', () => {
      const content = 'Error: TS2304. Solution: add the missing import statement';
      const events = detectLearnableEvents(content);

      const highConfidenceEvents = events.filter(e => e.confidence >= 0.9);
      expect(highConfidenceEvents.length).toBeGreaterThan(0);
    });

    it('should deduplicate similar events', () => {
      const content = 'Error: module not found. Bug: module not found.';
      const events = detectLearnableEvents(content);

      // Should not have duplicate entries for the same content
      const uniqueContents = new Set(events.map(e => e.content.toLowerCase()));
      expect(uniqueContents.size).toBe(events.length);
    });

    it('should filter out low confidence events', () => {
      const content = 'Some random text without any patterns';
      const events = detectLearnableEvents(content);

      // All returned events should have confidence >= 0.7
      events.forEach(event => {
        expect(event.confidence).toBeGreaterThanOrEqual(0.7);
      });
    });
  });

  describe('detectExplicitRemember', () => {
    it('should detect "remember this" requests', () => {
      const content = 'Remember this: API rate limit is 100 requests per minute';
      const event = detectExplicitRemember(content);

      expect(event).not.toBeNull();
      expect(event?.type).toBe('explicit');
      expect(event?.confidence).toBe(1.0);
    });

    it('should detect "save that" requests', () => {
      const content = 'Save that: use port 3001 for the dev server';
      const event = detectExplicitRemember(content);

      expect(event).not.toBeNull();
      expect(event?.type).toBe('explicit');
    });

    it('should return null for non-explicit content', () => {
      const content = 'Just some regular conversation';
      const event = detectExplicitRemember(content);

      expect(event).toBeNull();
    });
  });

  describe('detectCorrection', () => {
    it('should detect "actually" corrections', () => {
      const content = 'Actually, the correct approach is to use async/await instead of callbacks';
      const event = detectCorrection(content);

      expect(event).not.toBeNull();
      expect(event?.type).toBe('correction');
    });

    it('should detect "that\'s wrong" corrections', () => {
      const content = 'That\'s wrong, the API endpoint should be /api/v2 not /api/v1';
      const event = detectCorrection(content);

      expect(event).not.toBeNull();
      expect(event?.type).toBe('correction');
    });

    it('should detect "no, it\'s" corrections', () => {
      const content = 'No, it\'s supposed to return a Promise not a callback';
      const event = detectCorrection(content);

      expect(event).not.toBeNull();
      expect(event?.type).toBe('correction');
    });

    it('should ignore short corrections', () => {
      const content = 'Actually, yes'; // Too short to be meaningful
      const event = detectCorrection(content);

      expect(event).toBeNull();
    });
  });

  describe('estimateImportance', () => {
    it('should assign high importance to explicit requests', () => {
      const event = {
        type: 'explicit' as const,
        content: 'some content',
        context: 'full context',
        confidence: 1.0,
      };

      const importance = estimateImportance(event);
      expect(importance).toBe(9);
    });

    it('should assign high importance to corrections', () => {
      const event = {
        type: 'correction' as const,
        content: 'some correction',
        context: 'full context',
        confidence: 0.85,
      };

      const importance = estimateImportance(event);
      expect(importance).toBe(8);
    });

    it('should boost importance for high confidence', () => {
      const highConfidence = {
        type: 'error_fix' as const,
        content: 'some fix',
        context: 'full context',
        confidence: 0.95,
      };

      const lowConfidence = {
        type: 'error_fix' as const,
        content: 'some fix',
        context: 'full context',
        confidence: 0.7,
      };

      expect(estimateImportance(highConfidence)).toBeGreaterThan(
        estimateImportance(lowConfidence)
      );
    });

    it('should boost importance for critical keywords', () => {
      const withKeyword = {
        type: 'pattern' as const,
        content: 'critical security vulnerability fix',
        context: 'full context',
        confidence: 0.8,
      };

      const withoutKeyword = {
        type: 'pattern' as const,
        content: 'regular code pattern',
        context: 'full context',
        confidence: 0.8,
      };

      expect(estimateImportance(withKeyword)).toBeGreaterThan(
        estimateImportance(withoutKeyword)
      );
    });

    it('should cap importance at 9', () => {
      const maxEvent = {
        type: 'explicit' as const,
        content: 'critical security production bug crash',
        context: 'full context',
        confidence: 1.0,
      };

      const importance = estimateImportance(maxEvent);
      expect(importance).toBeLessThanOrEqual(9);
    });
  });
});
