import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { initAnalyticsDB, getSummary, getTotalSaved } from '../core/index.js';
import { registerEstimateTokens }        from './estimate-tokens.js';
import { registerCompressToolOutput }     from './compress-tool-output.js';
import { registerCompressHistory }        from './compress-history.js';
import { registerFilterActiveTools }      from './filter-active-tools.js';
import { registerDeduplicateContext }     from './deduplicate-context.js';
import { registerSuggestMaxTokens }       from './suggest-max-tokens.js';
import { registerWarmCache }              from './warm-cache.js';
import { registerPackContext }            from './pack-context.js';
import { registerSearchRelevantSkills }   from './search-relevant-skills.js';
import { readSessionUsage }               from './read-session-usage.js';

function registerReadSessionUsage(server: McpServer) {
  server.tool(
    'read_session_usage',
    'Read REAL token usage from ~/.claude/projects/*.jsonl — actual input/output/cache tokens per session from Claude Code API responses. More accurate than estimate_tokens.',
    {
      session_id: z.string().optional().describe('Specific session UUID to read (optional)'),
      last_n:     z.number().default(3).describe('Number of recent sessions to read (default: 3)'),
    },
    async (args) => {
      const result = await readSessionUsage(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}

function registerGetSavingsReport(server: McpServer) {
  server.tool(
    'get_savings_report',
    'Show token savings report from this MCP server. See how much each optimization tool has saved.',
    { days: z.number().default(7).describe('Lookback period in days') },
    async ({ days }) => {
      try {
        const db = initAnalyticsDB();
        const summary = getSummary(db, days);
        const total   = getTotalSaved(db, days);
        db.close();

        if (!summary.length) {
          return { content: [{ type: 'text' as const, text: `No savings recorded yet (last ${days} days). Start using the other tools to see savings accumulate.` }] };
        }

        const rows = summary.map(r =>
          `  ${r.tool.padEnd(26)} ${String(r.requests).padStart(5)} reqs  ${String(r.total_tokens_saved.toLocaleString()).padStart(10)} tokens  $${r.total_cost_saved.toFixed(4)}`
        ).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: [
              `Token Savings Report (last ${days} days)`,
              '─'.repeat(70),
              `  ${'Tool'.padEnd(26)} ${'Reqs'.padStart(5)}  ${'Tokens Saved'.padStart(10)}  Cost Saved`,
              '─'.repeat(70),
              rows,
              '─'.repeat(70),
              `  TOTAL${' '.repeat(21)} ${String(total.total_requests).padStart(5)}  ${String((total.total_tokens ?? 0).toLocaleString()).padStart(10)} tokens  $${(total.total_cost ?? 0).toFixed(4)}`,
            ].join('\n'),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading analytics: ${e}` }] };
      }
    },
  );
}

export function registerAllTools(server: McpServer) {
  registerSearchRelevantSkills(server);  // RAG: top-K skills only
  registerEstimateTokens(server);
  registerCompressToolOutput(server);
  registerCompressHistory(server);
  registerFilterActiveTools(server);
  registerDeduplicateContext(server);
  registerSuggestMaxTokens(server);
  registerWarmCache(server);
  registerPackContext(server);
  registerGetSavingsReport(server);
  registerReadSessionUsage(server);
}
