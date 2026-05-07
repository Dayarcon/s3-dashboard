// tests/passwordPolicy.test.ts
import { assertPasswordPolicy } from '../src/passwordPolicy';
import { AppError } from '../src/errors';

describe('assertPasswordPolicy', () => {
  test('rejects too-short passwords', () => {
    expect(() => assertPasswordPolicy('aB1')).toThrow(AppError);
  });

  test('rejects passwords missing complexity (no digits)', () => {
    try {
      assertPasswordPolicy('Abcdefghi');
      throw new Error('expected throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe('password_too_weak');
    }
  });

  test('rejects passwords missing complexity (no uppercase)', () => {
    try {
      assertPasswordPolicy('abcdefg1');
      throw new Error('expected throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe('password_too_weak');
    }
  });

  test('accepts strong passwords', () => {
    expect(() => assertPasswordPolicy('Passw0rd!')).not.toThrow();
  });

  test('rejects non-strings', () => {
    try {
      // @ts-expect-error testing runtime path
      assertPasswordPolicy(undefined);
      throw new Error('expected throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe('password_required');
    }
  });
});
