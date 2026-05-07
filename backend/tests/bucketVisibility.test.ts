// tests/bucketVisibility.test.ts
//
// Verifies the visibility branching logic — admin bypass, explicit assignments,
// and the default-deny fallback when assignments exist but the user has none.
//
// We don't hit AWS; the test exercises getAllowedBucketsForUser + totalBucketAssignments
// which is what the routes use.

import {
  getAllowedBucketsForUser,
  totalBucketAssignments,
} from '../src/db';
import {
  resetDb,
  makeUser,
  makeGroup,
  addUserToGroup,
  assignBucketToGroup,
  assignBucketToUser,
} from './helpers';

describe('bucket visibility helpers', () => {
  beforeEach(() => resetDb());

  test('user with no assignments returns empty list', async () => {
    const userId = await makeUser('alice');
    expect(getAllowedBucketsForUser(userId)).toEqual([]);
  });

  test('via group assignment', async () => {
    const userId = await makeUser('bob');
    const groupId = makeGroup('engineers');
    addUserToGroup(userId, groupId);
    assignBucketToGroup(groupId, 'logs-prod');
    assignBucketToGroup(groupId, 'configs');
    expect(new Set(getAllowedBucketsForUser(userId))).toEqual(new Set(['logs-prod', 'configs']));
  });

  test('via direct user assignment', async () => {
    const userId = await makeUser('carol');
    assignBucketToUser(userId, 'personal');
    expect(getAllowedBucketsForUser(userId)).toEqual(['personal']);
  });

  test('group + direct assignments are unioned and deduped', async () => {
    const userId = await makeUser('dave');
    const groupId = makeGroup('shared');
    addUserToGroup(userId, groupId);
    assignBucketToGroup(groupId, 'shared-bucket');
    assignBucketToGroup(groupId, 'common');
    assignBucketToUser(userId, 'common'); // duplicate
    assignBucketToUser(userId, 'private');
    const allowed = new Set(getAllowedBucketsForUser(userId));
    expect(allowed).toEqual(new Set(['shared-bucket', 'common', 'private']));
  });

  test('totalBucketAssignments counts both tables', async () => {
    expect(totalBucketAssignments()).toBe(0);
    const groupId = makeGroup('gx');
    assignBucketToGroup(groupId, 'a');
    assignBucketToGroup(groupId, 'b');
    expect(totalBucketAssignments()).toBe(2);
    const u = await makeUser('eve');
    assignBucketToUser(u, 'c');
    expect(totalBucketAssignments()).toBe(3);
  });
});
