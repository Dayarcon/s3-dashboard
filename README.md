# s3-dashboard

A web-based AWS S3 management dashboard with role-based access control,
multi-region support, and an audit trail. Express + TypeScript backend,
Next.js frontend, SQLite for users/groups/audit.

## What it does

- Browse, upload (single + multipart), download, copy, move, rename, and delete
  S3 objects across any region.
- Per-user / per-group bucket assignments. Admins see everything; non-admins
  only see buckets explicitly granted to them.
- Aggregate metrics per bucket and across the org: storage size, object count,
  storage class breakdown, top file extensions.
- Full audit log of user actions (login, file ops, admin changes), preserved
  even after a user is deleted.

## Architecture

```
                +---------+
   browser ---> |  nginx  |  /api, /auth -> backend
                |   80    |  everything else -> frontend
                +----+----+
                     |
        +------------+------------+
        |                         |
   +----v-----+             +-----v------+
   | frontend |             |  backend   |
   |  Next.js |             |  Express   |---> AWS S3 (multi-region clients)
   |   3000   |             |   4000     |
   +----------+             +-----+------+
                                  |
                              SQLite (WAL)
                              /app/data
```

- **Backend** (`backend/`): Express, JWT auth, bcrypt, helmet, express-rate-limit,
  zod validation, pino structured logging, AWS SDK v3, better-sqlite3 in WAL mode.
- **Frontend** (`frontend/`): Next.js 13 (pages router), React 18, axios, SWR.
- **Reverse proxy** (`deploy/nginx.conf`): unifies the two services on port 80
  and forwards X-Forwarded-* headers so `req.ip` is meaningful.

## Permission model

Three layers, evaluated in order:

1. **JWT auth** — every API call must present a valid bearer token.
2. **Role** — users with `role = 'admin'` bypass all permission checks.
3. **Group permissions and bucket assignments** — non-admins are constrained by
   - `permissions` rows on their groups, granting `read`, `write`, or
     `read-write` on a `resource` (e.g., `file`, `folder`, or `bucket:my-bucket`);
   - `group_buckets` and `user_buckets` rows that explicitly list which
     S3 buckets they can see and operate on.

If any bucket assignments exist anywhere in the system, users without an
assignment see no buckets. If zero assignments exist, the behavior depends on
`NODE_ENV`:

- `production` — default-deny. Non-admins see nothing until granted.
- `development` — permissive. Lets a fresh install be useful out of the box.

## Running locally (without Docker)

Prereqs: Node 20+, npm, and AWS credentials in your environment (or
`~/.aws/credentials`).

```bash
# 1. Backend
cd backend
cp .env.example .env
# edit .env: at minimum set JWT_SECRET (32+ chars) and SUPER_ADMIN_*
npm install
npm run dev          # http://localhost:4000

# 2. Frontend (in a second shell)
cd frontend
cp .env.example .env.local
# edit: NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
npm install
npm run dev          # http://localhost:3000
```

Sign in with the super admin credentials from your backend `.env`.

## Running with Docker Compose

```bash
cp .env.example .env
# edit .env: JWT_SECRET, SUPER_ADMIN_*, AWS_* and CORS_ALLOWLIST
docker compose up -d --build
# visit http://localhost
```

Persistent data lives in the `backend-data` volume. Snapshot it periodically
with `backend/scripts/backup-db.sh` (run from the backend container or copy
`/app/data/database.sqlite` out of the volume).

## Configuration

Backend env vars are documented in [`backend/.env.example`](backend/.env.example).
Top-level Compose vars are documented in [`.env.example`](.env.example).
Frontend public vars are in [`frontend/.env.example`](frontend/.env.example).

Highlights:

- **`JWT_SECRET`** — required. The backend refuses to start in production if
  this is unset or set to the legacy `change-me`.
- **`CORS_ALLOWLIST`** — required in production. Comma-separated origin list.
- **`PUBLIC_SIGNUP_ENABLED`** — defaults to `false`. Admins can still create
  users via the admin UI.
- **`SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD`** — bootstraps the first
  admin on a clean DB. Remove or rotate after initial setup.

## Operational notes

- **SQLite mode** — single-process. WAL is on, busy timeout is 5s, foreign
  keys are enforced. To scale horizontally, migrate to Postgres (the data
  layer is small).
- **Backups** — `bash backend/scripts/backup-db.sh [destination]`. Keeps the
  most recent 14 backups by default (override with `KEEP=N`). Wire up to cron
  or a docker sidecar.
- **Multipart uploads** — progress is persisted in SQLite. Stale sessions
  (status `completed`, `aborted`, or `error` and older than 24h) are
  reaped every 30 minutes.
- **Health probes** — `/api/health` is shallow (DB ping). `/api/ready` also
  exercises S3 ListBuckets and is meant for orchestrators.
- **Logs** — pino JSON to stdout. Sensitive fields (passwords, Authorization
  headers) are redacted automatically.

## Security checklist for production

- [ ] Run behind HTTPS (Caddy / Cloudflare / nginx-with-certs in front).
- [ ] Set `NODE_ENV=production` so default-deny behaviors kick in.
- [ ] Set a strong `JWT_SECRET` (32+ random bytes). Rotate periodically.
- [ ] Set a tight `CORS_ALLOWLIST`.
- [ ] Use IAM roles for S3 access in production (not long-lived access keys).
- [ ] Schedule `backup-db.sh` and ship backups off-host.
- [ ] Monitor `/api/health` and `/api/ready` from your orchestrator.

## Project layout

```
backend/                Express API
  src/
    config.ts           env validation, fail-fast
    logger.ts           pino + pino-http
    errors.ts           AppError, asyncHandler, errorHandler
    validate.ts         zod request validation
    db.ts               SQLite schema, helpers, WAL tuning
    s3.ts               AWS SDK v3 wrappers + region cache
    auth.ts             /auth routes (login, logout, change-password, me)
    users.ts            /api/users (admin)
    groups.ts           /api/groups (admin)
    audit.ts            /api/audit (admin)
    metrics.ts          /api/metrics
    middleware/         authMiddleware, permissionMiddleware
    uploadSessions.ts   persisted multipart upload state
    loginLockout.ts     per-user/IP failure tracking
    passwordPolicy.ts   shared policy for new passwords
    index.ts            entry point: routes, lifecycle, shutdown
  scripts/
    backup-db.sh

frontend/               Next.js (pages router)
  pages/                login, change-password, users, groups, audit, ...
  lib/                  api wrappers, auth helpers
  styles/

deploy/
  nginx.conf            reverse proxy used by docker-compose

docker-compose.yml      backend + frontend + nginx
```
