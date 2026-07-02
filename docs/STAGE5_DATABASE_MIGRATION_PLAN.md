# Stage 5.1 Database Migration Plan

## Goal

Move the meeting loop app from a single local JSON runtime file to a database-backed runtime before wider multi-user trial use.

Current runtime state:

- Source file: `.local-data/meeting-loop-state.json`
- Current counts on 2026-06-26:
  - departments: 200
  - users: 1033
  - meetings: 1
  - tasks: 2
  - activityLogs: 17
  - notificationReadIdsByUser: 1 user bucket

Stage 5.1 only defines the database architecture and first schema. It does not switch the running app from JSON to DB.

## Decision Summary

Use PostgreSQL as the target production database.

Reasons:

- The workflow is relational: users, departments, meetings, decisions, tasks, approvals, reviews, logs, and reads.
- The app needs transaction-safe updates when several users work at the same time.
- Dashboard queries need joins, filters, grouping, and indexes.
- JSONB can preserve AI/source payloads without blocking later normalization.

SQLite can still be used as a local developer fallback later, but it is not the target database for real multi-user trial.

## Migration Slices

### 5.1 Schema and Mapping

Deliverables:

- `database/migrations/001_postgres_initial_schema.sql`
- `docs/STAGE5_DATABASE_MIGRATION_PLAN.md`
- `docs/adr/0001-use-postgresql-for-meeting-loop.md`

Acceptance:

- The schema covers all fields currently used by `lib/types.ts` and `.local-data/meeting-loop-state.json`.
- Current string IDs are preserved as primary keys.
- Common query paths have indexes.
- No runtime API is switched yet.

### 5.2 JSON Export and Import Scripts

Deliverables:

- `scripts/export-local-state.mjs`
- `scripts/import-local-state-to-db.mjs`
- `scripts/verify-db-import.mjs`

Acceptance:

- Imports all departments, users, meetings, meeting participants, decisions, tasks, task progress entries, activity logs, and notification reads.
- Counts match current JSON.
- Key status fields match after import.
- Script can run repeatedly against a clean database.

### 5.3 Read Store

Deliverables:

- `lib/db.ts`
- `lib/dbStateStore.ts`
- optional repository files under `lib/repositories/`

Acceptance:

- `/api/state` can read from DB behind a feature flag.
- Existing visibility filtering can still be applied.
- JSON remains the default until DB read verification passes.

### 5.4 Write Store

Deliverables:

- Convert stage 4 write APIs to database transactions.

APIs to switch:

- `PATCH /api/tasks/[taskId]/completion`
- `PATCH /api/tasks/[taskId]/status`
- `PATCH /api/tasks/[taskId]/review`
- `PATCH /api/tasks/[taskId]/approval`
- `PATCH /api/tasks/[taskId]/support`
- `POST /api/meetings/approval-submissions`
- `PATCH /api/meetings/[meetingId]/approval`
- `GET/PUT /api/notifications/read`

Acceptance:

- Two accounts can update separate records without full-state overwrite.
- Every write records actor information where applicable.
- Writes that touch multiple tables use transactions.

### 5.5 Cutover and Rollback

Acceptance:

- JSON file is retained as a migration backup.
- DB becomes the primary runtime store.
- A rollback path can restore DB from the last JSON backup or re-enable JSON store.
- Browser and API smoke checks pass after service restart.

## JSON to Table Mapping

| JSON area | Database tables |
|---|---|
| `departments[]` | `departments` |
| `users[]` | `users` |
| `meetings[]` | `meetings`, `meeting_participants`, `meeting_minutes`, `meeting_decisions`, `meeting_files` |
| `meetings[].tasks[]` | `tasks` with `approval_status = pending_president_approval` |
| `tasks[]` | `tasks`, `task_progress_entries` |
| `activityLogs[]` | `activity_logs` |
| `notificationReadIdsByUser` | `notification_reads` |

## Important Modeling Choices

### Preserve Current IDs

The app already uses string IDs such as `emp-cp25040`, `org-29`, `m-...`, and `ai-task-...`.

Stage 5 should keep these IDs as `text primary key` to avoid a risky ID remapping layer.

### Keep Source Payloads Where Useful

Some fields are still evolving:

- AI source trace
- source batch metadata
- source file metadata
- decisions from AI
- task completion history

The first schema normalizes important queryable fields and allows `jsonb` metadata for evolving source payloads.

### Separate Business Data from Personal State

Shared business data:

- meetings
- decisions
- tasks
- progress entries
- approval/review logs
- activity logs

Personal state:

- notification reads
- user preferences

This keeps one user's read state from affecting another user's workflow.

## Query Paths to Optimize

Initial indexes should cover:

- meetings by `department_id`, `host_id`, `start_time`, `approval_status`, `status`
- meeting participants by `user_id`
- tasks by `meeting_id`, `owner_id`, `reviewer_id`, `department_id`, `status`, `approval_status`, `due_date`
- activity logs by `meeting_id`, `task_id`, `actor_id`, `created_at`
- notification reads by `(user_id, notification_id)`

## Risks

| Risk | Mitigation |
|---|---|
| Current JSON time strings have no timezone | Import script should parse them as Asia/Shanghai and store `timestamptz` |
| Some historical records may miss newer fields | Import script must default missing optional fields rather than fail |
| Existing frontend still expects full state shape | DB read store should return the current `StateApiResponse` shape during transition |
| Concurrent writes may produce inconsistent logs | Use DB transactions in write APIs |
| ID collisions from generated IDs | Keep existing IDs and add unique constraints; later ID generator can use UUID or prefixed IDs |

## Stage 5.1 Completion Criteria

- Schema draft exists.
- ADR exists.
- Mapping and migration sequence are documented.
- No app runtime behavior changes.
- Existing local page still loads.
