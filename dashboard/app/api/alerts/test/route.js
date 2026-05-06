import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import { insertAlertLog } from '@/lib/alerts/db';
import { sendTelegramMessage } from '@/lib/alerts/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getProvidedKey(req) {
  const url = new URL(req.url);
  return req.headers.get('x-alert-test-key') || url.searchParams.get('key') || '';
}

function buildMessage(req) {
  const now = new Date();
  const kst = now.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
  });
  const origin = new URL(req.url).origin;

  return [
    '[ARA Signals] 테스트 알림',
    `시간: ${kst} KST`,
    '상태: 텔레그램 연결 성공',
    `사이트: ${origin}/signals`,
  ].join('\n');
}

async function logTestAlert(db, message) {
  if (!db) return false;

  await insertAlertLog(db, {
    alertKey: `test:${Date.now()}`,
    strategyKey: 'tqqq',
    cycleId: null,
    eventType: 'test',
    eventDate: new Date().toISOString().slice(0, 10),
    message,
  });

  return true;
}

async function handleTestAlert(req) {
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

    const message = buildMessage(req);
    await sendTelegramMessage({
      token: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      text: message,
    });

    let logged = false;
    try {
      logged = await logTestAlert(env.DB, message);
    } catch (err) {
      console.error('[alerts:test:log]', err);
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      logged,
    });
  } catch (err) {
    console.error('[alerts:test]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req) {
  return handleTestAlert(req);
}

export async function POST(req) {
  return handleTestAlert(req);
}
