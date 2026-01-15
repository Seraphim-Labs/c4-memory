/**
 * memory_config - Configure memory system settings
 */

import type { ConfigInput } from '../types.js';
import {
  getConfigForDisplay,
  setApiKey,
  updateConfig,
  validateConfig,
  hasApiKey,
} from '../config/index.js';

export interface ConfigResult {
  success: boolean;
  config?: Record<string, unknown>;
  message: string;
  warnings?: string[];
}

/**
 * Configure memory system settings
 */
export function config(input: ConfigInput): ConfigResult {
  // Show current config
  if (input.show) {
    const currentConfig = getConfigForDisplay();
    const validation = validateConfig();

    return {
      success: true,
      config: currentConfig,
      message: 'Current configuration:',
      warnings: validation.issues.length > 0 ? validation.issues : undefined,
    };
  }

  // Set API key
  if (input.openai_api_key) {
    setApiKey(input.openai_api_key);

    return {
      success: true,
      config: getConfigForDisplay(),
      message: 'OpenAI API key configured successfully. Semantic search is now enabled.',
    };
  }

  // Set auto-learn
  if (input.auto_learn !== undefined) {
    updateConfig({ auto_learn: input.auto_learn });

    return {
      success: true,
      config: getConfigForDisplay(),
      message: `Auto-learning ${input.auto_learn ? 'enabled' : 'disabled'}.`,
    };
  }

  // No action specified - show help
  return {
    success: true,
    config: getConfigForDisplay(),
    message: `Memory system configuration. Use parameters to update settings:
- openai_api_key: Set your OpenAI API key for semantic search
- auto_learn: Enable/disable automatic learning (true/false)
- show: Display current configuration`,
    warnings: !hasApiKey() ? ['OpenAI API key not configured. Semantic search is disabled.'] : undefined,
  };
}

/**
 * Tool definition for MCP
 */
export const configToolDef = {
  name: 'memory_config',
  description: 'Configure memory system settings including API keys and auto-learning preferences.',
  inputSchema: {
    type: 'object',
    properties: {
      openai_api_key: {
        type: 'string',
        description: 'Set the OpenAI API key for semantic search. Required for best recall accuracy.',
      },
      auto_learn: {
        type: 'boolean',
        description: 'Enable or disable automatic learning from conversations.',
      },
      show: {
        type: 'boolean',
        description: 'Display current configuration settings.',
      },
    },
  },
};
