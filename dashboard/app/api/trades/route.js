import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import { listTradeRecords, recordTakeProfitTrade } from '@/lib/alerts/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  return env?.DB;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function missingDbResponse() {
  return NextResponse.json(
    { error: 'D1 DB binding is missing. Connect a D1 database with binding name DB.' },
    { status: 503 },
  );
}

function toClientPosition(position) {
  return {
    entry: Number.isFinite(position.entryPrice) ? String(position.entryPrice) : '',
    shares: Number.isFinite(position.shares) ? String(position.shares) : '',
  };
}

export async function GET(req) {
  try {
    const db = await getDb();
    if (!db) return missingDbResponse();

    const strategyKey = new URL(req.url).searchParams.get('strategy');
    const records = await listTradeRecords(db, strategyKey);
    return NextResponse.json({ records });
  } catch (err) {
    console.error('[trades:get]', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req) {
  try {
    const db = await getDb();
    if (!db) return missingDbResponse();

    const body = await req.json();
    const result = await recordTakeProfitTrade(db, {
      strategyKey: body.strategyKey,
      tpLabel: body.tpLabel,
      tradeDate: body.tradeDate,
      sellShares: numberOrNull(body.sellShares),
      sellPrice: numberOrNull(body.sellPrice),
      entryPrice: numberOrNull(body.entryPrice),
      replacementSymbol: body.replacementSymbol || 'SPYM',
      replacementShares: numberOrNull(body.replacementShares),
      replacementPrice: numberOrNull(body.replacementPrice),
      notes: body.notes,
    });

    return NextResponse.json({
      ...result,
      clientPosition: toClientPosition(result.position),
    });
  } catch (err) {
    console.error('[trades:post]', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
