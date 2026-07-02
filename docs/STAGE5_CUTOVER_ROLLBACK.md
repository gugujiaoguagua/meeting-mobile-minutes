# Stage 5.5 Cutover and Rollback

Stage 5.5 defines the operational path for moving the meeting loop app from JSON runtime storage to PostgreSQL runtime storage.

## Current Status

The code supports DB read/write behind a runtime flag, but this machine does not currently have `DATABASE_URL` or `POSTGRES_URL` configured. Therefore, the DB cutover cannot be executed locally yet.

The safe default remains:

```powershell
$env:MEETING_STATE_STORE='json'
```

## Local Run on 2026-06-26

Completed locally:

- Final JSON backup:
  - `.local-data/backups/meeting-loop-state-cutover-backup-20260626-162629.json`
- Latest export package:
  - `.local-data/exports/meeting-loop-state-export-20260626-162629.json`
- `corepack pnpm build` passed.
- Default JSON runtime smoke test passed:
  - `GET /api/state` with `meeting_user_id=emp-zc25003` returned HTTP 200.
  - Counts: departments 200, users 1033, meetings 1, tasks 2, activityLogs 17.

Blocked locally:

- `corepack pnpm db:cutover:check` stopped because `DATABASE_URL` / `POSTGRES_URL` is not configured.
- DB import, DB verify, DB runtime restart, and DB-mode browser smoke are not executed yet.

or no DB runtime flag at all.

## Cutover Steps

### 1. Create Final JSON Backup

```powershell
corepack pnpm db:backup
```

This copies `.local-data/meeting-loop-state.json` to:

```text
.local-data/backups/meeting-loop-state-cutover-backup-<timestamp>.json
```

### 2. Export Current JSON State

```powershell
corepack pnpm db:export
```

This creates:

```text
.local-data/exports/meeting-loop-state-export-<timestamp>.json
```

### 3. Import Into PostgreSQL

Use a disposable test database first:

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'
corepack pnpm db:import -- --export .local-data/exports/<export-file>.json --truncate
```

Use `--truncate` only for a database that is known to be disposable.

### 4. Verify DB Counts and Statuses

```powershell
corepack pnpm db:verify -- --export .local-data/exports/<export-file>.json
corepack pnpm db:cutover:check -- --export .local-data/exports/<export-file>.json
```

Both commands must pass before runtime cutover.

### 5. Enable DB Runtime

```powershell
$env:MEETING_STATE_STORE='db'
$env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'
corepack pnpm build
corepack pnpm start
```

For server deployment, put the DB variables into the production environment file and restart the service.

### 6. Smoke Test After Restart

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/state' -Headers @{Cookie='meeting_user_id=emp-zc25003'} -UseBasicParsing
Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/notifications/read' -Headers @{Cookie='meeting_user_id=emp-zc25003'} -UseBasicParsing
```

Expected baseline after current import:

- departments: 200
- users: 1033
- meetings: 1
- tasks: 2
- activityLogs: 17

Then use the browser to check:

- current identity remains logged in,
- dashboard loads,
- meeting detail opens,
- my tasks loads,
- notification read state remains user-scoped.

## Rollback Path

### Fast Runtime Rollback

Disable DB runtime and restart:

```powershell
$env:MEETING_STATE_STORE='json'
Remove-Item Env:\MEETING_USE_DB_STATE -ErrorAction SilentlyContinue
corepack pnpm start
```

On the server, set:

```text
MEETING_STATE_STORE=json
```

Then restart the container/service.

### Restore JSON From Cutover Backup

If the local JSON runtime file was changed and needs to be restored:

```powershell
Copy-Item -LiteralPath '.local-data/backups/<backup-file>.json' -Destination '.local-data/meeting-loop-state.json' -Force
```

### Rebuild DB From JSON Backup

If DB data needs to be rebuilt from the backup:

```powershell
corepack pnpm db:export -- --state .local-data/backups/<backup-file>.json --out .local-data/exports/recovery-export.json
corepack pnpm db:import -- --export .local-data/exports/recovery-export.json --truncate
corepack pnpm db:verify -- --export .local-data/exports/recovery-export.json
```

## Production Notes

- Use a pooled PostgreSQL connection string where available.
- Do not use a PostgreSQL superuser as the app connection user.
- Keep `.local-data/backups` and `.local-data/exports` out of public web access.
- Do not delete `.local-data` during deployment updates until DB cutover has passed and rollback retention is agreed.
