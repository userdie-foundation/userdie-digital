import { createServer as createHttpServer } from "node:http";
import { Pool } from "pg";
import { createServer } from "./server.mjs";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const databaseUrl = process.env.DATABASE_URL;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: Number.parseInt(process.env.DB_POOL_MAX ?? "10", 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

pool.on("error", () => {
  // Never log connection details or credentials.
  process.stderr.write("Database pool reported an idle client error.\n");
});

const server = createHttpServer(createServer({
  pool,
  allowedOrigin: process.env.ALLOWED_ORIGIN,
}));

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`USERDIE Digital API listening on port ${port}.\n`);
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
