import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  extractTransactionalSql,
  listMigrationFiles,
} from "../src/db/migrations.mjs";

test("extracts a single explicit transaction wrapper without changing migration SQL", () => {
  const source = "-- header\nBEGIN;\nCREATE TABLE example (id integer);\nCOMMIT;\n";
  assert.equal(extractTransactionalSql(source), "-- header\nCREATE TABLE example (id integer);");
});

test("rejects migration files without exactly one ordered transaction wrapper", () => {
  assert.throws(() => extractTransactionalSql("CREATE TABLE example (id integer);"), /exactly one ordered/);
  assert.throws(() => extractTransactionalSql("BEGIN;\nBEGIN;\nCOMMIT;"), /exactly one ordered/);
  assert.throws(() => extractTransactionalSql("COMMIT;\nBEGIN;"), /exactly one ordered/);
  assert.throws(() => extractTransactionalSql("BEGIN;\nCOMMIT;\nCREATE TABLE unsafe (id integer);"), /after its COMMIT/);
});

test("repository migrations are sequential and each has one transaction wrapper", async () => {
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  const migrations = await listMigrationFiles(path.resolve(directory));
  assert.equal(migrations.length, 14);
  for (const migration of migrations) {
    const source = await readFile(migration.path, "utf8");
    assert.ok(extractTransactionalSql(source, migration.filename).length > 0, migration.filename);
  }
});

async function withMigrationDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "userdie-migrations-"));
  try {
    await writeFile(path.join(directory, "001_example.sql"),
      "BEGIN;\nCREATE TABLE migration_fixture (id integer);\nCOMMIT;\n");
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createMigrationClient({ failOnMigration = false } = {}) {
  const ledger = new Map();
  const calls = [];
  let transactionOpen = false;
  return {
    ledger,
    calls,
    async query(sql, params = []) {
      const normalized = sql.trim();
      calls.push(normalized);
      if (normalized.startsWith("SELECT pg_advisory_lock")) return { rowCount: 1, rows: [{}] };
      if (normalized.startsWith("SELECT pg_advisory_unlock")) return { rowCount: 1, rows: [{}] };
      if (normalized.startsWith("CREATE TABLE IF NOT EXISTS public.schema_migrations")) return { rowCount: 0, rows: [] };
      if (normalized.startsWith("SELECT checksum FROM public.schema_migrations")) {
        const row = ledger.get(params[0]);
        return row ? { rowCount: 1, rows: [{ checksum: row.checksum }] } : { rowCount: 0, rows: [] };
      }
      if (normalized === "BEGIN") { transactionOpen = true; return { rowCount: 0, rows: [] }; }
      if (normalized === "COMMIT") { transactionOpen = false; return { rowCount: 0, rows: [] }; }
      if (normalized === "ROLLBACK") { transactionOpen = false; return { rowCount: 0, rows: [] }; }
      if (normalized.startsWith("INSERT INTO public.schema_migrations")) {
        ledger.set(params[0], { filename: params[1], checksum: params[2] });
        return { rowCount: 1, rows: [] };
      }
      if (normalized.includes("CREATE TABLE migration_fixture") && failOnMigration) {
        throw new Error("synthetic migration failure");
      }
      if (normalized.includes("CREATE TABLE migration_fixture")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL in test double: ${normalized.slice(0, 100)}`);
    },
    get transactionOpen() { return transactionOpen; },
  };
}

test("applies a migration once and skips it on an identical checksum", async () => {
  await withMigrationDirectory(async (directory) => {
    const client = createMigrationClient();
    const first = await applyMigrations(client, directory);
    assert.deepEqual(first, { discovered: 1, applied: ["001"] });
    assert.equal(client.ledger.size, 1);
    const second = await applyMigrations(client, directory);
    assert.deepEqual(second, { discovered: 1, applied: [] });
    assert.equal(client.calls.filter((sql) => sql === "CREATE TABLE migration_fixture (id integer);").length, 1);
  });
});

test("refuses to change an already applied migration checksum", async () => {
  await withMigrationDirectory(async (directory) => {
    const client = createMigrationClient();
    await applyMigrations(client, directory);
    await writeFile(path.join(directory, "001_example.sql"),
      "BEGIN;\nCREATE TABLE migration_fixture (id bigint);\nCOMMIT;\n");
    await assert.rejects(applyMigrations(client, directory), /checksum mismatch/);
    assert.equal(client.calls.at(-1).startsWith("SELECT pg_advisory_unlock"), true);
  });
});

test("rolls back failed migration SQL and releases the advisory lock", async () => {
  await withMigrationDirectory(async (directory) => {
    const client = createMigrationClient({ failOnMigration: true });
    await assert.rejects(applyMigrations(client, directory), /Migration 001 failed; transaction rolled back/);
    assert.equal(client.transactionOpen, false);
    assert.equal(client.ledger.size, 0);
    assert.ok(client.calls.includes("ROLLBACK"));
    assert.equal(client.calls.at(-1).startsWith("SELECT pg_advisory_unlock"), true);
  });
});
