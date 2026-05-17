import { buildServer } from './server.js';
const port = Number(process.env.PORT ?? 4000);
const app = buildServer();
app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`API listening on ${port}`));
