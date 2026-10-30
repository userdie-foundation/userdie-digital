import { createServer as createHttpServer } from "node:http";
import { Pool } from "pg";
import { createServer } from "./server.mjs";
import { readConfig } from "./config.mjs";

const config = readConfig();

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
});

pool.on("error", () => {
  // Never log connection details or credentials.
  process.stderr.write("Database pool reported an idle client error.\n");
});

const server = createHttpServer(createServer({
  pool,
  allowedOrigin: config.allowedOrigin,
}));

server.listen(config.port, "0.0.0.0", () => {
  process.stdout.write(`USERDIE Digital API listening on port ${config.port}.\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`Received ${signal}; shutting down.\n`);
  const forceTimer = setTimeout(() => process.exit(1), 10000);
  forceTimer.unref();
  server.close(async () => {
    try {
      await pool.end();
      clearTimeout(forceTimer);
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
