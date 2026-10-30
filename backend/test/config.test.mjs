import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";

const databaseUrl = "postgresql://user:password@localhost:5432/userdie_digital";

test("configuration applies safe defaults and parses the PostgreSQL URL", () => {
  assert.deepEqual(readConfig({ DATABASE_URL: databaseUrl }), {
    port: 8080,
    databaseUrl,
    dbPoolMax: 10,
    databaseSsl: false,
    allowedOrigin: undefined,
  });
});

test("configuration accepts explicit bounded values and an exact HTTPS origin", () => {
  const config = readConfig({
    PORT: "8443",
    DATABASE_URL: databaseUrl,
    DB_POOL_MAX: "20",
    DATABASE_SSL: "true",
    ALLOWED_ORIGIN: "https://platform.example/",
  });
  assert.equal(config.port, 8443);
  assert.equal(config.dbPoolMax, 20);
  assert.equal(config.databaseSsl, true);
  assert.equal(config.allowedOrigin, "https://platform.example");
});

test("configuration rejects partial, non-integer and out-of-range port values", () => {
  for (const PORT of ["8080junk", "0", "65536", "-1", "1.5"]) {
    assert.throws(() => readConfig({ PORT, DATABASE_URL: databaseUrl }), /PORT must be a whole number/);
  }
});

test("configuration bounds the database connection pool", () => {
  for (const DB_POOL_MAX of ["0", "51", "10clients", "1.5"]) {
    assert.throws(
      () => readConfig({ DB_POOL_MAX, DATABASE_URL: databaseUrl }),
      /DB_POOL_MAX must be a whole number/,
    );
  }
});

test("configuration requires a valid PostgreSQL connection URL", () => {
  for (const DATABASE_URL of [undefined, "not a url", "https://db.example"]) {
    assert.throws(() => readConfig({ DATABASE_URL }), /DATABASE_URL/);
  }
});

test("configuration accepts only explicit boolean database SSL values", () => {
  for (const DATABASE_SSL of ["yes", "1", "TRUE", ""]) {
    assert.throws(
      () => readConfig({ DATABASE_URL: databaseUrl, DATABASE_SSL }),
      /DATABASE_SSL must be either true or false/,
    );
  }
});

test("configuration rejects ALLOWED_ORIGIN values that are not exact web origins", () => {
  for (const ALLOWED_ORIGIN of [
    "not a url",
    "ftp://platform.example",
    "https://platform.example/app",
    "https://user:pass@platform.example",
    "https://platform.example/?next=/admin",
  ]) {
    assert.throws(
      () => readConfig({ DATABASE_URL: databaseUrl, ALLOWED_ORIGIN }),
      /ALLOWED_ORIGIN must be an exact HTTP or HTTPS origin/,
    );
  }
});
