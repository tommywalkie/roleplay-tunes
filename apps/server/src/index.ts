import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
