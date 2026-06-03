import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { initRagDB, upsertItem } from './db.js';
import { embed } from './embedder.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_SKILLS_DIR = join(homedir(), '.hermes', 'skills');
const SKILL_FILENAME     = 'SKILL.md';

// ─── SKILL.md parser ─────────────────────────────────────────────────────────

interface SkillMeta {
  name: string;
  description: string;
}

function parseSkillMd(content: string): SkillMeta | null {
  const nameMatch = content.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (!nameMatch || !descMatch) return null;
  return {
    name:        nameMatch[1].trim(),
    description: descMatch[1].trim(),
  };
}

// ─── File scanner ─────────────────────────────────────────────────────────────

async function findSkillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) paths.push(...await findSkillFiles(full));
    else if (e.name === SKILL_FILENAME) paths.push(full);
  }
  return paths;
}

// ─── Generic item indexer (non-skill sources) ─────────────────────────────────

export interface IndexableItem {
  name: string;
  description: string;
  content: string;
  source?: string;
}

export async function indexItems(items: IndexableItem[], dbPath?: string): Promise<void> {
  const db = initRagDB(dbPath);
  for (const item of items) {
    const embeddingText = `${item.name}: ${item.description}`;
    const embedding = await embed(embeddingText);
    upsertItem(db, { ...item, embedding });
    console.log(`  indexed: ${item.name}`);
  }
  db.close();
}

// ─── Hermes skill indexer ─────────────────────────────────────────────────────

export async function indexHermesSkills(
  skillsDir = DEFAULT_SKILLS_DIR,
  dbPath?: string,
): Promise<{ indexed: number; skipped: number }> {
  const db = initRagDB(dbPath);
  const files = await findSkillFiles(skillsDir);
  console.log(`Found ${files.length} SKILL.md files in ${skillsDir}`);

  let indexed = 0, skipped = 0;
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const meta = parseSkillMd(content);
    if (!meta) { console.warn(`  skip (no frontmatter): ${file}`); skipped++; continue; }

    const embeddingText = `${meta.name}: ${meta.description}`;
    const embedding = await embed(embeddingText);
    upsertItem(db, {
      name:        meta.name,
      description: meta.description,
      content,
      source:      file,
      embedding,
    });
    console.log(`  ✓ ${meta.name}`);
    indexed++;
  }
  db.close();
  console.log(`\nDone: ${indexed} indexed, ${skipped} skipped`);
  return { indexed, skipped };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('indexer.ts') || process.argv[1]?.endsWith('indexer.js')) {
  const skillsDir = process.argv[2] ?? DEFAULT_SKILLS_DIR;
  console.log(`Indexing skills from: ${skillsDir}`);
  console.log('(First run downloads ~22MB model — subsequent runs use cache)\n');
  indexHermesSkills(skillsDir).catch(console.error);
}
