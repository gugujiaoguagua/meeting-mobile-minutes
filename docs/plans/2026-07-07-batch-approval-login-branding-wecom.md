# AI 会议闭环批量通过、登录、品牌与企微投递优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按用户截图完成“我的待办全部通过”、新建会议按钮位置、企业微信收不到消息排查、账号登录入口、应用图标和指定两处 Demo 文案清理。

**Architecture:** 把批量通过做成服务端统一接口，PC 后台和手机端共用，避免两个前端各自循环调用导致状态不一致。登录体系新增独立账号层，但继续复用现有 `User` 权限和可见数据模型；企业微信投递优先修正用户到企业微信 userid 的映射，不改变现有 outbox 追踪机制。

**Tech Stack:** Next.js App Router, React, TypeScript, PostgreSQL, Docker Compose, 企业微信应用消息, 现有 `dbWriteStore` / `taskActions` / `wecom_message_outbox`。

---

## Scope Rules

- “一键通过”明确为 **当前可见待签批任务全部通过**，不是单条快捷按钮。
- Demo 文案清理本轮只改两处截图范围：
  - PC 左上角侧边栏品牌区：`AI 会议闭环系统 / 拉迷集团 Demo`
  - 企业微信 textcard 卡片：`拉迷集团 AI 会议闭环系统 Demo` 和下方 `本地 Demo` 描述
- 本轮不全面清理 README、历史文档、mock 数据中的 Demo。
- 账号体系需要数据库迁移，必须先本地验证再发布。
- 完成后按项目规则写回 `AI 工作流资产/09_memory`、`10_tasks/已完成`、`99_变更日志.md`。

---

### Task 1: 批量签批通过后端接口

**Files:**
- Create: `app/api/tasks/approval-batch/route.ts`
- Modify: `lib/dbWriteStore.ts`
- Modify: `lib/taskActions.ts` only if需要导出批量 helper
- Inspect: `app/api/tasks/[taskId]/approval/route.ts`
- Inspect: `lib/wecomTaskNotifications.ts`

**Steps:**

1. 新增 `POST /api/tasks/approval-batch`。
2. Request body:
   ```json
   { "taskIds": ["task-1", "task-2"], "action": "approve" }
   ```
3. 服务端要求当前用户有总裁签批权限，逐条复用现有 `approveTaskDb(currentUser, taskId)`。
4. 返回结构：
   ```ts
   {
     ok: true,
     approvedCount: number,
     failed: Array<{ taskId: string; error: string }>,
     state?: StateSnapshot
   }
   ```
5. 每条任务继续走现有 activity log 和企业微信签批结果通知，不绕过现有闭环。
6. 如果全部失败，返回 `400`；部分失败返回 `207` 或 `200 + failed`，前端展示失败条数。

**Verification:**
- 未登录调用返回 `401`。
- 非总裁用户调用返回 `403`。
- 总裁传入 2 条待签批任务后，任务进入 `in_closed_loop`，activity log 生成 `approve_task`。

---

### Task 2: PC 后台“我的待办”增加全部通过

**Files:**
- Modify: `app/page.tsx`

**Target UI:**
- 位置按截图 2：放在“我的待办”顶部统计区域右侧/待签批统计卡附近。
- 文案建议：`一键通过全部待签批`
- 二次确认：`确认通过当前可见的 X 条待签批？通过后会进入正式会议闭环台账。`

**Behavior:**
1. 只统计当前登录用户可见的 `approvalStatus === "pending_president_approval"` 待签批任务。
2. 当前筛选条件存在时，按钮作用于当前筛选后的待签批列表；无筛选则作用于全部可见待签批。
3. `X = 0` 时按钮 disabled。
4. 调用 `POST /api/tasks/approval-batch`。
5. 成功后合并后端状态并刷新通知/待办数量。

**Verification:**
- 总裁账号能看到按钮和待签批数量。
- 员工账号看不到或按钮 disabled。
- 批量通过后 PC “待签批”数量归零或减少。

---

### Task 3: 手机端“我的待办”增加全部通过

**Files:**
- Modify: `components/mobile-minutes/MobileTasks.tsx`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`

**Target UI:**
- 位置按截图 1：在 `待办` 页签 `签批 X` 的列表顶部，第一张任务卡上方或标题区域下方。
- 文案建议：`一键通过全部签批`
- 手机按钮必须不挤压卡片标题，保持 390px 宽度无横向滚动。

**Behavior:**
1. 只在 `签批` tab 且有待签批任务时显示。
2. 点击后确认：`确认通过全部 X 条待签批？`
3. 调用同一个 `POST /api/tasks/approval-batch`。
4. 成功后刷新移动端 state、消息和待办列表。

**Verification:**
- 390px 手机视口无横向滚动。
- 签批 tab 有 4 条时按钮显示数量。
- 点击取消不改变任务状态。

---

### Task 4: 新建会议手动添加待办按钮移动到底部

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/mobile-minutes/MobileBackendPanel.tsx`

**Target UI:**
- PC 后台新建会议：把 `手动添加待办` 从 `4. 会议待办事项` 标题右侧移动到待办列表底部、`5. 主管提交与总裁签批` 上方，即截图 4 红框位置。
- 手机端后台新建会议同样保持在待办列表底部，避免 PC 和手机行为不一致。

**Behavior:**
- 按钮功能不变：继续调用现有手动新增待办逻辑。
- 新增待办后滚动或定位仍保持用户可见，不要跳到页面顶部。

**Verification:**
- 生成 3 条待办后，按钮出现在第 3 条下方和提交签批模块上方。
- 点击后新增第 4 条待办。

---

### Task 5: 企业微信部分人员收不到消息排查与修复

**Files:**
- Inspect/Modify: `lib/wecomUserMap.ts`
- Inspect/Modify: `lib/wecomTaskNotifications.ts`
- Inspect/Modify: `lib/wecomOkrNotifications.ts`
- Inspect/Modify: `lib/wecomOrgSync.ts`
- Inspect/Modify: `lib/canonicalUsers.ts`
- Inspect: `app/api/wecom/outbox/route.ts`

**Known Symptom:**
- outbox 失败码 `81013 user & party & tag all invalid`
- 成功接收人为 `EthanLin`
- 失败接收人示例为 `zy25013`、`dd25005`

**Plan:**
1. 在线查询最近 `wecom_message_outbox` 失败记录，导出 `recipient_user_id`、`touser`、`error_code`。
2. 对失败人员查 `users` 表，确认是否有企业微信真实 userid 字段或同步来源字段。
3. 对比 `emp-*` 业务用户和企业微信 userid 的 canonical 映射。
4. 修复发送前解析逻辑：业务用户 ID -> canonical 用户 -> 企业微信 userid，禁止直接把工号、`emp-*` 或内部 id 当 `touser`。
5. 对没有企业微信 userid 或不在应用可见范围的人，outbox 标记为明确原因：`missing_wecom_userid` 或 `not_visible_to_agent`，不要只显示 81013。
6. 必要时补一个只读诊断接口或在“企微发送记录”里展示“系统账号 / 企业微信 userid / 失败原因”。

**Verification:**
- 对失败人重新触发发送或重试。
- 如果企业微信返回 `0 ok`，说明映射修复成功。
- 如果仍返回 81013，但 touser 已是真实企微 userid，则判断为应用 `your-agent-id` 可见范围问题，需要企业微信后台授权该人员。

---

### Task 6: 登录入口与账号管理一期

**Files:**
- Create: `database/migrations/009_user_accounts.sql`
- Create: `lib/accountAuth.ts`
- Create: `app/api/accounts/login/route.ts`
- Create: `app/api/accounts/logout/route.ts`
- Create: `app/api/accounts/me/route.ts`
- Create: `app/api/accounts/change-password/route.ts`
- Create: `app/api/accounts/route.ts`
- Modify: `lib/auth.ts`
- Modify: `app/api/auth/login/route.ts` only for compatibility deprecation
- Modify: `app/page.tsx`
- Modify: `components/mobile-minutes/MobileMinutesApp.tsx`
- Modify: `components/mobile-minutes/mobileMinutesApi.ts`

**Data Model:**
```sql
create table if not exists user_accounts (
  id text primary key,
  user_id text not null references users(id),
  username text not null unique,
  password_hash text not null,
  must_change_password boolean not null default false,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**Rules:**
1. 初始账号按用户姓名生成，初始密码 `123456`。
2. 密码必须 hash 存储，不能明文存库。
3. 登录成功写 httpOnly cookie，同一设备下次自动登录。
4. PC 和手机端启动时先调 `/api/accounts/me`。
5. 右上角只显示当前登录人姓名，不再给人名切换登录。
6. 总裁账号可在后端侧边栏 `企微发送记录` 下看到 `账号管理`。
7. 账号管理一期功能：列表、搜索、重置密码为 `123456`、禁用/启用、修改自己密码。

**Migration Bootstrap:**
- 迁移时从现有 `users` 表为每个可登录人员创建账号。
- 同名人员需要追加工号或员工号避免用户名冲突，例如 `曹梦圆-DD25005`。
- UI 可以显示“姓名”，但登录名必须唯一。

**Verification:**
- 新设备未登录访问 PC/手机显示登录页。
- 使用 `林昱辰 / 123456` 可登录总裁视角。
- 关闭浏览器再打开仍保持登录。
- 非总裁看不到账号管理。
- 修改密码后旧密码不能登录，新密码可以登录。

---

### Task 7: 应用图标接入

**Files:**
- Source asset: `D:\我的应用\会议应用\应用图标\ChatGPT Image 2026年7月7日 13_43_43.png`
- Create/Modify: `public/icon.png`
- Create/Modify: `public/favicon.ico` or `app/icon.png`
- Modify: `app/layout.tsx`
- Modify: `public/manifest.json` if present, otherwise create only if existing app already uses PWA metadata
- Modify: `app/page.tsx`
- Modify: `components/mobile-minutes/*` only if手机端头部有独立图标

**Plan:**
1. 复制图标到 `public/icon.png`。
2. 生成 favicon 尺寸图标，优先使用 Next `app/icon.png`。
3. `metadata.icons` 指向新图标。
4. 左侧品牌区替换旧默认图标为新图标。

**Verification:**
- 浏览器 tab 显示新图标。
- PC 左上角显示新图标。
- 手机端如果有应用头部图标，也显示新图标。

---

### Task 8: 指定两处 Demo 文案清理

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `lib/wecomConfig.ts` or notification card builder if textcard 文案来源在配置/通知模块
- Inspect/Modify: `lib/wecomTaskNotifications.ts`
- Inspect/Modify: `lib/wecomOkrNotifications.ts`
- Inspect/Modify: `app/api/wecom/deeplink/route.ts`

**Target Text:**
- PC 左上角：
  - 主标题：`AI 会议闭环`
  - 副标题：可去掉，或显示 `正式运行`
- 企业微信卡片：
  - 标题：`AI 会议闭环`
  - 描述：`用于会议沉淀、纪要生成、待办闭环和总裁驾驶舱。`

**Out of Scope:**
- 不批量清理 README、docs、mockData、历史交付包说明中的 Demo。

**Verification:**
- `https://your-domain.example.com/` 左上角不再显示 `拉迷集团 Demo`。
- 企业微信新发送卡片不再显示 `拉迷集团 AI 会议闭环系统 Demo` 和 `本地 Demo`。

---

### Task 9: 本地验证、发布和记录

**Commands:**
```powershell
cd "D:\我的应用\会议应用\拉迷集团AI会议闭环系统交付包_2026-06-21"
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File ".\deploy\new-meeting-publish-package.ps1"
```

**Tencent Verification:**
- `https://api.your-domain.example.com/api/health` returns ok.
- `https://your-domain.example.com/` returns 200.
- `https://your-domain.example.com/mobile-minutes` returns 200.
- 新登录页可访问。
- 总裁登录后能看到账号管理。
- PC 和手机端批量通过按钮可见且批量通过成功。
- 企业微信 outbox 中新消息对已映射人员返回 `errcode=0`。

**Asset Pack Writeback:**
- Add `AI 工作流资产/09_memory/YYYY-MM-DD_批量通过_登录账号_品牌企微修复发布.md`
- Add `AI 工作流资产/10_tasks/已完成/TASK-YYYY-MM-DD-XXX-批量通过_登录账号_品牌企微修复发布.md`
- Append `AI 工作流资产/99_变更日志.md`

---

## Suggested Execution Order

1. Task 8 and Task 7: 品牌名与图标，风险低。
2. Task 4: 手动添加待办位置，风险低。
3. Task 1-3: 批量通过，先后端再 PC/手机。
4. Task 5: 企业微信收不到消息，先诊断再修映射。
5. Task 6: 登录与账号管理，影响最大，单独验证。
6. Task 9: 全量构建、发布、线上验收、资产包记录。
