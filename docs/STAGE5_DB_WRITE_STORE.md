# Stage 5.4 DB Write Store

Stage 5.4 adds a PostgreSQL write path for the business APIs created in Stage 4. The default runtime remains JSON unless the DB store flag is enabled.

## Default Behavior

By default, all write APIs still use `.local-data/meeting-loop-state.json`.

DB read/write mode is enabled only when one of these flags is set:

```powershell
$env:MEETING_STATE_STORE='db'
# or
$env:MEETING_USE_DB_STATE='true'
```

The DB mode also requires:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'
# or
$env:POSTGRES_URL='postgres://user:pass@localhost:5432/meeting_loop'
```

## Added / Changed Files

- `lib/db.ts`
  - Adds `withDbTransaction`.

- `lib/dbStateStore.ts`
  - Exports `readDbState`.
  - Keeps formal approved tasks in top-level `tasks`.
  - Keeps only pending/rejected pre-approval tasks under `meeting.tasks`.

- `lib/dbWriteStore.ts`
  - Adds DB transaction handlers for task, meeting, and notification-read writes.
  - Reuses existing Stage 4 business action functions for authorization and state transitions.
  - Persists only the affected meeting/task/log/read records, not the whole application state.

## APIs Switched Behind the DB Flag

- `PATCH /api/tasks/[taskId]/completion`
- `PATCH /api/tasks/[taskId]/status`
- `PATCH /api/tasks/[taskId]/review`
- `PATCH /api/tasks/[taskId]/approval`
- `PATCH /api/tasks/[taskId]/support`
- `POST /api/meetings/approval-submissions`
- `PATCH /api/meetings/[meetingId]/approval`
- `GET /api/notifications/read`
- `PUT /api/notifications/read`

## Transaction Scope

DB writes use short transactions:

- read current DB state
- run the existing business action
- upsert the affected task or meeting records
- insert activity logs and derived approval/review logs
- commit

No external calls or browser operations are inside the transaction.

## Verification Completed

- `corepack pnpm build` passed.
- Default environment has no DB flag and no DB connection string.
- Default JSON path still works:
  - `GET /api/state` with president cookie returned HTTP 200.
  - Counts: departments 200, users 1033, meetings 1, tasks 2, activityLogs 17.
  - `GET /api/notifications/read` with president cookie returned HTTP 200 and `{"readIds":[]}`.
- `corepack pnpm db:export` still passes after the write-store change.

## Not Verified Yet

Real DB write mode was not executed because this machine still has no PostgreSQL connection string configured.

Full DB-mode verification requires:

1. Import the latest export package into a PostgreSQL test database.
2. Run `corepack pnpm db:verify`.
3. Start the app with `MEETING_STATE_STORE=db`.
4. Exercise task completion, review, approval, support, meeting approval, and notification-read flows.
5. Re-run `corepack pnpm db:verify -- --allow-extra` or targeted DB count/status checks.

## Next Stage

Stage 5.5 should handle cutover and rollback:

- create a final JSON backup,
- import/verify DB,
- enable DB mode as the primary runtime,
- restart and smoke test,
- document rollback to JSON mode or re-import from JSON backup.
