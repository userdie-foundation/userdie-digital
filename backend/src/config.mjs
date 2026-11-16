function parseInteger(name, raw, fallback, min, max) {
  const value = raw === undefined ? String(fallback) : raw;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}`);
  }
  return parsed;
}

function parseDatabaseUrl(raw) {
  if (!raw) throw new Error("DATABASE_URL is required");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  return raw;
}

function parseBoolean(name, raw, fallback = false) {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false`);
}

function parseAllowedOrigin(raw) {
  if (raw === undefined || raw === "") return undefined;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ALLOWED_ORIGIN must be an exact HTTP or HTTPS origin");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    !["", "/"].includes(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("ALLOWED_ORIGIN must be an exact HTTP or HTTPS origin");
  }
  return parsed.origin;
}

function parseRecoveryUrl(raw) {
  if (raw === undefined || raw === "") return undefined;
  let parsed;
  try { parsed = new URL(raw); } catch {
    throw new Error("RECOVERY_URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username ||
      parsed.password || parsed.search || parsed.hash) {
    throw new Error("RECOVERY_URL must be an HTTPS page URL without credentials, query, or fragment");
  }
  return parsed.toString();
}

function parseSender(raw) {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" ||
      !/^(?:[^<>]*<)?[^<>\\s@]+@[^<>\\s@]+\\.[^<>\\s@]+>?$/.test(raw.trim())) {
    throw new Error("RESEND_FROM_EMAIL must be a valid sender email address");
  }
  return raw.trim();
}

export function readConfig(env = process.env) {
  const loginRateLimitHmacKey = env.LOGIN_RATE_LIMIT_HMAC_KEY;
  if (loginRateLimitHmacKey !== undefined && Buffer.byteLength(loginRateLimitHmacKey, "utf8") < 32) {
    throw new Error("LOGIN_RATE_LIMIT_HMAC_KEY must contain at least 32 bytes");
  }
  const recoveryRateLimitHmacKey = env.RECOVERY_RATE_LIMIT_HMAC_KEY;
  if (recoveryRateLimitHmacKey !== undefined && Buffer.byteLength(recoveryRateLimitHmacKey, "utf8") < 32) {
    throw new Error("RECOVERY_RATE_LIMIT_HMAC_KEY must contain at least 32 bytes");
  }

  const resendApiKey = env.RESEND_API_KEY;
  const resendFromEmail = parseSender(env.RESEND_FROM_EMAIL);
  const recoveryUrl = parseRecoveryUrl(env.RECOVERY_URL);
  const resendSettingsProvided = [resendApiKey, resendFromEmail, recoveryUrl]
    .some((value) => value !== undefined && value !== "");
  const resendSettingsComplete = typeof resendApiKey === "string" &&
    resendApiKey.trim().length >= 10 && Boolean(resendFromEmail) && Boolean(recoveryUrl);
  if (resendSettingsProvided && !resendSettingsComplete) {
    throw new Error("RESEND_API_KEY, RESEND_FROM_EMAIL, and RECOVERY_URL must be configured together");
  }

  return {
    port: parseInteger("PORT", env.PORT, 8080, 1, 65535),
    databaseUrl: parseDatabaseUrl(env.DATABASE_URL),
    dbPoolMax: parseInteger("DB_POOL_MAX", env.DB_POOL_MAX, 10, 1, 50),
    databaseSsl: parseBoolean("DATABASE_SSL", env.DATABASE_SSL),
    allowedOrigin: parseAllowedOrigin(env.ALLOWED_ORIGIN),
    loginRateLimitHmacKey,
    recoveryRateLimitHmacKey,
    resendApiKey: resendSettingsComplete ? resendApiKey : undefined,
    resendFromEmail,
    recoveryUrl,
  };
}
