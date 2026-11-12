import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LOCK_NAMESPACE = 121341;
const LOCK_RESOURCE = 20261112;

export function extractTransactionalSql(source, filename = "migration.sql") {
  const lines = source.split(/\r?\n/);
  const beginLines = [];
  const commitLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*BEGIN;\s*$/i.test(lines[index])) beginLines.push(index);
    if (/^\s*COMMIT;\s*$/i.test(lines[index])) commitLines.push(index);
  }

  if (beginLines.length !== 1 || commitLines.length !== 1 || beginLines[0] >= commitLines[0]) {
    throw new Error(`${filename} must contain exactly one ordered BEGIN; and COMMIT; wrapper`);
  }
  if (lines.slice(commitLines[0] + 1).some((line) => line.trim() && !line.trim().startsWith("--"))) {
    throw new Error(`${filename} contains SQL after its COMMIT; wrapper`);
  }

  lines.splice(commitLines[0], 1);
  lines.splice(beginLines[0], 1);
  return lines.join("\n").trim();
}

export async function listMigrationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = MIGRATION_NAME.exec(entry.name);
      if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
      return { version: match[1], filename: entry.name, path: path.join(directory, entry.name) };
    })
    .sort((a, b) => a.version.localeCompare(b.version));

  if (files.length === 0) throw new Error("No SQL migrations found");
  for (let index = 0; index < files.length; index += 1) {
    const expected = String(index + 1).padStart(3, "0");
    if (files[index].version !== expected) {
      throw new Error(`Migration sequence gap: expected ${expected}, found ${files[index].version}`);
    }
  }
  return files;
}

export async function applyMigrations(client, directory) {
  const files = await listMigrationFiles(directory);
  const applied = [];

  await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_NAMESPACE, LOCK_RESOURCE]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        filename text NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT schema_migrations_version_format CHECK (version ~ '^[0-9]{3}$'),
        CONSTRAINT schema_migrations_checksum_format CHECK (checksum ~ '^[0-9a-f]{64}$')
      )
    `);

    for (const migration of files) {
      const source = await readFile(migration.path, "utf8");
      const checksum = createHash("sha256").update(source, "utf8").digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM public.schema_migrations WHERE version = $1",
        [migration.version],
      );

      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum.trim() !== checksum) {
          throw new Error(`Applied migration ${migration.version} checksum mismatch; refusing to continue`);
        }
        continue;
      }

      const sql = extractTransactionalSql(source, migration.filename);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
          [migration.version, migration.filename, checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.version} failed; transaction rolled back: ${error.message}`, { cause: error });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, LOCK_RESOURCE]);
  }

  return { discovered: files.length, applied };
}
