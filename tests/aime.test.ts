/**
 * AIME Encoder/Decoder Tests
 */

import { describe, it, expect } from 'vitest';
import { encode, quickEncode, compressionRatio } from '../src/aime/encoder.js';
import { decode } from '../src/aime/decoder.js';
import { STRUCTURAL, AIME_VERSION } from '../src/aime/symbols.js';

describe('AIME Encoder', () => {
  describe('encode', () => {
    it('should encode an empty input with just frame markers', () => {
      const result = encode({});
      expect(result).toContain(STRUCTURAL.FRAME_START);
      expect(result).toContain(STRUCTURAL.FRAME_END);
      expect(result).toContain(AIME_VERSION);
    });

    it('should encode entities correctly', () => {
      const result = encode({
        entities: [
          { type: 'FUNCTION', name: 'myFunction' },
        ],
      });

      expect(result).toContain('Ξf'); // FUNCTION entity marker
      expect(result).toContain('"myFunction"');
    });

    it('should encode entities with attributes', () => {
      const result = encode({
        entities: [
          {
            type: 'CLASS',
            name: 'MyClass',
            attributes: { extends: 'BaseClass' },
          },
        ],
      });

      expect(result).toContain('Ξc'); // CLASS entity marker
      expect(result).toContain('"MyClass"');
      expect(result).toContain('extends=');
    });

    it('should encode relations correctly', () => {
      const result = encode({
        relations: [
          {
            subject: 'ComponentA',
            relation: 'DEPENDS_ON',
            object: 'ComponentB',
          },
        ],
      });

      expect(result).toContain('Ψ→'); // DEPENDS_ON relation marker
      expect(result).toContain('ComponentA');
      expect(result).toContain('ComponentB');
    });

    it('should encode lessons correctly', () => {
      const result = encode({
        lessons: [
          {
            context: ['TypeScript', 'async'],
            insight: 'Always await async functions',
          },
        ],
      });

      expect(result).toContain('§L'); // LESSON record marker
      expect(result).toContain('→'); // SEQUENCE marker
    });

    it('should encode errors correctly', () => {
      const result = encode({
        errors: [
          {
            category: 'TYPE',
            signature: 'TS2304',
            language: 'TYPESCRIPT',
            solution: ['Add missing import'],
          },
        ],
      });

      expect(result).toContain('§X'); // ERROR record marker
      expect(result).toContain('Εtyp'); // TYPE error marker
      expect(result).toContain('λts'); // TYPESCRIPT language marker
    });
  });

  describe('quickEncode', () => {
    it('should encode lesson type content', () => {
      const result = quickEncode('Always use strict mode', 'lesson', 7);
      expect(result).toContain('§L'); // LESSON record marker
      expect(result).toContain('Ω✱'); // CRITICAL modifier (importance >= 7)
    });

    it('should encode error type content', () => {
      const result = quickEncode('Cannot find module X', 'error');
      expect(result).toContain('§X'); // ERROR record marker
    });

    it('should encode pattern type content', () => {
      const result = quickEncode('Use singleton for database connections', 'pattern');
      expect(result).toContain('§E'); // ENTITY record marker
      expect(result).toContain('Ξw'); // WORKFLOW entity marker
    });

    it('should encode fact type content', () => {
      const result = quickEncode('Project uses React 18', 'fact');
      expect(result).toContain('§E'); // ENTITY record marker
    });

    it('should apply correct importance modifiers', () => {
      const low = quickEncode('minor note', 'fact', 2);
      const high = quickEncode('critical info', 'fact', 8);

      expect(low).toContain('Ω✧'); // MINOR modifier
      expect(high).toContain('Ω✱'); // CRITICAL modifier
    });
  });

  describe('compressionRatio', () => {
    it('should calculate compression ratio correctly', () => {
      const original = 'This is a long text that should be compressed significantly';
      const encoded = quickEncode(original, 'fact');

      const ratio = compressionRatio(original, encoded);
      expect(ratio).toBeGreaterThan(0);
    });
  });
});

describe('AIME Decoder', () => {
  describe('decode', () => {
    it('should decode AIME back to readable format', () => {
      const encoded = quickEncode('Test content', 'lesson', 5);
      const decoded = decode(encoded);

      expect(typeof decoded).toBe('string');
      expect(decoded.length).toBeGreaterThan(0);
    });

    it('should preserve meaning through encode/decode cycle', () => {
      const original = 'Important: always validate input';
      const encoded = quickEncode(original, 'lesson', 8);
      const decoded = decode(encoded);

      // Decoded output should contain human-readable information
      expect(decoded).toBeTruthy();
    });

    it('should handle empty or invalid input', () => {
      expect(() => decode('')).not.toThrow();
      expect(() => decode('invalid')).not.toThrow();
    });
  });
});
