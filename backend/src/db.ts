// backend/src/db.ts
// PostgreSQL connection pool and async database helpers
// All queries are workspace-scoped via workspace_id foreign key

import { Pool, PoolClient } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool({
  connectionString: config.database.url,
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pool error');
  process.exit(1);
});

// Migration system: track applied migrations in schema_migrations table
interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        aws_access_key_enc TEXT,
        aws_secret_key_enc TEXT,
        aws_region TEXT NOT NULL DEFAULT 'us-east-1',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, username)
      );

      CREATE TABLE IF NOT EXISTS workspace_invites (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        code TEXT UNIQUE NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, name)
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        access TEXT NOT NULL CHECK (access IN ('read', 'write', 'read-write'))
      );

      CREATE TABLE IF NOT EXISTS user_groups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        UNIQUE (user_id, group_id)
      );

      CREATE TABLE IF NOT EXISTS group_buckets (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        bucket_name TEXT NOT NULL,
        UNIQUE (group_id, bucket_name)
      );

      CREATE TABLE IF NOT EXISTS user_buckets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bucket_name TEXT NOT NULL,
        UNIQUE (user_id, bucket_name)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT,
        resource TEXT,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS upload_sessions (
        upload_id TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        bucket TEXT NOT NULL,
        key TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        total_bytes BIGINT NOT NULL DEFAULT 0,
        uploaded_bytes BIGINT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        parts_json JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_workspace_id ON users(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_groups_workspace_id ON groups(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_invites_code ON workspace_invites(code);
      CREATE INDEX IF NOT EXISTS idx_invites_workspace_id ON workspace_invites(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_id ON audit_logs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_upload_sessions_workspace_id ON upload_sessions(workspace_id);
    `,
  },
];

// Run all pending migrations
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Create schema_migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Get list of already-applied migrations
    const result = await client.query('SELECT id FROM schema_migrations');
    const applied = new Set(result.rows.map((r: any) => r.id));

    // Run each unapplied migration
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) {
        logger.info({ migration: migration.id }, 'Migration already applied');
        continue;
      }

      logger.info({ migration: migration.id }, 'Running migration');
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
        logger.info({ migration: migration.id }, 'Migration applied successfully');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

// ---- User functions ----

export async function findUserById(id: number): Promise<any> {
  const result = await pool.query(
    'SELECT id, username, password_hash, role, is_active, must_change_password, workspace_id FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

export async function findUserByUsername(workspaceId: number, username: string): Promise<any> {
  const result = await pool.query(
    'SELECT id, username, password_hash, role, is_active, must_change_password, workspace_id FROM users WHERE workspace_id = $1 AND username = $2',
    [workspaceId, username]
  );
  return result.rows[0];
}

export async function createUser(
  workspaceId: number,
  username: string,
  passwordHash: string,
  role = 'member'
): Promise<number> {
  const result = await pool.query(
    'INSERT INTO users (workspace_id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [workspaceId, username, passwordHash, role]
  );
  return result.rows[0].id;
}

export async function updateUser(id: number, updates: { must_change_password?: boolean; is_active?: boolean; role?: string }): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.must_change_password !== undefined) {
    fields.push(`must_change_password = $${paramIndex++}`);
    values.push(updates.must_change_password);
  }
  if (updates.is_active !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(updates.is_active);
  }
  if (updates.role !== undefined) {
    fields.push(`role = $${paramIndex++}`);
    values.push(updates.role);
  }

  if (fields.length === 0) return;

  values.push(id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
}

export async function listUsers(workspaceId: number): Promise<any[]> {
  const result = await pool.query(
    'SELECT id, username, role, is_active, created_at FROM users WHERE workspace_id = $1 ORDER BY created_at DESC',
    [workspaceId]
  );
  return result.rows;
}

export async function deleteUser(id: number): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

// ---- Workspace functions ----

export async function createWorkspace(name: string, slug: string): Promise<number> {
  const result = await pool.query(
    'INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id',
    [name, slug]
  );
  return result.rows[0].id;
}

export async function getWorkspace(id: number): Promise<any> {
  const result = await pool.query('SELECT * FROM workspaces WHERE id = $1', [id]);
  return result.rows[0];
}

export async function updateWorkspaceCredentials(
  workspaceId: number,
  accessKeyEnc: string,
  secretKeyEnc: string,
  region: string
): Promise<void> {
  await pool.query(
    'UPDATE workspaces SET aws_access_key_enc = $1, aws_secret_key_enc = $2, aws_region = $3 WHERE id = $4',
    [accessKeyEnc, secretKeyEnc, region, workspaceId]
  );
}

// ---- Workspace invite functions ----

export async function createInvite(
  workspaceId: number,
  code: string,
  createdBy: number,
  role: string,
  expiresAt: Date
): Promise<number> {
  const result = await pool.query(
    'INSERT INTO workspace_invites (workspace_id, code, created_by, role, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [workspaceId, code, createdBy, role, expiresAt]
  );
  return result.rows[0].id;
}

export async function getInviteByCode(code: string): Promise<any> {
  const result = await pool.query(
    'SELECT * FROM workspace_invites WHERE code = $1',
    [code]
  );
  return result.rows[0];
}

export async function markInviteAsUsed(id: number, usedBy: number): Promise<void> {
  await pool.query(
    'UPDATE workspace_invites SET used_at = NOW(), used_by = $1 WHERE id = $2',
    [usedBy, id]
  );
}

// ---- Audit log functions ----

export async function insertAudit(
  workspaceId: number,
  userId: number | null,
  action: string,
  resource: string,
  details: object | string = {}
): Promise<void> {
  const detailsJson = typeof details === 'string' ? details : JSON.stringify(details);
  await pool.query(
    'INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES ($1, $2, $3, $4, $5)',
    [workspaceId, userId, action, resource, detailsJson]
  );
}

export async function getAuditLogs(
  workspaceId: number,
  options: { limit?: number; offset?: number; userId?: number; action?: string; resource?: string } = {}
): Promise<{ logs: any[]; total: number }> {
  const { limit = 50, offset = 0, userId, action, resource } = options;

  let query = 'SELECT * FROM audit_logs WHERE workspace_id = $1';
  const params: any[] = [workspaceId];
  let paramIndex = 2;

  if (userId) {
    query += ` AND user_id = $${paramIndex++}`;
    params.push(userId);
  }
  if (action) {
    query += ` AND action = $${paramIndex++}`;
    params.push(action);
  }
  if (resource) {
    query += ` AND resource = $${paramIndex++}`;
    params.push(resource);
  }

  // Get total count
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].count);

  // Get paginated results
  query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return {
    logs: result.rows.map((row: any) => ({
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : row.details,
    })),
    total,
  };
}

// ---- Group functions ----

export async function createGroup(workspaceId: number, name: string): Promise<number> {
  const result = await pool.query(
    'INSERT INTO groups (workspace_id, name) VALUES ($1, $2) RETURNING id',
    [workspaceId, name]
  );
  return result.rows[0].id;
}

export async function listGroups(workspaceId: number): Promise<any[]> {
  const result = await pool.query(
    'SELECT id, name, created_at FROM groups WHERE workspace_id = $1 ORDER BY name',
    [workspaceId]
  );
  return result.rows;
}

export async function getGroup(id: number): Promise<any> {
  const result = await pool.query('SELECT * FROM groups WHERE id = $1', [id]);
  return result.rows[0];
}

export async function deleteGroup(id: number): Promise<void> {
  await pool.query('DELETE FROM groups WHERE id = $1', [id]);
}

// ---- Permission functions ----

export async function addPermission(groupId: number, resource: string, access: string): Promise<void> {
  await pool.query(
    'INSERT INTO permissions (group_id, resource, access) VALUES ($1, $2, $3)',
    [groupId, resource, access]
  );
}

export async function removePermission(id: number): Promise<void> {
  await pool.query('DELETE FROM permissions WHERE id = $1', [id]);
}

// ---- User-Group functions ----

export async function addUserToGroup(userId: number, groupId: number): Promise<void> {
  await pool.query(
    'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, groupId]
  );
}

export async function removeUserFromGroup(userId: number, groupId: number): Promise<void> {
  await pool.query(
    'DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2',
    [userId, groupId]
  );
}

export async function getUserGroups(userId: number): Promise<any[]> {
  const result = await pool.query(
    'SELECT g.* FROM groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = $1 ORDER BY g.name',
    [userId]
  );
  return result.rows;
}

// ---- Bucket access functions ----

export async function addUserBucket(userId: number, bucketName: string): Promise<void> {
  await pool.query(
    'INSERT INTO user_buckets (user_id, bucket_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, bucketName]
  );
}

export async function removeUserBucket(userId: number, bucketName: string): Promise<void> {
  await pool.query(
    'DELETE FROM user_buckets WHERE user_id = $1 AND bucket_name = $2',
    [userId, bucketName]
  );
}

export async function addGroupBucket(groupId: number, bucketName: string): Promise<void> {
  await pool.query(
    'INSERT INTO group_buckets (group_id, bucket_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [groupId, bucketName]
  );
}

export async function removeGroupBucket(groupId: number, bucketName: string): Promise<void> {
  await pool.query(
    'DELETE FROM group_buckets WHERE group_id = $1 AND bucket_name = $2',
    [groupId, bucketName]
  );
}

export async function getAllowedBucketsForUser(workspaceId: number, userId: number): Promise<string[]> {
  const result = await pool.query(
    `
    SELECT DISTINCT bucket_name FROM (
      SELECT gb.bucket_name FROM group_buckets gb
      JOIN user_groups ug ON ug.group_id = gb.group_id
      JOIN groups g ON g.id = gb.group_id
      WHERE ug.user_id = $1 AND g.workspace_id = $2
      UNION
      SELECT bucket_name FROM user_buckets WHERE user_id = $1
    ) buckets
    ORDER BY bucket_name
    `,
    [userId, workspaceId]
  );
  return result.rows.map((r: any) => r.bucket_name);
}

export async function totalBucketAssignments(workspaceId: number): Promise<number> {
  const result = await pool.query(
    `
    SELECT COUNT(DISTINCT bucket_name) as total FROM (
      SELECT DISTINCT gb.bucket_name FROM group_buckets gb
      JOIN groups g ON g.id = gb.group_id
      WHERE g.workspace_id = $1
      UNION
      SELECT DISTINCT bucket_name FROM user_buckets ub
      JOIN users u ON u.id = ub.user_id
      WHERE u.workspace_id = $1
    ) buckets
    `,
    [workspaceId]
  );
  return result.rows[0].total || 0;
}

// ---- Upload session functions ----

export async function createSession(
  uploadId: string,
  workspaceId: number,
  bucket: string,
  key: string,
  userId: number | null,
  totalBytes: number
): Promise<void> {
  await pool.query(
    `INSERT INTO upload_sessions (upload_id, workspace_id, bucket, key, user_id, total_bytes, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'uploading')`,
    [uploadId, workspaceId, bucket, key, userId, totalBytes]
  );
}

export async function getSession(uploadId: string): Promise<any> {
  const result = await pool.query(
    'SELECT * FROM upload_sessions WHERE upload_id = $1',
    [uploadId]
  );
  const row = result.rows[0];
  if (row) {
    row.parts = typeof row.parts_json === 'string' ? JSON.parse(row.parts_json) : row.parts_json;
  }
  return row;
}

export async function recordPart(uploadId: string, partNumber: number, etag: string): Promise<void> {
  // Atomically append part to parts_json array
  await pool.query(
    `UPDATE upload_sessions
     SET parts_json = jsonb_set(
       COALESCE(parts_json, '[]'::jsonb),
       '{' || jsonb_array_length(COALESCE(parts_json, '[]'::jsonb)) || '}',
       jsonb_build_object('PartNumber', $2, 'ETag', $3)
     ),
     uploaded_bytes = uploaded_bytes + $4
     WHERE upload_id = $1`,
    [uploadId, partNumber, etag, 0] // TODO: track actual bytes per part
  );
}

export async function markCompleted(uploadId: string): Promise<void> {
  await pool.query(
    'UPDATE upload_sessions SET status = $1 WHERE upload_id = $2',
    ['completed', uploadId]
  );
}

export async function markAborted(uploadId: string): Promise<void> {
  await pool.query(
    'UPDATE upload_sessions SET status = $1 WHERE upload_id = $2',
    ['aborted', uploadId]
  );
}

export async function cleanupStale(cutoffMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - cutoffMs);
  await pool.query(
    'DELETE FROM upload_sessions WHERE status IN ($1, $2) AND updated_at < $3',
    ['completed', 'aborted', cutoff]
  );
}
