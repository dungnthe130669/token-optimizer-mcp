'use client';
import { useEffect, useState } from 'react';

interface Row {
  tool: string;
  total_tokens_saved: number;
  total_cost_saved: number;
  requests: number;
}

interface Stats {
  days: number;
  rows: Row[];
  total: { tokens: number; cost: number; requests: number };
  projectedYearly: number;
}

const TOOL_COLORS: Record<string, string> = {
  compress_history:      '#58a6ff',
  compress_tool_output:  '#3fb950',
  deduplicate_context:   '#d2a8ff',
  filter_active_tools:   '#ffa657',
  search_relevant_skills:'#79c0ff',
  suggest_max_tokens:    '#56d364',
  warm_cache:            '#f78166',
  pack_context:          '#bc8cff',
  unpack_context:        '#bc8cff',
  default:               '#8b949e',
};

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ background: '#161b22', borderRadius: 4, height: 8, flex: 1 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '20px 24px', flex: 1 }}>
      <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#e6edf3' }}>{value}</div>
      {sub && <div style={{ color: '#8b949e', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats]   = useState<Stats | null>(null);
  const [days, setDays]     = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats?days=${days}`)
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  const maxTokens = stats ? Math.max(...stats.rows.map(r => r.total_tokens_saved), 1) : 1;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>⚡ Token Optimizer</h1>
          <div style={{ color: '#8b949e', fontSize: 13, marginTop: 4 }}>Savings dashboard — Claude Code / AI agents</div>
        </div>
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value))}
          style={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3', padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          {[1, 7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d}d</option>)}
        </select>
      </div>

      {loading && <div style={{ color: '#8b949e', textAlign: 'center', padding: 80 }}>Loading...</div>}

      {!loading && stats && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
            <StatCard
              label="TOKENS SAVED"
              value={stats.total.tokens.toLocaleString()}
              sub={`across ${stats.total.requests} requests`}
            />
            <StatCard
              label="COST SAVED"
              value={`$${stats.total.cost.toFixed(4)}`}
              sub={`~$${stats.projectedYearly.toFixed(2)} / year at this rate`}
            />
            <StatCard
              label="TOOLS USED"
              value={String(stats.rows.length)}
              sub={`over last ${days} days`}
            />
          </div>

          {/* Per-tool breakdown */}
          {stats.rows.length === 0 ? (
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 40, textAlign: 'center', color: '#8b949e' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div>No savings recorded yet.</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>Use MCP tools in Claude Code to start seeing data.</div>
            </div>
          ) : (
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: 12, display: 'grid', gridTemplateColumns: '200px 1fr 100px 100px 80px', gap: 16 }}>
                <span>TOOL</span><span>SAVINGS</span><span style={{ textAlign: 'right' }}>TOKENS</span><span style={{ textAlign: 'right' }}>COST</span><span style={{ textAlign: 'right' }}>REQS</span>
              </div>
              {stats.rows.map((row, i) => {
                const color = TOOL_COLORS[row.tool] ?? TOOL_COLORS.default;
                const pct   = (row.total_tokens_saved / maxTokens) * 100;
                return (
                  <div key={row.tool} style={{
                    padding: '14px 20px',
                    borderBottom: i < stats.rows.length - 1 ? '1px solid #21262d' : 'none',
                    display: 'grid',
                    gridTemplateColumns: '200px 1fr 100px 100px 80px',
                    gap: 16,
                    alignItems: 'center',
                  }}>
                    <span style={{ color, fontSize: 13, fontWeight: 600 }}>{row.tool}</span>
                    <Bar pct={pct} color={color} />
                    <span style={{ textAlign: 'right', fontSize: 13 }}>{row.total_tokens_saved.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: 13, color: '#3fb950' }}>${row.total_cost_saved.toFixed(4)}</span>
                    <span style={{ textAlign: 'right', fontSize: 13, color: '#8b949e' }}>{row.requests}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: 24, color: '#8b949e', fontSize: 12, textAlign: 'center' }}>
            Data from <code style={{ background: '#161b22', padding: '2px 6px', borderRadius: 4 }}>~/.token-optimizer/analytics.sqlite</code>
            {' '}· Refresh every 30s · <a href="/api/stats" style={{ color: '#58a6ff' }}>raw JSON</a>
          </div>
        </>
      )}
    </div>
  );
}
