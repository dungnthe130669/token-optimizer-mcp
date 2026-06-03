import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import { estimateTokens, initAnalyticsDB, logSaving } from '@token-optimizer/core';

const MessageSchema = z.object({ role: z.string(), content: z.unknown() });

function extractStrings(val: unknown): string[] {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val.flatMap(extractStrings);
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    return [...extractStrings(o['text']), ...extractStrings(o['content'])];
  }
  return [];
}

export function registerDeduplicateContext(server: McpServer) {
  server.tool(
    'deduplicate_context',
    'Replace repeated file/tool content in messages with back-references. Reduces 40-60% tokens in code-heavy sessions where the same files are read multiple times.',
    {
      messages:   z.array(MessageSchema).describe('Conversation messages to deduplicate'),
      min_length: z.number().default(500).describe('Min chars to consider for dedup (default: 500)'),
    },
    async ({ messages, min_length }) => {
      const textBefore = JSON.stringify(messages);
      const tokensBefore = estimateTokens(textBefore);

      const seen = new Map<string, number>(); // hash → turn index
      let savedChars = 0;

      const deduped = messages.map((msg, idx) => {
        const texts = extractStrings(msg.content).filter(t => t.length >= min_length);
        let raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

        for (const text of texts) {
          const hash = createHash('sha1').update(text).digest('hex').slice(0, 8);
          if (seen.has(hash)) {
            const ref = seen.get(hash)!;
            raw = raw.replace(text, `[DUPLICATE of turn ${ref} — hash:${hash} — ${text.length} chars omitted]`);
            savedChars += text.length;
          } else {
            seen.set(hash, idx);
          }
        }
        return { ...msg, content: raw };
      });

      const tokensAfter = estimateTokens(JSON.stringify(deduped));
      const pct = ((1 - tokensAfter / tokensBefore) * 100).toFixed(0);

      try {
        const db = initAnalyticsDB();
        logSaving(db, { tool: 'deduplicate_context', tokensBefore, tokensAfter });
        db.close();
      } catch { /* non-fatal */ }

      return {
        content: [{
          type: 'text' as const,
          text: `[DEDUPED ${pct}% — ${savedChars.toLocaleString()} chars removed (~${tokensBefore - tokensAfter} tokens saved)]\n${JSON.stringify(deduped)}`,
        }],
      };
    },
  );
}
