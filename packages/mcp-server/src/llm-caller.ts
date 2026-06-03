/**
 * LLM caller — supports 3 modes:
 *   1. vertex  — GCP Vertex AI (auto-fetch gcloud token)
 *   2. anthropic — Anthropic native API
 *   3. openai  — OpenAI-compatible endpoint (default)
 *
 * Set TOKEN_OPTIMIZER_MODE=vertex|anthropic|openai
 */
import { execSync } from 'child_process';

export interface LLMCallOpts {
  prompt: string;
  maxTokens?: number;
}

const MODE    = process.env.TOKEN_OPTIMIZER_MODE ?? 'openai';
const LLM_URL = process.env.TOKEN_OPTIMIZER_LLM_URL ?? '';
const LLM_KEY = process.env.TOKEN_OPTIMIZER_LLM_KEY ?? '';
const MODEL   = process.env.TOKEN_OPTIMIZER_CHEAP_MODEL ?? 'claude-haiku-4-5';

// Vertex-specific
const VERTEX_PROJECT = process.env.TOKEN_OPTIMIZER_VERTEX_PROJECT ?? process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? '';
const VERTEX_REGION  = process.env.TOKEN_OPTIMIZER_VERTEX_REGION  ?? process.env.CLOUD_ML_REGION ?? 'us-east5';
const VERTEX_MODEL   = process.env.TOKEN_OPTIMIZER_CHEAP_MODEL ?? 'claude-haiku@20240307';

function getGcloudToken(): string {
  try {
    // Try token helper script first (same as Claude Code uses)
    const helper = process.env.OTEL_HEADERS_HELPER ?? `${process.env.HOME}/.claude/gcp_token_helper.sh`;
    return execSync(`${helper} 2>/dev/null || gcloud auth print-access-token`, {
      encoding: 'utf-8', timeout: 5000,
    }).trim().split('\n').pop()!.trim();
  } catch {
    return execSync('gcloud auth print-access-token', { encoding: 'utf-8', timeout: 5000 }).trim();
  }
}

async function callVertex(prompt: string, maxTokens: number): Promise<string> {
  const token    = getGcloudToken();
  const endpoint = `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_REGION}/publishers/anthropic/models/${VERTEX_MODEL}:rawPredict`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const d = await res.json() as any;
  if (!res.ok) throw new Error(`Vertex error ${res.status}: ${JSON.stringify(d)}`);
  return d.content?.[0]?.text ?? '';
}

async function callAnthropic(prompt: string, maxTokens: number): Promise<string> {
  const url = LLM_URL || 'https://api.anthropic.com/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': LLM_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const d = await res.json() as any;
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${JSON.stringify(d)}`);
  return d.content?.[0]?.text ?? '';
}

async function callOpenAICompat(prompt: string, maxTokens: number): Promise<string> {
  const url = LLM_URL || 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const d = await res.json() as any;
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${JSON.stringify(d)}`);
  return d.choices?.[0]?.message?.content ?? '';
}

export async function callLLM(opts: LLMCallOpts): Promise<string> {
  const { prompt, maxTokens = 400 } = opts;

  // Auto-detect Vertex if env vars present but mode not set
  const effectiveMode = MODE !== 'openai' ? MODE
    : (VERTEX_PROJECT && !LLM_URL) ? 'vertex'
    : LLM_URL.includes('anthropic.com') ? 'anthropic'
    : 'openai';

  switch (effectiveMode) {
    case 'vertex':    return callVertex(prompt, maxTokens);
    case 'anthropic': return callAnthropic(prompt, maxTokens);
    default:          return callOpenAICompat(prompt, maxTokens);
  }
}
