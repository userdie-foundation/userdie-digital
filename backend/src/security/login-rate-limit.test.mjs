import assert from "node:assert/strict";
import test from "node:test";

import { createLoginRateLimiter } from "./login-rate-limit.mjs";

const KEY = "test-only-hmac-key-with-at-least-32-bytes";

test("login limiter stores only keyed account and network digests", async () => {
  const calls = [];
  const limiter = createLoginRateLimiter({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ blocked: false }] };
      },
    },
    hmacKey: KEY,
  });

  assert.equal(await limiter.isBlocked({
    email: " Person@Example.org ",
    clientAddress: "203.0.113.10",
  }), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.values[0]), ["account", "network"]);
  for (const call of calls) {
    assert.equal(Buffer.isBuffer(call.values[1]), true);
    assert.equal(call.values[1].length, 32);
    assert.doesNotMatch(JSON.stringify(call.values), /person@example\.org|203\.0\.113\.10/i);
  }
});

test("failed login attempts update both independent buckets and report blocking", async () => {
  const calls = [];
  const limiter = createLoginRateLimiter({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ blocked: values[0] === "network" }] };
      },
    },
    hmacKey: KEY,
    maxAttempts: 4,
    windowSeconds: 600,
    blockSeconds: 1200,
  });

  const result = await limiter.recordFailure({
    email: "person@example.org",
    clientAddress: "2001:db8::1",
  });

  assert.deepEqual(result, { blocked: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON CONFLICT \(bucket_type, key_hash\) DO UPDATE/);
  assert.match(calls[0].sql, /blocked_until/);
  assert.deepEqual(calls[0].values.slice(2), [600, 4, 1200]);
});

test("successful authentication can clear only the account bucket", async () => {
  const calls = [];
  const limiter = createLoginRateLimiter({
    pool: { async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } },
    hmacKey: KEY,
  });

  await limiter.clearAccountFailures({ email: " PERSON@example.org " });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /bucket_type = 'account'/);
  assert.equal(Buffer.isBuffer(calls[0].values[0]), true);
  assert.equal(calls[0].values[0].length, 32);
});

test("limiter rejects weak keys, invalid addresses and unsafe limits", async () => {
  const pool = { async query() { return { rows: [] }; } };
  assert.throws(() => createLoginRateLimiter({ pool, hmacKey: "too-short" }), /32 bytes/);
  assert.throws(() => createLoginRateLimiter({ pool, hmacKey: KEY, maxAttempts: 1 }), /maxAttempts/);

  const limiter = createLoginRateLimiter({ pool, hmacKey: KEY });
  await assert.rejects(
    () => limiter.isBlocked({ email: "person@example.org", clientAddress: "not-an-ip" }),
    /network address/,
  );
});
