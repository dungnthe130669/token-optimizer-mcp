import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateTokens, initAnalyticsDB, logSaving } from '../core/index.js';
import { callLLM } from '../llm-caller.js';

const DEFAULT_WINDOW = 10;
const MessageSchema = z.object({ role: z.string(), content: z.unknown() });
type Message = z.infer<typeof MessageSchema>;

function msgToText(m: Message): string {
  return `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
}

async function summarizeTurns(turns: Message[]): Promise<string> {
  const text = turns.map(msgToText).join('\n').slice(0, 30000);
  try {
    return await callLLM({
      prompt: `Summarize these AI conversation turns in ≤200 tokens. Preserve: decisions made, files changed, errors encountered, current task state, constraints. Omit: small talk, repeated attempts.\n\n${text}`,
      maxTokens: 300,
    });
  } catch (e) {
    return `[Summary unavailable — ${e}. ${turns.length} turns omitted.]`;
  }
}

export function registerCompressHistory(server: McpServer) {
  server.tool(
    'compress_history',
    'Compress conversation history by summarizing old turns and keeping recent N verbatim. Converts O(n) token cost to O(1). Call when history exceeds 20 turns.',
    {
      messages: z.array(MessageSchema).describe('Full conversation messages array'),
      window:   z.number().default(DEFAULT_WINDOW).describe('Recent turns to keep verbatim (default: 10)'),
    },
    async ({ messages, window }) => {
      if (messages.length <= window) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(messages) }] };
      }

      const tokensBefore = estimateTokens(messages.map(msgToText).join('\n'));
      const old    = messages.slice(0, messages.length - window);
      const recent = messages.slice(-window);
      const summary = await summarizeTurns(old);

      const compressed: Message[] = [
        { role: 'system', content: `[HISTORY SUMMARY — ${old.length} earlier turns]\n${summary}` },
        ...recent,
      ];

      const tokensAfter = estimateTokens(compressed.map(msgToText).join('\n'));

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
