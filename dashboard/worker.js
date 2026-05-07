import nextWorker from './.open-next/worker.js';
import { runSignalAlerts } from './lib/alerts/runner.js';
import { replayBulzTp1Alert } from './lib/alerts/replay.js';

function getNewYorkParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp));

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isMarketCloseCron(controller) {
  if (!['0 20 * * 1-5', '0 21 * * 1-5'].includes(controller.cron)) return false;

  const parts = getNewYorkParts(controller.scheduledTime);
  const weekday = parts.weekday;
  const hour = Number(parts.hour);

  return !['Sat', 'Sun'].includes(weekday) && hour === 16;
}

const worker = {
  ...nextWorker,
  async scheduled(controller, env, ctx) {
    let task;

    if (controller.cron === '0 6 * * *') {
      task = replayBulzTp1Alert({ env, reason: 'scheduled-1500' });
    } else if (isMarketCloseCron(controller)) {
      task = runSignalAlerts({ env, scheduledTime: controller.scheduledTime });
    } else {
      task = Promise.resolve({
        ok: true,
        skipped: true,
        reason: 'Not the New York 16:00 market-close cron.',
      });
    }

    ctx.waitUntil(
      task.catch((err) => {
        console.error('[scheduled:signal-alerts]', err);
        throw err;
      })
    );
  },
};

export default worker;
