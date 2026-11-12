import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { extractTransactionalSql, listMigrationFiles } from "../src/db/migrations.mjs";

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
