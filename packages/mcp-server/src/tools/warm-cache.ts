import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const LLM_URL = process.env.TOKEN_OPTIMIZER_LLM_URL ?? 'https://api.anthropic.com/v1/messages';
const LLM_KEY = process.env.TOKEN_OPTIMIZER_LLM_KEY ?? '';

export function registerWarmCache(server: McpServer) {
  server.tool(
    'warm_cache',
    'Pre-warm Anthropic prompt cache before a session. Converts cache creation cost ($3.75/1M) to cache read ($0.30/1M) for all subsequent requests. Cache TTL: ~5 minutes.',
    {
      system_prompt: z.string().describe('Exact system prompt that will be used in subsequent requests'),
      model: z.string().default('claude-sonnet-4-6').describe('Model to warm cache for'),
    },
    async ({ system_prompt, model }) => {
      const isOpenAICompat = LLM_URL.includes('/v1/chat/completions');
      const start = Date.now();

      let creation = 0, hit = 0;

      if (isOpenAICompat) {
        // OpenAI-compat: no explicit cache_control, cache is implicit
        const res = await fetch(LLM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [
              { role: 'system', content: system_prompt },
              { role: 'user', content: 'ping' },
            ],
          }),
        });
        const d = await res.json() as any;
        creation = d.usage?.prompt_tokens ?? 0;
      } else {
        // Anthropic native with cache_control
        const res = await fetch(LLM_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': LLM_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            system: [{ type: 'text', text: system_prompt, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
        const d = await res.json() as any;
        creation = d.usage?.cache_creation_input_tokens ?? 0;
        hit      = d.usage?.cache_read_input_tokens ?? 0;
      }

      const elapsed = Date.now() - start;
      const status = creation > 0 ? '✓ Cache warmed'
        : hit > 0 ? '✓ Cache already warm (hit)'
        : '⚠ Warm attempted (verify provider supports prompt caching)';

      return {
        content: [{
          type: 'text' as const,
          text: [
            `${status} (${elapsed}ms)`,
            creation > 0 ? `Created: ${creation} tokens cached` : '',
            hit > 0 ? `Cache hit: ${hit} tokens` : '',
            `Subsequent requests: $0.30/1M instead of $3.75/1M cache creation`,
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );
}
