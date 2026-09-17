import { startNotificationWorker } from './notificationWorker.js';
import { assertProductionConfig } from './productionConfig.js';
import { buildServer } from './server.js';
import { createStoreFromEnv } from './storeFactory.js';

assertProductionConfig();

const port = Number(process.env.PORT ?? 4000);
const serveStaticRoot = process.env.SERVE_STATIC_ROOT ?? (process.env.NODE_ENV === 'production' ? 'apps/web/dist' : undefined);
const { store, disconnect } = await createStoreFromEnv();
const app = await buildServer(store, { serveStaticRoot });

const stopNotifications = startNotificationWorker(store, error => console.error('Notification worker failed', error instanceof Error ? error.message : 'Unknown error'));

const shutdown = async () => {
  await app.close();
  await stopNotifications();
  await disconnect?.();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`API listening on ${port}`));
