function validateRecoveryUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new TypeError("RECOVERY_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new TypeError("RECOVERY_URL must be an HTTPS page URL without credentials, query, or fragment");
  }
  return url;
}

export function createResendRecoveryMailer({
  apiKey,
  from,
  recoveryUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.trim().length < 10) {
    throw new TypeError("A Resend API key is required");
  }
  if (typeof from !== "string" || !/^(?:[^<>]*<)?[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>?$/.test(from.trim())) {
    throw new TypeError("A valid Resend sender address is required");
  }
  const baseUrl = validateRecoveryUrl(recoveryUrl);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A Fetch-compatible delivery function is required");
  }

  return async function sendRecoveryMessage({ email, token, expiresInSeconds } = {}) {
    if (typeof email !== "string" || typeof token !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 300 || expiresInSeconds > 3600) {
      throw new TypeError("Invalid recovery message payload");
    }

    const actionUrl = new URL(baseUrl);
    actionUrl.searchParams.set("token", token);
    const minutes = Math.ceil(expiresInSeconds / 60);
    const text = [
      "Поступил запрос на восстановление доступа к USERDIE Digital.",
      "",
      "Чтобы задать новый пароль, откройте ссылку:",
      actionUrl.toString(),
      "",
      `Ссылка действует ${minutes} мин. и может быть использована только один раз.`,
      "Если вы не запрашивали восстановление, просто проигнорируйте это письмо.",
    ].join("\n");

    let response;
    try {
      response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: from.trim(),
          to: [email],
          subject: "Восстановление доступа к USERDIE Digital",
          text,
        }),
      });
    } catch {
      throw new Error("Recovery email delivery failed");
    }

    if (!response?.ok) {
      // Do not expose provider response bodies, request identifiers, or secrets.
      throw new Error("Recovery email delivery failed");
    }
  };
}
