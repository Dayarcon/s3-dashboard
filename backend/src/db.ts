// backend/src/db.ts
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'database.sqlite');
export const db = new Database(DB_FILE);

// Create tables if not exist
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT,
  resource TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

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
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE IF NOT EXISTS user_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Optional bucket assignment tables: assign buckets to groups or users
CREATE TABLE IF NOT EXISTS group_buckets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  bucket_name TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE IF NOT EXISTS user_buckets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bucket_name TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// helper functions
export function findUserByUsername(username: string) {
  return db.prepare('SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?').get(username);
}

export function createUser(username: string, passwordHash: string, role = 'admin') {
  const stmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  const info = stmt.run(username, passwordHash, role);
  return info.lastInsertRowid;
}

export function insertAudit(userId: number | null, action: string, resource: string, details: object | string) {
  const stmt = db.prepare('INSERT INTO audit_logs (user_id, action, resource, details) VALUES (?, ?, ?, ?)');
  stmt.run(userId, action, resource, JSON.stringify(details || {}));
}

// auto-create super admin if not exists (call from startup)
export async function ensureSuperAdminFromEnv() {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn('SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD not set; skipping super admin creation.');
    return;
  }
  const existing = findUserByUsername(username);
  if (existing) {
    console.log('Super admin already exists:', username);
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  createUser(username, hash, 'admin');
  console.log('Created super admin user:', username);
}

// Return list of allowed bucket names for a user based on group assignments or direct user assignments.
// If the returned array is empty it means no explicit assignments exist (caller may treat that as "no restriction").
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
  return rows.map(r => r.name);
}
