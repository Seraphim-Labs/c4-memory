/**
 * Working Memory Layer
 *
 * Provides intermediate storage between transient context and permanent database.
 * Three tiers:
 * - HOT: Last 10 minutes of actions (auto-expires)
 * - WARM: Current session state (persists until explicit clear)
 * - COLD: Permanent database (existing system)
 *
 * This layer survives auto-compact in Claude Code by persisting to disk.
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const MEMORY_DIR = join(homedir(), '.claude', 'memory');
const SESSIONS_DIR = join(MEMORY_DIR, 'sessions');

// Hot memory expires after 10 minutes
const HOT_MEMORY_TTL_MS = 10 * 60 * 1000;

// Warm memory expires after 24 hours of inactivity
const WARM_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

// Maximum entries per tier to prevent unbounded growth
const MAX_HOT_ENTRIES = 100;
const MAX_WARM_ENTRIES = 50;

/**
 * Hot memory entry - short-term, auto-expires
 */
export interface HotMemoryEntry {
  id: string;
  type: 'action' | 'file_touch' | 'error' | 'decision' | 'tool_output';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Warm memory entry - session-scoped, persists to disk
 */
export interface WarmMemoryEntry {
  id: string;
  type: 'goal' | 'context' | 'task_state' | 'user_preference' | 'conversation_summary';
  content: string;
  priority: number;  // 1-10, higher = more important to preserve
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Session state persisted to disk
 */
export interface SessionState {
  sessionId: string;
  startedAt: number;
  lastActivity: number;

  // Current task tracking
  currentGoal?: string;
  currentTask?: string;
  taskProgress?: string[];

  // File tracking
  filesOpened: string[];
  filesModified: string[];

  // Conversation context
  lastUserMessage?: string;
  lastAssistantAction?: string;
  pendingActions?: string[];

  // Error tracking
  recentErrors: Array<{ error: string; timestamp: number; resolved: boolean }>;

  // Hot memory (in-memory, not persisted directly but summarized)
  hotMemory: HotMemoryEntry[];

  // Warm memory (persisted)
  warmMemory: WarmMemoryEntry[];
}

/**
 * Working Memory Manager
 */
export class WorkingMemory {
  private sessionId: string;
  private state: SessionState;
  private sessionFile: string;
  private autosaveInterval?: ReturnType<typeof setInterval>;

  constructor(sessionId?: string) {
    this.ensureDirectories();

    // Use provided session ID or generate new one
    this.sessionId = sessionId || this.findActiveSession() || randomUUID();
    this.sessionFile = join(SESSIONS_DIR, `${this.sessionId}.json`);

    // Load existing session or create new
    this.state = this.loadSession() || this.createNewSession();

    // Start autosave (every 30 seconds)
    this.startAutosave();
  }

  /**
   * Ensure sessions directory exists
   */
  private ensureDirectories(): void {
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Find the most recent active session (if any)
   */
  private findActiveSession(): string | undefined {
    if (!existsSync(SESSIONS_DIR)) return undefined;

    const files = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const path = join(SESSIONS_DIR, f);
        try {
          const data = JSON.parse(readFileSync(path, 'utf-8')) as SessionState;
          return { id: f.replace('.json', ''), lastActivity: data.lastActivity };
        } catch {
          return null;
        }
      })
      .filter((s): s is { id: string; lastActivity: number } => s !== null)
      .sort((a, b) => b.lastActivity - a.lastActivity);

    // Return most recent session if it's within warm memory TTL
    if (files.length > 0 && Date.now() - files[0].lastActivity < WARM_MEMORY_TTL_MS) {
      return files[0].id;
    }

    return undefined;
  }

  /**
   * Load session from disk
   */
  private loadSession(): SessionState | null {
    if (!existsSync(this.sessionFile)) return null;

    try {
      const data = JSON.parse(readFileSync(this.sessionFile, 'utf-8')) as SessionState;

      // Clean expired hot memory
      const now = Date.now();
      data.hotMemory = (data.hotMemory || []).filter(
        entry => now - entry.timestamp < HOT_MEMORY_TTL_MS
      );

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Create new session state
   */
  private createNewSession(): SessionState {
    return {
      sessionId: this.sessionId,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      filesOpened: [],
      filesModified: [],
      recentErrors: [],
      hotMemory: [],
      warmMemory: [],
    };
  }

  /**
   * Start autosave interval
   */
  private startAutosave(): void {
    this.autosaveInterval = setInterval(() => {
      this.save();
    }, 30000);
  }

  /**
   * Stop autosave interval
   */
  public stopAutosave(): void {
    if (this.autosaveInterval) {
      clearInterval(this.autosaveInterval);
      this.autosaveInterval = undefined;
    }
  }

  /**
   * Save session to disk
   */
  public save(): void {
    this.state.lastActivity = Date.now();

    // Clean expired hot memory before saving
    const now = Date.now();
    this.state.hotMemory = this.state.hotMemory.filter(
      entry => now - entry.timestamp < HOT_MEMORY_TTL_MS
    );

    // Limit entries
    if (this.state.hotMemory.length > MAX_HOT_ENTRIES) {
      this.state.hotMemory = this.state.hotMemory.slice(-MAX_HOT_ENTRIES);
    }
    if (this.state.warmMemory.length > MAX_WARM_ENTRIES) {
      // Keep highest priority entries
      this.state.warmMemory = this.state.warmMemory
        .sort((a, b) => b.priority - a.priority)
        .slice(0, MAX_WARM_ENTRIES);
    }

    try {
      writeFileSync(this.sessionFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to save working memory:', error);
    }
  }

  /**
   * Clear session and start fresh
   */
  public clear(): void {
    this.state = this.createNewSession();
    this.save();
  }

  /**
   * End session (archive and clean up)
   */
  public endSession(): SessionState {
    this.stopAutosave();
    this.save();
    return this.state;
  }

  // ==================== HOT MEMORY ====================

  /**
   * Add hot memory entry (auto-expires after 10 minutes)
   */
  public addHot(entry: Omit<HotMemoryEntry, 'id' | 'timestamp'>): void {
    this.state.hotMemory.push({
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    });

    // Trim if over limit
    if (this.state.hotMemory.length > MAX_HOT_ENTRIES) {
      this.state.hotMemory = this.state.hotMemory.slice(-MAX_HOT_ENTRIES);
    }
  }

  /**
   * Get active hot memory (filters expired entries)
   */
  public getHot(type?: HotMemoryEntry['type']): HotMemoryEntry[] {
    const now = Date.now();
    const active = this.state.hotMemory.filter(
      entry => now - entry.timestamp < HOT_MEMORY_TTL_MS
    );

    if (type) {
      return active.filter(entry => entry.type === type);
    }
    return active;
  }

  /**
   * Get most recent hot memory entries
   */
  public getRecentHot(count: number = 10): HotMemoryEntry[] {
    return this.getHot().slice(-count);
  }

  // ==================== WARM MEMORY ====================

  /**
   * Add warm memory entry (persists until cleared)
   */
  public addWarm(entry: Omit<WarmMemoryEntry, 'id' | 'timestamp'>): void {
    this.state.warmMemory.push({
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    });
  }

  /**
   * Get warm memory by type
   */
  public getWarm(type?: WarmMemoryEntry['type']): WarmMemoryEntry[] {
    if (type) {
      return this.state.warmMemory.filter(entry => entry.type === type);
    }
    return this.state.warmMemory;
  }

  /**
   * Update warm memory entry
   */
  public updateWarm(id: string, updates: Partial<WarmMemoryEntry>): boolean {
    const index = this.state.warmMemory.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.state.warmMemory[index] = {
      ...this.state.warmMemory[index],
      ...updates,
      timestamp: Date.now(),
    };
    return true;
  }

  /**
   * Remove warm memory entry
   */
  public removeWarm(id: string): boolean {
    const index = this.state.warmMemory.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.state.warmMemory.splice(index, 1);
    return true;
  }

  // ==================== TASK TRACKING ====================

  /**
   * Set current goal
   */
  public setGoal(goal: string): void {
    this.state.currentGoal = goal;
    this.addWarm({
      type: 'goal',
      content: goal,
      priority: 10,  // Goals are highest priority
    });
  }

  /**
   * Set current task
   */
  public setTask(task: string): void {
    this.state.currentTask = task;
  }

  /**
   * Add task progress step
   */
  public addProgress(step: string): void {
    if (!this.state.taskProgress) {
      this.state.taskProgress = [];
    }
    this.state.taskProgress.push(step);

    // Keep only last 20 progress steps
    if (this.state.taskProgress.length > 20) {
      this.state.taskProgress = this.state.taskProgress.slice(-20);
    }
  }

  /**
   * Complete current task
   */
  public completeTask(): void {
    this.state.currentTask = undefined;
    this.state.taskProgress = [];
  }

  // ==================== FILE TRACKING ====================

  /**
   * Record file opened
   */
  public recordFileOpened(filePath: string): void {
    if (!this.state.filesOpened.includes(filePath)) {
      this.state.filesOpened.push(filePath);
    }

    this.addHot({
      type: 'file_touch',
      content: `Opened: ${filePath}`,
      metadata: { path: filePath, action: 'open' },
    });

    // Keep only last 50 files
    if (this.state.filesOpened.length > 50) {
      this.state.filesOpened = this.state.filesOpened.slice(-50);
    }
  }

  /**
   * Record file modified
   */
  public recordFileModified(filePath: string): void {
    if (!this.state.filesModified.includes(filePath)) {
      this.state.filesModified.push(filePath);
    }

    this.addHot({
      type: 'file_touch',
      content: `Modified: ${filePath}`,
      metadata: { path: filePath, action: 'modify' },
    });

    // Keep only last 30 modified files
    if (this.state.filesModified.length > 30) {
      this.state.filesModified = this.state.filesModified.slice(-30);
    }
  }

  // ==================== CONVERSATION TRACKING ====================

  /**
   * Record user message
   */
  public recordUserMessage(message: string): void {
    this.state.lastUserMessage = message.substring(0, 500);  // Truncate for storage

    this.addHot({
      type: 'action',
      content: `User: ${message.substring(0, 200)}`,
      metadata: { role: 'user' },
    });
  }

  /**
   * Record assistant action
   */
  public recordAssistantAction(action: string): void {
    this.state.lastAssistantAction = action;

    this.addHot({
      type: 'action',
      content: `Assistant: ${action}`,
      metadata: { role: 'assistant' },
    });
  }

  /**
   * Add pending action
   */
  public addPendingAction(action: string): void {
    if (!this.state.pendingActions) {
      this.state.pendingActions = [];
    }
    this.state.pendingActions.push(action);
  }

  /**
   * Complete pending action
   */
  public completePendingAction(action: string): void {
    if (this.state.pendingActions) {
      const index = this.state.pendingActions.indexOf(action);
      if (index !== -1) {
        this.state.pendingActions.splice(index, 1);
      }
    }
  }

  // ==================== ERROR TRACKING ====================

  /**
   * Record error
   */
  public recordError(error: string): void {
    this.state.recentErrors.push({
      error: error.substring(0, 500),
      timestamp: Date.now(),
      resolved: false,
    });

    this.addHot({
      type: 'error',
      content: error.substring(0, 200),
    });

    // Keep only last 10 errors
    if (this.state.recentErrors.length > 10) {
      this.state.recentErrors = this.state.recentErrors.slice(-10);
    }
  }

  /**
   * Mark error as resolved
   */
  public resolveError(errorSubstring: string): void {
    for (const err of this.state.recentErrors) {
      if (err.error.includes(errorSubstring) && !err.resolved) {
        err.resolved = true;
        break;
      }
    }
  }

  /**
   * Get unresolved errors
   */
  public getUnresolvedErrors(): string[] {
    return this.state.recentErrors
      .filter(e => !e.resolved)
      .map(e => e.error);
  }

  // ==================== CONTEXT GENERATION ====================

  /**
   * Generate resume context for session continuation
   * This is what gets injected after auto-compact or session resume
   */
  public generateResumeContext(): string {
    const lines: string[] = [];

    if (this.state.currentGoal) {
      lines.push(`CURRENT GOAL: ${this.state.currentGoal}`);
    }

    if (this.state.currentTask) {
      lines.push(`CURRENT TASK: ${this.state.currentTask}`);
    }

    if (this.state.taskProgress && this.state.taskProgress.length > 0) {
      lines.push(`PROGRESS:`);
      this.state.taskProgress.slice(-5).forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
    }

    if (this.state.lastUserMessage) {
      lines.push(`LAST USER MESSAGE: "${this.state.lastUserMessage.substring(0, 150)}..."`);
    }

    if (this.state.lastAssistantAction) {
      lines.push(`LAST ACTION: ${this.state.lastAssistantAction}`);
    }

    if (this.state.pendingActions && this.state.pendingActions.length > 0) {
      lines.push(`PENDING ACTIONS:`);
      this.state.pendingActions.forEach(action => {
        lines.push(`  - ${action}`);
      });
    }

    if (this.state.filesModified.length > 0) {
      lines.push(`RECENTLY MODIFIED FILES:`);
      this.state.filesModified.slice(-5).forEach(file => {
        lines.push(`  - ${file}`);
      });
    }

    const unresolvedErrors = this.getUnresolvedErrors();
    if (unresolvedErrors.length > 0) {
      lines.push(`UNRESOLVED ERRORS:`);
      unresolvedErrors.forEach(err => {
        lines.push(`  - ${err.substring(0, 100)}`);
      });
    }

    // Include high-priority warm memory
    const highPriorityWarm = this.state.warmMemory
      .filter(w => w.priority >= 7)
      .slice(0, 5);

    if (highPriorityWarm.length > 0) {
      lines.push(`IMPORTANT CONTEXT:`);
      highPriorityWarm.forEach(w => {
        lines.push(`  [${w.type}] ${w.content.substring(0, 100)}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Get full session state (for debugging or export)
   */
  public getState(): SessionState {
    return { ...this.state };
  }

  /**
   * Get session ID
   */
  public getSessionId(): string {
    return this.sessionId;
  }
}

// ==================== CLEANUP UTILITIES ====================

/**
 * Clean up old session files
 */
export function cleanupOldSessions(maxAgeMs: number = WARM_MEMORY_TTL_MS): number {
  if (!existsSync(SESSIONS_DIR)) return 0;

  const now = Date.now();
  let cleaned = 0;

  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const path = join(SESSIONS_DIR, file);
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as SessionState;
      if (now - data.lastActivity > maxAgeMs) {
        unlinkSync(path);
        cleaned++;
      }
    } catch {
      // If file is corrupted, delete it
      try {
        unlinkSync(path);
        cleaned++;
      } catch { /* ignore */ }
    }
  }

  return cleaned;
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): Array<{ id: string; lastActivity: number; goal?: string }> {
  if (!existsSync(SESSIONS_DIR)) return [];

  const sessions: Array<{ id: string; lastActivity: number; goal?: string }> = [];

  for (const f of readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;

    const filePath = join(SESSIONS_DIR, f);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionState;
      sessions.push({
        id: f.replace('.json', ''),
        lastActivity: data.lastActivity,
        goal: data.currentGoal,
      });
    } catch {
      // Skip corrupted files
    }
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

// Singleton instance for current session
let currentSession: WorkingMemory | null = null;

/**
 * Get or create the current working memory session
 */
export function getWorkingMemory(): WorkingMemory {
  if (!currentSession) {
    currentSession = new WorkingMemory();
  }
  return currentSession;
}

/**
 * Start a new working memory session
 */
export function startNewSession(): WorkingMemory {
  if (currentSession) {
    currentSession.endSession();
  }
  currentSession = new WorkingMemory();
  return currentSession;
}
