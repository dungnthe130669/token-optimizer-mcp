#!/usr/bin/env node
/**
 * Post-install: inject token optimizer instructions into ~/.claude/CLAUDE.md
 */
import fs from "fs";
import path from "path";
import os from "os";

const MARKER_START = "<!-- agent-token-optimizer start -->";
const MARKER_END = "<!-- agent-token-optimizer end -->";

const INJECT = `
${MARKER_START}
## Token Optimization (agent-token-optimizer)
- Before long tasks (>20 files, complex features): call \`estimate_tokens\` on context
- When tool output > 300 lines: call \`compress_tool_output\` to summarize
- Every 10 turns in long sessions: call \`compress_history\` to compact history
- Before loading skills: call \`search_relevant_skills\` to find best match
- At end of session: call \`get_savings_report\` to see token savings
${MARKER_END}
`;

const claudeDir = path.join(os.homedir(), ".claude");
const claudeMd = path.join(claudeDir, "CLAUDE.md");

try {
  // Ensure ~/.claude/ exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let content = "";
  if (fs.existsSync(claudeMd)) {
    content = fs.readFileSync(claudeMd, "utf8");
  }

  // Already injected?
  if (content.includes(MARKER_START)) {
    // Replace existing block
    const re = new RegExp(
      `\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`,
      "g"
    );
    content = content.replace(re, INJECT);
    console.log("[agent-token-optimizer] Updated existing block in ~/.claude/CLAUDE.md");
  } else {
    content = content + INJECT;
    console.log("[agent-token-optimizer] Injected token optimization rules into ~/.claude/CLAUDE.md");
  }

  fs.writeFileSync(claudeMd, content, "utf8");
} catch (err) {
  // Non-fatal — user may not have Claude Code installed
  console.warn("[agent-token-optimizer] Could not write ~/.claude/CLAUDE.md:", (err as Error).message);
  console.warn("  Manual setup: add token optimization rules to your CLAUDE.md");
}
