import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import { runSignalAlerts } from '@/lib/alerts/runner';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getProvidedKey(req) {
  const url = new URL(req.url);
  return req.headers.get('x-alert-test-key') || url.searchParams.get('key') || '';
}

export async function GET(req) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env?.ALERT_TEST_KEY) {
      return NextResponse.json(
        { error: 'ALERT_TEST_KEY secret is missing.' },
        { status: 503 },
      );
    }

    if (getProvidedKey(req) !== env.ALERT_TEST_KEY) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const result = await runSignalAlerts({ env });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[alerts:run]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
