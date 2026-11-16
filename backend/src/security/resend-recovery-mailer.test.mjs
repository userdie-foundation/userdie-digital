import test from "node:test";
import assert from "node:assert/strict";
import { createResendRecoveryMailer } from "./resend-recovery-mailer.mjs";

const settings = {
  apiKey: "re_test_key_123456789",
  from: "USERDIE Digital <security@example.org>",
  recoveryUrl: "https://platform.example/reset-password",
};

test("Resend recovery mailer sends a single-use token link without exposing the provider response", async () => {
  let request;
  const send = createResendRecoveryMailer({
    ...settings,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });

  await send({
    email: "person@example.org",
    token: "A".repeat(43),
    expiresInSeconds: 1800,
  });

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer " + settings.apiKey);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.from, settings.from);
  assert.deepEqual(payload.to, ["person@example.org"]);
  assert.equal(payload.subject, "Восстановление доступа к USERDIE Digital");
  assert.match(payload.text, /https:\/\/platform\.example\/reset-password\?token=A{43}/);
  assert.match(payload.text, /30 мин/);
  assert.equal(payload.html, undefined);
});

test("Resend recovery mailer fails with a generic error on provider rejection", async () => {
  const send = createResendRecoveryMailer({
    ...settings,
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => "secret provider detail" }),
  });
  await assert.rejects(
    send({ email: "person@example.org", token: "B".repeat(43), expiresInSeconds: 1800 }),
    (error) => error.message === "Recovery email delivery failed" &&
      !error.message.includes("secret"),
  );
});

test("Resend recovery mailer does not expose network errors or send malformed tokens", async () => {
  const send = createResendRecoveryMailer({
    ...settings,
    fetchImpl: async () => { throw new Error("private network detail"); },
  });
  await assert.rejects(
    send({ email: "person@example.org", token: "C".repeat(43), expiresInSeconds: 1800 }),
    /Recovery email delivery failed/,
  );
  await assert.rejects(
    send({ email: "person@example.org", token: "not-a-token", expiresInSeconds: 1800 }),
    /Invalid recovery message payload/,
  );
});

test("Resend recovery mailer rejects unsafe or incomplete configuration", () => {
  assert.throws(() => createResendRecoveryMailer({ ...settings, recoveryUrl: "http://platform.example/reset" }), /HTTPS/);
  assert.throws(() => createResendRecoveryMailer({ ...settings, recoveryUrl: "https://user:pass@platform.example/reset" }), /HTTPS/);
  assert.throws(() => createResendRecoveryMailer({ ...settings, apiKey: "" }), /API key/);
  assert.throws(() => createResendRecoveryMailer({ ...settings, from: "not-an-email" }), /sender address/);
});
