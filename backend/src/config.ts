// backend/src/config.ts
// Central environment configuration. Fails fast at startup if required vars are missing
// or insecure defaults are detected in production.

import 'dotenv/config';

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

// JWT secret: required, and must NOT be the legacy placeholder.
const JWT_SECRET = (() => {
  const v = process.env.JWT_SECRET;
  if (!v || v === 'change-me') {
    if (isProd) {
      throw new Error(
        'JWT_SECRET is missing or set to the insecure default "change-me". ' +
        'Set JWT_SECRET to a strong random value (32+ bytes).'
      );
    }
    // In dev, warn loudly but allow startup to ease local development.
    // eslint-disable-next-line no-console
    console.warn(
      '[config] JWT_SECRET is missing or insecure. Using a dev-only random secret. ' +
      'Set JWT_SECRET in your environment for stable tokens across restarts.'
    );
    return require('crypto').randomBytes(32).toString('hex') as string;
  }
  if (v.length < 16) {
    throw new Error('JWT_SECRET must be at least 16 characters.');
  }
  return v;
})();

// CORS: comma-separated allowlist. Empty in production = deny all cross-origin.
// In dev, defaults to localhost:3000 if unset to keep things friendly.
const CORS_ALLOWLIST = (() => {
  const list = parseList(process.env.CORS_ALLOWLIST);
  if (list.length === 0 && !isProd) return ['http://localhost:3000'];
  return list;
})();

// Database URL: required for PostgreSQL connection
const DATABASE_URL = required('DATABASE_URL', process.env.DATABASE_URL);

// Credentials encryption key: 64-char hex (32 bytes) for AES-256-GCM
// Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const CREDENTIALS_ENCRYPTION_KEY = (() => {
  const v = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!v || v === 'change-me') {
    if (isProd) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY is missing or set to the insecure default "change-me". ' +
        'Set CREDENTIALS_ENCRYPTION_KEY to a 64-char hex string (32 bytes).'
      );
    }
    // In dev, warn loudly but allow startup to ease local development.
    // eslint-disable-next-line no-console
    console.warn(
      '[config] CREDENTIALS_ENCRYPTION_KEY is missing or insecure. Using a dev-only random key. ' +
      'Set CREDENTIALS_ENCRYPTION_KEY in your environment for stable encryption across restarts.'
    );
    return require('crypto').randomBytes(32).toString('hex') as string;
  }
  if (v.length !== 64) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be exactly 64 characters (32 bytes in hex).');
  }
  return v;
})();

export const config = {
  nodeEnv: NODE_ENV,
  isProd,
  port: Number(process.env.PORT || 4000),
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',

  database: {
    url: DATABASE_URL,
  },

  credentials: {
    encryptionKey: CREDENTIALS_ENCRYPTION_KEY,
  },

  cors: {
    allowlist: CORS_ALLOWLIST,
  },

  rateLimit: {
    // Global window
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    // Tighter window for /auth/login
    loginWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60_000),
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  },

  uploads: {
    // Single-shot upload size cap. Multipart endpoint is preferred for larger files.
    maxFileBytes: Number(process.env.UPLOAD_MAX_BYTES || 25 * 1024 * 1024), // 25 MB
    bodyJsonLimit: process.env.JSON_BODY_LIMIT || '5mb',
  },

  auth: {
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
    minPasswordLength: Number(process.env.MIN_PASSWORD_LENGTH || 8),
    requirePasswordComplexity: parseBool(process.env.REQUIRE_PASSWORD_COMPLEXITY, true),
    // Account lockout after N failures within window.
    loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES || 5),
    loginFailureWindowMs: Number(process.env.LOGIN_FAILURE_WINDOW_MS || 15 * 60_000),
    loginLockoutMs: Number(process.env.LOGIN_LOCKOUT_MS || 15 * 60_000),
  },

  s3: {
    defaultRegion: process.env.AWS_REGION || 'ap-south-1',
    bucketLocationCacheTtlMs: Number(process.env.BUCKET_LOCATION_TTL_MS || 60 * 60_000),
    presignedUrlMaxTtlSeconds: Number(process.env.PRESIGNED_URL_MAX_TTL_SECONDS || 7 * 24 * 60 * 60), // 7 days
  },
};

// Helpful runtime sanity check: if anyone forgets CORS in prod, fail fast.
if (isProd && config.cors.allowlist.length === 0) {
  throw new Error(
    'CORS_ALLOWLIST is empty in production. Set it to a comma-separated list of allowed origins.'
  );
}
