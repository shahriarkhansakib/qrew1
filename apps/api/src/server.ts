import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createContainer } from './composition/container.js';
import { loadEnv } from './shared/env.js';

const env = loadEnv();
const container = createContainer(env);
const app = createApp(container);

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    container.logger.info({ port: info.port, nodeEnv: env.NODE_ENV }, 'Qrew API server listening');
  },
);

async function shutdown(signal: string): Promise<void> {
  container.logger.info({ signal }, 'Shutting down Qrew API server');
  server.close(async () => {
    await container.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
