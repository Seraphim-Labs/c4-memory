/**
 * AIME (AI Memory Encoding) Symbol Dictionary
 *
 * A compressed symbolic language for AI memory storage.
 * Not human-readable - optimized for AI comprehension and compression.
 */

// Structural markers - frame and record delimiters
export const STRUCTURAL = {
  FRAME_START: '◊',
  FRAME_END: '◆',
  SECTION: '§',
  RECORD_SEP: '¶',
  FIELD_SEP: '·',
  NEST_OPEN: '«',
  NEST_CLOSE: '»',
  BLOCK_OPEN: '┌',
  BLOCK_CLOSE: '└',
  CONTINUATION: '│',
  SEQUENCE: '→',
  AGGREGATE: '⊕',
  NULL: '∅',
  REF: '†',
  BACKREF: '‡',
  ANNOTATION: '※',
  VERSION: '⁂',
} as const;

// Entity type markers (prefix: Ξ)
export const ENTITIES = {
  FUNCTION: 'Ξf',
  CLASS: 'Ξc',
  MODULE: 'Ξm',
  VARIABLE: 'Ξv',
  TYPE: 'Ξt',
  INTERFACE: 'Ξi',
  ERROR: 'Ξe',
  PARAM: 'Ξp',
  RETURN: 'Ξr',
  DEPENDENCY: 'Ξd',
  API: 'Ξa',
  DATABASE: 'Ξb',
  QUERY: 'Ξq',
  STATE: 'Ξs',
  CONFIG: 'Ξg',
  HANDLER: 'Ξh',
  HOOK: 'Ξk',
  LIBRARY: 'Ξl',
  NAMESPACE: 'Ξn',
  OBJECT: 'Ξo',
  USER: 'Ξu',
  WORKFLOW: 'Ξw',
  EXTERNAL: 'Ξx',
  EVENT: 'Ξy',
  RESOURCE: 'Ξz',
} as const;

// Action markers (prefix: Φ)
export const ACTIONS = {
  CREATE: 'Φcr',
  READ: 'Φrd',
  UPDATE: 'Φup',
  DELETE: 'Φdl',
  CALL: 'Φcl',
  RETURN: 'Φrt',
  THROW: 'Φth',
  CATCH: 'Φct',
  ITERATE: 'Φit',
  MAP: 'Φmp',
  FILTER: 'Φfl',
  REDUCE: 'Φrc',
  VALIDATE: 'Φvl',
  PARSE: 'Φpr',
  SERIALIZE: 'Φsr',
  LOG: 'Φlg',
  ASSERT: 'Φas',
  WAIT: 'Φwt',
  EMIT: 'Φem',
  SUBSCRIBE: 'Φsb',
  INIT: 'Φin',
  DESTROY: 'Φds',
  COPY: 'Φcp',
  MOVE: 'Φmv',
  MERGE: 'Φmg',
  SPLIT: 'Φsp',
  CONNECT: 'Φcn',
  DISCONNECT: 'Φdc',
} as const;

// Relation markers (prefix: Ψ)
export const RELATIONS = {
  CONTAINS: 'Ψ⊂',
  CONTAINED_BY: 'Ψ⊃',
  MEMBER_OF: 'Ψ∈',
  DEPENDS_ON: 'Ψ→',
  DEPENDED_BY: 'Ψ←',
  BIDEP: 'Ψ↔',
  IMPLIES: 'Ψ⇒',
  CAUSED_BY: 'Ψ⇐',
  EQUIVALENT: 'Ψ≡',
  SIMILAR: 'Ψ≈',
  DIFFERS: 'Ψ≠',
  AND: 'Ψ∧',
  OR: 'Ψ∨',
  NOT: 'Ψ¬',
  XOR: 'Ψ⊕',
  INHERITS: 'Ψ↑',
  PARENT_OF: 'Ψ↓',
  IMPLEMENTS: 'Ψ⟷',
  CONFLICTS: 'Ψ⊗',
  REPLACES: 'Ψ⊘',
  PARALLEL: 'Ψ∥',
  ORTHOGONAL: 'Ψ⊥',
  COMPOSES: 'Ψ∘',
  TRIGGERS: 'Ψ⊳',
  TRIGGERED_BY: 'Ψ⊲',
  OPTIONAL: 'Ψ◇',
  REQUIRED: 'Ψ◆',
} as const;

// Modifier markers (prefix: Ω)
export const MODIFIERS = {
  // Certainty
  PROVEN: 'Ω!',
  UNCERTAIN: 'Ω?',
  PROBABLE: 'Ω~',
  SPECULATIVE: 'Ω‽',
  // Frequency
  ALWAYS: 'Ω∞',
  OFTEN: 'Ω≫',
  SOMETIMES: 'Ω≈',
  RARELY: 'Ω≪',
  NEVER: 'Ω∅',
  // Severity
  CRITICAL: 'Ω✱',
  MAJOR: 'Ω✦',
  MINOR: 'Ω✧',
  TRIVIAL: 'Ω·',
  // Scope
  GLOBAL: 'Ω⌐',
  MODULE_SCOPE: 'Ω⌊',
  FUNCTION_SCOPE: 'Ω⌋',
  BLOCK_SCOPE: 'Ω⌁',
  LINE_SCOPE: 'Ω.',
  // Temporal
  PAST: 'Ω<',
  FUTURE: 'Ω>',
  CURRENT: 'Ω=',
  UP_TO_NOW: 'Ω≤',
  FROM_NOW: 'Ω≥',
  // Status
  RESOLVED: 'Ω✓',
  UNRESOLVED: 'Ω✗',
  IN_PROGRESS: 'Ω⊙',
  BLOCKED: 'Ω⊛',
} as const;

// Pattern markers (prefix: Π)
export const PATTERNS = {
  SINGLETON: 'Πsg',
  FACTORY: 'Πfc',
  OBSERVER: 'Πob',
  STRATEGY: 'Πst',
  DI: 'Πdp',
  MVC: 'Πmv',
  REPOSITORY: 'Πrp',
  SERVICE: 'Πsv',
  ADAPTER: 'Πad',
  DECORATOR: 'Πdc',
  PROXY: 'Πpr',
  COMMAND: 'Πcm',
  MEDIATOR: 'Πmd',
  MEMENTO: 'Πmm',
  VISITOR: 'Πvs',
  CIRCUIT_BREAKER: 'Πcr',
  RETRY: 'Πrt',
  CQRS: 'Πcq',
  EVENT_SOURCING: 'Πes',
  SAGA: 'Πsa',
} as const;

// Error category markers (prefix: Ε)
export const ERRORS = {
  SYNTAX: 'Εsyn',
  TYPE: 'Εtyp',
  REFERENCE: 'Εref',
  RANGE: 'Εrng',
  NULL: 'Εnul',
  ASSERTION: 'Εast',
  IO: 'Εio',
  NETWORK: 'Εnet',
  AUTH: 'Εath',
  AUTHZ: 'Εatz',
  VALIDATION: 'Εval',
  TIMEOUT: 'Εtmo',
  CONCURRENCY: 'Εcnc',
  MEMORY: 'Εmem',
  CONFIG: 'Εcfg',
  DEPENDENCY: 'Εdep',
  API: 'Εapi',
  DATABASE: 'Εdb',
  PARSE: 'Εprs',
  SERIALIZE: 'Εsrl',
} as const;

// Language markers (prefix: λ)
export const LANGUAGES = {
  TYPESCRIPT: 'λts',
  JAVASCRIPT: 'λjs',
  PYTHON: 'λpy',
  RUST: 'λrs',
  GO: 'λgo',
  JAVA: 'λjv',
  RUBY: 'λrb',
  CPP: 'λcpp',
  CSHARP: 'λcs',
  SQL: 'λsql',
  SHELL: 'λsh',
  YAML: 'λyml',
  JSON: 'λjsn',
  MARKDOWN: 'λmd',
  HTML: 'λhtm',
  CSS: 'λcss',
} as const;

// Record type markers
export const RECORD_TYPES = {
  ENTITY: '§E',
  RELATION: '§R',
  LESSON: '§L',
  ERROR: '§X',
} as const;

// Build reverse lookup maps for decoding
type SymbolMap = { [key: string]: string };

function invertMap(obj: Record<string, string>): SymbolMap {
  const result: SymbolMap = {};
  for (const [key, value] of Object.entries(obj)) {
    result[value] = key;
  }
  return result;
}

export const DECODE_STRUCTURAL = invertMap(STRUCTURAL);
export const DECODE_ENTITIES = invertMap(ENTITIES);
export const DECODE_ACTIONS = invertMap(ACTIONS);
export const DECODE_RELATIONS = invertMap(RELATIONS);
export const DECODE_MODIFIERS = invertMap(MODIFIERS);
export const DECODE_PATTERNS = invertMap(PATTERNS);
export const DECODE_ERRORS = invertMap(ERRORS);
export const DECODE_LANGUAGES = invertMap(LANGUAGES);
export const DECODE_RECORD_TYPES = invertMap(RECORD_TYPES);

// All symbols combined for validation
export const ALL_SYMBOLS = new Set([
  ...Object.values(STRUCTURAL),
  ...Object.values(ENTITIES),
  ...Object.values(ACTIONS),
  ...Object.values(RELATIONS),
  ...Object.values(MODIFIERS),
  ...Object.values(PATTERNS),
  ...Object.values(ERRORS),
  ...Object.values(LANGUAGES),
  ...Object.values(RECORD_TYPES),
]);

// Symbol prefixes for tokenization
export const PREFIXES = {
  ENTITY: 'Ξ',
  ACTION: 'Φ',
  RELATION: 'Ψ',
  MODIFIER: 'Ω',
  PATTERN: 'Π',
  ERROR: 'Ε',
  LANGUAGE: 'λ',
  RECORD: '§',
} as const;

// Current AIME version
export const AIME_VERSION = '1.0';
