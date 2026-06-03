# Token Optimizer — Full Stack Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a full-stack token optimization layer that sits between Claude Code / any agent and the LLM API, reducing token consumption via context compression, smart routing, prompt caching, and RAG-based skill injection.

**Architecture:**
```
[Claude Code / Agent]
        ↓
[Token Gate — MCP Server]   ← 9 tools, intercept mọi layer
        ↓
[LLM API (Vertex/Azure/etc)]
        ↑
[RAG Skill Store]            ← inject top-3 relevant skills only
[History Compressor]         ← sliding window + summary
[Content Cache]              ← deduplicate repeated file reads
[Cache Warmer]               ← pre-warm prompt cache on startup
[Analytics DB (SQLite)]      ← track savings per tool
```

**Tech Stack:**
- MCP Server: TypeScript + `@modelcontextprotocol/sdk`
- RAG: `sqlite-vec` (local, zero infra) + `@xenova/transformers` embeddings
- Analytics: SQLite (`better-sqlite3`, standalone — no 9router dependency)
- LLM calls (compression): direct Anthropic/OpenAI-compatible API fetch

---

## Phase 1: Foundation — Analytics & Baseline

### Task 1: Bootstrap project repo

**Objective:** Set up monorepo structure for all components.

**Files:**
- Create: `~/Personal/projects/token-optimizer/package.json`
- Create: `~/Personal/projects/token-optimizer/packages/mcp-server/`
- Create: `~/Personal/projects/token-optimizer/packages/rag-store/`
- Create: `~/Personal/projects/token-optimizer/packages/middleware/`

**Steps:**

```bash
cd ~/Personal/projects/token-optimizer
cat > package.json << 'EOF'
{
  "name": "token-optimizer",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "tsc -b packages/*/tsconfig.json",
    "dev": "node packages/mcp-server/dist/index.js"
  }
}
EOF
mkdir -p packages/mcp-server/src packages/rag-store/src packages/middleware/src
```

**Commit:** `chore: init token-optimizer monorepo`

---

### Task 2: Standalone analytics DB + baseline logger

**Objective:** Init SQLite DB riêng (không dùng 9router), log token usage + savings per request.

**Files:**
- Create: `packages/analytics/src/db.ts`

**Code:**
```typescript
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const DB_PATH = join(homedir(), '.token-optimizer', 'analytics.sqlite');

export function initAnalyticsDB() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY,
      timestamp TEXT,
      tool TEXT,
      tokens_before INTEGER,
      tokens_after INTEGER,
      tokens_saved INTEGER,
      cost_saved_usd REAL,
      model TEXT,
      metadata TEXT -- JSON blob
    );
  `);
  return db;
}

const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-haiku-4':  { input: 0.25, output: 1.25 },
  default:           { input: 3.0, output: 15.0 },
};

export function logSaving(db: ReturnType<typeof initAnalyticsDB>, opts: {
  tool: string; tokensBefore: number; tokensAfter: number; model?: string; metadata?: object;
}) {
  const model = opts.model ?? 'default';
  const price = PRICES[model] ?? PRICES.default;
  const saved = opts.tokensBefore - opts.tokensAfter;
  const costSaved = (saved / 1_000_000) * price.input;
  db.prepare(`INSERT INTO requests(timestamp,tool,tokens_before,tokens_after,tokens_saved,cost_saved_usd,model,metadata)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    new Date().toISOString(), opts.tool,
    opts.tokensBefore, opts.tokensAfter, saved, costSaved,
    model, JSON.stringify(opts.metadata ?? {})
  );
  return { saved, costSaved };
}

export function getSummary(db: ReturnType<typeof initAnalyticsDB>, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.prepare(`
    SELECT tool, SUM(tokens_saved) as totalTokens, SUM(cost_saved_usd) as totalCost, COUNT(*) as reqs
    FROM requests WHERE timestamp > ? GROUP BY tool ORDER BY totalCost DESC
  `).all(since);
}
```

**Commit:** `feat: standalone analytics DB (no 9router dependency)`

---

## Phase 2: RAG Skill Store

**Goal:** Replace "inject all skills into system prompt" with "vector search → inject only top-K relevant skills". Saves ~2000 tokens/turn for Hermes.

### Task 3: Install sqlite-vec + build embedding pipeline

**Objective:** Set up local vector store using sqlite-vec (zero infra, works offline).

**Files:**
- Create: `packages/rag-store/src/embed.ts`
- Create: `packages/rag-store/package.json`

**Install:**
```bash
cd packages/rag-store
npm init -y
npm install sqlite-vec better-sqlite3 @xenova/transformers
npm install -D typescript @types/better-sqlite3
```

**Code — `embed.ts`:**
```typescript
import { pipeline } from '@xenova/transformers';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const MODEL = 'Xenova/all-MiniLM-L6-v2'; // 22MB, runs local

export async function initDB(dbPath: string) {
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE,
      description TEXT,
      content TEXT,
      updated_at TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS skill_embeddings
      USING vec0(embedding FLOAT[384]);
  `);
  return db;
}

export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await pipeline('feature-extraction', MODEL);
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

export async function upsertSkill(
  db: ReturnType<typeof Database>,
  name: string,
  description: string,
  content: string
) {
  const embedding = await embedText(`${name}: ${description}`);
  const existing = db.prepare('SELECT id FROM skills WHERE name = ?').get(name) as any;
  if (existing) {
    db.prepare('UPDATE skills SET description=?, content=?, updated_at=? WHERE name=?')
      .run(description, content, new Date().toISOString(), name);
    db.prepare('UPDATE skill_embeddings SET embedding=? WHERE rowid=?')
      .run(embedding, existing.id);
  } else {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO skills(name, description, content, updated_at) VALUES(?,?,?,?)'
    ).run(name, description, content, new Date().toISOString());
    db.prepare('INSERT INTO skill_embeddings(rowid, embedding) VALUES(?,?)')
      .run(lastInsertRowid, embedding);
  }
}

export async function searchSkills(
  db: ReturnType<typeof Database>,
  query: string,
  topK = 3
): Promise<Array<{ name: string; description: string; content: string; distance: number }>> {
  const queryEmb = await embedText(query);
  const rows = db.prepare(`
    SELECT s.name, s.description, s.content, e.distance
    FROM skill_embeddings e
    JOIN skills s ON s.id = e.rowid
    WHERE e.embedding MATCH ? AND k = ?
    ORDER BY e.distance
  `).all(queryEmb, topK) as any[];
  return rows;
}
```

**Commit:** `feat: add sqlite-vec RAG skill store with local embeddings`

---

### Task 4: Skill indexer — import all Hermes skills into vector store

**Objective:** Parse SKILL.md files, extract name+description, embed, store.

**Files:**
- Create: `packages/rag-store/src/indexer.ts`

**Code:**
```typescript
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { initDB, upsertSkill } from './embed.js';

const SKILLS_DIR = '/Users/dung.nguyentien/.hermes/skills';
const DB_PATH = '/Users/dung.nguyentien/.hermes/rag-store.sqlite';

async function findSkillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) files.push(...await findSkillFiles(join(dir, e.name)));
    else if (e.name === 'SKILL.md') files.push(join(dir, e.name));
  }
  return files;
}

function parseSkillMd(content: string): { name: string; description: string } | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*["']?(.+?)["']?$/m);
  if (!nameMatch || !descMatch) return null;
  return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
}

async function main() {
  const db = await initDB(DB_PATH);
  const files = await findSkillFiles(SKILLS_DIR);
  console.log(`Found ${files.length} skill files`);
  
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const meta = parseSkillMd(content);
    if (!meta) { console.warn(`Skip: ${file}`); continue; }
    await upsertSkill(db, meta.name, meta.description, content);
    console.log(`Indexed: ${meta.name}`);
  }
  console.log('Done. RAG store ready.');
}

main().catch(console.error);
```

**Run:** `npx ts-node packages/rag-store/src/indexer.ts`

**Commit:** `feat: skill indexer — import all SKILL.md into vector store`

---

### Task 5: RAG query CLI — verify search works

**Objective:** Test vector search returns relevant skills for a given query.

**Files:**
- Create: `packages/rag-store/src/query-cli.ts`

**Code:**
```typescript
import { initDB, searchSkills } from './embed.js';

const DB_PATH = '/Users/dung.nguyentien/.hermes/rag-store.sqlite';

async function main() {
  const query = process.argv.slice(2).join(' ');
  if (!query) { console.error('Usage: query-cli <query text>'); process.exit(1); }
  
  const db = await initDB(DB_PATH);
  const results = await searchSkills(db, query, 3);
  
  console.log(`\nTop 3 skills for: "${query}"\n`);
  for (const r of results) {
    console.log(`[${r.distance.toFixed(4)}] ${r.name}`);
    console.log(`  ${r.description}\n`);
  }
}

main().catch(console.error);
```

**Test:**
```bash
npx ts-node packages/rag-store/src/query-cli.ts "deploy kubernetes container"
# Expected: devops-related skills in top 3

npx ts-node packages/rag-store/src/query-cli.ts "write tests for python code"
# Expected: tdd, github-pr-workflow, etc.
```

**Commit:** `feat: RAG query CLI for skill search verification`

---

## Phase 3: MCP Server — Token Gate

**Goal:** MCP server exposing tools that Claude Code / Hermes can call to optimize context before sending to LLM.

### Task 6: MCP server scaffold

**Objective:** Working MCP server skeleton with stdio transport.

**Files:**
- Create: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`

**Install:**
```bash
cd packages/mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node tsx
```

**Code — `index.ts`:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';

const server = new McpServer({
  name: 'token-optimizer',
  version: '1.0.0',
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Token Optimizer MCP server running');
```

**Commit:** `feat: MCP server scaffold with stdio transport`

---

### Task 7: Tool — `search_relevant_skills`

**Objective:** Given a user query, return top-K relevant skill names + descriptions (NOT full content). Agent decides what to load.

**Files:**
- Create: `packages/mcp-server/src/tools/search-skills.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { searchSkills } from '../../rag-store/src/embed.js';

const DB_PATH = '/Users/dung.nguyentien/.hermes/rag-store.sqlite';

export function registerSearchSkills(server: McpServer) {
  server.tool(
    'search_relevant_skills',
    'Search for skills relevant to a task — returns name+description only (NOT full content). Use to avoid injecting irrelevant skills into context.',
    {
      query: z.string().describe('Task description or question'),
      top_k: z.number().default(3).describe('Max skills to return'),
    },
    async ({ query, top_k }) => {
      const db = new Database(DB_PATH);
      sqliteVec.load(db);
      const results = await searchSkills(db, query, top_k);
      db.close();
      
      const text = results
        .map(r => `**${r.name}** (relevance: ${(1 - r.distance).toFixed(2)})\n  ${r.description}`)
        .join('\n\n');
      
      return {
        content: [{ type: 'text', text: text || 'No relevant skills found.' }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool search_relevant_skills via RAG`

---

### Task 8: Tool — `compress_tool_output`

**Objective:** Summarize large tool outputs (file reads, search results) using haiku before they enter context.

**Files:**
- Create: `packages/mcp-server/src/tools/compress-output.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const ROUTER_URL = 'http://192.168.1.23:10130/v1/chat/completions';
const COMPRESS_THRESHOLD = 2000; // tokens (approx 8000 chars)

async function compressWithHaiku(content: string, context: string): Promise<string> {
  const res = await fetch(ROUTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify({
      model: 'claude-haiku-4', // cheap model for compression
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Compress this tool output to under 300 tokens. Keep: key facts, file paths, error messages, numbers. Context of why we needed this: "${context}"\n\n---\n${content}`,
      }],
    }),
  });
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || content;
}

export function registerCompressOutput(server: McpServer) {
  server.tool(
    'compress_tool_output',
    'Compress large tool outputs (>2000 tokens) using a cheap model before injecting into context. Saves expensive input tokens.',
    {
      content: z.string().describe('Raw tool output to compress'),
      context: z.string().describe('Why was this tool called? What info do we need?'),
      force: z.boolean().default(false).describe('Compress even if under threshold'),
    },
    async ({ content, context, force }) => {
      const isLarge = content.length > COMPRESS_THRESHOLD * 4; // ~4 chars/token
      if (!isLarge && !force) {
        return { content: [{ type: 'text', text: content }] };
      }
      const compressed = await compressWithHaiku(content, context);
      const ratio = ((1 - compressed.length / content.length) * 100).toFixed(0);
      return {
        content: [{
          type: 'text',
          text: `[COMPRESSED ${ratio}% reduction]\n${compressed}`,
        }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool compress_tool_output via haiku`

---

### Task 9: Tool — `estimate_tokens`

**Objective:** Estimate token count of text before sending — lets agent decide if compression needed.

**Files:**
- Create: `packages/mcp-server/src/tools/estimate-tokens.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Claude tokenizer approximation: ~3.5 chars/token for code, ~4.5 for prose
function estimateTokens(text: string): number {
  const codeLines = (text.match(/```[\s\S]*?```/g) || []).join('').length;
  const proseLength = text.length - codeLines;
  return Math.ceil(codeLines / 3.5 + proseLength / 4.5);
}

export function registerEstimateTokens(server: McpServer) {
  server.tool(
    'estimate_tokens',
    'Estimate token count of text. Use before deciding whether to compress or truncate.',
    {
      text: z.string().describe('Text to estimate'),
    },
    async ({ text }) => {
      const estimated = estimateTokens(text);
      const cost_input_sonnet = (estimated / 1_000_000 * 3.0).toFixed(6);
      const cost_output_sonnet = (estimated / 1_000_000 * 15.0).toFixed(6);
      return {
        content: [{
          type: 'text',
          text: `Estimated tokens: ${estimated.toLocaleString()}\n` +
                `If input (sonnet): $${cost_input_sonnet}\n` +
                `If output (sonnet): $${cost_output_sonnet}`,
        }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool estimate_tokens with cost preview`

---

---

## Phase 4: MCP Tools — History, Cache, Dedup, Output Control

**Goal:** 6 tools bổ sung cover các layer chưa được tối ưu.

### Task 10: Tool — `compress_history`

**Objective:** Sliding window compression — giữ N turns gần nhất verbatim, turns cũ → summary block. Biến O(n) cost thành O(1).

**Files:**
- Create: `packages/mcp-server/src/tools/compress-history.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const LLM_URL = process.env.LLM_URL ?? 'http://localhost:11434/v1/chat/completions';
const LLM_KEY = process.env.LLM_KEY ?? 'test';
const WINDOW = 10; // keep last N turns verbatim

interface Message { role: string; content: unknown }

async function summarizeTurns(turns: Message[]): Promise<string> {
  const text = turns.map(m =>
    `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
  ).join('\n');
  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: 'claude-haiku-4',
      max_tokens: 300,
      messages: [{ role: 'user', content: `Summarize these conversation turns in ≤200 tokens. Keep: decisions made, files changed, errors found, current task state.\n\n${text}` }],
    }),
  });
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? '[summary unavailable]';
}

export function registerCompressHistory(server: McpServer) {
  server.tool(
    'compress_history',
    'Compress conversation history: summarize old turns, keep recent N verbatim. Converts O(n) token cost to O(1). Call when history exceeds 20 turns.',
    {
      messages: z.array(z.object({ role: z.string(), content: z.unknown() }))
        .describe('Full conversation messages array'),
      window: z.number().default(WINDOW).describe('Turns to keep verbatim'),
    },
    async ({ messages, window }) => {
      if (messages.length <= window) {
        return { content: [{ type: 'text', text: JSON.stringify(messages) }] };
      }
      const old = messages.slice(0, messages.length - window);
      const recent = messages.slice(-window);
      const summary = await summarizeTurns(old);
      const compressed = [
        { role: 'system', content: `[HISTORY SUMMARY — ${old.length} turns compressed]\n${summary}` },
        ...recent,
      ];
      return { content: [{ type: 'text', text: JSON.stringify(compressed) }] };
    }
  );
}
```

**Commit:** `feat: MCP tool compress_history — sliding window + summary`

---

### Task 11: Tool — `filter_active_tools`

**Objective:** Given task description, return only relevant tool names. Agent uses list to restrict `enabled_toolsets` — prevents 3000-5000 tok schema bloat.

**Files:**
- Create: `packages/mcp-server/src/tools/filter-tools.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Heuristic map: keyword → tool categories
const TOOL_MAP: Record<string, string[]> = {
  file:       ['read_file', 'write_file', 'search_files', 'patch'],
  terminal:   ['terminal', 'process'],
  web:        ['web_search', 'web_extract', 'browser_navigate'],
  git:        ['terminal'],
  deploy:     ['terminal', 'browser_navigate'],
  search:     ['web_search', 'search_files', 'session_search'],
  image:      ['vision_analyze', 'image_gen'],
  email:      ['himalaya'],
  calendar:   ['google-workspace'],
  code:       ['read_file', 'write_file', 'patch', 'terminal', 'search_files'],
  database:   ['terminal'],
  mcp:        ['terminal'],
};

function inferTools(task: string): string[] {
  const lower = task.toLowerCase();
  const matched = new Set<string>();
  for (const [keyword, tools] of Object.entries(TOOL_MAP)) {
    if (lower.includes(keyword)) tools.forEach(t => matched.add(t));
  }
  // always include core tools
  ['estimate_tokens', 'compress_tool_output'].forEach(t => matched.add(t));
  return [...matched];
}

export function registerFilterTools(server: McpServer) {
  server.tool(
    'filter_active_tools',
    'Return minimal tool list for a task. Use returned list as enabled_toolsets to prevent injecting full tool schema (~3000-5000 tokens) into context.',
    {
      task: z.string().describe('Task description'),
    },
    async ({ task }) => {
      const tools = inferTools(task);
      return {
        content: [{
          type: 'text',
          text: `Suggested tools for "${task}":\n${tools.map(t => `- ${t}`).join('\n')}\n\nPass to enabled_toolsets to reduce schema overhead.`,
        }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool filter_active_tools — reduce schema bloat`

---

### Task 12: Tool — `deduplicate_context`

**Objective:** Detect repeated file content in messages[] → replace duplicates with pointer. Reduces 40-60% tokens in code-heavy sessions.

**Files:**
- Create: `packages/mcp-server/src/tools/deduplicate-context.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'crypto';

function extractTextBlocks(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (Array.isArray(content)) return content.flatMap(c => extractTextBlocks(c));
  if (typeof content === 'object' && content !== null) {
    const c = content as any;
    if (c.text) return [c.text];
    if (c.content) return extractTextBlocks(c.content);
  }
  return [];
}

export function registerDeduplicateContext(server: McpServer) {
  server.tool(
    'deduplicate_context',
    'Replace repeated file contents in messages with back-references. Most effective for sessions with repeated file reads. Returns deduplicated messages + savings estimate.',
    {
      messages: z.array(z.object({ role: z.string(), content: z.unknown() }))
        .describe('Conversation messages to deduplicate'),
      min_length: z.number().default(500).describe('Min chars to consider for dedup (ignore short strings)'),
    },
    async ({ messages, min_length }) => {
      const seen = new Map<string, number>(); // hash → first turn index
      let savedChars = 0;

      const deduped = messages.map((msg, idx) => {
        const texts = extractTextBlocks(msg.content);
        let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        for (const text of texts) {
          if (text.length < min_length) continue;
          const hash = createHash('sha1').update(text).digest('hex').slice(0, 8);
          if (seen.has(hash)) {
            const ref = seen.get(hash)!;
            content = content.replace(text, `[DUPLICATE — same content as turn ${ref}, hash:${hash}]`);
            savedChars += text.length;
          } else {
            seen.set(hash, idx);
          }
        }
        return { ...msg, content };
      });

      const savedTokens = Math.ceil(savedChars / 4);
      return {
        content: [{
          type: 'text',
          text: `Deduplicated: ${savedChars.toLocaleString()} chars removed (~${savedTokens.toLocaleString()} tokens saved)\n\n${JSON.stringify(deduped)}`,
        }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool deduplicate_context — remove repeated file reads`

---

### Task 13: Tool — `suggest_max_tokens`

**Objective:** Return appropriate `max_tokens` per task type. Output is 5x đắt hơn input — avoid verbose output.

**Files:**
- Create: `packages/mcp-server/src/tools/suggest-max-tokens.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const TASK_LIMITS: Record<string, { max: number; reason: string }> = {
  tool_call_decision: { max: 150,  reason: 'Agent deciding which tool to call — no verbose output needed' },
  yes_no:            { max: 50,   reason: 'Boolean answer' },
  file_search:       { max: 300,  reason: 'List of matching files/lines' },
  code_generation:   { max: 2000, reason: 'Code block + explanation' },
  code_review:       { max: 800,  reason: 'Review comments' },
  explanation:       { max: 500,  reason: 'Technical explanation' },
  planning:          { max: 1500, reason: 'Plan with tasks' },
  summarization:     { max: 400,  reason: 'Summary' },
  debugging:         { max: 1000, reason: 'Analysis + fix' },
  default:           { max: 1024, reason: 'General purpose' },
};

function classifyTask(description: string): string {
  const d = description.toLowerCase();
  if (/yes|no|does|is |are |exists?/.test(d)) return 'yes_no';
  if (/which tool|what tool|should i use/.test(d)) return 'tool_call_decision';
  if (/find|search|grep|list files/.test(d)) return 'file_search';
  if (/implement|write|create|generate/.test(d)) return 'code_generation';
  if (/review|check|audit/.test(d)) return 'code_review';
  if (/explain|how does|what is/.test(d)) return 'explanation';
  if (/plan|tasks|phases|design/.test(d)) return 'planning';
  if (/summarize|summary|tldr/.test(d)) return 'summarization';
  if (/debug|error|fix|why/.test(d)) return 'debugging';
  return 'default';
}

export function registerSuggestMaxTokens(server: McpServer) {
  server.tool(
    'suggest_max_tokens',
    'Return optimal max_tokens for a task type. Output tokens cost 5x more than input — capping avoids expensive verbose responses.',
    {
      task_description: z.string().describe('What the LLM is being asked to do'),
    },
    async ({ task_description }) => {
      const type = classifyTask(task_description);
      const { max, reason } = TASK_LIMITS[type];
      const saving = TASK_LIMITS.default.max - max;
      const costSaved = (saving / 1_000_000 * 15.0).toFixed(6); // output price
      return {
        content: [{
          type: 'text',
          text: `Task type: ${type}\nSuggested max_tokens: ${max}\nReason: ${reason}\nVs default (${TASK_LIMITS.default.max}): saves up to ${saving} output tokens ($${costSaved} per request)`,
        }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool suggest_max_tokens — cap output per task type`

---

### Task 14: Tool — `warm_cache`

**Objective:** Pre-warm Anthropic prompt cache by sending dummy request with system prompt. Converts $3.75/1M (creation) → $0.30/1M (read) for subsequent requests.

**Files:**
- Create: `packages/mcp-server/src/tools/warm-cache.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const LLM_URL = process.env.LLM_URL ?? 'http://localhost:11434/v1/chat/completions';
const LLM_KEY = process.env.LLM_KEY ?? 'test';

export function registerWarmCache(server: McpServer) {
  server.tool(
    'warm_cache',
    'Pre-warm Anthropic prompt cache. Send before a session starts to avoid cache creation cost ($3.75/1M → $0.30/1M). Cache TTL: ~5 min.',
    {
      system_prompt: z.string().describe('System prompt to cache (must be identical to actual requests)'),
      model: z.string().default('claude-sonnet-4-6').describe('Model to warm cache for'),
    },
    async ({ system_prompt, model }) => {
      const start = Date.now();
      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          system: [{ type: 'text', text: system_prompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const data = await res.json() as any;
      const elapsed = Date.now() - start;
      const usage = data.usage ?? {};
      const creation = usage.cache_creation_input_tokens ?? 0;
      const hit = usage.cache_read_input_tokens ?? 0;
      return {
        content: [{
          type: 'text',
          text: creation > 0
            ? `Cache warmed ✓ (${elapsed}ms)\nCreated: ${creation} tokens cached\nNext requests: pay $0.30/1M instead of $3.75/1M`
            : hit > 0
            ? `Cache already warm ✓ (${elapsed}ms)\nHit: ${hit} tokens read from cache`
            : `Warm attempted (${elapsed}ms) — check LLM supports prompt caching`,
        }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tool warm_cache — pre-warm Anthropic prompt cache`

---

### Task 15: Tool — `pack_context` / `unpack_context`

**Objective:** Compress context for multi-agent handoff. Orchestrator → subagent không cần re-inject full system prompt + history.

**Files:**
- Create: `packages/mcp-server/src/tools/pack-context.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { deflateSync, inflateSync } from 'zlib';

function pack(data: object): string {
  const json = JSON.stringify(data);
  const compressed = deflateSync(Buffer.from(json));
  return compressed.toString('base64');
}

function unpack(packed: string): object {
  const buf = Buffer.from(packed, 'base64');
  const json = inflateSync(buf).toString();
  return JSON.parse(json);
}

export function registerPackContext(server: McpServer) {
  server.tool(
    'pack_context',
    'Compress context object to base64 string for multi-agent handoff. Pass packed string to subagent instead of full history.',
    {
      context: z.object({
        task: z.string(),
        decisions: z.array(z.string()).default([]),
        files_modified: z.array(z.string()).default([]),
        current_state: z.string().default(''),
        constraints: z.array(z.string()).default([]),
      }).describe('Structured context to compress'),
    },
    async ({ context }) => {
      const packed = pack(context);
      const original = JSON.stringify(context).length;
      const ratio = ((1 - packed.length / original) * 100).toFixed(0);
      return {
        content: [{
          type: 'text',
          text: `Packed context (${ratio}% reduction, ${packed.length} chars):\n\n${packed}`,
        }],
      };
    }
  );

  server.tool(
    'unpack_context',
    'Decompress context packed by pack_context. Use at subagent start to restore task state without full history.',
    {
      packed: z.string().describe('Base64 packed context from pack_context'),
    },
    async ({ packed }) => {
      const context = unpack(packed);
      return {
        content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
      };
    }
  );
}
```

**Commit:** `feat: MCP tools pack_context/unpack_context — multi-agent handoff`

---

## Phase 5: Integration & Config

### Task 16: Wire all tools into MCP server

**Objective:** Register tất cả 9 tools vào `tools/index.ts`.

**Files:**
- Create: `packages/mcp-server/src/tools/index.ts`

**Code:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchSkills } from './search-skills.js';
import { registerCompressOutput } from './compress-output.js';
import { registerEstimateTokens } from './estimate-tokens.js';
import { registerCompressHistory } from './compress-history.js';
import { registerFilterTools } from './filter-tools.js';
import { registerDeduplicateContext } from './deduplicate-context.js';
import { registerSuggestMaxTokens } from './suggest-max-tokens.js';
import { registerWarmCache } from './warm-cache.js';
import { registerPackContext } from './pack-context.js';

export function registerTools(server: McpServer) {
  // Phase 2: RAG
  registerSearchSkills(server);
  // Phase 3: Core tools
  registerCompressOutput(server);
  registerEstimateTokens(server);
  // Phase 4: History/Cache/Dedup/Output
  registerCompressHistory(server);
  registerFilterTools(server);
  registerDeduplicateContext(server);
  registerSuggestMaxTokens(server);
  registerWarmCache(server);
  registerPackContext(server); // registers pack_context + unpack_context
}
```

**Commit:** `feat: wire all 9 tools into MCP server`

---

### Task 17: Claude Code + Hermes config

**Objective:** Register MCP server vào Claude Code và Hermes.

**Files:**
- Modify: `~/.claude.json`
- Modify: `~/.hermes/config.yaml`

**Claude Code:**
```json
{
  "mcpServers": {
    "token-optimizer": {
      "command": "node",
      "args": ["/Users/dung.nguyentien/Personal/projects/token-optimizer/packages/mcp-server/dist/index.js"],
      "env": {
        "LLM_URL": "http://192.168.1.23:10130/v1/chat/completions",
        "LLM_KEY": "test"
      }
    }
  }
}
```

**Hermes config:**
```yaml
mcp:
  servers:
    token-optimizer:
      command: node
      args:
        - /Users/dung.nguyentien/Personal/projects/token-optimizer/packages/mcp-server/dist/index.js
      env:
        LLM_URL: http://192.168.1.23:10130/v1/chat/completions
        LLM_KEY: test
```

**Verify:**
```bash
claude mcp list | grep token-optimizer
hermes tools | grep token-optimizer
```

**Commit:** `chore: register token-optimizer MCP in Claude Code + Hermes`

---

### Task 18: E2E smoke test

**Objective:** Verify tất cả 9 tools hoạt động end-to-end.

**Files:**
- Create: `scripts/smoke-test.sh`

**Code:**
```bash
#!/bin/bash
set -e
echo "=== Token Optimizer Smoke Test ==="

MCP="node packages/mcp-server/dist/index.js"

call_tool() {
  local tool=$1 params=$2
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"'"$tool"'","arguments":'"$params"'}}' \
    | $MCP 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('content',[{}])[0].get('text','ERROR')[:200])"
}

echo -e "\n[1] search_relevant_skills"
call_tool search_relevant_skills '{"query":"deploy kubernetes"}'

echo -e "\n[2] estimate_tokens"
call_tool estimate_tokens '{"text":"hello world this is a test"}'

echo -e "\n[3] suggest_max_tokens"
call_tool suggest_max_tokens '{"task_description":"write a function to sort a list"}'

echo -e "\n[4] filter_active_tools"
call_tool filter_active_tools '{"task":"read and edit source code files"}'

echo -e "\n[5] compress_tool_output (short — should passthrough)"
call_tool compress_tool_output '{"content":"short content","context":"test"}'

echo -e "\n[6] pack_context"
PACKED=$(call_tool pack_context '{"context":{"task":"build feature","decisions":["use TypeScript"],"files_modified":[],"current_state":"in progress","constraints":[]}}')
echo "$PACKED" | head -c 100

echo -e "\n\n=== All tools OK ==="
```

**Run:** `bash scripts/smoke-test.sh`

**Commit:** `test: e2e smoke test all 9 MCP tools`

---

## Summary: Expected Impact

| Tool | Layer tối ưu | Est. Savings |
|---|---|---|
| `search_relevant_skills` | System prompt — skills | ~1500 tok/turn |
| `compress_tool_output` | Tool results → history | ~2000 tok/call |
| `estimate_tokens` | Awareness / preventive | — |
| `compress_history` | Conversation history O(n)→O(1) | ~3000-8000 tok/session |
| `filter_active_tools` | Tool schema bloat | ~3000-5000 tok/request |
| `deduplicate_context` | Repeated file reads | ~40-60% reduction code sessions |
| `suggest_max_tokens` | Output tokens (5x đắt) | ~500-800 tok/request |
| `warm_cache` | Cache creation → read | $3.75 → $0.30 /1M |
| `pack_context` / `unpack_context` | Multi-agent handoff | ~5000-10000 tok/subagent |

**Total estimated: 50-70% reduction** in token spend for typical Claude Code / Hermes sessions.

---

## Execution Order

```
Phase 1 (Foundation + Analytics DB)
  → Phase 2 (RAG Skill Store)
  → Phase 3 (MCP Server + 3 core tools)
  → Phase 4 (6 additional tools)
  → Phase 5 (Integration + Smoke Test)
```

Each phase independently useful — stop at any phase and get value.
