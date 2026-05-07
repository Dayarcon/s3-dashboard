// tests/setupEnv.ts
// Sets up env vars for tests BEFORE config.ts is loaded.
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Each test run uses a fresh sqlite file inside a tempdir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's3dash-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-32-chars-long-xxxxxxxxxx';
process.env.DATA_DIR = tmp;
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ALLOWLIST = 'http://localhost:3000';
process.env.SUPER_ADMIN_USERNAME = '';
process.env.SUPER_ADMIN_PASSWORD = '';
process.env.PUBLIC_SIGNUP_ENABLED = 'false';
process.env.MIN_PASSWORD_LENGTH = '8';
