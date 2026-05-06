import { NextResponse } from 'next/server';
import { loadAndSyncData } from '@/lib/csvLoader';
import { buildSignalDashboard } from '@/lib/signal-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const baseUrl = new URL(req.url).origin;
    const [tqqqBars, bulzBars, qqqBars] = await Promise.all([
      loadAndSyncData('tqqq', { baseUrl }),
      loadAndSyncData('bulz', { baseUrl }),
      loadAndSyncData('qqq', { baseUrl }),
    ]);

    const payload = buildSignalDashboard({ tqqqBars, bulzBars, qqqBars });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    console.error('[signals]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
