# Meeting Object Storage Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move meeting-system backend large data from local server disk and large PostgreSQL text fields into the existing Aliyun OSS path, while keeping PostgreSQL as the business index and preserving current user-facing behavior.

**Architecture:** Keep PostgreSQL for structured business state, permissions, search keys, workflow status, and object indexes. Store large texts and files in the existing OSS bucket `your-oss-bucket` under the already-authorized prefix `meeting-loop/prod/`, so no new Bucket, RAM user, or permission approval is required. Add a storage adapter with a strict prefix guard, then migrate backend-generated large content in phases; mobile recording storage remains optional and later because the user said it may not be a core future feature.

**Tech Stack:** Next.js App Router, Node.js runtime, PostgreSQL, Aliyun OSS Node SDK, existing Docker/Tencent Cloud deployment, existing `MEETING_STATE_STORE=db` production mode.

---

## Fixed Decisions

- Use existing Bucket: `your-oss-bucket`.
- Use existing RAM user: `kb-oss-uploader@1783533724181094.onaliyun.com`.
- Do not request new permissions now.
- Store meeting-system objects under the already-authorized prefix:

```text
meeting-loop/prod/
```

- Planned OSS object layout:

```text
meeting-loop/prod/
  meetings/
    raw-transcripts/
    transcripts/
    minutes/
    ai-drafts/
    exports/
  files/
    attachments/
    imports/
  recordings/
  backups/
  logs/
```

- PostgreSQL remains the source of truth for:

```text
users, departments, accounts, roles, meetings index fields, tasks, OKR,
approval status, WeCom outbox, notification reads, object metadata, previews
```

- OSS stores:

```text
full raw transcript, full transcript, minute markdown,
AI draft request/result JSON if large, generated export files, imported attachments,
future recording files if recording remains in use
```

---

## Non-Goals

- Do not migrate all database rows to OSS.
- Do not remove existing columns in the first release.
- Do not migrate mobile recording first.
- Do not make OSS objects public.
- Do not expose AccessKey Secret to the frontend.
- Do not request a new RAM policy or Bucket in this phase.
- Do not use the knowledge-base Feishu package flow; only reuse the object-storage idea.

---

## Environment Variables

Add these to `.env.production.example`, Docker compose environment passthrough, and Tencent server `.env`:

```env
MEETING_OBJECT_STORAGE=oss
MEETING_OSS_REGION=oss-cn-shanghai
MEETING_OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com
MEETING_OSS_BUCKET=your-oss-bucket
MEETING_OSS_PREFIX=meeting-loop/prod
MEETING_OSS_ACCESS_KEY_ID=
MEETING_OSS_ACCESS_KEY_SECRET=
MEETING_OSS_SIGNED_URL_TTL_SECONDS=7200
MEETING_OSS_REQUEST_TIMEOUT_MS=300000
MEETING_OSS_MULTIPART_THRESHOLD_BYTES=20971520
MEETING_OSS_MULTIPART_PART_SIZE_BYTES=8388608
```

Security rule: never print secrets in logs, asset records, or chat. Only record whether OSS is configured.

---

## Task 1: Add OSS Storage Adapter

**Files:**
- Create: `lib/objectStorage.ts`
- Modify: `.env.production.example`
- Modify: `docker-compose.yml`
- Test: `scripts/check-meeting-object-storage.mjs`

**Step 1: Add dependency**

Run:

```powershell
corepack pnpm add ali-oss
```

Expected: `package.json` and `pnpm-lock.yaml` update.

**Step 2: Create storage adapter**

Implement:

```ts
export type StoragePutInput = {
  key: string;
  body: string | Buffer;
  mimeType?: string;
  metadata?: Record<string, string>;
};

export type StorageObjectRef = {
  provider: "oss";
  bucket: string;
  region: string;
  endpoint: string;
  key: string;
  sizeBytes?: number;
  mimeType?: string;
};

export function isObjectStorageEnabled(): boolean;
export function meetingObjectKey(parts: string[]): string;
export async function putMeetingObject(input: StoragePutInput): Promise<StorageObjectRef>;
export async function getMeetingObjectText(key: string): Promise<string>;
export async function getMeetingObjectSignedUrl(key: string, ttlSeconds?: number): Promise<string>;
export async function deleteMeetingObject(key: string): Promise<void>;
```

Hard rule inside `meetingObjectKey()` and all public adapter functions:

```text
final key must start with MEETING_OSS_PREFIX + "/"
no "../"
no leading slash
no user-controlled raw path
```

**Step 3: Add adapter check script**

Create `scripts/check-meeting-object-storage.mjs`:

- Writes a small test object to:

```text
meeting-loop/prod/_health/<timestamp>.txt
```

- Reads it back.
- Generates a signed URL.
- Deletes it.
- Prints only bucket, prefix, and success status. Do not print secrets.

**Step 4: Verify**

Run:

```powershell
corepack pnpm exec tsc --noEmit --pretty false
node scripts/check-meeting-object-storage.mjs
```

Expected:

```text
TypeScript passes
ossConfigured=true
write=true
read=true
signedUrl=true
delete=true
```

Do not continue if this fails.

---

## Task 2: Add Storage Object Index Table

**Files:**
- Create: `database/migrations/012_storage_objects.sql`
- Modify: `lib/types.ts`
- Create: `lib/storageObjectDb.ts`

**Migration:**

Create table:

```sql
create table if not exists storage_objects (
  id text primary key,
  provider text not null check (provider in ('oss')),
  bucket text not null,
  region text not null,
  endpoint text not null,
  object_key text not null,
  owner_type text not null,
  owner_id text not null,
  category text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(provider, bucket, object_key)
);

create index if not exists storage_objects_owner_idx
  on storage_objects (owner_type, owner_id, category);

create index if not exists storage_objects_created_at_idx
  on storage_objects (created_at desc);
```

**DB helper functions:**

```ts
export async function createStorageObjectRecord(input: StorageObjectInput): Promise<StorageObjectRecord>;
export async function findStorageObject(id: string): Promise<StorageObjectRecord | undefined>;
export async function findStorageObjectsByOwner(ownerType: string, ownerId: string, category?: string): Promise<StorageObjectRecord[]>;
export async function softDeleteStorageObject(id: string): Promise<void>;
```

**Verify:**

Run:

```powershell
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
```

Expected: build passes.

---

## Task 3: Add Large Text Externalization Helpers

**Files:**
- Create: `lib/meetingLargeContent.ts`
- Modify: `lib/dbStateStore.ts`
- Modify: `lib/dbWriteStore.ts`

**Goal:** Make large text storage transparent to the current app. The UI and API should still receive `rawTranscript`, `transcript`, and `minuteMarkdown` as before.

**Rules:**

- If OSS is disabled, keep old behavior.
- If OSS is enabled, write full large text to OSS and store only preview plus object id/key in PostgreSQL.
- Reads must support both old DB inline text and new OSS-backed text.
- First release should be backward compatible; do not drop existing columns.

**Implementation shape:**

```ts
export async function saveLargeMeetingText(input: {
  meetingId: string;
  category: "raw_transcript" | "transcript" | "minute_markdown" | "ai_draft";
  text: string;
  createdBy?: string;
  mimeType?: string;
}): Promise<{ preview: string; objectId?: string; objectKey?: string }>;

export async function resolveLargeMeetingText(input: {
  inlineText?: string | null;
  objectId?: string | null;
  objectKey?: string | null;
}): Promise<string>;
```

Preview rule:

```text
first 1000-2000 characters stay in PostgreSQL for list/search preview.
full body goes to OSS.
```

**Verify:**

- Save a meeting with long transcript.
- Confirm full text is retrievable through `/api/state`.
- Confirm `storage_objects` has a row.
- Confirm OSS has an object under:

```text
meeting-loop/prod/meetings/raw-transcripts/
```

---

## Task 4: Add DB Columns For Object References

**Files:**
- Create: `database/migrations/013_meeting_large_content_refs.sql`
- Modify: `lib/dbStateStore.ts`
- Modify: `lib/dbWriteStore.ts`

**Migration:**

Add nullable reference columns:

```sql
alter table meetings add column if not exists raw_transcript_object_id text references storage_objects(id) on delete set null;
alter table meetings add column if not exists transcript_object_id text references storage_objects(id) on delete set null;
alter table meetings add column if not exists minute_markdown_object_id text references storage_objects(id) on delete set null;

alter table meeting_minutes add column if not exists minute_markdown_object_id text references storage_objects(id) on delete set null;

alter table ai_meeting_draft_jobs add column if not exists request_object_id text references storage_objects(id) on delete set null;
alter table ai_meeting_draft_jobs add column if not exists result_object_id text references storage_objects(id) on delete set null;
```

Keep existing text columns for compatibility:

```text
meetings.raw_transcript
meetings.transcript
meetings.minute_markdown
meeting_minutes.minute_markdown
ai_meeting_draft_jobs.request_json
ai_meeting_draft_jobs.result_json
```

First release behavior:

- Existing columns store preview or old inline value.
- New object columns point to full content when content is externalized.

**Verify:**

Run migrations locally or in test DB:

```powershell
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
```

Expected: no type or build errors.

---

## Task 5: Externalize Meeting Raw Transcript And Minute Markdown On New Writes

**Files:**
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/dbStateStore.ts`
- Modify: `lib/types.ts` only if new optional fields are needed

**Write path changes:**

When saving a meeting in DB mode:

- `meeting.rawTranscript` full text -> OSS category `raw_transcript`.
- `meeting.transcript` full text -> OSS category `transcript`.
- `meeting.minuteMarkdown` full text -> OSS category `minute_markdown`.
- PostgreSQL text column stores preview.
- Object id column stores `storage_objects.id`.

**Read path changes:**

When reading meetings:

- If object id exists, load full text from OSS.
- If object load fails, return preview and set a warning in logs, not fatal for list page.
- If no object id, return inline old DB value.

**Acceptance test:**

1. Create a meeting with a long transcript.
2. Generate AI minute.
3. Refresh page.
4. Confirm full text still appears.
5. Confirm DB text columns contain previews, not full huge content.
6. Confirm OSS objects exist under `meetings/raw-transcripts`, `meetings/transcripts`, and `meetings/minutes`.

---

## Task 6: Externalize AI Draft Job Request/Result Payloads

**Files:**
- Modify: `lib/aiMeetingDraftJobs.ts`
- Modify: `app/api/ai/meeting-draft-jobs/[jobId]/route.ts`
- Modify: `app/api/ai/meeting-draft-jobs/route.ts`

**Goal:** Keep AI draft jobs queryable without storing large request/result JSON in PostgreSQL forever.

**Write path:**

- For request JSON larger than a threshold, e.g. 32KB:
  - store full JSON in OSS under `meetings/ai-drafts/requests/`
  - store compact preview in `request_json`
  - store `request_object_id`
- For result JSON larger than threshold:
  - store full JSON in OSS under `meetings/ai-drafts/results/`
  - store compact preview in `result_json`
  - store `result_object_id`

**Read path:**

- Job detail API resolves object content before returning result.
- Job list API uses preview only.

**Verify:**

Run one AI draft job on a long transcript.

Expected:

```text
job creates successfully
polling returns completed result
storage_objects has ai_draft request/result rows
UI can still display AI draft result
```

---

## Task 7: Backend Generated Exports And Attachments

**Files:**
- Create or modify export helpers when export feature exists
- Modify: `app/api/meeting-file-text/route.ts`
- Create: `app/api/storage-objects/[objectId]/download/route.ts`

**Goal:** Any generated Word/PDF/Markdown export or uploaded large backend attachment should go to OSS, while extracted searchable text stays in PostgreSQL.

**Current known path:**

- `/api/meeting-file-text` reads TXT/DOCX and returns text. It currently does not persist the original file.

**First implementation:**

- Keep text extraction behavior unchanged.
- Add optional persistence only if the user enables it:

```env
MEETING_STORE_UPLOADED_DOCUMENTS=1
```

- Store original uploaded DOCX/TXT in:

```text
meeting-loop/prod/files/imports/
```

**Download API:**

- Authenticate current user.
- Check owner/meeting visibility.
- Generate signed URL or stream object from OSS.
- Do not expose raw AccessKey.

**Verify:**

- Upload DOCX.
- Text extraction still works.
- If persistence enabled, `storage_objects` row exists.
- Download URL works for authorized user only.

---

## Task 8: Optional Mobile Recording Migration

**Files:**
- Modify: `app/api/mobile/recordings/route.ts`
- Modify: `lib/tencentAsr.ts`
- Modify: `components/mobile-minutes/mobileMinutesApi.ts` only if response shape changes

**Trigger:** Only execute this task if the product decides mobile recording will remain.

**First safe version:**

- Keep browser upload to backend.
- Backend uploads the received recording to OSS under:

```text
meeting-loop/prod/recordings/YYYYMMDD/
```

- Keep a short-lived temp file only while Tencent ASR needs it.
- After ASR completes, delete local temp file.
- Store object id and object key in `storage_objects`.

**Better later version:**

- Browser direct upload through signed policy or STS.
- Backend receives only object key and metadata.
- This may require CORS and more OSS config, so it is not first priority.

**Verify:**

- Record a short meeting.
- Confirm local `.local-data/mobile-recordings` does not keep permanent new files.
- Confirm OSS object exists.
- Confirm ASR still updates the meeting transcript.

---

## Task 9: Historical Data Migration Script

**Files:**
- Create: `scripts/migrate-meeting-large-content-to-oss.mjs`

**Goal:** Move existing large database content to OSS after new-write path is stable.

**Rules:**

- Dry-run by default.
- Batch size default: 20 meetings.
- Skip rows that already have object ids.
- Only migrate rows above size threshold, e.g. 8KB.
- Keep previews in DB.
- Never delete old local recording files in this script.

**Commands:**

Dry run:

```powershell
node scripts/migrate-meeting-large-content-to-oss.mjs --dry-run --limit 20
```

Real run:

```powershell
node scripts/migrate-meeting-large-content-to-oss.mjs --apply --limit 20
```

Expected output:

```text
scanned=N
migrated=N
skipped=N
failed=0
```

**Verification SQL:**

```sql
select category, count(*), pg_size_pretty(sum(size_bytes)::bigint)
from storage_objects
where owner_type = 'meeting'
group by category
order by category;
```

---

## Task 10: Health Check And Admin Visibility

**Files:**
- Modify: `app/api/health/route.ts`
- Optional Modify: backend admin panel if needed

**Add health fields:**

```json
{
  "objectStorageConfigured": true,
  "objectStorageProvider": "oss",
  "objectStorageBucket": "your-oss-bucket",
  "objectStoragePrefix": "meeting-loop/prod"
}
```

Do not expose keys or signed URLs.

**Verify:**

```powershell
curl.exe -x "" -s https://your-domain.example.com/api/health
```

Expected:

```text
objectStorageConfigured=true
bucket and prefix visible
no secret values
```

---

## Task 11: Tencent Cloud Deployment

**Files:**
- Modify: `deploy/new-meeting-publish-package.ps1` only if package excludes need update
- Modify: `deploy/deploy-meeting-test-env.sh` only if new migration or env checks require it

**Pre-deploy local checks:**

```powershell
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
node scripts/check-meeting-object-storage.mjs
```

**Deploy package:**

Use the existing meeting app deployment pattern. Preserve:

```text
/opt/meeting-loop-test/.env
/opt/meeting-loop-test/.local-data
/opt/meeting-loop-test/lib/orgPeopleData.ts
```

**Server `.env` must contain OSS settings.**

Do not paste full `.env` into chat or logs.

**Post-deploy checks:**

```bash
cd /opt/meeting-loop-test
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=80 app
curl -ks https://your-domain.example.com/api/health
```

Expected:

```text
app Up
/api/health 200
objectStorageConfigured=true
```

---

## Task 12: Product Acceptance Tests

Run on production after deployment:

1. Open backend: `https://your-domain.example.com/`.
2. Log in as a president/admin account.
3. Create a meeting with a long transcript.
4. Generate AI meeting minute.
5. Refresh page.
6. Confirm meeting content, decisions, tasks, and minute still load.
7. Confirm `storage_objects` rows were created.
8. Confirm OSS objects are under:

```text
meeting-loop/prod/
```

9. Confirm no object is written outside that prefix.
10. Confirm `your-existing-prefix/` existing knowledge-base files were not modified.

---

## Rollback Plan

If new OSS write path fails:

1. Set:

```env
MEETING_OBJECT_STORAGE=disabled
```

2. Restart app.
3. New writes return to old DB inline behavior.
4. Existing OSS-backed rows still read if object refs exist; if needed, restore DB backup before migration.

If migration script partially fails:

- Do not delete OSS objects immediately.
- Keep previews in DB.
- Re-run failed batch after fixing config.

If public app fails:

- Restore previous `/opt/meeting-loop-test/.deploy-backups/deploy-*/` backup.
- Rebuild/restart using existing deployment script.

---

## Asset Package Recordkeeping

After implementation or deployment, update:

```text
D:\我的应用\会议应用\AI 工作流资产\09_memory\
D:\我的应用\会议应用\AI 工作流资产\10_tasks\
D:\我的应用\会议应用\AI 工作流资产\99_变更日志.md
```

Record:

- User request.
- Final OSS bucket/prefix.
- Whether OSS credentials are configured.
- Files changed.
- Local validation.
- Tencent deployment result.
- Public verification result.
- Known limits, especially that this phase reuses the knowledge-base authorized prefix to avoid new approval.

Never record AccessKey Secret or full `.env`.

---

## Recommended Execution Order

1. Task 1: storage adapter and OSS check script.
2. Task 2: `storage_objects` table and DB helper.
3. Task 10: health check visibility.
4. Task 3 and Task 4: large text helper and reference columns.
5. Task 5: new meeting raw transcript/minute markdown writes to OSS.
6. Task 6: AI draft job externalization.
7. Task 11: deploy after local checks.
8. Task 12: product acceptance.
9. Task 9: historical migration only after at least one stable production day.
10. Task 7 and Task 8 later, based on real usage.

Do not start with historical migration or mobile recording migration.
