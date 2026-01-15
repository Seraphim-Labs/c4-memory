/**
 * AIME Decoder - Converts AIME symbolic format back to natural language
 */

import {
  STRUCTURAL,
  DECODE_ENTITIES,
  DECODE_ACTIONS,
  DECODE_RELATIONS,
  DECODE_MODIFIERS,
  DECODE_PATTERNS,
  DECODE_ERRORS,
  DECODE_LANGUAGES,
  DECODE_RECORD_TYPES,
  PREFIXES,
} from './symbols.js';

// Token types for parsing
interface Token {
  type: 'structural' | 'entity' | 'action' | 'relation' | 'modifier' | 'pattern' | 'error' | 'language' | 'record' | 'string' | 'number' | 'text';
  value: string;
  decoded?: string;
}

/**
 * Tokenize AIME encoded string
 */
function tokenize(encoded: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < encoded.length) {
    const char = encoded[i];

    // String literal
    if (char === '"') {
      let str = '';
      i++; // Skip opening quote
      while (i < encoded.length && encoded[i] !== '"') {
        if (encoded[i] === '\\' && i + 1 < encoded.length) {
          i++;
          str += encoded[i];
        } else {
          str += encoded[i];
        }
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Number (hex)
    if (char === '#') {
      let num = '';
      i++; // Skip #
      while (i < encoded.length && /[0-9a-fA-F]/.test(encoded[i])) {
        num += encoded[i];
        i++;
      }
      tokens.push({ type: 'number', value: String(parseInt(num, 16)) });
      continue;
    }

    // Structural symbols (single char)
    if ((Object.values(STRUCTURAL) as string[]).includes(char)) {
      tokens.push({ type: 'structural', value: char });
      i++;
      continue;
    }

    // Multi-character symbols - try to match longest first
    let matched = false;

    // Record types (§E, §R, §L, §X)
    if (char === PREFIXES.RECORD && i + 1 < encoded.length) {
      const symbol = encoded.slice(i, i + 2);
      if (DECODE_RECORD_TYPES[symbol]) {
        tokens.push({ type: 'record', value: symbol, decoded: DECODE_RECORD_TYPES[symbol] });
        i += 2;
        matched = true;
      }
    }

    // Entity types (Ξx)
    if (!matched && char === PREFIXES.ENTITY && i + 1 < encoded.length) {
      const symbol = encoded.slice(i, i + 2);
      if (DECODE_ENTITIES[symbol]) {
        tokens.push({ type: 'entity', value: symbol, decoded: DECODE_ENTITIES[symbol] });
        i += 2;
        matched = true;
      }
    }

    // Actions (Φxx)
    if (!matched && char === PREFIXES.ACTION) {
      // Try 3 chars first, then 2
      for (const len of [3, 2]) {
        if (i + len <= encoded.length) {
          const symbol = encoded.slice(i, i + len);
          if (DECODE_ACTIONS[symbol]) {
            tokens.push({ type: 'action', value: symbol, decoded: DECODE_ACTIONS[symbol] });
            i += len;
            matched = true;
            break;
          }
        }
      }
    }

    // Relations (Ψx)
    if (!matched && char === PREFIXES.RELATION && i + 1 < encoded.length) {
      const symbol = encoded.slice(i, i + 2);
      if (DECODE_RELATIONS[symbol]) {
        tokens.push({ type: 'relation', value: symbol, decoded: DECODE_RELATIONS[symbol] });
        i += 2;
        matched = true;
      }
    }

    // Modifiers (Ωx)
    if (!matched && char === PREFIXES.MODIFIER && i + 1 < encoded.length) {
      const symbol = encoded.slice(i, i + 2);
      if (DECODE_MODIFIERS[symbol]) {
        tokens.push({ type: 'modifier', value: symbol, decoded: DECODE_MODIFIERS[symbol] });
        i += 2;
        matched = true;
      }
    }

    // Patterns (Πxx)
    if (!matched && char === PREFIXES.PATTERN) {
      for (const len of [3, 2]) {
        if (i + len <= encoded.length) {
          const symbol = encoded.slice(i, i + len);
          if (DECODE_PATTERNS[symbol]) {
            tokens.push({ type: 'pattern', value: symbol, decoded: DECODE_PATTERNS[symbol] });
            i += len;
            matched = true;
            break;
          }
        }
      }
    }

    // Errors (Εxxx)
    if (!matched && char === PREFIXES.ERROR) {
      for (const len of [4, 3]) {
        if (i + len <= encoded.length) {
          const symbol = encoded.slice(i, i + len);
          if (DECODE_ERRORS[symbol]) {
            tokens.push({ type: 'error', value: symbol, decoded: DECODE_ERRORS[symbol] });
            i += len;
            matched = true;
            break;
          }
        }
      }
    }

    // Languages (λxx)
    if (!matched && char === PREFIXES.LANGUAGE) {
      for (const len of [4, 3]) {
        if (i + len <= encoded.length) {
          const symbol = encoded.slice(i, i + len);
          if (DECODE_LANGUAGES[symbol]) {
            tokens.push({ type: 'language', value: symbol, decoded: DECODE_LANGUAGES[symbol] });
            i += len;
            matched = true;
            break;
          }
        }
      }
    }

    // Unknown - treat as text
    if (!matched) {
      // Collect consecutive unknown chars
      let text = '';
      while (
        i < encoded.length &&
        encoded[i] !== '"' &&
        encoded[i] !== '#' &&
        !(Object.values(STRUCTURAL) as string[]).includes(encoded[i]) &&
        !(Object.values(PREFIXES) as string[]).includes(encoded[i])
      ) {
        text += encoded[i];
        i++;
      }
      if (text) {
        tokens.push({ type: 'text', value: text });
      }
    }
  }

  return tokens;
}

/**
 * Format a decoded token for human reading
 */
function formatToken(token: Token): string {
  switch (token.type) {
    case 'string':
      return token.value;
    case 'number':
      return token.value;
    case 'entity':
      return `[${token.decoded?.toLowerCase().replace('_', ' ')}]`;
    case 'action':
      return token.decoded?.toLowerCase().replace('_', ' ') || token.value;
    case 'relation':
      return formatRelation(token.decoded || '');
    case 'modifier':
      return formatModifier(token.decoded || '');
    case 'pattern':
      return `<${token.decoded?.toLowerCase()}>`;
    case 'error':
      return `{${token.decoded?.toLowerCase()} error}`;
    case 'language':
      return `(${token.decoded})`;
    case 'record':
      return formatRecordType(token.decoded || '');
    case 'structural':
      return formatStructural(token.value);
    case 'text':
      return token.value;
    default:
      return token.value;
  }
}

function formatRelation(rel: string): string {
  const map: Record<string, string> = {
    CONTAINS: 'contains',
    CONTAINED_BY: 'is contained by',
    MEMBER_OF: 'is member of',
    DEPENDS_ON: 'depends on',
    DEPENDED_BY: 'is depended on by',
    BIDEP: 'has bidirectional dependency with',
    IMPLIES: 'implies',
    CAUSED_BY: 'is caused by',
    EQUIVALENT: 'is equivalent to',
    SIMILAR: 'is similar to',
    DIFFERS: 'differs from',
    AND: 'and',
    OR: 'or',
    NOT: 'not',
    XOR: 'exclusive or',
    INHERITS: 'inherits from',
    PARENT_OF: 'is parent of',
    IMPLEMENTS: 'implements',
    CONFLICTS: 'conflicts with',
    REPLACES: 'replaces',
    PARALLEL: 'is parallel to',
    ORTHOGONAL: 'is orthogonal to',
    COMPOSES: 'composes with',
    TRIGGERS: 'triggers',
    TRIGGERED_BY: 'is triggered by',
    OPTIONAL: '(optional)',
    REQUIRED: '(required)',
  };
  return map[rel] || rel.toLowerCase();
}

function formatModifier(mod: string): string {
  const map: Record<string, string> = {
    PROVEN: '[proven]',
    UNCERTAIN: '[uncertain]',
    PROBABLE: '[probable]',
    SPECULATIVE: '[speculative]',
    ALWAYS: '[always]',
    OFTEN: '[often]',
    SOMETIMES: '[sometimes]',
    RARELY: '[rarely]',
    NEVER: '[never]',
    CRITICAL: '[CRITICAL]',
    MAJOR: '[major]',
    MINOR: '[minor]',
    TRIVIAL: '[trivial]',
    GLOBAL: '[global scope]',
    MODULE_SCOPE: '[module scope]',
    FUNCTION_SCOPE: '[function scope]',
    BLOCK_SCOPE: '[block scope]',
    LINE_SCOPE: '[line scope]',
    PAST: '[past]',
    FUTURE: '[future]',
    CURRENT: '[current]',
    UP_TO_NOW: '[up to now]',
    FROM_NOW: '[from now]',
    RESOLVED: '[resolved]',
    UNRESOLVED: '[unresolved]',
    IN_PROGRESS: '[in progress]',
    BLOCKED: '[blocked]',
  };
  return map[mod] || `[${mod.toLowerCase()}]`;
}

function formatRecordType(type: string): string {
  const map: Record<string, string> = {
    ENTITY: '\n[Entity] ',
    RELATION: '\n[Relation] ',
    LESSON: '\n[Lesson] ',
    ERROR: '\n[Error] ',
  };
  return map[type] || '';
}

function formatStructural(char: string): string {
  const map: Record<string, string> = {
    [STRUCTURAL.FRAME_START]: '',
    [STRUCTURAL.FRAME_END]: '',
    [STRUCTURAL.SECTION]: ' | ',
    [STRUCTURAL.RECORD_SEP]: '\n',
    [STRUCTURAL.FIELD_SEP]: ', ',
    [STRUCTURAL.NEST_OPEN]: '(',
    [STRUCTURAL.NEST_CLOSE]: ')',
    [STRUCTURAL.BLOCK_OPEN]: ' [',
    [STRUCTURAL.BLOCK_CLOSE]: ']',
    [STRUCTURAL.CONTINUATION]: ' | ',
    [STRUCTURAL.SEQUENCE]: ' -> ',
    [STRUCTURAL.AGGREGATE]: ' + ',
    [STRUCTURAL.NULL]: 'null',
    [STRUCTURAL.REF]: '@',
    [STRUCTURAL.BACKREF]: '$',
    [STRUCTURAL.ANNOTATION]: ' // ',
    [STRUCTURAL.VERSION]: 'v',
  };
  return map[char] ?? char;
}

/**
 * Decode AIME encoded string to human-readable format
 */
export function decode(encoded: string): string {
  const tokens = tokenize(encoded);
  let result = '';

  for (const token of tokens) {
    result += formatToken(token);
  }

  // Clean up extra whitespace
  return result
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

/**
 * Get raw tokens for debugging/analysis
 */
export function getTokens(encoded: string): Token[] {
  return tokenize(encoded);
}

/**
 * Validate AIME encoding structure
 */
export function validate(encoded: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Must start with frame start
  if (!encoded.startsWith(STRUCTURAL.FRAME_START)) {
    errors.push('Missing frame start marker (◊)');
  }

  // Must end with frame end
  if (!encoded.endsWith(STRUCTURAL.FRAME_END)) {
    errors.push('Missing frame end marker (◆)');
  }

  // Must have version
  if (!encoded.includes(STRUCTURAL.VERSION)) {
    errors.push('Missing version marker (⁂)');
  }

  // Check balanced nesting
  let nestLevel = 0;
  let blockLevel = 0;
  for (const char of encoded) {
    if (char === STRUCTURAL.NEST_OPEN) nestLevel++;
    if (char === STRUCTURAL.NEST_CLOSE) nestLevel--;
    if (char === STRUCTURAL.BLOCK_OPEN) blockLevel++;
    if (char === STRUCTURAL.BLOCK_CLOSE) blockLevel--;

    if (nestLevel < 0) errors.push('Unbalanced nesting (extra »)');
    if (blockLevel < 0) errors.push('Unbalanced blocks (extra └)');
  }
  if (nestLevel !== 0) errors.push('Unbalanced nesting (missing »)');
  if (blockLevel !== 0) errors.push('Unbalanced blocks (missing └)');

  return { valid: errors.length === 0, errors };
}
