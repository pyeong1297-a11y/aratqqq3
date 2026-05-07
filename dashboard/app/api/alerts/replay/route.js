import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import { replayBulzTp1Alert } from '@/lib/alerts/replay';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getProvidedKey(req) {
  const url = new URL(req.url);
  return req.headers.get('x-alert-test-key') || url.searchParams.get('key') || '';
}

export async function GET(req) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const url = new URL(req.url);

    if (!env?.ALERT_TEST_KEY) {
      return NextResponse.json(
        { error: 'ALERT_TEST_KEY secret is missing.' },
        { status: 503 },
      );
    }

    if (getProvidedKey(req) !== env.ALERT_TEST_KEY) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const type = url.searchParams.get('type') || 'bulz_tp1';
    if (type !== 'bulz_tp1') {
      return NextResponse.json({ error: `Unsupported replay type: ${type}` }, { status: 400 });
    }

    const result = await replayBulzTp1Alert({
      env,
      baseUrl: url.origin,
      reason: 'manual',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[alerts:replay]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
