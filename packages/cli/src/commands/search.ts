import { search } from '@token-optimizer/rag-store';
import { initRagDB, countItems } from '@token-optimizer/rag-store';

function flag(args: string[], name: string, def: number): number {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? parseInt(found.split('=')[1]) : def;
}

export async function run(args: string[]) {
  const query = args.filter(a => !a.startsWith('--')).join(' ');
  const topK  = flag(args, 'top', 3);

  if (!query) {
    console.error('Usage: tok search <query> [--top=N]');
    process.exit(1);
  }

  const db    = initRagDB();
  const count = countItems(db);
  db.close();

  if (count === 0) {
    console.log('\n  RAG store empty. Run: tok index\n');
    process.exit(1);
  }

  console.log(`\nSearching ${count} indexed items for: "${query}"\n${'─'.repeat(50)}`);
  const results = await search(query, { topK });

  if (!results.length) {
    console.log('  No matches above threshold (30%). Try a different query.\n');
    return;
  }

  for (const r of results) {
    console.log(`\n  [${(r.similarity * 100).toFixed(0)}%] ${r.name}`);
    console.log(`       ${r.description}`);
  }
  console.log();
}
