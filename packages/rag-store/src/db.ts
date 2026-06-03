import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DB_DIR  = join(homedir(), '.token-optimizer');
const DB_PATH = join(DB_DIR, 'rag-store.sqlite');

export type RagDB = ReturnType<typeof Database>;

export function initRagDB(dbPath = DB_PATH): RagDB {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    UNIQUE NOT NULL,
      description TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      source      TEXT,
      updated_at  TEXT    NOT NULL,
      embedding   BLOB    NOT NULL   -- Float32Array stored as raw bytes
    );
    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
  `);
  return db;
}

// ─── Cosine similarity (pure JS, no native dep) ──────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer);
}

function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface RagItem {
  name: string;
  description: string;
  content: string;
  source?: string;
  embedding: Float32Array;
}

export function upsertItem(db: RagDB, item: RagItem): void {
  const now = new Date().toISOString();
  const embBuf = float32ToBuffer(item.embedding);
  db.prepare(`
    INSERT INTO items(name, description, content, source, updated_at, embedding)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      content     = excluded.content,
      source      = excluded.source,
      updated_at  = excluded.updated_at,
      embedding   = excluded.embedding
  `).run(item.name, item.description, item.content, item.source ?? null, now, embBuf);
}

export interface SearchResult {
  name: string;
  description: string;
  content: string;
  source: string | null;
  similarity: number;
}

export function searchItems(
  db: RagDB,
  queryEmbedding: Float32Array,
  topK = 3,
  threshold = 0.3,
): SearchResult[] {
  const rows = db.prepare(`SELECT name, description, content, source, embedding FROM items`).all() as any[];

  return rows
    .map(row => ({
      name:        row.name as string,
      description: row.description as string,
      content:     row.content as string,
      source:      row.source as string | null,
      similarity:  cosineSimilarity(queryEmbedding, bufferToFloat32(row.embedding)),
    }))
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export function countItems(db: RagDB): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM items').get() as { n: number };
  return row.n;
}

export function listItems(db: RagDB): Array<{ name: string; description: string; updated_at: string }> {
  return db.prepare('SELECT name, description, updated_at FROM items ORDER BY name').all() as any[];
}
