import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../migrations/012_mfa_persistence.sql", import.meta.url),
  "utf8",
);

test("MFA migration stores encrypted factor material and one-way challenge/recovery verifiers", () => {
  assert.match(sql, /CREATE TABLE auth_mfa_factors/);
  assert.match(sql, /secret_ciphertext bytea NOT NULL/);
  assert.match(sql, /secret_nonce bytea NOT NULL CHECK \(octet_length\(secret_nonce\) = 12\)/);
  assert.match(sql, /secret_auth_tag bytea NOT NULL CHECK \(octet_length\(secret_auth_tag\) = 16\)/);
  assert.match(sql, /encryption_key_id text NOT NULL/);
  assert.match(sql, /UNIQUE \(encryption_key_id, secret_nonce\)/);
  assert.match(sql, /last_accepted_step bigint/);
  assert.match(sql, /CREATE TABLE auth_mfa_challenges/);
  assert.match(sql, /challenge_hash bytea NOT NULL UNIQUE CHECK \(octet_length\(challenge_hash\) = 32\)/);
  assert.match(sql, /attempt_count BETWEEN 0 AND 5/);
  assert.match(sql, /CREATE TABLE auth_mfa_recovery_codes/);
  assert.match(sql, /verifier bytea NOT NULL UNIQUE CHECK \(octet_length\(verifier\) = 32\)/);
  assert.match(sql, /consumed_at/);
  assert.match(sql, /plaintext seeds and provisioning URIs are forbidden/);
  assert.match(sql, /never issue a normal session before successful verification/);
  assert.match(sql, /\$\$|BEGIN;/);
  assert.match(sql, /COMMIT;/);
});

test("MFA factor lifecycle constraints require confirmation before activation", () => {
  assert.match(sql, /status = 'pending' AND confirmed_at IS NULL AND disabled_at IS NULL/);
  assert.match(sql, /status = 'active' AND confirmed_at IS NOT NULL AND disabled_at IS NULL/);
  assert.match(sql, /status = 'disabled' AND disabled_at IS NOT NULL/);
  assert.match(sql, /AES-256-GCM/);
});
