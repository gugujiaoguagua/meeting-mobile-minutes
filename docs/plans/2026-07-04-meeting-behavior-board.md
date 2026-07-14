# Meeting Behavior Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a read-only backend meeting behavior board so managers can see who held meetings, what happened, and where each meeting is stuck.

**Architecture:** Reuse the existing Next.js full-stack app, PostgreSQL state store, permission helpers, and desktop admin layout. Add a read-only aggregation API for board rows, then add a desktop page that renders searchable and filterable rows and deep-links to the existing meeting detail page.

**Tech Stack:** Next.js App Router, React 19, TypeScript, PostgreSQL via existing `dbQuery`, existing `Meeting`/`Task`/`ActivityLog` types, Tailwind utility classes already used in `app/page.tsx`.

---

## Scope

Build the first version only:

- Read-only board.
- No meeting edit/delete.
- No enterprise-WeChat notification trigger.
- No data-model rewrite.
- Use existing tables: `meetings`, `meeting_participants`, `meeting_minutes`, `meeting_decisions`, `tasks`, `activity_logs`, `users`, `departments`.

The board must answer:

- Who held the meeting?
- What meeting was held?
- Was recording uploaded?
- Was transcription completed or failed?
- Was AI minutes generated?
- How many decisions and tasks were produced?
- Was it submitted for approval or closed?
- What was the latest action?

## Pre-Flight

### Step 1: Check current working tree

Run:

```powershell
git -C 'D:\我的应用\会议应用\拉迷集团AI会议闭环系统交付包_2026-06-21' status --short --branch
```

Expected:

- Note any existing modified files before editing.
- Current observed dirty files before this plan was written:
  - `components/mobile-minutes/MobileMinutes.module.css`
  - `components/mobile-minutes/MobileMinutesApp.tsx`
  - `components/mobile-minutes/RecordHome.tsx`
  - `components/mobile-minutes/mobileMinutesMappers.ts`
  - `components/mobile-minutes/mobileMinutesTypes.ts`

Do not overwrite unrelated user changes.

### Step 2: Read current implementation points

Read:

- `app/api/mobile/recordings/route.ts`
- `app/api/state/route.ts`
- `lib/dbStateStore.ts`
- `lib/dbWriteStore.ts`
- `lib/permission.ts`
- `lib/types.ts`
- `app/page.tsx`

Confirm:

- Mobile recording meetings already save `hostId`, `createdBy`, `departmentId`, timing, and recording status.
- `readVisibleDbState()` already applies role-based visibility.
- Desktop admin already has `meeting-detail` navigation.

## Task 1: Define Board Row Types

**Files:**

- Modify: `lib/types.ts`

**Step 1: Add read-only board types**

Add near meeting-related types:

```ts
export type MeetingBoardStatus =
  | "recording_transcribing"
  | "recording_failed"
  | "needs_minutes"
  | "needs_approval_submission"
  | "pending_approval"
  | "in_closed_loop"
  | "closed";

export interface MeetingBoardRow {
  meetingId: string;
  title: string;
  meetingType: MeetingType;
  departmentId: string;
  departmentName: string;
  hostId: string;
  hostName: string;
  hostEmployeeNo?: string;
  hostTitle?: string;
  createdBy?: string;
  createdByName?: string;
  createdByEmployeeNo?: string;
  sourceType: "mobile_recording" | "desktop_upload" | "manual" | "unknown";
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  recordingStatus?: RecordingStatus;
  recordingStatusMessage?: string;
  hasTranscript: boolean;
  hasAiSummary: boolean;
  decisionCount: number;
  draftTaskCount: number;
  formalTaskCount: number;
  totalTaskCount: number;
  approvalStatus?: ApprovalStatus;
  status: MeetingStatus;
  boardStatus: MeetingBoardStatus;
  lastAction?: string;
  lastActionAt?: string;
  lastActorName?: string;
}

export interface MeetingBoardResponse {
  rows: MeetingBoardRow[];
  summary: {
    totalMeetings: number;
    mobileRecordings: number;
    transcribing: number;
    failedRecordings: number;
    needsMinutes: number;
    needsApprovalSubmission: number;
    pendingApproval: number;
    closed: number;
  };
}
```

**Step 2: Run typecheck**

Run:

```powershell
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS or only pre-existing unrelated errors. If errors come from this change, fix before continuing.

## Task 2: Add Board Aggregation Helper

**Files:**

- Create: `lib/meetingBoard.ts`

**Step 1: Implement pure row mapping**

Create helper functions:

```ts
import { departments, users } from "@/lib/orgPeopleData";
import type { ActivityLog, Meeting, MeetingBoardResponse, MeetingBoardRow, MeetingBoardStatus, Task } from "@/lib/types";

function findUser(userId?: string) {
  return userId ? users.find((user) => user.id === userId) : undefined;
}

function findDepartment(departmentId?: string) {
  return departmentId ? departments.find((department) => department.id === departmentId) : undefined;
}

function sourceTypeFor(meeting: Meeting): MeetingBoardRow["sourceType"] {
  if (meeting.sourceTemplateName === "mobile-browser-recording" || meeting.id.startsWith("mobile-recording-")) return "mobile_recording";
  if (meeting.uploadedFileName || meeting.sourceFileName) return "desktop_upload";
  if (meeting.rawTranscript || meeting.transcript) return "manual";
  return "unknown";
}

function boardStatusFor(meeting: Meeting, decisionCount: number, totalTaskCount: number): MeetingBoardStatus {
  if (meeting.status === "closed" || meeting.approvalStatus === "in_closed_loop") return "closed";
  if (meeting.recordingStatus === "transcribing") return "recording_transcribing";
  if (meeting.recordingStatus === "failed") return "recording_failed";
  if (!meeting.aiSummary && !meeting.minuteMarkdown) return "needs_minutes";
  if (decisionCount === 0 && totalTaskCount === 0) return "needs_approval_submission";
  if (meeting.approvalStatus === "pending_president_approval") return "pending_approval";
  return "needs_approval_submission";
}

function latestLogFor(meetingId: string, logs: ActivityLog[]) {
  return logs
    .filter((log) => log.meetingId === meetingId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export function buildMeetingBoardResponse(input: { meetings: Meeting[]; tasks: Task[]; activityLogs: ActivityLog[] }): MeetingBoardResponse {
  const rows = input.meetings.map((meeting) => {
    const host = findUser(meeting.hostId);
    const creator = findUser(meeting.createdBy);
    const department = findDepartment(meeting.departmentId);
    const formalTasks = input.tasks.filter((task) => task.meetingId === meeting.id);
    const draftTaskCount = meeting.tasks?.length ?? 0;
    const formalTaskCount = formalTasks.length;
    const totalTaskCount = draftTaskCount + formalTaskCount;
    const decisionCount = meeting.decisions?.length ?? 0;
    const latestLog = latestLogFor(meeting.id, input.activityLogs);
    const boardStatus = boardStatusFor(meeting, decisionCount, totalTaskCount);

    return {
      meetingId: meeting.id,
      title: meeting.title,
      meetingType: meeting.type,
      departmentId: meeting.departmentId,
      departmentName: department?.name ?? meeting.departmentId,
      hostId: meeting.hostId,
      hostName: host?.name ?? meeting.hostId,
      hostEmployeeNo: host?.employeeNo,
      hostTitle: host?.title,
      createdBy: meeting.createdBy,
      createdByName: creator?.name,
      createdByEmployeeNo: creator?.employeeNo,
      sourceType: sourceTypeFor(meeting),
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      durationMinutes: meeting.durationMinutes,
      recordingStatus: meeting.recordingStatus,
      recordingStatusMessage: meeting.recordingStatusMessage,
      hasTranscript: Boolean((meeting.transcript || meeting.rawTranscript || "").trim()),
      hasAiSummary: Boolean((meeting.aiSummary || meeting.minuteMarkdown || "").trim()),
      decisionCount,
      draftTaskCount,
      formalTaskCount,
      totalTaskCount,
      approvalStatus: meeting.approvalStatus,
      status: meeting.status,
      boardStatus,
      lastAction: latestLog?.title,
      lastActionAt: latestLog?.createdAt,
      lastActorName: latestLog?.actorName
    } satisfies MeetingBoardRow;
  });

  return {
    rows,
    summary: {
      totalMeetings: rows.length,
      mobileRecordings: rows.filter((row) => row.sourceType === "mobile_recording").length,
      transcribing: rows.filter((row) => row.boardStatus === "recording_transcribing").length,
      failedRecordings: rows.filter((row) => row.boardStatus === "recording_failed").length,
      needsMinutes: rows.filter((row) => row.boardStatus === "needs_minutes").length,
      needsApprovalSubmission: rows.filter((row) => row.boardStatus === "needs_approval_submission").length,
      pendingApproval: rows.filter((row) => row.boardStatus === "pending_approval").length,
      closed: rows.filter((row) => row.boardStatus === "closed" || row.boardStatus === "in_closed_loop").length
    }
  };
}
```

**Step 2: Typecheck**

Run:

```powershell
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

## Task 3: Add Read-Only API

**Files:**

- Create: `app/api/meeting-board/route.ts`

**Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildMeetingBoardResponse } from "@/lib/meetingBoard";
import { isDbStateReadEnabled } from "@/lib/db";
import { readVisibleDbState } from "@/lib/dbStateStore";
import { readVisibleLocalState } from "@/lib/localStateStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const state = isDbStateReadEnabled() ? await readVisibleDbState(currentUser) : await readVisibleLocalState(currentUser);
  return NextResponse.json(buildMeetingBoardResponse({
    meetings: state.meetings,
    tasks: state.tasks,
    activityLogs: state.activityLogs
  }));
}
```

**Step 2: Smoke unauthenticated behavior**

Run local server if needed:

```powershell
pnpm dev
```

Then:

```powershell
curl.exe -sS -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/meeting-board
```

Expected: `401` when not logged in.

## Task 4: Add Client API Loader

**Files:**

- Modify: `app/page.tsx`

**Step 1: Add response typing if local page typing needs it**

If the desktop page keeps all types locally, import `MeetingBoardResponse` from `lib/types`.

**Step 2: Load board data**

Prefer using existing `/api/state` data already loaded in `app/page.tsx` if that avoids duplicate requests. If implementation stays client-only, use:

```ts
const meetingBoard = useMemo(
  () => buildMeetingBoardResponse({ meetings: visibleMeetings, tasks: visibleTasks, activityLogs }),
  [visibleMeetings, visibleTasks, activityLogs]
);
```

If the separate API is used by the page, fetch `/api/meeting-board` after login and store rows separately.

Recommended first version: use the helper in the page with already loaded state, and keep `/api/meeting-board` for external/diagnostic usage.

## Task 5: Add Desktop Page Entry

**Files:**

- Modify: `lib/types.ts`
- Modify: `app/page.tsx`

**Step 1: Add page key**

Add to `PageKey`:

```ts
| "meeting-board"
```

**Step 2: Add nav item**

In the desktop nav list in `app/page.tsx`, add:

```ts
{ key: "meeting-board", label: "会议看板", icon: BarChart3 }
```

Place it near `管理驾驶舱` and `会议列表`.

**Step 3: Add page title mapping**

Where `page === ...` titles are mapped, add:

```ts
if (page === "meeting-board") return "会议看板";
```

## Task 6: Build Meeting Board UI

**Files:**

- Modify: `app/page.tsx`

**Step 1: Create `MeetingBoardPage` component**

Add a component near existing dashboard/list pages.

Controls:

- Date range start/end.
- Department select.
- Status select.
- Search input for host/creator/title/employee number.

Summary cards:

- 会议总数.
- 手机录音.
- 转写中.
- 异常/失败.
- 待生成纪要.
- 待提交签批.
- 已闭环.

Table columns:

- 会议时间.
- 主持人.
- 创建人.
- 部门.
- 会议标题.
- 来源.
- 转写/纪要状态.
- 决策/待办.
- 签批状态.
- 最后动作.
- 操作：详情.

**Step 2: Preserve existing style**

Use existing utility components and styles already in `app/page.tsx`:

- `MetricTile`
- `Toolbar`
- `Field`
- `Select`
- existing table style used by `MeetingsPage` and `TasksPage`
- existing `onNavigate("meeting-detail", meetingId)` pattern

**Step 3: Empty state**

If no rows match filters:

```tsx
<EmptyState text="当前筛选条件下没有会议记录" />
```

## Task 7: Wire Page Rendering

**Files:**

- Modify: `app/page.tsx`

Add render branch:

```tsx
{activePage === "meeting-board" && (
  <MeetingBoardPage
    rows={meetingBoard.rows}
    summary={meetingBoard.summary}
    departments={departments}
    onNavigate={navigate}
  />
)}
```

Exact props may vary depending on whether `MeetingBoardPage` computes from state or receives rows.

## Task 8: Verification

**Step 1: Typecheck**

Run:

```powershell
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

**Step 2: Build**

Run:

```powershell
pnpm build
```

Expected: PASS.

**Step 3: Local browser smoke**

Start:

```powershell
pnpm dev
```

Verify:

- Desktop root opens.
- Navigation contains `会议看板`.
- Total rows match visible meetings for current role.
- Search by known user name returns matching meetings.
- Status filter `转写中` shows meetings with `recordingStatus=transcribing`.
- Clicking `详情` opens existing meeting detail.

**Step 4: Permission smoke**

Verify:

- 总裁账号 sees all visible meetings.
- 部门负责人 sees department-related meetings.
- 员工 sees only own hosted/participated/related meetings.

## Task 9: Deploy Only After Local Acceptance

Do not deploy until local checks pass and user confirms.

If approved:

1. Build local package.
2. Preserve server `.env`, `.local-data`, and server-specific `lib/orgPeopleData.ts`.
3. Deploy to Tencent Cloud.
4. Verify:
   - `https://your-domain.example.com/` returns desktop backend.
   - `https://your-domain.example.com/mobile-minutes` still returns mobile page.
   - `https://api.your-domain.example.com/api/meeting-board` returns `401` when unauthenticated.
   - Logged-in desktop page can open `会议看板`.

## Suggested Commits

Commit after each stable section:

```powershell
git add lib/types.ts lib/meetingBoard.ts app/api/meeting-board/route.ts
git commit -m "feat: add meeting board aggregation"

git add app/page.tsx
git commit -m "feat: add desktop meeting behavior board"

git add docs/plans/2026-07-04-meeting-behavior-board.md
git commit -m "docs: plan meeting behavior board"
```

## Acceptance Criteria

- Backend has a read-only `GET /api/meeting-board` route.
- Desktop backend has `会议看板`.
- Board answers who held which meeting and what stage it is in.
- No write action is triggered from the board.
- Existing mobile recording flow is unchanged.
- Existing meeting detail page remains the drill-down target.
