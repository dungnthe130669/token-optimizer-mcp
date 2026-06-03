import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateTokens, initAnalyticsDB, logSaving } from '@token-optimizer/core';

const LLM_URL = process.env.TOKEN_OPTIMIZER_LLM_URL ?? 'https://api.anthropic.com/v1/messages';
const LLM_KEY = process.env.TOKEN_OPTIMIZER_LLM_KEY ?? '';
const DEFAULT_WINDOW = 10;

const MessageSchema = z.object({ role: z.string(), content: z.unknown() });
type Message = z.infer<typeof MessageSchema>;

function msgToText(m: Message): string {
  if (typeof m.content === 'string') return `${m.role}: ${m.content}`;
  return `${m.role}: ${JSON.stringify(m.content)}`;
}

async function summarizeTurns(turns: Message[]): Promise<string> {
  const text = turns.map(msgToText).join('\n').slice(0, 30000);
  const prompt = `Summarize these AI conversation turns in ≤200 tokens. Preserve: decisions made, files changed, errors encountered, current task state, constraints. Omit: small talk, repeated attempts.\n\n${text}`;
  const isOpenAICompat = LLM_URL.includes('/v1/chat/completions');

  if (isOpenAICompat) {
    const res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: process.env.TOKEN_OPTIMIZER_CHEAP_MODEL ?? 'claude-haiku-4',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await res.json() as any;
    return d.choices?.[0]?.message?.content ?? '[summary failed]';
  }

  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': LLM_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.TOKEN_OPTIMIZER_CHEAP_MODEL ?? 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const d = await res.json() as any;
  return d.content?.[0]?.text ?? '[summary failed]';
}

export function registerCompressHistory(server: McpServer) {
  server.tool(
    'compress_history',
    'Compress conversation history by summarizing old turns and keeping recent N verbatim. Converts O(n) token cost to O(1). Call when history exceeds 20 turns.',
    {
      messages: z.array(MessageSchema).describe('Full conversation messages array'),
      window:   z.number().default(DEFAULT_WINDOW).describe('Number of recent turns to keep verbatim (default: 10)'),
    },
    async ({ messages, window }) => {
      if (messages.length <= window) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(messages) }] };
      }

      const textBefore = messages.map(msgToText).join('\n');
      const tokensBefore = estimateTokens(textBefore);

      const old    = messages.slice(0, messages.length - window);
      const recent = messages.slice(-window);
      const summary = await summarizeTurns(old);

      const compressed: Message[] = [
        { role: 'system', content: `[HISTORY SUMMARY — ${old.length} earlier turns]\n${summary}` },
        ...recent,
      ];

      const textAfter = compressed.map(msgToText).join('\n');
      const tokensAfter = estimateTokens(textAfter);

      try {
        const db = initAnalyticsDB();
        logSaving(db, { tool: 'compress_history', tokensBefore, tokensAfter });
        db.close();
      } catch { /* non-fatal */ }

      return {
        content: [{
          type: 'text' as const,
          text: `[HISTORY COMPRESSED: ${messages.length} turns → ${compressed.length} (${tokensBefore}→${tokensAfter} tokens)]\n${JSON.stringify(compressed)}`,
        }],
      };
    },
  );
}
