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

test("live endpoint returns minimal health information", async () => {
  await withServer({ query: async () => { throw new Error("should not query"); } }, async (base) => {
    const response = await fetch(`${base}/api/v1/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
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

test("unknown routes return JSON 404 and write methods are disabled", async () => {
  await withServer({ query: async () => ({ rows: [] }) }, async (base) => {
    const missing = await fetch(`${base}/api/v1/unknown`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });

    const write = await fetch(`${base}/api/v1/applications`, { method: "POST" });
    assert.equal(write.status, 405);
    assert.deepEqual(await write.json(), { error: "method_not_allowed" });
  });
});
