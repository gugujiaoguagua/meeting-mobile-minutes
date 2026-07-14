# Mobile Speaker Attribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a safe first version of mobile speaker attribution by selecting meeting participants before recording and mapping generic speaker labels to real participants after transcription.

**Architecture:** Keep phase one deterministic and user-controlled: mobile recording stores participant IDs, transcript display continues to use generic speaker labels until the user maps them to participants, and AI draft generation receives the mapped participant context. Automatic speaker diarization is a separate phase-two POC that can reuse Tencent Cloud speaker-separation APIs after the manual workflow is stable.

**Tech Stack:** Next.js App Router, React 19, TypeScript, existing mobile-minutes components, existing PostgreSQL state store, Tencent Cloud ASR for later POC.

---

## Scope

### In Scope For Phase One

- Add participant selection before mobile recording starts.
- Save selected `participantIds` with mobile recording meetings.
- Show selected participants in minute detail.
- Add a speaker mapping UI that maps `发言人1/2/3/...` to selected participants.
- Persist speaker mappings with the meeting.
- Apply speaker mappings in transcript display and AI draft request context.

### Out Of Scope For Phase One

- No participant invitation or notification when users are selected.
- No Enterprise WeChat push, in-app message, or task creation from participant selection.
- No automatic voiceprint identity recognition.
- No speaker enrollment or biometric consent workflow.
- No Tencent real-time speaker separation production rollout.
- No desktop speaker-mapping UI unless needed for data inspection.

### Deferred Participant Notification Module

Participant selection is context only. Selecting a person as a meeting participant must not notify that person in phase one.

If the product later needs notifications, implement it as a separate meeting invitation module with explicit rules:

- Who can invite participants.
- Whether notification is sent when selecting participants, starting recording, or saving the meeting.
- Whether invited users can accept/decline.
- Whether the notification is Enterprise WeChat, in-app message, or both.
- Whether an invitation creates a meeting task or only a reminder.
- How to avoid duplicate notifications when participants are edited before recording.

### Phase Two POC

- Evaluate Tencent Cloud real-time speaker separation or recording-file speaker diarization.
- Use cloud output only to improve `发言人N` role stability.
- Keep manual mapping to real names as the approval step.

## Current Code Facts

- Mobile recording API currently creates meetings with only the current user:
  - `app/api/mobile/recordings/route.ts`
  - `participantIds: [currentUser.id]`
  - `participantCount: 1`
- Realtime transcript lines currently assign generic labels:
  - `components/mobile-minutes/MobileMinutesApp.tsx`
  - `speaker: 发言人1/2/3`
- Detail parsing currently normalizes speakers into generic labels:
  - `components/mobile-minutes/MinuteDetail.tsx`
  - `speakerName()`
- AI draft request already accepts participants:
  - `components/mobile-minutes/MobileMinutesApp.tsx`
  - `participantNames`
  - `lib/aiMeetingDraft.ts`
- Meeting participants are already persisted via `meeting_participants`.

## Data Model

Add speaker mapping to `Meeting`.

```ts
export interface MeetingSpeakerAssignment {
  speakerLabel: string;
  userId: string;
  assignedAt: string;
  assignedBy: string;
}
```

Extend `Meeting`:

```ts
speakerAssignments?: MeetingSpeakerAssignment[];
```

PostgreSQL migration:

```sql
alter table meetings
  add column if not exists speaker_assignments jsonb not null default '[]'::jsonb;
```

Reasoning:

- Keep the first version simple and meeting-scoped.
- Avoid a separate table until the workflow proves stable.
- JSONB is enough because mappings are small and read with the meeting.

## Task 1: Add Meeting Speaker Types

**Files:**

- Modify: `lib/types.ts`

**Steps:**

1. Add `MeetingSpeakerAssignment`.
2. Add optional `speakerAssignments?: MeetingSpeakerAssignment[]` to `Meeting`.
3. Run:

```powershell
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

## Task 2: Persist Speaker Assignments In DB

**Files:**

- Create: `database/migrations/008_meeting_speaker_assignments.sql`
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/dbStateStore.ts`

**Steps:**

1. Add `speaker_assignments jsonb not null default '[]'::jsonb` to `meetings`.
2. Update `upsertMeeting()` insert/update columns to write `meeting.speakerAssignments ?? []`.
3. Update `mapMeeting()` to read `speaker_assignments` as `speakerAssignments`.
4. Run:

```powershell
pnpm exec tsc --noEmit --pretty false
pnpm build
```

Expected: PASS.

## Task 3: Add Mobile Participant Picker State

**Files:**

- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `components/mobile-minutes/mobileMinutesTypes.ts`

**Steps:**

1. Add state:

```ts
const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
```

2. When `currentUser` changes, ensure current user is included.
3. Limit first version to current user plus selected directory users.
4. Add helper:

```ts
function normalizedParticipantIds(user?: MeetingUser, ids: string[] = []) {
  return [...new Set([user?.id, ...ids].filter((value): value is string => Boolean(value)))];
}
```

5. Run typecheck.

Expected: PASS.

## Task 4: Build Participant Picker UI Before Recording

**Files:**

- Create: `components/mobile-minutes/ParticipantPickerSheet.tsx`
- Modify: `components/mobile-minutes/RecordHome.tsx`
- Modify: `components/mobile-minutes/MobileMinutes.module.css`

**UI Behavior:**

- On record home, add a compact row under the record card:

```text
会议人员  当前 3 人  [调整]
```

- Tapping `调整` opens a bottom sheet.
- Search by name, title, employee number, department.
- Current user is selected and cannot be removed.
- Other selected users can be toggled.
- Bottom action: `确定`.

**Acceptance:**

- Text does not overflow at 390px width.
- Search list works with backend real user directory.
- User can start recording without opening the sheet.

## Task 5: Send Participant IDs To Mobile Recording API

**Files:**

- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `app/api/mobile/recordings/route.ts`

**Steps:**

1. Extend `MobileRecordingUpload`:

```ts
participantIds?: string[];
```

2. Append to upload `FormData`:

```ts
formData.append("participantIds", JSON.stringify(input.participantIds ?? []));
```

3. In `POST /api/mobile/recordings`, parse and sanitize participant IDs:

```ts
const rawParticipantIds = formString(formData, "participantIds");
const requestedParticipantIds = safeParseStringArray(rawParticipantIds);
const participantIds = [...new Set([currentUser.id, ...requestedParticipantIds])];
```

4. Use:

```ts
participantIds,
participantCount: participantIds.length
```

5. Run typecheck/build.

Expected: PASS.

## Task 6: Show Participants In Minute Detail

**Files:**

- Modify: `components/mobile-minutes/MinuteDetail.tsx`
- Modify: `components/mobile-minutes/MobileMinutes.module.css`

**Steps:**

1. Resolve participant names from `meeting.participantIds`.
2. Add compact participant row below the info card or in the existing info area.
3. Keep the existing `参会` count.
4. Use chips or compact text:

```text
参会人员：张三、李四、王五
```

Expected:

- Long participant lists wrap cleanly.
- No layout overlap.

## Task 7: Extract Speaker Labels From Transcript

**Files:**

- Modify: `components/mobile-minutes/MinuteDetail.tsx`

**Steps:**

1. Keep `parseTranscript()` as the source for displayed lines.
2. Build unique labels from parsed transcript:

```ts
const speakerLabels = [...new Set(transcriptItems.map((item) => item.speaker))];
```

3. Exclude empty labels.
4. Preserve label order from transcript.

Expected:

- Existing transcripts still render.
- Labels include `发言人1/发言人2/...`.

## Task 8: Add Speaker Mapping UI

**Files:**

- Create: `components/mobile-minutes/SpeakerAssignmentSheet.tsx`
- Modify: `components/mobile-minutes/MinuteDetail.tsx`
- Modify: `components/mobile-minutes/MobileMinutes.module.css`

**UI Behavior:**

- Add a `发言人标注` button in the transcript tab.
- Open bottom sheet:

```text
发言人1 -> [选择参会人员]
发言人2 -> [选择参会人员]
```

- Candidate list is limited to `meeting.participantIds`.
- Allow `未确定`.
- Save button writes assignments.

**Acceptance:**

- If no participants beyond current user, show empty-state text and allow closing.
- If transcript has no speaker labels, hide the button.
- Button text after save can show `已标注 N 人`.

## Task 9: Persist Speaker Mapping

**Files:**

- Create: `app/api/meetings/[meetingId]/speaker-assignments/route.ts`
- Modify: `lib/dbWriteStore.ts` or add a small write helper.
- Modify: `lib/localStateStore.ts` only if local mode needs fallback.
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`

**API Contract:**

```http
PUT /api/meetings/:meetingId/speaker-assignments
```

Request:

```json
{
  "assignments": [
    { "speakerLabel": "发言人1", "userId": "emp-xxx" }
  ]
}
```

Rules:

- Current user must be meeting host, creator, participant, manager with visibility, or president.
- `userId` must be in `meeting.participantIds`.
- Empty assignments are allowed to clear mapping.

Response:

```json
{ "meeting": { ...updatedMeeting } }
```

**Verification:**

```powershell
pnpm exec tsc --noEmit --pretty false
pnpm build
```

Expected: PASS.

## Task 10: Apply Speaker Mapping In Transcript Display

**Files:**

- Modify: `components/mobile-minutes/MinuteDetail.tsx`

**Steps:**

1. Build map:

```ts
const assignedNameBySpeaker = new Map(
  (meeting?.speakerAssignments ?? []).map((item) => [item.speakerLabel, userName(item.userId)])
);
```

2. Render:

```text
00:12 · 张三
```

3. Preserve original label as fallback:

```text
00:12 · 发言人1
```

4. Optional small sublabel:

```text
发言人1
```

Expected:

- Existing transcripts without mapping look unchanged.
- Mapped transcripts show real names.

## Task 11: Apply Mapping To AI Draft Context

**Files:**

- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`

**Steps:**

1. When building transcript for AI, replace mapped labels before sending.
2. Keep participant names from `participantIds`.
3. Add a short note in request context if needed:

```text
已人工标注发言人：发言人1=张三；发言人2=李四
```

Current `generateMeetingDraft()` already accepts `participantNames`; do not change backend AI prompt unless the first test shows it ignores mapped names.

Expected:

- AI draft has better owner/person references.
- No regression for meetings without speaker mappings.

## Task 12: Browser Verification

**Commands:**

```powershell
pnpm exec tsc --noEmit --pretty false
pnpm build
```

Start preview:

```powershell
$env:PORT='3032'; pnpm start
```

Manual checks at:

```text
http://127.0.0.1:3032/mobile-minutes
```

Verify:

- Start page shows meeting participants control.
- Current user is selected and cannot be removed.
- Add two participants, record a short meeting, end recording.
- Created meeting has correct `participantIds`.
- Detail page shows participants.
- Transcript tab can map `发言人1` to a participant.
- Mapping persists after refresh/reopen.
- AI draft generation still works.

## Task 13: Phase Two POC Plan For Automatic Speaker Separation

**Files:**

- Create after phase one if needed: `docs/plans/YYYY-MM-DD-tencent-speaker-diarization-poc.md`

**POC Questions:**

- Does Tencent Cloud realtime speaker separation return stable speaker roles in phone meeting recordings?
- Does it require a different WebSocket endpoint from current realtime ASR?
- Does recording-file recognition with `SpeakerDiarization` work better for post-meeting correction?
- What happens with overlapping voices, background noise, and 3+ people?
- Does it return role labels only, or support known-person identity?

**Expected Product Decision:**

Even if automatic role separation works, keep manual mapping to real company users before showing real names as final.

## Deployment Notes

Do not deploy until:

- Local typecheck and build pass.
- Mobile browser smoke test passes.
- User confirms the speaker mapping UX.
- Existing mobile management board and recording upload flow are still working.

When deploying, include:

- Migration `008_meeting_speaker_assignments.sql`.
- Backend speaker assignment API.
- Mobile participant picker and speaker assignment UI.
- Any server-side source changes needed for meeting read/write.

## Suggested Commit Order

```powershell
git add lib/types.ts database/migrations/008_meeting_speaker_assignments.sql lib/dbStateStore.ts lib/dbWriteStore.ts
git commit -m "feat: persist meeting speaker assignments"

git add components/mobile-minutes mobileMinutesApi.ts app/api/mobile/recordings/route.ts
git commit -m "feat: add mobile meeting participant selection"

git add app/api/meetings/[meetingId]/speaker-assignments/route.ts components/mobile-minutes
git commit -m "feat: map transcript speakers to participants"

git add docs/plans/2026-07-04-mobile-speaker-attribution.md
git commit -m "docs: plan mobile speaker attribution"
```
