/**
 * Configuration Management
 *
 * Handles API keys, settings, and persistence.
 * Config is stored in ~/.claude/memory/config.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MEMORY_DIR, ensureDirectories } from '../db/schema.js';
import { initOpenAI } from '../db/embeddings.js';
import type { MemoryConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

const CONFIG_PATH = join(MEMORY_DIR, 'config.json');

// In-memory config cache
let currentConfig: MemoryConfig | null = null;

/**
 * Load configuration from disk or environment
 */
export function loadConfig(): MemoryConfig {
  if (currentConfig) {
    return currentConfig;
  }

  ensureDirectories();

  let config: MemoryConfig = { ...DEFAULT_CONFIG };

  // Try to load from file
  if (existsSync(CONFIG_PATH)) {
    try {
      const fileContent = readFileSync(CONFIG_PATH, 'utf-8');
      const fileConfig = JSON.parse(fileContent) as Partial<MemoryConfig>;
      config = { ...config, ...fileConfig };
    } catch (error) {
      console.error('Failed to load config file:', error);
    }
  }

  // Override with environment variables
  if (process.env.OPENAI_API_KEY) {
    config.openai_api_key = process.env.OPENAI_API_KEY;
  }

  if (process.env.CLAUDE_MEMORY_AUTO_LEARN !== undefined) {
    config.auto_learn = process.env.CLAUDE_MEMORY_AUTO_LEARN === 'true';
  }

  currentConfig = config;

  // Initialize OpenAI if key is available
  if (config.openai_api_key) {
    initOpenAI(config.openai_api_key);
  }

  return config;
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: MemoryConfig): void {
  ensureDirectories();

  // Don't persist API key if it came from environment
  const configToSave = { ...config };
  if (process.env.OPENAI_API_KEY && config.openai_api_key === process.env.OPENAI_API_KEY) {
    // Don't save env var to file - keep using env var
    delete configToSave.openai_api_key;
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(configToSave, null, 2), 'utf-8');
  currentConfig = config;

  // Re-initialize OpenAI if key changed
  if (config.openai_api_key) {
    initOpenAI(config.openai_api_key);
  }
}

/**
 * Update specific config values
 */
export function updateConfig(updates: Partial<MemoryConfig>): MemoryConfig {
  const config = loadConfig();
  const newConfig = { ...config, ...updates };
  saveConfig(newConfig);
  return newConfig;
}

/**
 * Get current config (cached)
 */
export function getConfig(): MemoryConfig {
  return loadConfig();
}

/**
 * Check if OpenAI API key is configured
 */
export function hasApiKey(): boolean {
  const config = loadConfig();
  return !!config.openai_api_key;
}

/**
 * Set OpenAI API key
 */
export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.openai_api_key = apiKey;
  saveConfig(config);
  initOpenAI(apiKey);
}

/**
 * Get config for display (with API key redacted)
 */
export function getConfigForDisplay(): Record<string, unknown> {
  const config = loadConfig();
  return {
    openai_api_key: config.openai_api_key
      ? `sk-...${config.openai_api_key.slice(-4)}`
      : '(not set)',
    embedding_model: config.embedding_model,
    auto_learn: config.auto_learn,
    default_scope: config.default_scope,
    config_path: CONFIG_PATH,
  };
}

/**
 * Reset config to defaults
 */
export function resetConfig(): MemoryConfig {
  currentConfig = null;
  const config = { ...DEFAULT_CONFIG };

  // Keep API key from environment if available
  if (process.env.OPENAI_API_KEY) {
    config.openai_api_key = process.env.OPENAI_API_KEY;
  }

  saveConfig(config);
  return config;
}

/**
 * Validate config and return any issues
 */
export function validateConfig(): { valid: boolean; issues: string[] } {
  const config = loadConfig();
  const issues: string[] = [];

  if (!config.openai_api_key) {
    issues.push('OpenAI API key not configured. Semantic search will not work.');
  }

  if (!['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'].includes(config.embedding_model)) {
    issues.push(`Unknown embedding model: ${config.embedding_model}`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export { CONFIG_PATH };
