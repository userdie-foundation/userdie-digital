import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createServer as createHandler } from "../src/server.mjs";

async function withServer(pool, run, options = {}) {
  const server = createServer(createHandler({ pool, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("live endpoint returns minimal health information and security headers", async () => {
  await withServer({ query: async () => { throw new Error("should not query"); } }, async (base) => {
    const response = await fetch(`${base}/api/v1/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
    const head = await fetch(`${base}/api/v1/health/live`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });
});

test("ready endpoint checks database connectivity", async () => {
  await withServer({ query: async () => ({ rows: [{ "?column?": 1 }] }) }, async (base) => {
    const response = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready" });
  });
});

test("ready endpoint does not leak database errors", async () => {
  await withServer({ query: async () => { throw new Error("secret connection string"); } }, async (base) => {
    const response = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { status: "unavailable" });
    assert.equal(body.includes("secret"), false);
  });
});

test("CORS allows only the configured exact origin", async () => {
  await withServer({ query: async () => ({ rows: [] }) }, async (base) => {
    const allowed = await fetch(`${base}/api/v1/health/live`, {
      headers: { origin: "https://platform.example" },
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://platform.example");
    assert.equal(allowed.headers.get("vary"), "Origin");

    const rejected = await fetch(`${base}/api/v1/health/live`, {
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  }, { allowedOrigin: "https://platform.example" });
});

test("unknown routes return JSON 404 with security headers", async () => {
  await withServer({ query: async () => ({ rows: [] }) }, async (base) => {
    const missing = await fetch(`${base}/api/v1/unknown`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });
    assert.equal(missing.headers.get("x-frame-options"), "DENY");
  });
});

test("applications module fails closed without querying or changing records", async () => {
  let queryCount = 0;
  const pool = { query: async () => { queryCount += 1; throw new Error("unexpected database access"); } };
  await withServer(pool, async (base) => {
    const read = await fetch(`${base}/api/v1/applications`);
    assert.equal(read.status, 503);
    assert.deepEqual(await read.json(), { error: "applications_module_unavailable" });
    assert.equal(read.headers.get("cache-control"), "no-store");

    const head = await fetch(`${base}/api/v1/applications`, { method: "HEAD" });
    assert.equal(head.status, 503);
    assert.equal(await head.text(), "");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const write = await fetch(`${base}/api/v1/applications`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "must not persist" }),
      });
      assert.equal(write.status, 405, `${method} must remain disabled`);
      assert.deepEqual(await write.json(), { error: "method_not_allowed" });
      assert.equal(write.headers.get("x-content-type-options"), "nosniff");
    }
    assert.equal(queryCount, 0);
  });
});
