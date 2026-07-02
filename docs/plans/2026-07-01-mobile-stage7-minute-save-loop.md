# Mobile Stage 7 Minute Save Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the mobile post-meeting loop from AI draft generation to user confirmation, backend persistence, and refreshed mobile messages/tasks.

**Architecture:** Keep `/mobile-minutes` inside the existing Next.js app and reuse existing backend workflows. `/api/ai/meeting-draft` remains a draft-only generator; confirmed mobile output is persisted through `POST /api/meetings/approval-submissions`, which already normalizes pending approval meetings, tasks, activity logs, and enterprise-WeChat notifications.

**Tech Stack:** Next.js App Router, React client components, TypeScript, CSS Modules, existing meeting/task APIs, existing DB/local-state stores.

---

## Current State

- Mobile route: `app/mobile-minutes/page.tsx`
- Mobile code: `components/mobile-minutes/`
- Current mobile generation entry: `components/mobile-minutes/MobileMinutesApp.tsx`
- Current detail UI: `components/mobile-minutes/MinuteDetail.tsx`
- Draft generator API: `POST /api/ai/meeting-draft`
- Existing persistence API: `POST /api/meetings/approval-submissions`
- Existing approval API: `PATCH /api/meetings/[meetingId]/approval`

Important behavior already verified:

- `/api/ai/meeting-draft` returns `aiSummary`, `minuteMarkdown`, `decisions`, `tasks`, `correctedTranscript`, and dictionary corrections.
- `/api/ai/meeting-draft` does not persist meetings or tasks.
- `POST /api/meetings/approval-submissions` persists a meeting with tasks as `pending_president_approval`.
- Stage 6 test meetings named `MOBILE_STAGE6_TEST` should not appear in the normal mobile recent-minutes list.

## Non-Goals

- Do not implement real-time recording transcription.
- Do not implement real speaker diarization.
- Do not create a second task workflow in the mobile frontend.
- Do not submit or overwrite existing closed business meetings during validation.
- Do not send real enterprise-WeChat messages during test validation unless explicitly approved.

## Core Product Flow

1. User opens a real meeting detail from mobile recent minutes.
2. User taps `一键生成会议纪要`.
3. Mobile shows a structured draft result:
   - AI 摘要
   - 会议纪要 Markdown
   - 决策
   - 待办草稿
   - 术语纠错
4. User reviews the draft.
5. User taps `确认并提交签批`.
6. Mobile calls `POST /api/meetings/approval-submissions`.
7. Mobile reloads `/api/state`.
8. Messages and tasks refresh using the existing mobile mappers.

## Safety Rules

- If selected meeting is already `closed` or `approvalStatus === "in_closed_loop"`, do not overwrite the same meeting ID.
- For closed meetings, confirmation must create a new mobile submission ID such as `mobile-submit-${sourceMeetingId}-${Date.now()}`.
- For pending/draft meetings, confirmation may update that meeting ID only when the current user is allowed to submit it.
- Confirmation button must be disabled when generated task count is zero, because `submitMeetingApprovalAction` rejects meetings with no tasks.
- Validation on public Tencent Cloud must use an isolated test meeting or a newly generated mobile submission, not existing production-like closed meetings.

---

## Task 1: Add Mobile Draft State Types

**Files:**
- Modify: `components/mobile-minutes/mobileMinutesTypes.ts`

**Steps:**

1. Add a mobile draft type:

```ts
import type { MeetingDecision, Task } from "@/lib/types";

export interface MobileGeneratedMinuteDraft {
  aiSummary: string;
  minuteMarkdown: string;
  decisions: MeetingDecision[];
  tasks: Task[];
  correctedTranscript?: string;
  dictionaryCorrections?: Array<{ standard: string; original: string; category?: string }>;
  sourceMeetingId?: string;
  generatedAt: string;
}
```

2. Run:

```powershell
corepack pnpm run build
```

Expected: TypeScript passes.

---

## Task 2: Store Full Draft Result In Mobile App

**Files:**
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify if needed: `components/mobile-minutes/mobileMinutesApi.ts`

**Steps:**

1. Replace `generatedSummary`-only state with `generatedDraft`.
2. In `handleGenerateMeetingDraft`, store:
   - `aiSummary`
   - `minuteMarkdown`
   - `decisions`
   - `tasks`
   - `correctedTranscript`
   - `dictionaryCorrections`
   - `sourceMeetingId`
   - `generatedAt`
3. Keep `generatedSummary` only as derived display text if needed.
4. Pass `generatedDraft` to `MinuteDetail`.
5. Run:

```powershell
corepack pnpm run build
```

Expected: build passes and current generation still reaches `state="generated"`.

---

## Task 3: Render Structured Generated Result

**Files:**
- Modify: `components/mobile-minutes/MinuteDetail.tsx`
- Modify: `components/mobile-minutes/MobileMinutes.module.css`

**Steps:**

1. In Summary tab:
   - Show AI summary first.
   - Show generation status message.
   - Show dictionary correction count if present.
2. In Draft tab:
   - Replace sample fallback with generated tasks when `generatedDraft.tasks.length > 0`.
   - Show each task with title/content, owner ID/name, reviewer ID/name, due date, priority, goal.
   - Show empty state when no tasks are generated.
3. Add a compact "决策" section:
   - Decision content
   - Owner
   - Impact scope
   - Whether president confirmation is needed
4. Add safe scrolling:
   - Content must not be hidden behind sticky action footer.
   - Long Markdown and long task names must wrap.
5. Run:

```powershell
corepack pnpm run build
```

Expected: build passes.

---

## Task 4: Build Confirmable Meeting Payload

**Files:**
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Optionally create: `components/mobile-minutes/mobileMinuteDraftPayload.ts`

**Steps:**

1. Implement helper `buildMobileSubmittedMeeting`.
2. Inputs:
   - `selectedMeeting`
   - `generatedDraft`
   - `currentUser`
3. Output must match `Meeting`.
4. Required fields:
   - `id`
   - `title`
   - `departmentId`
   - `type`
   - `hostId`
   - `participantIds`
   - `participantCount`
   - `startTime`
   - `durationMinutes`
   - `rawTranscript`
   - `transcript`
   - `summary`
   - `aiSummary`
   - `minuteMarkdown`
   - `conclusions`
   - `decisions`
   - `tasks`
   - `approvalStatus: "pending_president_approval"`
   - `status: "summarized"`
   - `createdBy`
   - `createdAt`
5. Meeting ID rule:
   - If selected meeting is closed/in closed loop, use `mobile-submit-${selectedMeeting.id}-${Date.now()}`.
   - Otherwise use selected meeting ID.
6. Task normalization:
   - `meetingId` must equal submitted meeting ID.
   - `approvalStatus` must be `pending_president_approval`.
   - `status` must be `not_started`.
   - Ensure `ownerId`, `departmentId`, `reviewerId`, `dueDate`, and `title` exist.
7. Run:

```powershell
corepack pnpm run build
```

Expected: build passes.

---

## Task 5: Add Confirm Submission API Call

**Files:**
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`

**Steps:**

1. Add API helper:

```ts
export async function submitMeetingApproval(meeting: Meeting) {
  const response = await fetch("/api/meetings/approval-submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meeting })
  });
  const payload = (await response.json().catch(() => ({}))) as { meeting?: Meeting; error?: string };
  if (!response.ok || !payload.meeting) throw new Error(payload.error || "会议提交签批失败");
  return payload.meeting;
}
```

2. In `MobileMinutesApp.tsx`, add `handleConfirmGeneratedMeeting`.
3. Guard conditions:
   - no current user: show error
   - no generated draft: show error
   - no tasks: show "未生成待办，不能提交签批"
4. On success:
   - reload backend state with `loadBackendState({ silent: true })`
   - set generated status message
   - show button `查看消息/待办`
5. Run:

```powershell
corepack pnpm run build
```

Expected: build passes.

---

## Task 6: Add Confirmation UI

**Files:**
- Modify: `components/mobile-minutes/MinuteDetail.tsx`
- Modify: `components/mobile-minutes/MobileMinutes.module.css`

**Steps:**

1. Add props:
   - `generatedDraft`
   - `onConfirmGeneratedMeeting`
   - `isConfirmingGeneratedMeeting`
   - `confirmMessage`
2. When `state === "generated"`:
   - Primary button: `确认并提交签批`
   - Secondary action: `查看消息`
   - Disable primary button when no generated tasks.
3. After successful confirmation:
   - Change primary button to `查看待办`
   - Keep summary visible.
4. Run:

```powershell
corepack pnpm run build
```

Expected: build passes.

---

## Task 7: Validate With Isolated Test Data

**Files:**
- No code change required.

**Steps:**

1. Before write validation, create a Tencent Cloud DB backup:

```bash
cd /opt/meeting-loop-test
mkdir -p .local-data/backups
docker compose exec -T db pg_dump -U meeting_user meeting_loop > .local-data/backups/postgres-before-mobile-stage7-YYYYMMDD-HHMMSS.sql
```

2. Log in as a non-real or controlled test user.
3. Use a long-transcript test meeting or a new mobile submission ID.
4. Generate draft.
5. Confirm submission.
6. Verify:
   - submitted meeting exists with `approvalStatus=pending_president_approval`
   - generated tasks remain inside submitted meeting until president approval
   - mobile messages include submission notification for president
   - no existing closed meeting was overwritten
7. If enterprise-WeChat outbox is produced, confirm it is either expected or uses test users with missing map and no real send.

Expected: no production-like closed meeting is mutated.

---

## Task 8: Deploy And Public Smoke Test

**Files:**
- No source edits unless failures are found.

**Steps:**

1. Build:

```powershell
corepack pnpm run build
```

2. Package:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\deploy\new-meeting-publish-package.ps1"
```

3. Deploy package to `/opt/meeting-loop-test`, preserving:
   - `.env`
   - `.local-data`

4. Verify:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 20
Invoke-WebRequest -Uri "http://localhost:3000/mobile-minutes" -UseBasicParsing -TimeoutSec 20
```

Expected:

- `/` returns 200
- `/mobile-minutes` returns 200
- mobile page still contains `AI 会议记录`

---

## Acceptance Criteria

- A user can generate a mobile meeting draft from a long-transcript meeting.
- Generated summary, decisions, and tasks are visible on mobile.
- User can confirm and submit generated output for president approval.
- Confirmation reuses `POST /api/meetings/approval-submissions`.
- Generated mobile submission appears in backend state after reload.
- Messages/tasks refresh without manual page reload.
- Closed existing meetings are not overwritten.
- Short transcript meetings cannot be submitted for generation.
- Build passes before deployment.
- Public Tencent Cloud smoke test returns 200 for `/` and `/mobile-minutes`.
