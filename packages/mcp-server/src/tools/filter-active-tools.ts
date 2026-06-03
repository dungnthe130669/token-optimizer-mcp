import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const TOOL_MAP: Record<string, string[]> = {
  file:       ['read_file', 'write_file', 'search_files', 'patch'],
  edit:       ['read_file', 'write_file', 'patch'],
  terminal:   ['terminal', 'process'],
  web:        ['web_search', 'web_extract', 'browser_navigate'],
  git:        ['terminal'],
  deploy:     ['terminal', 'browser_navigate'],
  search:     ['web_search', 'search_files', 'session_search'],
  image:      ['vision_analyze', 'image_gen'],
  email:      ['send_message'],
  code:       ['read_file', 'write_file', 'patch', 'terminal', 'search_files'],
  database:   ['terminal'],
  test:       ['terminal', 'read_file', 'search_files'],
  debug:      ['terminal', 'read_file', 'search_files'],
  read:       ['read_file', 'search_files'],
  write:      ['write_file', 'patch'],
};

const ALWAYS_INCLUDE = ['estimate_tokens'];

export function registerFilterActiveTools(server: McpServer) {
  server.tool(
    'filter_active_tools',
    'Return minimal tool list for a task. Restricting to only needed tools prevents 3000-5000 tokens of schema overhead per request.',
    { task: z.string().describe('Task description in plain language') },
    async ({ task }) => {
      const lower = task.toLowerCase();
      const matched = new Set<string>(ALWAYS_INCLUDE);
      for (const [kw, tools] of Object.entries(TOOL_MAP)) {
        if (lower.includes(kw)) tools.forEach(t => matched.add(t));
      }
      const list = [...matched];
      return {
        content: [{
          type: 'text' as const,
          text: `Minimal toolset for: "${task}"\n\nTools:\n${list.map(t => `- ${t}`).join('\n')}\n\nPass as enabled_toolsets in delegate_task or cron job to eliminate ~3000-5000 tokens of unused tool schemas.`,
        }],
      };
    },
  );
}
