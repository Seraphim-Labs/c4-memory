/**
 * AIME Grammar - High-level parsing and AST utilities
 */

import { STRUCTURAL, RECORD_TYPES, AIME_VERSION } from './symbols.js';
import { decode, getTokens, validate } from './decoder.js';
import { encode, quickEncode, type EncodeInput } from './encoder.js';

export interface AIMEDocument {
  version: string;
  records: AIMERecordNode[];
  raw: string;
}

export interface AIMERecordNode {
  type: 'entity' | 'relation' | 'lesson' | 'error';
  content: string;
  decoded: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Parse AIME document into structured AST
 */
export function parse(encoded: string): AIMEDocument {
  const validation = validate(encoded);
  if (!validation.valid) {
    throw new Error(`Invalid AIME encoding: ${validation.errors.join(', ')}`);
  }

  // Extract version
  const versionMatch = encoded.match(/⁂(\d+\.\d+)/);
  const version = versionMatch ? versionMatch[1] : AIME_VERSION;

  // Find record boundaries
  const records: AIMERecordNode[] = [];
  const recordMarkers = Object.values(RECORD_TYPES);

  let currentIndex = 0;
  while (currentIndex < encoded.length) {
    // Find next record marker
    let nextRecordStart = -1;
    let nextRecordType: 'entity' | 'relation' | 'lesson' | 'error' | null = null;

    for (const marker of recordMarkers) {
      const idx = encoded.indexOf(marker, currentIndex);
      if (idx !== -1 && (nextRecordStart === -1 || idx < nextRecordStart)) {
        nextRecordStart = idx;
        nextRecordType = markerToType(marker);
      }
    }

    if (nextRecordStart === -1) break;

    // Find end of this record (next record start or frame end)
    let nextRecordEnd = encoded.length - 1; // Before frame end
    for (const marker of recordMarkers) {
      const idx = encoded.indexOf(marker, nextRecordStart + 2);
      if (idx !== -1 && idx < nextRecordEnd) {
        nextRecordEnd = idx;
      }
    }

    const recordContent = encoded.slice(nextRecordStart, nextRecordEnd);
    records.push({
      type: nextRecordType!,
      content: recordContent,
      decoded: decode(recordContent),
      startIndex: nextRecordStart,
      endIndex: nextRecordEnd,
    });

    currentIndex = nextRecordEnd;
  }

  return {
    version,
    records,
    raw: encoded,
  };
}

function markerToType(marker: string): 'entity' | 'relation' | 'lesson' | 'error' {
  switch (marker) {
    case RECORD_TYPES.ENTITY:
      return 'entity';
    case RECORD_TYPES.RELATION:
      return 'relation';
    case RECORD_TYPES.LESSON:
      return 'lesson';
    case RECORD_TYPES.ERROR:
      return 'error';
    default:
      return 'entity';
  }
}

/**
 * Serialize AST back to AIME format
 */
export function serialize(doc: AIMEDocument): string {
  const recordContents = doc.records.map(r => r.content).join('');
  return `${STRUCTURAL.FRAME_START}${STRUCTURAL.VERSION}${doc.version}${recordContents}${STRUCTURAL.FRAME_END}`;
}

/**
 * Merge multiple AIME documents
 */
export function merge(docs: AIMEDocument[]): AIMEDocument {
  const allRecords = docs.flatMap(d => d.records);
  const latestVersion = docs.reduce((max, d) =>
    d.version > max ? d.version : max, AIME_VERSION
  );

  const merged: AIMEDocument = {
    version: latestVersion,
    records: allRecords,
    raw: '',
  };

  merged.raw = serialize(merged);
  return merged;
}

/**
 * Extract specific record types from document
 */
export function filterRecords(
  doc: AIMEDocument,
  types: Array<'entity' | 'relation' | 'lesson' | 'error'>
): AIMERecordNode[] {
  return doc.records.filter(r => types.includes(r.type));
}

/**
 * Get summary statistics about an AIME document
 */
export function getStats(doc: AIMEDocument): {
  version: string;
  totalRecords: number;
  byType: Record<string, number>;
  rawLength: number;
  decodedLength: number;
  compressionRatio: number;
} {
  const byType: Record<string, number> = {
    entity: 0,
    relation: 0,
    lesson: 0,
    error: 0,
  };

  for (const record of doc.records) {
    byType[record.type]++;
  }

  const decodedLength = doc.records.reduce((sum, r) => sum + r.decoded.length, 0);

  return {
    version: doc.version,
    totalRecords: doc.records.length,
    byType,
    rawLength: doc.raw.length,
    decodedLength,
    compressionRatio: decodedLength / doc.raw.length,
  };
}

// Re-export encoder/decoder functions
export { encode, quickEncode, decode, validate, getTokens };
export type { EncodeInput };
