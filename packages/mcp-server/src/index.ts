#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';

const server = new McpServer({
  name: 'token-optimizer',
  version: '0.1.3',
});

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[token-optimizer] MCP server ready');
