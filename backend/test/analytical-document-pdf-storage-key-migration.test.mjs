import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.PG_INTEGRATION_URL;

test("migration 022 enforces canonical UUID PDF storage keys in PostgreSQL", {
  skip: !databaseUrl ? "PG_INTEGRATION_URL is not configured" : false,
}, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const schema = `userdie_pdf_key_${randomUUID().replaceAll("-", "")}`;

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("CREATE TABLE analytical_document_artifacts (storage_key text NOT NULL)");
    await client.query(
      "INSERT INTO analytical_document_artifacts (storage_key) VALUES ($1)",
      ["123e4567-e89b-42d3-a456-426614174000.pdf"],
    );

    const migration = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../migrations/022_analytical_document_pdf_storage_key_constraint.sql", import.meta.url), "utf8")
    );
    await client.query(migration);

    await assert.rejects(
      client.query(
        "INSERT INTO analytical_document_artifacts (storage_key) VALUES ($1)",
        ["123e4567e89b42d3a456426614174000.pdf"],
      ),
      /analytical_document_artifacts_storage_key_uuid_check/i,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO analytical_document_artifacts (storage_key) VALUES ($1)",
        ["123e4567-e89b-02d3-a456-426614174000.pdf"],
      ),
      /analytical_document_artifacts_storage_key_uuid_check/i,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO analytical_document_artifacts (storage_key) VALUES ($1)",
        ["../123e4567-e89b-42d3-a456-426614174000.pdf"],
      ),
      /analytical_document_artifacts_storage_key_uuid_check/i,
    );
    const accepted = await client.query(
      "INSERT INTO analytical_document_artifacts (storage_key) VALUES ($1) RETURNING storage_key",
      ["550e8400-e29b-41d4-a716-446655440000.pdf"],
    );
    assert.equal(accepted.rows[0].storage_key, "550e8400-e29b-41d4-a716-446655440000.pdf");
  } finally {
    try {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      client.release();
      await pool.end();
    }
  }
});
