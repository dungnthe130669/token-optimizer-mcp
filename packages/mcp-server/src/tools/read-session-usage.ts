import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface SessionStats {
  session: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_created: number;
  total_billed: number; // input + output (cache_read is cheap ~0.1x)
}

async function readSession(jsonlPath: string): Promise<SessionStats> {
  const content = fs.readFileSync(jsonlPath, "utf8");
  const lines = content.trim().split("\n");

  let input = 0, output = 0, cacheRead = 0, cacheCreate = 0, turns = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const usage: Usage = obj?.message?.usage;
      if (!usage) continue;
      if ((usage.output_tokens ?? 0) > 0) {
        input += usage.input_tokens ?? 0;
        output += usage.output_tokens ?? 0;
        cacheRead += usage.cache_read_input_tokens ?? 0;
        cacheCreate += usage.cache_creation_input_tokens ?? 0;
        turns++;
      }
    } catch { /* skip malformed */ }
  }

  return {
    session: path.basename(jsonlPath, ".jsonl"),
    turns,
    input_tokens: input,
    output_tokens: output,
    cache_read: cacheRead,
    cache_created: cacheCreate,
    total_billed: input + output,
  };
}

export async function readSessionUsage(args: { session_id?: string; last_n?: number }) {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");

  if (!fs.existsSync(projectsDir)) {
    return { error: "~/.claude/projects not found — Claude Code not installed or no sessions yet" };
  }

  // Find all session jsonl files
  const allFiles: string[] = [];
  for (const projectDir of fs.readdirSync(projectsDir)) {
    const fullProjectDir = path.join(projectsDir, projectDir);
    if (!fs.statSync(fullProjectDir).isDirectory()) continue;
    for (const f of fs.readdirSync(fullProjectDir)) {
      if (f.endsWith(".jsonl") && !f.includes("/subagents/")) {
        allFiles.push(path.join(fullProjectDir, f));
      }
    }
  }

  // Sort by mtime desc
  allFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (args.session_id) {
    const match = allFiles.find(f => f.includes(args.session_id!));
    if (!match) return { error: `Session ${args.session_id} not found` };
    const stats = await readSession(match);
    return { sessions: [stats] };
  }

  const n = args.last_n ?? 3;
  const targets = allFiles.slice(0, n);
  const sessions = await Promise.all(targets.map(readSession));

  // Aggregate
  const total = sessions.reduce((acc, s) => ({
    turns: acc.turns + s.turns,
    input_tokens: acc.input_tokens + s.input_tokens,
    output_tokens: acc.output_tokens + s.output_tokens,
    cache_read: acc.cache_read + s.cache_read,
    cache_created: acc.cache_created + s.cache_created,
    total_billed: acc.total_billed + s.total_billed,
  }), { turns: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_created: 0, total_billed: 0 });

  return {
    sessions,
    aggregate: total,
    note: "cache_read tokens billed at ~0.1x rate. input_tokens = uncached. output_tokens = generated.",
  };
}
