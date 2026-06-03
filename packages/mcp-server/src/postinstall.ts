#!/usr/bin/env node
/**
 * Post-install:
 * 1. Inject token optimization rules into ~/.claude/CLAUDE.md
 * 2. Copy hook scripts to ~/.token-optimizer/hooks/
 * 3. Register PreToolUse + Stop hooks in ~/.claude/settings.json
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const HOOKS_DEST = path.join(HOME, ".token-optimizer", "hooks");
// __dirname = dist/ — hooks/ is sibling of dist/
const HOOKS_SRC = path.join(__dirname, "..", "hooks");

// ── 1. CLAUDE.md injection ──────────────────────────────────────────────────
const MARKER_START = "<!-- agent-token-optimizer start -->";
const MARKER_END   = "<!-- agent-token-optimizer end -->";
const INJECT = `
${MARKER_START}
## Token Optimization (agent-token-optimizer)
- Bash/Read outputs >150 lines are auto-compressed by PreToolUse hook (saves 60-90% tokens)
- Before long tasks (>20 files): call \`estimate_tokens\` on context
- Every 10 turns: call \`compress_history\` to compact history
- Before loading skills: call \`search_relevant_skills\` to find best match
- At end of session: call \`get_savings_report\` or check ~/.token-optimizer/compression-log.jsonl
${MARKER_END}
`;

try {
  if (!fs.existsSync(CLAUDE_DIR)) fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const claudeMd = path.join(CLAUDE_DIR, "CLAUDE.md");
  let content = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, "utf8") : "";
  if (content.includes(MARKER_START)) {
    content = content.replace(new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, "g"), INJECT);
    console.log("[agent-token-optimizer] Updated CLAUDE.md");
  } else {
    content = content + INJECT;
    console.log("[agent-token-optimizer] Injected rules into ~/.claude/CLAUDE.md");
  }
  fs.writeFileSync(claudeMd, content, "utf8");
} catch (err) {
  console.warn("[agent-token-optimizer] Could not write CLAUDE.md:", (err as Error).message);
}

// ── 2. Copy hook scripts ────────────────────────────────────────────────────
try {
  fs.mkdirSync(HOOKS_DEST, { recursive: true });

  const hookFiles = ["pre-tool-compress.mjs", "session-end.mjs"];
  for (const f of hookFiles) {
    const src = path.join(HOOKS_SRC, f);
    const dest = path.join(HOOKS_DEST, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[agent-token-optimizer] Installed hook: ${dest}`);
    } else {
      console.warn(`[agent-token-optimizer] Hook source not found: ${src}`);
    }
  }
} catch (err) {
  console.warn("[agent-token-optimizer] Could not install hooks:", (err as Error).message);
}

// ── 3. Register hooks in ~/.claude/settings.json ────────────────────────────
const settingsPath = path.join(CLAUDE_DIR, "settings.json");
const preHookCmd  = `node ${HOOKS_DEST}/pre-tool-compress.mjs`;
const stopHookCmd = `node ${HOOKS_DEST}/session-end.mjs`;

try {
  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { settings = {}; }
  }

  const hooks = settings.hooks ?? {};

  // PreToolUse — idempotent
  let preHooks: any[] = (hooks.PreToolUse ?? []).filter((h: any) => !JSON.stringify(h).includes("pre-tool-compress"));
  preHooks.push({ matcher: "Bash|Read", hooks: [{ type: "command", command: preHookCmd }] });
  hooks.PreToolUse = preHooks;

  // Stop — idempotent
  let stopHooks: any[] = (hooks.Stop ?? []).filter((h: any) => !JSON.stringify(h).includes("session-end"));
  stopHooks.push({ hooks: [{ type: "command", command: stopHookCmd }] });
  hooks.Stop = stopHooks;

  settings.hooks = hooks;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  console.log("[agent-token-optimizer] Registered PreToolUse + Stop hooks in ~/.claude/settings.json");
} catch (err) {
  console.warn("[agent-token-optimizer] Could not update settings.json:", (err as Error).message);
  console.warn(`  Manual: add PreToolUse hook with command: ${preHookCmd}`);
}

console.log("[agent-token-optimizer] Setup complete! Restart Claude Code to activate hooks.");
