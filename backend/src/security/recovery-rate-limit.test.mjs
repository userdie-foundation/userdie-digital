import assert from "node:assert/strict";
import test from "node:test";
import { createRecoveryRateLimiter } from "./recovery-rate-limit.mjs";

const KEY = "test-only-recovery-hmac-key-with-at-least-32-bytes";

test("recovery limiter stores only keyed account and network digests", async () => {
  const calls = [];
  const limiter = createRecoveryRateLimiter({
    pool: { async query(sql, values) { calls.push({ sql, values }); return { rows: [{ blocked: false }] }; } },
    hmacKey: KEY,
  });
  assert.equal(await limiter.isBlocked({ email: " Person@Example.org ", clientAddress: "203.0.113.10" }), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.values[0]), ["account", "network"]);
  for (const call of calls) {
    assert.equal(Buffer.isBuffer(call.values[1]), true);
    assert.equal(call.values[1].length, 32);
    assert.doesNotMatch(JSON.stringify(call.values), /person@example\.org|203\.0\.113\.10/i);
  }
});

test("recovery attempts increment independent account and network buckets", async () => {
  const calls = [];
  const limiter = createRecoveryRateLimiter({
    pool: { async query(sql, values) { calls.push({ sql, values }); return { rows: [{ blocked: values[0] === "network" }] }; } },
    hmacKey: KEY, maxAttempts: 4, windowSeconds: 600, blockSeconds: 1200,
  });
  assert.deepEqual(await limiter.recordAttempt({ email: "person@example.org", clientAddress: "2001:db8::1" }), { blocked: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON CONFLICT \(bucket_type, key_hash\) DO UPDATE/);
  assert.deepEqual(calls[0].values.slice(2), [600, 4, 1200]);
});

test("recovery limiter rejects weak keys, invalid addresses and unsafe limits", async () => {
  const pool = { async query() { return { rows: [] }; } };
  assert.throws(() => createRecoveryRateLimiter({ pool, hmacKey: "short" }), /32 bytes/);
  assert.throws(() => createRecoveryRateLimiter({ pool, hmacKey: KEY, maxAttempts: 1 }), /maxAttempts/);
  const limiter = createRecoveryRateLimiter({ pool, hmacKey: KEY });
  await assert.rejects(() => limiter.isBlocked({ email: "person@example.org", clientAddress: "not-an-ip" }), /network address/);
});
