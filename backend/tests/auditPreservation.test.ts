// tests/auditPreservation.test.ts
//
// Verifies that deleting a user nulls out, but does NOT delete, their audit log
// rows. This protects long-term auditability across user lifecycle.

import { db } from '../src/db';
import { resetDb, makeUser, auditFor } from './helpers';

function deleteUser(userId: number) {
  // Mirror the logic in users.ts so we test the contract, not the route.
  const tx = db.transaction(() => {
    db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_buckets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

describe('audit log preservation on user delete', () => {
  beforeEach(() => resetDb());

  test('audit rows survive but become anonymous', async () => {
    const userId = await makeUser('grace');
    auditFor(userId, 'login');
    auditFor(userId, 'list');

    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as any).c
    ).toBe(2);

    deleteUser(userId);

    const after = db.prepare('SELECT * FROM audit_logs').all() as any[];
    expect(after.length).toBe(2);
    for (const row of after) expect(row.user_id).toBeNull();
    expect(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)).toBeUndefined();
  });
});
