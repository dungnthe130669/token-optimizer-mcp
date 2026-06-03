#!/usr/bin/env node

// hooks/pre-tool-compress.ts
import * as readline from "readline";
import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var THRESHOLD_LINES = 150;
var LOG_FILE = path.join(os.homedir(), ".token-optimizer", "compression-log.jsonl");
var COMPRESSOR_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
var API_KEY = process.env.ANTHROPIC_API_KEY;
var VERTEX_PROJECT = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
var VERTEX_REGION = process.env.CLOUD_ML_REGION || "us-east5";
async function readStdin() {
  const rl = readline.createInterface({ input: process.stdin });
  let data = "";
  for await (const line of rl) data += line;
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
async function compressWithLLM(content, context) {
  const prompt = `You are a technical summarizer. Compress this tool output to essential information only.
Keep: errors, key values, important file paths, counts, status.
Drop: verbose formatting, repeated patterns, raw data dumps, decorative output.
Output compressed version in plain text. Be concise \u2014 target 20% of original size.

Context: ${context}

Tool output to compress:
<output>
${content.slice(0, 8e3)}
</output>

Compressed version:`;
  if (VERTEX_PROJECT) {
    try {
      const token = execSync("gcloud auth print-access-token 2>/dev/null", { encoding: "utf8" }).trim();
      const url = `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_REGION}/publishers/anthropic/models/claude-haiku-4-5:rawPredict`;
      const body = JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const res = JSON.parse(execSync(
        `curl -s -X POST "${url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
        { encoding: "utf8", timeout: 15e3 }
      ));
      return res?.content?.[0]?.text || content;
    } catch {
    }
  }
  if (API_KEY) {
    try {
      const body = JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const res = JSON.parse(execSync(
        `curl -s -X POST "https://api.anthropic.com/v1/messages"           -H "x-api-key: ${API_KEY}"           -H "anthropic-version: 2023-06-01"           -H "content-type: application/json"           -d '${body.replace(/'/g, "'\\''")}'`,
        { encoding: "utf8", timeout: 15e3 }
      ));
      return res?.content?.[0]?.text || content;
    } catch {
    }
  }
  const lines = content.split("\n");
  return [
    `[Compressed: showing first 50 / ${lines.length} lines]`,
    ...lines.slice(0, 50),
    `... [${lines.length - 50} lines omitted]`
  ].join("\n");
}
function logCompression(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
  }
}
async function main() {
  const hook = await readStdin();
  const toolName = hook?.tool_name || "";
  const toolInput = hook?.tool_input || {};
  if (!["Bash", "Read"].includes(toolName)) {
    process.exit(0);
  }
  let rawOutput = "";
  let context = "";
  if (toolName === "Bash") {
    const cmd = toolInput.command || "";
    context = `bash: ${cmd.slice(0, 100)}`;
    try {
      const result = spawnSync("bash", ["-c", cmd], {
        encoding: "utf8",
        timeout: 3e4,
        maxBuffer: 10 * 1024 * 1024
      });
      rawOutput = (result.stdout || "") + (result.stderr || "");
    } catch (e) {
      rawOutput = `Error: ${e.message}`;
    }
  } else if (toolName === "Read") {
    const filePath = toolInput.file_path || "";
    context = `read: ${filePath}`;
    try {
      rawOutput = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      rawOutput = `Error reading file: ${e.message}`;
    }
  }
  const lineCount = rawOutput.split("\n").length;
  const originalTokens = estimateTokens(rawOutput);
  if (lineCount <= THRESHOLD_LINES) {
    process.exit(0);
  }
  const compressed = await compressWithLLM(rawOutput, context);
  const compressedTokens = estimateTokens(compressed);
  const savedTokens = originalTokens - compressedTokens;
  const ratio = (savedTokens / originalTokens * 100).toFixed(0);
  logCompression({
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    tool: toolName,
    context,
    original_lines: lineCount,
    original_tokens: originalTokens,
    compressed_tokens: compressedTokens,
    saved_tokens: savedTokens,
    ratio_pct: parseInt(ratio)
  });
  const msg = [
    `[token-optimizer] Compressed ${toolName} output: ${lineCount} lines \u2192 ${compressed.split("\n").length} lines`,
    `[Saved ~${savedTokens} tokens (${ratio}%)]`,
    "",
    compressed
  ].join("\n");
  process.stderr.write(msg);
  process.exit(2);
}
main().catch((e) => {
  process.stderr.write(`[token-optimizer hook error] ${e}
`);
  process.exit(0);
});
