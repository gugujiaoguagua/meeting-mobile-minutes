# Object Storage Architecture Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all fast-growing meeting-system content out of Tencent Cloud local disk and large PostgreSQL fields into OSS, while keeping PostgreSQL as the business index, permission source, and workflow state store.

**Architecture:** Use PostgreSQL for accounts, ownership, permissions, status, search previews, counters, and object indexes. Use OSS for full body content, documents, exports, recordings, AI payloads, OKR snapshots, and future large message bodies. Add an object ACL layer so data is shared by business relationship instead of duplicated per user folder.

**Tech Stack:** Next.js App Router, Node.js runtime, PostgreSQL, Aliyun OSS REST adapter, existing Docker/Tencent Cloud deployment, current `MEETING_STATE_STORE=db`.

---

## Current Finding

Current storage is not one physical folder per user. It is a shared business database with user fields:

- `meetings.created_by`, `meetings.host_id`
- `tasks.owner_id`, `tasks.reviewer_id`, `tasks.meeting_id`
- `okr_projects.owner_id`
- `okr_krs.owner_id`, `okr_krs.reviewer_id`
- `okr_pdca_tasks.owner_id`, `okr_pdca_tasks.reviewer_id`
- `notification_reads.user_id`
- `storage_objects.owner_type`, `storage_objects.owner_id`, `storage_objects.created_by`

This is the correct base model for collaboration, but it is missing a formal object permission table and lifecycle policy.

## Target Design

Do not store one copy per user. Store one object per business item, then authorize users through ACL rows.

OSS path standard:

```text
meeting-loop/prod/
  meetings/{meetingId}/
    raw-transcript.txt
    transcript.txt
    minute.md
    exports/
    uploads/
    recordings/
  okr/projects/{okrProjectId}/
    project.json
    imports/
    exports/
  tasks/{taskId}/
    completion.json
    attachments/
  notifications/{notificationId}/
    body.json
  ai-drafts/{jobId}/
    request.json
    result.json
```

PostgreSQL remains source of truth for:

```text
users, departments, accounts, roles,
meetings index fields, tasks index fields, OKR index fields,
status, approvals, read state, WeCom outbox,
storage_objects, storage_object_acl
```

OSS stores:

```text
full text, large JSON, uploaded files, generated exports,
recordings, AI request/result payloads, long notification bodies,
future imported source documents
```

---

## Phase 1: Object ACL Foundation

**Files:**
- Create: `database/migrations/015_storage_object_acl.sql`
- Create: `lib/storageObjectAcl.ts`
- Modify: `lib/storageObjectDb.ts`
- Modify: `lib/types.ts`

**Schema:**

```sql
create table if not exists storage_object_acl (
  id text primary key,
  object_id text not null references storage_objects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'creator', 'participant', 'assignee', 'reviewer', 'approver', 'viewer')),
  source_type text not null,
  source_id text not null,
  created_at timestamptz not null default now(),
  unique(object_id, user_id, role)
);

create index if not exists storage_object_acl_user_idx on storage_object_acl (user_id, source_type, source_id);
create index if not exists storage_object_acl_object_idx on storage_object_acl (object_id);
```

**Rules:**

- One OSS object can be visible to many users.
- Never duplicate object bodies only to give multiple users access.
- ACL rows are derived from the business entity:
  - Meeting: creator, host, participants, task owners, reviewers, president approver.
  - OKR: project owner, KR owners/reviewers, PDCA owners/reviewers, president approver.
  - Task: owner, reviewer, meeting creator/host.
  - Notification: explicit recipient only.

**Verification:**

```powershell
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
```

Expected:

```text
TypeScript passes
Build passes
```

---

## Phase 2: Meeting Content Full Migration Model

**Files:**
- Modify: `lib/meetingLargeContent.ts`
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/dbStateStore.ts`
- Create: `scripts/backfill-meeting-storage-acl.mjs`

**Change:**

Current meeting full text externalization is already started. Standardize keys to:

```text
meetings/{meetingId}/raw-transcript.txt
meetings/{meetingId}/transcript.txt
meetings/{meetingId}/minute.md
```

Keep DB previews only:

```text
meetings.raw_transcript
meetings.transcript
meetings.minute_markdown
```

**ACL:**

When writing meeting objects, create ACL rows for:

- `meeting.createdBy`
- `meeting.hostId`
- all `participantIds`
- all formal task owners/reviewers
- president if pending/approved by president flow

**Verification:**

1. Create a new meeting.
2. Generate meeting minutes.
3. Confirm OSS object rows exist.
4. Confirm ACL rows exist for creator, host, participants, task owner, reviewer.
5. Confirm only visible users can access/download via future download endpoint.

---

## Phase 3: OKR Content Storage Completion

**Files:**
- Modify: `lib/okrObjectStorage.ts`
- Modify: `lib/okrDbStore.ts`
- Create: `scripts/backfill-okr-storage-acl.mjs`

**Change:**

Current OKR project JSON externalization is already started. Keep one canonical object per OKR project:

```text
okr/projects/{okrProjectId}/project.json
```

**DB remains index only for:**

- project name
- owner
- department
- status
- progress
- dates
- risk
- object id/key

**ACL:**

For each OKR object, grant access to:

- project owner
- KR owners
- KR reviewers
- PDCA owners
- PDCA reviewers
- president/approvers

**Verification:**

1. Create OKR project.
2. Confirm `storage_objects.owner_type=okr_project`.
3. Confirm `okr_projects.project_object_key` is set.
4. Confirm `storage_object_acl` has all related users.
5. Modify a PDCA end date and confirm OSS `project.json` refreshes.

---

## Phase 4: Notifications And Messages

**Files:**
- Create: `database/migrations/016_notifications.sql`
- Create: `lib/notificationStore.ts`
- Modify: `app/page.tsx` notification loading flow only if needed
- Modify: `app/api/notifications/read/route.ts`
- Modify: WeCom notification helpers as needed

**Target tables:**

```sql
create table if not exists notifications (
  id text primary key,
  event_type text not null,
  source_type text not null,
  source_id text not null,
  title text not null,
  preview text not null default '',
  body_object_id text references storage_objects(id) on delete set null,
  actor_id text references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists notification_recipients (
  id text primary key,
  notification_id text not null references notifications(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(notification_id, user_id)
);
```

**Storage rule:**

- Short message title/preview stays in DB.
- Long body/details go to:

```text
notifications/{notificationId}/body.json
```

**Why:**

One notification sent to 20 people is one body object plus 20 recipient rows, not 20 duplicated message bodies.

**Verification:**

1. Trigger task review notification.
2. Confirm one notification row.
3. Confirm one or more recipient rows.
4. Confirm per-user read state works.
5. Confirm no cross-user message leakage.

---

## Phase 5: Attachments, Imports, Exports, Recordings

**Files:**
- Modify: `app/api/meeting-file-text/route.ts`
- Create: `app/api/storage-objects/[objectId]/download/route.ts`
- Modify: `app/api/mobile/recordings/route.ts` only if recording remains active
- Modify: `lib/tencentAsr.ts` only if recording remains active

**Storage paths:**

```text
meetings/{meetingId}/uploads/{fileId}-{name}
meetings/{meetingId}/exports/{exportId}.docx
meetings/{meetingId}/recordings/{recordingId}.webm
okr/projects/{okrProjectId}/imports/{fileId}-{name}
okr/projects/{okrProjectId}/exports/{exportId}.xlsx
tasks/{taskId}/attachments/{fileId}-{name}
```

**Rules:**

- Extracted text preview can stay in DB.
- Original uploaded file goes to OSS.
- Generated exports go to OSS.
- Recording files go to OSS only if mobile recording remains a product feature.
- Local server disk may be used as temporary processing cache only, then deleted.

**Verification:**

1. Upload DOCX/TXT.
2. Confirm extraction still works.
3. Confirm original file object exists in OSS.
4. Confirm ACL rows exist.
5. Confirm authorized download works and unauthorized download returns 403.

---

## Phase 6: Lifecycle, Quota, And Admin Visibility

**Files:**
- Create: `lib/storageStats.ts`
- Create: `app/api/storage/stats/route.ts`
- Modify: admin dashboard page
- Optional: `scripts/storage-lifecycle-report.mjs`

**Admin stats:**

Show:

- total object count
- total size
- object count by category
- size by category
- monthly growth
- largest meetings
- largest recordings
- objects without ACL
- objects missing DB owner

**Lifecycle recommendation:**

```text
0-90 days: OSS standard storage
90-365 days: OSS infrequent access for recordings/exports
365+ days: archive old recordings/exports if not in active workflow
```

Do not archive:

- active OKR project JSON
- active meeting minute markdown
- current task/notification bodies

**Verification:**

1. `/api/storage/stats` returns counts without secrets.
2. Admin page displays category sizes.
3. Objects without ACL are visible as warnings.

---

## Migration Order

1. Add `storage_object_acl`.
2. Backfill ACL for current `storage_objects`.
3. Standardize future meeting object paths.
4. Confirm OKR object path and ACL.
5. Add notification tables and recipient model.
6. Move upload/import/export originals to OSS.
7. Decide whether mobile recordings stay; if yes, move recordings to OSS.
8. Add storage stats dashboard.
9. Add historical migration scripts with dry-run defaults.
10. Add lifecycle report and manual archive workflow.

---

## Acceptance Criteria

- New meeting full text is not stored only in PostgreSQL.
- New OKR full project JSON is in OSS.
- New large AI payloads are in OSS.
- Uploaded/imported original files are in OSS.
- Notification long bodies are in OSS or DB preview-only for short messages.
- Every OSS object has a `storage_objects` row.
- Every user-visible OSS object has ACL rows.
- User A cannot retrieve User B-only object through API.
- Shared meeting/OKR stores one object, not one duplicated object per user.
- `/api/health` shows object storage configured.
- Storage stats page can show category growth.

---

## Rollback

If OSS write path fails:

1. Set:

```env
MEETING_OBJECT_STORAGE=disabled
```

2. Restart app.
3. New writes return to DB-compatible fallback where supported.
4. Existing OSS-backed objects remain readable after config is restored.

If ACL logic blocks legitimate access:

- Keep object rows.
- Temporarily allow access by existing business permission functions.
- Regenerate ACL rows from meetings/OKR/tasks with backfill scripts.

If migration script fails:

- Scripts must be dry-run by default.
- Never delete DB inline content in the first migration pass.
- Retry failed rows after fixing config.
