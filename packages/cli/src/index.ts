#!/usr/bin/env node
/**
 * tok — Token Optimizer CLI
 * Usage:
 *   tok stats [--days=7]
 *   tok index [skills-dir]
 *   tok search <query> [--top=3]
 *   tok dashboard
 */

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case 'stats':    await import('./commands/stats.js').then(m => m.run(args)); break;
  case 'index':    await import('./commands/index-skills.js').then(m => m.run(args)); break;
  case 'search':   await import('./commands/search.js').then(m => m.run(args)); break;
  case 'dashboard': await import('./commands/dashboard.js').then(m => m.run(args)); break;
  default:
    console.log(`
tok — Token Optimizer CLI

Commands:
  tok stats [--days=7]         Show savings report
  tok index [dir]              Index skills into RAG store
  tok search <query> [--top=3] Semantic skill search
  tok dashboard                Start web dashboard (port 4242)

Examples:
  tok stats --days=30
  tok index ~/.hermes/skills
  tok search "deploy kubernetes"
`);
}
