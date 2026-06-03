/**
 * RAG query CLI
 * Usage: tsx src/query-cli.ts "deploy docker container" [--top=5] [--full]
 */
import { initRagDB, searchItems, countItems } from './db.js';
import { embed } from './embedder.js';

const args = process.argv.slice(2);
const query = args.filter(a => !a.startsWith('--')).join(' ');
const topK  = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] ?? '3');
const full  = args.includes('--full');

if (!query) {
  console.error('Usage: tsx src/query-cli.ts "<query>" [--top=N] [--full]');
  process.exit(1);
}

const db = initRagDB();
console.log(`RAG store: ${countItems(db)} items indexed\n`);
console.log(`Query: "${query}"\n${'─'.repeat(50)}`);

const queryEmb = await embed(query);
const results  = searchItems(db, queryEmb, topK);
db.close();

if (!results.length) {
  console.log('No results above threshold (0.3). Try re-indexing or different query.');
  process.exit(0);
}

for (const r of results) {
  console.log(`\n[${(r.similarity * 100).toFixed(1)}%] ${r.name}`);
  console.log(`  ${r.description}`);
  if (full) {
    console.log('\n' + r.content.slice(0, 500) + (r.content.length > 500 ? '\n...' : ''));
  }
}
