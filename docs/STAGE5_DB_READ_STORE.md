# Stage 5.3 DB Read Store

Stage 5.3 adds a database-backed read path for `/api/state` without changing the default runtime store.

## Default Behavior

By default, `/api/state` still reads from `.local-data/meeting-loop-state.json`.

DB reads are enabled only when one of these flags is set:

```powershell
$env:MEETING_STATE_STORE='db'
# or
$env:MEETING_USE_DB_STATE='true'
```

The DB read path also requires:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'
# or
$env:POSTGRES_URL='postgres://user:pass@localhost:5432/meeting_loop'
```

## Added Files

- `lib/db.ts`
  - Provides PostgreSQL connection pooling.
  - Reads `DATABASE_URL` or `POSTGRES_URL`.
  - Provides the DB read feature flag.

- `lib/dbStateStore.ts`
  - Reads normalized PostgreSQL tables.
  - Maps snake_case DB rows back to the current frontend state shape.
  - Rebuilds meeting participants, meeting decisions, nested meeting tasks, task progress history, activity logs, and notification read buckets.
  - Applies the existing identity visibility filter.

## API Behavior

`GET /api/state` now chooses the read store:

- DB flag off: read JSON through `readVisibleLocalState`.
- DB flag on: read PostgreSQL through `readVisibleDbState`.

`PUT /api/state` and `DELETE /api/state` are intentionally unchanged in Stage 5.3. They still write/reset the local JSON store. Stage 5.4 will move the business write APIs to DB transactions.

## Verification Completed

- `corepack pnpm build` passed.
- Default environment has no DB read flag and no DB connection string.
- Default `GET /api/state` smoke test passed on `http://127.0.0.1:3000/api/state` with president cookie:
  - departments: 200
  - users: 1033
  - meetings: 1
  - tasks: 2
  - activityLogs: 17
- `corepack pnpm db:export` still passes after the read-store change.

## Not Verified Yet

Real DB read mode was not executed because this machine still has no PostgreSQL connection string configured. After importing the latest export package into a test database, run:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'
$env:MEETING_STATE_STORE='db'
corepack pnpm build
```

Then smoke test:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/state' -Headers @{Cookie='meeting_user_id=emp-zc25003'} -UseBasicParsing
```
