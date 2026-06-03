import { initRagDB, searchItems } from './db.js';
import { embed } from './embedder.js';

export interface SearchOpts {
  topK?:      number;
  threshold?: number;
  dbPath?:    string;
  /** Return full content (default: false — description only for token efficiency) */
  fullContent?: boolean;
}

export async function search(query: string, opts: SearchOpts = {}) {
  const { topK = 3, threshold = 0.3, dbPath, fullContent = false } = opts;
  const db = initRagDB(dbPath);
  const queryEmb = await embed(query);
  const results  = searchItems(db, queryEmb, topK, threshold);
  db.close();

  return results.map(r => ({
    name:        r.name,
    description: r.description,
    similarity:  r.similarity,
    ...(fullContent ? { content: r.content } : {}),
  }));
}
