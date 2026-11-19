import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { createServer as createHandler } from "../src/server.mjs";

async function withServer(options, run) {
  const server = createHttpServer(createHandler({ pool: { query: async () => ({ rows: [] }) }, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("privacy consent write route remains behind same-origin protection and disabled-by-default flag", async () => {
  await withServer({ allowedOrigin: "https://platform.example" }, async (base) => {
    const noOrigin = await fetch(base + "/api/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(noOrigin.status, 403);
    assert.deepEqual(await noOrigin.json(), { error: "origin_not_allowed" });

    const disabled = await fetch(base + "/api/v1/privacy/consents", {
      method: "POST",
      headers: { origin: "https://platform.example", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(disabled.status, 503);
    assert.deepEqual(await disabled.json(), { error: "privacy_consent_grants_disabled" });
  });
});

test("privacy consent route supports only the narrow same-origin JSON preflight", async () => {
  await withServer({ allowedOrigin: "https://platform.example" }, async (base) => {
    const allowed = await fetch(base + "/api/v1/privacy/consents", {
      method: "OPTIONS",
      headers: {
        origin: "https://platform.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-methods"), "POST, OPTIONS");

    const denied = await fetch(base + "/api/v1/privacy/consents", {
      method: "OPTIONS",
      headers: {
        origin: "https://platform.example",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(denied.status, 403);
  });
});

test("enabled privacy consent route still requires a trusted active principal", async () => {
  await withServer({
    allowedOrigin: "https://platform.example",
    privacyConsentLedgerEnabled: true,
  }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents", {
      headers: { origin: "https://platform.example" },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  });
});
