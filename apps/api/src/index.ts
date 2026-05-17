import { buildServer } from './server.js';
import { createStoreFromEnv } from './storeFactory.js';

const port = Number(process.env.PORT ?? 4000);
const serveStaticRoot = process.env.SERVE_STATIC_ROOT ?? (process.env.NODE_ENV === 'production' ? 'apps/web/dist' : undefined);
const { store, disconnect } = await createStoreFromEnv();
const app = buildServer(store, { serveStaticRoot });

const shutdown = async () => {
  await disconnect?.();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`API listening on ${port}`));
