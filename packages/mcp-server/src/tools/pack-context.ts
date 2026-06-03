import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { deflateSync, inflateSync } from 'zlib';

const ContextSchema = z.object({
  task:           z.string().describe('Current task description'),
  decisions:      z.array(z.string()).default([]).describe('Key decisions made so far'),
  files_modified: z.array(z.string()).default([]).describe('Files created or modified'),
  current_state:  z.string().default('').describe('Where we are in the task'),
  constraints:    z.array(z.string()).default([]).describe('Rules/constraints to follow'),
  errors:         z.array(z.string()).default([]).describe('Errors encountered'),
});

export function registerPackContext(server: McpServer) {
  server.tool(
    'pack_context',
    'Compress structured context to a compact base64 string for multi-agent handoff. Pass to subagent instead of full conversation history — saves 5000-10000 tokens per subagent.',
    { context: ContextSchema },
    async ({ context }) => {
      const json = JSON.stringify(context);
      const packed = deflateSync(Buffer.from(json)).toString('base64');
      const ratio = ((1 - packed.length / json.length) * 100).toFixed(0);
      return {
        content: [{
          type: 'text' as const,
          text: `Packed context (${ratio}% compression, ${packed.length} chars vs ${json.length} raw):\n\n${packed}\n\nPass this string to subagent and call unpack_context to restore.`,
        }],
      };
    },
  );

  server.tool(
    'unpack_context',
    'Restore context packed by pack_context. Call at subagent start to get task state without needing full conversation history.',
    { packed: z.string().describe('Base64 packed string from pack_context') },
    async ({ packed }) => {
      try {
        const json = inflateSync(Buffer.from(packed, 'base64')).toString();
        const context = JSON.parse(json);
        return {
          content: [{
            type: 'text' as const,
            text: `Unpacked context:\n${JSON.stringify(context, null, 2)}`,
          }],
        };
      } catch (e) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error unpacking context: ${e instanceof Error ? e.message : String(e)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
