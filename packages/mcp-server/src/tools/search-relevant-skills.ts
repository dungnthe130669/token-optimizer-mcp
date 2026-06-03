import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { search } from '@token-optimizer/rag-store';

export function registerSearchRelevantSkills(server: McpServer) {
  server.tool(
    'search_relevant_skills',
    'Search for relevant skills/docs by semantic similarity. Returns name + description only (NOT full content) — agent loads only what it needs. Prevents injecting all skills into system prompt (~1500 tokens/turn saved).',
    {
      query:        z.string().describe('Task description or question to find relevant skills for'),
      top_k:        z.number().default(3).describe('Max results (default: 3)'),
      full_content: z.boolean().default(false).describe('Include full skill content (expensive — use only if needed)'),
    },
    async ({ query, top_k, full_content }) => {
      try {
        const results = await search(query, { topK: top_k, fullContent: full_content });
        if (!results.length) {
          return { content: [{ type: 'text' as const, text: 'No relevant skills found. Try re-indexing with: npx token-optimizer-rag index' }] };
        }
        const text = results.map(r =>
          [
            `**${r.name}** (${(r.similarity * 100).toFixed(0)}% match)`,
            `  ${r.description}`,
            full_content && 'content' in r ? `\n${(r as any).content}` : '',
          ].filter(Boolean).join('\n')
        ).join('\n\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (e: any) {
        if (e.message?.includes('no such table')) {
          return { content: [{ type: 'text' as const, text: 'RAG store not initialized. Run: npx token-optimizer-rag index ~/.hermes/skills' }] };
        }
        throw e;
      }
    },
  );
}
