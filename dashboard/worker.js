import nextWorker from './.open-next/worker.js';
import { runSignalAlerts } from './lib/alerts/runner.js';

const worker = {
  ...nextWorker,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runSignalAlerts({ env, scheduledTime: controller.scheduledTime }).catch((err) => {
        console.error('[scheduled:signal-alerts]', err);
        throw err;
      })
    );
  },
};

export default worker;
