import { Client } from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyMigrations } from "./migrations.mjs";

if (process.env.MIGRATIONS_ALLOW_APPLY !== "true") {
  throw new Error("Set MIGRATIONS_ALLOW_APPLY=true to explicitly authorize schema changes");
}
const connectionString = process.env.MIGRATIONS_DATABASE_URL;
if (!connectionString) {
  throw new Error("MIGRATIONS_DATABASE_URL is required; use a dedicated schema-owner credential, not the API runtime role");
}

const parsed = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
  throw new Error("MIGRATIONS_DATABASE_URL must be a valid PostgreSQL connection URL");
}

const client = new Client({
  connectionString,
  ssl: process.env.MIGRATIONS_DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 5000,
});
const directory = fileURLToPath(new URL("../../migrations/", import.meta.url));

try {
  await client.connect();
  const result = await applyMigrations(client, path.resolve(directory));
  process.stdout.write(`Migration check complete. Discovered: ${result.discovered}; newly applied: ${result.applied.length}.${result.applied.length ? ` Versions: ${result.applied.join(", ")}.` : ""}\n`);
} finally {
  await client.end();
}
