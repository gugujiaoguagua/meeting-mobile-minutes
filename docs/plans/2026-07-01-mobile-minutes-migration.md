# Mobile Minutes Migration Implementation Plan

**Goal:** Add a production mobile meeting-minutes entry at `/mobile-minutes` inside the existing Next.js meeting app without changing the current root dashboard at `/`.

**Architecture:** Use the Figma/Vite prototype only as a visual and interaction reference. Rebuild the mobile flow as maintainable Next.js components under `components/mobile-minutes/`, then mount them from `app/mobile-minutes/page.tsx`. Keep the first pass as a static flow, then connect existing backend APIs.

**Tech Stack:** Next.js App Router, React client components, existing app CSS/theme, existing APIs: `/api/auth/me`, `/api/state`, `/api/ai/meeting-draft`, task action APIs.

---

## Task 1: Create Mobile Route

**Files:**

- Create: `app/mobile-minutes/page.tsx`
- Create: `components/mobile-minutes/MobileMinutesApp.tsx`

**Steps:**

1. Create `app/mobile-minutes/page.tsx`.
2. Export a server component that renders `MobileMinutesApp`.
3. Create `components/mobile-minutes/MobileMinutesApp.tsx` as a client component.
4. Render a temporary mobile shell with the text `AI 会议记录`.
5. Run `corepack pnpm run build`.
6. Verify `/` still renders the current dashboard and `/mobile-minutes` renders the new mobile shell.

## Task 2: Port Static Mobile Flow

**Files:**

- Create: `components/mobile-minutes/MobileShell.tsx`
- Create: `components/mobile-minutes/BottomNav.tsx`
- Create: `components/mobile-minutes/RecordHome.tsx`
- Create: `components/mobile-minutes/RecordingPanel.tsx`
- Create: `components/mobile-minutes/MinuteDetail.tsx`
- Create: `components/mobile-minutes/MobileMessages.tsx`
- Create: `components/mobile-minutes/MobileTasks.tsx`
- Create: `components/mobile-minutes/mobileMinutesTypes.ts`
- Create: `components/mobile-minutes/mobileMinutesMock.ts`
- Create: `components/mobile-minutes/MobileMinutes.module.css`

**Steps:**

1. Rebuild the prototype layout from `D:\我的应用\会议应用\会议应用移动端设计\src\app\App.tsx`.
2. Default `/mobile-minutes` to the record home, not the detail page.
3. Implement the record, messages, tasks, and profile tabs.
4. Implement recording state with a real frontend timer starting at `00:00:00`.
5. Implement detail tabs: summary, transcript, draft tasks.
6. Implement local generate state: pending -> generated.
7. Run `corepack pnpm run build`.
8. Manually verify the static flow end to end.

## Task 3: Add Backend State Loading

**Files:**

- Create: `components/mobile-minutes/mobileMinutesApi.ts`
- Create: `components/mobile-minutes/mobileMinutesMappers.ts`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `components/mobile-minutes/MobileMessages.tsx`
- Modify: `components/mobile-minutes/MobileTasks.tsx`

**Steps:**

1. Add `getCurrentUser()` for `GET /api/auth/me`.
2. Add `getMeetingState()` for `GET /api/state`.
3. Show an unauthenticated state when `/api/auth/me` returns `401`.
4. Map `activityLogs` into mobile message cards.
5. Map `tasks` into mine, review, and done tabs.
6. Use mock data only as a fallback during development, not when real state loads successfully.
7. Run `corepack pnpm run build`.
8. Verify messages and tasks reflect backend state.

## Task 4: Connect Meeting Draft Generation

**Files:**

- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MinuteDetail.tsx`
- Modify: `components/mobile-minutes/mobileMinutesTypes.ts`

**Steps:**

1. Add `generateMeetingDraft()` for `POST /api/ai/meeting-draft`.
2. Validate required fields before submit: `meetingId`, `title`, `departmentId`, `hostId`, `transcript`.
3. Show disabled state and reason when required fields are missing.
4. Show loading while generating.
5. Show returned summary, draft tasks, corrected transcript, and dictionary corrections.
6. Show error message on failure.
7. Run `corepack pnpm run build`.
8. Verify success and failure flows.

## Task 5: Connect Task Actions

**Files:**

- Modify: `components/mobile-minutes/mobileMinutesApi.ts`
- Modify: `components/mobile-minutes/MobileTasks.tsx`

**Steps:**

1. Match mobile buttons to existing task APIs.
2. Submit review from `我的待办`.
3. Approve or reject from `待我复核`.
4. Refresh `/api/state` after each successful action.
5. Show error messages without crashing the page.
6. Run `corepack pnpm run build`.
7. Verify task state changes are visible from both mobile and existing dashboard.

## Task 6: Deploy and Verify

**Files:**

- No new route outside the existing Next.js app.

**Steps:**

1. Build locally with `corepack pnpm run build`.
2. Use the existing Tencent Cloud deployment flow.
3. Verify the configured public base URL still opens the current dashboard.
4. Verify the configured public base URL opens the mobile flow.
5. Do not add a new port or server.
6. Do not enable mobile root redirect until the mobile flow is stable.
