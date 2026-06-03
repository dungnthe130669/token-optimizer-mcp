import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateTokens, initAnalyticsDB, logSaving } from '@token-optimizer/core';

const THRESHOLD_TOKENS = 2000;
const LLM_URL = process.env.TOKEN_OPTIMIZER_LLM_URL ?? 'https://api.anthropic.com/v1/messages';
const LLM_KEY = process.env.TOKEN_OPTIMIZER_LLM_KEY ?? '';

async function compressWithCheapModel(content: string, context: string): Promise<string> {
  // Use OpenAI-compatible endpoint if configured, else Anthropic
  const isOpenAICompat = LLM_URL.includes('/v1/chat/completions');

  const prompt = `Compress this tool output to under 300 tokens. Preserve: file paths, error messages, key numbers, decisions. Drop: verbose explanations, repeated info, formatting noise.\n\nContext (why this output was needed): ${context}\n\n---\n${content.slice(0, 20000)}`;

  if (isOpenAICompat) {
    const res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: process.env.TOKEN_OPTIMIZER_CHEAP_MODEL ?? 'claude-haiku-4',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? content;
  }

  // Anthropic native
  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': LLM_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.TOKEN_OPTIMIZER_CHEAP_MODEL ?? 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json() as any;
  return data.content?.[0]?.text ?? content;
}

export function registerCompressToolOutput(server: McpServer) {
  server.tool(
    'compress_tool_output',
    'Compress large tool outputs (>2000 tokens) using a cheap model before injecting into context. Saves expensive input tokens on the main model.',
    {
      content: z.string().describe('Raw tool output to compress'),
      context: z.string().describe('Why was this tool called? What info is needed from it?'),
      force: z.boolean().default(false).describe('Compress even if under threshold'),
    },
    async ({ content, context, force }) => {
      const tokensBefore = estimateTokens(content);
      const shouldCompress = force || tokensBefore > THRESHOLD_TOKENS;

      if (!shouldCompress) {
        return {
          content: [{
            type: 'text' as const,
            text: `[No compression needed — ${tokensBefore} tokens]\n${content}`,
          }],
        };
      }

      const compressed = await compressWithCheapModel(content, context);
      const tokensAfter = estimateTokens(compressed);
      const pct = ((1 - tokensAfter / tokensBefore) * 100).toFixed(0);

      // Log savings
      try {
        const db = initAnalyticsDB();
        logSaving(db, { tool: 'compress_tool_output', tokensBefore, tokensAfter });
        db.close();
      } catch { /* non-fatal */ }

      return {
        content: [{
          type: 'text' as const,
          text: `[COMPRESSED ${pct}% — ${tokensBefore}→${tokensAfter} tokens]\n${compressed}`,
        }],
      };
    },
  );
}
