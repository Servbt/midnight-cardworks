import { buildServer } from './server.js';
import { createStoreFromEnv } from './storeFactory.js';
import { releaseExpiredReservations } from './checkoutLifecycle.js';
import { deliverOrderNotifications } from './orderNotifications.js';
import { createEmailNotifierFromEnv } from './emailNotifications.js';

const port = Number(process.env.PORT ?? 4000);
const serveStaticRoot = process.env.SERVE_STATIC_ROOT ?? (process.env.NODE_ENV === 'production' ? 'apps/web/dist' : undefined);
const { store, disconnect } = await createStoreFromEnv();
const emailNotifier = createEmailNotifierFromEnv();
const app = buildServer(store, { serveStaticRoot, emailNotifier });
let reservationCleanup: Promise<void> | undefined;
const cleanReservations = () => {
  if (reservationCleanup) return;
  reservationCleanup = releaseExpiredReservations(store, (orderId, error) => console.error('Reservation reconciliation needs retry or review', orderId, error instanceof Error ? error.message : 'Unknown error'))
    .then(() => deliverOrderNotifications(store, emailNotifier, undefined, (id, error) => console.error('Notification needs retry or review', id, error instanceof Error ? error.message : 'Unknown error')))
    .catch((error) => console.error('Reservation cleanup failed', error instanceof Error ? error.message : 'Unknown error'))
    .finally(() => { reservationCleanup = undefined; });
};
const cleanupTimer = setInterval(cleanReservations, 60_000);
cleanupTimer.unref();
cleanReservations();

const shutdown = async () => {
  clearInterval(cleanupTimer);
  await app.close();
  await reservationCleanup;
  await disconnect?.();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`API listening on ${port}`));
