#!/usr/bin/env node
/**
 * Claude Memory MCP Server
 *
 * Provides persistent memory for Claude Code using AIME compression
 * and semantic search via OpenAI embeddings.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { openGlobalDb, hashProject } from './db/index.js';
import { loadConfig } from './config/index.js';
import {
  remember,
  rememberToolDef,
  recall,
  recallToolDef,
  refresh,
  refreshToolDef,
  forget,
  forgetToolDef,
  stats,
  statsToolDef,
  config,
  configToolDef,
  learn,
  learnToolDef,
  // Evolution tools (v2)
  feedback,
  feedbackToolDef,
  consolidate,
  consolidateToolDef,
  prune,
  pruneToolDef,
  // Import/Export tools (v2.1)
  exportMemories,
  exportToolDef,
  importMemories,
  importToolDef,
} from './tools/index.js';

// Initialize config and database
const appConfig = loadConfig();
const db = openGlobalDb();

// Get project hash from environment if available
const projectPath = process.env.CLAUDE_PROJECT_PATH || process.cwd();
const projectHash = hashProject(projectPath);

// Create MCP server
const server = new Server(
  {
    name: 'claude-memory',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      rememberToolDef,
      recallToolDef,
      refreshToolDef,
      forgetToolDef,
      statsToolDef,
      configToolDef,
      learnToolDef,
      // Evolution tools (v2)
      feedbackToolDef,
      consolidateToolDef,
      pruneToolDef,
      // Import/Export tools (v2.1)
      exportToolDef,
      importToolDef,
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'memory_remember': {
        const result = await remember(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_recall': {
        const result = await recall(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_refresh': {
        const result = await refresh(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_forget': {
        const result = await forget(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_stats': {
        const result = await stats(db, args?.scope as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_config': {
        const configArgs = args as any || {};
        const result = config(configArgs);

        // Auto-store config changes as memories (so we remember what was configured)
        if (configArgs.openai_api_key && result.success) {
          const keyPreview = configArgs.openai_api_key.slice(-4);
          await remember(db, {
            content: `Configuration: OpenAI API key set for semantic search (ending in ...${keyPreview}). This enables vector embeddings for better memory recall.`,
            type: 'fact',
            importance: 8,
            scope: 'global',
          }, undefined);
        }
        if (configArgs.auto_learn !== undefined && result.success) {
          await remember(db, {
            content: `Configuration: Auto-learn ${configArgs.auto_learn ? 'enabled' : 'disabled'}. ${configArgs.auto_learn ? 'System will automatically extract learnings from conversations.' : 'Manual memory storage only.'}`,
            type: 'fact',
            importance: 7,
            scope: 'global',
          }, undefined);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_learn': {
        const result = await learn(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Evolution tools (v2)
      case 'memory_feedback': {
        const result = await feedback(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_consolidate': {
        const result = await consolidate(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_prune': {
        const result = await prune(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Import/Export tools (v2.1)
      case 'memory_export': {
        const result = await exportMemories(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memory_import': {
        const result = await importMemories(db, args as any, projectHash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Handle cleanup
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

// Start the server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Claude Memory MCP server running');
  } catch (error) {
    console.error('Failed to connect transport:', error);
    throw error;
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  db.close();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
