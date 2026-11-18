import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import {
  isAnalyticalDocumentMethodAllowed,
  isAnalyticalDocumentRoute,
} from "../src/analytical-documents.mjs";
import { createServer as createHandler } from "../src/server.mjs";

async function withServer(pool, run, options = {}) {
  const server = createHttpServer(createHandler({ pool, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally {
    server.close();
    await once(server, "close");
  }
}

const principal = (id, ...grants) => ({ id, accountStatus: "active", grants });
const grant = (roleCode, scopeType = "global", scopeId) => ({
  roleCode, scopeType, ...(scopeId ? { scopeId } : {}),
});
const noDb = { async query() { return { rows: [] }; } };
const root = "/api/v1/analytical-documents";
const docId = "123e4567-e89b-42d3-a456-426614174000";

test("analytical document routes expose only the intended methods", () => {
  assert.equal(isAnalyticalDocumentRoute(root), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/${docId}`), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/${docId}/decision`), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/not-a-uuid`), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("GET", root), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("POST", root), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("DELETE", root), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("POST", `${root}/${docId}/submit`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("GET", `${root}/${docId}/submit`), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("PATCH", `${root}/${docId}/issue`), false);
});

test("analytical document API requires a trusted active session", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + root);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  });
});

test("analytical document creation is denied to roles without valuation authority", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + root, {
      method: "POST",
      headers: { origin: "https://platform.example", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "analytical_document_create_denied" });
  }, {
    allowedOrigin: "https://platform.example",
    resolvePrincipal: async () => principal("worker-1", grant("case_worker")),
  });
});

test("analytical document creation rejects self-review before database writes", async () => {
  let queries = 0;
  const pool = { async query() { queries += 1; return { rows: [] }; } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + root, {
      method: "POST",
      headers: { origin: "https://platform.example", "content-type": "application/json" },
      body: JSON.stringify({
        documentType: "preliminary_valuation",
        organizationalContour: "assets",
        title: "Synthetic report",
        reviewerId: "123e4567-e89b-42d3-a456-426614174000",
        content: { summary: "Synthetic content" },
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_analytical_document" });
  }, {
    allowedOrigin: "https://platform.example",
    resolvePrincipal: async () => principal(
      "123e4567-e89b-42d3-a456-426614174000",
      grant("asset_valuator", "contour", "assets"),
    ),
  });
  assert.equal(queries, 0);
});

test("analytical document list is read through the authenticated database boundary", async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + root);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { documents: [], count: 0 });
  }, {
    resolvePrincipal: async () => principal("auditor-1", grant("auditor")),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM analytical_documents/);
  assert.equal(calls[0].params[0], true);
});

test("analytical document writes remain same-origin protected", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + root, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
  }, {
    allowedOrigin: "https://platform.example",
    resolvePrincipal: async () => principal("valuator-1", grant("asset_valuator", "contour", "assets")),
  });
});
