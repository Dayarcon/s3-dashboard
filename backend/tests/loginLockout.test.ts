// tests/loginLockout.test.ts
import { isLocked, recordFailure, recordSuccess } from '../src/loginLockout';
import { config } from '../src/config';

describe('loginLockout', () => {
  test('locks after configured number of failures', () => {
    const key = `test:${Date.now()}-${Math.random()}`;
    expect(isLocked(key).locked).toBe(false);
    let lockedReturn = false;
    for (let i = 0; i < config.auth.loginMaxFailures; i++) {
      lockedReturn = recordFailure(key);
    }
    expect(lockedReturn).toBe(true);
    expect(isLocked(key).locked).toBe(true);
  });

  test('recordSuccess clears the failure count', () => {
    const key = `test:${Date.now()}-${Math.random()}`;
    recordFailure(key);
    recordFailure(key);
    recordSuccess(key);
    // After clearing, we shouldn't be locked even after one more failure.
    recordFailure(key);
    expect(isLocked(key).locked).toBe(false);
  });
});
