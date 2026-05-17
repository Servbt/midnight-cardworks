import { buildServer } from './server.js';
import { createStoreFromEnv } from './storeFactory.js';

const port = Number(process.env.PORT ?? 4000);
const { store, disconnect } = await createStoreFromEnv();
const app = buildServer(store);

const shutdown = async () => {
  await disconnect?.();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`API listening on ${port}`));
