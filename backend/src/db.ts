// backend/src/db.ts
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'database.sqlite');
export const db = new Database(DB_FILE);

// Production tuning. WAL gives concurrent readers + a single writer with much
// better throughput; busy_timeout makes the writer wait instead of erroring on
// short contention.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Create tables if not exist
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- audit_logs.user_id is nullable so audit history survives user deletion
-- (we set user_id = NULL rather than deleting rows).
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT,
  resource TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    resource TEXT NOT NULL,
    access TEXT NOT NULL, -- 'read', 'write', 'read-write'
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    UNIQUE(user_id, group_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_buckets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  bucket_name TEXT NOT NULL,
  UNIQUE(group_id, bucket_name),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_buckets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bucket_name TEXT NOT NULL,
  UNIQUE(user_id, bucket_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Persisted multipart upload sessions (replaces in-memory map).
CREATE TABLE IF NOT EXISTS upload_sessions (
  upload_id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id INTEGER,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  parts_json TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: ensure `must_change_password` column exists on users table (for older DBs)
const userInfo = db.prepare("PRAGMA table_info('users')").all() as Array<any>;
if (!userInfo.find((col) => col.name === 'must_change_password')) {
  try {
    db.prepare('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0').run();
    logger.info('Added must_change_password column to users table');
  } catch (err: any) {
    logger.warn({ err: err?.message || err }, 'Failed to add must_change_password column');
  }
}

// helper functions
export function findUserByUsername(username: string) {
  return db
    .prepare(
      'SELECT id, username, password_hash, role, is_active, must_change_password FROM users WHERE username = ?'
    )
    .get(username);
}

export function createUser(username: string, passwordHash: string, role = 'admin') {
  const stmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  const info = stmt.run(username, passwordHash, role);
  return info.lastInsertRowid;
}

export function insertAudit(
  userId: number | null,
  action: string,
  resource: string,
  details: object | string
) {
  const stmt = db.prepare(
    'INSERT INTO audit_logs (user_id, action, resource, details) VALUES (?, ?, ?, ?)'
  );
  stmt.run(userId, action, resource, JSON.stringify(details || {}));
}

// auto-create super admin if not exists (call from startup)
export async function ensureSuperAdminFromEnv() {
  const username = config.superAdmin.username;
  const password = config.superAdmin.password;
  if (!username || !password) {
    logger.warn(
      'SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD not set; skipping super admin creation.'
    );
    return;
  }
  const existing = findUserByUsername(username);
  if (existing) {
    logger.info({ username }, 'Super admin already exists');
    return;
  }
  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  createUser(username, hash, 'admin');
  logger.info({ username }, 'Created super admin user');
}

// Allowed bucket names for a user, via group or direct assignment.
export function getAllowedBucketsForUser(userId: number) {
  const stmt = db.prepare(`
    SELECT DISTINCT bucket_name as name FROM (
      SELECT gb.bucket_name FROM group_buckets gb
      JOIN user_groups ug ON ug.group_id = gb.group_id
      WHERE ug.user_id = ?
      UNION
      SELECT ub.bucket_name FROM user_buckets ub WHERE ub.user_id = ?
    )
  `);
  const rows = stmt.all(userId, userId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function totalBucketAssignments(): number {
  const row = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM group_buckets) + (SELECT COUNT(*) FROM user_buckets) as total`
    )
    .get() as any;
  return row ? Number(row.total || 0) : 0;
}
