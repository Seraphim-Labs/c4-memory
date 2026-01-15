/**
 * SQLite Database Schema and Migrations
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const MEMORY_DIR = join(homedir(), '.claude', 'memory');
const GLOBAL_DB_PATH = join(MEMORY_DIR, 'global.db');
const PROJECTS_DIR = join(MEMORY_DIR, 'projects');

// Current schema version
const SCHEMA_VERSION = 2;

/**
 * Ensure memory directory structure exists
 */
export function ensureDirectories(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
  if (!existsSync(PROJECTS_DIR)) {
    mkdirSync(PROJECTS_DIR, { recursive: true });
  }
}

/**
 * Initialize database with schema
 */
export function initializeSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create schema version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  // Check current version
  const versionRow = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  const currentVersion = versionRow?.version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    migrate(db, currentVersion, SCHEMA_VERSION);
  }
}

/**
 * Run migrations from one version to another
 */
function migrate(db: Database.Database, from: number, to: number): void {
  const migrations: Array<(db: Database.Database) => void> = [
    migrateV0toV1,
    migrateV1toV2,
  ];

  for (let v = from; v < to; v++) {
    migrations[v](db);
  }

  // Update schema version
  db.prepare('DELETE FROM schema_version').run();
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(to);
}

/**
 * Migration from v0 (fresh) to v1
 */
function migrateV0toV1(db: Database.Database): void {
  db.exec(`
    -- Core memories table
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('entity', 'lesson', 'error', 'relation')),
      encoded TEXT NOT NULL,
      decoded_cache TEXT,
      scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'project')),
      project_hash TEXT,
      importance INTEGER NOT NULL DEFAULT 5 CHECK(importance BETWEEN 1 AND 9),
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0
    );

    -- Embeddings table for semantic search
    CREATE TABLE IF NOT EXISTS embeddings (
      memory_id INTEGER PRIMARY KEY,
      vector BLOB NOT NULL,
      model TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    -- Auto-learning log
    CREATE TABLE IF NOT EXISTS auto_learn_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_type TEXT NOT NULL,
      context TEXT NOT NULL,
      memory_id INTEGER,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
    );

    -- Indexes for fast retrieval
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_hash);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_learn_timestamp ON auto_learn_log(timestamp DESC);
  `);
}

/**
 * Migration from v1 to v2 - MemEvolve Evolution Tracking
 * Adds usefulness tracking, feedback, relationships, and hierarchical levels
 */
function migrateV1toV2(db: Database.Database): void {
  db.exec(`
    -- Add evolution tracking columns to memories table
    ALTER TABLE memories ADD COLUMN usefulness_score REAL DEFAULT 5.0;
    ALTER TABLE memories ADD COLUMN times_helpful INTEGER DEFAULT 0;
    ALTER TABLE memories ADD COLUMN times_unhelpful INTEGER DEFAULT 0;
    ALTER TABLE memories ADD COLUMN status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'consolidated'));
    ALTER TABLE memories ADD COLUMN parent_id INTEGER REFERENCES memories(id) ON DELETE SET NULL;
    ALTER TABLE memories ADD COLUMN level INTEGER DEFAULT 1 CHECK(level BETWEEN 1 AND 3);
    ALTER TABLE memories ADD COLUMN last_decay INTEGER;

    -- Memory feedback table - tracks when memories help or don't
    CREATE TABLE IF NOT EXISTS memory_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      feedback_type TEXT NOT NULL CHECK(feedback_type IN ('helpful', 'unhelpful', 'outdated', 'incorrect')),
      context TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    -- Memory relationships table - tracks connections between memories
    CREATE TABLE IF NOT EXISTS memory_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      relationship TEXT NOT NULL CHECK(relationship IN ('similar', 'supersedes', 'contradicts', 'derived_from')),
      strength REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    -- New indexes for evolution features
    CREATE INDEX IF NOT EXISTS idx_memories_usefulness ON memories(usefulness_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_level ON memories(level);
    CREATE INDEX IF NOT EXISTS idx_memories_parent ON memories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_memory ON memory_feedback(memory_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_time ON memory_feedback(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_rel_source ON memory_relationships(source_id);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON memory_relationships(target_id);
  `);
}

/**
 * Open the global database
 */
export function openGlobalDb(): Database.Database {
  ensureDirectories();
  const db = new Database(GLOBAL_DB_PATH);
  initializeSchema(db);
  return db;
}

/**
 * Open a project-specific database
 */
export function openProjectDb(projectHash: string): Database.Database {
  ensureDirectories();
  const dbPath = join(PROJECTS_DIR, `${projectHash}.db`);
  const db = new Database(dbPath);
  initializeSchema(db);
  return db;
}

/**
 * Generate a project hash from working directory path
 */
export function hashProject(projectPath: string): string {
  // Simple hash - in production might want something more robust
  let hash = 0;
  for (let i = 0; i < projectPath.length; i++) {
    const char = projectPath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Get database paths for debugging
 */
export function getDatabasePaths(): { global: string; projects: string } {
  return {
    global: GLOBAL_DB_PATH,
    projects: PROJECTS_DIR,
  };
}

export { MEMORY_DIR, GLOBAL_DB_PATH, PROJECTS_DIR };
