import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateTokens, tokensToUsd } from '@token-optimizer/core';

export function registerEstimateTokens(server: McpServer) {
  server.tool(
    'estimate_tokens',
    'Estimate token count + cost of text before sending to LLM. Use to decide whether compression is needed.',
    {
      text: z.string().describe('Text to estimate'),
      model: z.string().default('claude-sonnet-4').describe('Target model for cost estimate'),
    },
    async ({ text, model }) => {
      const tokens = estimateTokens(text);
      const inputCost  = tokensToUsd(tokens, model, 'input');
      const outputCost = tokensToUsd(tokens, model, 'output');
      return {
        content: [{
          type: 'text' as const,
          text: [
            `Estimated tokens: ${tokens.toLocaleString()}`,
            `If input  (${model}): $${inputCost.toFixed(6)}`,
            `If output (${model}): $${outputCost.toFixed(6)}`,
            tokens > 2000
              ? `⚠️  Large — consider compress_tool_output or compress_history`
              : `✓ Small — safe to inject directly`,
          ].join('\n'),
        }],
      };
    },
  );
}
