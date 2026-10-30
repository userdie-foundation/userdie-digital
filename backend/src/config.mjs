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

export function readConfig(env = process.env) {
  return {
    port: parseInteger("PORT", env.PORT, 8080, 1, 65535),
    databaseUrl: parseDatabaseUrl(env.DATABASE_URL),
    dbPoolMax: parseInteger("DB_POOL_MAX", env.DB_POOL_MAX, 10, 1, 50),
    databaseSsl: parseBoolean("DATABASE_SSL", env.DATABASE_SSL),
    allowedOrigin: parseAllowedOrigin(env.ALLOWED_ORIGIN),
  };
}
