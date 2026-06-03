import { initAnalyticsDB, getSummary, getTotalSaved, MODEL_PRICES } from '@token-optimizer/core';

function flag(args: string[], name: string, def: number): number {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? parseInt(found.split('=')[1]) : def;
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export async function run(args: string[]) {
  const days = flag(args, 'days', 7);
  const db   = initAnalyticsDB();
  const rows = getSummary(db, days);
  const tot  = getTotalSaved(db, days);
  db.close();

  const totalTokens = tot?.total_tokens ?? 0;
  const totalCost   = tot?.total_cost   ?? 0;
  const totalReqs   = tot?.total_requests ?? 0;

  console.log(`\n${'━'.repeat(60)}`);
  console.log(` Token Optimizer — Savings Report (last ${days} days)`);
  console.log(`${'━'.repeat(60)}`);

  if (!rows.length) {
    console.log('\n  No savings recorded yet.\n  Start using MCP tools in Claude Code to see data here.\n');
    return;
  }

  // Per-tool breakdown
  const maxTokens = Math.max(...rows.map(r => r.total_tokens_saved));
  console.log('\n  By tool:\n');
  for (const r of rows) {
    const pct = maxTokens > 0 ? (r.total_tokens_saved / maxTokens) * 100 : 0;
    console.log(`  ${r.tool.padEnd(28)} ${bar(pct)} ${r.total_tokens_saved.toLocaleString().padStart(8)} tok  $${r.total_cost_saved.toFixed(4)}`);
    console.log(`  ${' '.repeat(28)}   ${r.requests} requests`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  TOTAL  ${totalReqs} requests  ${totalTokens.toLocaleString()} tokens saved  $${totalCost.toFixed(4)} saved`);

  // Annualized projection
  const dailyRate = totalCost / days;
  const yearly    = dailyRate * 365;
  if (yearly > 0) {
    console.log(`\n  At this rate: ~$${yearly.toFixed(2)} saved/year`);
  }

  console.log(`${'━'.repeat(60)}\n`);
}
