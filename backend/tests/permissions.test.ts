// tests/permissions.test.ts
import { permissionMiddleware } from '../src/middleware/permissionMiddleware';
import {
  resetDb,
  makeUser,
  makeGroup,
  addUserToGroup,
  grantPermission,
} from './helpers';

type FakeReq = {
  user?: { sub: number; username: string; role: string };
};

function callMiddleware(
  user: FakeReq['user'],
  resource: string,
  access: 'read' | 'write'
): { status: number; body?: any; nextCalled: boolean } {
  const req: any = { user };
  let status = 200;
  let body: any = undefined;
  let nextCalled = false;
  const res: any = {
    status(code: number) {
      status = code;
      return res;
    },
    json(b: any) {
      body = b;
      return res;
    },
  };
  permissionMiddleware(resource, access)(req, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
}

describe('permissionMiddleware', () => {
  beforeEach(() => resetDb());

  test('rejects when user is missing', () => {
    const r = callMiddleware(undefined, 'file', 'read');
    expect(r.status).toBe(401);
    expect(r.nextCalled).toBe(false);
  });

  test('admin role bypasses checks', async () => {
    const adminId = await makeUser('alice', 'admin');
    const r = callMiddleware(
      { sub: adminId, username: 'alice', role: 'admin' },
      'file',
      'write'
    );
    expect(r.nextCalled).toBe(true);
    expect(r.status).toBe(200);
  });

  test('non-admin without any rules is denied (default-deny)', async () => {
    const userId = await makeUser('bob', 'user');
    const r = callMiddleware({ sub: userId, username: 'bob', role: 'user' }, 'file', 'read');
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
  });

  test('non-admin with matching read permission is allowed', async () => {
    const userId = await makeUser('carol', 'user');
    const groupId = makeGroup('readers');
    addUserToGroup(userId, groupId);
    grantPermission(groupId, 'file', 'read');

    const r = callMiddleware({ sub: userId, username: 'carol', role: 'user' }, 'file', 'read');
    expect(r.nextCalled).toBe(true);
  });

  test('read access does NOT imply write', async () => {
    const userId = await makeUser('dave', 'user');
    const groupId = makeGroup('readers');
    addUserToGroup(userId, groupId);
    grantPermission(groupId, 'file', 'read');

    const r = callMiddleware({ sub: userId, username: 'dave', role: 'user' }, 'file', 'write');
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
  });

  test('read-write access satisfies both read and write', async () => {
    const userId = await makeUser('eve', 'user');
    const groupId = makeGroup('rw');
    addUserToGroup(userId, groupId);
    grantPermission(groupId, 'file', 'read-write');

    expect(
      callMiddleware({ sub: userId, username: 'eve', role: 'user' }, 'file', 'read').nextCalled
    ).toBe(true);
    expect(
      callMiddleware({ sub: userId, username: 'eve', role: 'user' }, 'file', 'write').nextCalled
    ).toBe(true);
  });

  test('specific resource (file:my-bucket) satisfies generic resource (file)', async () => {
    const userId = await makeUser('frank', 'user');
    const groupId = makeGroup('scoped');
    addUserToGroup(userId, groupId);
    grantPermission(groupId, 'file:my-bucket', 'write');

    const r = callMiddleware({ sub: userId, username: 'frank', role: 'user' }, 'file', 'write');
    expect(r.nextCalled).toBe(true);
  });
});
