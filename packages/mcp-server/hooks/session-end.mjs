#!/usr/bin/env node
/**
 * Claude Code hook: auto-log real token usage after each session
 * Reads ~/.claude/projects/<current-session>.jsonl → aggregates → saves to analytics DB
 *
 * Triggered by: PostToolUse or Stop hooks in ~/.claude/settings.json
 * Claude Code passes JSON on stdin: { session_id, tool_name, ... }
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, ".claude", "projects");
const LOG_FILE = path.join(HOME, ".token-optimizer", "usage-log.jsonl");

async function readStdin() {
  const rl = readline.createInterface({ input: process.stdin });
  let data = "";
  for await (const line of rl) data += line;
  try { return JSON.parse(data); } catch { return {}; }
}

function findSessionFile(sessionId) {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  for (const proj of fs.readdirSync(PROJECTS_DIR)) {
    const f = path.join(PROJECTS_DIR, proj, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function parseSessionTokens(jsonlPath) {
  const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
  let input = 0, output = 0, cacheRead = 0, cacheCreate = 0, turns = 0;
  let model = "unknown";
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const usage = obj?.message?.usage;
      if (!usage || !(usage.output_tokens > 0)) continue;
      input += usage.input_tokens ?? 0;
      output += usage.output_tokens ?? 0;
      cacheRead += usage.cache_read_input_tokens ?? 0;
      cacheCreate += usage.cache_creation_input_tokens ?? 0;
      turns++;
      if (obj?.message?.model && obj.message.model !== "<synthetic>") {
        model = obj.message.model;
      }
    } catch { /* skip */ }
  }
  return { input, output, cacheRead, cacheCreate, turns, model };
}

async function main() {
  const hookData = await readStdin();
  const sessionId = hookData?.session_id;
  if (!sessionId) {
    process.stderr.write("[token-optimizer] No session_id in hook data\n");
    process.exit(0);
  }

  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) {
    process.stderr.write(`[token-optimizer] Session file not found: ${sessionId}\n`);
    process.exit(0);
  }

  const stats = parseSessionTokens(sessionFile);
  if (stats.turns === 0) process.exit(0); // nothing to log

  // Estimate cost (Sonnet pricing as default)
  const INPUT_COST  = 3.00 / 1_000_000;   // $3/MTok
  const OUTPUT_COST = 15.00 / 1_000_000;  // $15/MTok
  const CACHE_COST  = 0.30 / 1_000_000;   // $0.30/MTok (cache read)
  const cost = (stats.input * INPUT_COST) +
               (stats.output * OUTPUT_COST) +
               (stats.cacheRead * CACHE_COST);

  const record = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    model: stats.model,
    turns: stats.turns,
    input_tokens: stats.input,
    output_tokens: stats.output,
    cache_read: stats.cacheRead,
    cache_created: stats.cacheCreate,
    total_tokens: stats.input + stats.output,
    est_cost_usd: parseFloat(cost.toFixed(6)),
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n");
  process.stderr.write(
    `[token-optimizer] Session ${sessionId.slice(0,8)}… — ` +
    `${record.total_tokens.toLocaleString()} tokens, $${record.est_cost_usd.toFixed(4)}\n`
  );
}

main().catch(e => { process.stderr.write(`[token-optimizer] Error: ${e}\n`); process.exit(0); });
