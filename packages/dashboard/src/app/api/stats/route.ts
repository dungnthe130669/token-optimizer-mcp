import { NextResponse } from 'next/server';
import { initAnalyticsDB, getSummary, getTotalSaved } from '@token-optimizer/core';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') ?? '7');

  try {
    const db      = initAnalyticsDB();
    const rows    = getSummary(db, days);
    const total   = getTotalSaved(db, days);
    db.close();

    const dailyRate = (total?.total_cost ?? 0) / days;
    return NextResponse.json({
      days,
      rows,
      total: {
        tokens:   total?.total_tokens   ?? 0,
        cost:     total?.total_cost     ?? 0,
        requests: total?.total_requests ?? 0,
      },
      projectedYearly: dailyRate * 365,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
