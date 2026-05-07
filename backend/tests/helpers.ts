// tests/helpers.ts
import bcrypt from 'bcrypt';
import { db, createUser, insertAudit } from '../src/db';

/** Reset every table in the test DB. */
export function resetDb() {
  const tables = [
    'audit_logs',
    'permissions',
    'user_groups',
    'user_buckets',
    'group_buckets',
    'upload_sessions',
    'groups',
    'users',
  ];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  // Reset autoincrement counters so IDs are stable across tests.
  try {
    db.prepare('DELETE FROM sqlite_sequence').run();
  } catch (_e) {
    /* sqlite_sequence may not exist if no AUTOINCREMENT row was inserted yet */
  }
}

export async function makeUser(username: string, role: 'admin' | 'user' = 'user') {
  const hash = await bcrypt.hash('Passw0rd!', 4);
  const id = createUser(username, hash, role);
  return Number(id);
}

export function makeGroup(name: string): number {
  const info = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

export function addUserToGroup(userId: number, groupId: number) {
  db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)').run(userId, groupId);
}

export function grantPermission(
  groupId: number,
  resource: string,
  access: 'read' | 'write' | 'read-write'
) {
  db.prepare('INSERT INTO permissions (group_id, resource, access) VALUES (?, ?, ?)').run(
    groupId,
    resource,
    access
  );
}

export function assignBucketToGroup(groupId: number, bucket: string) {
  db.prepare('INSERT INTO group_buckets (group_id, bucket_name) VALUES (?, ?)').run(groupId, bucket);
}

export function assignBucketToUser(userId: number, bucket: string) {
  db.prepare('INSERT INTO user_buckets (user_id, bucket_name) VALUES (?, ?)').run(userId, bucket);
}

/** Audit-log a no-op event (used to verify rows survive user delete). */
export function auditFor(userId: number, action = 'test_action') {
  insertAudit(userId, action, 'test', { hello: 'world' });
}
