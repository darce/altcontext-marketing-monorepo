import { pool } from "./lib/db.js";
import { createApp } from "./app.js";
import { env } from "./config/env.js";

const startServer = async (): Promise<void> => {
  const app = await createApp();

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
  };

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.on(signal, () => {
      void shutdown()
        .catch((error: unknown) => {
          app.log.error({ err: error }, "graceful shutdown failed");
        })
        .finally(() => {
          process.exit(0);
        });
    });
  });

  try {
    const client = await pool.connect();
    client.release();
  } catch (error) {
    app.log.error({ err: error }, "database connection failed");
    process.exitCode = 1;
    return;
  }

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });
  } catch (error) {
    app.log.error({ err: error }, "server startup failed");
    await pool.end();
    process.exitCode = 1;
  }
};

void startServer();
