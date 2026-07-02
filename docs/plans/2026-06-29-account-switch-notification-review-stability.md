# Account Switch Notification Review Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复公网会议应用中总裁切换人员视角后数据看似丢失、消息中心为空、复核通过后页面状态不稳定的问题。

**Architecture:** 保留服务端真实登录态和权限过滤，但新增“总裁模拟查看人员”作为纯前端筛选，不再把总裁切换视角等同于重新登录其他人。任务和 OKR 写接口成功后以后端返回的 task 为准回填前端状态，消息中心拆清“我的消息”和“全量动态”。

**Tech Stack:** Next.js App Router, React state/hooks, TypeScript, PostgreSQL state store, existing `/api/state` and task/OKR APIs.

---

## Current Findings

- 当前公网数据库没有真丢数据：总裁 `/api/state` 返回 `stateScope=full`，`tasks=2`，`meetings=1`；`/api/okr/projects` 返回 `okrProjects=1`。
- 林娜、林美凤这类无关账号返回 0，是 `/api/state` 按当前登录人可见子集过滤后的结果。
- 顶部账号切换当前调用 `loginAsUser()`，会真正写登录 cookie 并刷新页面，不是“总裁查看某人的视角”。
- 消息中心 `visibleNotifications` 又按 `recipientIds` 过滤，导致总裁能看全量台账，但不一定能看发给推进人/复核人的消息。
- 普通任务和 OKR 状态保存后没有统一用后端返回值刷新前端；OKR 状态保存还没有检查 `response.ok`。

## Non-Goals

- 本阶段不迁移到 Cloudflare。
- 本阶段不改数据库 schema。
- 本阶段不重做权限系统。
- 本阶段不清空或重置线上数据。

---

### Task 1: Add Account Switch Regression Tests

**Files:**
- Create: `拉迷集团AI会议闭环系统交付包_2026-06-21/tests/account-switch-visibility.test.ts`
- Inspect: `拉迷集团AI会议闭环系统交付包_2026-06-21/package.json`

**Step 1: Inspect existing test command**

Run:

```powershell
Get-Content -LiteralPath 'D:\我的应用\会议应用\拉迷集团AI会议闭环系统交付包_2026-06-21\package.json'
```

Expected: identify whether this project already has `test`, `vitest`, or only `build`.

**Step 2: If test runner already exists, write a failing test**

Test intent:

- Total president data remains full after selecting a simulated user.
- Real login user and simulated view user are separate values.
- Selecting 林娜 as a simulated user must not replace full task state with empty visible state.

Use extracted pure helpers if available; otherwise write tests after Task 2 helper extraction.

**Step 3: If no test runner exists, skip test file and use build plus API smoke checks**

Document this as a verification limitation in the final implementation record.

---

### Task 2: Separate Real Login User From Simulated View User

**Files:**
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:1838`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2093`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2174`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:3198`

**Step 1: Introduce explicit state names**

Replace ambiguous `selectedUserId` usage with two concepts:

```ts
const [loginUserId, setLoginUserId] = useState("emp-zc25003");
const [viewUserId, setViewUserId] = useState("emp-zc25003");
```

Rules:

- `loginUserId` controls real `/api/auth/login` and server cookie.
- `viewUserId` controls pure UI filtering for “查看某人视角”.
- When a non-president really logs in, set both `loginUserId` and `viewUserId` to that user.
- When president is logged in, changing the view selector only updates `viewUserId`.

**Step 2: Split handlers**

Create two handlers:

```ts
function loginAsUser(userId: string) {
  // existing real login behavior
}

function viewAsUser(userId: string) {
  setViewUserId(userId);
  window.localStorage.setItem("meeting-loop-view-user", userId);
}
```

**Step 3: Protect full data while president is logged in**

When `activeAccount.id === "president"`, do not call `/api/auth/login` for ordinary view changes.

Expected behavior:

- Top-right current login remains 林昱辰/总裁视角.
- Page can show “正在查看：林娜”.
- `taskItems`, `meetingItems`, and `okrProjectItems` remain full.

**Step 4: Run build**

Run:

```powershell
corepack pnpm run build
```

Expected: build passes.

---

### Task 3: Make My Tasks Use View User For President Simulation

**Files:**
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:6311`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:6351`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:6384`

**Step 1: Change selected user resolution**

Current logic uses president account user instead of the selected user:

```ts
const selectedUser = account.id === "president" || account.id === "manager" ? accountUser : findUser(selectedUserId) ?? accountUser;
```

Change intended behavior:

```ts
const selectedUser = account.id === "president" ? findUser(viewUserId) ?? accountUser : account.id === "manager" ? accountUser : findUser(viewUserId) ?? accountUser;
```

Use the actual variable names introduced in Task 2.

**Step 2: Keep president work items separate**

Show two sections when president is viewing another user:

- “林昱辰的总裁待办”
- “正在查看：林娜的待办”

Do not merge simulated person’s tasks into president’s own action queue.

**Step 3: Verify manually**

Manual check:

1. Login as 总裁.
2. Open 我的待办.
3. View 林娜: should show empty because 林娜 has no related task, but top-level data should not disappear.
4. View 惠怀柱: should show relevant tasks and OKR.
5. Switch back 总裁: data still present.

---

### Task 4: Add Notification Modes

**Files:**
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:1159`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2123`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:3351`

**Step 1: Keep existing personal notification behavior**

Existing `recipientIds` filtering remains as “我的消息”.

**Step 2: Add president-only all activity mode**

For president, add a segmented control:

- 我的消息
- 全量动态

In “全量动态”, do not filter by `recipientIds`.

Implementation sketch:

```ts
const allNotifications = useMemo(
  () => (hasLoaded ? buildNotifications(visibleNotificationMeetings, visibleTasks, activityLogs) : []),
  [hasLoaded, visibleNotificationMeetings, visibleTasks, activityLogs]
);

const visibleNotifications = notificationMode === "all" && activeAccount.id === "president"
  ? allNotifications
  : allNotifications.filter((item) => isNotificationForUser(item, activeAccountUser.id));
```

**Step 3: Rename empty state**

When current filter has no messages, say “当前筛选下暂无消息”，not “无消息通知” in a way that suggests data loss.

**Step 4: Verify**

Manual check:

- 总裁 “我的消息” may be 0.
- 总裁 “全量动态” should show task approval and review activity derived notifications.
- 惠怀柱 “我的消息” should show assigned/review result notifications.

---

### Task 5: Use Server-Returned Task For Ordinary Task Writes

**Files:**
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2196`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2491`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2718`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2825`

**Step 1: Return JSON from `persistTaskAction`**

Change from fire-and-forget to parse the response:

```ts
async function persistTaskAction(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `${path} ${response.status}`);
  }
  return payload as { task?: Task };
}
```

**Step 2: Add helper to merge task**

```ts
function mergeServerTask(task?: Task) {
  if (!task) return;
  setTaskItems((current) => current.map((item) => (item.id === task.id ? task : item)));
  setMeetingItems((current) =>
    current.map((meeting) => ({
      ...meeting,
      tasks: meeting.tasks?.map((item) => (item.id === task.id ? task : item))
    }))
  );
}
```

**Step 3: Update submit/confirm/reject flows**

After optimistic UI update, call:

```ts
void persistTaskAction(path, body)
  .then(({ task }) => {
    mergeServerTask(task);
    setLocalDataError("");
  })
  .catch((error) => setLocalDataError(getSaveErrorMessage(error)));
```

**Step 4: Verify**

Manual check:

- Submit completed task for review.
- Login as reviewer.
- Confirm.
- Refresh.
- Status remains completed.

---

### Task 6: Use Server-Returned Task For OKR PDCA Writes

**Files:**
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2261`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2271`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/lib/okrDbStore.ts:448`

**Step 1: Check `response.ok`**

Change `persistOkrPdcaTaskStatus` to async and parse JSON:

```ts
async function persistOkrPdcaTaskStatus(...) {
  const response = await fetch(`/api/okr/pdca-tasks/${encodeURIComponent(pdcaTaskId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reviewTargetStatus, reviewAction, reviewRejectedReason, reviewRejectedItems })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "okr_save_failed");
  return payload as { task?: OkrPDCATask };
}
```

**Step 2: Merge returned OKR PDCA task**

Add:

```ts
function mergeServerOkrPdcaTask(task?: OkrPDCATask) {
  if (!task) return;
  applyOkrPdcaTaskPatch(task.id, task);
  const localId = `okr-task-${task.id}`;
  setOkrTaskStatusOverrides((current) => {
    const next = { ...current };
    delete next[localId];
    return next;
  });
}
```

**Step 3: Update submit/confirm/reject OKR flows**

On success:

```ts
void persistOkrPdcaTaskStatus(...)
  .then(({ task }) => {
    mergeServerOkrPdcaTask(task);
    setLocalDataError("");
  })
  .catch((error) => setLocalDataError(getSaveErrorMessage(error)));
```

**Step 4: Verify**

Manual check:

- Submit OKR PDCA as completed.
- Confirm as reviewer.
- Refresh.
- Task displays “已完成”, not “等待完成复核”.
- Progress history still shows all previous submissions.

---

### Task 7: Replace Misleading DB Error Copy

**Files:**
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2196`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2600`
- Modify: `拉迷集团AI会议闭环系统交付包_2026-06-21/app/page.tsx:2271`

**Step 1: Add centralized message helper**

```ts
function getSaveErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("forbidden")) return "保存失败：当前账号没有权限执行此操作。";
  if (message.includes("not_found")) return "保存失败：任务不存在或已被删除，请刷新后重试。";
  if (message.includes("not authenticated")) return "保存失败：登录已失效，请重新登录。";
  return "保存到数据库失败，请刷新后重试。";
}
```

**Step 2: Replace old copy**

Replace:

- “保存到项目文件失败”
- “待办删除保存到项目文件失败”

With database-aware copy.

**Step 3: Verify**

Manual check:

- Trigger forbidden action with non-reviewer account if possible.
- Error message should mention permission, not project file.

---

### Task 8: Add Public Smoke Script

**Files:**
- Create: `拉迷集团AI会议闭环系统交付包_2026-06-21/scripts/smoke-account-switch.mjs`

**Step 1: Write script**

Script should:

1. Login as 总裁.
2. Assert `/api/state` has `stateScope=full`.
3. Assert OKR projects count is at least 1 in current test dataset.
4. Login as 林娜.
5. Assert `/api/state` has `stateScope=visible`.
6. Login back as 总裁.
7. Assert full data still returns.

**Step 2: Run script against public URL**

Run:

```powershell
node scripts/smoke-account-switch.mjs http://localhost:3000
```

Expected:

```text
PASS president full state before switch
PASS limited user visible state
PASS president full state after switch
```

---

### Task 9: Build, Deploy, And Verify

**Files:**
- Modify only if needed: deployment package scripts already used by this project.
- Record: `D:\我的应用\会议应用\AI 工作流资产\09_memory\...`
- Record: `D:\我的应用\会议应用\AI 工作流资产\10_tasks\已完成\...`

**Step 1: Build locally**

Run:

```powershell
corepack pnpm run build
```

Expected: success.

**Step 2: Run local smoke checks**

Run:

```powershell
node scripts/smoke-account-switch.mjs http://localhost:<actual-port>
```

Expected: pass if local server is running against DB or matching local data.

**Step 3: Deploy to Tencent Cloud**

Use the existing project deployment process from the previous release records. Do not overwrite `.env`, `.env.local`, or database volumes.

**Step 4: Run public smoke checks**

Run:

```powershell
node scripts/smoke-account-switch.mjs http://localhost:3000
```

Expected: pass.

**Step 5: Manual browser verification**

Checklist:

- 总裁进入 OKR 项目，能看到 OKR 项目。
- 总裁选择查看林娜，页面明确显示“正在查看：林娜”，但数据不被清空。
- 切回总裁，OKR 仍在。
- 惠怀柱提交 OKR 已完成复核，总裁通过后，刷新仍显示已完成。
- 消息中心“我的消息”和“全量动态”语义清楚。

**Step 6: Write records**

Create:

- `D:\我的应用\会议应用\AI 工作流资产\09_memory\2026-06-29_账号切换模拟视角与复核状态稳定修复.md`
- `D:\我的应用\会议应用\AI 工作流资产\10_tasks\已完成\TASK-2026-06-29-152-账号切换模拟视角与复核状态稳定修复.md`

Update:

- `D:\我的应用\会议应用\AI 工作流资产\09_memory\00_项目记忆索引.md`
- `D:\我的应用\会议应用\AI 工作流资产\99_变更日志.md`

---

## Recommended Execution Order

1. Task 2: 先拆真实登录和模拟视角，这是“数据看似丢失”的主因。
2. Task 3: 让我的待办正确使用模拟视角。
3. Task 4: 修消息中心的“我的消息/全量动态”歧义。
4. Task 5 and Task 6: 修普通任务和 OKR 写入后的状态校准。
5. Task 7: 修错误文案。
6. Task 8 and Task 9: 加烟测、构建、部署、记录。

## Risk Notes

- 不要把 `/api/state` 改成所有人都返回 full；这会破坏权限边界。
- 不要在前端用空数组覆盖全量状态；这是之前账号切换丢数据问题的根源之一。
- 不要把 Cloudflare 迁移和本轮稳定性修复混在一起；平台迁移应作为第二阶段单独评估。

## Future Phase: Cloudflare Evaluation

当前问题应先在现有架构中修复。若后续迁移 Cloudflare，建议方向是：

- GitHub + Cloudflare Pages/Workers 用于代码发布。
- 数据放 Cloudflare D1、Durable Objects、R2，或继续用托管 PostgreSQL。
- 不建议正式数据只放本机；本机可通过 Cloudflare Tunnel 暴露，但稳定性取决于电脑、电源、网络和备份。
