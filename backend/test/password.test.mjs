import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/security/password.mjs";

test("password verifier is salted, versioned scrypt output and validates correct credentials", async () => {
  const first = await hashPassword("A sufficiently long test password!");
  const second = await hashPassword("A sufficiently long test password!");
  assert.match(first, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("A sufficiently long test password!", first), true);
  assert.equal(await verifyPassword("A different password entirely!", first), false);
});

test("password verifier rejects malformed, unsupported and oversized values", async () => {
  assert.equal(await verifyPassword("anything long enough", "not-a-verifier"), false);
  assert.equal(await verifyPassword("anything long enough", "argon2$invalid"), false);
  assert.equal(await verifyPassword("x".repeat(1025), "not-a-verifier"), false);
});

test("password hashing enforces minimum and maximum UTF-8 byte lengths", async () => {
  await assert.rejects(() => hashPassword("short"), RangeError);
  await assert.rejects(() => hashPassword("x".repeat(1025)), RangeError);
  await assert.rejects(() => hashPassword(null), TypeError);
});
