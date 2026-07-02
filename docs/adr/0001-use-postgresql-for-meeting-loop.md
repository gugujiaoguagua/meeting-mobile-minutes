# ADR-0001: Use PostgreSQL for Meeting Loop Runtime Storage

## Status

Proposed

## Context

The current meeting loop app stores runtime data in `.local-data/meeting-loop-state.json`.

That was enough for local demo and early workflow validation, but it is not suitable for multi-user trial because:

- Multiple users can update shared business data.
- Tasks, approvals, reviews, notifications, and logs need transaction safety.
- Dashboard pages need filtered and grouped queries.
- Personal state, such as notification reads, must stay separated by account.
- JSON full-state writes are risky when different accounts operate at the same time.

The app has already completed the stage 4 write-interface split, so most business changes now happen through focused API routes instead of one global PUT.

## Decision

Use PostgreSQL as the target database for stage 5.

The first schema preserves current string IDs as primary keys and uses normalized relational tables for core business data, with JSONB only for evolving metadata that does not need first-class querying yet.

## Consequences

### Positive

- Strong consistency for multi-table business writes.
- Good fit for users, departments, meetings, tasks, approvals, reviews, and logs.
- Better dashboard query support through joins and indexes.
- JSONB support allows gradual migration of AI/source metadata.
- Easier future integration with managed Postgres services.

### Negative

- More operational complexity than a single JSON file.
- Requires migration scripts and DB setup.
- Requires careful transaction handling in write APIs.

### Neutral

- SQLite can still be used as a local developer fallback later, but it is not the production target.
- The JSON file should remain as a migration backup until DB cutover is proven.

## Alternatives Considered

### Keep JSON as Primary Store

Rejected for wider trial because full-file writes can overwrite concurrent updates and make permission-safe multi-user operation harder.

### SQLite as Primary Store

Considered for local simplicity. Rejected as the main target because the app is moving toward multi-user server operation where PostgreSQL is a better long-term fit.

### Document Database

Rejected because core data is relational and needs joins, constraints, and transactional updates.

## References

- `docs/STAGE5_DATABASE_MIGRATION_PLAN.md`
- `database/migrations/001_postgres_initial_schema.sql`
- `AI 工作流资产/04_流程编排/13_个人账号登录与账号级存储改造计划.md`
