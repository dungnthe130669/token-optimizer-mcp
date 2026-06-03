import { indexHermesSkills } from '@token-optimizer/rag-store';
import { homedir } from 'os';
import { join } from 'path';

export async function run(args: string[]) {
  const dir = args.find(a => !a.startsWith('--')) ?? join(homedir(), '.hermes', 'skills');
  console.log(`\nIndexing skills from: ${dir}`);
  console.log('(First run downloads ~22MB model — cached after that)\n');
  const { indexed, skipped } = await indexHermesSkills(dir);
  console.log(`\n✓ Done: ${indexed} indexed, ${skipped} skipped`);
  console.log(`  Run "tok search <query>" to test\n`);
}
