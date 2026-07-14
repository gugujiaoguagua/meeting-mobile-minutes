# Canonical Identity, OKR Due Date, And Meeting OKR Link Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make frontend and backend use the same enterprise-WeChat-reachable person identity, allow OKR task owners to adjust their own due dates with reviewer notification, and make meeting-to-OKR linkage create real OKR project records.

**Architecture:** Treat identity cleanup as a backend business rule, not a frontend display filter. Add a canonical-user layer used by auth, state APIs, notification resolution, and frontend directories; then add explicit OKR due-date and meeting-OKR synchronization actions with audit records and WeCom outbox events.

**Tech Stack:** Next.js App Router, React, TypeScript, PostgreSQL, existing local JSON fallback, enterprise WeChat outbox, `components/mobile-minutes`, `app/api`, `lib/*` domain stores.

---

## Scope

This plan covers both backend and frontend:

- Backend must stop accepting or emitting duplicate person identities where a canonical enterprise-WeChat-reachable user exists.
- Frontend must stop showing duplicate users in account switching, owner/reviewer/participant selectors, and OKR assignment selectors.
- Existing historical data should remain readable; new writes should resolve to canonical user IDs.
- Enterprise WeChat delivery remains best-effort: notification failure must not block the business action, but it must create skipped/failed outbox evidence.

## Current Code Anchors

- Project root: `D:\我的应用\会议应用\拉迷集团AI会议闭环系统交付包_2026-06-21`
- Mobile frontend: `components/mobile-minutes`
- Auth: `lib/auth.ts`, `app/api/auth/*`
- User source data: `lib/orgPeopleData.ts`, state users from DB/local state
- WeCom mapping: `lib/wecomUserMap.ts`
- WeCom org sync: `lib/wecomOrgSync.ts`
- WeCom notifications: `lib/wecomTaskNotifications.ts`, `lib/wecomOkrNotifications.ts`, `lib/wecomOutbox.ts`
- State APIs: `app/api/state/route.ts`, `lib/dbStateStore.ts`, `lib/localStateStore.ts`
- OKR APIs: `app/api/okr/projects/route.ts`, `app/api/okr/pdca-tasks/[taskId]/*`
- OKR store: `lib/okrDbStore.ts`, `lib/okrTypes.ts`
- Meeting approval: `app/api/meetings/approval-submissions/route.ts`, `lib/dbWriteStore.ts`, `lib/meetingActions.ts`
- Mobile entry: `components/mobile-minutes/MobileMinutesApp.tsx`
- Mobile task UI: `components/mobile-minutes/MobileTasks.tsx`
- Mobile backend panel: `components/mobile-minutes/MobileBackendPanel.tsx`
- Mobile API wrapper: `components/mobile-minutes/mobileMinutesApi.ts`

## Phase 0: Baseline And Safety

**Files:**
- Read: `package.json`
- Read: `.env`
- Read: `database/migrations/*`
- Read: `lib/types.ts`
- Read: `lib/okrTypes.ts`

**Steps:**

1. Run baseline checks:
   ```powershell
   cd "D:\我的应用\会议应用\拉迷集团AI会议闭环系统交付包_2026-06-21"
   corepack pnpm exec tsc --noEmit --pretty false
   corepack pnpm build
   ```
   Expected: both pass before changes.

2. Confirm current persistence mode:
   ```powershell
   Get-Content -LiteralPath ".env" | Select-String -Pattern "MEETING_STATE_STORE|DATABASE_URL"
   ```
   Expected: know whether active testing uses PostgreSQL or local JSON.

3. If DB mode is enabled, create or run the existing DB backup path before any data migration.

**Acceptance:** Baseline is known. No code change starts without knowing DB/local mode.

## Phase 1: Backend Canonical User Rule

**Goal:** Define one canonical identity per real person and use it on the backend before frontend changes.

**Files:**
- Create: `lib/canonicalUsers.ts`
- Modify: `lib/wecomUserMap.ts`
- Modify: `lib/auth.ts`
- Modify: `app/api/state/route.ts`
- Modify: `app/api/auth/login/route.ts`
- Test or script: `scripts/check-canonical-users.ts` or targeted TypeScript unit script if the repo has no test runner

**Canonical rule:**

1. Prefer users that can resolve to an enterprise WeChat userid through `resolveWecomUserId(user.id)`.
2. If multiple users resolve to the same WeCom userid, keep the `source === "wecom"` user first.
3. If still tied, prefer the user with `employeeNo`.
4. If still tied, prefer the newest state user over static fallback only when the ID is already used in current persisted state.
5. Preserve an alias map from duplicate user IDs to canonical user IDs.

**Backend helper API shape:**

```ts
export type CanonicalUserDirectory = {
  users: User[];
  aliasToCanonicalUserId: Record<string, string>;
};

export function buildCanonicalUserDirectory(users: User[]): CanonicalUserDirectory;
export function canonicalizeUserId(userId: string | undefined, aliases: Record<string, string>): string | undefined;
export function canonicalizeTaskUsers<T extends Task>(task: T, aliases: Record<string, string>): T;
export function canonicalizeMeetingUsers<T extends Meeting>(meeting: T, aliases: Record<string, string>): T;
```

**Steps:**

1. Implement `buildCanonicalUserDirectory()` without mutating input.
2. Add a diagnostic script that prints duplicate groups: canonical user, aliases, WeCom userid, name, employeeNo.
3. Update `findAuthUserInCurrentState()` so login by an alias resolves to the canonical user.
4. Update `POST /api/auth/login` to return the canonical user even if the frontend posts an old duplicate ID.
5. Update `GET /api/state` output to emit canonical `users` and canonicalized `meetings/tasks/activityLogs` user IDs where safe.
6. Keep historical raw IDs readable in logs; do not delete old records in this phase.

**Verification:**

Run:
```powershell
corepack pnpm exec tsc --noEmit --pretty false
```

Manual API checks:

- Login with a duplicate old ID returns the canonical user.
- `/api/state` no longer emits duplicate selectable users for the same WeCom-reachable person.
- Existing meetings/tasks still load.

## Phase 2: Backend Write Canonicalization

**Goal:** New writes must never create new tasks, meetings, OKR tasks, review assignments, or notifications against duplicate alias IDs.

**Files:**
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/meetingActions.ts`
- Modify: `lib/okrDbStore.ts`
- Modify: `app/api/meetings/approval-submissions/route.ts`
- Modify: `app/api/okr/projects/route.ts`
- Modify: `app/api/okr/pdca-tasks/[taskId]/completion/route.ts`
- Modify: `app/api/okr/pdca-tasks/[taskId]/status/route.ts`
- Modify: `lib/wecomTaskNotifications.ts`
- Modify: `lib/wecomOkrNotifications.ts`

**Steps:**

1. Add a small backend utility call near each write boundary:
   - meeting host
   - participants
   - task owner
   - task reviewer
   - task department manager where derived from user
   - OKR project owner
   - KR owner/reviewer
   - OKR PDCA owner/reviewer
2. In `submitMeetingApprovalDb()` canonicalize `submittedMeeting` before writing.
3. In `submitMeetingApprovalAction()` canonicalize the local-state path too.
4. In `saveOkrProject()` canonicalize all owner/reviewer IDs before upsert.
5. In notification modules canonicalize recipient IDs before `resolveWecomUserId()`.
6. Add clear warnings for unresolved alias groups, but do not block save unless the selected user truly does not exist.

**Verification:**

- Create a meeting using a duplicate old ID through the API payload; saved meeting/task should use canonical IDs.
- Create an OKR project using duplicate owner/reviewer IDs; saved project should use canonical IDs.
- WeCom outbox should target canonical recipients.

## Phase 3: Frontend Directory And Selectors

**Goal:** Frontend follows backend canonical identity and does not reintroduce duplicate selectable people.

**Files:**
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `components/mobile-minutes/MobileBackendPanel.tsx`
- Modify: `components/mobile-minutes/ParticipantPickerSheet.tsx`
- Modify: `components/mobile-minutes/mobileMinutesMappers.ts`
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Optional Create: `components/mobile-minutes/canonicalMobileUsers.ts`

**Steps:**

1. Ensure `fetchMeetingState()` receives already-canonical `users`.
2. Add a frontend fallback dedupe helper only as display protection, not as primary business logic.
3. Apply canonical user list to:
   - “我的”账号切换
   - 新建会议主持人/参与人
   - 新建会议待办推进人/复核人
   - OKR 项目负责人
   - KR/PDCA 负责人和复核人
4. If current logged-in cookie points to an alias, show the canonical user after refresh.
5. In labels, optionally show `企业微信可达` or `企微账号` only where helpful for administrators; avoid cluttering normal mobile task cards.

**Verification:**

- Phone view has no repeated person rows in account search.
- Owner/reviewer selectors show one row per real person.
- Existing task cards still show names correctly.

## Phase 4: OKR Due Date Change Action

**Goal:** OKR task owner can change their own OKR task end date from mobile “我的待办”; reviewer receives enterprise WeChat notification.

**Files:**
- Modify: `lib/okrTypes.ts`
- Modify: `lib/okrDbStore.ts`
- Create: `app/api/okr/pdca-tasks/[taskId]/end-date/route.ts`
- Modify: `lib/wecomOkrNotifications.ts`
- Modify: `app/api/wecom/outbox/route.ts`
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MobileTasks.tsx`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`

**Data model options:**

Preferred minimal version:

- Update `okr_pdca_tasks.end_date`.
- Add an activity/progress entry if an existing OKR progress table can safely represent it.
- If not, create a new migration for `okr_pdca_task_change_logs`.

Recommended audit row shape if adding a table:

```sql
create table if not exists okr_pdca_task_change_logs (
  id text primary key,
  task_id text not null references okr_pdca_tasks(id) on delete cascade,
  action text not null,
  actor_id text,
  from_value text,
  to_value text,
  reason text,
  created_at timestamptz not null default now()
);
```

**API contract:**

`PATCH /api/okr/pdca-tasks/[taskId]/end-date`

Request:

```json
{
  "endDate": "2026-07-20",
  "reason": "供应商临时延期，需顺延验收时间"
}
```

Response:

```json
{
  "task": {},
  "changed": true
}
```

**Rules:**

1. Only task owner can self-change the end date.
2. Reviewer, project owner, or president permissions can be considered later; first version should not quietly expand rights.
3. Date must be valid and not earlier than `startDate`.
4. If date is unchanged, return `changed=false` and do not send notification.
5. If reviewer is missing or not WeCom reachable, write skipped outbox evidence.

**Notification event:**

- Event type: `okr_pdca_due_date_changed`
- Source type: `okr_pdca_task`
- Source ID: `task.id`
- Recipient: `task.reviewerId`
- Button: `查看 OKR`

**Verification:**

- Owner changes their own OKR end date: 200, DB updated, reviewer outbox row created.
- Non-owner tries change: 403.
- Invalid date: 400.
- Missing WeCom map: action succeeds, outbox status is skipped.

## Phase 5: Meeting To OKR Real Link

**Goal:** New meeting selection of an OKR project must write both directions: meeting knows OKR, and OKR project records the meeting and its tasks.

**Files:**
- Modify: `lib/okrDbStore.ts`
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/meetingActions.ts`
- Modify: `app/api/meetings/approval-submissions/route.ts`
- Modify: `components/mobile-minutes/MobileBackendPanel.tsx`
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Optional Modify: `lib/wecomOkrNotifications.ts` if new OKR-linked tasks need alerts

**Decision: first version task landing**

Use a conservative first version:

- Add meeting to `OkrProject.relatedMeetings`.
- Add meeting-generated tasks to `OkrProject.relatedTasks`.
- Do not immediately convert every meeting task into formal `okr_pdca_tasks`, because PDCA needs `krId` and `pdcaStage`, which the new meeting form does not currently require.

Later version can add:

- Required KR selection when linking a meeting to OKR.
- Required PDCA stage selection per meeting task.
- Then create real `okr_pdca_tasks`.

**Backend helper proposal:**

```ts
export async function linkMeetingToOkrProject(input: {
  projectId: string;
  meeting: Meeting;
  tasks: Task[];
  actorId: string;
}): Promise<OkrProject | undefined>;
```

**Rules:**

1. If `meeting.okrProjectId` is empty, do nothing.
2. If project does not exist or current user cannot view it, return 400/403.
3. If the meeting is already in `relatedMeetings`, update it instead of duplicating.
4. If a task is already in `relatedTasks`, update it instead of duplicating.
5. Preserve meeting approval workflow; OKR linking must not bypass president approval rules.

**Trigger point:**

Preferred trigger for first version:

- In `submitMeetingApprovalDb()` after the meeting and draft tasks are saved as pending president approval, write `relatedMeetings` and `relatedTasks`.

Reason:

- The user expects selecting OKR during new meeting to be immediately meaningful.
- President approval can still control whether meeting tasks become formal closed-loop tasks.

**Verification:**

- Create meeting with OKR project selected.
- Reload OKR projects from `/api/okr/projects`.
- Selected project contains the meeting in `relatedMeetings`.
- Selected project contains generated meeting tasks in `relatedTasks`.
- Re-submit same meeting does not duplicate related records.
- Meeting without OKR project leaves OKR data unchanged.

## Phase 6: Cross-Flow Regression

**Commands:**

```powershell
cd "D:\我的应用\会议应用\拉迷集团AI会议闭环系统交付包_2026-06-21"
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
```

**Manual regression checklist:**

- Login/current user:
  - `GET /api/auth/me`
  - alias login resolves to canonical user
- State:
  - `GET /api/state` returns deduped users
  - existing meetings/tasks still render
- Mobile:
  - `/mobile-minutes` opens
  - account selector deduped
  - task owner/reviewer selector deduped
  - OKR owner/reviewer selector deduped
- OKR due date:
  - owner can change end date
  - reviewer receives outbox record
- Meeting OKR link:
  - selected OKR project receives related meeting and related tasks
- WeCom outbox:
  - `okr_pdca_due_date_changed` appears in allowed filter list
  - skipped/failed statuses remain inspectable

## Phase 7: Deployment And Acceptance

**Pre-deploy checks:**

```powershell
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
git diff --check
```

**Package/deploy:**

Use existing meeting-app deploy path:

- `deploy/new-meeting-publish-package.ps1`
- Tencent Cloud app root: `/opt/meeting-loop-test`
- Preserve:
  - `.env`
  - `.local-data`
  - `.deploy-backups`
  - server real `lib/orgPeopleData.ts`

**Formal-domain acceptance:**

- `https://your-domain.example.com/`
- `https://your-domain.example.com/mobile-minutes`
- `https://api.your-domain.example.com/api/health`
- Authenticated `/api/auth/me`
- Authenticated `/api/state`
- Authenticated `/api/okr/projects`

## Risk Notes

- Identity cleanup has the largest blast radius. It affects login, permissions, task ownership, reviewers, notifications, and statistics.
- Do not delete duplicate historical users in the first implementation. Canonicalize reads/writes first, then consider cleanup migration after acceptance.
- Meeting-to-OKR task conversion should start as `relatedTasks`; full PDCA task creation needs explicit KR/stage selection.
- WeCom notification failure must not block due-date changes or meeting save, but must leave outbox evidence.

## Done Criteria

1. Backend APIs use canonical user IDs for new writes.
2. Frontend user selectors no longer show duplicate identities.
3. OKR task owner can adjust their own end date from mobile task page.
4. Reviewer gets enterprise WeChat outbox notification for OKR date change.
5. New meeting linked to OKR appears in that OKR project with related meeting and related tasks.
6. Build checks pass.
7. Asset pack is updated after implementation with what changed, what was verified, and what remains.
