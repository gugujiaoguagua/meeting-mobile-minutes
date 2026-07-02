# Stage 5.2 Migration Scripts

This note records how to export the current local JSON state, import it into PostgreSQL, and verify row counts/statuses after import.

## Scripts

- `corepack pnpm db:export`
  - Reads `.local-data/meeting-loop-state.json`.
  - Writes `.local-data/exports/meeting-loop-state-export-<timestamp>.json`.
  - Normalizes current camelCase JSON into database-shaped table arrays.
  - Preserves existing string IDs.
  - Nulls unknown optional foreign keys and records warnings in the export package.

- `corepack pnpm db:import -- --export .local-data/exports/<file>.json`
  - Requires `DATABASE_URL` or `POSTGRES_URL`.
  - Applies `database/migrations/001_postgres_initial_schema.sql` by default.
  - Upserts exported rows table by table.
  - Use `--skip-schema` when the target schema is already managed elsewhere.
  - Use `--truncate` only when the target database is a disposable test database.

- `corepack pnpm db:verify -- --export .local-data/exports/<file>.json`
  - Requires `DATABASE_URL` or `POSTGRES_URL`.
  - Compares exported counts with database counts.
  - Verifies meeting and task `status` / `approval_status` by ID.
  - Use `--allow-extra` when verifying against a database that intentionally contains rows beyond the export package.

## Example

```powershell
$env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'
corepack pnpm db:export
corepack pnpm db:import -- --export .local-data/exports/meeting-loop-state-export-20260626-135939.json --truncate
corepack pnpm db:verify -- --export .local-data/exports/meeting-loop-state-export-20260626-135939.json
```

## Current Export Baseline

Generated on 2026-06-26:

- Export file: `.local-data/exports/meeting-loop-state-export-20260626-135939.json`
- Departments: 200
- Users: 1033
- Meetings: 1
- Meeting participants: 3
- Meeting files: 1
- Meeting minutes: 1
- Meeting decisions: 1
- Tasks: 2
- Task progress entries: 4
- Task approval logs: 3
- Task review logs: 8
- Notifications: 0
- Notification reads: 0
- Activity logs: 17
- User preferences: 0
- Export warnings: 0

## Current Limitation

This machine does not currently have `DATABASE_URL` or `POSTGRES_URL` configured, so the DB import and DB verify commands were not executed in this phase. The scripts are ready for the next run once a PostgreSQL connection string is provided.
