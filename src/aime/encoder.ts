/**
 * AIME Encoder - Converts structured data to AIME symbolic format
 *
 * Note: This encoder expects pre-extracted semantic information.
 * Claude does the semantic extraction; this formats it into AIME.
 */

import {
  STRUCTURAL,
  ENTITIES,
  RELATIONS,
  MODIFIERS,
  ERRORS,
  LANGUAGES,
  RECORD_TYPES,
  AIME_VERSION,
} from './symbols.js';

// Input types for encoding
export interface EntityInput {
  type: keyof typeof ENTITIES;
  name: string;
  attributes?: Record<string, string>;
  modifiers?: (keyof typeof MODIFIERS)[];
}

export interface RelationInput {
  subject: string;  // Reference or inline entity
  relation: keyof typeof RELATIONS;
  object: string;   // Reference or inline entity
  modifiers?: (keyof typeof MODIFIERS)[];
}

export interface LessonInput {
  context: string[];
  insight: string;
  modifiers?: (keyof typeof MODIFIERS)[];
}

export interface ErrorInput {
  category: keyof typeof ERRORS;
  signature: string;
  language?: keyof typeof LANGUAGES;
  context?: string[];
  solution: string[];
  evidence?: {
    certainty?: keyof typeof MODIFIERS;
    occurrences?: number;
  };
}

export interface EncodeInput {
  entities?: EntityInput[];
  relations?: RelationInput[];
  lessons?: LessonInput[];
  errors?: ErrorInput[];
}

/**
 * Escape special characters in string literals
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/◊/g, '\\◊')
    .replace(/◆/g, '\\◆');
}

/**
 * Encode a string literal
 */
function encodeString(str: string): string {
  return `"${escapeString(str)}"`;
}

/**
 * Encode a number in compact hex format
 */
function encodeNumber(num: number): string {
  return `#${num.toString(16)}`;
}

/**
 * Encode an entity record
 */
function encodeEntity(entity: EntityInput): string {
  const parts: string[] = [];

  // Entity type and name
  const entitySymbol = ENTITIES[entity.type];
  parts.push(`${RECORD_TYPES.ENTITY}${entitySymbol}${encodeString(entity.name)}`);

  // Attributes
  if (entity.attributes && Object.keys(entity.attributes).length > 0) {
    const attrs = Object.entries(entity.attributes)
      .map(([k, v]) => `${k}=${encodeString(v)}`)
      .join(STRUCTURAL.FIELD_SEP);
    parts.push(`${STRUCTURAL.NEST_OPEN}${attrs}${STRUCTURAL.NEST_CLOSE}`);
  }

  // Modifiers
  if (entity.modifiers && entity.modifiers.length > 0) {
    const mods = entity.modifiers.map(m => MODIFIERS[m]).join(STRUCTURAL.FIELD_SEP);
    parts.push(`${STRUCTURAL.BLOCK_OPEN}${mods}${STRUCTURAL.BLOCK_CLOSE}`);
  }

  return parts.join('');
}

/**
 * Encode a relation record
 */
function encodeRelation(relation: RelationInput): string {
  const parts: string[] = [];

  parts.push(RECORD_TYPES.RELATION);
  parts.push(relation.subject);
  parts.push(RELATIONS[relation.relation]);
  parts.push(relation.object);

  if (relation.modifiers && relation.modifiers.length > 0) {
    const mods = relation.modifiers.map(m => MODIFIERS[m]).join(STRUCTURAL.FIELD_SEP);
    parts.push(`${STRUCTURAL.NEST_OPEN}${mods}${STRUCTURAL.NEST_CLOSE}`);
  }

  return parts.join('');
}

/**
 * Encode a lesson record
 */
function encodeLesson(lesson: LessonInput): string {
  const parts: string[] = [];

  parts.push(RECORD_TYPES.LESSON);

  // Context
  if (lesson.context.length > 1) {
    const ctx = lesson.context.join(RELATIONS.AND);
    parts.push(`${STRUCTURAL.NEST_OPEN}${ctx}${STRUCTURAL.NEST_CLOSE}`);
  } else if (lesson.context.length === 1) {
    parts.push(lesson.context[0]);
  }

  parts.push(STRUCTURAL.SEQUENCE);
  parts.push(lesson.insight);

  if (lesson.modifiers && lesson.modifiers.length > 0) {
    const mods = lesson.modifiers.map(m => MODIFIERS[m]).join(STRUCTURAL.FIELD_SEP);
    parts.push(`${STRUCTURAL.NEST_OPEN}${mods}${STRUCTURAL.NEST_CLOSE}`);
  }

  return parts.join('');
}

/**
 * Encode an error record
 */
function encodeError(error: ErrorInput): string {
  const parts: string[] = [];

  parts.push(RECORD_TYPES.ERROR);
  parts.push(ERRORS[error.category]);
  parts.push(encodeString(error.signature));

  // Language context
  if (error.language) {
    parts.push(`${STRUCTURAL.CONTINUATION}${LANGUAGES[error.language]}`);
  }

  // Additional context
  if (error.context && error.context.length > 0) {
    for (const ctx of error.context) {
      parts.push(`${STRUCTURAL.CONTINUATION}${ctx}`);
    }
  }

  // Solution
  parts.push(RELATIONS.IMPLIES);
  if (error.solution.length > 1) {
    parts.push(error.solution.join(RELATIONS.OR));
  } else {
    parts.push(error.solution[0]);
  }

  // Evidence
  if (error.evidence) {
    parts.push(STRUCTURAL.ANNOTATION);
    if (error.evidence.certainty) {
      parts.push(MODIFIERS[error.evidence.certainty]);
    }
    if (error.evidence.occurrences) {
      parts.push(encodeNumber(error.evidence.occurrences));
    }
  }

  return parts.join('');
}

/**
 * Main encode function - converts structured input to AIME format
 */
export function encode(input: EncodeInput): string {
  const records: string[] = [];

  // Encode entities
  if (input.entities) {
    for (const entity of input.entities) {
      records.push(encodeEntity(entity));
    }
  }

  // Encode relations
  if (input.relations) {
    for (const relation of input.relations) {
      records.push(encodeRelation(relation));
    }
  }

  // Encode lessons
  if (input.lessons) {
    for (const lesson of input.lessons) {
      records.push(encodeLesson(lesson));
    }
  }

  // Encode errors
  if (input.errors) {
    for (const error of input.errors) {
      records.push(encodeError(error));
    }
  }

  // Wrap in frame
  return `${STRUCTURAL.FRAME_START}${STRUCTURAL.VERSION}${AIME_VERSION}${records.join('')}${STRUCTURAL.FRAME_END}`;
}

/**
 * Quick encode for simple text content with type
 * Used when Claude wants to quickly store something without full structure
 */
export function quickEncode(
  content: string,
  type: 'lesson' | 'error' | 'pattern' | 'fact',
  importance: number = 5
): string {
  const importanceMod = importance >= 7 ? 'CRITICAL' : importance >= 4 ? 'MAJOR' : 'MINOR';

  switch (type) {
    case 'lesson':
      return encode({
        lessons: [{
          context: [],
          insight: encodeString(content),
          modifiers: [importanceMod as keyof typeof MODIFIERS],
        }],
      });

    case 'error':
      return encode({
        errors: [{
          category: 'TYPE', // Default to type error
          signature: content,
          solution: [encodeString('See decoded content')],
          evidence: { certainty: 'PROBABLE' },
        }],
      });

    case 'pattern':
      return encode({
        entities: [{
          type: 'WORKFLOW',
          name: content,
          modifiers: [importanceMod as keyof typeof MODIFIERS],
        }],
      });

    case 'fact':
    default:
      return encode({
        entities: [{
          type: 'OBJECT',
          name: content,
          modifiers: [importanceMod as keyof typeof MODIFIERS],
        }],
      });
  }
}

/**
 * Calculate compression ratio for a given encoding
 */
export function compressionRatio(original: string, encoded: string): number {
  return original.length / encoded.length;
}
