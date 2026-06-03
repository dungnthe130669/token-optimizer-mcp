import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const LIMITS: Record<string, { max: number; reason: string }> = {
  yes_no:            { max: 50,   reason: 'Boolean / single-word answer' },
  tool_decision:     { max: 150,  reason: 'Agent picking next tool — no prose needed' },
  file_search:       { max: 300,  reason: 'List of file paths / line matches' },
  summarization:     { max: 400,  reason: 'Summary block' },
  explanation:       { max: 500,  reason: 'Technical explanation' },
  code_review:       { max: 800,  reason: 'Review comments with line refs' },
  debugging:         { max: 1000, reason: 'Root cause analysis + fix' },
  planning:          { max: 1500, reason: 'Plan with tasks' },
  code_generation:   { max: 2000, reason: 'Code block + brief explanation' },
  default:           { max: 1024, reason: 'General purpose fallback' },
};

function classify(desc: string): string {
  const d = desc.toLowerCase();
  if (/\b(yes|no|does|is |are |exists?|true|false)\b/.test(d)) return 'yes_no';
  if (/which tool|what tool|next (step|action)|should i/.test(d))  return 'tool_decision';
  if (/find|search|grep|list (files|functions|classes)/.test(d))   return 'file_search';
  if (/summar|tldr|brief|recap/.test(d))                           return 'summarization';
  if (/explain|how does|what is|describe/.test(d))                 return 'explanation';
  if (/review|check|audit|lint/.test(d))                           return 'code_review';
  if (/debug|error|fix|why (is|does|isn|doesn)/.test(d))          return 'debugging';
  if (/plan|tasks?|phases?|design arch/.test(d))                   return 'planning';
  if (/implement|write|create|generate|build/.test(d))             return 'code_generation';
  return 'default';
}

export function registerSuggestMaxTokens(server: McpServer) {
  server.tool(
    'suggest_max_tokens',
    'Return optimal max_tokens for a task. Output tokens cost 5x more than input — avoid over-allocating.',
    { task_description: z.string().describe('What the LLM is being asked to do') },
    async ({ task_description }) => {
      const type = classify(task_description);
      const { max, reason } = LIMITS[type];
      const defaultMax = LIMITS.default.max;
      const saved = Math.max(0, defaultMax - max);
      const costSavedPer1k = (saved / 1_000_000 * 15.0 * 1000).toFixed(4); // per 1000 requests
      return {
        content: [{
          type: 'text' as const,
          text: [
            `Task type: ${type}`,
            `Recommended max_tokens: ${max}`,
            `Reason: ${reason}`,
            `Vs default (${defaultMax}): saves ${saved} output tokens = $${costSavedPer1k} per 1000 requests`,
          ].join('\n'),
        }],
      };
    },
  );
}
