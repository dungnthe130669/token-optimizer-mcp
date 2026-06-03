import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DB_DIR = join(homedir(), '.token-optimizer');
const DB_PATH = join(DB_DIR, 'analytics.sqlite');

export type AnalyticsDB = ReturnType<typeof Database>;

export function initAnalyticsDB(dbPath = DB_PATH): AnalyticsDB {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS savings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL,
      tool        TEXT    NOT NULL,
      tokens_before INTEGER NOT NULL,
      tokens_after  INTEGER NOT NULL,
      tokens_saved  INTEGER NOT NULL,
      cost_saved_usd REAL  NOT NULL,
      model       TEXT,
      session_id  TEXT,
      metadata    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_savings_timestamp ON savings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_savings_tool ON savings(tool);
  `);
  return db;
}

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4':   { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-6': { input: 3.00,  output: 15.00 },
  'claude-haiku-4':    { input: 0.25,  output: 1.25  },
  'claude-haiku-4-5':  { input: 0.25,  output: 1.25  },
  'gpt-4o':            { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':       { input: 0.15,  output: 0.60  },
  default:             { input: 3.00,  output: 15.00 },
};

export interface LogSavingOpts {
  tool: string;
  tokensBefore: number;
  tokensAfter: number;
  model?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SavingResult {
  tokensSaved: number;
  costSavedUsd: number;
}

export function logSaving(db: AnalyticsDB, opts: LogSavingOpts): SavingResult {
  const model = opts.model ?? 'default';
  const price = MODEL_PRICES[model] ?? MODEL_PRICES.default;
  const saved = opts.tokensBefore - opts.tokensAfter;
  const costSaved = Math.max(0, (saved / 1_000_000) * price.input);

  db.prepare(`
    INSERT INTO savings(timestamp,tool,tokens_before,tokens_after,tokens_saved,cost_saved_usd,model,session_id,metadata)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    new Date().toISOString(),
    opts.tool,
    opts.tokensBefore,
    opts.tokensAfter,
    saved,
    costSaved,
    model,
    opts.sessionId ?? null,
    JSON.stringify(opts.metadata ?? {}),
  );
  return { tokensSaved: saved, costSavedUsd: costSaved };
}

export interface SummaryRow {
  tool: string;
  total_tokens_saved: number;
  total_cost_saved: number;
  requests: number;
}

export function getSummary(db: AnalyticsDB, days = 7): SummaryRow[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.prepare(`
    SELECT
      tool,
      SUM(tokens_saved)   AS total_tokens_saved,
      SUM(cost_saved_usd) AS total_cost_saved,
      COUNT(*)            AS requests
    FROM savings
    WHERE timestamp > ?
    GROUP BY tool
    ORDER BY total_cost_saved DESC
  `).all(since) as SummaryRow[];
}

export function getTotalSaved(db: AnalyticsDB, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.prepare(`
    SELECT
      SUM(tokens_saved)   AS total_tokens,
      SUM(cost_saved_usd) AS total_cost,
      COUNT(*)            AS total_requests
    FROM savings WHERE timestamp > ?
  `).get(since) as { total_tokens: number; total_cost: number; total_requests: number };
}
