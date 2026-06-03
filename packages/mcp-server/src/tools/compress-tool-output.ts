import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateTokens, initAnalyticsDB, logSaving } from '@token-optimizer/core';
import { callLLM } from '../llm-caller.js';

const THRESHOLD_TOKENS = 2000;

async function compressWithCheapModel(content: string, context: string): Promise<string> {
  return callLLM({
    prompt: `Compress this tool output to under 300 tokens. Preserve: file paths, error messages, key numbers, decisions. Drop: verbose explanations, repeated info, formatting noise.\n\nContext (why this output was needed): ${context}\n\n---\n${content.slice(0, 20000)}`,
    maxTokens: 400,
  });
}

export function registerCompressToolOutput(server: McpServer) {
  server.tool(
    'compress_tool_output',
    'Compress large tool outputs (>2000 tokens) using a cheap model before injecting into context. Saves expensive input tokens on the main model.',
    {
      content: z.string().describe('Raw tool output to compress'),
      context: z.string().describe('Why was this tool called? What info is needed from it?'),
      force:   z.boolean().default(false).describe('Compress even if under threshold'),
    },
    async ({ content, context, force }) => {
      const tokensBefore = estimateTokens(content);
      if (!force && tokensBefore <= THRESHOLD_TOKENS) {
        return { content: [{ type: 'text' as const, text: `[No compression needed — ${tokensBefore} tokens]\n${content}` }] };
      }

      let compressed = content;
      try {
        compressed = await compressWithCheapModel(content, context);
      } catch (e) {
        // Fallback: truncate if LLM unavailable
        compressed = content.slice(0, THRESHOLD_TOKENS * 4) + `\n\n[TRUNCATED — LLM compression unavailable: ${e}]`;
      }

      const tokensAfter = estimateTokens(compressed);
      const pct = ((1 - tokensAfter / tokensBefore) * 100).toFixed(0);

      try {
        const db = initAnalyticsDB();
        logSaving(db, { tool: 'compress_tool_output', tokensBefore, tokensAfter });
        db.close();
      } catch { /* non-fatal */ }

      return {
        content: [{ type: 'text' as const, text: `[COMPRESSED ${pct}% — ${tokensBefore}→${tokensAfter} tokens]\n${compressed}` }],
      };
    },
  );
}
