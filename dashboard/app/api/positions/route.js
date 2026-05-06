import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import { clearPosition, listPositions, upsertPosition } from '@/lib/alerts/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EMPTY_POSITIONS = {
  tqqq: { entry: '', shares: '' },
  bulz: { entry: '', shares: '' },
};

async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  return env?.DB;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toClientPositions(rows) {
  const positions = {
    tqqq: { ...EMPTY_POSITIONS.tqqq },
    bulz: { ...EMPTY_POSITIONS.bulz },
  };

  for (const row of rows) {
    if (!positions[row.strategyKey]) continue;
    positions[row.strategyKey] = {
      entry: Number.isFinite(row.entryPrice) ? String(row.entryPrice) : '',
      shares: Number.isFinite(row.shares) ? String(row.shares) : '',
    };
  }

  return positions;
}

function missingDbResponse() {
  return NextResponse.json(
    { error: 'D1 DB binding is missing. Connect a D1 database with binding name DB.' },
    { status: 503 },
  );
}

export async function GET() {
  try {
    const db = await getDb();
    if (!db) return missingDbResponse();

    const rows = await listPositions(db);
    return NextResponse.json({ positions: toClientPositions(rows), rows });
  } catch (err) {
    console.error('[positions:get]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const db = await getDb();
    if (!db) return missingDbResponse();

    const body = await req.json();
    const position = await upsertPosition(db, {
      strategyKey: body.strategyKey,
      entryPrice: numberOrNull(body.entryPrice),
      shares: numberOrNull(body.shares),
    });

    return NextResponse.json({ position });
  } catch (err) {
    console.error('[positions:put]', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  try {
    const db = await getDb();
    if (!db) return missingDbResponse();

    const strategyKey = new URL(req.url).searchParams.get('strategy');
    const position = await clearPosition(db, strategyKey);
    return NextResponse.json({ position });
  } catch (err) {
    console.error('[positions:delete]', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
