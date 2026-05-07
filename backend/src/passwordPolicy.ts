// backend/src/passwordPolicy.ts
import { config } from './config';
import { AppError } from './errors';

/**
 * Throws AppError on policy violation. Used wherever a new password is set
 * (signup, admin-create, change-password, reset-password).
 */
export function assertPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== 'string') {
    throw new AppError('password_required', 400, 'password_required');
  }
  if (password.length < config.auth.minPasswordLength) {
    throw new AppError(
      'password_too_short',
      400,
      `Password must be at least ${config.auth.minPasswordLength} characters.`
    );
  }
  if (config.auth.requirePasswordComplexity) {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const classes = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
    if (classes < 3) {
      throw new AppError(
        'password_too_weak',
        400,
        'Password must include at least one lowercase letter, one uppercase letter, and one digit.'
      );
    }
  }
}
