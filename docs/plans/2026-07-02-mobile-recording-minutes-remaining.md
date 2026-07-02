# Mobile Recording Minutes Remaining Work Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the mobile recording-to-minutes workflow so recording ends quickly, live ASR draft appears immediately, cloud transcription finalizes in the background, and AI minutes generation has clear feedback.

**Architecture:** Keep the current Next.js mobile frontend and Tencent Cloud backend. First validate the optimistic frontend draft already pushed in `27728fa`; then move cloud transcription from a synchronous upload request into an explicit backend transcription status flow. Keep Tencent credentials server-side only.

**Tech Stack:** Next.js App Router, React client components, TypeScript, CSS Modules, existing `/backend-api` proxy, Tencent Cloud ASR, Dockerized Tencent Cloud backend.

---

## Current State

- Mobile app: `components/mobile-minutes/`
- Recording upload helper: `components/mobile-minutes/mobileMinutesApi.ts`
- Recording state and upload flow: `components/mobile-minutes/MobileMinutesApp.tsx`
- Detail UI: `components/mobile-minutes/MinuteDetail.tsx`
- Recording upload API: `app/api/mobile/recordings/route.ts`
- Tencent ASR helper: `lib/tencentAsr.ts`
- Latest optimistic frontend commit: `27728fa Show recording draft before cloud transcription`

## Non-Goals

- Do not expose Tencent `SecretKey` to the frontend.
- Do not implement speaker diarization before the current recording/transcription loop is stable.
- Do not remove recording-file ASR; it remains the final refinement path.
- Do not auto-submit generated minutes to approval without user confirmation.

## Task 1: Verify Cloudflare Deployment

**Files:**
- No source changes.

**Step 1: Check public static bundle**

Run:

```powershell
$html = (Invoke-WebRequest -UseBasicParsing 'https://shayuguagua.dpdns.org/' -TimeoutSec 30).Content
$scripts = [regex]::Matches($html, 'src="([^"]+\.js[^"]*)"') | ForEach-Object { $_.Groups[1].Value }
$found = $false
foreach ($s in $scripts) {
  $url = if ($s.StartsWith('http')) { $s } else { 'https://shayuguagua.dpdns.org' + $s }
  $js = (Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 20).Content
  if ($js -like '*已先展示实时转写初稿*' -or $js -like '*云端精修转写已完成*' -or $js -like '*local-recording-*') {
    $found = $true
    break
  }
}
$found
```

Expected: `True`.

**Step 2: If false, trigger Cloudflare deployment**

Deploy `main` at or after commit `27728fa`.

**Step 3: Commit**

No commit required.

## Task 2: Phone Acceptance Test For Optimistic Detail

**Files:**
- No source changes unless acceptance fails.

**Step 1: Record 20-40 seconds**

Use text with clear action signals:

```text
张三负责明天下午前整理客户返水比例说明，李四复核心率数据异常原因，王五下周一前给出客户回访方案。
```

**Step 2: End recording**

Expected:

- App leaves recording screen quickly.
- Detail page opens.
- It shows live ASR draft.
- It shows cloud refinement status.

**Step 3: Wait for final transcript**

Expected:

- Detail page updates to final cloud transcript.
- Status says cloud refinement completed.

## Task 3: Make Backend Recording Upload Truly Async

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/api/mobile/recordings/route.ts`
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/dbStateStore.ts`
- Create: `database/migrations/006_recording_transcription_status.sql`

**Step 1: Add optional meeting fields**

Add to `Meeting`:

```ts
recordingStatus?: "uploading" | "transcribing" | "transcribed" | "failed";
recordingStatusMessage?: string;
recordingAsrProvider?: "tencent";
recordingAsrTaskId?: string;
recordingFinalizedAt?: string;
```

**Step 2: Add DB columns**

Migration shape:

```sql
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS recording_status text,
  ADD COLUMN IF NOT EXISTS recording_status_message text,
  ADD COLUMN IF NOT EXISTS recording_asr_provider text,
  ADD COLUMN IF NOT EXISTS recording_asr_task_id text,
  ADD COLUMN IF NOT EXISTS recording_finalized_at text;
```

**Step 3: Run build**

Run:

```powershell
pnpm build
pnpm exec tsc --noEmit --pretty false
```

Expected: both pass.

**Step 4: Commit**

```powershell
git add lib/types.ts database/migrations/006_recording_transcription_status.sql lib/dbWriteStore.ts lib/dbStateStore.ts
git commit -m "Add recording transcription status fields"
```

## Task 4: Add Recording Status API

**Files:**
- Create: `app/api/mobile/recordings/[meetingId]/status/route.ts`
- Modify if needed: `lib/dbStateStore.ts`

**Step 1: Implement GET route**

Route returns:

```json
{
  "meetingId": "string",
  "recordingStatus": "transcribing",
  "message": "云端精修中",
  "meeting": {}
}
```

**Step 2: Auth guard**

Use existing `getCurrentUser()` and return `401` when unauthenticated.

**Step 3: Test unauthenticated**

Run:

```powershell
curl.exe -sS -o NUL -w "%{http_code}" https://api.shayuguagua.dpdns.org/api/mobile/recordings/test/status
```

Expected: `401`.

**Step 4: Commit**

```powershell
git add app/api/mobile/recordings/[meetingId]/status/route.ts
git commit -m "Add mobile recording status API"
```

## Task 5: Return From Upload Before Cloud ASR Finishes

**Files:**
- Modify: `app/api/mobile/recordings/route.ts`
- Possibly modify: `lib/tencentAsr.ts`

**Step 1: Save meeting immediately**

In `POST /api/mobile/recordings`, after saving audio:

- Use provided realtime transcript as initial `rawTranscript/transcript`.
- Set `recordingStatus = "transcribing"`.
- Save meeting.
- Return meeting immediately.

**Step 2: Start background transcription**

In the Docker long-running backend, start async work after response-safe persistence:

```ts
void transcribeAndFinalizeRecording({ meetingId, storedPath, mimeType, currentUser });
```

The background worker should:

- Call Tencent ASR.
- On success, update meeting transcript and status.
- On failure, keep initial transcript and set `recordingStatus="failed"`.

**Step 3: Run build**

Run:

```powershell
pnpm build
pnpm exec tsc --noEmit --pretty false
```

Expected: both pass.

**Step 4: Commit**

```powershell
git add app/api/mobile/recordings/route.ts lib/tencentAsr.ts
git commit -m "Return recording upload before final ASR"
```

## Task 6: Poll Recording Status From Detail Page

**Files:**
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `components/mobile-minutes/MinuteDetail.tsx`

**Step 1: Add API helper**

```ts
export async function fetchMobileRecordingStatus(meetingId: string) {
  const response = await fetch(apiPath(`/api/mobile/recordings/${encodeURIComponent(meetingId)}/status`), { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "录音状态读取失败");
  return payload;
}
```

**Step 2: Poll while transcribing**

In `MobileMinutesApp.tsx`, when selected meeting has `recordingStatus === "transcribing"`:

- Poll every 2-3 seconds.
- Replace meeting when status is `transcribed`.
- Stop polling on `failed`.

**Step 3: Run build**

Run:

```powershell
pnpm build
pnpm exec tsc --noEmit --pretty false
```

Expected: both pass.

**Step 4: Commit**

```powershell
git add components/mobile-minutes/mobileMinutesApi.ts components/mobile-minutes/MobileMinutesApp.tsx components/mobile-minutes/MinuteDetail.tsx
git commit -m "Poll cloud transcription status in mobile detail"
```

## Task 7: Evaluate Direct Recording Upload

**Files:**
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `.env.production.example`
- Modify: backend CORS config if added.

**Step 1: Add optional upload base**

```ts
const RECORDING_UPLOAD_BASE = (process.env.NEXT_PUBLIC_RECORDING_UPLOAD_BASE || API_BASE).replace(/\/+$/, "");
```

Use it only for `/api/mobile/recordings`.

**Step 2: Add env example**

```env
NEXT_PUBLIC_RECORDING_UPLOAD_BASE=
```

**Step 3: Test with default**

Expected: behavior unchanged through `/backend-api`.

**Step 4: Test direct API**

Set:

```env
NEXT_PUBLIC_RECORDING_UPLOAD_BASE=https://api.shayuguagua.dpdns.org
```

Expected:

- Login/session works or a clear CORS/cookie issue is documented.

**Step 5: Commit only if direct upload is stable**

```powershell
git add components/mobile-minutes/mobileMinutesApi.ts .env.production.example
git commit -m "Allow direct recording upload endpoint"
```

## Acceptance Criteria

- Ending a recording opens detail quickly.
- Live draft is visible immediately.
- Cloud transcript finalization does not block the detail screen.
- Refreshing the page can still recover transcription status.
- Final transcript replaces the draft automatically.
- Generation button has visible progress/error feedback.
- Build and type checks pass for each shipped change.
- Tencent secrets remain server-side.
