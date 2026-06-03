#!/usr/bin/env node
/**
 * PreToolUse hook: intercept Bash/Read output, compress if > threshold, inject back via exit 2 + stderr
 *
 * Flow:
 *   1. Claude calls Bash/Read tool
 *   2. This hook fires BEFORE tool runs (PreToolUse)
 *   3. Hook runs the tool itself
 *   4. If output > THRESHOLD lines → compress via LLM
 *   5. Exit 2 + stderr = compressed result → Claude sees compressed version
 *   6. If output <= THRESHOLD → exit 0 → Claude runs tool normally
 *
 * stdin JSON: { session_id, tool_name, tool_input: { command?, file_path?, ... } }
 */

import * as readline from "readline";
import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const THRESHOLD_LINES = 150;  // compress if output > this many lines
const LOG_FILE = path.join(os.homedir(), ".token-optimizer", "compression-log.jsonl");
const COMPRESSOR_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const API_KEY = process.env.ANTHROPIC_API_KEY;

// Vertex AI support
const VERTEX_PROJECT = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
const VERTEX_REGION  = process.env.CLOUD_ML_REGION || "us-east5";

async function readStdin(): Promise<any> {
  const rl = readline.createInterface({ input: process.stdin });
  let data = "";
  for await (const line of rl) data += line;
  try { return JSON.parse(data); } catch { return {}; }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function compressWithLLM(content: string, context: string): Promise<string> {
  const prompt = `You are a technical summarizer. Compress this tool output to essential information only.
Keep: errors, key values, important file paths, counts, status.
Drop: verbose formatting, repeated patterns, raw data dumps, decorative output.
Output compressed version in plain text. Be concise — target 20% of original size.

Context: ${context}

Tool output to compress:
<output>
${content.slice(0, 8000)}
</output>

Compressed version:`;

  // Try Vertex first
  if (VERTEX_PROJECT) {
    try {
      const token = execSync("gcloud auth print-access-token 2>/dev/null", { encoding: "utf8" }).trim();
      const url = `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_REGION}/publishers/anthropic/models/claude-haiku-4-5:rawPredict`;
      const body = JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const res = JSON.parse(execSync(
        `curl -s -X POST "${url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
        { encoding: "utf8", timeout: 15000 }
      ));
      return res?.content?.[0]?.text || content;
    } catch { /* fall through */ }
  }

  // Anthropic API fallback
  if (API_KEY) {
    try {
      const body = JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const res = JSON.parse(execSync(
        `curl -s -X POST "https://api.anthropic.com/v1/messages" \
          -H "x-api-key: ${API_KEY}" \
          -H "anthropic-version: 2023-06-01" \
          -H "content-type: application/json" \
          -d '${body.replace(/'/g, "'\\''")}'`,
        { encoding: "utf8", timeout: 15000 }
      ));
      return res?.content?.[0]?.text || content;
    } catch { /* fall through */ }
  }

  // No LLM available — basic truncation fallback
  const lines = content.split("\n");
  return [
    `[Compressed: showing first 50 / ${lines.length} lines]`,
    ...lines.slice(0, 50),
    `... [${lines.length - 50} lines omitted]`,
  ].join("\n");
}

function logCompression(entry: object) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch { /* non-fatal */ }
}

async function main() {
  const hook = await readStdin();
  const toolName: string = hook?.tool_name || "";
  const toolInput: any = hook?.tool_input || {};

  // Only intercept Bash and Read
  if (!["Bash", "Read"].includes(toolName)) {
    process.exit(0); // let tool run normally
  }

  let rawOutput = "";
  let context = "";

  if (toolName === "Bash") {
    const cmd: string = toolInput.command || "";
    context = `bash: ${cmd.slice(0, 100)}`;
    try {
      const result = spawnSync("bash", ["-c", cmd], {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      rawOutput = (result.stdout || "") + (result.stderr || "");
    } catch (e: any) {
      rawOutput = `Error: ${e.message}`;
    }
  } else if (toolName === "Read") {
    const filePath: string = toolInput.file_path || "";
    context = `read: ${filePath}`;
    try {
      rawOutput = fs.readFileSync(filePath, "utf8");
    } catch (e: any) {
      rawOutput = `Error reading file: ${e.message}`;
    }
  }

  const lineCount = rawOutput.split("\n").length;
  const originalTokens = estimateTokens(rawOutput);

  // Below threshold — let Claude run tool normally
  if (lineCount <= THRESHOLD_LINES) {
    process.exit(0);
  }

  // Above threshold — compress and inject
  const compressed = await compressWithLLM(rawOutput, context);
  const compressedTokens = estimateTokens(compressed);
  const savedTokens = originalTokens - compressedTokens;
  const ratio = ((savedTokens / originalTokens) * 100).toFixed(0);

  logCompression({
    ts: new Date().toISOString(),
    tool: toolName,
    context,
    original_lines: lineCount,
    original_tokens: originalTokens,
    compressed_tokens: compressedTokens,
    saved_tokens: savedTokens,
    ratio_pct: parseInt(ratio),
  });

  // Exit 2 + stderr = inject message to Claude
  const msg = [
    `[token-optimizer] Compressed ${toolName} output: ${lineCount} lines → ${compressed.split("\n").length} lines`,
    `[Saved ~${savedTokens} tokens (${ratio}%)]`,
    "",
    compressed,
  ].join("\n");

  process.stderr.write(msg);
  process.exit(2);
}

main().catch(e => {
  process.stderr.write(`[token-optimizer hook error] ${e}\n`);
  process.exit(0); // fail safe — let tool run normally
});
