"use client";

import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Filter,
  Home,
  Library,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  RotateCcw,
  Target,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  UsersRound
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { meetings as seedMeetings, tasks as seedTasks } from "@/lib/mockData";
import {
  defaultMeetingDepartmentId,
  defaultMeetingHostId,
  departmentOptionLabel,
  departmentSearchText,
  departments,
  realDepartments,
  realUsers,
  userOptionLabel,
  userSearchText,
  users
} from "@/lib/orgPeopleData";
import type { OkrKR, OkrKrStatus, OkrPDCATask, OkrPdcaStage, OkrPriority, OkrProject, OkrProjectStatus, OkrRiskLevel, OkrTaskStatus, OkrMetricStatus } from "@/lib/okrTypes";
import { canViewOkrProject as canViewOkrProjectForUser } from "@/lib/permission";
import type { ActivityLog, ApprovalStatus, Meeting, MeetingDecision, MeetingStatus, MeetingType, PageKey, Priority, Task, TaskProgressEntry, TaskStatus, User } from "@/lib/types";

const STORAGE_KEY = "lami-meeting-loop-clean-v2";
const CURRENT_USER_STORAGE_KEY = "lami-meeting-loop-current-user-id";
const VIEW_USER_STORAGE_KEY = "lami-meeting-loop-view-user-id";
const THEME_STORAGE_KEY = "lami-meeting-loop-theme";
const NOTIFICATION_READ_STORAGE_KEY = "lami-meeting-loop-notification-read-ids";
const ENABLE_DEEPSEEK_DRAFT = process.env.NEXT_PUBLIC_ENABLE_DEEPSEEK_DRAFT !== "0";
const MEETING_SOURCE_TEMPLATE_NAME = "会议闭环系统会议纪要模板.md";
const MEETING_SOURCE_TEMPLATE_VERSION = "V1.0";

function getUserScopedStorageKey(baseKey: string, userId: string) {
  return `${baseKey}:${userId}`;
}

function removeUserScopedStorageEntries(baseKey: string) {
  const prefix = `${baseKey}:`;
  const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  keys.forEach((key) => window.localStorage.removeItem(key));
}

type UiTheme = "light" | "dark";
type TestAccountRole = "president" | "manager" | "employee";

type TestAccount = {
  id: TestAccountRole;
  label: string;
  userId: string;
  roleLabel: string;
  description: string;
  hiddenPages: PageKey[];
};

type StateApiResponse = {
  updatedAt?: string;
  savedAt?: string;
  meetings?: Meeting[];
  tasks?: Task[];
  activityLogs?: ActivityLog[];
  notificationReadIds?: string[];
  stateScope?: "full" | "visible";
};

type OkrProjectsApiResponse = {
  projects?: OkrProject[];
  project?: OkrProject;
  deleted?: boolean;
  projectId?: string;
  error?: string;
};

type AuthUserResponse = {
  user?: User;
};

type WecomOutboxStatus = "pending" | "sent" | "failed" | "skipped";
type WecomOutboxEventType =
  | "task_review_submitted"
  | "task_review_confirmed"
  | "task_review_rejected"
  | "meeting_approval_submitted"
  | "task_approval_approved"
  | "task_approval_rejected"
  | "meeting_approval_rejected"
  | "okr_project_created"
  | "okr_pdca_review_submitted"
  | "okr_pdca_review_confirmed"
  | "okr_pdca_review_rejected";

type WecomOutboxItem = {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  recipientUserId?: string;
  recipientName?: string;
  touser: string;
  agentid: number;
  title: string;
  status: WecomOutboxStatus;
  errcode?: number;
  errmsg?: string;
  invaliduser?: string;
  msgid?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};

type WecomOutboxResponse = {
  items?: WecomOutboxItem[];
  summary?: Array<{ status: WecomOutboxStatus; count: number }>;
  eventSummary?: Array<{ eventType: WecomOutboxEventType; count: number }>;
  total?: number;
  error?: string;
};

type WecomOutboxRetryResponse = {
  item?: WecomOutboxItem;
  result?: {
    errcode?: number;
    errmsg?: string;
    invaliduser?: string;
    msgid?: string;
  };
  retried?: boolean;
  error?: string;
};

type MeetingDraftApiResponse = {
  aiSummary: string;
  minuteMarkdown?: string;
  decisions: MeetingDecision[];
  tasks: Task[];
  provider?: string;
  model?: string;
  correctedTranscript?: string;
  dictionaryCorrections?: Array<{ standard: string; variant: string; count: number }>;
};

type MeetingDictionaryEntry = {
  id: string;
  standard: string;
  variants: string;
  category: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

type MeetingDictionaryResponse = {
  entries?: MeetingDictionaryEntry[];
  entry?: MeetingDictionaryEntry;
  deleted?: boolean;
  error?: string;
};

type MeetingFileTextApiResponse = {
  fileName: string;
  text: string;
  sourceType: "txt" | "docx";
  warnings?: string[];
  error?: string;
  detail?: string;
};

type UploadedMeetingFile = {
  id: string;
  name: string;
  text: string;
  sourceType?: "txt" | "docx";
  status: "read" | "name_only";
};

const meetingTypes: MeetingType[] = ["门店周会", "研发会议", "售后复盘", "AI项目会议", "经营例会", "培训会议"];
const taskStatuses: TaskStatus[] = ["not_started", "in_progress", "pending_review", "completed", "blocked"];
const priorities: Priority[] = ["高", "中", "低"];
const pdcaStages: OkrPdcaStage[] = ["Plan", "Do", "Check", "Act"];
type DashboardPeriod = "last_week" | "this_week" | "last_month" | "this_month";
type DepartmentDrillType = "total" | "completed" | "remaining" | "overdue" | "meetings" | "duration" | "manhours";
const DEPARTMENT_PAGE_SIZE = 10;

const dashboardPeriods: Array<{ key: DashboardPeriod; label: string }> = [
  { key: "last_week", label: "上周" },
  { key: "this_week", label: "本周" },
  { key: "last_month", label: "上个月" },
  { key: "this_month", label: "本月" }
];

const navItems: Array<{ key: PageKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "notifications", label: "消息通知", icon: Bell },
  { key: "new-meeting", label: "新建会议", icon: Plus },
  { key: "dashboard", label: "管理驾驶舱", icon: LayoutDashboard },
  { key: "meetings", label: "会议列表", icon: FileText },
  { key: "meeting-summaries", label: "会议纪要汇总", icon: Library },
  { key: "tasks", label: "待办总台账", icon: ClipboardList },
  { key: "my-tasks", label: "我的待办", icon: ListChecks },
  { key: "departments", label: "部门看板", icon: Building2 },
  { key: "dictionary", label: "会议词典", icon: Library },
  { key: "kr-projects", label: "OKR 项目", icon: Target },
  { key: "wecom-outbox", label: "企微发送记录", icon: Send }
];

function getAccountRoleForUser(user: User): TestAccountRole {
  if (user.role === "总裁") return "president";
  if (user.role === "部门负责人") return "manager";
  return "employee";
}

function createAccountForUser(user: User): TestAccount {
  const role = getAccountRoleForUser(user);
  if (role === "president") {
    return {
      id: "president",
      label: "总裁账号",
      userId: user.id,
      roleLabel: "总裁视角",
      description: "全部页面可见，可使用所有演示功能。",
      hiddenPages: []
    };
  }
  if (role === "manager") {
    return {
      id: "manager",
      label: "管理者账号",
      userId: user.id,
      roleLabel: "管理者视角",
      description: "隐藏管理驾驶舱和会议列表，聚焦消息、纪要汇总、我的待办与部门看板。",
      hiddenPages: ["dashboard", "meetings", "wecom-outbox"]
    };
  }
  return {
    id: "employee",
    label: "员工账号",
    userId: user.id,
    roleLabel: "员工视角",
    description: "隐藏新建会议、管理驾驶舱、会议列表、总台账、部门看板和 OKR。",
    hiddenPages: ["new-meeting", "dashboard", "meetings", "tasks", "departments", "kr-projects", "wecom-outbox"]
  };
}

function canAccessPage(account: TestAccount, page: PageKey) {
  return !account.hiddenPages.includes(page);
}

function getAccountUser(account: TestAccount) {
  return findUser(account.userId) ?? users[0];
}

function getUserDepartmentId(userId?: string) {
  return userId ? findUser(userId)?.departmentId : undefined;
}

function getPresidentUserId() {
  return users.find((user) => user.role === "总裁")?.id ?? "emp-zc25003";
}

function isPresidentUser(userId?: string) {
  return Boolean(userId && userId === getPresidentUserId());
}

function uniqueIds(ids: Array<string | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

type NotificationTone = "blue" | "green" | "red" | "amber";

type NotificationItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  time: string;
  tone: NotificationTone;
  meetingId?: string;
  taskId?: string;
  actor?: string;
  actorId?: string;
  recipientIds?: string[];
};

type TaskSourceFilter = "全部" | "会议待办" | "OKR任务" | "KR复核";

const taskSourceFilters: TaskSourceFilter[] = ["全部", "会议待办", "OKR任务", "KR复核"];

type OkrOverviewMetricKey = "krs" | "pdca" | "delayed" | "blocked" | "highRisk" | "president" | "meetings" | "tasks";
type OkrPortfolioMetricKey = "projects" | "krs" | "pdca" | "running" | "highRisk" | "delayedBlocked" | "president";

const okrProjectSeeds: OkrProject[] = [
  {
    id: "okr-designer-efficiency-2026",
    name: "设计师下单效率提升30%项目",
    category: "经营改进 OKR",
    objective: "设计师整体下单效率提升 >=30%，下单准确率与安装成功率达到 >=90%，建立规范、培训、协同、监督的全闭环流程体系。",
    background: "当前核心痛点集中在软件画图、设计与画图售后问题，以及设计师能力、工艺规范和产品配套标准需要提升。项目需要运营管理部、直营审核组、IT部、产品研发部、安装/客户服务部、工厂部等跨部门协同推进。",
    owner: "曹梦圆",
    ownerDepartment: "直营审核组",
    collaboratorDepartments: ["运营管理部", "IT部", "产品研发部", "安装/客户服务部", "工厂部"],
    startDate: "2026-06-18",
    endDate: "2026-09-30",
    periodText: "2026/6/18 - 2026/9/30",
    priority: "高",
    riskLevel: "高",
    status: "进行中",
    progress: 36,
    needPresidentDecisionCount: 2,
    metrics: [
      { label: "设计师平均下单耗时", base: "当前平均 58 分钟/单", target: "效率提升 >=30%", current: "已提升 12%", status: "进行中" },
      { label: "下单准确率", base: "79.11%", target: "90%", current: "83.6%", status: "进行中" },
      { label: "安装成功率", base: "78.92%", target: "90%", current: "82.4%", status: "有风险" },
      { label: "售后金额", base: "按 5 月售后金额为基准", target: "降低 20%-30%", current: "降低 8%", status: "进行中" }
    ],
    krs: [
      {
        id: "okr-designer-kr1",
        projectId: "okr-designer-efficiency-2026",
        code: "KR1",
        title: "建立标准下单体系",
        description: "统一下单附图、签字图纸、审单与下单规范，减少设计师自由发挥造成的错漏。",
        metric: "输出并落地 4 套标准文件，门店使用覆盖率达到 90%。",
        targetValue: "4 套标准文件",
        currentValue: "2 套草案",
        weight: 25,
        owner: "曹梦圆",
        department: "直营审核组",
        startDate: "2026-06-18",
        endDate: "2026-07-18",
        progress: 45,
        status: "进行中",
        riskLevel: "中"
      },
      {
        id: "okr-designer-kr2",
        projectId: "okr-designer-efficiency-2026",
        code: "KR2",
        title: "落地阶梯式培训体系",
        description: "新人设计师赋能与全员设计师能力进阶，形成培训、考核、现场学习与互检机制。",
        metric: "完成新人班、进阶班、门店互检机制并形成考核记录。",
        targetValue: "3 类培训机制",
        currentValue: "新人班已启动",
        weight: 20,
        owner: "蔡志文",
        department: "培训部",
        startDate: "2026-06-24",
        endDate: "2026-08-15",
        progress: 30,
        status: "进行中",
        riskLevel: "低"
      },
      {
        id: "okr-designer-kr3",
        projectId: "okr-designer-efficiency-2026",
        code: "KR3",
        title: "软件 / 产品需求收集与优化",
        description: "每月调研门店，输出需求池，推动模块参数优化和新品资料同步。",
        metric: "每月输出需求池，完成高频问题前 10 项优化。",
        targetValue: "10 项优化",
        currentValue: "3 项推进中",
        weight: 20,
        owner: "李文",
        department: "IT部",
        startDate: "2026-06-20",
        endDate: "2026-09-10",
        progress: 28,
        status: "进行中",
        riskLevel: "高"
      },
      {
        id: "okr-designer-kr4",
        projectId: "okr-designer-efficiency-2026",
        code: "KR4",
        title: "监督与防错提升闭环",
        description: "错单数据周/月统计、案例库更新、海报公示、知识库推广、问题闭环复盘。",
        metric: "每周输出错单看板，每月完成 1 次复盘并更新案例库。",
        targetValue: "12 周看板",
        currentValue: "2 周看板",
        weight: 20,
        owner: "美凤",
        department: "运营管理部",
        startDate: "2026-06-28",
        endDate: "2026-09-20",
        progress: 18,
        status: "进行中",
        riskLevel: "中"
      },
      {
        id: "okr-designer-kr5",
        projectId: "okr-designer-efficiency-2026",
        code: "KR5",
        title: "交付质量与后端协同提升",
        description: "把安装成功率、下单准确率和售后金额纳入同一条协同链路。",
        metric: "安装成功率 >=90%，下单准确率 >=90%，售后金额降低 20%-30%。",
        targetValue: "3 项指标达标",
        currentValue: "存在安装端协同卡点",
        weight: 15,
        owner: "蒋文轩",
        department: "安装/客户服务部",
        startDate: "2026-07-01",
        endDate: "2026-09-30",
        progress: 12,
        status: "阻塞中",
        riskLevel: "高"
      }
    ],
    pdcaTasks: [
      { id: "designer-p1", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr1", pdcaStage: "Plan", title: "梳理现有下单错漏案例", content: "按门店、设计师、产品类型归集近 30 天下单错漏案例。", owner: "曹梦圆", ownerDepartment: "直营审核组", collaboratorDepartments: ["直营门店", "售后部"], startDate: "2026-06-18", endDate: "2026-06-24", deliverable: "《下单错漏案例清单》", status: "已完成", riskLevel: "低" },
      { id: "designer-d1", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr1", pdcaStage: "Do", title: "输出下单附图标准", content: "形成下单附图、签字图纸、审单下单规范初稿。", owner: "曹梦圆", ownerDepartment: "直营审核组", collaboratorDepartments: ["设计部"], startDate: "2026-06-25", endDate: "2026-07-05", deliverable: "《下单附图标准》初稿", status: "进行中", riskLevel: "中" },
      { id: "designer-c1", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr1", pdcaStage: "Check", title: "抽检 20 单标准执行结果", content: "对照新规范抽查门店下单文件是否完整。", owner: "美凤", ownerDepartment: "运营管理部", collaboratorDepartments: ["直营审核组"], startDate: "2026-07-06", endDate: "2026-07-12", deliverable: "《标准执行抽检记录》", status: "未开始", riskLevel: "低" },
      { id: "designer-a1", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr1", pdcaStage: "Act", title: "发布正式规范并纳入培训", content: "根据抽检结果修订规范，发文并进入新人培训课件。", owner: "蔡志文", ownerDepartment: "培训部", collaboratorDepartments: ["直营审核组"], startDate: "2026-07-13", endDate: "2026-07-18", deliverable: "正式规范与培训课件", status: "未开始", riskLevel: "低" },
      { id: "designer-p2", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr2", pdcaStage: "Plan", title: "设计师能力分层", content: "按新人、熟练、骨干三类建立培训对象名单。", owner: "蔡志文", ownerDepartment: "培训部", collaboratorDepartments: ["直营门店"], startDate: "2026-06-24", endDate: "2026-06-30", deliverable: "《设计师能力分层名单》", status: "已完成", riskLevel: "低" },
      { id: "designer-d2", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr2", pdcaStage: "Do", title: "组织新人设计师训练营", content: "集中训练标准绘图、下单规范和案例纠错。", owner: "蔡志文", ownerDepartment: "培训部", collaboratorDepartments: ["直营审核组"], startDate: "2026-07-01", endDate: "2026-07-20", deliverable: "训练营签到、考核与错题记录", status: "进行中", riskLevel: "低" },
      { id: "designer-p3", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr3", pdcaStage: "Plan", title: "建立软件需求池", content: "收集门店三维家、产品资料和模块参数问题。", owner: "李文", ownerDepartment: "IT部", collaboratorDepartments: ["设计部", "产品研发部"], startDate: "2026-06-20", endDate: "2026-06-28", deliverable: "《软件与产品需求池》", status: "已延期", riskLevel: "高" },
      { id: "designer-d3", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr3", pdcaStage: "Do", title: "推进高频模块参数优化", content: "优先优化高频出错模块，降低设计师重复调整。", owner: "李文", ownerDepartment: "IT部", collaboratorDepartments: ["产品研发部"], startDate: "2026-06-29", endDate: "2026-07-20", deliverable: "三维家参数优化记录", status: "进行中", riskLevel: "高" },
      { id: "designer-c4", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr4", pdcaStage: "Check", title: "错单周看板复核", content: "每周复核错单来源，定位培训、标准或系统原因。", owner: "美凤", ownerDepartment: "运营管理部", collaboratorDepartments: ["培训部", "售后部"], startDate: "2026-07-01", endDate: "2026-09-20", deliverable: "错单周看板", status: "进行中", riskLevel: "中" },
      { id: "designer-a5", projectId: "okr-designer-efficiency-2026", krId: "okr-designer-kr5", pdcaStage: "Act", title: "安装问题闭环复盘", content: "把安装失败案例回流到设计和下单标准中。", owner: "蒋文轩", ownerDepartment: "安装/客户服务部", collaboratorDepartments: ["设计部", "直营审核组"], startDate: "2026-07-10", endDate: "2026-09-30", deliverable: "安装问题闭环复盘表", status: "阻塞中", riskLevel: "高" }
    ],
    relatedMeetings: [
      { id: "dm1", title: "设计师下单效率 OKR 启动会", date: "2026-06-18", host: "曹梦圆", decision: "以审核标准和培训机制作为第一阶段突破口。", todoCount: 4, status: "已进入闭环" },
      { id: "dm2", title: "软件需求池评审会", date: "2026-06-25", host: "李文", decision: "高频参数问题优先进入三维家优化排期。", todoCount: 3, status: "待总裁签批" }
    ],
    relatedTasks: [
      { id: "dt1", content: "完成软件与产品需求池第一版", krId: "okr-designer-kr3", sourceMeeting: "软件需求池评审会", owner: "李文", ownerDepartment: "IT部", collaboratorDepartments: ["产品研发部"], dueDate: "2026-06-28", status: "已延期", riskLevel: "高" },
      { id: "dt2", content: "新人设计师训练营完成首轮考核", krId: "okr-designer-kr2", sourceMeeting: "设计师下单效率 OKR 启动会", owner: "蔡志文", ownerDepartment: "培训部", collaboratorDepartments: ["直营审核组"], dueDate: "2026-07-20", status: "进行中", riskLevel: "低" },
      { id: "dt3", content: "安装问题闭环复盘表形成月度版", krId: "okr-designer-kr5", sourceMeeting: "售后协同会", owner: "蒋文轩", ownerDepartment: "安装/客户服务部", collaboratorDepartments: ["设计部"], dueDate: "2026-07-31", status: "阻塞中", riskLevel: "高" }
    ],
    risks: [
      { id: "dr1", description: "软件需求池延期，影响 KR3 高频参数优化节奏。", krId: "okr-designer-kr3", departments: ["IT部", "产品研发部"], riskLevel: "高", impact: "设计师仍需重复手动调整参数，效率提升幅度受限。", suggestion: "由总裁确认 IT 与产品研发的优先级，锁定第一批高频模块。", needPresidentCoordination: true },
      { id: "dr2", description: "安装问题回流机制未打通。", krId: "okr-designer-kr5", departments: ["安装/客户服务部", "设计部"], riskLevel: "高", impact: "安装失败原因无法及时反馈到设计前端。", suggestion: "建立售后、安装、设计三方周复盘机制。", needPresidentCoordination: true }
    ],
    supportRequests: ["需要总裁协调 IT 与产品研发优先级", "需要安装/客户服务部开放失败案例数据"]
  },
  {
    id: "okr-swj-module-2026",
    name: "三维家模块优化 OKR 项目",
    category: "系统优化 OKR",
    objective: "完成三维家系统全模块优化，提升系统易用性、稳定性与素材管理规范性，降低整体操作门槛，提升画图效率。",
    background: "三维家模块目录、功能键、参数和素材管理存在使用路径长、命名不统一和高频模块难查找的问题，需要设计总监、直营审核组、产品研发部与 IT 部协同优化。",
    owner: "曹梦圆",
    ownerDepartment: "IT部",
    collaboratorDepartments: ["设计总监", "直营审核组", "产品研发部"],
    startDate: "2026-06-22",
    endDate: "2026-08-14",
    periodText: "2026/6/22 - 2026/8/14",
    priority: "高",
    riskLevel: "中",
    status: "进行中",
    progress: 18,
    needPresidentDecisionCount: 1,
    metrics: [
      { label: "目录查找耗时", base: "平均 6 分钟", target: "降低 40%", current: "降低 10%", status: "进行中" },
      { label: "高频模块命中率", base: "68%", target: "90%", current: "75%", status: "进行中" },
      { label: "参数问题关闭率", base: "暂无统一池", target: "每月关闭 80%", current: "需求池搭建中", status: "进行中" }
    ],
    krs: [
      { id: "swj-kr1", projectId: "okr-swj-module-2026", code: "KR1", title: "完成三维家大目录分类优化", description: "对大目录进行调研、评审、调整和验收。", metric: "大目录命名与排序规范正式上线。", targetValue: "1 套目录规范", currentValue: "调研中", weight: 22, owner: "曹梦圆", department: "IT部", startDate: "2026-06-22", endDate: "2026-07-12", progress: 20, status: "进行中", riskLevel: "中" },
      { id: "swj-kr2", projectId: "okr-swj-module-2026", code: "KR2", title: "完成二级目录分类及模块顺序优化", description: "按照使用频率调整模块顺序，新增常用区。", metric: "二级目录高频模块查找效率提升 30%。", targetValue: "提升 30%", currentValue: "未开始", weight: 20, owner: "怀柱", department: "设计部", startDate: "2026-06-29", endDate: "2026-07-26", progress: 5, status: "未开始", riskLevel: "低" },
      { id: "swj-kr3", projectId: "okr-swj-module-2026", code: "KR3", title: "完成功能键目录分类优化", description: "优化功能键目录层级，降低操作门槛。", metric: "功能键入口减少 2 层以上。", targetValue: "减少 2 层", currentValue: "未开始", weight: 18, owner: "李文", department: "IT部", startDate: "2026-07-13", endDate: "2026-08-03", progress: 0, status: "未开始", riskLevel: "低" },
      { id: "swj-kr4", projectId: "okr-swj-module-2026", code: "KR4", title: "完成功能键模块顺序调整", description: "提升高频模块调用效率。", metric: "高频功能键置顶并通过验收。", targetValue: "100% 验收", currentValue: "未开始", weight: 18, owner: "李文", department: "IT部", startDate: "2026-07-20", endDate: "2026-08-14", progress: 0, status: "未开始", riskLevel: "低" },
      { id: "swj-kr5", projectId: "okr-swj-module-2026", code: "KR5", title: "完成单个模块参数持续优化", description: "持续优化参数规范和素材管理。", metric: "每周关闭参数问题池中的高频问题。", targetValue: "每周关闭 5 项", currentValue: "需求池未完全建立", weight: 22, owner: "怀柱", department: "设计部", startDate: "2026-08-03", endDate: "2026-08-14", progress: 0, status: "未开始", riskLevel: "中" }
    ],
    pdcaTasks: [
      { id: "swj-p1", projectId: "okr-swj-module-2026", krId: "swj-kr1", pdcaStage: "Plan", title: "三维家大目录调研整理", content: "访谈设计总监、审单与产品研发，整理大目录现状。", owner: "曹梦圆", ownerDepartment: "IT部", collaboratorDepartments: ["设计总监", "直营审核组"], startDate: "2026-06-22", endDate: "2026-06-28", deliverable: "《三维家大目录调研方案》", status: "进行中", riskLevel: "中" },
      { id: "swj-d1", projectId: "okr-swj-module-2026", krId: "swj-kr1", pdcaStage: "Do", title: "调研成果评审", content: "确认大目录命名、排序和使用口径。", owner: "李文", ownerDepartment: "IT部", collaboratorDepartments: ["产品研发部"], startDate: "2026-06-29", endDate: "2026-07-01", deliverable: "《大目录调整评审记录》", status: "未开始", riskLevel: "低" },
      { id: "swj-c1", projectId: "okr-swj-module-2026", krId: "swj-kr1", pdcaStage: "Check", title: "大目录调整结果验收", content: "抽取常用模块，检查新目录是否能快速找到。", owner: "怀柱", ownerDepartment: "设计部", collaboratorDepartments: ["直营审核组"], startDate: "2026-07-07", endDate: "2026-07-09", deliverable: "《大目录验收记录》", status: "未开始", riskLevel: "低" },
      { id: "swj-a1", projectId: "okr-swj-module-2026", krId: "swj-kr1", pdcaStage: "Act", title: "目录调整发通知", content: "向设计师发布目录调整说明和操作视频。", owner: "蔡志文", ownerDepartment: "培训部", collaboratorDepartments: ["IT部"], startDate: "2026-07-10", endDate: "2026-07-12", deliverable: "通知与培训材料", status: "未开始", riskLevel: "低" },
      { id: "swj-p2", projectId: "okr-swj-module-2026", krId: "swj-kr2", pdcaStage: "Plan", title: "二级目录现状调研", content: "统计常用模块频次，确认常用区范围。", owner: "怀柱", ownerDepartment: "设计部", collaboratorDepartments: ["IT部"], startDate: "2026-06-29", endDate: "2026-07-05", deliverable: "二级目录问题清单", status: "未开始", riskLevel: "低" },
      { id: "swj-d2", projectId: "okr-swj-module-2026", krId: "swj-kr2", pdcaStage: "Do", title: "新增常用区方案确认", content: "形成常用区置顶规则并确认是否影响现有习惯。", owner: "怀柱", ownerDepartment: "设计部", collaboratorDepartments: ["产品研发部"], startDate: "2026-07-06", endDate: "2026-07-12", deliverable: "常用区置顶规则", status: "未开始", riskLevel: "低" },
      { id: "swj-p3", projectId: "okr-swj-module-2026", krId: "swj-kr3", pdcaStage: "Plan", title: "功能键目录分类方案", content: "梳理功能键目录层级和高频入口。", owner: "李文", ownerDepartment: "IT部", collaboratorDepartments: ["产品研发部"], startDate: "2026-07-13", endDate: "2026-07-19", deliverable: "功能键目录分类规范", status: "未开始", riskLevel: "低" },
      { id: "swj-d4", projectId: "okr-swj-module-2026", krId: "swj-kr4", pdcaStage: "Do", title: "高频功能键排序调整", content: "按高频功能键排序清单进行系统调整。", owner: "李文", ownerDepartment: "IT部", collaboratorDepartments: ["设计部"], startDate: "2026-07-20", endDate: "2026-07-31", deliverable: "高频功能键排序清单", status: "未开始", riskLevel: "低" },
      { id: "swj-a5", projectId: "okr-swj-module-2026", krId: "swj-kr5", pdcaStage: "Act", title: "单个模块参数问题池维护", content: "建立持续维护机制，形成参数优化闭环。", owner: "怀柱", ownerDepartment: "设计部", collaboratorDepartments: ["产品研发部", "IT部"], startDate: "2026-08-03", endDate: "2026-08-14", deliverable: "参数优化问题池", status: "未开始", riskLevel: "中" }
    ],
    relatedMeetings: [
      { id: "sm1", title: "三维家目录调研启动会", date: "2026-06-22", host: "曹梦圆", decision: "优先整理大目录与二级目录，减少设计师查找成本。", todoCount: 5, status: "待召开" },
      { id: "sm2", title: "大目录调研成果评审会", date: "2026-06-29", host: "李文", decision: "确认大目录命名和排序规范。", todoCount: 3, status: "计划中" }
    ],
    relatedTasks: [
      { id: "st1", content: "完成三维家大目录调研整理", krId: "swj-kr1", sourceMeeting: "三维家目录调研启动会", owner: "曹梦圆", ownerDepartment: "IT部", collaboratorDepartments: ["设计总监"], dueDate: "2026-06-28", status: "进行中", riskLevel: "中" },
      { id: "st2", content: "建立参数优化问题池", krId: "swj-kr5", sourceMeeting: "模块参数优化复盘会", owner: "怀柱", ownerDepartment: "设计部", collaboratorDepartments: ["产品研发部", "IT部"], dueDate: "2026-08-14", status: "未开始", riskLevel: "中" }
    ],
    risks: [
      { id: "sr1", description: "三维家目录调整需要跨部门共同确认，评审口径可能反复。", krId: "swj-kr1", departments: ["IT部", "设计总监", "产品研发部"], riskLevel: "中", impact: "目录上线时间可能后延。", suggestion: "先冻结第一版高频目录，后续用问题池迭代。", needPresidentCoordination: false }
    ],
    supportRequests: ["需要设计总监确认高频模块排序口径"]
  },
  {
    id: "okr-store-sop-2026",
    name: "门店客户需求表规范 OKR 项目",
    category: "组织能力 OKR",
    objective: "统一门店客户需求表填写标准，降低漏填、截图补交和设计交付误差。",
    background: "门店客户需求表填写口径不统一，影响设计、审单、售后各环节判断。需要把填写标准、培训、抽检和异常回写放进一个闭环。",
    owner: "美凤",
    ownerDepartment: "直营门店",
    collaboratorDepartments: ["培训部", "设计部", "售后部"],
    startDate: "2026-06-16",
    endDate: "2026-09-30",
    periodText: "2026/6/16 - 2026/9/30",
    priority: "中",
    riskLevel: "中",
    status: "进行中",
    progress: 24,
    needPresidentDecisionCount: 0,
    metrics: [
      { label: "需求表完整率", base: "72%", target: "95%", current: "80%", status: "进行中" },
      { label: "设计返工率", base: "18%", target: "<8%", current: "15%", status: "有风险" },
      { label: "门店上传及时率", base: "65%", target: "90%", current: "74%", status: "进行中" }
    ],
    krs: [
      { id: "store-kr1", projectId: "okr-store-sop-2026", code: "KR1", title: "统一客户需求表填写标准", description: "把常见漏填字段、截图要求和确认口径固化为模板。", metric: "模板上线并覆盖所有直营门店。", targetValue: "100% 覆盖", currentValue: "3 家试点", weight: 40, owner: "美凤", department: "直营门店", startDate: "2026-06-16", endDate: "2026-07-20", progress: 35, status: "进行中", riskLevel: "中" },
      { id: "store-kr2", projectId: "okr-store-sop-2026", code: "KR2", title: "建立培训与抽检机制", description: "培训门店执行人，并每周抽查需求表质量。", metric: "每周抽检并输出问题清单。", targetValue: "12 次抽检", currentValue: "2 次抽检", weight: 35, owner: "蔡志文", department: "培训部", startDate: "2026-06-24", endDate: "2026-09-15", progress: 28, status: "进行中", riskLevel: "低" },
      { id: "store-kr3", projectId: "okr-store-sop-2026", code: "KR3", title: "售后异常回写闭环", description: "把售后异常原因回写到需求表标准和培训案例。", metric: "每月完成售后异常复盘。", targetValue: "3 次复盘", currentValue: "0 次", weight: 25, owner: "蒋文轩", department: "售后部", startDate: "2026-07-01", endDate: "2026-09-30", progress: 5, status: "未开始", riskLevel: "中" }
    ],
    pdcaTasks: [
      { id: "store-p1", projectId: "okr-store-sop-2026", krId: "store-kr1", pdcaStage: "Plan", title: "整理需求表漏填案例", content: "汇总门店近 30 天漏填、错填和截图补交问题。", owner: "美凤", ownerDepartment: "直营门店", collaboratorDepartments: ["设计部"], startDate: "2026-06-16", endDate: "2026-06-21", deliverable: "漏填案例清单", status: "已延期", riskLevel: "中" },
      { id: "store-d1", projectId: "okr-store-sop-2026", krId: "store-kr1", pdcaStage: "Do", title: "发布客户需求表模板", content: "形成门店统一填写模板并试点。", owner: "美凤", ownerDepartment: "直营门店", collaboratorDepartments: ["培训部"], startDate: "2026-06-22", endDate: "2026-07-05", deliverable: "需求表标准模板", status: "进行中", riskLevel: "中" },
      { id: "store-c2", projectId: "okr-store-sop-2026", krId: "store-kr2", pdcaStage: "Check", title: "每周抽检需求表", content: "对门店上传需求表进行完整性抽检。", owner: "蔡志文", ownerDepartment: "培训部", collaboratorDepartments: ["直营门店"], startDate: "2026-07-01", endDate: "2026-09-15", deliverable: "周抽检记录", status: "进行中", riskLevel: "低" },
      { id: "store-a3", projectId: "okr-store-sop-2026", krId: "store-kr3", pdcaStage: "Act", title: "售后异常案例回写", content: "把售后异常转成门店填写提醒和培训案例。", owner: "蒋文轩", ownerDepartment: "售后部", collaboratorDepartments: ["培训部", "直营门店"], startDate: "2026-07-01", endDate: "2026-09-30", deliverable: "售后异常回写案例库", status: "未开始", riskLevel: "中" }
    ],
    relatedMeetings: [
      { id: "tm1", title: "直营门店周会：客户需求与交付风险", date: "2026-06-19", host: "美凤", decision: "客户需求表先按统一模板试点。", todoCount: 2, status: "已进入闭环" }
    ],
    relatedTasks: [
      { id: "tt1", content: "整理胡桃木板材客户需求案例", krId: "store-kr1", sourceMeeting: "直营门店周会：客户需求与交付风险", owner: "美凤", ownerDepartment: "直营门店", collaboratorDepartments: ["设计部"], dueDate: "2026-06-21", status: "已延期", riskLevel: "中" }
    ],
    risks: [
      { id: "tr1", description: "门店填写标准推广慢，容易造成设计端返工。", krId: "store-kr1", departments: ["直营门店", "设计部"], riskLevel: "中", impact: "需求不完整会继续影响设计交付效率。", suggestion: "先把试点门店模板固化，再安排培训部做统一培训。", needPresidentCoordination: false }
    ],
    supportRequests: ["需要培训部排期门店需求表专项培训"]
  }
];

const findUser = (id: string) => users.find((user) => user.id === id);
const findDepartment = (id: string) => departments.find((department) => department.id === id);
const findUserByName = (name: string) =>
  realUsers.find((user) => user.name === name) ??
  realUsers.find((user) => Boolean(name) && (user.name.includes(name) || name.includes(user.name))) ??
  users.find((user) => user.name === name) ??
  users.find((user) => Boolean(name) && (user.name.includes(name) || name.includes(user.name)));
const findDepartmentByName = (name: string) =>
  realDepartments.find((department) => department.name === name) ??
  realDepartments.find((department) => Boolean(name) && (department.name.includes(name) || name.includes(department.name))) ??
  departments.find((department) => department.name === name) ??
  departments.find((department) => Boolean(name) && (department.name.includes(name) || name.includes(department.name)));
const getDepartmentNameByUserName = (name: string) => findDepartment(users.find((user) => user.name === name)?.departmentId ?? "")?.name ?? "未设置部门";
const findMeeting = (items: Meeting[], id: string) => items.find((meeting) => meeting.id === id);

function getOkrUserId(value?: string, fallbackName = "林昱辰") {
  if (!value) return findUserByName(fallbackName)?.id ?? getPresidentUserId();
  return findUser(value)?.id ?? findUserByName(value)?.id ?? findUserByName(fallbackName)?.id ?? getPresidentUserId();
}

function getOkrDepartmentId(value?: string, fallbackUserId?: string) {
  if (value) {
    const realDepartmentId =
      realDepartments.find((department) => department.id === value)?.id ??
      realDepartments.find((department) => department.name === value)?.id ??
      realDepartments.find((department) => department.name.includes(value) || value.includes(department.name))?.id;
    const departmentId = findDepartment(value)?.id ?? realDepartmentId;
    if (departmentId) return departmentId;
  }
  const fallbackDepartmentId = fallbackUserId ? findUser(fallbackUserId)?.departmentId : undefined;
  if (fallbackDepartmentId) return fallbackDepartmentId;
  return value ? findDepartmentByName(value)?.id ?? defaultMeetingDepartmentId : defaultMeetingDepartmentId;
}

function getOkrUserName(userId?: string, fallbackName = "未设置") {
  return userId ? findUser(userId)?.name ?? fallbackName : fallbackName;
}

function getOkrDepartmentName(departmentId?: string, fallbackName = "未设置部门") {
  return departmentId ? findDepartment(departmentId)?.name ?? fallbackName : fallbackName;
}

function getOkrDepartmentNames(departmentIds?: string[], fallbackNames: string[] = []) {
  const names = (departmentIds ?? []).map((departmentId) => findDepartment(departmentId)?.name).filter((name): name is string => Boolean(name));
  return names.length ? names : fallbackNames;
}

function normalizeOkrProjectIdentity(project: OkrProject): OkrProject {
  const ownerId = project.ownerId ?? getOkrUserId(project.owner);
  const ownerDepartmentId = project.ownerDepartmentId ?? getOkrDepartmentId(project.ownerDepartment, ownerId);
  const collaboratorDepartmentIds =
    project.collaboratorDepartmentIds ??
    project.collaboratorDepartments.map((departmentName) => findDepartmentByName(departmentName)?.id).filter((id): id is string => Boolean(id));

  const krs = project.krs.map((kr) => {
    const krOwnerId = kr.ownerId ?? getOkrUserId(kr.owner, project.owner);
    const departmentId = kr.departmentId ?? getOkrDepartmentId(kr.department, krOwnerId);
    const reviewerId = kr.reviewerId ?? getOkrUserId(kr.reviewer ?? project.owner, project.owner);
    return {
      ...kr,
      ownerId: krOwnerId,
      departmentId,
      reviewerId,
      owner: getOkrUserName(krOwnerId, kr.owner),
      department: getOkrDepartmentName(departmentId, kr.department),
      reviewer: getOkrUserName(reviewerId, kr.reviewer ?? project.owner)
    };
  });

  const pdcaTasks = project.pdcaTasks.map((task) => {
    const taskOwnerId = task.ownerId ?? getOkrUserId(task.owner, project.owner);
    const taskDepartmentId = task.ownerDepartmentId ?? getOkrDepartmentId(task.ownerDepartment, taskOwnerId);
    const taskReviewerId = task.reviewerId ?? getOkrUserId(task.reviewer ?? project.owner, project.owner);
    const taskCollaboratorDepartmentIds =
      task.collaboratorDepartmentIds ??
      task.collaboratorDepartments.map((departmentName) => findDepartmentByName(departmentName)?.id).filter((id): id is string => Boolean(id));
    return {
      ...task,
      ownerId: taskOwnerId,
      ownerDepartmentId: taskDepartmentId,
      reviewerId: taskReviewerId,
      collaboratorDepartmentIds: taskCollaboratorDepartmentIds,
      owner: getOkrUserName(taskOwnerId, task.owner),
      ownerDepartment: getOkrDepartmentName(taskDepartmentId, task.ownerDepartment),
      reviewer: getOkrUserName(taskReviewerId, task.reviewer ?? project.owner),
      collaboratorDepartments: getOkrDepartmentNames(taskCollaboratorDepartmentIds, task.collaboratorDepartments)
    };
  });

  return {
    ...project,
    ownerId,
    ownerDepartmentId,
    collaboratorDepartmentIds,
    owner: getOkrUserName(ownerId, project.owner),
    ownerDepartment: getOkrDepartmentName(ownerDepartmentId, project.ownerDepartment),
    collaboratorDepartments: getOkrDepartmentNames(collaboratorDepartmentIds, project.collaboratorDepartments),
    krs,
    pdcaTasks
  };
}

const okrProjects: OkrProject[] = okrProjectSeeds.map(normalizeOkrProjectIdentity);

function resolveUserId(value?: string) {
  if (!value) return undefined;
  return findUser(value)?.id ?? findUserByName(value)?.id;
}

function resolveDepartmentId(value?: string) {
  if (!value) return undefined;
  return findDepartment(value)?.id ?? findDepartmentByName(value)?.id;
}

function getTaskSourceTitle(task: Task, meetings: Meeting[]) {
  const meeting = findMeeting(meetings, task.meetingId) ?? seedMeetings.find((item) => item.id === task.meetingId);
  if (meeting) return meeting.title;
  if (task.meetingId.startsWith("okr-")) return task.sourceText || "OKR 项目任务";
  return "未知会议";
}

function getTaskSourceType(task: Task): Exclude<TaskSourceFilter, "全部"> {
  if (task.id.startsWith("okr-kr-review-")) return "KR复核";
  if (task.id.startsWith("okr-task-") || task.meetingId.startsWith("okr-")) return "OKR任务";
  return "会议待办";
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function parseLocalDate(value: string) {
  const normalized = value.slice(0, 10).replaceAll("/", "-");
  return new Date(`${normalized}T00:00:00`);
}

function dateKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayKey() {
  return dateKey(new Date());
}

function currentDateTime() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function currentDateTimeLocal(offsetMinutes = 0) {
  const next = new Date(Date.now() + offsetMinutes * 60000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}

function dateKeyFromDateTime(value: string) {
  const rawDate = value.includes("T") ? value.split("T")[0] : value.split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : dateKey(new Date());
}

function getTaskCreatedTimeValue(task: Task) {
  return parseStateTime(task.createdAt) || parseStateTime(task.updatedAt) || 0;
}

function sortTasksByCreatedAtDesc(items: Task[]) {
  return [...items].sort((a, b) => getTaskCreatedTimeValue(b) - getTaskCreatedTimeValue(a) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

function formatTaskCreatedAt(task: Task) {
  return formatDateTime(task.createdAt || task.updatedAt).slice(0, 16);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addDaysToDateKey(baseDate: string, days: number) {
  return dateKey(addDays(parseLocalDate(baseDate), days));
}

function getDashboardPeriodRange(period: DashboardPeriod) {
  const today = parseLocalDate(todayKey());
  const day = today.getDay() || 7;
  const thisWeekStart = addDays(today, 1 - day);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  if (period === "last_week") return { start: addDays(thisWeekStart, -7), end: addDays(thisWeekEnd, -7), label: "上周" };
  if (period === "last_month") return { start: lastMonthStart, end: lastMonthEnd, label: "上个月" };
  if (period === "this_month") return { start: thisMonthStart, end: thisMonthEnd, label: "本月" };
  return { start: thisWeekStart, end: thisWeekEnd, label: "本周" };
}

function isDateInRange(value: string, start: Date, end: Date) {
  const date = parseLocalDate(value);
  return date >= start && date <= end;
}

function getMeetingManHours(meeting: Meeting) {
  const participantCount = meeting.participantCount ?? meeting.participantIds.length;
  return meeting.totalManHours ?? Number(((participantCount * meeting.durationMinutes) / 60).toFixed(1));
}

function isTaskCompletedOnTime(task: Task) {
  if (!isTaskCompleted(task)) return false;
  return parseLocalDate(task.updatedAt || task.dueDate) <= parseLocalDate(task.dueDate);
}

function isTaskDelayed(task: Task) {
  if (isTaskCompleted(task)) return parseLocalDate(task.updatedAt || task.dueDate) > parseLocalDate(task.dueDate);
  return isOverdue(task);
}

function isOverdue(task: Task) {
  return !isTaskCompleted(task) && task.dueDate < todayKey();
}

function isDueSoon(task: Task) {
  if (isTaskCompleted(task) || task.dueDate < todayKey()) return false;
  const due = new Date(`${task.dueDate}T00:00:00`);
  const today = new Date(`${todayKey()}T00:00:00`);
  const diff = (due.getTime() - today.getTime()) / 86400000;
  return diff <= 3;
}

function daysFromToday(date: string) {
  const target = parseLocalDate(date);
  const today = parseLocalDate(todayKey());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function getRiskLevel(task: Task) {
  if (task.status === "overdue") return "逾期";
  if (isOverdue(task)) return "逾期";
  if (isDueSoon(task)) return "临期";
  return "正常";
}

function isFormalTask(task: Task) {
  return !task.approvalStatus || task.approvalStatus === "in_closed_loop" || task.approvalStatus === "approved";
}

function isTaskCompleted(task: Task) {
  return task.status === "已完成" || task.status === "completed";
}

function isTaskInProgress(task: Task) {
  return task.status === "in_progress" || task.status === "进行中";
}

function hasTaskCompletionItems(task: Task) {
  return Boolean(task.completionItems?.some((item) => item.trim()));
}

function createTaskProgressEntry(task: Task, submittedAt: string, targetStatus?: TaskStatus): TaskProgressEntry | undefined {
  const items = task.completionItems?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (!items.length) return undefined;
  return {
    id: nextId("task-progress"),
    submittedAt,
    submittedBy: getTaskOwnerId(task),
    targetStatus,
    items
  };
}

function progressItemsKey(items: string[] = []) {
  return items.map((item) => item.trim()).filter(Boolean).join("\n");
}

function getTaskProgressEntries(task: Task): TaskProgressEntry[] {
  const history = task.completionHistory?.filter((entry) => entry.items?.some((item) => item.trim())) ?? [];
  const currentItems = task.completionItems?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (!currentItems.length) return history;
  const currentKey = progressItemsKey(currentItems);
  const alreadyInHistory = history.some((entry) => progressItemsKey(entry.items) === currentKey);
  if (alreadyInHistory) return history;
  return [
    ...history,
    {
      id: `current-progress-${task.id}`,
      submittedAt: task.reviewSubmittedAt || task.reviewedAt || task.updatedAt,
      submittedBy: getTaskOwnerId(task),
      targetStatus: task.reviewTargetStatus,
      items: currentItems
    }
  ];
}

function getTaskProgressSummary(tasks: Task[]) {
  const completed = tasks.filter(isTaskCompleted).length;
  const pendingReview = tasks.filter((task) => task.status === "pending_review").length;
  const inProgress = tasks.filter(isTaskInProgress).length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const overdue = tasks.filter(isOverdue).length;
  const notStarted = tasks.filter((task) => task.status === "not_started" || task.status === "未开始").length;
  return {
    total: tasks.length,
    completed,
    pendingReview,
    inProgress,
    blocked,
    overdue,
    notStarted,
    completionRate: tasks.length ? completed / tasks.length : 0
  };
}

function getTaskContent(task: Task) {
  return task.content ?? task.title;
}

function getTaskDescription(task: Task) {
  const base = task.description || task.sourceText || "来自会议闭环模板";
  return task.goal ? `${base} 目标：${task.goal}` : base;
}

function getTaskOwnerId(task: Task) {
  return resolveUserId(task.owner) ?? resolveUserId(task.ownerId) ?? task.ownerId ?? task.owner ?? "";
}

function getTaskReviewerId(task: Task, meeting?: Meeting) {
  const ownerId = getTaskOwnerId(task);
  if (meeting) {
    if (ownerId === meeting.hostId) {
      const presidentId = getPresidentUserId();
      return presidentId !== ownerId ? presidentId : task.reviewerId ?? ownerId;
    }
    if (meeting.hostId && meeting.hostId !== ownerId) return meeting.hostId;
  }
  const directReviewerId = resolveUserId(task.reviewerId);
  if (directReviewerId && directReviewerId !== ownerId) return directReviewerId;
  const owner = findUser(ownerId);
  const candidates = [
    owner?.managerId,
    findDepartment(getTaskDepartmentId(task))?.managerId,
    meeting ? findDepartment(meeting.departmentId)?.managerId : undefined,
    meeting?.hostId,
    task.reviewerId,
    task.ownerId
  ];
  return candidates.map((userId) => resolveUserId(userId)).find((userId) => Boolean(userId) && userId !== ownerId) ?? directReviewerId ?? meeting?.hostId ?? ownerId;
}

function normalizeReviewTargetStatus(status?: TaskStatus): TaskStatus {
  if (status === "completed" || status === "已完成") return "completed";
  if (status === "in_progress" || status === "进行中") return "in_progress";
  if (status === "blocked") return "blocked";
  if (status === "not_started" || status === "未开始") return "not_started";
  return "completed";
}

function inferReviewTargetStatus(task: Task, activityLogs: ActivityLog[] = []) {
  if (task.reviewTargetStatus) return normalizeReviewTargetStatus(task.reviewTargetStatus);
  const submitLog = activityLogs.find((log) => log.taskId === task.id && log.action === "submit_review");
  return normalizeReviewTargetStatus(submitLog?.fromStatus as TaskStatus | undefined);
}

function getReviewTargetLabel(status: TaskStatus) {
  return normalizeReviewTargetStatus(status) === "completed" ? "完成" : "进度";
}

function getTaskDepartmentId(task: Task) {
  return resolveDepartmentId(task.ownerDepartment) ?? resolveDepartmentId(task.departmentId) ?? task.departmentId ?? task.ownerDepartment ?? "";
}

function getTaskCollaboratorDepartmentIds(task: Task) {
  return task.collaboratorDepartments ?? task.collaboratorDepartmentIds ?? [];
}

function isTaskConnectedToUser(task: Task, userId: string, meeting?: Meeting) {
  return getTaskOwnerId(task) === userId || getTaskReviewerId(task, meeting) === userId;
}

function isTaskInDepartment(task: Task, departmentId: string, meeting?: Meeting) {
  const ownerDepartmentId = getUserDepartmentId(getTaskOwnerId(task));
  const reviewerDepartmentId = getUserDepartmentId(getTaskReviewerId(task, meeting));
  return getTaskDepartmentId(task) === departmentId || ownerDepartmentId === departmentId || reviewerDepartmentId === departmentId;
}

function isMeetingConnectedToDepartment(meeting: Meeting, departmentId: string) {
  return (
    meeting.departmentId === departmentId ||
    getUserDepartmentId(meeting.hostId) === departmentId ||
    meeting.participantIds.some((userId) => getUserDepartmentId(userId) === departmentId)
  );
}

function getTaskRelatedDepartmentIds(task: Task, meeting?: Meeting) {
  return new Set(
    [
      getTaskDepartmentId(task),
      getUserDepartmentId(getTaskOwnerId(task)),
      getUserDepartmentId(getTaskReviewerId(task, meeting)),
      ...getTaskCollaboratorDepartmentIds(task),
      meeting?.departmentId,
      meeting ? getUserDepartmentId(meeting.hostId) : undefined,
      ...(meeting?.participantIds.map((userId) => getUserDepartmentId(userId)) ?? [])
    ].filter((value): value is string => Boolean(value))
  );
}

function isTaskRelatedToDepartment(task: Task, departmentId: string, meeting?: Meeting) {
  return getTaskRelatedDepartmentIds(task, meeting).has(departmentId);
}

function isUserInMeeting(userId: string, meeting?: Meeting) {
  return Boolean(meeting && (meeting.hostId === userId || meeting.participantIds.includes(userId)));
}

function canViewTask(account: TestAccount, task: Task, meetings: Meeting[]) {
  if (account.id === "president") return true;
  const accountUser = getAccountUser(account);
  const meeting = findMeeting(meetings, task.meetingId);
  if (isTaskConnectedToUser(task, accountUser.id, meeting)) return true;
  if (account.id === "manager") return isTaskRelatedToDepartment(task, accountUser.departmentId, meeting);
  return false;
}

function canDeleteTaskForAccount(account: TestAccount, task: Task, meetings: Meeting[]) {
  if (account.id === "president") return true;
  if (account.id !== "manager") return false;
  const accountUser = getAccountUser(account);
  return isTaskRelatedToDepartment(task, accountUser.departmentId, findMeeting(meetings, task.meetingId));
}

function canViewMeeting(account: TestAccount, meeting: Meeting, tasks: Task[]) {
  if (account.id === "president") return true;
  const accountUser = getAccountUser(account);
  if (account.id === "manager") return meeting.departmentId === accountUser.departmentId || tasks.some((task) => task.meetingId === meeting.id && isTaskRelatedToDepartment(task, accountUser.departmentId, meeting));
  return isUserInMeeting(accountUser.id, meeting);
}

function canViewOkrProject(account: TestAccount, project: OkrProject) {
  return canViewOkrProjectForUser(getAccountUser(account), project);
}

function getPresidentSupportTasks(tasks: Task[]) {
  return tasks.filter((task) => Boolean(task.companySupportRequest?.trim()) && task.companySupportStatus !== "completed");
}

function getTaskStatusLabel(status: TaskStatus) {
  const map: Record<string, string> = {
    not_started: "未开始",
    in_progress: "进行中",
    pending_review: "已提交待复核",
    completed: "已完成",
    overdue: "已逾期",
    blocked: "已阻塞",
    未开始: "未开始",
    进行中: "进行中",
    已完成: "已完成"
  };
  return map[status] ?? status;
}

function getReadOnlyTaskStatusTone(status: TaskStatus) {
  if (status === "completed" || status === "已完成") return solidTone.green;
  if (status === "blocked") return solidTone.red;
  if (status === "in_progress" || status === "进行中") return "border-[#1D3554] bg-[#1D3554] text-white";
  return "border-line bg-slate-50 text-slate-600";
}

function getSelectTaskStatus(status: TaskStatus) {
  if (status === "未开始") return "not_started";
  if (status === "进行中") return "in_progress";
  if (status === "已完成") return "completed";
  return status;
}

const solidTone = {
  green: "border-[#0F6F5C] bg-[#0F6F5C] text-white",
  red: "border-[#9F2F34] bg-[#9F2F34] text-white",
  amber: "border-[#A66A2A] bg-[#A66A2A] text-white"
};

const solidFill = {
  green: "bg-[#0F6F5C] text-white",
  red: "bg-[#9F2F34] text-white",
  amber: "bg-[#A66A2A] text-white"
};

function getTaskStatusTone(task: Task) {
  if (isTaskCompleted(task)) return solidTone.green;
  if (task.status === "pending_review") return solidTone.amber;
  if (task.status === "blocked") return solidTone.red;
  if (isOverdue(task)) return solidTone.red;
  if (isDueSoon(task)) return solidTone.amber;
  if (task.status === "进行中" || task.status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getPriorityTone(priority: Priority) {
  if (priority === "高") return solidTone.red;
  if (priority === "中") return solidTone.amber;
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getPriorityRank(priority: Priority) {
  if (priority === "高") return 3;
  if (priority === "中") return 2;
  return 1;
}

function projectOwnerFallbackUserId(departmentName: string) {
  const department = findDepartmentByName(departmentName);
  return department?.managerId ?? "u-linyuchen";
}

function mapOkrTaskStatus(status: OkrTaskStatus): TaskStatus {
  if (status === "已完成") return "completed";
  if (status === "已提交待复核") return "pending_review";
  if (status === "进行中") return "in_progress";
  if (status === "已延期") return "overdue";
  if (status === "阻塞中") return "blocked";
  return "not_started";
}

function mapTaskStatusToOkrStatus(status: TaskStatus): OkrTaskStatus {
  if (status === "completed") return "已完成";
  if (status === "pending_review") return "已提交待复核";
  if (status === "in_progress") return "进行中";
  if (status === "overdue") return "已延期";
  if (status === "blocked") return "阻塞中";
  return "未开始";
}

function getOkrPdcaTaskId(taskId: string) {
  return taskId.startsWith("okr-task-") ? taskId.replace("okr-task-", "") : taskId;
}

function buildOkrTodoTasks(projects: OkrProject[], statusOverrides: Record<string, TaskStatus> = {}, completionOverrides: Record<string, string[]> = {}): Task[] {
  return projects.flatMap((project) =>
    project.pdcaTasks.filter((pdcaTask) => pdcaTask.status !== "已取消").map((pdcaTask) => {
      const kr = project.krs.find((item) => item.id === pdcaTask.krId);
      const ownerId = pdcaTask.ownerId ?? getOkrUserId(pdcaTask.owner, project.owner);
      const ownerDepartmentId = pdcaTask.ownerDepartmentId ?? getOkrDepartmentId(pdcaTask.ownerDepartment, ownerId);
      const reviewerId = pdcaTask.reviewerId ?? kr?.reviewerId ?? project.ownerId ?? getOkrUserId(pdcaTask.reviewer ?? kr?.reviewer ?? project.owner, project.owner);
      const collaboratorDepartmentIds =
        pdcaTask.collaboratorDepartmentIds ??
        pdcaTask.collaboratorDepartments.map((departmentName) => findDepartmentByName(departmentName)?.id).filter((id): id is string => Boolean(id));
      const id = `okr-task-${pdcaTask.id}`;
      const status = statusOverrides[id] ?? mapOkrTaskStatus(pdcaTask.status);
      const reviewTargetStatus = pdcaTask.reviewTargetStatus ? mapOkrTaskStatus(pdcaTask.reviewTargetStatus) : "completed";
      const completionItems = completionOverrides[id] ?? pdcaTask.completionItems ?? [];
      const completionHistory = pdcaTask.completionHistory?.map((entry) => ({
        ...entry,
        targetStatus: entry.targetStatus ? mapOkrTaskStatus(entry.targetStatus) : undefined
      }));
      return {
        id,
        title: pdcaTask.title,
        content: pdcaTask.title,
        description: `OKR 项目：${project.name}；所属 ${kr?.code ?? "KR"} ${kr?.title ?? ""}；PDCA 阶段：${pdcaTask.pdcaStage}。${pdcaTask.content}`,
        meetingId: `okr-${project.id}`,
        ownerId,
        departmentId: ownerDepartmentId,
        reviewerId,
        collaboratorDepartmentIds,
        startDate: pdcaTask.startDate,
        dueDate: pdcaTask.endDate,
        goal: pdcaTask.deliverable,
        sourceText: `${project.name} / ${kr?.code ?? "KR"} ${kr?.title ?? ""}`,
        priority: pdcaTask.riskLevel,
        status,
        completionItems,
        completionHistory,
        reviewTargetStatus: status === "pending_review" ? reviewTargetStatus : undefined,
        reviewSubmittedAt: status === "pending_review" ? pdcaTask.reviewSubmittedAt ?? pdcaTask.endDate : pdcaTask.reviewSubmittedAt,
        reviewedAt: status === "completed" && (statusOverrides[id] === "completed" || pdcaTask.status === "已完成") ? pdcaTask.reviewedAt ?? pdcaTask.endDate : pdcaTask.reviewedAt,
        reviewRejectedAt: pdcaTask.reviewRejectedAt,
        reviewRejectedReason: pdcaTask.reviewRejectedReason,
        reviewRejectedItems: pdcaTask.reviewRejectedItems,
        createdAt: pdcaTask.startDate,
        updatedAt: pdcaTask.startDate
      };
    })
  );
}

function buildOkrKrReviewTasks(projects: OkrProject[], krStatusOverrides: Record<string, OkrKrStatus> = {}, taskStatusOverrides: Record<string, TaskStatus> = {}): Task[] {
  return projects.flatMap((project) =>
    project.krs.flatMap((kr) => {
      const krTasks = project.pdcaTasks.filter((task) => task.krId === kr.id);
      const overrideStatus = krStatusOverrides[kr.id];
      const isReadyForReview =
        krTasks.length > 0 &&
        krTasks.every((task) => {
          const override = taskStatusOverrides[`okr-task-${task.id}`];
          return override ? isTaskCompleted({ status: override } as Task) : task.status === "已完成";
        });
      if (!overrideStatus && !isReadyForReview) return [];

      const krOwnerId = kr.ownerId ?? getOkrUserId(kr.owner, project.owner);
      const projectOwnerId = project.ownerId ?? getOkrUserId(project.owner);
      const departmentId = kr.departmentId ?? getOkrDepartmentId(kr.department, krOwnerId);
      const id = `okr-kr-review-${kr.id}`;
      return {
        id,
        title: `复核 ${kr.code} ${kr.title}`,
        content: `复核 ${kr.code} ${kr.title}`,
        description: `OKR 项目：${project.name}。该 KR 下 PDCA 动作已完成，需要 OKR 负责人复核是否达到量化衡量标准：${kr.metric}`,
        meetingId: `okr-${project.id}`,
        ownerId: krOwnerId,
        departmentId,
        reviewerId: projectOwnerId,
        collaboratorDepartmentIds: [],
        startDate: kr.startDate,
        dueDate: kr.endDate,
        goal: kr.metric,
        sourceText: `${project.name} / ${kr.code} ${kr.title}`,
        priority: kr.riskLevel,
        status: overrideStatus === "已完成" ? "completed" : "pending_review",
        createdAt: kr.startDate,
        updatedAt: kr.endDate
      };
    })
  );
}

function buildOkrProjectApprovalTasks(projects: OkrProject[]): Task[] {
  return projects
    .filter((project) => project.status === "待总裁审批")
    .map((project) => {
      const ownerId = project.ownerId ?? getOkrUserId(project.owner);
      const ownerDepartmentId = project.ownerDepartmentId ?? getOkrDepartmentId(project.ownerDepartment, ownerId);
      return {
        id: `okr-project-review-${project.id}`,
        title: `审批 OKR 项目：${project.name}`,
        content: `审批 OKR 项目：${project.name}`,
        description: `OKR 项目《${project.name}》已提交总裁审批。项目负责人：${getOkrUserName(ownerId, project.owner)}；主责部门：${getOkrDepartmentName(ownerDepartmentId, project.ownerDepartment)}。`,
        meetingId: `okr-${project.id}`,
        ownerId,
        departmentId: ownerDepartmentId,
        reviewerId: getPresidentUserId(),
        collaboratorDepartmentIds: project.collaboratorDepartmentIds ?? [],
        startDate: project.startDate,
        dueDate: project.startDate,
        goal: project.objective,
        sourceText: project.name,
        priority: project.priority,
        status: "pending_review" as TaskStatus,
        reviewTargetStatus: "in_progress" as TaskStatus,
        reviewSubmittedAt: project.startDate,
        createdAt: project.startDate,
        updatedAt: project.startDate
      };
    });
}

function getMeetingStatusLabel(status: MeetingStatus) {
  if (status === "closed") return "已闭环";
  if (status === "summarized") return "已生成纪要";
  return "待处理";
}

function getApprovalStatusLabel(status?: ApprovalStatus) {
  const map: Record<ApprovalStatus, string> = {
    draft: "草稿",
    ai_generated: "已生成 AI 会议模板",
    supervisor_edited: "主管已修正",
    pending_president_approval: "待总裁签批",
    approved: "总裁已签批",
    rejected: "总裁已驳回",
    in_closed_loop: "已进入闭环"
  };
  return status ? map[status] : "已进入闭环";
}

function getMeetingDisplayStatus(meeting: Meeting) {
  return meeting.approvalStatus ? getApprovalStatusLabel(meeting.approvalStatus) : getMeetingStatusLabel(meeting.status);
}

function getNotificationTimeValue(time: string) {
  return new Date(time.length <= 10 ? `${time}T00:00:00` : time.replace(" ", "T")).getTime();
}

function isNotificationUnread(item: NotificationItem, readIds: string[], currentUserId: string) {
  return isNotificationForUser(item, currentUserId) && !readIds.includes(item.id) && item.actorId !== currentUserId;
}

function isNotificationForUser(item: NotificationItem, currentUserId: string) {
  return !item.recipientIds?.length || item.recipientIds.includes(currentUserId);
}

function buildNotifications(meetings: Meeting[], tasks: Task[], activityLogs: ActivityLog[] = []): NotificationItem[] {
  const items: NotificationItem[] = [];

  meetings.forEach((meeting) => {
    (meeting.tasks ?? []).forEach((task) => {
      const ownerId = getTaskOwnerId(task);
      const reviewerId = getTaskReviewerId(task, meeting);
      const ownerName = findUser(ownerId)?.name ?? "未设置";
      const reviewerName = findUser(reviewerId)?.name ?? "未设置";
      if (task.approvalStatus === "pending_president_approval") {
        items.push({
          id: `approval-pending-${task.id}`,
          title: "待办已提交总裁签批",
          content: `会议《${meeting.title}》的待办「${getTaskContent(task)}」已进入待签批池。推进人：${ownerName}；复核人：${reviewerName}；需审核开始时间和截止日期。`,
          category: "待签批",
          time: task.updatedAt || meeting.createdAt,
          tone: "amber",
          meetingId: meeting.id,
          taskId: task.id,
          actor: ownerName,
          actorId: ownerId,
          recipientIds: [getPresidentUserId()]
        });
      }

      if (task.approvalStatus === "rejected") {
        items.push({
          id: `approval-rejected-${task.id}`,
          title: "待办被驳回修改",
          content: `会议《${meeting.title}》的待办「${getTaskContent(task)}」被驳回。推进人：${ownerName}；复核人：${reviewerName}。原因：${task.rejectedReason || meeting.rejectedReason || "请补充责任边界和时间要求后重新提交。"}`,
          category: "驳回修改",
          time: task.updatedAt || meeting.createdAt,
          tone: "red",
          meetingId: meeting.id,
          taskId: task.id,
          actor: "林昱辰",
          actorId: getPresidentUserId(),
          recipientIds: [ownerId]
        });
      }
    });
  });

  tasks.forEach((task) => {
    const meeting = meetings.find((item) => item.id === task.meetingId);
    const meetingTitle = meeting?.title ?? getTaskSourceTitle(task, meetings);
    const ownerId = getTaskOwnerId(task);
    const reviewerId = getTaskReviewerId(task, meeting);
    const ownerName = findUser(ownerId)?.name ?? "未设置";
    const reviewerName = findUser(reviewerId)?.name ?? "未设置";
    const isApprovedForClosedLoop = task.approvalStatus === "in_closed_loop" || task.approvalStatus === "approved";
    const hasEnteredReviewFlow = task.status === "pending_review" || Boolean(task.reviewSubmittedAt || task.reviewedAt || task.reviewRejectedAt);
    if (task.id.startsWith("okr-project-review-")) {
      items.push({
        id: `okr-project-approval-${task.id}`,
        title: "OKR 项目待总裁审批",
        content: `OKR 项目《${meetingTitle}》已提交审批。项目负责人：${ownerName}；审批人：${reviewerName}。审批通过后，推进人会继续在“我的待办”处理对应 PDCA 任务。`,
        category: "待复核",
        time: task.reviewSubmittedAt || task.updatedAt,
        tone: "amber",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: ownerName,
        actorId: ownerId,
        recipientIds: [reviewerId]
      });
      return;
    }

    if (task.id.startsWith("okr-task-") && task.status !== "pending_review" && !isTaskCompleted(task) && !hasEnteredReviewFlow) {
      items.push({
        id: `okr-task-assigned-${task.id}`,
        title: "OKR 任务已分配",
        content: `OKR 项目《${meetingTitle}》的 PDCA 任务「${getTaskContent(task)}」已分配。推进人：${ownerName}；复核人：${reviewerName}；截止时间：${task.dueDate}。`,
        category: "待处理",
        time: task.createdAt || task.updatedAt,
        tone: "blue",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: "OKR 系统",
        actorId: "okr-system",
        recipientIds: [ownerId]
      });
    }

    if (isApprovedForClosedLoop && !hasEnteredReviewFlow) {
      items.push({
        id: `approval-approved-${task.id}`,
        title: "待办签批通过",
        content: `会议《${meetingTitle}》的待办「${getTaskContent(task)}」已进入正式会议闭环台账。推进人：${ownerName}；复核人：${reviewerName}；当前状态：${getTaskStatusLabel(task.status)}。`,
        category: "签批通过",
        time: task.updatedAt || meeting?.createdAt || currentDateTime(),
        tone: "green",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: "林昱辰",
        actorId: getPresidentUserId(),
        recipientIds: uniqueIds([ownerId, reviewerId])
      });
    }

    if (task.status === "pending_review") {
      const reviewTargetStatus = inferReviewTargetStatus(task, activityLogs);
      const reviewTargetLabel = getReviewTargetLabel(reviewTargetStatus);
      const reviewEventTime = task.reviewSubmittedAt || task.updatedAt;
      items.push({
        id: `review-pending-${task.id}-${reviewEventTime}`,
        title: `待办已提交${reviewTargetLabel}复核`,
        content: `会议《${meetingTitle}》的待办「${getTaskContent(task)}」已由推进人 ${ownerName} 提交${reviewTargetLabel}，等待复核人 ${reviewerName} 确认。`,
        category: "待复核",
        time: reviewEventTime,
        tone: "amber",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: ownerName,
        actorId: ownerId,
        recipientIds: [reviewerId]
      });
    }

    if (task.reviewedAt) {
      items.push({
        id: `review-approved-${task.id}-${task.reviewedAt}`,
        title: "待办复核通过",
        content: isTaskCompleted(task)
          ? `会议《${meetingTitle}》的待办「${getTaskContent(task)}」已由复核人 ${reviewerName} 确认完成，并正式归档。推进人：${ownerName}。`
          : `会议《${meetingTitle}》的待办「${getTaskContent(task)}」已由复核人 ${reviewerName} 确认进度，当前继续推进。推进人：${ownerName}。`,
        category: "复核通过",
        time: task.reviewedAt,
        tone: "green",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: reviewerName,
        actorId: reviewerId,
        recipientIds: [ownerId]
      });
    }

    if (task.reviewRejectedAt) {
      items.push({
        id: `review-rejected-${task.id}-${task.reviewRejectedAt}`,
        title: "待办复核驳回",
        content: `会议《${meetingTitle}》的待办「${getTaskContent(task)}」被复核人 ${reviewerName} 驳回。原因：${task.reviewRejectedReason || "请补充完成内容后重新提交复核。"}`,
        category: "驳回修改",
        time: task.reviewRejectedAt,
        tone: "red",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: reviewerName,
        actorId: reviewerId,
        recipientIds: [ownerId]
      });
    }

    if (task.companySupportStatus === "completed") {
      items.push({
        id: `support-completed-${task.id}`,
        title: "公司支持事项已完成",
        content: `会议《${meetingTitle}》的公司支持事项「${task.companySupportRequest || getTaskContent(task)}」已标记为已完成，可继续推进对应待办。推进人：${ownerName}。`,
        category: "公司支持",
        time: task.companySupportCompletedAt || task.updatedAt,
        tone: "blue",
        meetingId: task.meetingId,
        taskId: task.id,
        actor: "总裁办",
        actorId: getPresidentUserId(),
        recipientIds: [ownerId]
      });
    }
  });

  return items.sort((a, b) => getNotificationTimeValue(b.time) - getNotificationTimeValue(a.time));
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function buildAiSummary(title: string, departmentId: string, rawTranscript: string) {
  const department = findDepartment(departmentId)?.name ?? "相关部门";
  const transcript = rawTranscript.trim();
  const focus =
    departmentId === "dept-store"
      ? "门店执行、客户需求沉淀和异常预警"
      : departmentId === "dept-after-sales"
        ? "售后根因、责任动作和风险前置"
        : departmentId === "dept-rd"
          ? "产品需求判断、样板验证和跨部门输入"
          : departmentId === "dept-it"
            ? "系统流程、数据台账和状态回写"
            : "会议结论、责任分工和执行闭环";

  return {
    summary: `${title} 已由模拟 AI 整理为标准会议纪要。本次会议由 ${department} 发起，核心围绕${focus}展开。系统从原始记录中识别出需要落地的管理动作，并同步生成责任人、截止日期和优先级，便于进入统一待办台账追踪。${transcript ? ` 原始记录重点包括：${transcript.slice(0, 96)}${transcript.length > 96 ? "..." : ""}` : ""}`,
    conclusions: [
      "会议事项需要沉淀为可追踪任务，避免只停留在口头同步。",
      "跨部门事项要明确责任人、协同部门和截止日期。",
      "管理驾驶舱应持续关注逾期、临期和无产出的异常会议。"
    ]
  };
}

function buildGeneratedTasks(meeting: Meeting): Task[] {
  const baseDate = "2026-06-25";
  const taskMap: Record<string, Array<{ title: string; description: string; ownerId: string; departmentId: string; priority: Priority; dueDate: string }>> = {
    "dept-store": [
      {
        title: "汇总门店本周客户需求和异常订单",
        description: "从本次门店会议中整理客户需求、客诉风险和需要总部支持的事项。",
        ownerId: "u-meifeng",
        departmentId: "dept-store",
        priority: "高",
        dueDate: "2026-06-22"
      },
      {
        title: "同步门店 SOP 执行问题给培训部",
        description: "把会议中出现的客户需求表漏填、截图补交等问题整理成培训输入。",
        ownerId: "u-caizhiwen",
        departmentId: "dept-training",
        priority: "中",
        dueDate: baseDate
      }
    ],
    "dept-it": [
      {
        title: "确认会议闭环系统的数据字段和页面路径",
        description: "沉淀会议、待办、用户、部门四类核心数据结构，并标注后续接口需求。",
        ownerId: "u-liwen",
        departmentId: "dept-it",
        priority: "高",
        dueDate: "2026-06-21"
      },
      {
        title: "输出企业微信嵌入演示说明",
        description: "说明 Demo 如何作为企业微信内部应用承载会议和待办流程。",
        ownerId: "u-caizhiwen",
        departmentId: "dept-training",
        priority: "中",
        dueDate: baseDate
      }
    ],
    "dept-rd": [
      {
        title: "整理会议中出现的产品需求关键词",
        description: "把产品、颜色、板材和客户偏好关键词汇总，形成研发输入。",
        ownerId: "u-yexin",
        departmentId: "dept-rd",
        priority: "中",
        dueDate: baseDate
      }
    ],
    "dept-after-sales": [
      {
        title: "复盘本次会议提到的售后根因",
        description: "把量尺、需求沟通、交期等问题拆成可检查动作。",
        ownerId: "u-jiangwenxuan",
        departmentId: "dept-after-sales",
        priority: "高",
        dueDate: "2026-06-23"
      },
      {
        title: "补充设计端风险检查动作",
        description: "将售后复盘结果同步到设计部门，更新量尺和方案确认检查项。",
        ownerId: "u-huaizhu",
        departmentId: "dept-design",
        priority: "中",
        dueDate: baseDate
      }
    ]
  };

  const templates =
    taskMap[meeting.departmentId] ??
    [
      {
        title: "整理会议结论并分发执行动作",
        description: "将本次会议结论整理为跨部门可执行待办。",
        ownerId: meeting.hostId,
        departmentId: meeting.departmentId,
        priority: "中" as Priority,
        dueDate: baseDate
      }
    ];

  return templates.map((template, index) => ({
    id: nextId("t"),
    title: template.title,
    description: template.description,
    meetingId: meeting.id,
    ownerId: template.ownerId,
    departmentId: template.departmentId,
    collaboratorDepartmentIds: template.departmentId === meeting.departmentId ? [] : [meeting.departmentId],
    dueDate: template.dueDate,
    priority: template.priority,
    status: index === 0 ? "进行中" : "未开始",
    createdAt: currentDateTime(),
    updatedAt: currentDateTime()
  }));
}

function minutesBetween(start: string, end: string) {
  if (!start || !end) return 0;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) return 0;
  return Math.round((endTime - startTime) / 60000);
}

function formatDateTime(value: string) {
  if (!value) return "";
  return value.replace("T", " ");
}

function formatDateTimeForInput(value: string) {
  if (!value) return "";
  return value.replace("T", " ").replaceAll("-", "/");
}

function parseDateTimeText(value: string) {
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function buildAiClosedLoopTemplate(input: {
  meetingId: string;
  title: string;
  departmentId: string;
  hostId: string;
  transcript: string;
  meetingDate: string;
  meetingType?: string;
  participantNames?: string[];
  okrProjectName?: string;
}): {
  aiSummary: string;
  minuteMarkdown: string;
  decisions: MeetingDecision[];
  tasks: Task[];
} {
  const department = findDepartment(input.departmentId)?.name ?? "相关部门";
  const transcript = input.transcript.trim();
  const participantText = input.participantNames?.length ? input.participantNames.join("、") : "未选择参会人员";
  const meetingType = input.meetingType || "未填写";
  const okrProjectName = input.okrProjectName || "无";
  const sourceText = transcript ? transcript.slice(0, 80) : "会议文稿中识别出的执行动作";
  const firstOwner = input.departmentId === "dept-it" ? "u-liwen" : findDepartment(input.departmentId)?.managerId ?? input.hostId;
  const secondOwner = input.departmentId === "dept-store" ? "u-caizhiwen" : "u-huaizhu";
  const secondDepartment = input.departmentId === "dept-store" ? "dept-training" : "dept-design";
  const createdAt = currentDateTime();
  const startDate = input.meetingDate;

  const tasks: Task[] = [
    {
      id: nextId("pending-task"),
      meetingId: input.meetingId,
      content: `落实${department}本次会议的核心执行事项`,
      title: `落实${department}本次会议的核心执行事项`,
      description: "由 AI 会议闭环模板生成，主管可在提交前修正。",
      owner: firstOwner,
      ownerId: firstOwner,
      ownerDepartment: input.departmentId,
      departmentId: input.departmentId,
      reviewerId: input.hostId,
      collaboratorDepartments: input.departmentId === "dept-it" ? ["dept-president"] : ["dept-it"],
      collaboratorDepartmentIds: input.departmentId === "dept-it" ? ["dept-president"] : ["dept-it"],
      startDate,
      dueDate: addDaysToDateKey(startDate, 3),
      goal: "在截止时间前输出可执行方案，并明确责任人、时间表和验收口径",
      status: "not_started",
      priority: "高",
      companySupportRequest: "",
      sourceText,
      approvalStatus: "pending_president_approval",
      createdAt,
      updatedAt: createdAt
    },
    {
      id: nextId("pending-task"),
      meetingId: input.meetingId,
      content: "整理跨部门协同清单并同步责任部门",
      title: "整理跨部门协同清单并同步责任部门",
      description: "明确协同部门、完成时间和异常反馈机制。",
      owner: secondOwner,
      ownerId: secondOwner,
      ownerDepartment: secondDepartment,
      departmentId: secondDepartment,
      reviewerId: input.hostId,
      collaboratorDepartments: [input.departmentId],
      collaboratorDepartmentIds: [input.departmentId],
      startDate,
      dueDate: addDaysToDateKey(startDate, 5),
      goal: "形成跨部门协同清单，至少明确 3 个关键动作和对应完成时间",
      status: "not_started",
      priority: "中",
      companySupportRequest: "",
      sourceText,
      approvalStatus: "pending_president_approval",
      createdAt,
      updatedAt: createdAt
    }
  ];

  const aiSummary = `${input.title} 已套用“统一会议闭环模板”。会议重点围绕 ${department} 的执行问题、跨部门协同和后续追踪动作展开。系统已从会议文稿中模拟提取决策和待办，当前内容需由部门主管修正后提交总裁签批。${transcript ? ` 文稿重点：${transcript.slice(0, 110)}${transcript.length > 110 ? "..." : ""}` : ""}`;
  const decisions: MeetingDecision[] = [
      {
        id: nextId("decision"),
        content: "本次会议形成的执行动作需进入统一会议闭环流程",
        ownerId: input.hostId,
        impactScope: `${department}及相关协同部门`,
        needPresidentConfirmation: true
      },
      {
        id: nextId("decision"),
        content: "责任人需按截止时间更新任务状态，异常事项提前反馈",
        ownerId: firstOwner,
        impactScope: "任务责任人、部门主管、管理驾驶舱",
        needPresidentConfirmation: false
      }
    ];
  const minuteMarkdown = [
    "# 简化版智能会议纪要",
    "",
    "## 一、会议基础信息",
    "",
    "| 项目 | 内容 |",
    "|---|---|",
    `| 会议名称 | ${input.title} |`,
    `| 会议日期 | ${input.meetingDate} |`,
    `| 会议类型 | ${meetingType} |`,
    `| 所属业务范围 | ${department} |`,
    `| 主持人 | ${findUser(input.hostId)?.name ?? input.hostId} |`,
    `| 参会人 | ${participantText} |`,
    "| 记录人 | AI 会议闭环系统 |",
    `| 关联对象 | ${okrProjectName} |`,
    "",
    "## 二、会议摘要",
    "",
    aiSummary,
    "",
    "## 三、会议主要讨论点",
    "",
    "| 讨论编号 | 讨论主题 | 背景事实 | 核心问题 | 主要观点 | 涉及对象 | 初步结论 |",
    "|---|---|---|---|---|---|---|",
    `| 讨论-001 | ${department}执行事项闭环 | ${sourceText} | 如何把会议内容转为可复核待办 | 需要明确推进人、复核人、截止时间和验收标准 | ${department} | 进入会议闭环系统跟踪 |`,
    "| 讨论-002 | 跨部门协同同步 | 会议中存在跨部门配合事项 | 如何避免责任边界不清 | 需要形成协同清单并同步责任部门 | 相关协同部门 | 建立协同任务并纳入复核 |",
    "",
    "## 四、会议形成的决策",
    "",
    "| 决策编号 | 对应讨论编号 | 决策内容 | 决策人 | 决策依据 | 影响范围 | 复盘时间 |",
    "|---|---|---|---|---|---|---|",
    ...decisions.map((decision, index) => `| 决策-${String(index + 1).padStart(3, "0")} | 讨论-${String(index + 1).padStart(3, "0")} | ${decision.content} | ${findUser(decision.ownerId)?.name ?? decision.ownerId} | 会议文稿和主管确认 | ${decision.impactScope} | 待办完成后复盘 |`),
    "",
    "## 五、会议待办事项",
    "",
    "| 待办编号 | 来源决策 | 待办事项 | 待办推进人 | 待办复核人 | 截止时间 | 交付结果 | 验收标准 | 当前状态 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...tasks.map((task, index) => `| 待办-${String(index + 1).padStart(3, "0")} | 决策-${String(Math.min(index + 1, decisions.length)).padStart(3, "0")} | ${getTaskContent(task)} | ${findUser(task.ownerId ?? "")?.name ?? task.ownerId ?? "待确认"} | ${findUser(task.reviewerId ?? "")?.name ?? task.reviewerId ?? "待确认"} | ${task.dueDate} | ${task.title} | ${task.goal} | 未开始 |`),
    "",
    "## 六、检索标签",
    "",
    "| 标签类型 | 内容 |",
    "|---|---|",
    `| 会议关键词 | ${input.title}、${department}、会议闭环 |`,
    `| 涉及部门 | ${department} |`,
    "| 涉及门店 | 待补充 |",
    "| 涉及客户 | 待补充 |",
    "| 涉及项目 | 待补充 |",
    "| 涉及订单 | 待补充 |",
    "| 问题类型 | 执行闭环 / 协同推进 |",
    "| 风险等级 | 中 |"
  ].join("\n");

  return { aiSummary, minuteMarkdown, decisions, tasks };
}

function isMarkdownTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const strongMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (strongMatch) {
      return <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-[#162A46]">{strongMatch[1]}</strong>;
    }
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>;
  });
}

function MarkdownView({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed === "---") {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("|") && lines[index + 1] && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = splitMarkdownTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="my-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={`${header}-${headerIndex}`} className="border-b border-line px-3 py-2 font-semibold">
                    {renderInlineMarkdown(header, `th-${index}-${headerIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-b border-line last:border-b-0">
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-slate-700">
                      {renderInlineMarkdown(row[cellIndex] || "", `td-${index}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(<h1 key={`h1-${index}`} className="mb-4 text-xl font-semibold text-[#162A46]">{trimmed.replace(/^#\s+/, "")}</h1>);
      index += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(<h2 key={`h2-${index}`} className="mb-3 mt-5 border-l-4 border-brand pl-3 text-lg font-semibold text-[#162A46]">{trimmed.replace(/^##\s+/, "")}</h2>);
      index += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(<h3 key={`h3-${index}`} className="mb-2 mt-4 text-base font-semibold text-[#162A46]">{trimmed.replace(/^###\s+/, "")}</h3>);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      blocks.push(<blockquote key={`quote-${index}`} className="my-3 rounded-lg border-l-4 border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-7 text-blue-900">{trimmed.replace(/^>\s?/, "")}</blockquote>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && (/^[-*]\s+/.test(lines[index].trim()) || /^\d+\.\s+/.test(lines[index].trim()))) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="my-3 list-disc space-y-1 pl-5 text-sm leading-7 text-slate-700">
          {items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item, `li-${index}-${itemIndex}`)}</li>)}
        </ul>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith("#") &&
      !lines[index].trim().startsWith("|") &&
      !lines[index].trim().startsWith(">") &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`} className="my-2 text-sm leading-7 text-slate-700">{renderInlineMarkdown(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return <div className="meeting-markdown">{blocks}</div>;
}

function normalizeMeetingsWithFormalTasks(meetings: Meeting[], tasks: Task[]) {
  const formalTaskIds = new Set(tasks.filter(isFormalTask).map((task) => task.id));
  return meetings.map((meeting) => {
    if (!meeting.tasks?.length) return meeting;
    const approvalDraftTasks = meeting.tasks.filter((task) => !formalTaskIds.has(task.id));
    return approvalDraftTasks.length === meeting.tasks.length ? meeting : { ...meeting, tasks: approvalDraftTasks };
  });
}

function normalizeTaskReviewTargets(tasks: Task[], activityLogs: ActivityLog[] = []) {
  return tasks.map((task) => {
    if (task.status !== "pending_review" || task.reviewTargetStatus) return task;
    return {
      ...task,
      reviewTargetStatus: inferReviewTargetStatus(task, activityLogs)
    };
  });
}

function normalizeTaskIdentityFields(tasks: Task[], meetings: Meeting[] = []) {
  return tasks.map((task) => {
    const meeting = findMeeting(meetings, task.meetingId);
    const ownerId = getTaskOwnerId(task);
    const departmentId = getUserDepartmentId(ownerId) ?? getTaskDepartmentId(task);
    const reviewerId = getTaskReviewerId({ ...task, owner: ownerId, ownerId, ownerDepartment: departmentId, departmentId }, meeting);
    return {
      ...task,
      owner: ownerId,
      ownerId,
      ownerDepartment: departmentId,
      departmentId,
      reviewerId
    };
  });
}

function parseStateTime(value?: string) {
  if (!value) return 0;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getStateSnapshotTimestamp(snapshot: StateApiResponse) {
  const taskTimes = snapshot.tasks?.map((task) => parseStateTime(task.updatedAt) || parseStateTime(task.createdAt)) ?? [];
  const meetingTimes = snapshot.meetings?.map((meeting) => parseStateTime(meeting.createdAt) || parseStateTime(meeting.approvedAt)) ?? [];
  const logTimes = snapshot.activityLogs?.map((log) => parseStateTime(log.createdAt)) ?? [];
  return Math.max(parseStateTime(snapshot.savedAt), parseStateTime(snapshot.updatedAt), ...taskTimes, ...meetingTimes, ...logTimes, 0);
}

function normalizeStateSnapshot(snapshot: StateApiResponse) {
  const parsedLogs = Array.isArray(snapshot.activityLogs) ? snapshot.activityLogs : [];
  const normalizedTasks = Array.isArray(snapshot.tasks) ? normalizeTaskReviewTargets(normalizeTaskIdentityFields(snapshot.tasks, snapshot.meetings ?? []), parsedLogs) : undefined;
  return {
    meetings: Array.isArray(snapshot.meetings) ? normalizeMeetingsWithFormalTasks(snapshot.meetings, normalizedTasks ?? []) : undefined,
    tasks: normalizedTasks,
    activityLogs: Array.isArray(snapshot.activityLogs) ? snapshot.activityLogs : undefined,
    notificationReadIds: Array.isArray(snapshot.notificationReadIds) ? snapshot.notificationReadIds.filter((item): item is string => typeof item === "string") : undefined,
    stateScope: snapshot.stateScope
  };
}

export default function MeetingLoopDemo() {
  const [activePage, setActivePage] = useState<PageKey>("new-meeting");
  const [selectedMeetingId, setSelectedMeetingId] = useState(seedMeetings[0]?.id ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [loginUserId, setLoginUserId] = useState("emp-zc25003");
  const [viewUserId, setViewUserId] = useState("emp-zc25003");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(defaultMeetingDepartmentId);
  const [meetingItems, setMeetingItems] = useState<Meeting[]>(seedMeetings);
  const [taskItems, setTaskItems] = useState<Task[]>(seedTasks);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [okrProjectItems, setOkrProjectItems] = useState<OkrProject[]>([]);
  const [okrTaskStatusOverrides, setOkrTaskStatusOverrides] = useState<Record<string, TaskStatus>>({});
  const [okrTaskCompletionItems, setOkrTaskCompletionItems] = useState<Record<string, string[]>>({});
  const [okrKrStatusOverrides, setOkrKrStatusOverrides] = useState<Record<string, OkrKrStatus>>({});
  const [notificationReadIds, setNotificationReadIds] = useState<string[]>([]);
  const [notificationMode, setNotificationMode] = useState<"mine" | "all">("mine");
  const [uiTheme, setUiTheme] = useState<UiTheme>("light");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isSyncingLocalData, setIsSyncingLocalData] = useState(false);
  const [localDataError, setLocalDataError] = useState("");
  const [canWriteSharedState, setCanWriteSharedState] = useState(false);
  const [loadedStateScope, setLoadedStateScope] = useState<"full" | "visible">("full");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationReadUserRef = useRef(loginUserId);
  const deepLinkHandledRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    function readBrowserBackup() {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return undefined;
      try {
        const parsed = JSON.parse(saved) as StateApiResponse;
        if (parsed.stateScope !== "full") return undefined;
        if (!parsed.meetings?.length && !parsed.tasks?.length && !parsed.activityLogs?.length) return undefined;
        const seedTaskMap = new Map(seedTasks.map((task) => [task.id, task]));
        return {
          ...parsed,
          tasks: parsed.tasks?.map((task) => ({
            ...seedTaskMap.get(task.id),
            ...task,
            dueDate: task.id === "t-demo-prototype" ? seedTaskMap.get(task.id)?.dueDate ?? task.dueDate : task.dueDate,
            companySupportRequest: task.companySupportRequest ?? seedTaskMap.get(task.id)?.companySupportRequest
          }))
        } satisfies StateApiResponse;
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        return undefined;
      }
    }

    function applySnapshot(snapshot: StateApiResponse, userId?: string) {
      const normalized = normalizeStateSnapshot(snapshot);
      if (Array.isArray(normalized.meetings)) setMeetingItems(normalized.meetings);
      if (Array.isArray(normalized.tasks)) setTaskItems(normalized.tasks);
      if (Array.isArray(normalized.activityLogs)) setActivityLogs(normalized.activityLogs);
      setLoadedStateScope(normalized.stateScope ?? "full");
      if (Array.isArray(normalized.notificationReadIds)) {
        setNotificationReadIds(normalized.notificationReadIds);
        if (userId) {
          window.localStorage.setItem(getUserScopedStorageKey(NOTIFICATION_READ_STORAGE_KEY, userId), JSON.stringify(normalized.notificationReadIds));
          notificationReadUserRef.current = userId;
        }
      }
    }

    async function loginOnServer(userId: string) {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      if (!response.ok) throw new Error(`POST /api/auth/login ${response.status}`);
      const parsed = (await response.json()) as AuthUserResponse;
      if (!parsed.user || !findUser(parsed.user.id)) throw new Error("POST /api/auth/login returned invalid user");
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, parsed.user.id);
      setLoginUserId(parsed.user.id);
      if (parsed.user.role !== "总裁") {
        setViewUserId(parsed.user.id);
        window.localStorage.setItem(VIEW_USER_STORAGE_KEY, parsed.user.id);
      }
      setCanWriteSharedState(parsed.user.role === "总裁");
      return parsed.user;
    }

    async function ensureServerLogin() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (response.ok) {
          const parsed = (await response.json()) as AuthUserResponse;
          if (parsed.user && findUser(parsed.user.id)) {
            window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, parsed.user.id);
            setLoginUserId(parsed.user.id);
            if (parsed.user.role !== "总裁") {
              setViewUserId(parsed.user.id);
              window.localStorage.setItem(VIEW_USER_STORAGE_KEY, parsed.user.id);
            }
            setCanWriteSharedState(parsed.user.role === "总裁");
            return parsed.user;
          }
        }
      } catch {
        // Fall back to a fresh temporary login below.
      }

      const savedUserId = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      const userId = savedUserId && findUser(savedUserId) ? savedUserId : getPresidentUserId();
      return loginOnServer(userId);
    }

    async function loadLocalData() {
      const browserSnapshot = readBrowserBackup();
      try {
        const currentUser = await ensureServerLogin();
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`GET /api/state ${response.status}`);
        const parsed = (await response.json()) as StateApiResponse;
        const okrResponse = await fetch("/api/okr/projects", { cache: "no-store" }).catch(() => undefined);
        const parsedOkr = okrResponse?.ok ? ((await okrResponse.json()) as OkrProjectsApiResponse) : undefined;
        if (cancelled) return;
        const snapshot =
          currentUser.role === "总裁" && browserSnapshot && getStateSnapshotTimestamp(browserSnapshot) > getStateSnapshotTimestamp(parsed)
            ? browserSnapshot
            : parsed;
        applySnapshot(snapshot, currentUser.id);
        if (Array.isArray(parsedOkr?.projects)) {
          setOkrProjectItems(parsedOkr.projects.map(normalizeOkrProjectIdentity));
        }
        setLocalDataError("");
      } catch {
        if (!cancelled) {
          if (browserSnapshot) {
            applySnapshot(browserSnapshot);
            setLocalDataError("数据库读取失败，当前使用浏览器备份。");
          } else {
            setLocalDataError("数据库读取失败，当前使用初始演示数据。");
          }
        }
      } finally {
        if (!cancelled) setHasLoaded(true);
      }
    }

    void loadLocalData();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const savedUserId = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (!savedUserId) return;
    if (findUser(savedUserId)) {
      setLoginUserId(savedUserId);
    } else {
      window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const savedViewUserId = window.localStorage.getItem(VIEW_USER_STORAGE_KEY);
    if (savedViewUserId && findUser(savedViewUserId)) {
      setViewUserId(savedViewUserId);
    }
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "dark" || savedTheme === "light") setUiTheme(savedTheme);
  }, []);

  useEffect(() => {
    const scopedReadKey = getUserScopedStorageKey(NOTIFICATION_READ_STORAGE_KEY, loginUserId);
    const scopedReadIds = window.localStorage.getItem(scopedReadKey);
    const legacyReadIds = window.localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY);
    const savedReadIds = scopedReadIds ?? legacyReadIds;
    try {
      const parsed = savedReadIds ? JSON.parse(savedReadIds) : [];
      if (Array.isArray(parsed)) {
        const readIds = parsed.filter((item): item is string => typeof item === "string");
        setNotificationReadIds((current) => (notificationReadUserRef.current === loginUserId ? [...new Set([...current, ...readIds])] : readIds));
        if (!scopedReadIds && legacyReadIds) {
          window.localStorage.setItem(scopedReadKey, JSON.stringify(readIds));
          window.localStorage.removeItem(NOTIFICATION_READ_STORAGE_KEY);
        }
      } else {
        setNotificationReadIds([]);
      }
    } catch {
      window.localStorage.removeItem(scopedReadKey);
      window.localStorage.removeItem(NOTIFICATION_READ_STORAGE_KEY);
      setNotificationReadIds([]);
    }
    notificationReadUserRef.current = loginUserId;
  }, [loginUserId]);

  useEffect(() => {
    if (!hasLoaded) return;
    setTaskItems((current) => {
      const normalized = normalizeTaskIdentityFields(current, meetingItems);
      const changed = normalized.some((task, index) => {
        const original = current[index];
        return (
          task.owner !== original.owner ||
          task.ownerId !== original.ownerId ||
          task.ownerDepartment !== original.ownerDepartment ||
          task.departmentId !== original.departmentId ||
          task.reviewerId !== original.reviewerId
        );
      });
      return changed ? normalized : current;
    });
  }, [hasLoaded, meetingItems]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    if (!hasLoaded) return;
    if (notificationReadUserRef.current !== loginUserId) return;
    window.localStorage.setItem(getUserScopedStorageKey(NOTIFICATION_READ_STORAGE_KEY, loginUserId), JSON.stringify(notificationReadIds));
    void fetch("/api/notifications/read", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readIds: notificationReadIds })
    })
      .then((response) => {
        if (!response.ok) throw new Error(`PUT /api/notifications/read ${response.status}`);
        setLocalDataError("");
      })
      .catch(() => {
        setLocalDataError("通知已读状态保存到数据库失败，浏览器备份仍可用。");
      });
  }, [hasLoaded, notificationReadIds, loginUserId]);

  useEffect(() => {
    if (!hasLoaded) return;
    if (!canWriteSharedState) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      return;
    }
    if (loadedStateScope !== "full") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ stateScope: "full", savedAt: new Date().toISOString(), meetings: meetingItems, tasks: taskItems, activityLogs }));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setIsSyncingLocalData(false);
  }, [activityLogs, canWriteSharedState, hasLoaded, loadedStateScope, meetingItems, taskItems]);

  const pendingApprovalTasks = useMemo(
    () =>
      meetingItems.flatMap((meeting) =>
        (meeting.tasks ?? [])
          .filter((task) => task.approvalStatus === "pending_president_approval")
          .map((task) => ({ ...task, meetingId: meeting.id }))
      ),
    [meetingItems]
  );
  const rejectedApprovalTasks = useMemo(
    () =>
      meetingItems.flatMap((meeting) =>
        (meeting.tasks ?? [])
          .filter((task) => task.approvalStatus === "rejected")
          .map((task) => ({ ...task, meetingId: meeting.id }))
      ),
    [meetingItems]
  );
  const okrTodoTasks = useMemo(() => buildOkrTodoTasks(okrProjectItems, okrTaskStatusOverrides, okrTaskCompletionItems), [okrProjectItems, okrTaskStatusOverrides, okrTaskCompletionItems]);
  const okrKrReviewTasks = useMemo(() => buildOkrKrReviewTasks(okrProjectItems, okrKrStatusOverrides, okrTaskStatusOverrides), [okrProjectItems, okrKrStatusOverrides, okrTaskStatusOverrides]);
  const okrProjectApprovalTasks = useMemo(() => buildOkrProjectApprovalTasks(okrProjectItems), [okrProjectItems]);
  const formalTasks = useMemo(
    () => [...taskItems.filter(isFormalTask), ...okrProjectApprovalTasks, ...okrTodoTasks, ...okrKrReviewTasks],
    [taskItems, okrProjectApprovalTasks, okrTodoTasks, okrKrReviewTasks]
  );
  const activeLoginUser = findUser(loginUserId) ?? users[0];
  const activeAccount = useMemo(() => createAccountForUser(activeLoginUser), [activeLoginUser]);
  const activeAccountUser = getAccountUser(activeAccount);
  const activeViewUser = activeAccount.id === "president" ? findUser(viewUserId) ?? activeAccountUser : activeAccountUser;
  const loginUserOptions = useMemo(
    () =>
      users.map((user) => {
        const department = findDepartment(user.departmentId);
        return {
          value: user.id,
          label: userOptionLabel(user),
          meta: [department?.name, user.role, user.employeeNo].filter(Boolean).join(" · "),
          searchText: userSearchText(user, department)
        };
      }),
    []
  );
  const accessibleNavItems = navItems.filter((item) => canAccessPage(activeAccount, item.key));
  const visibleTasks = useMemo(() => formalTasks.filter((task) => canViewTask(activeAccount, task, meetingItems)), [activeAccount, formalTasks, meetingItems]);
  const visibleOkrProjects = useMemo(() => okrProjectItems.filter((project) => canViewOkrProject(activeAccount, project)), [activeAccount, okrProjectItems]);
  const visibleMeetings = useMemo(() => meetingItems.filter((meeting) => canViewMeeting(activeAccount, meeting, formalTasks)), [activeAccount, formalTasks, meetingItems]);
  const visiblePendingApprovalTasks = useMemo(() => pendingApprovalTasks.filter((task) => canViewTask(activeAccount, task, meetingItems)), [activeAccount, meetingItems, pendingApprovalTasks]);
  const visibleRejectedApprovalTasks = useMemo(() => rejectedApprovalTasks.filter((task) => canViewTask(activeAccount, task, meetingItems)), [activeAccount, meetingItems, rejectedApprovalTasks]);
  const visibleNotificationMeetings = useMemo(
    () =>
      visibleMeetings.map((meeting) => ({
        ...meeting,
        tasks: (meeting.tasks ?? []).filter((task) => canViewTask(activeAccount, task, meetingItems))
      })),
    [activeAccount, meetingItems, visibleMeetings]
  );
  const allNotifications = useMemo(
    () => (hasLoaded ? buildNotifications(visibleNotificationMeetings, visibleTasks, activityLogs) : []),
    [activeAccountUser.id, hasLoaded, visibleNotificationMeetings, visibleTasks, activityLogs]
  );
  const visibleNotifications = useMemo(
    () =>
      notificationMode === "all" && activeAccount.id === "president"
        ? allNotifications
        : allNotifications.filter((item) => isNotificationForUser(item, activeAccountUser.id)),
    [activeAccount.id, activeAccountUser.id, allNotifications, notificationMode]
  );
  const unreadNotificationCount = visibleNotifications.filter((item) => isNotificationUnread(item, notificationReadIds, activeAccountUser.id)).length;
  const selectedVisibleMeeting = findMeeting(visibleMeetings, selectedMeetingId) ?? visibleMeetings[0] ?? meetingItems[0];

  useEffect(() => {
    if (!canAccessPage(activeAccount, activePage)) {
      setActivePage("notifications");
      setSelectedTaskId(undefined);
    }
  }, [activeAccount, activePage]);

  useEffect(() => {
    if (activeAccount.id === "manager") {
      setSelectedDepartmentId(activeAccountUser.departmentId);
    }
  }, [activeAccount.id, activeAccountUser.departmentId]);

  const metrics = useMemo(() => {
    const completed = visibleTasks.filter(isTaskCompleted).length;
    const overdue = visibleTasks.filter(isOverdue).length;
    const dueSoon = visibleTasks.filter(isDueSoon).length;
    const totalDuration = visibleMeetings.reduce((sum, meeting) => sum + meeting.durationMinutes, 0);
    return {
      meetings: visibleMeetings.length,
      totalDuration,
      tasks: visibleTasks.length,
      completed,
      overdue,
      dueSoon,
      completionRate: visibleTasks.length ? completed / visibleTasks.length : 0
    };
  }, [visibleMeetings, visibleTasks]);

  function navigate(page: PageKey, targetId?: string) {
    if (!canAccessPage(activeAccount, page)) {
      setActivePage("notifications");
      setSelectedTaskId(undefined);
      return;
    }
    if (page === "meeting-detail" && targetId) setSelectedMeetingId(targetId);
    if (page === "tasks" || page === "my-tasks") {
      setSelectedTaskId(targetId);
    } else {
      setSelectedTaskId(undefined);
    }
    setActivePage(page);
  }

  useEffect(() => {
    if (!hasLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page") as PageKey | null;
    const taskId = params.get("taskId") || undefined;
    if (!page && !taskId) return;
    const targetPage: PageKey = page === "tasks" || page === "my-tasks" || page === "notifications" ? page : "my-tasks";
    const key = `${targetPage}:${taskId ?? ""}:${activeAccountUser.id}`;
    if (deepLinkHandledRef.current === key) return;
    deepLinkHandledRef.current = key;
    navigate(targetPage, taskId);
    window.history.replaceState(null, "", window.location.pathname);
  }, [activeAccountUser.id, hasLoaded]);

  function loginAsUser(userId: string) {
    const nextUser = findUser(userId);
    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, userId);
    setLoginUserId(userId);
    setViewUserId(userId);
    window.localStorage.setItem(VIEW_USER_STORAGE_KEY, userId);
    setCanWriteSharedState(false);
    setIsAccountMenuOpen(false);
    void fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    })
      .then((response) => {
        if (!response.ok) throw new Error(`POST /api/auth/login ${response.status}`);
        setLocalDataError("");
        window.location.reload();
      })
      .catch(() => {
        setCanWriteSharedState(nextUser?.role === "总裁");
        setLocalDataError("临时登录写入失败，请刷新后重试。");
      });
  }

  function viewAsUser(userId: string) {
    if (!findUser(userId)) return;
    setViewUserId(userId);
    window.localStorage.setItem(VIEW_USER_STORAGE_KEY, userId);
  }

  function getSaveErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("forbidden")) return "保存失败：当前账号没有权限执行此操作。";
    if (message.includes("not_found")) return "保存失败：任务不存在或已被删除，请刷新后重试。";
    if (message.includes("not authenticated")) return "保存失败：登录已失效，请重新登录。";
    return "保存到数据库失败，请刷新后重试。";
  }

  async function persistTaskAction(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as { task?: Task; error?: string };
    if (!response.ok) throw new Error(payload.error ?? `${path} ${response.status}`);
    return payload;
  }

  function persistAndMergeTaskAction(path: string, body: unknown) {
    void persistTaskAction(path, body)
      .then(({ task }) => {
        mergeServerTask(task);
        setLocalDataError("");
      })
      .catch((error) => {
        setLocalDataError(getSaveErrorMessage(error));
      });
  }

  function mergeServerTask(task?: Task) {
    if (!task) return;
    setTaskItems((current) => (current.some((item) => item.id === task.id) ? current.map((item) => (item.id === task.id ? task : item)) : [task, ...current]));
    setMeetingItems((current) =>
      current.map((meeting) => ({
        ...meeting,
        tasks: meeting.tasks?.map((item) => (item.id === task.id ? task : item))
      }))
    );
  }

  function persistMeetingSubmission(meeting: Meeting) {
    void fetch("/api/meetings/approval-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting })
    })
      .then((response) => {
        if (!response.ok) throw new Error(`POST /api/meetings/approval-submissions ${response.status}`);
        setLocalDataError("");
      })
      .catch(() => {
        setLocalDataError("会议提交签批保存到数据库失败，请刷新后重试。");
      });
  }

  function persistMeetingApproval(meetingId: string, body: unknown) {
    void fetch(`/api/meetings/${encodeURIComponent(meetingId)}/approval`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then((response) => {
        if (!response.ok) throw new Error(`PATCH /api/meetings/${meetingId}/approval ${response.status}`);
        setLocalDataError("");
      })
      .catch(() => {
        setLocalDataError("会议签批保存到数据库失败，请刷新后重试。");
      });
  }

  function markNotificationRead(notificationId: string) {
    setNotificationReadIds((current) => (current.includes(notificationId) ? current : [...current, notificationId]));
  }

  function markAllNotificationsRead() {
    setNotificationReadIds(visibleNotifications.map((item) => item.id));
  }

  function recordActivityLog(input: Omit<ActivityLog, "id" | "createdAt"> & { createdAt?: string }) {
    const { createdAt, ...rest } = input;
    setActivityLogs((current) => [
      {
        id: nextId("activity"),
        createdAt: createdAt ?? currentDateTime(),
        ...rest
      },
      ...current
    ].slice(0, 300));
  }

  function applyOkrPdcaTaskPatch(taskId: string, patch: Partial<OkrPDCATask>) {
    const pdcaTaskId = getOkrPdcaTaskId(taskId);
    setOkrProjectItems((current) =>
      current.map((project) => ({
        ...project,
        pdcaTasks: project.pdcaTasks.map((task) => (task.id === pdcaTaskId ? { ...task, ...patch } : task))
      }))
    );
  }

  function mergeServerOkrPdcaTask(task?: OkrPDCATask) {
    if (!task) return;
    applyOkrPdcaTaskPatch(task.id, task);
    const localTaskId = `okr-task-${task.id}`;
    setOkrTaskStatusOverrides((current) => {
      const next = { ...current };
      delete next[localTaskId];
      return next;
    });
  }

  async function persistOkrPdcaTaskStatus(
    taskId: string,
    status: OkrTaskStatus,
    reviewTargetStatus?: OkrTaskStatus,
    reviewAction?: "submit" | "confirm" | "reject",
    reviewRejectedReason?: string,
    reviewRejectedItems?: string[]
  ) {
    const pdcaTaskId = getOkrPdcaTaskId(taskId);
    const response = await fetch(`/api/okr/pdca-tasks/${encodeURIComponent(pdcaTaskId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewTargetStatus, reviewAction, reviewRejectedReason, reviewRejectedItems })
    });
    const payload = (await response.json().catch(() => ({}))) as { task?: OkrPDCATask; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "okr_save_failed");
    return payload;
  }

  function persistAndMergeOkrPdcaTaskStatus(
    taskId: string,
    status: OkrTaskStatus,
    reviewTargetStatus?: OkrTaskStatus,
    reviewAction?: "submit" | "confirm" | "reject",
    reviewRejectedReason?: string,
    reviewRejectedItems?: string[]
  ) {
    void persistOkrPdcaTaskStatus(taskId, status, reviewTargetStatus, reviewAction, reviewRejectedReason, reviewRejectedItems)
      .then(({ task }) => {
        mergeServerOkrPdcaTask(task);
        setLocalDataError("");
      })
      .catch((error) => {
        setLocalDataError(getSaveErrorMessage(error));
      });
  }

  function persistOkrPdcaTaskCompletionItems(taskId: string, completionItems: string[]) {
    const pdcaTaskId = getOkrPdcaTaskId(taskId);
    void fetch(`/api/okr/pdca-tasks/${encodeURIComponent(pdcaTaskId)}/completion`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completionItems })
    }).catch(() => {
      setLocalDataError("OKR 任务填写内容保存到数据库失败，当前仅保留在本页会话。");
    });
  }

  function applyOkrKrStatus(krId: string, status: OkrKrStatus) {
    setOkrProjectItems((current) =>
      current.map((project) => ({
        ...project,
        krs: project.krs.map((kr) => (kr.id === krId ? { ...kr, status } : kr))
      }))
    );
  }

  function updateOkrKrStatus(krId: string, status: OkrKrStatus) {
    setOkrKrStatusOverrides((current) => ({ ...current, [krId]: status }));
    applyOkrKrStatus(krId, status);
    void fetch(`/api/okr/krs/${encodeURIComponent(krId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }).catch(() => {
      setLocalDataError("OKR KR 状态保存到数据库失败，当前仅保留在本页会话。");
    });
  }

  function updateOkrProjectStatus(projectId: string, status: OkrProjectStatus) {
    const sourceProject = okrProjectItems.find((project) => project.id === projectId);
    const nextProject = sourceProject ? { ...sourceProject, status, progress: status === "进行中" ? Math.max(sourceProject.progress, 1) : sourceProject.progress } : undefined;
    if (nextProject) {
      setOkrProjectItems((current) => current.map((project) => (project.id === projectId ? normalizeOkrProjectIdentity(nextProject) : project)));
      void fetch("/api/okr/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: normalizeOkrProjectIdentity(nextProject) })
      })
        .then((response) => {
          if (!response.ok) throw new Error(`POST /api/okr/projects ${response.status}`);
          setLocalDataError("");
        })
        .catch(() => {
          setLocalDataError("OKR 项目审批状态保存到数据库失败，当前仅保留在本页会话。");
        });
    }
  }

  function updateTaskStatus(taskId: string, status: TaskStatus) {
    const changedAt = currentDateTime();
    const sourceTask = taskItems.find((task) => task.id === taskId);
    const sourceMeeting = sourceTask ? meetingItems.find((meeting) => meeting.id === sourceTask.meetingId) : undefined;
    if (taskId.startsWith("okr-project-review-")) {
      const projectId = taskId.replace("okr-project-review-", "");
      const projectTask = okrProjectApprovalTasks.find((task) => task.id === taskId);
      const nextStatus: OkrProjectStatus = status === "completed" || status === "in_progress" ? "进行中" : "待总裁审批";
      updateOkrProjectStatus(projectId, nextStatus);
      if (projectTask) {
        recordActivityLog({
          action: nextStatus === "进行中" ? "confirm_review" : "update_task_status",
          title: nextStatus === "进行中" ? "审批通过 OKR 项目" : "更新 OKR 项目审批状态",
          detail: `OKR 项目「${getTaskSourceTitle(projectTask, meetingItems)}」审批状态变更为 ${nextStatus}。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(projectTask.status),
          toStatus: nextStatus,
          createdAt: changedAt
        });
      }
      return;
    }
    if (taskId.startsWith("okr-kr-review-")) {
      const krId = taskId.replace("okr-kr-review-", "");
      const nextKrStatus = status === "completed" ? "已完成" : "已提交待复核";
      const krTask = okrKrReviewTasks.find((task) => task.id === taskId);
      updateOkrKrStatus(krId, nextKrStatus);
      if (krTask) {
        recordActivityLog({
          action: nextKrStatus === "已完成" ? "confirm_review" : "submit_review",
          title: nextKrStatus === "已完成" ? "确认 OKR KR 复核" : "提交 OKR KR 复核",
          detail: `OKR「${getTaskSourceTitle(krTask, meetingItems)}」的复核任务「${getTaskContent(krTask)}」状态变更为 ${nextKrStatus}。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(krTask.status),
          toStatus: nextKrStatus,
          createdAt: changedAt
        });
      }
      return;
    }
    if (taskId.startsWith("okr-task-")) {
      const okrTask = okrTodoTasks.find((task) => task.id === taskId);
      const pdcaTaskId = getOkrPdcaTaskId(taskId);
      const sourcePdcaTask = okrProjectItems.flatMap((project) => project.pdcaTasks).find((task) => task.id === pdcaTaskId);
      const isReviewerConfirmation = status === "completed" && okrTask?.status === "pending_review" && getTaskReviewerId(okrTask) === activeAccountUser.id;
      const isReviewSubmission = status === "completed" || status === "in_progress" || status === "blocked" || status === "pending_review";
      const reviewTargetStatus = status === "pending_review" ? normalizeReviewTargetStatus(okrTask?.status) : normalizeReviewTargetStatus(status);
      const nextStatus = isReviewerConfirmation ? "completed" : isReviewSubmission ? "pending_review" : status;
      const okrStatus = mapTaskStatusToOkrStatus(nextStatus);
      const okrReviewTargetStatus = mapTaskStatusToOkrStatus(reviewTargetStatus);
      const progressItems = okrTask?.completionItems?.map((item) => item.trim()).filter(Boolean) ?? [];
      const progressEntry =
        nextStatus === "pending_review" && progressItems.length
          ? {
              id: nextId("okr-task-progress"),
              submittedAt: changedAt,
              submittedBy: activeAccountUser.id,
              targetStatus: okrReviewTargetStatus,
              items: progressItems
            }
          : undefined;
      setOkrTaskStatusOverrides((current) => ({
        ...current,
        [taskId]: nextStatus
      }));
      applyOkrPdcaTaskPatch(taskId, {
        status: okrStatus,
        reviewSubmittedAt: nextStatus === "pending_review" ? changedAt : okrTask?.reviewSubmittedAt,
        reviewTargetStatus: nextStatus === "pending_review" ? okrReviewTargetStatus : undefined,
        reviewedAt: nextStatus === "pending_review" ? undefined : nextStatus === "completed" ? changedAt : okrTask?.reviewedAt,
        reviewRejectedAt: nextStatus === "pending_review" ? undefined : okrTask?.reviewRejectedAt,
        reviewRejectedReason: nextStatus === "pending_review" ? undefined : okrTask?.reviewRejectedReason,
        reviewRejectedItems: nextStatus === "pending_review" ? undefined : okrTask?.reviewRejectedItems,
        completionHistory: progressEntry ? [...(sourcePdcaTask?.completionHistory ?? []), progressEntry] : sourcePdcaTask?.completionHistory
      });
      persistAndMergeOkrPdcaTaskStatus(taskId, okrStatus, nextStatus === "pending_review" ? okrReviewTargetStatus : undefined, nextStatus === "pending_review" ? "submit" : undefined);
      if (okrTask) {
        recordActivityLog({
          action: nextStatus === "pending_review" ? "submit_review" : "update_task_status",
          title: nextStatus === "pending_review" ? "提交 OKR 任务复核" : "更新 OKR 任务状态",
          detail: `OKR 待办「${getTaskContent(okrTask)}」从 ${getTaskStatusLabel(okrTask.status)} 变更为 ${nextStatus === "pending_review" ? `待复核：${getReviewTargetLabel(reviewTargetStatus)}` : getTaskStatusLabel(nextStatus)}。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(okrTask.status),
          toStatus: nextStatus === "pending_review" ? `待复核：${getReviewTargetLabel(reviewTargetStatus)}` : getTaskStatusLabel(nextStatus),
          createdAt: changedAt
        });
      }
      return;
    }
    if (sourceTask) {
      const isReviewSubmission = status === "completed" || status === "in_progress" || status === "blocked" || status === "pending_review";
      const reviewTargetStatus = status === "pending_review" ? normalizeReviewTargetStatus(sourceTask.status) : normalizeReviewTargetStatus(status);
      const reviewTargetLabel = getReviewTargetLabel(reviewTargetStatus);
      const nextStatus = isReviewSubmission ? "pending_review" : status;
      const reviewerId = isReviewSubmission ? getTaskReviewerId(sourceTask, sourceMeeting) : sourceTask.reviewerId;
      recordActivityLog({
        action: nextStatus === "pending_review" ? "submit_review" : "update_task_status",
        title: nextStatus === "pending_review" ? `提交${reviewTargetLabel}复核` : "更新任务状态",
        detail: `待办「${getTaskContent(sourceTask)}」从 ${getTaskStatusLabel(sourceTask.status)} 变更为 ${nextStatus === "pending_review" ? `待复核：${reviewTargetLabel}` : getTaskStatusLabel(nextStatus)}。`,
        meetingId: sourceTask.meetingId,
        taskId: sourceTask.id,
        actorId: getTaskOwnerId(sourceTask),
        actorName: findUser(getTaskOwnerId(sourceTask))?.name,
        fromStatus: getTaskStatusLabel(sourceTask.status),
        toStatus: nextStatus === "pending_review" ? `待复核：${reviewTargetLabel}` : getTaskStatusLabel(nextStatus),
        createdAt: changedAt
      });
      if (getTaskOwnerId(sourceTask) === reviewerId && nextStatus === "pending_review") {
        recordActivityLog({
          action: "same_owner_reviewer_warning",
          title: "推进人与复核人相同",
          detail: `待办「${getTaskContent(sourceTask)}」的推进人与复核人都是 ${findUser(getTaskOwnerId(sourceTask))?.name ?? "同一人"}，正式规则需要确认是否允许同人复核。`,
          meetingId: sourceTask.meetingId,
          taskId: sourceTask.id,
          actorId: getTaskOwnerId(sourceTask),
          actorName: findUser(getTaskOwnerId(sourceTask))?.name,
          createdAt: changedAt
        });
      }
    }
    setTaskItems((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const isReviewSubmission = status === "completed" || status === "in_progress" || status === "blocked" || status === "pending_review";
        const reviewTargetStatus = isReviewSubmission
          ? status === "pending_review"
            ? normalizeReviewTargetStatus(task.status)
            : normalizeReviewTargetStatus(status)
          : undefined;
        const progressEntry = isReviewSubmission ? createTaskProgressEntry(task, changedAt, reviewTargetStatus) : undefined;
        return {
          ...task,
          status: isReviewSubmission ? "pending_review" : status,
          reviewerId: isReviewSubmission ? getTaskReviewerId(task, sourceMeeting) : task.reviewerId,
          reviewSubmittedAt: isReviewSubmission ? changedAt : task.reviewSubmittedAt,
          reviewTargetStatus,
          reviewRejectedAt: isReviewSubmission ? undefined : task.reviewRejectedAt,
          reviewRejectedReason: isReviewSubmission ? undefined : task.reviewRejectedReason,
          reviewRejectedItems: isReviewSubmission ? undefined : task.reviewRejectedItems,
          completionHistory: progressEntry ? [...(task.completionHistory ?? []), progressEntry] : task.completionHistory,
          updatedAt: changedAt
        };
      })
    );
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/status`, { status });
  }

  function updateTaskCompletionItems(taskId: string, completionItems: string[]) {
    const changedAt = currentDateTime();
    const normalizedItems = completionItems.map((item) => item.trim()).filter(Boolean);
    const sourceTask = taskItems.find((task) => task.id === taskId);
    if (taskId.startsWith("okr-task-")) {
      const okrTask = okrTodoTasks.find((task) => task.id === taskId);
      setOkrTaskCompletionItems((current) => ({ ...current, [taskId]: normalizedItems }));
      applyOkrPdcaTaskPatch(taskId, { completionItems: normalizedItems });
      persistOkrPdcaTaskCompletionItems(taskId, normalizedItems);
      if (okrTask) {
        recordActivityLog({
          action: "update_task_completion_items",
          title: "填写 OKR 任务完成内容",
          detail: `OKR 待办「${getTaskContent(okrTask)}」更新了 ${normalizedItems.length} 条完成内容。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          createdAt: changedAt
        });
      }
      return;
    }
    if (sourceTask) {
      recordActivityLog({
        action: "update_task_completion_items",
        title: "填写任务完成内容",
        detail: `待办「${getTaskContent(sourceTask)}」更新了 ${normalizedItems.length} 条完成内容。`,
        meetingId: sourceTask.meetingId,
        taskId: sourceTask.id,
        actorId: getTaskOwnerId(sourceTask),
        actorName: findUser(getTaskOwnerId(sourceTask))?.name,
        createdAt: changedAt
      });
    }
    setTaskItems((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const existingItems = task.completionItems?.map((item) => item.trim()).filter(Boolean) ?? [];
        const existingKey = existingItems.join("\n");
        const nextKey = normalizedItems.join("\n");
        const historyHasExisting = task.completionHistory?.some((entry) => entry.items.map((item) => item.trim()).filter(Boolean).join("\n") === existingKey);
        const shouldPreserveExisting = Boolean(existingItems.length && existingKey !== nextKey && !historyHasExisting);
        const preservedEntry: TaskProgressEntry | undefined = shouldPreserveExisting
          ? {
              id: nextId("task-progress-preserved"),
              submittedAt: task.reviewSubmittedAt || task.reviewedAt || task.updatedAt,
              submittedBy: getTaskOwnerId(task),
              targetStatus: task.reviewTargetStatus,
              items: existingItems
            }
          : undefined;
        return {
          ...task,
          completionItems: normalizedItems,
          completionHistory: preservedEntry ? [...(task.completionHistory ?? []), preservedEntry] : task.completionHistory,
          updatedAt: changedAt
        };
      })
    );
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/completion`, { completionItems: normalizedItems });
  }

  function deleteTask(task: Task) {
    if (!canDeleteTaskForAccount(activeAccount, task, meetingItems)) return;
    const changedAt = currentDateTime();
    if (task.id.startsWith("okr-task-")) {
      setOkrTaskStatusOverrides((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      applyOkrPdcaTaskPatch(task.id, { status: "已取消" });
      persistAndMergeOkrPdcaTaskStatus(task.id, "已取消");
      recordActivityLog({
        action: "delete_task",
        title: "删除 OKR 待办",
        detail: `${activeAccountUser.name} 删除 OKR 待办「${getTaskContent(task)}」。`,
        taskId: task.id,
        actorId: activeAccountUser.id,
        actorName: activeAccountUser.name,
        fromStatus: getTaskStatusLabel(task.status),
        toStatus: "已删除",
        createdAt: changedAt
      });
      return;
    }

    setTaskItems((current) => current.filter((item) => item.id !== task.id));
    setMeetingItems((current) =>
      current.map((meeting) => ({
        ...meeting,
        tasks: meeting.tasks?.filter((item) => item.id !== task.id)
      }))
    );
    recordActivityLog({
      action: "delete_task",
      title: "删除待办",
      detail: `${activeAccountUser.name} 删除待办「${getTaskContent(task)}」。`,
      meetingId: task.meetingId,
      taskId: task.id,
      actorId: activeAccountUser.id,
      actorName: activeAccountUser.name,
      fromStatus: getTaskStatusLabel(task.status),
      toStatus: "已删除",
      createdAt: changedAt
    });
    void fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) throw new Error(`DELETE /api/tasks/${task.id} ${response.status}`);
        setLocalDataError("");
      })
      .catch(() => {
        setLocalDataError("待办删除保存到数据库失败，请刷新后重试。");
      });
  }

  function confirmTaskReview(taskId: string) {
    const changedAt = currentDateTime();
    const sourceTask = taskItems.find((task) => task.id === taskId);
    const sourceMeeting = sourceTask ? meetingItems.find((meeting) => meeting.id === sourceTask.meetingId) : undefined;
    if (taskId.startsWith("okr-project-review-")) {
      const projectId = taskId.replace("okr-project-review-", "");
      const projectTask = okrProjectApprovalTasks.find((task) => task.id === taskId);
      updateOkrProjectStatus(projectId, "进行中");
      if (projectTask) {
        recordActivityLog({
          action: "confirm_review",
          title: "审批通过 OKR 项目",
          detail: `审批人 ${activeAccountUser.name} 确认 OKR 项目「${getTaskSourceTitle(projectTask, meetingItems)}」进入执行。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: "待总裁审批",
          toStatus: "进行中",
          createdAt: changedAt
        });
      }
      return;
    }
    if (taskId.startsWith("okr-kr-review-")) {
      const krId = taskId.replace("okr-kr-review-", "");
      const krTask = okrKrReviewTasks.find((task) => task.id === taskId);
      updateOkrKrStatus(krId, "已完成");
      if (krTask) {
        recordActivityLog({
          action: "confirm_review",
          title: "复核确认 OKR KR 完成",
          detail: `复核人 ${activeAccountUser.name} 确认「${getTaskContent(krTask)}」完成。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(krTask.status),
          toStatus: "已完成",
          createdAt: changedAt
        });
      }
      return;
    }
    if (taskId.startsWith("okr-task-")) {
      const okrTask = okrTodoTasks.find((task) => task.id === taskId);
      const pdcaTaskId = getOkrPdcaTaskId(taskId);
      const sourcePdcaTask = okrProjectItems.flatMap((project) => project.pdcaTasks).find((task) => task.id === pdcaTaskId);
      const sourceReviewTargetStatus = sourcePdcaTask?.reviewTargetStatus ? mapOkrTaskStatus(sourcePdcaTask.reviewTargetStatus) : undefined;
      const targetStatus = normalizeReviewTargetStatus(okrTask?.reviewTargetStatus ?? sourceReviewTargetStatus ?? "completed");
      const nextStatus = targetStatus === "completed" ? "completed" : targetStatus;
      const nextOkrStatus = mapTaskStatusToOkrStatus(nextStatus);
      setOkrTaskStatusOverrides((current) => ({ ...current, [taskId]: nextStatus }));
      applyOkrPdcaTaskPatch(taskId, {
        status: nextOkrStatus,
        reviewedAt: changedAt,
        reviewTargetStatus: undefined,
        reviewRejectedAt: undefined,
        reviewRejectedReason: undefined,
        reviewRejectedItems: undefined
      });
      persistAndMergeOkrPdcaTaskStatus(taskId, nextOkrStatus, undefined, "confirm");
      if (okrTask) {
        recordActivityLog({
          action: "confirm_review",
          title: `复核确认 OKR 任务${getReviewTargetLabel(targetStatus)}`,
          detail: `复核人 ${activeAccountUser.name} 确认 OKR 待办「${getTaskContent(okrTask)}」${getReviewTargetLabel(targetStatus)}。`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(okrTask.status),
          toStatus: getTaskStatusLabel(nextStatus),
          createdAt: changedAt
        });
      }
      return;
    }
    if (sourceTask) {
      const reviewTargetStatus = inferReviewTargetStatus(sourceTask, activityLogs);
      const reviewTargetLabel = getReviewTargetLabel(reviewTargetStatus);
      recordActivityLog({
        action: "confirm_review",
        title: `复核确认${reviewTargetLabel}`,
        detail: `复核人 ${findUser(getTaskReviewerId(sourceTask, sourceMeeting))?.name ?? "未设置"} 确认待办「${getTaskContent(sourceTask)}」${reviewTargetLabel}。`,
        meetingId: sourceTask.meetingId,
        taskId: sourceTask.id,
        actorId: getTaskReviewerId(sourceTask, sourceMeeting),
        actorName: findUser(getTaskReviewerId(sourceTask, sourceMeeting))?.name,
        fromStatus: getTaskStatusLabel(sourceTask.status),
        toStatus: getTaskStatusLabel(reviewTargetStatus),
        createdAt: changedAt
      });
    }
    setTaskItems((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: inferReviewTargetStatus(task, activityLogs),
              reviewerId: getTaskReviewerId(task, sourceMeeting),
              reviewTargetStatus: undefined,
              reviewedAt: changedAt,
              reviewRejectedAt: undefined,
              reviewRejectedReason: undefined,
              reviewRejectedItems: undefined,
              updatedAt: changedAt
            }
          : task
      )
    );
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/review`, { action: "confirm" });
  }

  function rejectTaskReview(taskId: string, reasonItems: string[]) {
    const changedAt = currentDateTime();
    const normalizedItems = reasonItems.map((item) => item.trim()).filter(Boolean);
    const reason = normalizedItems.join("；") || "复核未通过，请补充任务完成内容后重新提交复核。";
    const sourceTask = taskItems.find((task) => task.id === taskId);
    const sourceMeeting = sourceTask ? meetingItems.find((meeting) => meeting.id === sourceTask.meetingId) : undefined;
    if (taskId.startsWith("okr-project-review-")) {
      const projectId = taskId.replace("okr-project-review-", "");
      const projectTask = okrProjectApprovalTasks.find((task) => task.id === taskId);
      updateOkrProjectStatus(projectId, "草稿");
      if (projectTask) {
        recordActivityLog({
          action: "reject_review",
          title: "审批驳回 OKR 项目",
          detail: `审批人 ${activeAccountUser.name} 驳回 OKR 项目「${getTaskSourceTitle(projectTask, meetingItems)}」。原因：${reason}`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: "待总裁审批",
          toStatus: "草稿",
          createdAt: changedAt
        });
      }
      return;
    }
    if (taskId.startsWith("okr-kr-review-")) {
      const krId = taskId.replace("okr-kr-review-", "");
      const krTask = okrKrReviewTasks.find((task) => task.id === taskId);
      updateOkrKrStatus(krId, "进行中");
      if (krTask) {
        recordActivityLog({
          action: "reject_review",
          title: "复核驳回 OKR KR",
          detail: `复核人 ${activeAccountUser.name} 驳回「${getTaskContent(krTask)}」。原因：${reason}`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(krTask.status),
          toStatus: "进行中",
          createdAt: changedAt
        });
      }
      return;
    }
    if (taskId.startsWith("okr-task-")) {
      const okrTask = okrTodoTasks.find((task) => task.id === taskId);
      setOkrTaskStatusOverrides((current) => ({ ...current, [taskId]: "in_progress" }));
      applyOkrPdcaTaskPatch(taskId, {
        status: "进行中",
        reviewRejectedAt: changedAt,
        reviewRejectedReason: reason,
        reviewRejectedItems: normalizedItems.length ? normalizedItems : [reason],
        reviewTargetStatus: undefined
      });
      persistAndMergeOkrPdcaTaskStatus(taskId, "进行中", undefined, "reject", reason, normalizedItems.length ? normalizedItems : [reason]);
      if (okrTask) {
        recordActivityLog({
          action: "reject_review",
          title: "复核驳回 OKR 任务",
          detail: `复核人 ${activeAccountUser.name} 驳回 OKR 待办「${getTaskContent(okrTask)}」。原因：${reason}`,
          taskId,
          actorId: activeAccountUser.id,
          actorName: activeAccountUser.name,
          fromStatus: getTaskStatusLabel(okrTask.status),
          toStatus: "进行中",
          createdAt: changedAt
        });
      }
      return;
    }
    if (sourceTask) {
      const reviewTargetStatus = inferReviewTargetStatus(sourceTask, activityLogs);
      const rollbackStatus = reviewTargetStatus === "completed" ? "in_progress" : normalizeReviewTargetStatus(reviewTargetStatus);
      recordActivityLog({
        action: "reject_review",
        title: "复核驳回任务",
        detail: `复核人 ${findUser(getTaskReviewerId(sourceTask, sourceMeeting))?.name ?? "未设置"} 驳回待办「${getTaskContent(sourceTask)}」。原因：${reason}`,
        meetingId: sourceTask.meetingId,
        taskId: sourceTask.id,
        actorId: getTaskReviewerId(sourceTask, sourceMeeting),
        actorName: findUser(getTaskReviewerId(sourceTask, sourceMeeting))?.name,
        fromStatus: getTaskStatusLabel(sourceTask.status),
        toStatus: getTaskStatusLabel(rollbackStatus),
        createdAt: changedAt
      });
    }
    setTaskItems((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const reviewTargetStatus = inferReviewTargetStatus(task, activityLogs);
        const rollbackStatus = reviewTargetStatus === "completed" ? "in_progress" : normalizeReviewTargetStatus(reviewTargetStatus);
        return {
          ...task,
          status: rollbackStatus,
          reviewSubmittedAt: undefined,
          reviewTargetStatus: undefined,
          reviewedAt: undefined,
          reviewRejectedAt: changedAt,
          reviewRejectedReason: reason,
          reviewRejectedItems: normalizedItems.length ? normalizedItems : [reason],
          updatedAt: changedAt
        };
      })
    );
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/review`, { action: "reject", reasonItems: normalizedItems });
  }

  function completeCompanySupport(taskId: string) {
    const changedAt = currentDateTime();
    const sourceTask = taskItems.find((task) => task.id === taskId);
    if (sourceTask) {
      recordActivityLog({
        action: "complete_company_support",
        title: "公司支持完成",
        detail: `公司支持事项「${sourceTask.companySupportRequest || getTaskContent(sourceTask)}」已完成。`,
        meetingId: sourceTask.meetingId,
        taskId: sourceTask.id,
        actorName: "总裁办",
        createdAt: changedAt
      });
    }
    setTaskItems((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              companySupportStatus: "completed",
              companySupportCompletedAt: changedAt,
              updatedAt: changedAt
            }
          : task
      )
    );
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/support`, {});
  }

  function submitMeetingForApproval(meeting: Meeting) {
    const submittedAt = currentDateTime();
    setMeetingItems((current) => {
      const exists = current.some((item) => item.id === meeting.id);
      if (exists) return current.map((item) => (item.id === meeting.id ? meeting : item));
      return [meeting, ...current];
    });
    recordActivityLog({
      action: "submit_meeting_approval",
      title: "提交会议签批",
      detail: `会议《${meeting.title}》已提交总裁签批，包含 ${(meeting.tasks ?? []).length} 项待办。`,
      meetingId: meeting.id,
      actorId: meeting.hostId,
      actorName: findUser(meeting.hostId)?.name,
      toStatus: getApprovalStatusLabel("pending_president_approval"),
      createdAt: submittedAt
    });
    persistMeetingSubmission(meeting);
    setSelectedMeetingId(meeting.id);
  }

  function approveMeeting(meetingId: string) {
    const sourceMeeting = meetingItems.find((meeting) => meeting.id === meetingId);
    const approvedAt = currentDateTime();
    const approvedTasks: Task[] = (sourceMeeting?.tasks ?? []).map((task) => {
      const ownerId = getTaskOwnerId(task);
      const departmentId = getUserDepartmentId(ownerId) ?? getTaskDepartmentId(task);
      const reviewerId = sourceMeeting ? getTaskReviewerId({ ...task, owner: ownerId, ownerId, ownerDepartment: departmentId, departmentId }, sourceMeeting) : resolveUserId(task.reviewerId) ?? ownerId;
      return {
        ...task,
        meetingId,
        title: getTaskContent(task),
        description: getTaskDescription(task),
        owner: ownerId,
        ownerId,
        ownerDepartment: departmentId,
        departmentId,
        reviewerId,
        collaboratorDepartmentIds: getTaskCollaboratorDepartmentIds(task),
        status: "not_started",
        approvalStatus: "in_closed_loop",
        createdAt: task.createdAt || approvedAt,
        updatedAt: approvedAt
      };
    });

    setMeetingItems((current) =>
      current.map((meeting) => {
        if (meeting.id !== meetingId) return meeting;
        return {
          ...meeting,
          approvalStatus: "in_closed_loop",
          status: "closed",
          approvedBy: "u-linyuchen",
          approvedAt,
          tasks: []
        };
      })
    );

    setTaskItems((current) => {
      const existingIds = new Set(current.map((task) => task.id));
      return [...approvedTasks.filter((task) => !existingIds.has(task.id)), ...current];
    });
    if (sourceMeeting) {
      recordActivityLog({
        action: "approve_meeting",
        title: "总裁批量签批通过",
        detail: `会议《${sourceMeeting.title}》已签批通过，${approvedTasks.length} 项待办进入正式台账。`,
        meetingId,
        actorId: activeAccountUser.id,
        actorName: activeAccountUser.name,
        fromStatus: getApprovalStatusLabel(sourceMeeting.approvalStatus),
        toStatus: getApprovalStatusLabel("in_closed_loop"),
        createdAt: approvedAt
      });
    }
    persistMeetingApproval(meetingId, { action: "approve" });
  }

  function rejectMeeting(meetingId: string, reason: string) {
    const rejectedAt = currentDateTime();
    const sourceMeeting = meetingItems.find((meeting) => meeting.id === meetingId);
    setMeetingItems((current) =>
      current.map((meeting) =>
        meeting.id === meetingId
          ? {
              ...meeting,
              approvalStatus: "rejected",
              rejectedReason: reason || "请主管补充待办推进人、复核人、截止时间和达成目标后重新提交。"
            }
          : meeting
      )
    );
    if (sourceMeeting) {
      recordActivityLog({
        action: "reject_meeting",
        title: "总裁驳回会议签批",
        detail: `会议《${sourceMeeting.title}》被驳回。原因：${reason || "请主管补充待办推进人、复核人、截止时间和达成目标后重新提交。"}`,
        meetingId,
        actorId: activeAccountUser.id,
        actorName: activeAccountUser.name,
        fromStatus: getApprovalStatusLabel(sourceMeeting.approvalStatus),
        toStatus: getApprovalStatusLabel("rejected"),
        createdAt: rejectedAt
      });
    }
    persistMeetingApproval(meetingId, { action: "reject", reason });
  }

  function approveTask(taskId: string) {
    const sourceMeeting = meetingItems.find((meeting) => meeting.tasks?.some((task) => task.id === taskId));
    const sourceTask = sourceMeeting?.tasks?.find((task) => task.id === taskId);
    if (!sourceMeeting || !sourceTask) return;
    const approvedAt = currentDateTime();

    const approvedTask: Task = {
      ...sourceTask,
      meetingId: sourceMeeting.id,
      title: getTaskContent(sourceTask),
      description: getTaskDescription(sourceTask),
      owner: getTaskOwnerId(sourceTask),
      ownerId: getTaskOwnerId(sourceTask),
      ownerDepartment: getUserDepartmentId(getTaskOwnerId(sourceTask)) ?? getTaskDepartmentId(sourceTask),
      departmentId: getUserDepartmentId(getTaskOwnerId(sourceTask)) ?? getTaskDepartmentId(sourceTask),
      reviewerId: getTaskReviewerId(sourceTask, sourceMeeting),
      collaboratorDepartmentIds: getTaskCollaboratorDepartmentIds(sourceTask),
      status: "not_started",
      approvalStatus: "in_closed_loop",
      rejectedReason: undefined,
      createdAt: sourceTask.createdAt || approvedAt,
      updatedAt: approvedAt
    };

    setMeetingItems((current) =>
      current.map((meeting) => {
        if (meeting.id !== sourceMeeting.id) return meeting;
        const nextTasks = (meeting.tasks ?? []).filter((task) => task.id !== taskId);
        const allApproved = nextTasks.length === 0;
        const hasRejected = nextTasks.some((task) => task.approvalStatus === "rejected");
        return {
          ...meeting,
          tasks: nextTasks,
          approvalStatus: allApproved ? "in_closed_loop" : hasRejected ? "rejected" : "pending_president_approval",
          status: allApproved ? "closed" : meeting.status,
          approvedBy: allApproved ? "u-linyuchen" : meeting.approvedBy,
          approvedAt: allApproved ? approvedAt : meeting.approvedAt
        };
      })
    );

    setTaskItems((current) => [approvedTask, ...current.filter((task) => task.id !== taskId)]);
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/approval`, { action: "approve" });
    recordActivityLog({
      action: "approve_task",
      title: "总裁签批通过待办",
      detail: `会议《${sourceMeeting.title}》的待办「${getTaskContent(sourceTask)}」已签批通过并进入正式台账。`,
      meetingId: sourceMeeting.id,
      taskId,
      actorId: "u-linyuchen",
      actorName: "林昱辰",
      fromStatus: getApprovalStatusLabel(sourceTask.approvalStatus),
      toStatus: getApprovalStatusLabel("in_closed_loop"),
      createdAt: approvedAt
    });
  }

  function rejectTask(taskId: string, reason = "待办推进人、复核人、开始时间或截止日期不符合签批要求，请部门主管重新修改后提交。") {
    const rejectedAt = currentDateTime();
    const sourceMeeting = meetingItems.find((meeting) => meeting.tasks?.some((task) => task.id === taskId));
    const sourceTask = sourceMeeting?.tasks?.find((task) => task.id === taskId);
    setMeetingItems((current) =>
      current.map((meeting) => {
        if (!meeting.tasks?.some((task) => task.id === taskId)) return meeting;
        const nextTasks = meeting.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                approvalStatus: "rejected" as ApprovalStatus,
                rejectedReason: reason,
                updatedAt: rejectedAt
              }
            : task
        );
        return {
          ...meeting,
          tasks: nextTasks,
          approvalStatus: "rejected",
          rejectedReason: reason
        };
      })
    );
    if (sourceMeeting && sourceTask) {
      recordActivityLog({
        action: "reject_task",
        title: "总裁驳回待办",
        detail: `会议《${sourceMeeting.title}》的待办「${getTaskContent(sourceTask)}」被驳回。原因：${reason}`,
        meetingId: sourceMeeting.id,
        taskId,
        actorId: "u-linyuchen",
        actorName: "林昱辰",
        fromStatus: getApprovalStatusLabel(sourceTask.approvalStatus),
        toStatus: getApprovalStatusLabel("rejected"),
        createdAt: rejectedAt
      });
    }
    persistAndMergeTaskAction(`/api/tasks/${encodeURIComponent(taskId)}/approval`, { action: "reject", reason });
  }

  function createOkrProject(project: OkrProject) {
    setOkrProjectItems((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    void fetch("/api/okr/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project })
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`POST /api/okr/projects ${response.status}`);
        const parsed = (await response.json()) as OkrProjectsApiResponse;
        if (parsed.project) {
          setOkrProjectItems((current) => [normalizeOkrProjectIdentity(parsed.project as OkrProject), ...current.filter((item) => item.id !== parsed.project?.id)]);
        }
        setLocalDataError("");
      })
      .catch(() => {
        setLocalDataError("OKR 项目保存到数据库失败，当前仅保留在本页会话。");
      });
  }

  function deleteOkrProject(project: OkrProject) {
    setOkrProjectItems((current) => current.filter((item) => item.id !== project.id));
    const taskIds = new Set(project.pdcaTasks.map((task) => `okr-task-${task.id}`));
    const krReviewTaskIds = new Set(project.krs.map((kr) => `okr-kr-review-${kr.id}`));
    const krIds = new Set(project.krs.map((kr) => kr.id));
    setOkrTaskStatusOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([taskId]) => !taskIds.has(taskId) && !krReviewTaskIds.has(taskId)))
    );
    setOkrTaskCompletionItems((current) => Object.fromEntries(Object.entries(current).filter(([taskId]) => !taskIds.has(taskId))));
    setOkrKrStatusOverrides((current) => Object.fromEntries(Object.entries(current).filter(([krId]) => !krIds.has(krId))));
    void fetch(`/api/okr/projects?projectId=${encodeURIComponent(project.id)}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) throw new Error(`DELETE /api/okr/projects ${response.status}`);
        setLocalDataError("");
      })
      .catch(() => {
        setLocalDataError("OKR 项目删除保存到数据库失败，当前仅从本页移除。");
      });
  }

  function resetDemo() {
    setMeetingItems(seedMeetings);
    setTaskItems(seedTasks);
    setActivityLogs([]);
    setOkrProjectItems([]);
    setNotificationReadIds([]);
    setSelectedMeetingId(seedMeetings[0]?.id ?? "");
    setActivePage("new-meeting");
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(NOTIFICATION_READ_STORAGE_KEY);
    removeUserScopedStorageEntries(NOTIFICATION_READ_STORAGE_KEY);
    void fetch("/api/state", { method: "DELETE" }).catch(() => {
      setLocalDataError("数据库重置失败，请刷新后重试。");
    });
  }

  return (
    <div className={`theme-${uiTheme} min-h-screen min-w-[1280px] bg-app`}>
      <aside className="app-sidebar fixed inset-y-0 left-0 z-20 w-64 border-r border-line bg-panel">
        <div className="border-b border-line px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
              <Sparkles size={21} />
            </div>
            <div>
              <div className="text-base font-semibold text-ink">AI 会议闭环系统</div>
              <div className="mt-1 text-xs text-slate-500">拉迷集团 Demo</div>
            </div>
          </div>
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${localDataError ? "border-red-100 bg-red-50 text-red-600" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
            数据状态：{localDataError || (hasLoaded ? (isSyncingLocalData ? "保存中" : "已连接数据库") : "加载中")}
          </div>
        </div>
        <nav className="space-y-1 px-3 py-4">
          {accessibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                  active ? "bg-blue-50 text-brand" : "text-slate-600 hover:bg-slate-50 hover:text-ink"
                }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.key === "notifications" && unreadNotificationCount > 0 ? (
                  <span className="ml-auto min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-4 text-white">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="pl-64">
        <header className="app-header sticky top-0 z-10 border-b border-line bg-white/95 px-7 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>本地演示版</span>
                <ChevronRight size={14} />
                <span>数据日期：{todayKey()}</span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-ink">会议闭环系统</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="app-account-menu relative">
                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-muted"
                  aria-expanded={isAccountMenuOpen}
                  aria-haspopup="menu"
                  title="个人中心"
                >
                  <UserRound size={16} />
                  <span>{activeAccountUser.name} / {activeAccount.roleLabel}</span>
                  <ChevronDown size={15} />
                </button>
                {isAccountMenuOpen ? (
                  <div className="app-account-menu-panel absolute right-0 top-[calc(100%+0.5rem)] z-30 w-96 rounded-xl border border-line bg-white p-3 shadow-panel">
                    <div className="px-3 py-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">个人中心</div>
                      <div className="mt-1 text-sm font-semibold text-ink">账号与视角</div>
                    </div>
                    <div className="space-y-3 px-3 pb-3">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-500">真实登录账号</div>
                        <SearchableSelect
                          value={activeAccountUser.id}
                          onChange={loginAsUser}
                          options={loginUserOptions}
                          placeholder="输入姓名、工号、岗位或部门"
                        />
                      </div>
                      {activeAccount.id === "president" ? (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-slate-500">总裁模拟查看</div>
                          <SearchableSelect
                            value={activeViewUser.id}
                            onChange={viewAsUser}
                            options={loginUserOptions}
                            placeholder="输入要查看的人员"
                          />
                        </div>
                      ) : null}
                      <div className="flex items-start gap-3 rounded-lg bg-blue-50 px-3 py-2.5">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                          <UserRound size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">{activeAccountUser.name}</span>
                            <span className="rounded-full border border-line bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{activeAccount.label}</span>
                            <CheckCircle2 className="text-brand" size={15} />
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            {[findDepartment(activeAccountUser.departmentId)?.name, activeAccountUser.title, activeAccountUser.employeeNo].filter(Boolean).join(" · ")}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">{activeAccount.description}</div>
                          {activeAccount.id === "president" && activeViewUser.id !== activeAccountUser.id ? (
                            <div className="mt-2 rounded-lg border border-blue-100 bg-white/80 px-2 py-1 text-xs font-semibold text-blue-700">
                              正在查看：{activeViewUser.name}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => setUiTheme((current) => (current === "light" ? "dark" : "light"))}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm font-medium text-slate-700 hover:bg-muted"
                title={uiTheme === "light" ? "切换深色模式" : "切换浅色模式"}
              >
                {uiTheme === "light" ? <Moon size={16} /> : <Sun size={16} />}
                {uiTheme === "light" ? "深色" : "浅色"}
              </button>
            </div>
          </div>
        </header>

        <main className="px-7 py-7">
          {activePage === "notifications" && (
            <NotificationsPage
              notifications={visibleNotifications}
              readIds={notificationReadIds}
              currentUserId={activeAccountUser.id}
              mode={notificationMode}
              canViewAll={activeAccount.id === "president"}
              onModeChange={setNotificationMode}
              onMarkRead={markNotificationRead}
              onMarkAllRead={markAllNotificationsRead}
              onNavigate={navigate}
            />
          )}
          {activePage === "dashboard" && (
            <DashboardPage
              metrics={metrics}
              meetings={visibleMeetings}
              tasks={visibleTasks}
              pendingApprovalTasks={visiblePendingApprovalTasks}
              currentUserId={activeAccountUser.id}
              onNavigate={navigate}
              onUpdateTaskStatus={updateTaskStatus}
              onApproveTask={approveTask}
              onRejectTask={rejectTask}
              onCompleteCompanySupport={completeCompanySupport}
            />
          )}
          {activePage === "meetings" && <MeetingsPage meetings={visibleMeetings} tasks={visibleTasks} onNavigate={navigate} />}
          {activePage === "meeting-summaries" && (
            <MeetingSummariesPage
              meetings={visibleMeetings}
              tasks={visibleTasks}
              account={activeAccount}
              selectedUserId={viewUserId}
              onSelectUser={viewAsUser}
              onNavigate={navigate}
            />
          )}
          <div className={activePage === "new-meeting" ? "" : "hidden"}>
            <NewMeetingPage okrProjects={okrProjectItems} onSubmitForApproval={submitMeetingForApproval} />
          </div>
          {activePage === "meeting-detail" && (
            <MeetingDetailPage
              meeting={selectedVisibleMeeting}
              tasks={visibleTasks}
              activityLogs={activityLogs}
              currentUserId={activeAccountUser.id}
              onNavigate={navigate}
              onUpdateTaskStatus={updateTaskStatus}
              onUpdateTaskCompletionItems={updateTaskCompletionItems}
              onCanDeleteTask={(task) => canDeleteTaskForAccount(activeAccount, task, meetingItems)}
              onDeleteTask={deleteTask}
            />
          )}
          {activePage === "tasks" && (
            <TasksPage meetings={visibleMeetings} tasks={visibleTasks} account={activeAccount} currentUserId={activeAccountUser.id} focusTaskId={selectedTaskId} onNavigate={navigate} onUpdateTaskStatus={updateTaskStatus} onUpdateTaskCompletionItems={updateTaskCompletionItems} onCanDeleteTask={(task) => canDeleteTaskForAccount(activeAccount, task, meetingItems)} onDeleteTask={deleteTask} />
          )}
          {activePage === "my-tasks" && (
            <MyTasksPage
              meetings={visibleMeetings}
              tasks={visibleTasks}
              pendingApprovalTasks={visiblePendingApprovalTasks}
              account={activeAccount}
              currentUserId={activeAccountUser.id}
              selectedUserId={viewUserId}
              focusTaskId={selectedTaskId}
              onSelectUser={viewAsUser}
              onNavigate={navigate}
              onUpdateTaskStatus={updateTaskStatus}
              onUpdateTaskCompletionItems={updateTaskCompletionItems}
              onApproveTask={approveTask}
              onRejectTask={rejectTask}
              onConfirmTaskReview={confirmTaskReview}
              onRejectTaskReview={rejectTaskReview}
              onCompleteCompanySupport={completeCompanySupport}
              onCanDeleteTask={(task) => canDeleteTaskForAccount(activeAccount, task, meetingItems)}
              onDeleteTask={deleteTask}
            />
          )}
          {activePage === "departments" && (
            <DepartmentsPage
              meetings={visibleMeetings}
              tasks={visibleTasks}
              rejectedTasks={visibleRejectedApprovalTasks}
              account={activeAccount}
              currentUserId={activeAccountUser.id}
              selectedDepartmentId={selectedDepartmentId}
              onSelectDepartment={setSelectedDepartmentId}
              onNavigate={navigate}
              onUpdateTaskStatus={updateTaskStatus}
              onUpdateTaskCompletionItems={updateTaskCompletionItems}
              onCanDeleteTask={(task) => canDeleteTaskForAccount(activeAccount, task, meetingItems)}
              onDeleteTask={deleteTask}
            />
          )}
          {activePage === "dictionary" && <DictionaryPage />}
          {activePage === "kr-projects" && (
            <KrProjectsPage
              projects={visibleOkrProjects}
              onNavigate={navigate}
              krStatusOverrides={okrKrStatusOverrides}
              taskStatusOverrides={okrTaskStatusOverrides}
              onCreateProject={createOkrProject}
              onDeleteProject={deleteOkrProject}
              onUpdateKrStatus={updateOkrKrStatus}
            />
          )}
          {activePage === "wecom-outbox" && <WecomOutboxPage />}
        </main>
      </div>
    </div>
  );
}

function pageTitle(page: PageKey) {
  const item = navItems.find((navItem) => navItem.key === page);
  if (page === "meeting-detail") return "会议详情";
  return item?.label ?? "AI 会议闭环系统";
}

const wecomOutboxEventOptions: Array<{ value: "all" | WecomOutboxEventType; label: string }> = [
  { value: "all", label: "全部事件" },
  { value: "task_review_submitted", label: "提交复核" },
  { value: "task_review_confirmed", label: "复核通过" },
  { value: "task_review_rejected", label: "复核驳回" },
  { value: "meeting_approval_submitted", label: "提交签批" },
  { value: "task_approval_approved", label: "签批通过" },
  { value: "task_approval_rejected", label: "待办签批驳回" },
  { value: "meeting_approval_rejected", label: "会议签批驳回" },
  { value: "okr_project_created", label: "OKR新建" },
  { value: "okr_pdca_review_submitted", label: "OKR提交复核" },
  { value: "okr_pdca_review_confirmed", label: "OKR复核通过" },
  { value: "okr_pdca_review_rejected", label: "OKR复核驳回" }
];

const wecomOutboxEventLabel = Object.fromEntries(wecomOutboxEventOptions.map((item) => [item.value, item.label])) as Record<"all" | WecomOutboxEventType, string>;

function WecomOutboxPage() {
  const [items, setItems] = useState<WecomOutboxItem[]>([]);
  const [summary, setSummary] = useState<Array<{ status: WecomOutboxStatus; count: number }>>([]);
  const [eventSummary, setEventSummary] = useState<Array<{ eventType: WecomOutboxEventType; count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"all" | WecomOutboxStatus>("all");
  const [eventType, setEventType] = useState<"all" | WecomOutboxEventType>("all");
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "80" });
    if (status !== "all") params.set("status", status);
    if (eventType !== "all") params.set("eventType", eventType);
    if (submittedKeyword.trim()) params.set("q", submittedKeyword.trim());

    setIsLoading(true);
    fetch(`/api/wecom/outbox?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as WecomOutboxResponse;
        if (!response.ok) throw new Error(payload.error || `GET /api/wecom/outbox ${response.status}`);
        if (cancelled) return;
        setItems(payload.items ?? []);
        setSummary(payload.summary ?? []);
        setEventSummary(payload.eventSummary ?? []);
        setTotal(payload.total ?? 0);
        setError("");
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "读取发送记录失败");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventType, refreshKey, status, submittedKeyword]);

  const statusLabel: Record<WecomOutboxStatus, string> = {
    pending: "待发送",
    sent: "已发送",
    failed: "失败",
    skipped: "已跳过"
  };
  const statusTone: Record<WecomOutboxStatus, string> = {
    pending: solidTone.amber,
    sent: solidTone.green,
    failed: solidTone.red,
    skipped: "border-slate-200 bg-slate-50 text-slate-600"
  };
  const summaryMap = new Map(summary.map((item) => [item.status, item.count]));
  const eventSummaryMap = new Map(eventSummary.map((item) => [item.eventType, item.count]));

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedKeyword(keyword);
  }

  async function retryOutboxItem(item: WecomOutboxItem) {
    if (item.status === "sent") return;
    setRetryingId(item.id);
    setActionMessage("");
    setError("");
    try {
      const response = await fetch("/api/wecom/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id })
      });
      const payload = (await response.json().catch(() => ({}))) as WecomOutboxRetryResponse;
      if (!response.ok) throw new Error(payload.error || `POST /api/wecom/outbox ${response.status}`);
      const errcode = payload.result?.errcode;
      setActionMessage(errcode === 0 ? "重试发送成功。" : `重试完成，企业微信返回：${errcode ?? "unknown"} ${payload.result?.errmsg ?? ""}`.trim());
      setRefreshKey((current) => current + 1);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试发送失败");
    } finally {
      setRetryingId("");
    }
  }

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-brand">企业微信</div>
            <h2 className="mt-1 text-2xl font-semibold text-ink">发送记录</h2>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" />
            刷新
          </button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          <ReadOnlyMetric label="当前筛选" value={`${total}`} />
          {(["sent", "failed", "pending", "skipped"] as WecomOutboxStatus[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(status === item ? "all" : item)}
              className={`rounded-lg border bg-white p-4 text-left shadow-panel transition hover:border-blue-200 ${status === item ? "border-brand ring-2 ring-blue-100" : "border-line"}`}
            >
              <div className="text-xs font-semibold text-slate-500">{statusLabel[item]}</div>
              <div className={`mt-3 inline-flex rounded-lg px-3 py-2 text-xl font-semibold ${statusTone[item]}`}>{summaryMap.get(item) ?? 0}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {wecomOutboxEventOptions.filter((item) => item.value !== "all").slice(0, 4).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setEventType(eventType === item.value ? "all" : item.value)}
              className={`rounded-lg border bg-white p-3 text-left shadow-panel transition hover:border-blue-200 ${eventType === item.value ? "border-brand ring-2 ring-blue-100" : "border-line"}`}
            >
              <div className="text-xs font-semibold text-slate-500">{item.label}</div>
              <div className="mt-2 text-xl font-semibold text-ink">{eventSummaryMap.get(item.value as WecomOutboxEventType) ?? 0}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-line bg-slate-50 p-1">
            {(["all", "sent", "failed", "pending", "skipped"] as Array<"all" | WecomOutboxStatus>).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStatus(item)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${status === item ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}`}
              >
                {item === "all" ? "全部" : statusLabel[item]}
              </button>
            ))}
          </div>
          <div className="min-w-[14rem]">
            <SearchableSelect
              value={eventType}
              onChange={(value) => setEventType(value as "all" | WecomOutboxEventType)}
              options={wecomOutboxEventOptions}
              placeholder="选择事件类型"
            />
          </div>
          <form onSubmit={submitSearch} className="flex min-w-[20rem] max-w-md flex-1 items-center gap-2">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索接收人、UserID、任务ID、错误信息"
              className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">搜索</button>
          </form>
        </div>

        {actionMessage ? <div className="mt-4 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">{actionMessage}</div> : null}
        {error ? <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {isLoading ? <div className="mt-4 text-sm text-slate-500">加载中...</div> : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="min-w-[1260px] divide-y divide-line text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 text-left">时间</th>
                <th className="px-3 py-3 text-left">状态</th>
                <th className="px-3 py-3 text-left">事件</th>
                <th className="px-3 py-3 text-left">接收人</th>
                <th className="px-3 py-3 text-left">来源</th>
                <th className="px-3 py-3 text-left">错误</th>
                <th className="px-3 py-3 text-left">尝试</th>
                <th className="px-3 py-3 text-left">msgid</th>
                <th className="px-3 py-3 text-left">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {items.map((item) => (
                <tr key={item.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDateTime(item.createdAt).slice(0, 19)}</td>
                  <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone[item.status]}`}>{statusLabel[item.status]}</span></td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-ink">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{wecomOutboxEventLabel[item.eventType as WecomOutboxEventType] ?? item.eventType}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{item.eventType}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-ink">{item.recipientName || item.recipientUserId || "未记录"}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.touser}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-ink">{item.sourceType}</div>
                    <div className="mt-1 max-w-[16rem] truncate text-xs text-slate-500" title={item.sourceId}>{item.sourceId}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-slate-700">{item.errcode ?? ""}</div>
                    <div className="mt-1 max-w-[18rem] truncate text-xs text-slate-500" title={item.errmsg || item.invaliduser || ""}>{item.errmsg || item.invaliduser || ""}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.attemptCount}</td>
                  <td className="px-3 py-3">
                    <div className="max-w-[13rem] truncate text-slate-600" title={item.msgid || ""}>{item.msgid || "-"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {item.status === "sent" ? (
                      <span className="text-xs text-slate-400">无需重试</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => retryOutboxItem(item)}
                        disabled={retryingId === item.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {retryingId === item.id ? "发送中" : "重试"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && !isLoading ? <EmptyState text="暂无发送记录" /> : null}
      </section>
    </div>
  );
}

function NotificationsPage({
  notifications,
  readIds,
  currentUserId,
  mode,
  canViewAll,
  onModeChange,
  onMarkRead,
  onMarkAllRead,
  onNavigate
}: {
  notifications: NotificationItem[];
  readIds: string[];
  currentUserId: string;
  mode: "mine" | "all";
  canViewAll: boolean;
  onModeChange: (mode: "mine" | "all") => void;
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  onNavigate: (page: PageKey, meetingId?: string) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "pending" | "rejected" | "completed">("all");
  const unread = notifications.filter((item) => isNotificationUnread(item, readIds, currentUserId));
  const pending = notifications.filter((item) => item.category === "待签批" || item.category === "待复核");
  const rejected = notifications.filter((item) => item.category === "驳回修改");
  const completed = notifications.filter((item) => item.category === "签批通过" || item.category === "复核通过" || item.category === "公司支持");
  const filteredNotifications =
    activeFilter === "unread"
      ? unread
      : activeFilter === "pending"
        ? pending
        : activeFilter === "rejected"
          ? rejected
          : activeFilter === "completed"
            ? completed
            : notifications;
  const filterLabel = {
    all: "全部消息",
    unread: "未读消息",
    pending: "待处理消息",
    rejected: "驳回修改消息",
    completed: "已闭环反馈"
  }[activeFilter];
  const toneClass: Record<NotificationTone, string> = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    green: solidTone.green,
    red: solidTone.red,
    amber: solidTone.amber
  };
  const getSourceAction = (item: NotificationItem) => {
    if (item.meetingId?.startsWith("okr-")) {
      return {
        label: "查看 OKR",
        run: () => onNavigate("kr-projects")
      };
    }
    if (item.meetingId) {
      return {
        label: "查看会议",
        run: () => onNavigate("meeting-detail", item.meetingId)
      };
    }
    if (item.taskId) {
      return {
        label: "查看台账",
        run: () => onNavigate("tasks", item.taskId)
      };
    }
    return null;
  };

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-6 shadow-panel">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="text-xs font-semibold text-brand">消息通知</div>
            <h2 className="mt-1 text-2xl font-semibold text-ink">闭环消息中心</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canViewAll ? (
              <div className="inline-flex rounded-lg border border-line bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => onModeChange("mine")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "mine" ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}`}
                >
                  我的消息
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange("all")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "all" ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}`}
                >
                  全量动态
                </button>
              </div>
            ) : null}
            <button
              onClick={onMarkAllRead}
              disabled={!unread.length}
              className="app-action-button px-4 py-2 text-sm"
            >
              全部标记已读
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-4 gap-4">
        <NotificationMetric label="未读消息" value={`${unread.length} 条`} tone={unread.length ? "red" : "green"} active={activeFilter === "unread"} onClick={() => setActiveFilter("unread")} />
        <NotificationMetric label="待处理" value={`${pending.length} 条`} tone={pending.length ? "amber" : "green"} active={activeFilter === "pending"} onClick={() => setActiveFilter("pending")} />
        <NotificationMetric label="驳回修改" value={`${rejected.length} 条`} tone={rejected.length ? "red" : "green"} active={activeFilter === "rejected"} onClick={() => setActiveFilter("rejected")} />
        <NotificationMetric label="已闭环反馈" value={`${completed.length} 条`} tone="blue" active={activeFilter === "completed"} onClick={() => setActiveFilter("completed")} />
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <SectionHeader title="通知列表" icon={Bell} />
          <div className="flex items-center gap-2">
            {activeFilter !== "all" ? (
              <button onClick={() => setActiveFilter("all")} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                查看全部
              </button>
            ) : null}
            <span className="app-action-pill px-3 py-1 text-sm">{filteredNotifications.length} 条消息</span>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {filteredNotifications.length ? (
            filteredNotifications.map((item) => {
              const isRead = !isNotificationUnread(item, readIds, currentUserId);
              const sourceAction = getSourceAction(item);
              const approvalAction = item.category === "待签批" || item.category === "待复核";
              const optimizeAction = item.category === "驳回修改" && Boolean(item.taskId);
              return (
                <div key={item.id} className={`rounded-xl border p-4 transition ${isRead ? "border-line bg-white" : "border-blue-100 bg-blue-50/40"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {!isRead ? <span className="h-2 w-2 rounded-full bg-red-500" /> : null}
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass[item.tone]}`}>{item.category}</span>
                        <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.content}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>时间：{item.time}</span>
                        {item.actor ? <span>触发人：{item.actor}</span> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {optimizeAction ? (
                        <button
                          onClick={() => {
                            onMarkRead(item.id);
                            onNavigate("my-tasks", item.taskId);
                          }}
                          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          去优化
                        </button>
                      ) : null}
                      {approvalAction ? (
                        <button
                          onClick={() => {
                            onMarkRead(item.id);
                            onNavigate("my-tasks", item.taskId);
                          }}
                          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          去审批
                        </button>
                      ) : null}
                      {sourceAction ? (
                        <button
                          onClick={() => {
                            onMarkRead(item.id);
                            sourceAction.run();
                          }}
                          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {sourceAction.label}
                        </button>
                      ) : null}
                      <button
                        onClick={() => onMarkRead(item.id)}
                        disabled={isRead}
                        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {isRead ? "已读" : "标记已读"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState text="当前筛选下暂无消息" />
          )}
        </div>
      </section>
    </div>
  );
}

function NotificationMetric({
  label,
  value,
  tone,
  active,
  onClick
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "red" | "amber";
  active?: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    green: solidTone.green,
    red: solidTone.red,
    amber: solidTone.amber
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left shadow-panel transition hover:border-blue-200 hover:bg-blue-50/40 ${active ? "border-brand ring-2 ring-blue-100" : "border-line"}`}
    >
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`mt-3 inline-flex rounded-lg px-3 py-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </button>
  );
}

function MetricTile({
  label,
  value,
  helper,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  helper?: string;
  icon: typeof LayoutDashboard;
  tone: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const toneMap = {
    blue: "bg-blue-50 text-blue-700",
    green: solidFill.green,
    amber: solidFill.amber,
    red: solidFill.red,
    slate: "bg-slate-100 text-slate-700"
  };

  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
          {helper ? <div className="mt-1 text-xs text-slate-500">{helper}</div> : null}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneMap[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ task }: { task: Task }) {
  const label = isTaskCompleted(task) ? "已完成" : task.status === "pending_review" ? "已提交待复核" : task.status === "blocked" ? "已阻塞" : getRiskLevel(task);
  if (label === "正常" && (task.approvalStatus === "in_closed_loop" || task.approvalStatus === "approved")) return null;
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${getTaskStatusTone(task)}`}>{label}</span>;
}

function TaskApprovalBadge({ task }: { task: Task }) {
  if (task.approvalStatus === "in_closed_loop" || task.approvalStatus === "approved") {
    return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${solidTone.green}`}>签批通过</span>;
  }
  if (task.approvalStatus === "pending_president_approval") {
    return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${solidTone.amber}`}>待总裁签批</span>;
  }
  if (task.approvalStatus === "rejected") {
    return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${solidTone.red}`}>签批驳回</span>;
  }
  return null;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${getPriorityTone(priority)}`}>{priority}优先级</span>;
}

function DashboardPage({
  metrics: _metrics,
  meetings,
  tasks,
  pendingApprovalTasks,
  currentUserId,
  onNavigate,
  onUpdateTaskStatus,
  onApproveTask,
  onRejectTask,
  onCompleteCompanySupport
}: {
  metrics: { meetings: number; totalDuration: number; tasks: number; completed: number; overdue: number; dueSoon: number; completionRate: number };
  meetings: Meeting[];
  tasks: Task[];
  pendingApprovalTasks: Task[];
  currentUserId: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onApproveTask: (taskId: string) => void;
  onRejectTask: (taskId: string, reason?: string) => void;
  onCompleteCompanySupport: (taskId: string) => void;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>("this_week");
  const defaultCustomRange = getDashboardPeriodRange("this_week");
  const [customStartDate, setCustomStartDate] = useState(dateKey(defaultCustomRange.start));
  const [customEndDate, setCustomEndDate] = useState(dateKey(defaultCustomRange.end));
  const [appliedCustomRange, setAppliedCustomRange] = useState({ start: dateKey(defaultCustomRange.start), end: dateKey(defaultCustomRange.end) });
  const [isCustomRange, setIsCustomRange] = useState(false);
  const customStartRef = useRef<HTMLInputElement>(null);
  const customEndRef = useRef<HTMLInputElement>(null);
  const [focusedDepartmentId, setFocusedDepartmentId] = useState("");
  const [focusedDepartmentDrill, setFocusedDepartmentDrill] = useState<DepartmentDrillType>("overdue");
  const [highlightedDepartmentId, setHighlightedDepartmentId] = useState("");
  const [departmentDetailPage, setDepartmentDetailPage] = useState(1);
  const [departmentDetailPageInput, setDepartmentDetailPageInput] = useState("1");
  const [departmentDetailSearch, setDepartmentDetailSearch] = useState("");
  const [departmentBoardPage, setDepartmentBoardPage] = useState(1);
  const [departmentBoardPageInput, setDepartmentBoardPageInput] = useState("1");
  const [departmentBoardSearch, setDepartmentBoardSearch] = useState("");
  const quickRange = getDashboardPeriodRange(period);
  const customStart = parseLocalDate(appliedCustomRange.start);
  const customEnd = parseLocalDate(appliedCustomRange.end);
  const range = isCustomRange
    ? {
        start: customStart <= customEnd ? customStart : customEnd,
        end: customStart <= customEnd ? customEnd : customStart,
        label: "自定义"
      }
    : quickRange;
  const filteredMeetings = meetings.filter((meeting) => isDateInRange(meeting.startTime, range.start, range.end));
  const filteredMeetingIds = new Set(filteredMeetings.map((meeting) => meeting.id));
  const filteredTasks = tasks.filter((task) => {
    if (filteredMeetingIds.has(task.meetingId)) return true;
    if (!task.meetingId.startsWith("okr-")) return false;
    return isDateInRange(task.startDate ?? task.dueDate, range.start, range.end) || isDateInRange(task.dueDate, range.start, range.end);
  });
  const totalDuration = filteredMeetings.reduce((sum, meeting) => sum + meeting.durationMinutes, 0);
  const totalManHours = filteredMeetings.reduce((sum, meeting) => sum + getMeetingManHours(meeting), 0);
  const completedTasks = filteredTasks.filter(isTaskCompleted).length;
  const onTimeTasks = filteredTasks.filter(isTaskCompletedOnTime).length;
  const delayedTasks = filteredTasks.filter(isTaskDelayed).length;
  const completionRate = filteredTasks.length ? completedTasks / filteredTasks.length : 0;
  const departmentRows = departments
    .filter((department) => department.id !== "dept-president")
    .map((department) => {
      const deptMeetings = filteredMeetings.filter((meeting) => meeting.departmentId === department.id);
      const deptTasks = filteredTasks.filter((task) => isTaskRelatedToDepartment(task, department.id, findMeeting(filteredMeetings, task.meetingId)));
      const meetingMinutes = deptMeetings.reduce((sum, meeting) => sum + meeting.durationMinutes, 0);
      const manHours = deptMeetings.reduce((sum, meeting) => sum + getMeetingManHours(meeting), 0);
      const completed = deptTasks.filter(isTaskCompleted).length;
      const remaining = deptTasks.length - completed;
      const onTime = deptTasks.filter(isTaskCompletedOnTime).length;
      const delayed = deptTasks.filter(isTaskDelayed).length;
      const sortedTasks = [...deptTasks].sort(
        (a, b) =>
          Number(isOverdue(b)) - Number(isOverdue(a)) ||
          getPriorityRank(b.priority) - getPriorityRank(a.priority) ||
          a.dueDate.localeCompare(b.dueDate)
      );
      const overdueTasks = sortedTasks.filter(isOverdue);
      return {
        department,
        tasks: sortedTasks,
        meetingsList: deptMeetings,
        meetings: deptMeetings.length,
        meetingMinutes,
        manHours,
        total: deptTasks.length,
        completed,
        remaining,
        onTime,
        delayed,
        overdueTasks,
        rate: deptTasks.length ? completed / deptTasks.length : 0
      };
    })
    .sort((a, b) => b.delayed - a.delayed || b.remaining - a.remaining || b.total - a.total);
  const maxDepartmentMinutes = Math.max(...departmentRows.map((row) => row.meetingMinutes), 1);
  const maxDepartmentTasks = Math.max(...departmentRows.map((row) => row.total), 1);
  const departmentDetailTotalPages = Math.max(1, Math.ceil(departmentRows.length / DEPARTMENT_PAGE_SIZE));
  const departmentBoardTotalPages = Math.max(1, Math.ceil(departmentRows.length / DEPARTMENT_PAGE_SIZE));
  const departmentDetailRows = departmentRows.slice((departmentDetailPage - 1) * DEPARTMENT_PAGE_SIZE, departmentDetailPage * DEPARTMENT_PAGE_SIZE);
  const departmentBoardRows = departmentRows.slice((departmentBoardPage - 1) * DEPARTMENT_PAGE_SIZE, departmentBoardPage * DEPARTMENT_PAGE_SIZE);
  const focusedDepartmentRow = focusedDepartmentId ? departmentRows.find((row) => row.department.id === focusedDepartmentId) : undefined;
  const focusedDepartmentTasks = focusedDepartmentRow
    ? focusedDepartmentDrill === "completed"
      ? focusedDepartmentRow.tasks.filter(isTaskCompleted)
      : focusedDepartmentDrill === "remaining"
        ? focusedDepartmentRow.tasks.filter((task) => !isTaskCompleted(task))
        : focusedDepartmentDrill === "overdue"
          ? focusedDepartmentRow.overdueTasks
          : focusedDepartmentRow.tasks
    : [];
  const focusedDepartmentMeetings = focusedDepartmentRow?.meetingsList ?? [];
  const focusedDepartmentDrillLabel: Record<DepartmentDrillType, string> = {
    total: "全部待办",
    completed: "已完成待办",
    remaining: "剩余待办",
    overdue: "逾期待办",
    meetings: "会议场次",
    duration: "会议时长",
    manhours: "会议人工时"
  };
  const isFocusedDepartmentMeetingDrill = ["meetings", "duration", "manhours"].includes(focusedDepartmentDrill);
  useEffect(() => {
    if (departmentDetailPage > departmentDetailTotalPages) {
      setDepartmentDetailPage(departmentDetailTotalPages);
      setDepartmentDetailPageInput(String(departmentDetailTotalPages));
    }
  }, [departmentDetailPage, departmentDetailTotalPages]);
  useEffect(() => {
    if (departmentBoardPage > departmentBoardTotalPages) {
      setDepartmentBoardPage(departmentBoardTotalPages);
      setDepartmentBoardPageInput(String(departmentBoardTotalPages));
    }
  }, [departmentBoardPage, departmentBoardTotalPages]);
  const openDepartmentDrill = (departmentId: string, drill: DepartmentDrillType) => {
    setFocusedDepartmentId(departmentId);
    setFocusedDepartmentDrill(drill);
  };
  const findDepartmentIndexByKeyword = (keyword: string) => {
    const normalizeSearchValue = (value: string) =>
      value
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[\\/|,，.。:：;；()（）【】[\]_-]/g, "")
        .replace(/部门|中心|门店|店|小组|团队/g, "");
    const normalizedKeyword = normalizeSearchValue(keyword);
    if (!normalizedKeyword) return -1;
    return departmentRows.findIndex((row) => {
      const departmentText = normalizeSearchValue(`${row.department.name} ${row.department.fullPath ?? ""} ${row.department.description ?? ""}`);
      const userMatched = users.some((user) => user.departmentId === row.department.id && normalizeSearchValue(userSearchText(user, row.department)).includes(normalizedKeyword));
      return departmentText.includes(normalizedKeyword) || userMatched;
    });
  };
  const jumpToDepartmentPage = (
    keyword: string,
    setPage: (page: number) => void,
    setPageInput: (value: string) => void,
    shouldOpenDepartment: boolean
  ) => {
    const index = findDepartmentIndexByKeyword(keyword);
    if (index < 0) return;
    const nextPage = Math.floor(index / DEPARTMENT_PAGE_SIZE) + 1;
    const targetDepartmentId = departmentRows[index].department.id;
    setPage(nextPage);
    setPageInput(String(nextPage));
    setHighlightedDepartmentId(targetDepartmentId);
    if (shouldOpenDepartment) openDepartmentDrill(targetDepartmentId, "total");
  };

  const riskTasks = filteredTasks
    .filter((task) => isOverdue(task) || isDueSoon(task))
    .sort((a, b) => getPriorityRank(b.priority) - getPriorityRank(a.priority) || Number(isOverdue(b)) - Number(isOverdue(a)) || a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  const companySupportTasks = filteredTasks
    .filter((task) => Boolean(task.companySupportRequest?.trim()) && task.companySupportStatus !== "completed")
    .sort(
      (a, b) =>
        Number(a.companySupportStatus === "completed") - Number(b.companySupportStatus === "completed") ||
        Number(isOverdue(b)) - Number(isOverdue(a)) ||
        getPriorityRank(b.priority) - getPriorityRank(a.priority) ||
        a.dueDate.localeCompare(b.dueDate)
    );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs font-medium text-brand">管理驾驶舱</div>
            <h2 className="mt-1 text-xl font-semibold text-ink">会议效率与执行闭环总览</h2>
            <p className="mt-1 text-sm text-slate-500">
              当前统计周期：{dateKey(range.start)} 至 {dateKey(range.end)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex rounded-lg border border-line bg-slate-50 p-1">
              {dashboardPeriods.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    setPeriod(item.key);
                    setIsCustomRange(false);
                  }}
                  className={`rounded-md px-4 py-2 text-sm font-medium ${!isCustomRange && period === item.key ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-ink"}`}
                >
                  {item.label}
                </button>
              ))}
              <button
                onClick={() => setIsCustomRange(true)}
                className={`rounded-md px-4 py-2 text-sm font-medium ${isCustomRange ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-ink"}`}
              >
                自定义
              </button>
            </div>
            {isCustomRange && (
              <div className="flex items-end gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <CalendarDays className="mb-2 text-brand" size={18} />
                <Field label="开始日期">
                  <input
                    ref={customStartRef}
                    type="date"
                    value={customStartDate}
                    max={customEndDate}
                    onChange={(event) => setCustomStartDate(event.target.value)}
                    className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </Field>
                <span className="mb-2 text-sm text-slate-400">至</span>
                <Field label="结束日期">
                  <input
                    ref={customEndRef}
                    type="date"
                    value={customEndDate}
                    min={customStartDate}
                    onChange={(event) => setCustomEndDate(event.target.value)}
                    className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </Field>
                <button
                  onClick={() => {
                    const nextStart = customStartRef.current?.value || customStartDate;
                    const nextEnd = customEndRef.current?.value || customEndDate;
                    setCustomStartDate(nextStart);
                    setCustomEndDate(nextEnd);
                    setAppliedCustomRange({ start: nextStart, end: nextEnd });
                  }}
                  className="mb-0.5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Filter size={15} />
                  应用筛选
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1.25fr)_420px] gap-5">
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">公司会议投入图</h2>
            </div>
            <BarChart3 className="text-brand" size={20} />
          </div>

          <div className="grid grid-cols-[210px_minmax(0,1fr)] gap-6">
            <DonutChart
              value={filteredMeetings.length}
              total={filteredMeetings.length}
              label="已沉淀会议"
              center={`${filteredMeetings.length}场`}
              color="#2563eb"
              restColor="#dbeafe"
            />
            <div className="space-y-4">
              <DashboardBar label="会议总数" value={filteredMeetings.length} max={Math.max(filteredMeetings.length, 1)} unit="场" color="bg-blue-500" />
              <DashboardBar label="会议总时长" value={totalDuration} max={Math.max(totalDuration, 1)} unit="分钟" color="bg-indigo-500" />
              <DashboardBar label="会议人工时" value={Number(totalManHours.toFixed(1))} max={Math.max(totalManHours, 1)} unit="人工时" color="bg-cyan-500" />
              <DashboardBar label="形成待办" value={filteredTasks.length} max={Math.max(filteredTasks.length, 1)} unit="项" color="bg-slate-600" />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">待办执行情况</h2>
            </div>
            <CheckCircle2 className="text-emerald-600" size={20} />
          </div>
          <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-5">
            <DonutChart value={completedTasks} total={filteredTasks.length} label="完成率" center={formatPercent(completionRate)} color="#10b981" restColor="#e2e8f0" />
            <div className="space-y-3">
              <ExecutionStat label="全部待办" value={filteredTasks.length} icon={ClipboardList} tone="slate" />
              <ExecutionStat label="已完成" value={completedTasks} icon={CheckCircle2} tone="green" />
              <ExecutionStat label="按时完成" value={onTimeTasks} icon={Clock3} tone="blue" />
              <ExecutionStat label="延期/逾期" value={delayedTasks} icon={AlertTriangle} tone="red" />
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className={`flex items-center justify-between gap-3 ${pendingApprovalTasks.length ? "mb-5" : ""}`}>
          <div>
            <h2 className="text-base font-semibold text-ink">待总裁签批待办</h2>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-medium ${solidTone.amber}`}>{pendingApprovalTasks.length} 项待签批</span>
        </div>
        {pendingApprovalTasks.length ? (
          <div className="grid grid-cols-2 gap-4">
            {pendingApprovalTasks.map((task) => {
              const meeting = findMeeting(meetings, task.meetingId);
              return (
                <div key={task.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{getTaskContent(task)}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {meeting ? meeting.title : "未知会议"} · {findDepartment(getTaskDepartmentId(task))?.name}
                      </div>
                    </div>
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
                    <div className="rounded-lg bg-white px-3 py-2">
                      <div className="text-slate-500">待办推进人</div>
                      <div className="mt-1 font-semibold text-ink">{findUser(getTaskOwnerId(task))?.name}</div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <div className="text-slate-500">复核人</div>
                      <div className="mt-1 font-semibold text-ink">{findUser(getTaskReviewerId(task, meeting))?.name}</div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <div className="text-slate-500">开始时间</div>
                      <div className="mt-1 font-semibold text-ink">{task.startDate || "未填写"}</div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <div className="text-slate-500">截止时间</div>
                      <div className="mt-1 font-semibold text-ink">{task.dueDate}</div>
                    </div>
                  </div>
                  {task.goal ? <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">目标：{task.goal}</div> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => onApproveTask(task.id)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                      <CheckCircle2 size={15} />
                      签批通过
                    </button>
                    <button
                      onClick={() => onRejectTask(task.id)}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      <AlertTriangle size={15} />
                      驳回修改
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className={`flex items-center justify-between gap-3 ${companySupportTasks.length ? "mb-5" : ""}`}>
          <div>
            <h2 className="text-base font-semibold text-ink">需要公司支持的事项</h2>
          </div>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">{companySupportTasks.length} 项</span>
        </div>

        {companySupportTasks.length ? (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_110px_100px_240px] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
              <div>待办与责任部门</div>
              <div>需要公司支持</div>
              <div>截止日期</div>
              <div>支持状态</div>
              <div>操作</div>
            </div>
            <div className="divide-y divide-line">
              {companySupportTasks.map((task) => {
                const sourceMeeting = findMeeting(filteredMeetings, task.meetingId);
                const isSupportCompleted = task.companySupportStatus === "completed";
                return (
                  <div key={task.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_110px_100px_240px] items-center gap-4 px-4 py-4">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{getTaskContent(task)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {findDepartment(getTaskDepartmentId(task))?.name} · {findUser(getTaskOwnerId(task))?.name}
                        {sourceMeeting ? ` · ${sourceMeeting.title}` : ""}
                      </div>
                    </div>
                    <div className="text-sm leading-6 text-slate-700">{task.companySupportRequest}</div>
                    <div className="text-sm text-slate-600">{task.dueDate}</div>
                    <div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                          isSupportCompleted ? solidTone.green : solidTone.amber
                        }`}
                      >
                        {isSupportCompleted ? "已完成" : "待支持"}
                      </span>
                      {task.companySupportCompletedAt ? <div className="mt-1 text-[11px] text-slate-400">{task.companySupportCompletedAt}</div> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {sourceMeeting ? (
                        <button
                          type="button"
                          onClick={() => onNavigate("meeting-detail", sourceMeeting.id)}
                          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          来源会议
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onNavigate("tasks", task.id)}
                        className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        台账定位
                      </button>
                      <button
                        onClick={() => onCompleteCompanySupport(task.id)}
                        disabled={isSupportCompleted}
                        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                          isSupportCompleted ? "cursor-not-allowed bg-emerald-600 text-white" : "bg-emerald-600 text-white hover:bg-emerald-700"
                        }`}
                      >
                        <CheckCircle2 size={15} />
                        {isSupportCompleted ? "已完成" : "标记完成"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">部门明细维度</h2>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{departmentRows.length} 个部门</span>
        </div>
        <DepartmentPager
          searchValue={departmentDetailSearch}
          onSearchValueChange={setDepartmentDetailSearch}
          onSearch={() => jumpToDepartmentPage(departmentDetailSearch, setDepartmentDetailPage, setDepartmentDetailPageInput, false)}
          currentPage={departmentDetailPage}
          totalPages={departmentDetailTotalPages}
          pageInput={departmentDetailPageInput}
          onPageInputChange={setDepartmentDetailPageInput}
          onPageChange={(page) => {
            setDepartmentDetailPage(page);
            setDepartmentDetailPageInput(String(page));
          }}
          placeholder="搜索部门或人名定位"
          className="mb-4"
        />
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="min-w-[1180px] divide-y divide-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-3">部门</th>
                <th className="px-3 py-3">会议场次</th>
                <th className="px-3 py-3">会议时长</th>
                <th className="px-3 py-3">会议人工时</th>
                <th className="px-3 py-3">形成待办</th>
                <th className="px-3 py-3">已完成</th>
                <th className="px-3 py-3">按时完成</th>
                <th className="px-3 py-3">延期/逾期</th>
                <th className="px-3 py-3">执行进度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {departmentDetailRows.map((row) => (
                <tr key={row.department.id} className={`align-middle hover:bg-slate-50 ${highlightedDepartmentId === row.department.id ? "bg-blue-50/70" : ""}`}>
                  <td className="px-3 py-4 font-medium text-ink">{row.department.name}</td>
                  <td className="px-3 py-4 text-slate-700">{row.meetings} 场</td>
                  <td className="px-3 py-4">
                    <BarWithValue value={row.meetingMinutes} max={maxDepartmentMinutes} unit="分钟" color={row.meetingMinutes ? "bg-blue-500" : "bg-slate-200"} />
                  </td>
                  <td className="px-3 py-4 text-slate-700">{row.manHours.toFixed(1)} 人工时</td>
                  <td className="px-3 py-4">
                    <BarWithValue value={row.total} max={maxDepartmentTasks} unit="项" color={row.total ? "bg-slate-600" : "bg-slate-200"} />
                  </td>
                  <td className="px-3 py-4 text-emerald-700">{row.completed} 项</td>
                  <td className="px-3 py-4 text-blue-700">{row.onTime} 项</td>
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${row.delayed ? solidTone.red : solidTone.green}`}>
                      {row.delayed} 项
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${row.rate * 100}%` }} />
                      </div>
                      <span className="w-10 text-xs text-slate-500">{formatPercent(row.rate)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-5">
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">部门执行看板</h2>
            </div>
            <BarChart3 className="text-slate-400" size={20} />
          </div>
          <DepartmentPager
            searchValue={departmentBoardSearch}
            onSearchValueChange={setDepartmentBoardSearch}
            onSearch={() => jumpToDepartmentPage(departmentBoardSearch, setDepartmentBoardPage, setDepartmentBoardPageInput, true)}
            currentPage={departmentBoardPage}
            totalPages={departmentBoardTotalPages}
            pageInput={departmentBoardPageInput}
            onPageInputChange={setDepartmentBoardPageInput}
            onPageChange={(page) => {
              setDepartmentBoardPage(page);
              setDepartmentBoardPageInput(String(page));
            }}
            placeholder="搜索部门或人名定位"
            className="mb-4"
          />
          {focusedDepartmentRow ? (
            <div className={`mb-5 rounded-xl border p-4 ${focusedDepartmentDrill === "overdue" ? "border-red-200 bg-red-50/40" : "border-blue-200 bg-blue-50/40"}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className={`text-sm font-semibold ${focusedDepartmentDrill === "overdue" ? "text-red-900" : "text-blue-900"}`}>
                    {focusedDepartmentRow.department.name} {focusedDepartmentDrillLabel[focusedDepartmentDrill]}明细
                  </h3>
                  <p className={`mt-1 text-xs ${focusedDepartmentDrill === "overdue" ? "text-red-700" : "text-blue-700"}`}>
                    {isFocusedDepartmentMeetingDrill ? "这里列出该部门在当前周期内上传的会议记录。" : "这里列出该部门对应范围内的待办，方便直接定位到具体事项。"}
                  </p>
                </div>
                <button
                  onClick={() => setFocusedDepartmentId("")}
                  className={`rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-white/80 ${
                    focusedDepartmentDrill === "overdue" ? "border-red-200 text-red-700" : "border-blue-200 text-blue-700"
                  }`}
                >
                  收起列表
                </button>
              </div>
              {isFocusedDepartmentMeetingDrill ? (
                focusedDepartmentMeetings.length ? (
                  <div className="overflow-hidden rounded-lg border border-blue-100 bg-white">
                    <div className="grid grid-cols-[minmax(0,1.3fr)_120px_130px_110px_110px] gap-3 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                      <div>会议</div>
                      <div>主持人</div>
                      <div>会议时间</div>
                      <div>会议时长</div>
                      <div>会议人工时</div>
                    </div>
                    <div className="divide-y divide-blue-100">
                      {focusedDepartmentMeetings.map((meeting) => (
                        <div key={meeting.id} className="grid grid-cols-[minmax(0,1.3fr)_120px_130px_110px_110px] items-center gap-3 px-3 py-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{meeting.title}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">{meeting.type} · 形成 {filteredTasks.filter((task) => task.meetingId === meeting.id).length} 项待办</div>
                          </div>
                          <div className="text-slate-600">{findUser(meeting.hostId)?.name}</div>
                          <div className="text-slate-600">{meeting.startTime}</div>
                          <div className="font-semibold text-slate-700">{meeting.durationMinutes} 分钟</div>
                          <div className="font-semibold text-slate-700">{getMeetingManHours(meeting).toFixed(1)} 人工时</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState text="当前周期没有会议上传记录" />
                )
              ) : focusedDepartmentTasks.length ? (
                <div className="overflow-hidden rounded-lg border border-blue-100 bg-white">
                  <div className={`grid grid-cols-[minmax(0,1.2fr)_120px_120px_110px_110px] gap-3 px-3 py-2 text-xs font-semibold ${
                    focusedDepartmentDrill === "overdue" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
                  }`}>
                    <div>具体待办</div>
                    <div>推进人</div>
                    <div>截止日期</div>
                    <div>优先级</div>
                    <div>当前状态</div>
                  </div>
                  <div className="divide-y divide-blue-100">
                    {focusedDepartmentTasks.map((task) => {
                      const meeting = findMeeting(filteredMeetings, task.meetingId);
                      const overdueDays = Math.max(1, -daysFromToday(task.dueDate));
                      return (
                        <div key={task.id} className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_110px_110px] items-center gap-3 px-3 py-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{getTaskContent(task)}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">{meeting ? meeting.title : "来源会议未找到"}</div>
                          </div>
                          <div className="text-slate-600">{findUser(getTaskOwnerId(task))?.name}</div>
                          <div className="text-slate-600">{task.dueDate}</div>
                          <div className={task.priority === "高" ? "font-semibold text-red-700" : task.priority === "中" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
                            {task.priority}优先级
                          </div>
                          <div className={isOverdue(task) ? "font-semibold text-red-700" : isTaskCompleted(task) ? "font-semibold text-emerald-700" : "font-semibold text-blue-700"}>
                            {isOverdue(task) ? `逾期 ${overdueDays} 天` : getTaskStatusLabel(task.status)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState text={`当前部门没有${focusedDepartmentDrillLabel[focusedDepartmentDrill]}`} />
              )}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            {departmentBoardRows.map((row) => {
              const isFocused = focusedDepartmentRow?.department.id === row.department.id;
              const hasOverdue = row.overdueTasks.length > 0;
              return (
                <div
                  key={row.department.id}
                  className={`rounded-xl border p-4 text-left transition ${
                    hasOverdue ? (isFocused ? "border-red-300 bg-red-50 ring-1 ring-red-100" : "border-red-200 bg-red-50/50") : isFocused ? "border-blue-200 bg-blue-50/60" : "border-line bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-700">{row.department.name}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.delayed ? solidFill.red : solidFill.green}`}>
                      {row.delayed ? `${row.delayed} 逾期` : "无逾期"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    <DepartmentStat label="总待办" value={row.total} tone="slate" active={isFocused && focusedDepartmentDrill === "total"} onClick={() => openDepartmentDrill(row.department.id, "total")} />
                    <DepartmentStat label="已完成" value={row.completed} tone="green" active={isFocused && focusedDepartmentDrill === "completed"} onClick={() => openDepartmentDrill(row.department.id, "completed")} />
                    <DepartmentStat label="剩余" value={row.remaining} tone="blue" active={isFocused && focusedDepartmentDrill === "remaining"} onClick={() => openDepartmentDrill(row.department.id, "remaining")} />
                    <DepartmentStat label="逾期" value={row.delayed} tone="red" active={isFocused && focusedDepartmentDrill === "overdue"} onClick={() => openDepartmentDrill(row.department.id, "overdue")} />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${row.delayed ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(row.rate * 100, row.total ? 8 : 0)}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <button type="button" onClick={() => openDepartmentDrill(row.department.id, "meetings")} className={`rounded-lg bg-white/70 px-2 py-1.5 text-left text-slate-600 transition hover:bg-blue-50 ${isFocused && focusedDepartmentDrill === "meetings" ? "ring-1 ring-blue-300" : ""}`}>
                      <div className="font-semibold text-ink">{row.meetings} 场</div>
                      <div>会议</div>
                    </button>
                    <button type="button" onClick={() => openDepartmentDrill(row.department.id, "duration")} className={`rounded-lg bg-white/70 px-2 py-1.5 text-left text-slate-600 transition hover:bg-blue-50 ${isFocused && focusedDepartmentDrill === "duration" ? "ring-1 ring-blue-300" : ""}`}>
                      <div className="font-semibold text-ink">{row.meetingMinutes} 分钟</div>
                      <div>会议时长</div>
                    </button>
                    <button type="button" onClick={() => openDepartmentDrill(row.department.id, "manhours")} className={`rounded-lg bg-white/70 px-2 py-1.5 text-left text-slate-600 transition hover:bg-blue-50 ${isFocused && focusedDepartmentDrill === "manhours" ? "ring-1 ring-blue-300" : ""}`}>
                      <div className="font-semibold text-ink">{row.manHours.toFixed(1)}</div>
                      <div>人工时</div>
                    </button>
                  </div>
                  <div className="mt-2 text-right text-xs text-slate-500">完成率 {formatPercent(row.rate)}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">公司关注逾期</h2>
            </div>
            <AlertTriangle className="text-amber-600" size={20} />
          </div>
          <div className="space-y-3">
            {riskTasks.length ? (
              riskTasks.map((task) => <CompanyAttentionTaskCard key={task.id} task={task} meetings={filteredMeetings} currentUserId={currentUserId} onNavigate={onNavigate} onUpdateTaskStatus={onUpdateTaskStatus} />)
            ) : (
              <EmptyState text="当前周期没有风险待办" />
            )}
          </div>
        </section>
      </div>

    </div>
  );
}

function DepartmentPager({
  searchValue,
  onSearchValueChange,
  onSearch,
  currentPage,
  totalPages,
  pageInput,
  onPageInputChange,
  onPageChange,
  placeholder,
  className = ""
}: {
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onSearch: () => void;
  currentPage: number;
  totalPages: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageChange: (page: number) => void;
  placeholder: string;
  className?: string;
}) {
  const clampPage = (page: number) => Math.min(Math.max(page, 1), totalPages);
  const commitPage = () => {
    const parsed = Number(pageInput);
    const nextPage = Number.isFinite(parsed) && parsed > 0 ? clampPage(Math.floor(parsed)) : currentPage;
    onPageChange(nextPage);
  };

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-slate-50 px-3 py-3 ${className}`}>
      <form
        className="relative min-w-[260px] flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={searchValue}
          onChange={(event) => onSearchValueChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-20 text-sm outline-none focus:border-brand"
        />
        <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
          定位
        </button>
      </form>
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => onPageChange(clampPage(currentPage - 1))}
          disabled={currentPage <= 1}
          className="rounded-lg border border-line bg-white px-3 py-2 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          上一页
        </button>
        <div className="flex items-center gap-2 text-slate-600">
          <span>第</span>
          <input
            value={pageInput}
            onChange={(event) => onPageInputChange(event.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPage();
              }
            }}
            className="w-14 rounded-lg border border-line bg-white px-2 py-2 text-center text-sm font-medium text-ink outline-none focus:border-brand"
          />
          <span>/ {totalPages} 页</span>
        </div>
        <button
          type="button"
          onClick={() => onPageChange(clampPage(currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="rounded-lg border border-line bg-white px-3 py-2 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function DonutChart({
  value,
  total,
  label,
  center,
  color,
  restColor
}: {
  value: number;
  total: number;
  label: string;
  center: string;
  color: string;
  restColor: string;
}) {
  const percent = total ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className="relative flex h-40 w-40 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${color} ${percent}%, ${restColor} 0)` }}
      >
        <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white shadow-inner">
          <div className="text-2xl font-semibold text-ink">{center}</div>
          <div className="mt-1 text-xs text-slate-500">{label}</div>
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-500">
        {value}/{total || 0}
      </div>
    </div>
  );
}

function DashboardBar({ label, value, max, unit, color }: { label: string; value: number; max: number; unit: string; color: string }) {
  const width = max ? Math.min(100, Math.max(value ? 6 : 0, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          {value} {unit}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function BarWithValue({ value, max, unit, color }: { value: number; max: number; unit: string; color: string }) {
  const width = max ? Math.min(100, Math.max(value ? 7 : 0, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 w-32 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="whitespace-nowrap text-slate-700">
        {value} {unit}
      </span>
    </div>
  );
}

function ExecutionStat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof LayoutDashboard; tone: "blue" | "green" | "red" | "slate" }) {
  const toneMap = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    green: solidTone.green,
    red: solidTone.red,
    slate: "border-slate-200 bg-slate-50 text-slate-700"
  };
  return (
    <div className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${toneMap[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon size={16} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-base font-semibold">{value} 项</span>
    </div>
  );
}

function DepartmentStat({
  label,
  value,
  tone,
  active,
  onClick
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "red" | "slate";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneMap = {
    blue: "bg-blue-50 text-blue-700",
    green: solidFill.green,
    red: solidFill.red,
    slate: "bg-slate-50 text-slate-700"
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2 py-2 text-center transition hover:-translate-y-0.5 hover:shadow-sm ${toneMap[tone]} ${active ? "ring-2 ring-blue-300" : ""}`}
    >
      <div className="text-base font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium">{label}</div>
    </button>
  );
}

function LedgerDeptStat({
  label,
  value,
  tone,
  onClick
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "red" | "slate";
  onClick: () => void;
}) {
  const toneMap = {
    blue: "bg-blue-50 text-blue-700 hover:bg-blue-100",
    green: `${solidFill.green} hover:bg-emerald-700`,
    red: `${solidFill.red} hover:bg-red-700`,
    slate: "bg-slate-50 text-slate-700 hover:bg-slate-100"
  };
  return (
    <button type="button" onClick={onClick} className={`rounded-lg px-2 py-2 text-center transition hover:-translate-y-0.5 hover:shadow-sm ${toneMap[tone]}`}>
      <div className="text-base font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium">{label}</div>
    </button>
  );
}

function ScheduleBadge({ actual, expected }: { actual: number; expected: number }) {
  const done = expected === 0 || actual >= expected;
  const partial = actual > 0 && actual < expected;
  const className = done
    ? solidTone.green
    : partial
      ? solidTone.amber
      : solidTone.red;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{actual}/{expected} 次</span>;
}

function MeetingScheduleStatus({ status }: { status: string }) {
  const className =
    status === "已按时召开"
      ? solidTone.green
      : status === "部分缺失"
        ? solidTone.amber
        : solidTone.red;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{status}</span>;
}

function TaskProgressBadges({ total, completed, delayed }: { total: number; completed: number; delayed: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">新增 {total}</span>
      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${solidTone.green}`}>完成 {completed}</span>
      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${delayed ? solidTone.red : "border-slate-200 bg-slate-50 text-slate-600"}`}>延期 {delayed}</span>
    </div>
  );
}

function ProjectStat({ label, value, tone }: { label: string; value: string | number; tone: "blue" | "green" | "red" | "slate" }) {
  const toneMap = {
    blue: "bg-blue-50 text-blue-700",
    green: solidFill.green,
    red: solidFill.red,
    slate: "bg-slate-50 text-slate-700"
  };
  return (
    <div className={`rounded-lg px-2 py-2 text-center ${toneMap[tone]}`}>
      <div className="text-base font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium">{label}</div>
    </div>
  );
}

type MeetingUnit = {
  id: string;
  name: string;
  category: "部门" | "门店";
  departmentId: string;
  ownerId: string;
  weeklyRequired: boolean;
  monthlyRequired: boolean;
  keyword?: string;
};

const meetingUnits: MeetingUnit[] = [
  ...departments
    .filter((department) => department.id !== "dept-president")
    .map((department) => ({
      id: `unit-${department.id}`,
      name: department.name,
      category: "部门" as const,
      departmentId: department.id,
      ownerId: department.managerId,
      weeklyRequired: true,
      monthlyRequired: true
    })),
  { id: "store-wenshui", name: "问水店", category: "门店", departmentId: "dept-store", ownerId: "u-meifeng", weeklyRequired: true, monthlyRequired: true, keyword: "问水" },
  { id: "store-zhenbei", name: "真北店", category: "门店", departmentId: "dept-store", ownerId: "u-meifeng", weeklyRequired: true, monthlyRequired: true, keyword: "真北" },
  { id: "store-xinghe", name: "星河店", category: "门店", departmentId: "dept-store", ownerId: "u-meifeng", weeklyRequired: true, monthlyRequired: true, keyword: "星河" },
  { id: "store-chengxi", name: "城西店", category: "门店", departmentId: "dept-store", ownerId: "u-meifeng", weeklyRequired: true, monthlyRequired: true, keyword: "城西" }
];

function isWeeklyMeeting(meeting: Meeting) {
  return meeting.type.includes("周会") || meeting.title.includes("周会");
}

function isMonthlyMeeting(meeting: Meeting) {
  return meeting.title.includes("月会") || meeting.title.includes("月度");
}

function hasMeetingRecording(meeting: Meeting) {
  return Boolean(meeting.uploadedFileName || meeting.rawTranscript || meeting.transcript || meeting.aiSummary || meeting.summary);
}

function expectedWeeklyCount(start: Date, end: Date) {
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return Math.max(1, Math.ceil(days / 7));
}

function expectedMonthlyCount(start: Date, end: Date) {
  return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
}

function MeetingsPage({ meetings, tasks, onNavigate }: { meetings: Meeting[]; tasks: Task[]; onNavigate: (page: PageKey, meetingId?: string) => void }) {
  const defaultRange = getDashboardPeriodRange("this_month");
  const [startDate, setStartDate] = useState(dateKey(defaultRange.start));
  const [endDate, setEndDate] = useState(dateKey(defaultRange.end));
  const [departmentFilter, setDepartmentFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [keyword, setKeyword] = useState("");
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const rangedMeetings = meetings.filter((meeting) => isDateInRange(meeting.startTime, start, end));
  function applyQuickRange(period: DashboardPeriod) {
    const next = getDashboardPeriodRange(period);
    setStartDate(dateKey(next.start));
    setEndDate(dateKey(next.end));
  }

  const rows = meetingUnits
    .map((unit) => {
      const unitMeetings = rangedMeetings.filter((meeting) => {
        if (unit.category === "门店") {
          const text = `${meeting.title}${meeting.rawTranscript}${meeting.summary}`;
          return meeting.departmentId === unit.departmentId && Boolean(unit.keyword && text.includes(unit.keyword));
        }
        return meeting.departmentId === unit.departmentId;
      });
      const uploadedMeetings = unitMeetings.filter(hasMeetingRecording);
      const uploadedCount = uploadedMeetings.length;
      const relatedMeetingIds = new Set(unitMeetings.map((meeting) => meeting.id));
      const relatedTasks = tasks.filter((task) => relatedMeetingIds.has(task.meetingId));
      const completed = relatedTasks.filter(isTaskCompleted).length;
      const delayed = relatedTasks.filter(isTaskDelayed).length;
      const duration = uploadedMeetings.reduce((sum, meeting) => sum + meeting.durationMinutes, 0);
      const manHours = uploadedMeetings.reduce((sum, meeting) => sum + getMeetingManHours(meeting), 0);
      const latestMeeting = uploadedMeetings.sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
      const status = uploadedCount > 0 ? "已上传录音" : "未上传录音";
      return {
        unit,
        meetings: unitMeetings,
        uploadedMeetings,
        uploadedCount,
        relatedTasks,
        completed,
        delayed,
        duration,
        manHours,
        latestMeeting,
        status
      };
    })
    .filter((row) => departmentFilter === "全部" || row.unit.departmentId === departmentFilter)
    .filter((row) => !keyword || row.unit.name.includes(keyword) || findDepartment(row.unit.departmentId)?.name.includes(keyword))
    .filter((row) => statusFilter === "全部" || row.status === statusFilter)
    .sort((a, b) => {
      const statusRank = (status: string) => (status === "未上传录音" ? 2 : 1);
      return statusRank(b.status) - statusRank(a.status) || b.delayed - a.delayed || b.relatedTasks.length - a.relatedTasks.length;
    });

  const overview = rows.reduce(
    (acc, row) => {
      acc.units += 1;
      acc.uploaded += row.uploadedCount;
      acc.tasks += row.relatedTasks.length;
      acc.completed += row.completed;
      acc.delayed += row.delayed;
      acc.duration += row.duration;
      acc.manHours += row.manHours;
      return acc;
    },
    { units: 0, uploaded: 0, tasks: 0, completed: 0, delayed: 0, duration: 0, manHours: 0 }
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs font-medium text-brand">会议召开监督台账</div>
            <h2 className="mt-1 text-xl font-semibold text-ink">部门与门店会议安排</h2>
          </div>
          <div className="flex rounded-lg border border-line bg-slate-50 p-1">
            {dashboardPeriods.map((item) => (
              <button key={item.key} onClick={() => applyQuickRange(item.key)} className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-white hover:text-brand">
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <Toolbar>
        <Field label="开始日期">
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="结束日期">
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
        </Field>
        <Select value={departmentFilter} onChange={setDepartmentFilter} label="所属部门">
          <option value="全部">全部部门与门店</option>
          {departments
            .filter((department) => department.id !== "dept-president")
            .map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
        </Select>
        <Select value={statusFilter} onChange={setStatusFilter} label="召开状态">
          <option value="全部">全部状态</option>
          <option value="已上传录音">已上传录音</option>
          <option value="未上传录音">未上传录音</option>
        </Select>
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索部门、门店" className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand" />
        </div>
      </Toolbar>

      <div className="grid grid-cols-4 gap-4">
        <MetricTile label="监督对象" value={`${overview.units} 个`} helper="部门与门店" icon={Building2} tone="slate" />
        <MetricTile label="会议上传" value={`${overview.uploaded} 次`} helper="上传录音即视为召开" icon={FileText} tone={overview.uploaded ? "green" : "amber"} />
        <MetricTile label="会议总时长" value={`${overview.duration} 分钟`} helper={`人工 ${Math.round(overview.manHours * 60)} 分钟`} icon={Clock3} tone="blue" />
        <MetricTile label="待办推进" value={`${overview.tasks} 项`} helper={`完成 ${overview.completed} 项，延期 ${overview.delayed} 项`} icon={ClipboardList} tone={overview.delayed ? "red" : "slate"} />
      </div>

      <section className="rounded-lg border border-line bg-white shadow-panel">
        <div className="overflow-hidden">
          <table className="w-full table-fixed divide-y divide-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="w-[19%] px-3 py-3">监督对象</th>
                <th className="w-[11%] px-3 py-3">负责人</th>
                <th className="w-[15%] px-3 py-3">会议次数</th>
                <th className="w-[16%] px-3 py-3">最近上传</th>
                <th className="w-[14%] px-3 py-3">会议投入</th>
                <th className="w-[15%] px-3 py-3">待办推进</th>
                <th className="w-[10%] px-3 py-3">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.unit.id} className="hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-ink">{row.unit.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.unit.category} · {findDepartment(row.unit.departmentId)?.name}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{findUser(row.unit.ownerId)?.name}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${row.uploadedCount ? solidTone.green : solidTone.red}`}>
                      {row.uploadedCount} 次
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    <div className="truncate">{row.latestMeeting?.startTime ?? "暂无上传"}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{row.latestMeeting?.title ?? "上传后自动计入会议次数"}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {row.duration} 分钟
                    <div className="mt-1 text-xs text-slate-500">人工 {Math.round(row.manHours * 60)} 分钟</div>
                  </td>
                  <td className="px-3 py-3">
                    <TaskProgressBadges total={row.relatedTasks.length} completed={row.completed} delayed={row.delayed} />
                  </td>
                  <td className="px-3 py-3">
                    {row.latestMeeting ? (
                      <button onClick={() => onNavigate("meeting-detail", row.latestMeeting?.id)} className="space-y-1 text-left">
                        <MeetingScheduleStatus status={row.status} />
                        <div className="text-xs font-medium text-brand">详情</div>
                      </button>
                    ) : (
                      <MeetingScheduleStatus status={row.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MeetingSummariesPage({
  meetings,
  tasks,
  account,
  selectedUserId,
  onSelectUser,
  onNavigate
}: {
  meetings: Meeting[];
  tasks: Task[];
  account: TestAccount;
  selectedUserId: string;
  onSelectUser: (userId: string) => void;
  onNavigate: (page: PageKey, meetingId?: string) => void;
}) {
  const accountUser = getAccountUser(account);
  const selectedUser = account.id === "employee" ? findUser(selectedUserId) ?? accountUser : accountUser;
  const selectedDepartment = findDepartment(selectedUser.departmentId);
  const participatedMeetings = account.id === "employee" ? meetings.filter((meeting) => meeting.participantIds.includes(selectedUser.id) || meeting.hostId === selectedUser.id) : meetings;
  const participatedMeetingIds = new Set(participatedMeetings.map((meeting) => meeting.id));
  const relatedTasks = tasks.filter((task) => getTaskOwnerId(task) === selectedUser.id);
  const relatedMeetingIds = new Set(relatedTasks.map((task) => task.meetingId));
  const relatedMeetings = account.id === "employee" ? meetings.filter((meeting) => relatedMeetingIds.has(meeting.id) && !participatedMeetingIds.has(meeting.id)) : [];
  const departmentMeetings = account.id === "employee" ? meetings.filter((meeting) => meeting.departmentId === selectedUser.departmentId) : meetings;
  const departmentTasks = account.id === "employee" ? tasks.filter((task) => getTaskDepartmentId(task) === selectedUser.departmentId) : tasks;
  const scopeLabel = account.id === "president" ? "全局会议" : account.id === "manager" ? "本部门可见会议" : "我参与的会议";

  const summaryCards = [
    { label: account.id === "president" ? "全部会议" : "可见会议", value: `${departmentMeetings.length} 场`, tone: "blue" as const, icon: Building2 },
    { label: scopeLabel, value: `${participatedMeetings.length} 场`, tone: "green" as const, icon: UsersRound },
    { label: account.id === "employee" ? "关联到我的会议" : "可见待办来源", value: `${account.id === "employee" ? relatedMeetings.length : departmentMeetings.length} 场`, tone: "amber" as const, icon: ClipboardList },
    { label: account.id === "president" ? "全部待办" : account.id === "manager" ? "本部门待办" : "我的可见待办", value: `${departmentTasks.length} 项`, tone: "slate" as const, icon: ListChecks }
  ];

  function MeetingMemoCard({ meeting, relation }: { meeting: Meeting; relation: "participated" | "related" }) {
    const meetingTasks = tasks.filter((task) => task.meetingId === meeting.id);
    const myMeetingTasks = meetingTasks.filter((task) => getTaskOwnerId(task) === selectedUser.id);
    const relationText = account.id === "president" ? "总裁全局可见" : account.id === "manager" ? "管理者部门可见" : relation === "participated" ? "参会人包含本人" : "待办推进人包含本人";
    const relationBadge = account.id === "president" ? "全局可见" : account.id === "manager" ? "本部门" : relation === "participated" ? "我参与" : "关联到我";

    return (
      <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="block w-full rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-ink">{meeting.title}</div>
            <div className="mt-1 text-xs text-slate-500">
              {findDepartment(meeting.departmentId)?.name} · {meeting.type} · {meeting.startTime} · {meeting.durationMinutes} 分钟
            </div>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${relation === "participated" ? solidTone.green : solidTone.amber}`}>
            {relationBadge}
          </span>
        </div>
        <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{meeting.aiSummary ?? meeting.summary}</div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-slate-500">关系</div>
            <div className="mt-1 font-medium text-ink">{relationText}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-slate-500">会议待办</div>
            <div className="mt-1 font-medium text-ink">{meetingTasks.length} 项</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-slate-500">我的相关待办</div>
            <div className="mt-1 font-medium text-ink">{account.id === "employee" ? myMeetingTasks.length : meetingTasks.length} 项</div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs font-medium text-brand">会议纪要汇总</div>
            <h2 className="mt-1 text-xl font-semibold text-ink">按人员关系查看会议纪要</h2>
          </div>
          <span className="app-action-pill px-3 py-1 text-sm">
            {account.id === "employee" ? `${selectedUser.name} · ${selectedUser.title}` : account.roleLabel}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <MetricTile key={card.label} label={card.label} value={card.value} icon={card.icon} tone={card.tone} />
        ))}
      </div>

      <div className={`grid items-start gap-5 ${account.id === "employee" ? "grid-cols-2" : "grid-cols-1"}`}>
          <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">{scopeLabel}</h3>
          </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${solidTone.green}`}>{participatedMeetings.length} 场</span>
          </div>
          <div className="space-y-3">
            {participatedMeetings.length ? participatedMeetings.map((meeting) => <MeetingMemoCard key={meeting.id} meeting={meeting} relation="participated" />) : <EmptyState text="当前没有可见会议" />}
          </div>
          </section>

        {account.id === "employee" ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-ink">关联到我的会议</h3>
              <p className="mt-1 text-sm text-slate-500">本人未参会，但会议待办推进人包含 {selectedUser.name}</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${solidTone.amber}`}>{relatedMeetings.length} 场</span>
          </div>
          <div className="space-y-3">
            {relatedMeetings.length ? relatedMeetings.map((meeting) => <MeetingMemoCard key={meeting.id} meeting={meeting} relation="related" />) : <EmptyState text="当前没有关联到我的会议" />}
          </div>
        </section>
        ) : null}
      </div>
    </div>
  );
}

function NewMeetingPage({
  okrProjects,
  onSubmitForApproval
}: {
  okrProjects: OkrProject[];
  onSubmitForApproval: (meeting: Meeting) => void;
}) {
  const [meetingId, setMeetingId] = useState(nextId("m"));
  const [title, setTitle] = useState("直营门店周会：客户需求与交付风险");
  const [departmentId, setDepartmentId] = useState(defaultMeetingDepartmentId);
  const [okrProjectId, setOkrProjectId] = useState("");
  const [type, setType] = useState<MeetingType>("经营例会");
  const [hostId, setHostId] = useState(defaultMeetingHostId);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [participantKeyword, setParticipantKeyword] = useState("");
  const [startTime, setStartTime] = useState(() => currentDateTimeLocal());
  const [endTime, setEndTime] = useState(() => currentDateTimeLocal(40));
  const [manualDuration, setManualDuration] = useState(50);
  const [transcript, setTranscript] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedMeetingFile[]>([]);
  const [selectedUploadedFileIds, setSelectedUploadedFileIds] = useState<string[]>([]);
  const [pendingDeleteFileIds, setPendingDeleteFileIds] = useState<string[]>([]);
  const [sourceBatchId, setSourceBatchId] = useState(() => nextId("batch"));
  const [sourceExtractedAt, setSourceExtractedAt] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [minuteMarkdown, setMinuteMarkdown] = useState("");
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [draftTasks, setDraftTasks] = useState<Task[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("draft");
  const [rejectReason, setRejectReason] = useState("请补充待办推进人、复核人、截止时间和达成目标后重新提交。");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiGenerateMessage, setAiGenerateMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const computedDuration = minutesBetween(startTime, endTime);
  const durationMinutes = computedDuration || manualDuration;
  const totalManHours = Number(((participantCount * durationMinutes) / 60).toFixed(1));
  const hasAiContent = approvalStatus !== "draft";
  const hasSubmitted = approvalStatus === "pending_president_approval" || approvalStatus === "rejected" || approvalStatus === "in_closed_loop";
  const uploadedFileName = uploadedFiles.map((file) => file.name).join("、");
  const pendingDeleteFiles = uploadedFiles.filter((file) => pendingDeleteFileIds.includes(file.id));

  useEffect(() => {
    const managerId = findDepartment(departmentId)?.managerId;
    if (managerId) setHostId(managerId);
  }, [departmentId]);

  function markSupervisorEdited() {
    if (approvalStatus === "ai_generated" || approvalStatus === "rejected") setApprovalStatus("supervisor_edited");
  }

  function clearGeneratedDraft() {
    setAiSummary("");
    setMinuteMarkdown("");
    setDecisions([]);
    setDraftTasks([]);
    setApprovalStatus("draft");
  }

  function composeTranscriptFromFiles(files: UploadedMeetingFile[]) {
    return files
      .map((file) => {
        const body = file.text.trim() || `已上传会议文稿文件：${file.name}。系统暂未读取正文，可以手动补充会议原文。`;
        return `【${file.name}】\n${body}`;
      })
      .join("\n\n");
  }

  function sourceTraceLabel(batchId = sourceBatchId) {
    return `${uploadedFileName || "手动粘贴会议原文"} / ${batchId}`;
  }

  function attachSourceTraceToDecisions(items: MeetingDecision[], batchId: string, sourceText: string) {
    return items.map((decision) => ({
      ...decision,
      sourceBatchId: batchId,
      sourceText: decision.sourceText || sourceText.slice(0, 160) || "当前会议输入"
    }));
  }

  function attachSourceTraceToTasks(items: Task[], batchId: string, sourceText: string) {
    const traceLabel = sourceTraceLabel(batchId);
    const meetingPersonIds = uniqueIds([hostId, ...participantIds]);
    return items.map((task) => {
      const rawOwnerId = getTaskOwnerId(task);
      const ownerId = meetingPersonIds.includes(rawOwnerId) ? rawOwnerId : participantIds[0] ?? hostId;
      const ownerDepartmentId = findUser(ownerId)?.departmentId ?? task.departmentId;
      return {
        ...task,
        owner: ownerId,
        ownerId,
        ownerDepartment: ownerDepartmentId,
        departmentId: ownerDepartmentId,
        reviewerId: ownerId === hostId ? getPresidentUserId() : hostId,
        sourceBatchId: batchId,
        sourceMeetingId: meetingId,
        sourceFileName: uploadedFileName || undefined,
        sourceTraceLabel: traceLabel,
        sourceDecisionId: task.sourceDecisionId,
        sourceText: task.sourceText || sourceText.slice(0, 120) || "当前会议输入"
      };
    });
  }

  function handleTranscriptChange(value: string) {
    setTranscript(value);
    if (!hasAiContent) return;
    const nextBatchId = nextId("batch");
    setSourceBatchId(nextBatchId);
    setSourceExtractedAt(currentDateTime());
    clearGeneratedDraft();
    setAiGenerateMessage("会议原文已修改，请重新生成会议纪要和待办。");
  }

  function addParticipant(userId: string) {
    setParticipantIds((current) => {
      if (current.includes(userId)) return current;
      const next = [...current, userId];
      setParticipantCount(next.length);
      return next;
    });
    setParticipantKeyword("");
  }

  function removeParticipant(userId: string) {
    setParticipantIds((current) => {
      const next = current.filter((id) => id !== userId);
      setParticipantCount(next.length);
      return next;
    });
  }

  async function handleFiles(files?: FileList | File[]) {
    const fileList = Array.from(files ?? []);
    if (!fileList.length) return;
    const nextBatchId = nextId("batch");
    setSourceBatchId(nextBatchId);
    setSourceExtractedAt(currentDateTime());
    clearGeneratedDraft();

    const parsedFiles: UploadedMeetingFile[] = [];
    for (const file of fileList) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/meeting-file-text", {
          method: "POST",
          body: formData
        });
        const result = (await response.json()) as MeetingFileTextApiResponse;
        if (!response.ok) throw new Error(result.detail || result.error || `文件解析失败：${response.status}`);
        parsedFiles.push({
          id: nextId("upload"),
          name: result.fileName || file.name,
          text: result.text,
          sourceType: result.sourceType,
          status: "read"
        });
      } catch {
        parsedFiles.push({
          id: nextId("upload"),
          name: file.name,
          text: "",
          status: "name_only"
        });
      }
    }

    setUploadedFiles((current) => {
      const next = [...current, ...parsedFiles];
      setTranscript(composeTranscriptFromFiles(next));
      setSelectedUploadedFileIds((selected) => selected.filter((fileId) => next.some((file) => file.id === fileId)));
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    const readCount = parsedFiles.filter((file) => file.status === "read").length;
    const failedCount = parsedFiles.length - readCount;
    setAiGenerateMessage(
      `${parsedFiles.length} 个文件已记录；${readCount} 个已读取正文${failedCount ? `，${failedCount} 个仅记录文件名，可在会议原文中手动补充` : ""}。`
    );
  }

  function toggleUploadedFileSelection(fileId: string) {
    setSelectedUploadedFileIds((current) => (current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]));
  }

  function requestDeleteUploadedFiles(fileIds = selectedUploadedFileIds) {
    const existingIds = fileIds.filter((fileId) => uploadedFiles.some((file) => file.id === fileId));
    if (!existingIds.length) return;
    setPendingDeleteFileIds(existingIds);
  }

  function confirmDeleteUploadedFiles() {
    setUploadedFiles((current) => {
      const next = current.filter((file) => !pendingDeleteFileIds.includes(file.id));
      setTranscript(composeTranscriptFromFiles(next));
      return next;
    });
    setSelectedUploadedFileIds((current) => current.filter((fileId) => !pendingDeleteFileIds.includes(fileId)));
    setPendingDeleteFileIds([]);
    const nextBatchId = nextId("batch");
    setSourceBatchId(nextBatchId);
    setSourceExtractedAt(currentDateTime());
    clearGeneratedDraft();
    setAiGenerateMessage("已删除所选文件，会议原文已按剩余文件重新整理，请重新生成会议纪要。");
  }

  async function generateAiTemplate() {
    const generationInput = transcript.trim();
    if (!generationInput) {
      setAiGenerateMessage("请先上传可读取的会议文稿，或在“会议原文 / 转写稿”中粘贴完整会议正文。系统不会仅凭文件名生成正式纪要。");
      return;
    }
    const activeBatchId = sourceBatchId || nextId("batch");
    const activeExtractedAt = sourceExtractedAt || currentDateTime();
    const participantNames = participantIds.map((userId) => findUser(userId)?.name).filter((name): name is string => Boolean(name));
    const selectedOkrProjectName = okrProjects.find((project) => project.id === okrProjectId)?.name || "无";
    setSourceBatchId(activeBatchId);
    setSourceExtractedAt(activeExtractedAt);
    const fallbackResult = buildAiClosedLoopTemplate({
      meetingId,
      title,
      departmentId,
      hostId,
      transcript: generationInput,
      meetingDate: dateKeyFromDateTime(startTime),
      meetingType: type,
      participantNames,
      okrProjectName: selectedOkrProjectName
    });

    if (!ENABLE_DEEPSEEK_DRAFT) {
      setAiSummary(fallbackResult.aiSummary);
      setMinuteMarkdown(fallbackResult.minuteMarkdown);
      setDecisions(attachSourceTraceToDecisions(fallbackResult.decisions, activeBatchId, generationInput));
      setDraftTasks(attachSourceTraceToTasks(fallbackResult.tasks, activeBatchId, generationInput));
      setApprovalStatus("ai_generated");
      setAiGenerateMessage("当前未启用 DeepSeek，已使用本地模板生成会议纪要、决策和待办。");
      return;
    }

    setIsGeneratingAi(true);
    setAiGenerateMessage("正在调用 DeepSeek：第 1 步生成纪要，第 2 步抽取决策，第 3 步生成待办...");

    try {
      const response = await fetch("/api/ai/meeting-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          title,
          departmentId,
          hostId,
          transcript: generationInput,
          meetingDate: dateKeyFromDateTime(startTime),
          meetingType: type,
          participantNames,
          participantCount,
          okrProjectName: selectedOkrProjectName,
          startTime: formatDateTime(startTime)
        })
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(errorBody.detail || errorBody.error || `POST /api/ai/meeting-draft ${response.status}`);
      }
      const result = (await response.json()) as MeetingDraftApiResponse;
      const correctedTranscript = result.correctedTranscript || generationInput;
      const correctionCount = result.dictionaryCorrections?.reduce((sum, item) => sum + item.count, 0) ?? 0;
      if (correctedTranscript !== generationInput) setTranscript(correctedTranscript);
      setAiSummary(result.aiSummary);
      setMinuteMarkdown(result.minuteMarkdown || result.aiSummary);
      setDecisions(attachSourceTraceToDecisions(result.decisions, activeBatchId, correctedTranscript));
      setDraftTasks(attachSourceTraceToTasks(result.tasks, activeBatchId, correctedTranscript));
      setApprovalStatus("ai_generated");
      setAiGenerateMessage(
        `DeepSeek 已完成三阶段生成${result.model ? `（${result.model}）` : ""}：纪要 -> 决策 -> 待办。${
          correctionCount ? `会议词典已自动修正 ${correctionCount} 处误写词。` : "会议词典未发现需要修正的误写词。"
        }`
      );
    } catch (error) {
      setAiSummary("");
      setMinuteMarkdown("");
      setDecisions([]);
      setDraftTasks([]);
      setApprovalStatus("draft");
      const detail = error instanceof Error ? error.message : "";
      setAiGenerateMessage(
        detail && !detail.startsWith("POST ")
          ? `未生成正式会议纪要：${detail}`
          : "DeepSeek 调用失败，未生成正式会议纪要，请重试。系统不会用本地 mock 冒充上传文件的 AI 结果。"
      );
    } finally {
      setIsGeneratingAi(false);
    }
  }

  function updateDraftTask(taskId: string, patch: Partial<Task>) {
    markSupervisorEdited();
    setDraftTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const nextTask = { ...task, ...patch, title: patch.content ?? task.content ?? task.title };
        const ownerChanged = patch.owner !== undefined || patch.ownerId !== undefined;
        const ownerId = resolveUserId(nextTask.ownerId) ?? resolveUserId(nextTask.owner) ?? getTaskOwnerId(nextTask);
        if (!ownerId || !ownerChanged) return nextTask;
        const ownerDepartmentId = findUser(ownerId)?.departmentId ?? getTaskDepartmentId(nextTask) ?? departmentId;
        return {
          ...nextTask,
          owner: ownerId,
          ownerId,
          ownerDepartment: ownerDepartmentId,
          departmentId: ownerDepartmentId,
          reviewerId: ownerId === hostId ? getPresidentUserId() : hostId
        };
      })
    );
  }

  function deleteDraftTask(taskId: string) {
    markSupervisorEdited();
    setDraftTasks((current) => current.filter((task) => task.id !== taskId));
  }

  function addDraftTask() {
    markSupervisorEdited();
    const ownerId = participantIds[0] ?? hostId;
    const ownerDepartmentId = findUser(ownerId)?.departmentId ?? departmentId;
    const meetingDate = dateKeyFromDateTime(startTime);
    const createdAt = currentDateTime();
    setDraftTasks((current) => [
      ...current,
      {
        id: nextId("manual-task"),
        meetingId,
        content: "",
        title: "新增待办",
        description: "主管手动补充的会议待办。",
        owner: ownerId,
        ownerId,
        ownerDepartment: ownerDepartmentId,
        departmentId: ownerDepartmentId,
        reviewerId: ownerId === hostId ? getPresidentUserId() : hostId,
        collaboratorDepartments: [],
        collaboratorDepartmentIds: [],
        startDate: meetingDate,
        dueDate: addDaysToDateKey(meetingDate, 7),
        goal: "",
        status: "not_started",
        priority: "中",
        companySupportRequest: "",
        sourceText: "主管手动补充",
        sourceBatchId,
        sourceMeetingId: meetingId,
        sourceFileName: uploadedFileName || undefined,
        sourceTraceLabel: sourceTraceLabel(),
        approvalStatus: "pending_president_approval",
        createdAt,
        updatedAt: createdAt
      }
    ]);
  }

  function updateDecision(decisionId: string, patch: Partial<MeetingDecision>) {
    markSupervisorEdited();
    setDecisions((current) => current.map((decision) => (decision.id === decisionId ? { ...decision, ...patch } : decision)));
  }

  function buildMeeting(nextStatus: ApprovalStatus): Meeting {
    return {
      id: meetingId,
      title: title.trim() || "未命名会议",
      departmentId,
      okrProjectId: okrProjectId || undefined,
      okrProjectName: okrProjects.find((project) => project.id === okrProjectId)?.name,
      type,
      hostId,
      participantIds,
      participantCount,
      startTime: formatDateTime(startTime),
      endTime: formatDateTime(endTime),
      durationMinutes,
      totalManHours,
      rawTranscript: transcript || `已上传会议文稿文件：${uploadedFileName}`,
      transcript: transcript || `已上传会议文稿文件：${uploadedFileName}`,
      uploadedFileName,
      sourceBatchId,
      sourceFileName: uploadedFileName || undefined,
      sourceExtractedAt: sourceExtractedAt || currentDateTime(),
      sourceTemplateName: MEETING_SOURCE_TEMPLATE_NAME,
      sourceTemplateVersion: MEETING_SOURCE_TEMPLATE_VERSION,
      summary: aiSummary,
      aiSummary,
      minuteMarkdown,
      conclusions: decisions.map((decision) => decision.content),
      decisions: decisions.map((decision) => ({
        ...decision,
        sourceBatchId: decision.sourceBatchId ?? sourceBatchId,
        sourceText: decision.sourceText ?? (transcript || uploadedFileName || "当前会议输入").slice(0, 160)
      })),
      approvalStatus: nextStatus,
      tasks: draftTasks.map((task) => ({
        ...task,
        meetingId,
        sourceBatchId: task.sourceBatchId ?? sourceBatchId,
        sourceMeetingId: task.sourceMeetingId ?? meetingId,
        sourceFileName: (task.sourceFileName ?? uploadedFileName) || undefined,
        sourceDecisionId: task.sourceDecisionId,
        sourceTraceLabel: task.sourceTraceLabel ?? sourceTraceLabel(),
        reviewerId: getTaskOwnerId(task) === hostId ? getPresidentUserId() : hostId,
        approvalStatus: "pending_president_approval",
        status: "not_started"
      })),
      createdBy: hostId,
      status: nextStatus === "in_closed_loop" ? "closed" : "summarized",
      createdAt: currentDateTime(),
      rejectedReason: nextStatus === "rejected" ? rejectReason : undefined
    };
  }

  function getDraftTaskSubmissionIssues() {
    const meetingPersonIds = uniqueIds([hostId, ...participantIds]);
    return draftTasks.flatMap((task, index) => {
      const taskLabel = getTaskContent(task)?.trim() || `第 ${index + 1} 条待办`;
      const ownerId = getTaskOwnerId(task);
      const issues: string[] = [];
      if (!taskLabel.trim()) issues.push(`第 ${index + 1} 条待办缺少任务内容`);
      if (!ownerId || !findUser(ownerId)) {
        issues.push(`「${taskLabel}」缺少有效推进人`);
      } else if (!meetingPersonIds.includes(ownerId)) {
        issues.push(`「${taskLabel}」推进人不在会议主持人或参会人员中`);
      }
      if (!task.dueDate) issues.push(`「${taskLabel}」缺少截止日期`);
      return issues;
    });
  }

  function submitForApproval() {
    markSupervisorEdited();
    const submissionIssues = getDraftTaskSubmissionIssues();
    if (submissionIssues.length) {
      setAiGenerateMessage(`提交前请先修正待办分配：${submissionIssues.slice(0, 3).join("；")}${submissionIssues.length > 3 ? "。" : ""}`);
      return;
    }
    const meeting = buildMeeting("pending_president_approval");
    onSubmitForApproval(meeting);
    setApprovalStatus("pending_president_approval");
  }

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-medium text-brand">统一会议闭环模板</div>
            <h2 className="mt-1 text-xl font-semibold text-ink">新建会议</h2>
          </div>
        </div>
      </section>

      <div className="space-y-5">
        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <SectionHeader title="1. 会议基础信息" icon={CalendarDays} />
          <div className="mt-5 grid grid-cols-12 gap-4">
            <div className="col-span-3">
              <Field label="会议主题">
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
              </Field>
            </div>
            <div className="col-span-2">
                <Field label="所属部门">
                  <SearchableSelect
                    value={departmentId}
                    onChange={setDepartmentId}
                    options={realDepartments.map((department) => ({
                      value: department.id,
                      label: departmentOptionLabel(department),
                      meta: department.fullPath,
                      searchText: departmentSearchText(department)
                    }))}
                    placeholder="输入部门名称或组织路径"
                  />
                  <div className="mt-1 truncate text-xs text-slate-500">{findDepartment(departmentId)?.fullPath ?? findDepartment(departmentId)?.description}</div>
                </Field>
            </div>
            <div className="col-span-2">
              <Field label="会议主持人">
                <SearchableSelect
                  value={hostId}
                  onChange={setHostId}
                  options={users.map((user) => ({
                    value: user.id,
                    label: userOptionLabel(user),
                    meta: findDepartment(user.departmentId)?.name,
                    searchText: userSearchText(user, findDepartment(user.departmentId))
                  }))}
                  placeholder="输入姓名、员工号或部门"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="会议类型">
                <SearchableSelect
                  value={type}
                  onChange={(value) => setType(value as MeetingType)}
                  options={meetingTypes.map((meetingType) => ({ value: meetingType, label: meetingType }))}
                  placeholder="输入会议类型"
                />
              </Field>
            </div>
            <div className="col-span-3">
                <Field label="关联 OKR 项目">
                  <SearchableSelect
                    value={okrProjectId}
                    onChange={setOkrProjectId}
                    options={[
                      { value: "", label: "无" },
                      ...okrProjects.map((project) => ({ value: project.id, label: project.name, meta: project.ownerDepartment }))
                    ]}
                    placeholder="输入 OKR 项目名称"
                  />
                </Field>
            </div>

            <div className="col-span-7">
                <div className="mb-2 text-sm font-medium text-slate-700">参会人员</div>
                <div className="min-h-[142px] rounded-xl border border-line bg-white p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      value={participantKeyword}
                      onChange={(event) => setParticipantKeyword(event.target.value)}
                      placeholder="输入人名或部门，点击候选人加入"
                      className="w-full rounded-lg border border-line bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:bg-white"
                    />
                  </div>
                  {participantKeyword.trim() && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line bg-white">
                      {realUsers
                        .filter((user) => {
                          const keyword = participantKeyword.trim().toLowerCase();
                          return userSearchText(user, findDepartment(user.departmentId)).includes(keyword);
                        })
                        .filter((user) => !participantIds.includes(user.id))
                        .slice(0, 12)
                        .map((user) => (
                          <button key={user.id} onClick={() => addParticipant(user.id)} className="flex w-full items-center justify-between border-b border-line px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50">
                            <span className="font-medium text-ink">{userOptionLabel(user)}</span>
                            <span className="text-xs text-slate-500">
                              {findDepartment(user.departmentId)?.name}
                            </span>
                          </button>
                        ))}
                      {realUsers
                        .filter((user) => {
                          const keyword = participantKeyword.trim().toLowerCase();
                          return userSearchText(user, findDepartment(user.departmentId)).includes(keyword);
                        })
                        .filter((user) => !participantIds.includes(user.id)).length === 0 && <div className="px-3 py-3 text-sm text-slate-500">没有可加入的匹配人员</div>}
                    </div>
                  )}
                  <div className="mt-3">
                    <div className="mb-2 text-xs font-medium text-slate-500">已加入参会人员</div>
                    <div className="flex flex-wrap gap-2">
                      {participantIds.length ? participantIds.map((userId) => {
                        const user = findUser(userId);
                        if (!user) return null;
                        return (
                          <span key={userId} className="participant-chip inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold">
                            {userOptionLabel(user)}
                            <button onClick={() => removeParticipant(userId)} className="participant-chip-remove rounded-full px-1" aria-label={`移除${user.name}`}>
                              x
                            </button>
                          </span>
                        );
                      }) : <span className="text-sm text-slate-400">暂未选择参会人员</span>}
                    </div>
                  </div>
                </div>
            </div>

            <div className="col-span-5 grid grid-cols-2 gap-3">
                <Field label="参会人数">
                  <input type="number" min={0} value={participantCount} onChange={(event) => setParticipantCount(Number(event.target.value))} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
                </Field>
                <Field label="会议时长（分钟）">
                  <input
                    type="number"
                    min={1}
                    value={durationMinutes}
                    disabled={Boolean(computedDuration)}
                    onChange={(event) => setManualDuration(Number(event.target.value))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50"
                  />
                </Field>
                <Field label="会议开始时间">
                  <DateTimeTextInput value={startTime} onChange={setStartTime} />
                </Field>
                <Field label="会议结束时间">
                  <DateTimeTextInput value={endTime} onChange={setEndTime} />
                </Field>
                <ReadOnlyMetric label="自动计算时长" value={`${durationMinutes} 分钟`} />
                <ReadOnlyMetric label="总参会人工时" value={`${totalManHours} 人工时`} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <SectionHeader title="2. 会议文稿输入" icon={FileText} />
          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_300px] gap-4">
            <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFiles(event.dataTransfer.files);
                }}
                className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center"
              >
                <FileText className="text-slate-400" size={28} />
                <div className="mt-3 text-sm font-medium text-slate-700">上传来源文件</div>
                <div className="mt-1 text-xs text-slate-500">可多选 TXT / DOCX，系统会自动读取正文</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => void handleFiles(event.target.files ?? undefined)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="app-action-pill mt-4 min-w-[5.5rem] whitespace-nowrap px-3 py-1.5 text-sm"
                >
                  选择文件
                </button>
                {uploadedFiles.length ? (
                  <div className="mt-3 w-full space-y-2 text-left">
                    <div className={`rounded-full border px-3 py-1 text-center text-xs font-medium ${solidTone.green}`}>
                      {uploadedFiles.length} 个文件已记录
                    </div>
                    <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-line bg-white p-2">
                      {uploadedFiles.map((file) => (
                        <label key={file.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={selectedUploadedFileIds.includes(file.id)}
                            onChange={() => toggleUploadedFileSelection(file.id)}
                            className="h-3.5 w-3.5 rounded border-line"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{file.name}</span>
                          <span className={file.status === "read" ? "text-emerald-600" : "text-orange-600"}>{file.status === "read" ? "已读取" : "仅记录"}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedUploadedFileIds.length === uploadedFiles.length) {
                            setSelectedUploadedFileIds([]);
                          } else {
                            setSelectedUploadedFileIds(uploadedFiles.map((file) => file.id));
                          }
                        }}
                        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        {selectedUploadedFileIds.length === uploadedFiles.length ? "取消全选" : "全选"}
                      </button>
                      <button
                        type="button"
                        disabled={!selectedUploadedFileIds.length}
                        onClick={() => requestDeleteUploadedFiles()}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        删除所选文件
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <Field label="会议原文 / 转写稿">
                <textarea
                  value={transcript}
                  onChange={(event) => handleTranscriptChange(event.target.value)}
                  placeholder="上传 DOCX/TXT 后会自动读取正文；也可以手动粘贴会议转写稿或会议记录。"
                  className="min-h-48 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-brand"
                />
              </Field>
            </div>
            <div className="flex flex-col justify-between rounded-xl border border-blue-100 bg-blue-50 p-5">
              <div>
                <div className="text-sm font-semibold text-blue-900">AI 生成会议闭环模板</div>
                <p className="mt-2 text-sm leading-6 text-blue-700">AI 会分三步处理：先用第 1 步基础信息和当前文稿生成纪要，再从纪要抽取决策，最后根据纪要与决策生成待办。上传文稿不会覆盖基础信息。</p>
                {aiGenerateMessage && <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs leading-5 text-blue-700">{aiGenerateMessage}</div>}
              </div>
              <button
                onClick={generateAiTemplate}
                disabled={isGeneratingAi || (!uploadedFileName && !transcript.trim())}
                className="app-action-button mt-5 w-full px-4 py-2.5 text-sm"
              >
                <Sparkles size={16} />
                {isGeneratingAi ? "生成中..." : "一键生成会议纪要"}
              </button>
            </div>
          </div>
        </section>

        <div className="space-y-5">
          {!hasAiContent && (
            <section className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-line bg-white p-8 text-center shadow-panel">
              <div>
                <Sparkles className="mx-auto text-slate-300" size={42} />
                <h3 className="mt-4 text-lg font-semibold text-ink">等待生成会议闭环模板</h3>
                <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">上传会议文稿后点击“一键生成会议纪要”，这里会展示完整会议纪要、会议决策和待办事项。</p>
              </div>
            </section>
          )}

          {hasAiContent && (
            <>
              <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
                <SectionHeader title="3. 会议纪要与决策" description="会议基础信息来自第 1 步表单；摘要、讨论、决策来自第 2 步文稿；待办在第 4 步继续承接。" icon={Sparkles} />
                <div className="mt-5 space-y-5">
                  <div className="rounded-xl border border-line bg-slate-50 p-4">
                    <h4 className="text-sm font-semibold text-slate-800">AI 会议纪要</h4>
                    <div className="mt-3 max-h-[640px] overflow-y-auto rounded-lg bg-white px-4 py-3">
                      <MarkdownView content={minuteMarkdown || aiSummary} />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
                <div className="flex items-start justify-between gap-4">
                  <SectionHeader title="4. 会议待办事项" description="主管可修正 AI 待办，也可手动补充未识别的执行事项。" icon={ClipboardList} />
                  <button onClick={addDraftTask} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                    <Plus size={16} />
                    手动添加待办
                  </button>
                </div>
                <div className="mt-5">
                  <EditableDraftTaskTable tasks={draftTasks} hostId={hostId} participantIds={participantIds} onChange={updateDraftTask} onDelete={deleteDraftTask} />
                </div>
              </section>

              <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
                <SectionHeader title="5. 主管提交与总裁签批" description="提交前不会进入正式待办总台账。" icon={UsersRound} />
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  当前状态：{getApprovalStatusLabel(approvalStatus)}。待办数量 {draftTasks.length} 项，总裁通过后才会正式进入台账。
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={submitForApproval}
                    disabled={!draftTasks.length || approvalStatus === "pending_president_approval" || approvalStatus === "in_closed_loop"}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <CheckCircle2 size={16} />
                    提交总裁签批
                  </button>
                </div>
                {approvalStatus === "pending_president_approval" && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    已提交到管理驾驶舱的“待总裁签批待办”。总裁会逐条审核，通过后才进入正式待办总台账；驳回后会回到部门看板提醒主管修改。
                  </div>
                )}
                {approvalStatus === "rejected" && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">总裁已驳回：{rejectReason}。主管可以继续修改上方内容后再次提交。</div>}
                {approvalStatus === "in_closed_loop" && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">总裁已签批通过，会议已进入闭环，待办已正式进入待办总台账。</div>}
              </section>
            </>
          )}
        </div>
      </div>
      {pendingDeleteFiles.length ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-white p-5 shadow-panel">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink">确认删除所选文件？</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  将删除 {pendingDeleteFiles.length} 个已记录文件，并清空当前 AI 生成结果。保留的文件会重新整理到会议原文中。
                </p>
              </div>
            </div>
            <div className="mt-4 max-h-36 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
              {pendingDeleteFiles.map((file) => (
                <div key={file.id} className="truncate">{file.name}</div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteFileIds([])}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDeleteUploadedFiles}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ title, description, icon: Icon }: { title: string; description?: string; icon: typeof LayoutDashboard }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-600">
        <Icon size={19} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
    </div>
  );
}

function ReadOnlyMetric({ label, value, variant = "field" }: { label: string; value: string; variant?: "field" | "action" }) {
  if (variant === "action") {
    return (
      <div className="app-action-card px-4 py-2">
        <div className="text-xs opacity-85">{label}</div>
        <div className="mt-1 text-sm font-extrabold">{value}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function EditableDraftTaskTable({
  tasks,
  hostId,
  participantIds,
  onChange,
  onDelete
}: {
  tasks: Task[];
  hostId: string;
  participantIds: string[];
  onChange: (taskId: string, patch: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
}) {
  if (!tasks.length) return <EmptyState text="AI 暂未生成待办事项" />;
  const meetingPersonIds = uniqueIds([hostId, ...participantIds]);
  const ownerOptions = meetingPersonIds
    .map((userId) => findUser(userId))
    .filter((user): user is User => Boolean(user))
    .map((user) => ({
      value: user.id,
      label: userOptionLabel(user),
      meta: findDepartment(user.departmentId)?.name,
      searchText: userSearchText(user, findDepartment(user.departmentId))
    }));
  const reviewerOptions = uniqueIds([hostId, ...participantIds, getPresidentUserId()])
    .map((userId) => findUser(userId))
    .filter((user): user is User => Boolean(user))
    .map((user) => ({
      value: user.id,
      label: userOptionLabel(user),
      meta: findDepartment(user.departmentId)?.name,
      searchText: userSearchText(user, findDepartment(user.departmentId))
    }));
  const taskColorBands = [
    { border: "border-l-blue-400", bg: "bg-blue-50/35", chip: "bg-blue-100 text-blue-700", label: "text-blue-700" },
    { border: "border-l-emerald-400", bg: "bg-emerald-50/35", chip: solidFill.green, label: "text-emerald-700" },
    { border: "border-l-amber-400", bg: "bg-amber-50/40", chip: solidFill.amber, label: "text-amber-700" },
    { border: "border-l-sky-400", bg: "bg-sky-50/35", chip: "bg-sky-100 text-sky-700", label: "text-sky-700" },
    { border: "border-l-violet-400", bg: "bg-violet-50/35", chip: "bg-violet-100 text-violet-700", label: "text-violet-700" }
  ];

  return (
    <div className="space-y-3">
      {tasks.map((task, index) => {
        const color = taskColorBands[index % taskColorBands.length];
        return (
        <div key={task.id} className={`rounded-xl border border-line border-l-4 ${color.border} ${color.bg} p-4 shadow-sm`}>
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${color.chip}`}>{index + 1}</span>
              <span className="text-sm font-semibold text-ink">待办事项</span>
              <span className="text-xs text-slate-400">{task.sourceText === "主管手动补充" ? "手动添加" : "AI 提取"}</span>
              <span className={`text-xs font-medium ${color.label}`}>{findDepartment(getTaskDepartmentId(task))?.name}</span>
            </div>
            <button onClick={() => onDelete(task.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
              删除
            </button>
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <Field label="任务内容">
                <textarea
                  value={getTaskContent(task)}
                  onChange={(event) => onChange(task.id, { content: event.target.value, title: event.target.value })}
                  placeholder="填写需要完成的具体任务"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </Field>
            </div>
            <div className="col-span-6">
              <Field label="可量化达成目标">
                <textarea
                  value={task.goal ?? ""}
                  onChange={(event) => onChange(task.id, { goal: event.target.value })}
                  placeholder="例如：输出 1 份方案，完成 10 家门店覆盖"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="待办推进人">
                <SearchableSelect
                  value={getTaskOwnerId(task)}
                  onChange={(value) => onChange(task.id, { owner: value, ownerId: value })}
                  options={ownerOptions}
                  placeholder="输入推进人"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="待办复核人">
                <SearchableSelect
                  value={getTaskOwnerId(task) === hostId ? getPresidentUserId() : hostId}
                  onChange={(value) => onChange(task.id, { reviewerId: value })}
                  options={reviewerOptions}
                  placeholder="输入复核人"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="责任部门">
                <SearchableSelect
                  value={getTaskDepartmentId(task)}
                  onChange={(value) => onChange(task.id, { ownerDepartment: value, departmentId: value })}
                  options={realDepartments.map((department) => ({
                    value: department.id,
                    label: departmentOptionLabel(department),
                    meta: department.fullPath,
                    searchText: departmentSearchText(department)
                  }))}
                  placeholder="输入责任部门"
                />
              </Field>
            </div>

            <div className="col-span-2">
              <Field label="开始日期">
                <input type="date" value={task.startDate ?? ""} onChange={(event) => onChange(task.id, { startDate: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="截止日期">
                <input type="date" value={task.dueDate} onChange={(event) => onChange(task.id, { dueDate: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
              </Field>
            </div>
            <div className="col-span-1">
              <Field label="优先级">
                <SearchableSelect
                  value={task.priority}
                  onChange={(value) => onChange(task.id, { priority: value as Priority })}
                  options={priorities.map((priority) => ({ value: priority, label: priority }))}
                  placeholder="优先级"
                />
              </Field>
            </div>
            <div className="col-span-12">
              <Field label="需要公司支持">
                <textarea
                  value={task.companySupportRequest ?? ""}
                  onChange={(event) => onChange(task.id, { companySupportRequest: event.target.value })}
                  rows={3}
                  placeholder="填写需要公司提供的资源、协同部门、决策支持或其他保障事项"
                  className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </Field>
            </div>

            <div className="col-span-12 grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              <span className="font-medium text-slate-600">来源追溯</span>
              <span>
                <span className="font-medium text-slate-700">{task.sourceFileName || "当前会议文稿"}</span>
                {task.sourceDecisionId ? <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">来源决策：{task.sourceDecisionId}</span> : null}
                <span className="ml-2 max-h-10 overflow-hidden">{task.sourceText || "主管手动补充"}</span>
              </span>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function MeetingDetailPage({
  meeting,
  tasks,
  activityLogs,
  currentUserId,
  onNavigate,
  onUpdateTaskStatus,
  onUpdateTaskCompletionItems,
  onCanDeleteTask,
  onDeleteTask
}: {
  meeting: Meeting;
  tasks: Task[];
  activityLogs: ActivityLog[];
  currentUserId: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateTaskCompletionItems: (taskId: string, completionItems: string[]) => void;
  onCanDeleteTask: (task: Task) => boolean;
  onDeleteTask: (task: Task) => void;
}) {
  const relatedTasks = tasks.filter((task) => task.meetingId === meeting.id);
  const visibleTasks = relatedTasks.length ? relatedTasks : meeting.tasks ?? [];
  const relatedLogs = activityLogs.filter((log) => log.meetingId === meeting.id).slice(0, 8);
  const progress = getTaskProgressSummary(visibleTasks);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{meeting.type}</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">{getMeetingDisplayStatus(meeting)}</span>
            </div>
            <h2 className="text-xl font-semibold text-ink">{meeting.title}</h2>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
              <span>{findDepartment(meeting.departmentId)?.name}</span>
              <span>主持人：{findUser(meeting.hostId)?.name}</span>
              <span>{meeting.startTime}</span>
              <span>{meeting.durationMinutes} 分钟</span>
              {meeting.totalManHours ? <span>{meeting.totalManHours} 人工时</span> : null}
            </div>
          </div>
          <button onClick={() => onNavigate("tasks")} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ClipboardList size={16} />
            查看总台账
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">会议闭环进度</h3>
            <p className="mt-1 text-sm text-slate-500">总裁签批后，会议待办会进入正式台账；推进、复核和完成状态会同步反映到会议、台账和部门统计。</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${solidTone.green}`}>
            {getMeetingDisplayStatus(meeting)}
          </span>
        </div>
        <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-5">
          <DonutChart value={progress.completed} total={progress.total} label="完成率" center={formatPercent(progress.completionRate)} color="#10b981" restColor="#e2e8f0" />
          <div className="grid grid-cols-5 gap-3">
            <ExecutionStat label="全部待办" value={progress.total} icon={ClipboardList} tone="slate" />
            <ExecutionStat label="推进中" value={progress.inProgress} icon={Clock3} tone="blue" />
            <ExecutionStat label="待复核" value={progress.pendingReview} icon={CheckCircle2} tone="blue" />
            <ExecutionStat label="已完成" value={progress.completed} icon={CheckCircle2} tone="green" />
            <ExecutionStat label="逾期/阻塞" value={progress.overdue + progress.blocked} icon={AlertTriangle} tone={progress.overdue || progress.blocked ? "red" : "slate"} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <h3 className="mb-3 text-base font-semibold text-ink">会议结论</h3>
        <div className="grid grid-cols-3 gap-3">
          {meeting.conclusions.map((conclusion) => (
            <div key={conclusion} className="flex gap-2 rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={16} />
              <span>{conclusion}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">闭环动作记录</h3>
            <p className="mt-1 text-sm text-slate-500">记录签批、驳回、提交复核、复核确认等关键动作。</p>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{relatedLogs.length} 条</span>
        </div>
        {relatedLogs.length ? (
          <div className="space-y-3">
            {relatedLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-line bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-semibold text-ink">{log.title}</div>
                  <div className="text-xs text-slate-500">{log.createdAt}</div>
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">{log.detail}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {log.actorName ? <span>操作人：{log.actorName}</span> : null}
                  {log.fromStatus || log.toStatus ? <span>状态：{log.fromStatus || "-"} → {log.toStatus || "-"}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="当前会议还没有动作记录" />
        )}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">会议待办</h3>
            <p className="mt-1 text-sm text-slate-500">所有待办均进入统一任务台账</p>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{visibleTasks.length} 项</span>
        </div>
        <TaskTable tasks={visibleTasks} meetings={[meeting]} currentUserId={currentUserId} onNavigate={onNavigate} onUpdateTaskStatus={onUpdateTaskStatus} onUpdateTaskCompletionItems={onUpdateTaskCompletionItems} onCanDeleteTask={onCanDeleteTask} onDeleteTask={onDeleteTask} />
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <h3 className="mb-3 text-base font-semibold text-ink">来源追溯</h3>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-3">
            <div className="text-xs font-medium text-slate-500">来源文件</div>
            <div className="mt-1 font-semibold text-slate-800">{meeting.sourceFileName || meeting.uploadedFileName || "手动粘贴会议原文"}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-3">
            <div className="text-xs font-medium text-slate-500">读取时间</div>
            <div className="mt-1 font-semibold text-slate-800">{meeting.sourceExtractedAt || meeting.createdAt}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-3">
            <div className="text-xs font-medium text-slate-500">生成模板</div>
            <div className="mt-1 font-semibold text-slate-800">{meeting.sourceTemplateName || MEETING_SOURCE_TEMPLATE_NAME} / {meeting.sourceTemplateVersion || MEETING_SOURCE_TEMPLATE_VERSION}</div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 items-stretch gap-5">
        <section className="flex h-[620px] min-h-0 flex-col rounded-lg border border-line bg-white p-5 shadow-panel">
          <h3 className="mb-3 shrink-0 text-base font-semibold text-ink">原始会议记录</h3>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            {meeting.transcript ?? meeting.rawTranscript}
          </div>
        </section>
        <section className="flex h-[620px] min-h-0 flex-col rounded-lg border border-line bg-white p-5 shadow-panel">
          <h3 className="mb-3 shrink-0 text-base font-semibold text-ink">AI 标准会议纪要</h3>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-white p-4">
            <MarkdownView content={meeting.minuteMarkdown ?? meeting.aiSummary ?? meeting.summary} />
          </div>
        </section>
      </div>
    </div>
  );
}

function TasksPage({
  meetings,
  tasks,
  account,
  currentUserId,
  focusTaskId,
  onNavigate,
  onUpdateTaskStatus,
  onUpdateTaskCompletionItems,
  onCanDeleteTask,
  onDeleteTask
}: {
  meetings: Meeting[];
  tasks: Task[];
  account: TestAccount;
  currentUserId: string;
  focusTaskId?: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateTaskCompletionItems: (taskId: string, completionItems: string[]) => void;
  onCanDeleteTask: (task: Task) => boolean;
  onDeleteTask: (task: Task) => void;
}) {
  const [departmentFilter, setDepartmentFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [priorityFilter, setPriorityFilter] = useState("全部");
  const [sourceFilter, setSourceFilter] = useState<TaskSourceFilter>("全部");
  const ledgerTableRef = useRef<HTMLDivElement>(null);
  const focusLedger = (departmentId: string, status: string) => {
    setDepartmentFilter(departmentId);
    setStatusFilter(status);
    window.setTimeout(() => {
      ledgerTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  useEffect(() => {
    if (!focusTaskId) return;
    const targetTask = tasks.find((task) => task.id === focusTaskId);
    if (!targetTask) return;
    setDepartmentFilter(getTaskDepartmentId(targetTask));
    setStatusFilter("全部");
    setPriorityFilter("全部");
    setSourceFilter(getTaskSourceType(targetTask));
    window.setTimeout(() => {
      ledgerTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [focusTaskId, tasks]);
  const sourceFilteredTasks = tasks.filter((task) => sourceFilter === "全部" || getTaskSourceType(task) === sourceFilter);
  const accountUser = getAccountUser(account);
  const ledgerDepartments = account.id === "manager" ? departments.filter((department) => department.id === accountUser.departmentId) : realDepartments;
  useEffect(() => {
    if (account.id === "manager") setDepartmentFilter(accountUser.departmentId);
  }, [account.id, accountUser.departmentId]);
  const ledgerDepartmentIdsWithTasks = new Set(sourceFilteredTasks.flatMap((task) => [...getTaskRelatedDepartmentIds(task, findMeeting(meetings, task.meetingId))]));
  const visibleLedgerDepartments = ledgerDepartments.filter((department) => ledgerDepartmentIdsWithTasks.has(department.id) || departmentFilter === department.id);
  const departmentTaskRows = visibleLedgerDepartments.map((department) => {
    const departmentTasks = sourceFilteredTasks.filter((task) => isTaskRelatedToDepartment(task, department.id, findMeeting(meetings, task.meetingId)));
    const completed = departmentTasks.filter(isTaskCompleted).length;
    const overdue = departmentTasks.filter(isOverdue).length;
    const progressing = departmentTasks.filter((task) => !isTaskCompleted(task) && !isOverdue(task)).length;
    return {
      department,
      total: departmentTasks.length,
      progressing,
      overdue,
      completed
    };
  });

  const filtered = sourceFilteredTasks.filter((task) => {
    const matchDepartment = departmentFilter === "全部" || isTaskRelatedToDepartment(task, departmentFilter, findMeeting(meetings, task.meetingId));
    const matchStatus =
      statusFilter === "全部" ||
      (statusFilter === "推进中" && !isTaskCompleted(task) && !isOverdue(task)) ||
      getSelectTaskStatus(task.status) === statusFilter ||
      (statusFilter === "逾期" && isOverdue(task)) ||
      (statusFilter === "临期" && isDueSoon(task));
    const matchPriority = priorityFilter === "全部" || task.priority === priorityFilter;
    return matchDepartment && matchStatus && matchPriority;
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">部门待办总览</h2>
          </div>
          <span className="app-action-pill px-3 py-1 text-sm">{sourceFilteredTasks.length} 项待办</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {departmentTaskRows.length ? departmentTaskRows.map((row) => {
            const isActiveDepartment = departmentFilter === row.department.id;
            return (
              <div key={row.department.id} className={`rounded-xl border p-3 ${isActiveDepartment ? "border-blue-200 bg-blue-50/60" : row.overdue ? "border-red-200 bg-red-50/40" : "border-line bg-white"}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="font-semibold text-ink">{row.department.name}</div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.overdue ? solidFill.red : solidFill.green}`}>
                    {row.overdue ? `${row.overdue} 逾期` : "无逾期"}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <LedgerDeptStat
                    label="总待办"
                    value={row.total}
                    tone="slate"
                    onClick={() => focusLedger(row.department.id, "全部")}
                  />
                  <LedgerDeptStat
                    label="推进中"
                    value={row.progressing}
                    tone="blue"
                    onClick={() => focusLedger(row.department.id, "推进中")}
                  />
                  <LedgerDeptStat
                    label="逾期"
                    value={row.overdue}
                    tone="red"
                    onClick={() => focusLedger(row.department.id, "逾期")}
                  />
                  <LedgerDeptStat
                    label="已完成"
                    value={row.completed}
                    tone="green"
                    onClick={() => focusLedger(row.department.id, "completed")}
                  />
                </div>
              </div>
            );
          }) : <EmptyState text="当前真实组织部门下暂无待办。" />}
        </div>
      </section>

      <Toolbar>
        <Select value={sourceFilter} onChange={(value) => setSourceFilter(value as TaskSourceFilter)} label="来源">
          {taskSourceFilters.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </Select>
        <Select value={departmentFilter} onChange={setDepartmentFilter} label="部门">
          <option value="全部">全部部门</option>
          {ledgerDepartments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={setStatusFilter} label="状态">
          <option value="全部">全部状态</option>
          {taskStatuses.map((status) => (
            <option key={status} value={status}>
              {getTaskStatusLabel(status)}
            </option>
          ))}
          <option value="推进中">推进中</option>
          <option value="临期">临期</option>
          <option value="逾期">逾期</option>
        </Select>
        <Select value={priorityFilter} onChange={setPriorityFilter} label="优先级">
          <option value="全部">全部优先级</option>
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </Select>
      </Toolbar>
      <section ref={ledgerTableRef} className="scroll-mt-24 rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">部门待办列表</h2>
          </div>
          {(sourceFilter !== "全部" || departmentFilter !== "全部" || statusFilter !== "全部" || priorityFilter !== "全部") ? (
            <button
              type="button"
              onClick={() => {
                setSourceFilter("全部");
                setDepartmentFilter("全部");
                setStatusFilter("全部");
                setPriorityFilter("全部");
              }}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              清除定位
            </button>
          ) : null}
        </div>
        <TaskTable tasks={filtered} meetings={meetings} currentUserId={currentUserId} focusTaskId={focusTaskId} onNavigate={onNavigate} onUpdateTaskStatus={onUpdateTaskStatus} onUpdateTaskCompletionItems={onUpdateTaskCompletionItems} onCanDeleteTask={onCanDeleteTask} onDeleteTask={onDeleteTask} />
      </section>
    </div>
  );
}

function MyTasksPage({
  meetings,
  tasks,
  pendingApprovalTasks,
  account,
  currentUserId,
  selectedUserId,
  focusTaskId,
  onSelectUser,
  onNavigate,
  onUpdateTaskStatus,
  onUpdateTaskCompletionItems,
  onApproveTask,
  onRejectTask,
  onConfirmTaskReview,
  onRejectTaskReview,
  onCompleteCompanySupport,
  onCanDeleteTask,
  onDeleteTask
}: {
  meetings: Meeting[];
  tasks: Task[];
  pendingApprovalTasks: Task[];
  account: TestAccount;
  currentUserId: string;
  selectedUserId: string;
  focusTaskId?: string;
  onSelectUser: (userId: string) => void;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateTaskCompletionItems: (taskId: string, completionItems: string[]) => void;
  onApproveTask: (taskId: string) => void;
  onRejectTask: (taskId: string, reason?: string) => void;
  onConfirmTaskReview: (taskId: string) => void;
  onRejectTaskReview: (taskId: string, reasonItems: string[]) => void;
  onCompleteCompanySupport: (taskId: string) => void;
  onCanDeleteTask: (task: Task) => boolean;
  onDeleteTask: (task: Task) => void;
}) {
  const accountUser = getAccountUser(account);
  const selectedUser = account.id === "manager" ? accountUser : findUser(selectedUserId) ?? accountUser;
  const isPresidentViewingAnotherUser = account.id === "president" && selectedUser.id !== accountUser.id;
  const assignedTasks = tasks.filter((task) => getTaskOwnerId(task) === selectedUser.id);
  const scopeTasks = assignedTasks.filter((task) => !isTaskCompleted(task));
  const okrScopeTasks = scopeTasks.filter((task) => getTaskSourceType(task) !== "会议待办");
  const meetingScopeTasks = scopeTasks.filter((task) => getTaskSourceType(task) === "会议待办");
  const presidentPendingApprovalTasks = account.id === "president" ? pendingApprovalTasks : [];
  const presidentSupportTasks = account.id === "president" ? getPresidentSupportTasks(tasks) : [];
  const submittedForReviewTasks = assignedTasks.filter((task) => task.status === "pending_review");
  const reviewTasks = tasks.filter((task) => {
    const meeting = findMeeting(meetings, task.meetingId);
    return task.status === "pending_review" && getTaskReviewerId(task, meeting) === selectedUser.id;
  });
  const totalWorkItemCount =
    account.id === "president"
      ? new Set([...scopeTasks.map((task) => task.id), ...presidentSupportTasks.map((task) => task.id), ...presidentPendingApprovalTasks.map((task) => task.id)]).size
      : scopeTasks.length;
  const overdue = scopeTasks.filter(isOverdue);
  const dueSoon = scopeTasks.filter(isDueSoon);
  const scopeTitle = isPresidentViewingAnotherUser ? `正在查看：${selectedUser.name} 的待办` : account.id === "president" ? `${accountUser.name} 的总裁待办` : `${selectedUser.name} 的待办`;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <UserRound size={21} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{scopeTitle}</h2>
            </div>
          </div>
          {account.id === "president" ? (
            <div className="min-w-72">
              <SearchableSelect
                value={selectedUser.id}
                onChange={onSelectUser}
                options={users.map((user) => {
                  const department = findDepartment(user.departmentId);
                  return {
                    value: user.id,
                    label: userOptionLabel(user),
                    meta: [department?.name, user.role, user.employeeNo].filter(Boolean).join(" · "),
                    searchText: userSearchText(user, department)
                  };
                })}
                placeholder="输入要查看的人员"
              />
            </div>
          ) : account.id === "employee" ? (
            <div className="min-w-72">
              <SearchableSelect
                value={selectedUserId}
                onChange={onSelectUser}
                options={[{
                  value: accountUser.id,
                  label: userOptionLabel(accountUser),
                  meta: findDepartment(accountUser.departmentId)?.name,
                  searchText: `${accountUser.name} ${accountUser.employeeNo ?? ""} ${accountUser.title} ${findDepartment(accountUser.departmentId)?.name ?? ""}`
                }]}
                placeholder="输入人员"
              />
            </div>
          ) : (
            <span className="app-action-pill px-3 py-1 text-sm">{account.roleLabel}</span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-4 gap-4">
        <MetricTile label={account.id === "president" ? "总裁待办" : "我的待办"} value={`${totalWorkItemCount} 项`} icon={ListChecks} tone="blue" />
        <MetricTile label="临期" value={`${dueSoon.length} 项`} icon={Clock3} tone="amber" />
        <MetricTile label="逾期" value={`${overdue.length} 项`} icon={AlertTriangle} tone={overdue.length ? "red" : "green"} />
        <MetricTile
          label={account.id === "president" ? "待签批" : "待复核"}
          value={`${account.id === "president" ? presidentPendingApprovalTasks.length : account.id === "manager" ? reviewTasks.length : submittedForReviewTasks.length} 项`}
          icon={CheckCircle2}
          tone={(account.id === "president" ? presidentPendingApprovalTasks.length : account.id === "manager" ? reviewTasks.length : submittedForReviewTasks.length) ? "amber" : "green"}
        />
      </div>

      <div className="space-y-5">
        {account.id === "president" ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-5 shadow-panel">
            <div className={`flex items-center justify-between gap-3 ${presidentPendingApprovalTasks.length ? "mb-4" : ""}`}>
              <div>
                <h3 className="text-base font-semibold text-ink">待总裁签批</h3>
              </div>
              <span className={`rounded-full border px-3 py-1 text-sm font-medium ${solidTone.amber}`}>{presidentPendingApprovalTasks.length} 项</span>
            </div>
            <PendingApprovalReviewCards
              tasks={presidentPendingApprovalTasks}
              meetings={meetings}
              focusTaskId={focusTaskId}
              onNavigate={onNavigate}
              onApproveTask={onApproveTask}
              onRejectTask={onRejectTask}
            />
          </section>
        ) : null}

        {account.id === "president" ? (
          <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-5 shadow-panel">
            <div className={`flex items-center justify-between gap-3 ${presidentSupportTasks.length ? "mb-4" : ""}`}>
              <div>
                <h3 className="text-base font-semibold text-ink">公司支持待处理</h3>
                <p className="mt-1 text-sm text-slate-500">其他身份在“需要公司支持”中填写的内容，会汇总到总裁这里处理。</p>
              </div>
              <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-medium text-blue-700">{presidentSupportTasks.length} 项</span>
            </div>
            <CompanySupportReviewCards tasks={presidentSupportTasks} meetings={meetings} onNavigate={onNavigate} onCompleteCompanySupport={onCompleteCompanySupport} />
          </section>
        ) : null}

        <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-5 shadow-panel">
          <div className={`flex items-center justify-between gap-3 ${reviewTasks.length ? "mb-4" : ""}`}>
            <div>
              <h3 className="text-base font-semibold text-ink">待我复核</h3>
            </div>
            <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-sm font-medium text-blue-700">{reviewTasks.length} 项</span>
          </div>
          <ReviewTrackingCards tasks={reviewTasks} meetings={meetings} onNavigate={onNavigate} onConfirmTaskReview={onConfirmTaskReview} onRejectTaskReview={onRejectTaskReview} />
        </section>

        <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-5 shadow-panel">
          <div className={`flex items-center justify-between gap-3 ${submittedForReviewTasks.length ? "mb-4" : ""}`}>
            <div>
              <h3 className="text-base font-semibold text-ink">我提交待复核</h3>
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${solidTone.amber}`}>{submittedForReviewTasks.length} 项</span>
          </div>
          <ReviewTrackingCards tasks={submittedForReviewTasks} meetings={meetings} onNavigate={onNavigate} />
        </section>
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className={`flex items-center justify-between gap-3 ${scopeTasks.length ? "mb-4" : ""}`}>
          <div>
            <h3 className="text-base font-semibold text-ink">待办事项</h3>
            <p className="mt-1 text-sm text-slate-500">OKR 待办和会议待办并行显示，互不覆盖；同一负责人名下多个 OKR 待办会同时进入这里。</p>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-sm font-medium text-slate-600">{scopeTasks.length} 项</span>
        </div>
        {scopeTasks.length ? (
          <div className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-ink">OKR 待办</h4>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{okrScopeTasks.length} 项</span>
              </div>
              {okrScopeTasks.length ? (
                <TaskTable tasks={okrScopeTasks} meetings={meetings} currentUserId={currentUserId} onNavigate={onNavigate} onUpdateTaskStatus={onUpdateTaskStatus} onUpdateTaskCompletionItems={onUpdateTaskCompletionItems} onCanDeleteTask={onCanDeleteTask} onDeleteTask={onDeleteTask} />
              ) : (
                <EmptyState text="当前没有 OKR 待办" />
              )}
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-ink">会议待办</h4>
                <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{meetingScopeTasks.length} 项</span>
              </div>
              {meetingScopeTasks.length ? (
                <TaskTable tasks={meetingScopeTasks} meetings={meetings} currentUserId={currentUserId} onNavigate={onNavigate} onUpdateTaskStatus={onUpdateTaskStatus} onUpdateTaskCompletionItems={onUpdateTaskCompletionItems} onCanDeleteTask={onCanDeleteTask} onDeleteTask={onDeleteTask} />
              ) : (
                <EmptyState text="当前没有会议待办" />
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DepartmentsPage({
  meetings,
  tasks,
  rejectedTasks,
  account,
  currentUserId,
  selectedDepartmentId,
  onSelectDepartment,
  onNavigate,
  onUpdateTaskStatus,
  onCanDeleteTask,
  onDeleteTask
}: {
  meetings: Meeting[];
  tasks: Task[];
  rejectedTasks: Task[];
  account: TestAccount;
  currentUserId: string;
  selectedDepartmentId: string;
  onSelectDepartment: (departmentId: string) => void;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateTaskCompletionItems: (taskId: string, completionItems: string[]) => void;
  onCanDeleteTask: (task: Task) => boolean;
  onDeleteTask: (task: Task) => void;
}) {
  const accountUser = getAccountUser(account);
  const effectiveDepartmentId = account.id === "manager" ? accountUser.departmentId : selectedDepartmentId;
  const department = findDepartment(effectiveDepartmentId) ?? findDepartment(defaultMeetingDepartmentId) ?? departments[1];
  const departmentTasks = tasks.filter((task) => isTaskRelatedToDepartment(task, department.id, findMeeting(meetings, task.meetingId)));
  const departmentRejectedTasks = rejectedTasks.filter((task) => isTaskRelatedToDepartment(task, department.id, findMeeting(meetings, task.meetingId)));
  const departmentMeetings = meetings.filter((meeting) => isMeetingConnectedToDepartment(meeting, department.id) || departmentTasks.some((task) => task.meetingId === meeting.id));
  const completed = departmentTasks.filter(isTaskCompleted).length;
  const overdue = departmentTasks.filter(isOverdue).length;
  const rate = departmentTasks.length ? completed / departmentTasks.length : 0;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-brand">
              <Building2 size={21} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{department.name}</h2>
            </div>
          </div>
          {account.id === "manager" ? (
            <span className="app-action-pill px-3 py-1 text-sm">{department.name} · 已按管理者权限锁定</span>
          ) : (
            <div className="min-w-72">
              <SearchableSelect
                value={selectedDepartmentId}
                onChange={onSelectDepartment}
                options={realDepartments.map((item) => ({
                  value: item.id,
                  label: departmentOptionLabel(item),
                  meta: item.fullPath,
                  searchText: `${item.name} ${item.orgCode ?? ""} ${item.fullPath ?? ""} ${item.orgType ?? ""}`
                }))}
                placeholder="输入部门"
              />
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-4 gap-4">
        <MetricTile label="部门会议" value={`${departmentMeetings.length} 场`} icon={CalendarDays} tone="blue" />
        <MetricTile label="部门待办" value={`${departmentTasks.length} 项`} icon={ClipboardList} tone="slate" />
        <MetricTile label="完成率" value={formatPercent(rate)} icon={CheckCircle2} tone="green" />
        <MetricTile label="逾期风险" value={`${overdue} 项`} icon={AlertTriangle} tone={overdue ? "red" : "green"} />
      </div>

      {departmentRejectedTasks.length ? (
        <section className="rounded-lg border border-red-200 bg-red-50/50 p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-red-900">被驳回待办</h3>
              <p className="mt-1 text-sm text-red-700">总裁签批未通过，需要部门主管重新修正待办推进人、复核人、时间或目标后再提交</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${solidTone.red}`}>{departmentRejectedTasks.length} 项</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {departmentRejectedTasks.map((task) => {
              const meeting = findMeeting(meetings, task.meetingId);
              return (
                <div key={task.id} className="rounded-xl border border-red-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink">{getTaskContent(task)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {findUser(getTaskOwnerId(task))?.name} · 截止 {task.dueDate}
                      </div>
                    </div>
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">驳回原因：{task.rejectedReason || "请重新确认待办推进人、复核人、开始时间和截止时间。"}</div>
                  {meeting ? (
                    <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="mt-3 text-sm font-medium text-brand hover:text-blue-800">
                      查看来源会议
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <h3 className="mb-4 text-base font-semibold text-ink">部门会议</h3>
          <div className="grid grid-cols-3 gap-3">
            {departmentMeetings.length ? (
              departmentMeetings.map((meeting) => (
                <button key={meeting.id} onClick={() => onNavigate("meeting-detail", meeting.id)} className="block w-full rounded-lg border border-line p-3 text-left hover:bg-slate-50">
                  <div className="font-medium text-ink">{meeting.title}</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {meeting.type} · {meeting.durationMinutes} 分钟
                  </div>
                </button>
              ))
            ) : (
              <EmptyState text="当前部门暂无会议" />
            )}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-ink">部门待办</h3>
            </div>
            <span className="app-action-pill px-3 py-1 text-sm">{departmentTasks.length} 项</span>
          </div>
          <DepartmentTaskCards tasks={departmentTasks} meetings={meetings} currentUserId={currentUserId} onNavigate={onNavigate} onUpdateTaskStatus={onUpdateTaskStatus} onCanDeleteTask={onCanDeleteTask} onDeleteTask={onDeleteTask} />
        </section>
      </div>
    </div>
  );
}

function DictionaryPage() {
  const [entries, setEntries] = useState<MeetingDictionaryEntry[]>([]);
  const [standard, setStandard] = useState("");
  const [variants, setVariants] = useState("");
  const [category, setCategory] = useState("业务词");
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadEntries = () => {
    setIsLoading(true);
    fetch("/api/meeting-dictionary", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as MeetingDictionaryResponse;
        if (!response.ok) throw new Error(payload.error || `GET /api/meeting-dictionary ${response.status}`);
        setEntries(payload.entries ?? []);
        setMessage("");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "读取会议词典失败");
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadEntries();
  }, []);

  async function addEntry() {
    if (!standard.trim()) return;
    setIsSaving(true);
    try {
      const response = await fetch("/api/meeting-dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standard, variants, category, note })
      });
      const payload = (await response.json().catch(() => ({}))) as MeetingDictionaryResponse;
      if (!response.ok || !payload.entry) throw new Error(payload.error || `POST /api/meeting-dictionary ${response.status}`);
      setEntries((current) => [payload.entry as MeetingDictionaryEntry, ...current]);
      setStandard("");
      setVariants("");
      setNote("");
      setMessage("词条已保存，后续 AI 生成会议模板前会自动参与纠错。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存会议词典失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEntry(entryId: string) {
    const previous = entries;
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    try {
      const response = await fetch(`/api/meeting-dictionary?id=${encodeURIComponent(entryId)}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as MeetingDictionaryResponse;
      if (!response.ok) throw new Error(payload.error || `DELETE /api/meeting-dictionary ${response.status}`);
      setMessage("词条已删除。");
    } catch (error) {
      setEntries(previous);
      setMessage(error instanceof Error ? error.message : "删除会议词典失败");
    }
  }

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-medium text-brand">会议词典</div>
            <h2 className="mt-1 text-xl font-semibold text-ink">转写纠错词库</h2>
            <p className="mt-2 text-sm text-slate-500">用于把会议文稿里常见误写词自动替换为标准词，再交给 AI 生成纪要、决策和待办。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <ReadOnlyMetric label="词条数" value={`${entries.length} 条`} variant="action" />
            <ReadOnlyMetric label="员工姓名" value={`${entries.filter((entry) => entry.category === "员工姓名").length} 条`} variant="action" />
            <ReadOnlyMetric label="业务词" value={`${entries.filter((entry) => entry.category !== "员工姓名").length} 条`} variant="action" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-5">
        <section className="rounded-xl border border-line bg-white p-5 shadow-panel xl:sticky xl:top-28">
          <SectionHeader title="新增词条" icon={Library} />
          <div className="mt-5 space-y-4">
            <Field label="标准词">
              <input value={standard} onChange={(event) => setStandard(event.target.value)} placeholder="例如：拉迷" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            </Field>
            <Field label="常见误写 / 谐音">
              <input value={variants} onChange={(event) => setVariants(event.target.value)} placeholder="例如：拉米、腊米" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            </Field>
            <Field label="词条类型">
              <SearchableSelect
                value={category}
                onChange={setCategory}
                options={["业务词", "品牌词", "员工姓名", "部门名称", "系统名"].map((item) => ({ value: item, label: item }))}
                placeholder="输入词条类型"
              />
            </Field>
            <Field label="说明">
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="例如：拉手的拉，迷人的迷" className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            </Field>
            <button onClick={addEntry} disabled={isSaving} className="app-action-button w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-300">
              <Plus size={16} />
              {isSaving ? "保存中" : "添加到会议词典"}
            </button>
            {message ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <SectionHeader title="词条列表" icon={ListChecks} />
            <div className="flex items-center gap-2">
              <button type="button" onClick={loadEntries} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">刷新</button>
              <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{isLoading ? "读取中" : `${entries.length} 条`}</span>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">标准词</th>
                  <th className="px-4 py-3">常见误写 / 谐音</th>
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">创建时间</th>
                  <th className="px-4 py-3">说明</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4 font-medium text-ink">{entry.standard}</td>
                    <td className="px-4 py-4 text-slate-600">{entry.variants}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{entry.category}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{entry.createdAt}</td>
                    <td className="max-w-md px-4 py-4 leading-6 text-slate-600">{entry.note}</td>
                    <td className="px-4 py-4">
                      <button onClick={() => deleteEntry(entry.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

const pdcaStageStyles: Record<OkrPdcaStage | "KR", { badge: string; row: string; dot: string }> = {
  KR: { badge: "border-blue-100 bg-blue-50 text-blue-700", row: "bg-blue-50/70", dot: "bg-blue-500" },
  Plan: { badge: "border-violet-100 bg-violet-50 text-violet-700", row: "bg-violet-50/60", dot: "bg-violet-500" },
  Do: { badge: solidTone.amber, row: "bg-orange-50/60", dot: "bg-orange-500" },
  Check: { badge: "border-cyan-100 bg-cyan-50 text-cyan-700", row: "bg-cyan-50/60", dot: "bg-cyan-500" },
  Act: { badge: solidTone.green, row: "bg-emerald-50/60", dot: "bg-emerald-500" }
};

const riskStyles: Record<OkrRiskLevel, string> = {
  高: solidTone.red,
  中: solidTone.amber,
  低: solidTone.green
};

const okrStatusStyles: Record<OkrProjectStatus | OkrKrStatus | OkrTaskStatus | OkrMetricStatus, string> = {
  草稿: "border-slate-200 bg-slate-50 text-slate-600",
  待总裁审批: "border-blue-200 bg-blue-50 text-blue-700",
  进行中: "border-blue-200 bg-blue-50 text-blue-700",
  已提交待复核: "border-blue-200 bg-blue-50 text-blue-700",
  已延期: solidTone.red,
  已完成: solidTone.green,
  已暂停: solidTone.amber,
  已关闭: "border-slate-200 bg-slate-50 text-slate-600",
  未开始: "border-slate-200 bg-slate-50 text-slate-600",
  阻塞中: solidTone.red,
  已取消: "border-slate-200 bg-slate-50 text-slate-600",
  已达成: solidTone.green,
  有风险: solidTone.red
};

function okrBadgeClass(value: OkrProjectStatus | OkrKrStatus | OkrTaskStatus | OkrMetricStatus | OkrRiskLevel) {
  return riskStyles[value as OkrRiskLevel] ?? okrStatusStyles[value as OkrProjectStatus];
}

function OkrBadge({ value }: { value: OkrProjectStatus | OkrKrStatus | OkrTaskStatus | OkrMetricStatus | OkrRiskLevel }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${okrBadgeClass(value)}`}>{value}</span>;
}

function countPdca(project: OkrProject, krId?: string, stage?: OkrPdcaStage) {
  return project.pdcaTasks.filter((task) => (!krId || task.krId === krId) && (!stage || task.pdcaStage === stage)).length;
}

function getOkrProjectStats(project: OkrProject) {
  const delayed = project.pdcaTasks.filter((task) => task.status === "已延期").length;
  const blocked = project.pdcaTasks.filter((task) => task.status === "阻塞中").length;
  const highRiskTasks = project.pdcaTasks.filter((task) => task.riskLevel === "高").length;
  const completed = project.pdcaTasks.filter((task) => task.status === "已完成").length;
  return {
    delayed,
    blocked,
    highRiskTasks,
    completed,
    krCount: project.krs.length,
    pdcaCount: project.pdcaTasks.length,
    relatedTaskCount: project.relatedTasks.length
  };
}

function KrProjectsPage({
  projects,
  onNavigate,
  krStatusOverrides,
  taskStatusOverrides,
  onCreateProject,
  onDeleteProject,
  onUpdateKrStatus
}: {
  projects: OkrProject[];
  onNavigate: (page: PageKey, meetingId?: string) => void;
  krStatusOverrides: Record<string, OkrKrStatus>;
  taskStatusOverrides: Record<string, TaskStatus>;
  onCreateProject: (project: OkrProject) => void;
  onDeleteProject: (project: OkrProject) => void;
  onUpdateKrStatus: (krId: string, status: OkrKrStatus) => void;
}) {
  const [view, setView] = useState<"overview" | "detail" | "create">("overview");
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [activePortfolioMetric, setActivePortfolioMetric] = useState<OkrPortfolioMetricKey>("projects");
  const [pendingDeleteProject, setPendingDeleteProject] = useState<OkrProject | null>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];

  useEffect(() => {
    if (!projects.length) return;
    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const portfolio = useMemo(() => {
    const allKrs = projects.flatMap((project) => project.krs);
    const allTasks = projects.flatMap((project) => project.pdcaTasks);
    return {
      projectCount: projects.length,
      krCount: allKrs.length,
      pdcaCount: allTasks.length,
      runningCount: projects.filter((project) => project.status === "进行中").length,
      highRiskCount: projects.filter((project) => project.riskLevel === "高").length,
      delayedBlockedCount: allTasks.filter((task) => task.status === "已延期" || task.status === "阻塞中").length,
      presidentAttentionCount: projects.reduce((sum, project) => sum + project.needPresidentDecisionCount, 0)
    };
  }, [projects]);

  const openDetail = (projectId: string) => {
    setSelectedProjectId(projectId);
    setView("detail");
  };

  const portfolioDetails: Record<OkrPortfolioMetricKey, { title: string; description: string; items: Array<{ title: string; meta: string; detail: string; projectId: string; badge?: string }> }> = {
    projects: {
      title: "OKR 项目明细",
      description: "公司当前推进的 OKR 项目，点击可进入项目详情。",
      items: projects.map((project) => ({
        title: project.name,
        meta: `${project.category} · ${project.owner} · ${project.ownerDepartment}`,
        detail: `O：${project.objective}`,
        projectId: project.id,
        badge: project.status
      }))
    },
    krs: {
      title: "KR 明细",
      description: "所有 OKR 项目拆解出的关键结果。",
      items: projects.flatMap((project) =>
        project.krs.map((kr) => ({
          title: `${kr.code} ${kr.title}`,
          meta: `${project.name} · ${kr.owner} · ${kr.department}`,
          detail: `衡量标准：${kr.metric}`,
          projectId: project.id,
          badge: kr.status
        }))
      )
    },
    pdca: {
      title: "PDCA 任务明细",
      description: "所有 KR 下拆解出的 Plan / Do / Check / Act 任务。",
      items: projects.flatMap((project) =>
        project.pdcaTasks.map((task) => ({
          title: task.title,
          meta: `${project.name} · ${task.pdcaStage} · ${task.owner} · ${task.ownerDepartment}`,
          detail: `输出成果：${task.deliverable}；计划 ${task.startDate} 至 ${task.endDate}`,
          projectId: project.id,
          badge: task.status
        }))
      )
    },
    running: {
      title: "进行中项目明细",
      description: "当前处于进行中的 OKR 项目。",
      items: projects.filter((project) => project.status === "进行中").map((project) => ({
        title: project.name,
        meta: `${project.owner} · ${project.ownerDepartment} · 进度 ${project.progress}%`,
        detail: project.objective,
        projectId: project.id,
        badge: project.riskLevel
      }))
    },
    highRisk: {
      title: "高风险项目明细",
      description: "风险等级为高的 OKR 项目，需要优先查看。",
      items: projects.filter((project) => project.riskLevel === "高").map((project) => ({
        title: project.name,
        meta: `${project.owner} · ${project.ownerDepartment} · ${project.periodText}`,
        detail: project.risks.map((risk) => risk.description).join("；") || project.objective,
        projectId: project.id,
        badge: project.status
      }))
    },
    delayedBlocked: {
      title: "延期 / 阻塞任务明细",
      description: "这些任务已经延期或阻塞，是当前 OKR 执行风险的重点。",
      items: projects.flatMap((project) =>
        project.pdcaTasks.filter((task) => task.status === "已延期" || task.status === "阻塞中").map((task) => ({
          title: task.title,
          meta: `${project.name} · ${task.owner} · ${task.ownerDepartment}`,
          detail: `状态：${task.status}；计划 ${task.startDate} 至 ${task.endDate}；输出成果：${task.deliverable}`,
          projectId: project.id,
          badge: task.riskLevel
        }))
      )
    },
    president: {
      title: "总裁关注事项明细",
      description: "需要总裁协调资源、确认优先级或推动跨部门解决的事项。",
      items: projects.flatMap((project) => [
        ...project.risks.filter((risk) => risk.needPresidentCoordination).map((risk) => ({
          title: risk.description,
          meta: `${project.name} · ${risk.departments.join("、")}`,
          detail: risk.suggestion,
          projectId: project.id,
          badge: risk.riskLevel
        })),
        ...project.supportRequests.map((request) => ({
          title: request,
          meta: `${project.name} · ${project.ownerDepartment}`,
          detail: "需要公司统一协调资源或决策支持。",
          projectId: project.id,
          badge: "需关注"
        }))
      ])
    }
  };
  const activePortfolioDetail = portfolioDetails[activePortfolioMetric];

  const createProject = (project: OkrProject) => {
    onCreateProject(project);
    setSelectedProjectId(project.id);
    setView("overview");
  };

  const confirmDeleteProject = () => {
    if (!pendingDeleteProject) return;
    onDeleteProject(pendingDeleteProject);
    setPendingDeleteProject(null);
    if (selectedProjectId === pendingDeleteProject.id) {
      const nextProject = projects.find((project) => project.id !== pendingDeleteProject.id);
      setSelectedProjectId(nextProject?.id ?? "");
      setView("overview");
    }
  };

  if (view === "create") {
    return <OkrCreateView onCancel={() => setView("overview")} onSubmit={createProject} />;
  }

  if (view === "detail" && selectedProject) {
    return <OkrDetailView project={selectedProject} onBack={() => setView("overview")} onNavigate={onNavigate} krStatusOverrides={krStatusOverrides} taskStatusOverrides={taskStatusOverrides} onUpdateKrStatus={onUpdateKrStatus} />;
  }

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-6 shadow-panel">
        <div className="flex items-start justify-between gap-5">
          <div className="max-w-5xl">
            <div className="text-xs font-semibold text-brand">OKR 项目</div>
            <h2 className="mt-1 text-2xl font-semibold text-ink">OKR 项目总览</h2>
          </div>
          <button onClick={() => setView("create")} className="app-action-button px-4 py-2.5 text-sm">
            <Plus size={16} />
            新建 OKR 项目
          </button>
        </div>
      </section>

      <section className="grid grid-cols-7 gap-3">
        <OkrKpiCard label="OKR 项目数" value={`${portfolio.projectCount} 个`} tone="blue" active={activePortfolioMetric === "projects"} onClick={() => setActivePortfolioMetric("projects")} />
        <OkrKpiCard label="KR 总数" value={`${portfolio.krCount} 个`} tone="blue" active={activePortfolioMetric === "krs"} onClick={() => setActivePortfolioMetric("krs")} />
        <OkrKpiCard label="PDCA 任务数" value={`${portfolio.pdcaCount} 项`} tone="slate" active={activePortfolioMetric === "pdca"} onClick={() => setActivePortfolioMetric("pdca")} />
        <OkrKpiCard label="进行中项目数" value={`${portfolio.runningCount} 个`} tone="green" active={activePortfolioMetric === "running"} onClick={() => setActivePortfolioMetric("running")} />
        <OkrKpiCard label="高风险项目数" value={`${portfolio.highRiskCount} 个`} tone="red" active={activePortfolioMetric === "highRisk"} onClick={() => setActivePortfolioMetric("highRisk")} />
        <OkrKpiCard label="延期 / 阻塞任务数" value={`${portfolio.delayedBlockedCount} 项`} tone="red" active={activePortfolioMetric === "delayedBlocked"} onClick={() => setActivePortfolioMetric("delayedBlocked")} />
        <OkrKpiCard label="总裁关注事项数" value={`${portfolio.presidentAttentionCount} 项`} tone="amber" active={activePortfolioMetric === "president"} onClick={() => setActivePortfolioMetric("president")} />
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-ink">{activePortfolioDetail.title}</h3>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-600">{activePortfolioDetail.items.length} 项</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {activePortfolioDetail.items.length ? (
            activePortfolioDetail.items.slice(0, 9).map((item) => (
              <button key={`${activePortfolioMetric}-${item.projectId}-${item.title}`} type="button" onClick={() => openDetail(item.projectId)} className="rounded-xl border border-line bg-slate-50 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-ink">{item.title}</div>
                  {item.badge && <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{item.badge}</span>}
                </div>
                <div className="mt-2 text-xs text-slate-500">{item.meta}</div>
                <div className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.detail}</div>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
                  查看项目
                  <ChevronRight size={13} />
                </div>
              </button>
            ))
          ) : (
            <div className="col-span-3 rounded-xl border border-dashed border-line bg-slate-50 py-10 text-center text-sm text-slate-500">当前没有对应明细</div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-4">
          <SectionHeader title="OKR 项目池" icon={Target} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{projects.length} 个项目</span>
            {(["KR", "Plan", "Do", "Check", "Act"] as Array<OkrPdcaStage | "KR">).map((item) => (
              <span key={item} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${pdcaStageStyles[item].badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${pdcaStageStyles[item].dot}`} />
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {projects.map((project) => {
            const stats = getOkrProjectStats(project);
            return (
              <div key={project.id} className="rounded-xl border border-line bg-white p-5 text-left shadow-panel transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{project.category}</span>
                    <h3 className="mt-3 text-base font-semibold text-ink">{project.name}</h3>
                  </div>
                  <OkrBadge value={project.riskLevel} />
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{project.objective}</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <OkrMiniStat label="KR" value={stats.krCount} tone="blue" />
                  <OkrMiniStat label="PDCA" value={stats.pdcaCount} tone="slate" />
                  <OkrMiniStat label="总裁关注" value={project.needPresidentDecisionCount} tone={project.needPresidentDecisionCount ? "amber" : "green"} />
                  <OkrMiniStat label="延期" value={stats.delayed} tone={stats.delayed ? "red" : "green"} />
                  <OkrMiniStat label="阻塞" value={stats.blocked} tone={stats.blocked ? "red" : "green"} />
                  <OkrMiniStat label="高风险" value={stats.highRiskTasks} tone={stats.highRiskTasks ? "red" : "green"} />
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${project.progress}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-600">
                  <span>{project.owner} · {project.ownerDepartment}</span>
                  <span>{project.progress}%</span>
                </div>
                <div className="mt-3 text-xs leading-5 text-slate-500">协同：{project.collaboratorDepartments.join("、")}</div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button type="button" onClick={() => openDetail(project.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-blue-800">
                    进入项目详情
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteProject(project)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader title="OKR 组合管理矩阵" icon={BarChart3} />
          <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">公司级视图</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full table-fixed divide-y divide-line text-xs">
            <colgroup>
              <col className="w-[13%]" />
              <col className="w-[21%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[7%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead className="bg-slate-50 text-left font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-3">OKR 项目</th>
                <th className="px-3 py-3">O 目标</th>
                <th className="px-3 py-3">负责人</th>
                <th className="px-3 py-3">主责部门</th>
                <th className="px-3 py-3">项目周期</th>
                <th className="px-3 py-3">KR</th>
                <th className="px-3 py-3">PDCA</th>
                <th className="px-3 py-3">当前进度</th>
                <th className="px-3 py-3">风险</th>
                <th className="px-3 py-3">异常</th>
                <th className="px-3 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((project) => {
                const stats = getOkrProjectStats(project);
                return (
                  <tr key={project.id} className="align-top hover:bg-slate-50">
                    <td className="px-3 py-4 font-semibold text-ink">{project.name}</td>
                    <td className="px-3 py-4 leading-5 text-slate-600">{project.objective}</td>
                    <td className="px-3 py-4 text-slate-700">{project.owner}</td>
                    <td className="px-3 py-4 text-slate-600">{project.ownerDepartment}</td>
                    <td className="px-3 py-4 text-slate-600">{project.periodText ?? `${project.startDate} - ${project.endDate}`}</td>
                    <td className="px-3 py-4 font-semibold text-brand">{stats.krCount}</td>
                    <td className="px-3 py-4 font-semibold text-slate-700">{stats.pdcaCount}</td>
                    <td className="px-3 py-4">
                      <div className="font-semibold text-ink">{project.progress}%</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${project.progress}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-4"><OkrBadge value={project.riskLevel} /></td>
                    <td className="px-3 py-4 leading-5 text-slate-600">延期 {stats.delayed} / 阻塞 {stats.blocked}<br />总裁关注 {project.needPresidentDecisionCount}</td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col gap-2">
                        <button onClick={() => openDetail(project.id)} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 hover:bg-blue-100">
                          查看详情
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteProject(project)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {pendingDeleteProject ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-lg rounded-xl border border-line bg-white p-5 shadow-panel">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink">确认删除 OKR 项目？</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  删除后会移除该项目、KR 和 PDCA 任务。已进入统一待办的 OKR 任务也会从当前视图中移除。
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600">
              <div className="font-semibold text-ink">{pendingDeleteProject.name}</div>
              <div className="mt-1">负责人：{pendingDeleteProject.owner} · {pendingDeleteProject.ownerDepartment}</div>
              <div className="mt-1">包含：{pendingDeleteProject.krs.length} 个 KR，{pendingDeleteProject.pdcaTasks.length} 项 PDCA</div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteProject(null)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDeleteProject}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OkrDetailView({
  project,
  onBack,
  onNavigate,
  krStatusOverrides,
  taskStatusOverrides,
  onUpdateKrStatus
}: {
  project: OkrProject;
  onBack: () => void;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  krStatusOverrides: Record<string, OkrKrStatus>;
  taskStatusOverrides: Record<string, TaskStatus>;
  onUpdateKrStatus: (krId: string, status: OkrKrStatus) => void;
}) {
  const [activeOverviewMetric, setActiveOverviewMetric] = useState<OkrOverviewMetricKey>("krs");
  const [selectedKrId, setSelectedKrId] = useState(project.krs[0]?.id ?? "");
  const [selectedMetricIndex, setSelectedMetricIndex] = useState(0);
  const krDetailRef = useRef<HTMLDivElement | null>(null);
  const stats = getOkrProjectStats(project);
  const krById = new Map(project.krs.map((kr) => [kr.id, kr]));
  const selectedKr = project.krs.find((kr) => kr.id === selectedKrId) ?? project.krs[0];
  const selectedKrTasks = selectedKr ? project.pdcaTasks.filter((task) => task.krId === selectedKr.id) : [];
  const exceptionTasks = project.pdcaTasks.filter((task) => task.status === "已延期" || task.status === "阻塞中" || task.riskLevel === "高");
  const selectedMetric = project.metrics[selectedMetricIndex] ?? project.metrics[0];
  const metricRelatedKr = project.krs[selectedMetricIndex % Math.max(project.krs.length, 1)];
  const metricRelatedTasks = metricRelatedKr ? project.pdcaTasks.filter((task) => task.krId === metricRelatedKr.id) : project.pdcaTasks.slice(0, 3);
  const metricSource = selectedMetric
    ? selectedMetric.label.includes("下单耗时")
      ? "数据来源：三维家下单记录、门店上传记录、审单流转时间。"
      : selectedMetric.label.includes("准确率")
        ? "数据来源：审单通过率、错单记录、下单返工记录。"
        : selectedMetric.label.includes("安装")
          ? "数据来源：安装验收结果、安装异常记录、售后回访记录。"
          : selectedMetric.label.includes("售后")
            ? "数据来源：售后台账、财务售后金额、客户问题归因。"
            : "数据来源：项目周报、业务台账和人工定期录入。"
    : "";
  const metricDefinition = selectedMetric
    ? selectedMetric.label.includes("下单耗时")
      ? "指标定义：衡量设计师从客户需求确认到完成标准下单的平均用时。"
      : selectedMetric.label.includes("准确率")
        ? "指标定义：衡量下单资料一次性通过审单或无需返工的比例。"
        : selectedMetric.label.includes("安装")
          ? "指标定义：衡量订单安装一次性成功并通过验收的比例。"
          : selectedMetric.label.includes("售后")
            ? "指标定义：衡量项目推进后售后金额是否按目标下降。"
            : "指标定义：衡量该 OKR 项目的核心业务结果是否改善。"
    : "";
  const metricGap = selectedMetric ? `差距判断：当前值为“${selectedMetric.current}”，目标为“${selectedMetric.target}”，系统会结合关联 KR 和 PDCA 任务判断是否需要加速推进。` : "";
  const overviewDetails: Record<OkrOverviewMetricKey, { title: string; description: string; items: Array<{ title: string; meta: string; detail: string; badge?: string }> }> = {
    krs: {
      title: "KR 明细",
      description: "查看当前项目拆解出的关键结果和负责人。",
      items: project.krs.map((kr) => ({
        title: `${kr.code} ${kr.title}`,
        meta: `${kr.owner} · ${kr.department} · ${kr.startDate} 至 ${kr.endDate}`,
        detail: `衡量标准：${kr.metric}`,
        badge: kr.status
      }))
    },
    pdca: {
      title: "PDCA 任务明细",
      description: "查看该项目下所有执行任务。",
      items: project.pdcaTasks.map((task) => ({
        title: task.title,
        meta: `${task.pdcaStage} · ${task.owner} · ${task.ownerDepartment} · ${task.startDate} 至 ${task.endDate}`,
        detail: `输出成果：${task.deliverable}`,
        badge: task.status
      }))
    },
    delayed: {
      title: "延期任务明细",
      description: "这些任务已经延期，需要优先跟进。",
      items: project.pdcaTasks.filter((task) => task.status === "已延期").map((task) => ({
        title: task.title,
        meta: `${task.owner} · ${task.ownerDepartment} · 截止 ${task.endDate}`,
        detail: `所属 KR：${krById.get(task.krId)?.code ?? "KR"}；输出成果：${task.deliverable}`,
        badge: task.riskLevel
      }))
    },
    blocked: {
      title: "阻塞任务明细",
      description: "这些任务存在跨部门或资源卡点。",
      items: project.pdcaTasks.filter((task) => task.status === "阻塞中").map((task) => ({
        title: task.title,
        meta: `${task.owner} · ${task.ownerDepartment} · 协同 ${task.collaboratorDepartments.join("、")}`,
        detail: `所属 KR：${krById.get(task.krId)?.code ?? "KR"}；输出成果：${task.deliverable}`,
        badge: task.riskLevel
      }))
    },
    highRisk: {
      title: "高风险任务明细",
      description: "风险等级为高的任务会影响项目整体目标达成。",
      items: project.pdcaTasks.filter((task) => task.riskLevel === "高").map((task) => ({
        title: task.title,
        meta: `${task.pdcaStage} · ${task.owner} · ${task.ownerDepartment}`,
        detail: `所属 KR：${krById.get(task.krId)?.code ?? "KR"}；计划 ${task.startDate} 至 ${task.endDate}`,
        badge: task.status
      }))
    },
    president: {
      title: "总裁协调事项",
      description: "需要公司高层协调资源或确认优先级的事项。",
      items: [
        ...project.risks.filter((risk) => risk.needPresidentCoordination).map((risk) => ({
          title: risk.description,
          meta: `${risk.departments.join("、")} · ${risk.riskLevel}风险`,
          detail: risk.suggestion,
          badge: "需协调"
        })),
        ...project.supportRequests.map((request) => ({
          title: request,
          meta: `${project.ownerDepartment} · ${project.owner}`,
          detail: "需要公司统一协调资源或决策支持。",
          badge: "公司支持"
        }))
      ]
    },
    meetings: {
      title: "关联会议明细",
      description: "这些会议与当前 OKR 项目有关。",
      items: project.relatedMeetings.map((meeting) => ({
        title: meeting.title,
        meta: `${meeting.date} · 主持人 ${meeting.host} · 形成待办 ${meeting.todoCount} 项`,
        detail: `会议决策：${meeting.decision}`,
        badge: meeting.status
      }))
    },
    tasks: {
      title: "关联待办明细",
      description: "这些待办来自该 OKR 项目相关会议或 KR 拆解。",
      items: project.relatedTasks.map((task) => ({
        title: task.content,
        meta: `${task.owner} · ${task.ownerDepartment} · 截止 ${task.dueDate}`,
        detail: `来源：${task.sourceMeeting}；协同部门：${task.collaboratorDepartments.join("、")}`,
        badge: task.status
      }))
    }
  };
  const activeOverviewDetail = overviewDetails[activeOverviewMetric];
  const getPdcaDisplayStatus = (task: OkrPDCATask): OkrTaskStatus => {
    const override = taskStatusOverrides[`okr-task-${task.id}`];
    if (override === "completed") return "已完成";
    if (override === "pending_review") return "已提交待复核";
    if (override === "in_progress") return "进行中";
    if (override === "overdue") return "已延期";
    if (override === "blocked") return "阻塞中";
    return task.status;
  };
  const isKrReadyForOwnerReview = (kr: OkrKR) => {
    const krTasks = project.pdcaTasks.filter((task) => task.krId === kr.id);
    return krTasks.length > 0 && krTasks.every((task) => getPdcaDisplayStatus(task) === "已完成");
  };
  const getKrDisplayStatus = (kr: OkrKR) => krStatusOverrides[kr.id] ?? (isKrReadyForOwnerReview(kr) ? "已提交待复核" : kr.status);
  const selectedKrStatus = selectedKr ? getKrDisplayStatus(selectedKr) : "未开始";
  const selectedKrCompletedTasks = selectedKrTasks.filter((task) => getPdcaDisplayStatus(task) === "已完成").length;
  const selectedKrAllPdcaDone = selectedKrTasks.length > 0 && selectedKrCompletedTasks === selectedKrTasks.length;
  const selectedKrPendingStages = pdcaStages.filter((stage) => !selectedKrTasks.some((task) => task.pdcaStage === stage && getPdcaDisplayStatus(task) === "已完成"));
  const openKrDetail = (krId: string) => {
    setSelectedKrId(krId);
    window.setTimeout(() => {
      krDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  const submitKrReview = (krId: string) => {
    const krTasks = project.pdcaTasks.filter((task) => task.krId === krId);
    const allDone = krTasks.length > 0 && krTasks.every((task) => getPdcaDisplayStatus(task) === "已完成");
    if (!allDone) return;
    onUpdateKrStatus(krId, "已提交待复核");
  };
  const approveKrReview = (krId: string) => {
    onUpdateKrStatus(krId, "已完成");
  };

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-6 shadow-panel">
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          返回 OKR 总览
        </button>
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-5xl">
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{project.category}</span>
            <h2 className="mt-3 text-2xl font-semibold text-ink">{project.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">O：{project.objective}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-slate-600">负责人：{project.owner}</span>
              <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-slate-600">主责部门：{project.ownerDepartment}</span>
              <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-slate-600">周期：{project.periodText}</span>
              <OkrBadge value={project.status} />
              <OkrBadge value={project.riskLevel} />
            </div>
          </div>
          <div className="min-w-52 rounded-xl border border-line bg-slate-50 p-4">
            <div className="text-sm text-slate-500">当前进度</div>
            <div className="mt-1 text-3xl font-semibold text-ink">{project.progress}%</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-brand" style={{ width: `${project.progress}%` }} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-[1.05fr_0.95fr] gap-5">
        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <SectionHeader title="项目概览" description="项目背景、责任边界和当前异常" icon={Target} />
          <p className="mt-4 text-sm leading-6 text-slate-600">{project.background}</p>
          <div className="mt-5 grid grid-cols-4 gap-3">
            <OkrMiniStat label="KR 数" value={stats.krCount} tone="blue" active={activeOverviewMetric === "krs"} onClick={() => setActiveOverviewMetric("krs")} />
            <OkrMiniStat label="PDCA 数" value={stats.pdcaCount} tone="slate" active={activeOverviewMetric === "pdca"} onClick={() => setActiveOverviewMetric("pdca")} />
            <OkrMiniStat label="延期任务" value={stats.delayed} tone={stats.delayed ? "red" : "green"} active={activeOverviewMetric === "delayed"} onClick={() => setActiveOverviewMetric("delayed")} />
            <OkrMiniStat label="阻塞任务" value={stats.blocked} tone={stats.blocked ? "red" : "green"} active={activeOverviewMetric === "blocked"} onClick={() => setActiveOverviewMetric("blocked")} />
            <OkrMiniStat label="高风险任务" value={stats.highRiskTasks} tone={stats.highRiskTasks ? "red" : "green"} active={activeOverviewMetric === "highRisk"} onClick={() => setActiveOverviewMetric("highRisk")} />
            <OkrMiniStat label="总裁协调" value={project.needPresidentDecisionCount} tone={project.needPresidentDecisionCount ? "amber" : "green"} active={activeOverviewMetric === "president"} onClick={() => setActiveOverviewMetric("president")} />
            <OkrMiniStat label="关联会议" value={project.relatedMeetings.length} tone="blue" active={activeOverviewMetric === "meetings"} onClick={() => setActiveOverviewMetric("meetings")} />
            <OkrMiniStat label="关联待办" value={project.relatedTasks.length} tone="slate" active={activeOverviewMetric === "tasks"} onClick={() => setActiveOverviewMetric("tasks")} />
          </div>
          <div className="mt-4 rounded-xl border border-line bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">{activeOverviewDetail.title}</div>
                <div className="mt-1 text-sm text-slate-500">{activeOverviewDetail.description}</div>
              </div>
              <span className="rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold text-slate-600">{activeOverviewDetail.items.length} 项</span>
            </div>
            <div className="mt-3 max-h-[520px] min-h-[360px] space-y-2 overflow-y-auto pr-1">
              {activeOverviewDetail.items.length ? (
                activeOverviewDetail.items.map((item) => (
                  <div key={`${activeOverviewMetric}-${item.title}-${item.meta}`} className="rounded-lg border border-line bg-white px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-ink">{item.title}</div>
                      {item.badge && <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{item.badge}</span>}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.meta}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-line bg-white py-16 text-center text-sm text-slate-500">当前没有对应明细</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <SectionHeader title="核心指标" description="点击指标查看定义、数据来源、差距和关联任务" icon={BarChart3} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {project.metrics.map((metric, index) => (
              <button
                key={metric.label}
                type="button"
                onClick={() => setSelectedMetricIndex(index)}
                className={`rounded-xl border bg-slate-50 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40 ${selectedMetricIndex === index ? "border-brand ring-2 ring-blue-100" : "border-line"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink">{metric.label}</div>
                  <OkrBadge value={metric.status} />
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <div>基准：{metric.base}</div>
                  <div>目标：{metric.target}</div>
                  <div className="font-semibold text-ink">当前：{metric.current}</div>
                </div>
              </button>
            ))}
          </div>
          {selectedMetric && (
            <div className="mt-4 rounded-xl border border-line bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-ink">{selectedMetric.label} · 指标变化详情</div>
                  <div className="mt-1 text-sm text-slate-500">核心指标不是任务本身，而是用于判断 OKR 项目是否真的产生业务改善。</div>
                </div>
                <OkrBadge value={selectedMetric.status} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="text-xs text-slate-500">基准值</div>
                  <div className="mt-1 font-semibold text-ink">{selectedMetric.base}</div>
                </div>
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="text-xs text-slate-500">目标值</div>
                  <div className="mt-1 font-semibold text-ink">{selectedMetric.target}</div>
                </div>
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="text-xs text-slate-500">当前值</div>
                  <div className="mt-1 font-semibold text-ink">{selectedMetric.current}</div>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                <div className="rounded-lg bg-white px-3 py-2">{metricDefinition}</div>
                <div className="rounded-lg bg-white px-3 py-2">{metricSource}</div>
                <div className="rounded-lg bg-white px-3 py-2">{metricGap}</div>
              </div>
              {metricRelatedKr && (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3">
                  <div className="text-xs font-semibold text-blue-700">关联 KR</div>
                  <div className="mt-1 font-semibold text-ink">{metricRelatedKr.code} {metricRelatedKr.title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{metricRelatedKr.metric}</div>
                </div>
              )}
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-slate-500">影响该指标的 PDCA 任务</div>
                <div className="space-y-2">
                  {metricRelatedTasks.length ? (
                    metricRelatedTasks.slice(0, 4).map((task) => (
                      <div key={task.id} className="rounded-lg border border-line bg-white px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-ink">{task.title}</div>
                            <div className="mt-1 text-xs text-slate-500">{task.pdcaStage} · {task.owner} · {task.ownerDepartment} · {task.startDate} 至 {task.endDate}</div>
                          </div>
                          <OkrBadge value={getPdcaDisplayStatus(task)} />
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">输出成果：{task.deliverable}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-line bg-white py-8 text-center text-sm text-slate-500">当前指标暂未关联 PDCA 任务</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader title="KR 拆解卡片" description="每个 KR 下统计 Plan / Do / Check / Act 任务数量" icon={Target} />
          <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{project.krs.length} 个 KR</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {project.krs.map((kr) => (
            <button
              key={kr.id}
              type="button"
              onClick={() => openKrDetail(kr.id)}
              className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-slate-50 ${selectedKr?.id === kr.id ? "border-brand ring-2 ring-blue-100" : "border-line"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pdcaStageStyles.KR.badge}`}>{kr.code}</span>
                  <h3 className="mt-3 font-semibold text-ink">{kr.title}</h3>
                </div>
                <OkrBadge value={getKrDisplayStatus(kr)} />
              </div>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{kr.description}</p>
              <div className="mt-3 text-sm leading-6 text-slate-600">衡量：{kr.metric}</div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {(["Plan", "Do", "Check", "Act"] as OkrPdcaStage[]).map((stage) => (
                  <div key={stage} className={`rounded-lg border px-2 py-2 text-center ${pdcaStageStyles[stage].badge}`}>
                    <div className="text-sm font-semibold">{countPdca(project, kr.id, stage)}</div>
                    <div className="text-[11px]">{stage}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>推进：{kr.owner} · {kr.department}</span>
                <span>复核：{kr.reviewer ?? project.owner}</span>
              </div>
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                权重 {kr.weight}%：用于项目综合进度测算，第一版由项目负责人手动设定。
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand" style={{ width: `${kr.progress}%` }} />
              </div>
            </button>
          ))}
        </div>
        {selectedKr && (
          <div ref={krDetailRef} className="scroll-mt-28 mt-5 rounded-xl border border-line bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pdcaStageStyles.KR.badge}`}>{selectedKr.code}</span>
                  <h3 className="text-base font-semibold text-ink">{selectedKr.title} · 任务进展详情</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{selectedKr.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <OkrBadge value={selectedKrStatus} />
                <OkrBadge value={selectedKr.riskLevel} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
              <div className="text-sm leading-6 text-blue-800">
                <span className="font-semibold text-ink">KR 复核流程：</span>
                该 KR 下 Plan / Do / Check / Act 四类动作全部完成后，系统自动推送给 OKR 负责人 {project.owner} 的“我的待办”进行复核；复核通过后，{selectedKr.code} 才正式归档，并纳入项目统计。
                {!selectedKrAllPdcaDone ? (
                  <span className="ml-1 font-semibold text-amber-700">当前还差 {selectedKrPendingStages.join(" / ")} 未完成。</span>
                ) : (
                  <span className="ml-1 font-semibold text-emerald-700">当前 PDCA 动作已全部完成，已进入 OKR 负责人复核队列。</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => submitKrReview(selectedKr.id)}
                  disabled={!selectedKrAllPdcaDone || selectedKrStatus === "已提交待复核" || selectedKrStatus === "已完成"}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  同步复核状态
                </button>
                <button
                  type="button"
                  onClick={() => approveKrReview(selectedKr.id)}
                  disabled={selectedKrStatus !== "已提交待复核"}
                  className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  复核通过
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              <OkrMiniStat label="任务数" value={selectedKrTasks.length} tone="blue" />
              <OkrMiniStat label="已完成" value={selectedKrCompletedTasks} tone="green" />
              <OkrMiniStat label="延期/阻塞" value={selectedKrTasks.filter((task) => getPdcaDisplayStatus(task) === "已延期" || getPdcaDisplayStatus(task) === "阻塞中").length} tone={selectedKrTasks.some((task) => getPdcaDisplayStatus(task) === "已延期" || getPdcaDisplayStatus(task) === "阻塞中") ? "red" : "green"} />
              <OkrMiniStat label="高风险" value={selectedKrTasks.filter((task) => task.riskLevel === "高").length} tone={selectedKrTasks.some((task) => task.riskLevel === "高") ? "red" : "green"} />
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
              <table className="w-full table-fixed divide-y divide-line text-xs">
                <colgroup>
                  <col className="w-[8%]" />
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead className="bg-slate-50 text-left font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-3">阶段</th>
                    <th className="px-3 py-3">任务</th>
                    <th className="px-3 py-3">负责人</th>
                    <th className="px-3 py-3">责任部门</th>
                    <th className="px-3 py-3">输出成果</th>
                    <th className="px-3 py-3">计划时间</th>
                    <th className="px-3 py-3">状态</th>
                    <th className="px-3 py-3">风险</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {selectedKrTasks.map((task) => (
                    <tr key={task.id} className={`align-top ${pdcaStageStyles[task.pdcaStage].row}`}>
                      <td className="px-3 py-4"><span className={`rounded-full border px-2 py-1 font-semibold ${pdcaStageStyles[task.pdcaStage].badge}`}>{task.pdcaStage}</span></td>
                      <td className="px-3 py-4">
                        <div className="font-semibold text-ink">{task.title}</div>
                        <div className="mt-1 leading-5 text-slate-600">{task.content}</div>
                      </td>
                      <td className="px-3 py-4 text-slate-700">{task.owner}</td>
                      <td className="px-3 py-4 text-slate-600">{task.ownerDepartment}<br /><span className="text-slate-400">协同：{task.collaboratorDepartments.join("、")}</span></td>
                      <td className="px-3 py-4 leading-5 text-slate-600">{task.deliverable}</td>
                      <td className="px-3 py-4 text-slate-600">{task.startDate}<br />至 {task.endDate}</td>
                      <td className="px-3 py-4"><OkrBadge value={getPdcaDisplayStatus(task)} /></td>
                      <td className="px-3 py-4"><OkrBadge value={task.riskLevel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader title="KR 规划 + PDCA 循环一体化表" description="KR 与 Plan / Do / Check / Act 任务放在同一张表中，便于穿透查看责任、时间、输出和风险" icon={ClipboardList} />
          <span className="rounded-full border border-line px-3 py-1 text-sm text-slate-600">{project.pdcaTasks.length} 项 PDCA</span>
        </div>
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3">
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2 text-xs leading-5 text-amber-900">
            <span className="font-semibold text-ink">风险定义：</span>
            <span><strong>高</strong>：已逾期、阻塞，或影响 KR / 公司关键指标达成。</span>
            <span><strong>中</strong>：临近截止、依赖跨部门资源，或进度明显慢于计划。</span>
            <span><strong>低</strong>：责任、时间、输出成果清晰，当前按计划推进。</span>
            <span className="text-amber-800">判断维度：时间风险 + 责任风险 + 协同风险 + 目标影响。</span>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full table-fixed divide-y divide-line text-xs">
            <colgroup>
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[21%]" />
              <col className="w-[10%]" />
              <col className="w-[11%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead className="bg-slate-50 text-left font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-3">层级</th>
                <th className="px-3 py-3">阶段</th>
                <th className="px-3 py-3">任务 / KR 内容</th>
                <th className="px-3 py-3">负责人 / 部门</th>
                <th className="px-3 py-3">协同部门</th>
                <th className="px-3 py-3">开始</th>
                <th className="px-3 py-3">结束</th>
                <th className="px-3 py-3">输出成果</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">风险</th>
                <th className="px-3 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {project.krs.map((kr) => (
                <>
                  <tr key={kr.id} className={`align-top ${pdcaStageStyles.KR.row}`}>
                    <td className="px-3 py-4 font-semibold text-blue-700">{kr.code}</td>
                    <td className="px-3 py-4"><span className={`rounded-full border px-2.5 py-1 font-semibold ${pdcaStageStyles.KR.badge}`}>KR</span></td>
                    <td className="px-3 py-4">
                      <div className="font-semibold text-ink">{kr.title}</div>
                      <div className="mt-1 leading-5 text-slate-600">{kr.description}</div>
                      <div className="mt-1 text-blue-700">衡量：{kr.metric}</div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">推进：{kr.owner}<br /><span className="text-slate-500">复核：{kr.reviewer ?? project.owner}</span></td>
                    <td className="px-3 py-4 text-slate-600">{project.collaboratorDepartments.join("、")}</td>
                    <td className="px-3 py-4 text-slate-600">{kr.startDate}</td>
                    <td className="px-3 py-4 text-slate-600">{kr.endDate}</td>
                    <td className="px-3 py-4 leading-5 text-slate-600">{kr.targetValue ?? kr.metric}</td>
                    <td className="px-3 py-4"><OkrBadge value={getKrDisplayStatus(kr)} /></td>
                    <td className="px-3 py-4"><OkrBadge value={kr.riskLevel} /></td>
                    <td className="px-3 py-4">
                      <button onClick={() => openKrDetail(kr.id)} className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50">
                        查看
                      </button>
                    </td>
                  </tr>
                  {project.pdcaTasks.filter((task) => task.krId === kr.id).map((task) => (
                    <tr key={task.id} className={`align-top hover:bg-slate-50 ${pdcaStageStyles[task.pdcaStage].row}`}>
                      <td className="px-3 py-4 pl-6 text-slate-600">任务</td>
                      <td className="px-3 py-4"><span className={`rounded-full border px-2.5 py-1 font-semibold ${pdcaStageStyles[task.pdcaStage].badge}`}>{task.pdcaStage}</span></td>
                      <td className="px-3 py-4">
                        <div className="font-semibold text-ink">{task.title}</div>
                        <div className="mt-1 leading-5 text-slate-600">{task.content}</div>
                      </td>
                      <td className="px-3 py-4 text-slate-700">{task.owner}<br /><span className="text-slate-500">{task.ownerDepartment}</span></td>
                      <td className="px-3 py-4 text-slate-600">{task.collaboratorDepartments.join("、")}</td>
                      <td className="px-3 py-4 text-slate-600">{task.startDate}</td>
                      <td className="px-3 py-4 text-slate-600">{task.endDate}</td>
                      <td className="px-3 py-4 leading-5 text-slate-600">{task.deliverable}</td>
                      <td className="px-3 py-4"><OkrBadge value={getPdcaDisplayStatus(task)} /></td>
                      <td className="px-3 py-4"><OkrBadge value={task.riskLevel} /></td>
                      <td className="px-3 py-4">
                        <button onClick={() => openKrDetail(task.krId)} className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50">
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-5">
        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <SectionHeader title="关联会议" description="该 OKR 项目关联的会议和决策" icon={CalendarDays} />
          <div className="mt-4 space-y-3">
            {project.relatedMeetings.map((meeting) => (
              <div key={meeting.id} className="rounded-xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-ink">{meeting.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{meeting.date} · 主持人 {meeting.host}</div>
                  </div>
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{meeting.status}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">决策：{meeting.decision}</p>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500">形成待办 {meeting.todoCount} 项</span>
                  <button onClick={() => onNavigate("meetings")} className="rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">查看会议</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <SectionHeader title="关联待办" description="按 KR 归集项目形成的待办事项" icon={ListChecks} />
          <div className="mt-4 space-y-3">
            {project.relatedTasks.map((task) => {
              const kr = krById.get(task.krId);
              return (
                <div key={task.id} className="rounded-xl border border-line bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink">{task.content}</div>
                      <div className="mt-1 text-sm text-slate-500">来源 {kr?.code ?? "KR"} · {task.sourceMeeting}</div>
                    </div>
                    <OkrBadge value={task.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm text-slate-600">
                    <div>责任人：{task.owner}</div>
                    <div>部门：{task.ownerDepartment}</div>
                    <div>截止：{task.dueDate}</div>
                    <div className="col-span-2">协同：{task.collaboratorDepartments.join("、")}</div>
                    <div><OkrBadge value={task.riskLevel} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader title="风险与卡点" description="高风险 KR、延期任务、阻塞任务、跨部门卡点和总裁协调事项" icon={AlertTriangle} />
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${solidTone.red}`}>{exceptionTasks.length + project.risks.length} 项异常</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {project.risks.map((risk) => {
            const kr = risk.krId ? krById.get(risk.krId) : undefined;
            return (
              <div key={risk.id} className="rounded-xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-ink">{risk.description}</div>
                  <OkrBadge value={risk.riskLevel} />
                </div>
                <div className="mt-3 text-sm leading-6 text-slate-600">所属 KR：{kr ? `${kr.code} ${kr.title}` : "项目级风险"}</div>
                <div className="text-sm leading-6 text-slate-600">关联部门：{risk.departments.join("、")}</div>
                <div className="mt-2 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-600">影响：{risk.impact}</div>
                <div className="mt-2 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-600">建议：{risk.suggestion}</div>
                {risk.needPresidentCoordination && <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${solidTone.amber}`}>需要总裁协调</div>}
              </div>
            );
          })}
          {project.supportRequests.map((request) => (
            <div key={request} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              需要公司支持：{request}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function OkrCreateView({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (project: OkrProject) => void }) {
  const defaultOwnerId = getOkrUserId("美凤", "林美凤");
  const defaultOwnerDepartmentId = getOkrDepartmentId("直营门店", defaultOwnerId);
  const defaultReviewerId = getPresidentUserId();
  const defaultCollaboratorDepartmentIds = ["培训部", "设计部", "售后部"].map((departmentName) => findDepartmentByName(departmentName)?.id).filter((id): id is string => Boolean(id));
  const [name, setName] = useState("新建 OKR 项目：门店交付效率提升");
  const [objective, setObjective] = useState("提升门店从客户需求收集到设计交付的整体效率，减少跨部门信息反复确认。");
  const [background, setBackground] = useState("当前门店、设计、培训和售后之间的信息传递存在重复确认，影响交付效率，需要建立专项 OKR 管理。");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [ownerDepartmentId, setOwnerDepartmentId] = useState(defaultOwnerDepartmentId);
  const [collaboratorDepartmentIds, setCollaboratorDepartmentIds] = useState<string[]>(defaultCollaboratorDepartmentIds);
  const [startDate, setStartDate] = useState("2026-07-01");
  const [endDate, setEndDate] = useState("2026-09-30");
  const [priority, setPriority] = useState<OkrPriority>("中");
  const [draftKrs, setDraftKrs] = useState<OkrKR[]>([
    {
      id: "draft-kr1",
      projectId: "draft",
      code: "KR1",
      title: "建立跨部门交付标准",
      description: "统一门店、设计、售后之间的信息交付口径。",
      metric: "输出并试运行一套跨部门交付标准。",
      targetValue: "1 套标准",
      currentValue: "未开始",
      weight: 50,
      owner: getOkrUserName(defaultOwnerId, "美凤"),
      ownerId: defaultOwnerId,
      department: getOkrDepartmentName(defaultOwnerDepartmentId, "直营门店"),
      departmentId: defaultOwnerDepartmentId,
      reviewer: getOkrUserName(defaultReviewerId, "林昱辰"),
      reviewerId: defaultReviewerId,
      startDate: "2026-07-01",
      endDate: "2026-08-15",
      progress: 0,
      status: "未开始",
      riskLevel: "中"
    }
  ]);
  const [draftTasks, setDraftTasks] = useState<OkrPDCATask[]>([
    {
      id: "draft-task1",
      projectId: "draft",
      krId: "draft-kr1",
      pdcaStage: "Plan",
      title: "梳理交付卡点",
      content: "整理门店到设计交付过程中的反复确认事项。",
      owner: getOkrUserName(defaultOwnerId, "美凤"),
      ownerId: defaultOwnerId,
      ownerDepartment: getOkrDepartmentName(defaultOwnerDepartmentId, "直营门店"),
      ownerDepartmentId: defaultOwnerDepartmentId,
      reviewer: getOkrUserName(defaultReviewerId, "林昱辰"),
      reviewerId: defaultReviewerId,
      collaboratorDepartments: getOkrDepartmentNames(defaultCollaboratorDepartmentIds, ["设计部", "售后部"]),
      collaboratorDepartmentIds: defaultCollaboratorDepartmentIds,
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      deliverable: "交付卡点清单",
      status: "未开始",
      riskLevel: "中"
    }
  ]);

  const addKr = () => {
    const index = draftKrs.length + 1;
    setDraftKrs((items) => [
      ...items,
      {
        id: `draft-kr${index}`,
        projectId: "draft",
        code: `KR${index}`,
        title: "新增 KR",
        description: "填写量化衡量标准",
        metric: "填写量化衡量标准",
        targetValue: "填写目标值",
        currentValue: "未开始",
        weight: 20,
        owner: getOkrUserName(ownerId, "未设置"),
        ownerId,
        department: getOkrDepartmentName(ownerDepartmentId, "未设置部门"),
        departmentId: ownerDepartmentId,
        reviewer: getOkrUserName(defaultReviewerId, "林昱辰"),
        reviewerId: defaultReviewerId,
        startDate,
        endDate,
        progress: 0,
        status: "未开始",
        riskLevel: "中"
      }
    ]);
  };

  const addPdcaTask = () => {
    const targetKr = draftKrs[draftKrs.length - 1];
    const index = draftTasks.length + 1;
    setDraftTasks((items) => [
      ...items,
      {
        id: `draft-task${index}`,
        projectId: "draft",
        krId: targetKr.id,
        pdcaStage: "Do",
        title: "新增 PDCA 任务",
        content: "填写任务内容",
        owner: getOkrUserName(ownerId, "未设置"),
        ownerId,
        ownerDepartment: getOkrDepartmentName(findUser(ownerId)?.departmentId ?? ownerDepartmentId, "未设置部门"),
        ownerDepartmentId: findUser(ownerId)?.departmentId ?? ownerDepartmentId,
        reviewer: getOkrUserName(defaultReviewerId, "林昱辰"),
        reviewerId: defaultReviewerId,
        collaboratorDepartments: getOkrDepartmentNames(collaboratorDepartmentIds),
        collaboratorDepartmentIds,
        startDate,
        endDate,
        deliverable: "填写输出成果",
        status: "未开始",
        riskLevel: "中"
      }
    ]);
  };

  const updateKr = (id: string, patch: Partial<OkrKR>) => {
    setDraftKrs((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const updateTask = (id: string, patch: Partial<OkrPDCATask>) => {
    setDraftTasks((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addCollaborator = (departmentId: string) => {
    if (departmentId === ownerDepartmentId) return;
    setCollaboratorDepartmentIds((current) => (current.includes(departmentId) ? current : [...current, departmentId]));
  };

  const removeCollaborator = (departmentId: string) => {
    setCollaboratorDepartmentIds((current) => current.filter((item) => item !== departmentId));
  };

  const userNameOptions = users.map((user) => ({
    value: user.id,
    label: userOptionLabel(user),
    meta: findDepartment(user.departmentId)?.name,
    searchText: `${user.name} ${user.employeeNo ?? ""} ${user.title} ${findDepartment(user.departmentId)?.name ?? ""}`
  }));
  const departmentNameOptions = realDepartments.map((department) => ({
    value: department.id,
    label: departmentOptionLabel(department),
    meta: department.fullPath,
    searchText: `${department.name} ${department.orgCode ?? ""} ${department.fullPath ?? ""} ${department.orgType ?? ""}`
  }));
  const collaboratorDepartmentOptions = departmentNameOptions.filter(
    (option) => option.value !== ownerDepartmentId && !collaboratorDepartmentIds.includes(option.value)
  );
  const priorityOptions = (["高", "中", "低"] as OkrPriority[]).map((item) => ({ value: item, label: item }));
  const pdcaStageOptions = pdcaStages.map((item) => ({ value: item, label: item }));

  const submit = () => {
    const projectId = `okr-local-${Date.now()}`;
    const krIdMap = new Map(draftKrs.map((kr, index) => [kr.id, `${projectId}-kr${index + 1}`]));
    const krs = draftKrs.map((kr, index) => ({ ...kr, id: krIdMap.get(kr.id) ?? `${projectId}-kr${index + 1}`, projectId }));
    const pdcaTasks = draftTasks.map((task, index) => ({ ...task, id: `${projectId}-pdca${index + 1}`, projectId, krId: krIdMap.get(task.krId) ?? krs[0].id }));
    onSubmit(normalizeOkrProjectIdentity({
      id: projectId,
      name,
      category: "公司专项 OKR",
      objective,
      background,
      owner: getOkrUserName(ownerId, "未设置"),
      ownerId,
      ownerDepartment: getOkrDepartmentName(ownerDepartmentId, "未设置部门"),
      ownerDepartmentId,
      collaboratorDepartments: getOkrDepartmentNames(collaboratorDepartmentIds),
      collaboratorDepartmentIds,
      startDate,
      endDate,
      periodText: `${startDate} - ${endDate}`,
      priority,
      riskLevel: "中",
      status: "待总裁审批",
      progress: 0,
      needPresidentDecisionCount: 1,
      krs,
      pdcaTasks,
      metrics: [{ label: "项目综合进度", base: "未开始", target: "按期完成", current: "待总裁审批", status: "未开始" }],
      relatedMeetings: [],
      relatedTasks: [],
      risks: [],
      supportRequests: []
    }));
  };

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <section className="rounded-xl border border-line bg-white p-6 shadow-panel">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="text-xs font-semibold text-brand">新建 OKR 项目</div>
            <h2 className="mt-1 text-2xl font-semibold text-ink">创建公司级专项改进项目</h2>
          </div>
          <button onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回总览</button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <SectionHeader title="1. 项目基础信息" icon={Target} />
        <div className="mt-5 grid grid-cols-4 gap-4">
          <Field label="OKR 项目名称"><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field>
          <Field label="项目负责人">
            <SearchableSelect
              value={ownerId}
              onChange={(value) => {
                setOwnerId(value);
                const nextDepartmentId = findUser(value)?.departmentId;
                if (nextDepartmentId) setOwnerDepartmentId(nextDepartmentId);
              }}
              options={userNameOptions}
              placeholder="输入项目负责人"
            />
          </Field>
          <Field label="主责部门">
            <SearchableSelect value={ownerDepartmentId} onChange={setOwnerDepartmentId} options={departmentNameOptions} placeholder="输入主责部门" />
          </Field>
          <Field label="优先级">
            <SearchableSelect value={priority} onChange={(value) => setPriority(value as OkrPriority)} options={priorityOptions} placeholder="输入优先级" />
          </Field>
          <div className="col-span-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                项目总目标 O
                <span className="ml-2 text-xs font-normal text-slate-500">必须量化、可测量，避免只写感性描述。</span>
              </span>
              <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
          </div>
          <div className="col-span-2"><Field label="项目背景"><textarea value={background} onChange={(event) => setBackground(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
          <div className="col-span-2">
            <Field label="协同部门">
              <div className="rounded-lg border border-line bg-white p-2">
                <SearchableSelect
                  value=""
                  onChange={addCollaborator}
                  options={collaboratorDepartmentOptions}
                  placeholder={collaboratorDepartmentOptions.length ? "搜索并选择协同部门" : "可选协同部门已全部加入"}
                  disabled={!collaboratorDepartmentOptions.length}
                />
                <div className="mt-3">
                  <div className="mb-2 text-xs font-medium text-slate-500">已选协同部门</div>
                  <div className="flex flex-wrap gap-2">
                    {collaboratorDepartmentIds.length ? (
                      collaboratorDepartmentIds.map((departmentId) => (
                        <span key={departmentId} className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                          {getOkrDepartmentName(departmentId)}
                          <button type="button" onClick={() => removeCollaborator(departmentId)} className="text-blue-500 hover:text-blue-800">
                            ×
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">暂未选择协同部门</span>
                    )}
                  </div>
                </div>
              </div>
            </Field>
          </div>
          <Field label="开始时间"><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field>
          <Field label="结束时间"><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <SectionHeader title="2. KR 添加区" icon={Target} />
          <button onClick={addKr} className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">新增 KR</button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs leading-5 text-slate-600">
          <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
            <span className="font-semibold text-ink">KR 编号</span> 由系统自动生成，不建议手动改号。
          </div>
          <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
            <span className="font-semibold text-ink">量化衡量标准</span> 用来说明这个 KR 怎么判断完成。
          </div>
          <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
            <span className="font-semibold text-ink">权重</span> 用于项目综合进度测算，第一版先由负责人手动设定。
          </div>
        </div>
        <div className="mt-5 space-y-4">
          {draftKrs.map((kr) => (
            <div key={kr.id} className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="grid grid-cols-12 gap-3">
                <Field label="KR 编号"><input value={kr.code} readOnly className="w-full rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-slate-500 outline-none" /></Field>
                <div className="col-span-5"><Field label="KR 名称"><input value={kr.title} onChange={(event) => updateKr(kr.id, { title: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <div className="col-span-3">
                  <Field label="KR 推进人">
                    <SearchableSelect
                      value={kr.ownerId ?? getOkrUserId(kr.owner, getOkrUserName(ownerId))}
                      onChange={(value) => {
                        const nextDepartmentId = findUser(value)?.departmentId ?? kr.departmentId;
                        updateKr(kr.id, {
                          ownerId: value,
                          owner: getOkrUserName(value, kr.owner),
                          departmentId: nextDepartmentId,
                          department: getOkrDepartmentName(nextDepartmentId, kr.department)
                        });
                      }}
                      options={userNameOptions}
                      placeholder="输入推进人"
                    />
                  </Field>
                </div>
                <div className="col-span-3">
                  <Field label="KR 复核人">
                    <SearchableSelect
                      value={kr.reviewerId ?? defaultReviewerId}
                      onChange={(value) => updateKr(kr.id, { reviewerId: value, reviewer: getOkrUserName(value, kr.reviewer ?? "林昱辰") })}
                      options={userNameOptions}
                      placeholder="输入复核人"
                    />
                  </Field>
                </div>
                <div className="col-span-12">
                  <Field label="量化衡量标准">
                    <input value={kr.metric} onChange={(event) => updateKr(kr.id, { metric: event.target.value, description: event.target.value })} placeholder="例如：下单准确率提升到 90%，或输出 4 套标准文件并完成门店覆盖" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
                  </Field>
                </div>
                <div className="col-span-3"><Field label="目标值"><input value={kr.targetValue ?? ""} onChange={(event) => updateKr(kr.id, { targetValue: event.target.value })} placeholder="完成后要达到的结果" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <div className="col-span-3"><Field label="当前值"><input value={kr.currentValue ?? ""} onChange={(event) => updateKr(kr.id, { currentValue: event.target.value })} placeholder="当前进度或现状" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <div className="col-span-2"><Field label="权重"><input type="number" value={kr.weight} onChange={(event) => updateKr(kr.id, { weight: Number(event.target.value) })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <div className="col-span-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                  当前归档状态：<span className="font-semibold text-blue-700">{kr.status}</span>。推进人提交完成后，复核人确认前不会计入已完成 KR。
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <SectionHeader title="3. PDCA 任务添加区" description="每条任务挂到所属 KR，并选择 Plan / Do / Check / Act 阶段" icon={ClipboardList} />
          <button onClick={addPdcaTask} className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">新增 PDCA 任务</button>
        </div>
        <div className="mt-5 space-y-3">
          {draftTasks.map((task) => (
            <div key={task.id} className={`rounded-xl border p-4 ${pdcaStageStyles[task.pdcaStage].row}`}>
              <div className="grid grid-cols-6 gap-3">
                <Field label="所属 KR">
                  <SearchableSelect
                    value={task.krId}
                    onChange={(value) => updateTask(task.id, { krId: value })}
                    options={draftKrs.map((kr) => ({ value: kr.id, label: `${kr.code} ${kr.title}`, meta: getOkrUserName(kr.ownerId, kr.owner) }))}
                    placeholder="输入 KR"
                  />
                </Field>
                <Field label="PDCA 阶段">
                  <SearchableSelect value={task.pdcaStage} onChange={(value) => updateTask(task.id, { pdcaStage: value as OkrPdcaStage })} options={pdcaStageOptions} placeholder="输入阶段" />
                </Field>
                <div className="col-span-2"><Field label="任务名称"><input value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <Field label="推进人">
                  <SearchableSelect
                    value={task.ownerId ?? getOkrUserId(task.owner, getOkrUserName(ownerId))}
                    onChange={(nextOwner) => {
                      const nextDepartmentId = findUser(nextOwner)?.departmentId ?? task.ownerDepartmentId;
                      updateTask(task.id, {
                        ownerId: nextOwner,
                        owner: getOkrUserName(nextOwner, task.owner),
                        ownerDepartmentId: nextDepartmentId,
                        ownerDepartment: getOkrDepartmentName(nextDepartmentId, task.ownerDepartment)
                      });
                    }}
                    options={userNameOptions}
                    placeholder="输入推进人"
                  />
                </Field>
                <Field label="复核人">
                  <SearchableSelect
                    value={task.reviewerId ?? defaultReviewerId}
                    onChange={(value) => updateTask(task.id, { reviewerId: value, reviewer: getOkrUserName(value, task.reviewer ?? "林昱辰") })}
                    options={userNameOptions}
                    placeholder="输入复核人"
                  />
                </Field>
                <div className="col-span-2"><Field label="任务内容"><input value={task.content} onChange={(event) => updateTask(task.id, { content: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <Field label="计划开始"><input type="date" value={task.startDate} onChange={(event) => updateTask(task.id, { startDate: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field>
                <Field label="计划结束"><input type="date" value={task.endDate} onChange={(event) => updateTask(task.id, { endDate: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field>
                <div className="col-span-2"><Field label="输出成果"><input value={task.deliverable} onChange={(event) => updateTask(task.id, { deliverable: event.target.value })} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" /></Field></div>
                <div className="col-span-6 rounded-lg border border-line bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                  归属部门自动跟随推进人：<span className="font-semibold text-ink">{getOkrDepartmentName(task.ownerDepartmentId, task.ownerDepartment)}</span>。推进人提交完成后，由复核人 <span className="font-semibold text-blue-700">{getOkrUserName(task.reviewerId, task.reviewer ?? "林昱辰")}</span> 确认后才算完成。
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-slate-600">提交后项目状态变为“待总裁审批”，并出现在 OKR 项目总览页。</div>
          <button onClick={submit} className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            <CheckCircle2 size={16} />
            提交总裁审批
          </button>
        </div>
      </section>
    </div>
  );
}

function OkrKpiCard({
  label,
  value,
  tone,
  active,
  onClick
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "red" | "amber" | "slate";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    green: solidFill.green,
    red: solidFill.red,
    amber: solidFill.amber,
    slate: "bg-slate-50 text-slate-700"
  }[tone];
  const className = `rounded-xl border bg-white p-4 text-left shadow-panel transition ${onClick ? "cursor-pointer hover:border-blue-200 hover:bg-slate-50" : ""} ${active ? "border-brand ring-2 ring-blue-100" : "border-line"}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className={`mt-3 inline-flex rounded-lg px-3 py-2 text-xl font-semibold ${toneClass}`}>{value}</div>
      </button>
    );
  }
  return (
    <div className={className}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-3 inline-flex rounded-lg px-3 py-2 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function OkrMiniStat({
  label,
  value,
  tone,
  active,
  onClick
}: {
  label: string;
  value: string | number;
  tone: "blue" | "green" | "red" | "amber" | "slate";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    green: solidFill.green,
    red: solidFill.red,
    amber: solidFill.amber,
    slate: "bg-slate-50 text-slate-700"
  }[tone];
  const className = `rounded-lg px-2 py-2 text-center transition ${toneClass} ${onClick ? "cursor-pointer hover:ring-2 hover:ring-blue-100" : ""} ${active ? "ring-2 ring-brand ring-offset-1" : ""}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <div className="text-base font-semibold">{value}</div>
        <div className="text-[11px] font-medium">{label}</div>
      </button>
    );
  }
  return (
    <div className={className}>
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] font-medium">{label}</div>
    </div>
  );
}

function TaskTable({
  tasks,
  meetings,
  currentUserId,
  focusTaskId,
  onNavigate,
  onUpdateTaskStatus,
  onUpdateTaskCompletionItems,
  onCanDeleteTask,
  onDeleteTask
}: {
  tasks: Task[];
  meetings: Meeting[];
  currentUserId: string;
  focusTaskId?: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateTaskCompletionItems: (taskId: string, completionItems: string[]) => void;
  onCanDeleteTask: (task: Task) => boolean;
  onDeleteTask: (task: Task) => void;
}) {
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [completionRows, setCompletionRows] = useState<string[]>([]);
  const [completionRequiredTask, setCompletionRequiredTask] = useState<Task | null>(null);
  const [progressTask, setProgressTask] = useState<Task | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<Task | null>(null);

  const openCompletionEditor = (task: Task) => {
    const existingRows = task.completionItems?.length ? task.completionItems : ["", "", ""];
    setCompletionTask(task);
    setCompletionRows(existingRows.length >= 3 ? existingRows : [...existingRows, ...Array.from({ length: 3 - existingRows.length }, () => "")]);
  };
  const closeCompletionEditor = () => {
    setCompletionTask(null);
    setCompletionRows([]);
  };
  const updateCompletionRow = (index: number, value: string) => {
    setCompletionRows((currentRows) => currentRows.map((row, rowIndex) => (rowIndex === index ? value : row)));
  };
  const resizeCompletionTextarea = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };
  const addCompletionRow = () => {
    setCompletionRows((currentRows) => [...currentRows, ""]);
  };
  const removeCompletionRow = (index: number) => {
    setCompletionRows((currentRows) => (currentRows.length > 1 ? currentRows.filter((_, rowIndex) => rowIndex !== index) : currentRows));
  };
  const saveCompletionRows = () => {
    if (!completionTask) return;
    onUpdateTaskCompletionItems(completionTask.id, completionRows);
    closeCompletionEditor();
  };

  if (!tasks.length) return <EmptyState text="暂无待办事项" />;
  const sortedTasks = sortTasksByCreatedAtDesc(tasks);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-[1380px] divide-y divide-line text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-3 py-3">待办事项</th>
              <th className="w-28 px-3 py-3">任务进度</th>
              <th className="px-3 py-3">来源</th>
              <th className="px-3 py-3">创建时间</th>
              <th className="px-3 py-3">待办推进人</th>
              <th className="px-3 py-3">复核人</th>
              <th className="px-3 py-3">部门</th>
              <th className="px-3 py-3">截止日期</th>
              <th className="px-3 py-3">优先级</th>
              <th className="px-3 py-3">状态</th>
              <th className="px-3 py-3">操作</th>
              <th className="px-3 py-3">更新</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sortedTasks.map((task) => {
              const meeting = findMeeting(meetings, task.meetingId) ?? seedMeetings.find((item) => item.id === task.meetingId);
              const isFocused = task.id === focusTaskId;
              const canEditTask = getTaskOwnerId(task) === currentUserId;
              const canDeleteTask = onCanDeleteTask(task);
              const progressEntries = getTaskProgressEntries(task);
              return (
                <tr key={task.id} className={`align-top hover:bg-slate-50 ${isFocused ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}>
                  <td className="max-w-sm px-3 py-4">
                    <div className="font-medium text-ink">{getTaskContent(task)}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{getTaskDescription(task)}</div>
                    {task.reviewRejectedReason ? (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                        <div className="font-semibold">复核驳回原因</div>
                        {task.reviewRejectedItems?.length ? (
                          <div className="mt-1 space-y-1">
                            {task.reviewRejectedItems.map((item, index) => (
                              <div key={`task-review-reject-${task.id}-${index}`}>{index + 1}. {item}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1">{task.reviewRejectedReason}</div>
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td className="w-28 px-3 py-4">
                    <button
                      type="button"
                      onClick={() => setProgressTask(task)}
                      className="app-action-pill min-w-[5.5rem] whitespace-nowrap px-3 py-1.5 text-sm"
                    >
                      查看进度
                    </button>
                    <div className="mt-1 text-xs text-slate-500">{progressEntries.length ? `${progressEntries.length} 次` : "暂无进度"}</div>
                  </td>
                  <td className="max-w-xs px-3 py-4">
                    {meeting ? (
                      <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="text-left text-brand hover:text-blue-800">
                        {meeting.title}
                      </button>
                    ) : (
                      <span className="text-slate-600">{getTaskSourceTitle(task, meetings)}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-600">{formatTaskCreatedAt(task)}</td>
                  <td className="px-3 py-4 text-slate-600">{findUser(getTaskOwnerId(task))?.name}</td>
                  <td className="px-3 py-4 text-slate-600">
                    <div>{findUser(getTaskReviewerId(task, meeting))?.name}</div>
                    {getTaskOwnerId(task) === getTaskReviewerId(task, meeting) ? (
                      <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${solidTone.amber}`}>同人复核</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-4 text-slate-600">{findDepartment(getTaskDepartmentId(task))?.name}</td>
                  <td className="px-3 py-4 text-slate-600">{task.dueDate}</td>
                  <td className="px-3 py-4">
                    <PriorityBadge priority={task.priority} />
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-col gap-1.5">
                      <TaskApprovalBadge task={task} />
                      <StatusBadge task={task} />
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-col items-start gap-2">
                      {canEditTask ? (
                        <button
                          type="button"
                          onClick={() => openCompletionEditor(task)}
                          className="app-action-pill min-w-[5.5rem] whitespace-nowrap px-3 py-1.5 text-sm"
                        >
                          任务填写
                        </button>
                      ) : (
                        <span className="inline-flex rounded-lg border border-line bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-600">只读</span>
                      )}
                      {task.completionItems?.length ? <div className="text-xs text-slate-500">{task.completionItems.length} 条</div> : null}
                      {canDeleteTask ? (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteTask(task)}
                          className="inline-flex min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100"
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <TaskStatusControl task={task} canEdit={canEditTask} onUpdateTaskStatus={onUpdateTaskStatus} onRequireTaskCompletion={setCompletionRequiredTask} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {completionTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink">任务填写</h3>
                <p className="mt-1 text-sm text-slate-500">{getTaskContent(completionTask)}</p>
              </div>
              <button type="button" onClick={closeCompletionEditor} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {completionRows.map((row, index) => (
                <div key={`completion-row-${index}`} className="grid grid-cols-[2.7rem_minmax(0,1fr)_4.5rem] items-start gap-2">
                  <div className="app-action-pill min-h-9 min-w-9 px-3 py-2 text-sm">{index + 1}</div>
                  <textarea
                    ref={(element) => {
                      if (element) resizeCompletionTextarea(element);
                    }}
                    value={row}
                    rows={1}
                    onInput={(event) => resizeCompletionTextarea(event.currentTarget)}
                    onChange={(event) => updateCompletionRow(index, event.target.value)}
                    className="min-h-9 resize-none overflow-hidden rounded-lg border border-line px-3 py-2 text-sm leading-5 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                    placeholder="输入完成内容"
                  />
                  <button
                    type="button"
                    onClick={() => removeCompletionRow(index)}
                    disabled={completionRows.length <= 1}
                    className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    减行
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={addCompletionRow} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                加行
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={closeCompletionEditor} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                  取消
                </button>
                <button type="button" onClick={saveCompletionRows} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {completionRequiredTask ? (
        <TaskCompletionRequiredDialog
          task={completionRequiredTask}
          onClose={() => setCompletionRequiredTask(null)}
          onFillTask={(task) => {
            setCompletionRequiredTask(null);
            openCompletionEditor(task);
          }}
        />
      ) : null}
      {pendingDeleteTask ? (
        <DeleteTaskConfirmDialog
          task={pendingDeleteTask}
          onCancel={() => setPendingDeleteTask(null)}
          onConfirm={() => {
            onDeleteTask(pendingDeleteTask);
            setPendingDeleteTask(null);
          }}
        />
      ) : null}
      {progressTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink">任务进度</h3>
                <p className="mt-1 text-sm text-slate-500">{getTaskContent(progressTask)}</p>
              </div>
              <button type="button" onClick={() => setProgressTask(null)} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {getTaskProgressEntries(progressTask).length ? (
                getTaskProgressEntries(progressTask).map((entry, entryIndex) => (
                  <div key={entry.id} className="rounded-xl border border-line bg-white p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-ink">第 {entryIndex + 1} 次提交</span>
                      <span>{entry.submittedAt}</span>
                      <span>{getReviewTargetLabel(entry.targetStatus ?? "completed")}复核</span>
                    </div>
                    <div className="space-y-2">
                      {entry.items.map((item, itemIndex) => (
                        <div key={`${entry.id}-${itemIndex}`} className="grid grid-cols-[2.7rem_minmax(0,1fr)] items-start gap-2">
                          <div className="app-action-pill min-h-9 min-w-9 px-3 py-2 text-sm">{itemIndex + 1}</div>
                          <div className="min-h-9 whitespace-pre-wrap break-words rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-700">{item}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前还没有填写任务进度" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DeleteTaskConfirmDialog({
  task,
  onCancel,
  onConfirm
}: {
  task: Task;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
            <Trash2 size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">确认删除待办？</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">删除后，该待办不会再出现在总台账、我的待办和部门看板中。</p>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-3 text-sm leading-6 text-red-800">
          <div className="font-semibold">{getTaskContent(task)}</div>
          <div className="mt-1">截止日期：{task.dueDate} · 状态：{getTaskStatusLabel(task.status)}</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            取消
          </button>
          <button type="button" onClick={onConfirm} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
            <Trash2 size={15} />
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskCompletionRequiredDialog({
  task,
  onClose,
  onFillTask
}: {
  task: Task;
  onClose: () => void;
  onFillTask?: (task: Task) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-ink">需要先填写任务内容</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">请先点击“任务填写”，填写完成内容后再提交复核。</p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${solidTone.amber}`}>未填写</span>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">{getTaskContent(task)}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
            关闭
          </button>
          {onFillTask ? (
            <button type="button" onClick={() => onFillTask(task)} className="app-action-pill px-4 py-2 text-sm">
              去任务填写
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TaskStatusControl({
  task,
  canEdit,
  onUpdateTaskStatus,
  onRequireTaskCompletion
}: {
  task: Task;
  canEdit: boolean;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onRequireTaskCompletion: (task: Task) => void;
}) {
  const selectableStatuses: TaskStatus[] = ["in_progress", "completed", "blocked"];
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus>(selectableStatuses.includes(getSelectTaskStatus(task.status)) ? getSelectTaskStatus(task.status) : "in_progress");
  useEffect(() => {
    if (task.status === "pending_review" || isTaskCompleted(task)) return;
    setSelectedStatus(selectableStatuses.includes(getSelectTaskStatus(task.status)) ? getSelectTaskStatus(task.status) : "in_progress");
  }, [task.status]);
  const submitReview = () => {
    if (!hasTaskCompletionItems(task)) {
      onRequireTaskCompletion(task);
      return;
    }
    onUpdateTaskStatus(task.id, selectedStatus);
  };
  if (isTaskCompleted(task)) {
    return <span className={`inline-flex rounded-lg border px-3 py-1.5 text-sm font-semibold ${solidTone.green}`}>已完成</span>;
  }
  if (task.status === "pending_review") {
    const reviewTargetLabel = getReviewTargetLabel(task.reviewTargetStatus ?? "completed");
    return <span className={`inline-flex rounded-lg border px-3 py-1.5 text-sm font-semibold ${solidTone.amber}`}>等待{reviewTargetLabel}复核</span>;
  }
  if (!canEdit) {
    return <span className={`inline-flex rounded-lg border px-3 py-1.5 text-sm font-semibold ${getReadOnlyTaskStatusTone(task.status)}`}>{getTaskStatusLabel(task.status)}</span>;
  }
  return (
    <div className="flex min-w-[180px] flex-wrap items-center gap-2">
      <div className="w-36">
        <SearchableSelect
        value={selectedStatus}
        onChange={(value) => setSelectedStatus(value as TaskStatus)}
        options={selectableStatuses.map((status) => ({ value: status, label: getTaskStatusLabel(status) }))}
        placeholder="输入状态"
      />
      </div>
      <button
        type="button"
        onClick={submitReview}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        提交复核
      </button>
    </div>
  );
}

function DepartmentTaskCards({
  tasks,
  meetings,
  currentUserId,
  onNavigate,
  onUpdateTaskStatus,
  onCanDeleteTask,
  onDeleteTask
}: {
  tasks: Task[];
  meetings: Meeting[];
  currentUserId: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onCanDeleteTask: (task: Task) => boolean;
  onDeleteTask: (task: Task) => void;
}) {
  const [completionRequiredTask, setCompletionRequiredTask] = useState<Task | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<Task | null>(null);

  if (!tasks.length) return <EmptyState text="当前部门暂无待办" />;

  const sortedTasks = sortTasksByCreatedAtDesc(tasks);

  return (
    <>
      <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
        {sortedTasks.map((task) => {
          const meeting = findMeeting(meetings, task.meetingId) ?? seedMeetings.find((item) => item.id === task.meetingId);
          const owner = findUser(getTaskOwnerId(task))?.name ?? "未设置";
          const reviewer = findUser(getTaskReviewerId(task, meeting))?.name ?? "未设置";
          const isLate = isOverdue(task);
          const dayDiff = daysFromToday(task.dueDate);
          const canEditTask = getTaskOwnerId(task) === currentUserId;
          const canDeleteTask = onCanDeleteTask(task);

          return (
            <div key={task.id} className={`rounded-xl border p-3 ${isLate ? "border-red-200 bg-red-50/50" : "border-line bg-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold leading-6 text-ink">{getTaskContent(task)}</div>
                    <PriorityBadge priority={task.priority} />
                    <TaskApprovalBadge task={task} />
                    <StatusBadge task={task} />
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{getTaskDescription(task)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <TaskStatusControl task={task} canEdit={canEditTask} onUpdateTaskStatus={onUpdateTaskStatus} onRequireTaskCompletion={setCompletionRequiredTask} />
                  {canDeleteTask ? (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteTask(task)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_1fr_1.2fr] gap-2 text-xs">
                <InfoPill label="创建时间" value={formatTaskCreatedAt(task)} />
                <InfoPill label="待办推进人" value={owner} />
                <InfoPill label="复核人" value={reviewer} />
                <InfoPill label="截止日期" value={task.dueDate} tone={isLate ? "red" : dayDiff <= 3 ? "amber" : "slate"} helper={isLate ? `逾期 ${Math.abs(dayDiff)} 天` : dayDiff === 0 ? "今天到期" : `剩余 ${dayDiff} 天`} />
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-slate-500">来源</div>
                  {meeting ? (
                    <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="mt-1 block max-w-full truncate font-semibold text-brand hover:text-blue-800">
                      {meeting.title}
                    </button>
                  ) : (
                    <div className="mt-1 truncate font-semibold text-slate-600">{getTaskSourceTitle(task, meetings)}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {completionRequiredTask ? <TaskCompletionRequiredDialog task={completionRequiredTask} onClose={() => setCompletionRequiredTask(null)} /> : null}
      {pendingDeleteTask ? (
        <DeleteTaskConfirmDialog
          task={pendingDeleteTask}
          onCancel={() => setPendingDeleteTask(null)}
          onConfirm={() => {
            onDeleteTask(pendingDeleteTask);
            setPendingDeleteTask(null);
          }}
        />
      ) : null}
    </>
  );
}

function ReviewTrackingCards({
  tasks,
  meetings,
  onNavigate,
  onConfirmTaskReview,
  onRejectTaskReview
}: {
  tasks: Task[];
  meetings: Meeting[];
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onConfirmTaskReview?: (taskId: string) => void;
  onRejectTaskReview?: (taskId: string, reasonItems: string[]) => void;
}) {
  const [contentTask, setContentTask] = useState<Task | null>(null);
  const [rejectTask, setRejectTask] = useState<Task | null>(null);
  const [rejectRows, setRejectRows] = useState<string[]>(["", "", ""]);

  const resizeTextarea = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };
  const openRejectDialog = (task: Task) => {
    setRejectTask(task);
    setRejectRows(["", "", ""]);
  };
  const closeRejectDialog = () => {
    setRejectTask(null);
    setRejectRows(["", "", ""]);
  };
  const updateRejectRow = (index: number, value: string) => {
    setRejectRows((currentRows) => currentRows.map((row, rowIndex) => (rowIndex === index ? value : row)));
  };
  const addRejectRow = () => {
    setRejectRows((currentRows) => [...currentRows, ""]);
  };
  const removeRejectRow = (index: number) => {
    setRejectRows((currentRows) => (currentRows.length > 1 ? currentRows.filter((_, rowIndex) => rowIndex !== index) : currentRows));
  };
  const submitReject = () => {
    if (!rejectTask || !onRejectTaskReview) return;
    onRejectTaskReview(rejectTask.id, rejectRows);
    closeRejectDialog();
  };

  if (!tasks.length) return null;
  const sortedTasks = sortTasksByCreatedAtDesc(tasks);

  return (
    <>
      <div className="space-y-3">
        {sortedTasks.map((task) => {
          const meeting = findMeeting(meetings, task.meetingId);
          const owner = findUser(getTaskOwnerId(task))?.name ?? "未设置";
          const completionCount = task.completionItems?.length ?? 0;
          const dayDiff = daysFromToday(task.dueDate);
          const dueTone = dayDiff < 0 ? "red" : dayDiff <= 3 ? "amber" : "slate";
          const dueHelper = dayDiff < 0 ? `逾期 ${Math.abs(dayDiff)} 天` : dayDiff === 0 ? "今天到期" : `剩余 ${dayDiff} 天`;

          return (
            <div key={task.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold leading-6 text-ink">{getTaskContent(task)}</div>
                    <StatusBadge task={task} />
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">{getTaskSourceTitle(task, meetings)}</div>
                </div>
                <PriorityBadge priority={task.priority} />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                <InfoPill label="创建时间" value={formatTaskCreatedAt(task)} />
                <InfoPill label="推进人" value={owner} />
                <InfoPill label="提交内容" value={completionCount ? `${completionCount} 条` : "未填写"} helper={completionCount ? "点击查看内容" : undefined} onClick={() => setContentTask(task)} />
                <InfoPill label="截止日期" value={task.dueDate} tone={dueTone} helper={dueHelper} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setContentTask(task)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  查看内容
                </button>
                {meeting ? (
                  <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    查看会议纪要
                  </button>
                ) : null}
                {onConfirmTaskReview ? (
                  <button onClick={() => onConfirmTaskReview(task.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                    确认{getReviewTargetLabel(task.reviewTargetStatus ?? "completed")}
                  </button>
                ) : null}
                {onRejectTaskReview ? (
                  <button onClick={() => openRejectDialog(task)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                    驳回任务
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {contentTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink">提交的任务填写内容</h3>
                <p className="mt-1 text-sm text-slate-500">{getTaskContent(contentTask)}</p>
              </div>
              <button type="button" onClick={() => setContentTask(null)} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {contentTask.completionItems?.length ? (
                contentTask.completionItems.map((item, index) => (
                  <div key={`submitted-content-${index}`} className="grid grid-cols-[2.7rem_minmax(0,1fr)] items-start gap-2">
                    <div className="app-action-pill min-h-9 min-w-9 px-3 py-2 text-sm">{index + 1}</div>
                    <div className="min-h-9 whitespace-pre-wrap break-words rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-700">{item}</div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前没有提交的任务填写内容" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {rejectTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink">驳回任务</h3>
                <p className="mt-1 text-sm text-slate-500">{getTaskContent(rejectTask)}</p>
              </div>
              <button type="button" onClick={closeRejectDialog} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {rejectRows.map((row, index) => (
                <div key={`review-reject-row-${index}`} className="grid grid-cols-[2.7rem_minmax(0,1fr)_4.5rem] items-start gap-2">
                  <div className="app-action-pill min-h-9 min-w-9 px-3 py-2 text-sm">{index + 1}</div>
                  <textarea
                    ref={(element) => {
                      if (element) resizeTextarea(element);
                    }}
                    value={row}
                    rows={1}
                    onInput={(event) => resizeTextarea(event.currentTarget)}
                    onChange={(event) => updateRejectRow(index, event.target.value)}
                    className="min-h-9 resize-none overflow-hidden rounded-lg border border-line px-3 py-2 text-sm leading-5 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                    placeholder="输入驳回原因"
                  />
                  <button
                    type="button"
                    onClick={() => removeRejectRow(index)}
                    disabled={rejectRows.length <= 1}
                    className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    减行
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={addRejectRow} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                加行
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={closeRejectDialog} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                  取消
                </button>
                <button type="button" onClick={submitReject} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                  提交驳回
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PendingApprovalReviewCards({
  tasks,
  meetings,
  focusTaskId,
  onNavigate,
  onApproveTask,
  onRejectTask
}: {
  tasks: Task[];
  meetings: Meeting[];
  focusTaskId?: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onApproveTask: (taskId: string) => void;
  onRejectTask: (taskId: string, reason?: string) => void;
}) {
  if (!tasks.length) return null;
  const sortedTasks = sortTasksByCreatedAtDesc(tasks);

  return (
    <div className="space-y-3">
      {sortedTasks.map((task) => {
        const meeting = findMeeting(meetings, task.meetingId);
        const owner = findUser(getTaskOwnerId(task))?.name ?? "未设置";
        const reviewer = findUser(getTaskReviewerId(task, meeting))?.name ?? "未设置";
        const department = findDepartment(getTaskDepartmentId(task))?.name ?? "未设置部门";
        const isFocused = task.id === focusTaskId;

        return (
          <div key={`pending-approval-${task.id}`} className={`rounded-xl border bg-white p-4 ${isFocused ? "border-orange-300 ring-2 ring-orange-100" : "border-amber-100"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${solidTone.amber}`}>待签批</span>
                  <div className="text-sm font-semibold leading-6 text-ink">{getTaskContent(task)}</div>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-500">
                  来源会议：{meeting?.title ?? "未知会议"} · 责任部门：{department}
                </div>
              </div>
              <PriorityBadge priority={task.priority} />
            </div>

            <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
              <InfoPill label="创建时间" value={formatTaskCreatedAt(task)} />
              <InfoPill label="推进人" value={owner} />
              <InfoPill label="复核人" value={reviewer} />
              <InfoPill label="开始时间" value={task.startDate || "未填写"} />
              <InfoPill label="截止时间" value={task.dueDate} />
            </div>

            {task.goal ? <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">目标：{task.goal}</div> : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {meeting ? (
                <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  查看来源会议
                </button>
              ) : null}
              <button onClick={() => onApproveTask(task.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                签批通过
              </button>
              <button onClick={() => onRejectTask(task.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                驳回修改
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompanySupportReviewCards({
  tasks,
  meetings,
  onNavigate,
  onCompleteCompanySupport
}: {
  tasks: Task[];
  meetings: Meeting[];
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onCompleteCompanySupport: (taskId: string) => void;
}) {
  if (!tasks.length) return null;
  const sortedTasks = sortTasksByCreatedAtDesc(tasks);

  return (
    <div className="space-y-3">
      {sortedTasks.map((task) => {
        const meeting = findMeeting(meetings, task.meetingId);
        const owner = findUser(getTaskOwnerId(task))?.name ?? "未设置";
        const department = findDepartment(getTaskDepartmentId(task))?.name ?? "未设置部门";
        return (
          <div key={`support-${task.id}`} className="rounded-xl border border-blue-100 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-blue-700">需要公司支持</div>
                <div className="mt-1 text-sm font-semibold leading-6 text-ink">{task.companySupportRequest}</div>
                <div className="mt-2 text-xs leading-5 text-slate-500">
                  创建时间：{formatTaskCreatedAt(task)} · 来源待办：{getTaskContent(task)} · 推进人：{owner} · 责任部门：{department}
                </div>
              </div>
              <PriorityBadge priority={task.priority} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {meeting ? (
                <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  查看来源会议
                </button>
              ) : null}
              <button onClick={() => onCompleteCompanySupport(task.id)} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800">
                标记支持完成
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InfoPill({
  label,
  value,
  helper,
  tone = "slate",
  onClick
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "slate" | "red" | "amber";
  onClick?: () => void;
}) {
  const toneMap = {
    slate: "bg-slate-50 text-slate-700",
    red: `border ${solidTone.red}`,
    amber: "border border-amber-200 bg-amber-50 text-amber-950"
  };
  const labelClass = tone === "slate" ? "text-slate-500" : tone === "amber" ? "text-amber-800" : "text-white/80";
  const className = `rounded-lg px-3 py-2 text-left ${toneMap[tone]} ${onClick ? "w-full cursor-pointer transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-100" : ""}`;
  const content = (
    <>
      <div className={labelClass}>{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {helper ? <div className="mt-0.5 text-[11px] opacity-80">{helper}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return (
    <div className={className}>{content}</div>
  );
}

function TaskCompactRow({
  task,
  meetings,
  currentUserId,
  onNavigate,
  onUpdateTaskStatus
}: {
  task: Task;
  meetings: Meeting[];
  currentUserId: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
}) {
  const meeting = findMeeting(meetings, task.meetingId);
  const canEditTask = getTaskOwnerId(task) === currentUserId;
  const [completionRequiredTask, setCompletionRequiredTask] = useState<Task | null>(null);
  const submitReview = () => {
    if (!hasTaskCompletionItems(task)) {
      setCompletionRequiredTask(task);
      return;
    }
    onUpdateTaskStatus(task.id, "completed");
  };
  return (
    <>
      <div className="rounded-lg border border-line p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-ink">{getTaskContent(task)}</div>
            <div className="mt-1 text-sm text-slate-500">
              {findUser(getTaskOwnerId(task))?.name} · {findDepartment(getTaskDepartmentId(task))?.name} · {task.dueDate}
            </div>
          </div>
          <StatusBadge task={task} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {meeting && (
            <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              来源会议
            </button>
          )}
          {canEditTask ? (
            <button onClick={submitReview} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
              提交复核
            </button>
          ) : null}
        </div>
      </div>
      {completionRequiredTask ? <TaskCompletionRequiredDialog task={completionRequiredTask} onClose={() => setCompletionRequiredTask(null)} /> : null}
    </>
  );
}

function CompanyAttentionTaskCard({
  task,
  meetings,
  currentUserId,
  onNavigate,
  onUpdateTaskStatus
}: {
  task: Task;
  meetings: Meeting[];
  currentUserId: string;
  onNavigate: (page: PageKey, meetingId?: string) => void;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
}) {
  const meeting = findMeeting(meetings, task.meetingId);
  const canEditTask = getTaskOwnerId(task) === currentUserId;
  const [completionRequiredTask, setCompletionRequiredTask] = useState<Task | null>(null);
  const dayDiff = daysFromToday(task.dueDate);
  const timeLabel = dayDiff < 0 ? `已逾期 ${Math.abs(dayDiff)} 天` : dayDiff === 0 ? "今天到期" : `剩余 ${dayDiff} 天`;
  const timeTone = dayDiff < 0 ? solidTone.red : dayDiff === 0 ? solidTone.amber : "border-blue-200 bg-blue-50 text-blue-700";
  const submitReview = () => {
    if (!hasTaskCompletionItems(task)) {
      setCompletionRequiredTask(task);
      return;
    }
    onUpdateTaskStatus(task.id, "completed");
  };

  return (
    <>
      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold leading-6 text-ink">{getTaskContent(task)}</div>
            <div className="mt-1 text-sm text-slate-500">
              {findUser(getTaskOwnerId(task))?.name} · {findDepartment(getTaskDepartmentId(task))?.name}
            </div>
          </div>
          <PriorityBadge priority={task.priority} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">预计完成时间</div>
            <div className="mt-1 font-semibold text-ink">{task.dueDate}</div>
          </div>
          <div className={`rounded-lg border px-3 py-2 ${timeTone}`}>
            <div className="text-xs opacity-80">时间风险</div>
            <div className="mt-1 font-semibold">{timeLabel}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {meeting && (
            <button onClick={() => onNavigate("meeting-detail", meeting.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              来源会议
            </button>
          )}
          {canEditTask ? (
            <button onClick={submitReview} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
              提交复核
            </button>
          ) : null}
        </div>
      </div>
      {completionRequiredTask ? <TaskCompletionRequiredDialog task={completionRequiredTask} onClose={() => setCompletionRequiredTask(null)} /> : null}
    </>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 lg:mr-2">
          <Filter size={16} />
          筛选
        </div>
        {children}
      </div>
    </section>
  );
}

type SearchableSelectOption = {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
};

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "输入关键词选择",
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 256 });
  const visibleText = open ? query : selected?.label ?? "";
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = (normalizedQuery
    ? options.filter((option) => `${option.label} ${option.meta ?? ""} ${option.searchText ?? ""}`.toLowerCase().includes(normalizedQuery))
    : options
  ).slice(0, 80);

  function updateMenuPosition() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 4;
    const viewportPadding = 12;
    const menuWidth = Math.min(Math.max(rect.width, 128), window.innerWidth - viewportPadding * 2);
    const menuLeft = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - viewportPadding - menuWidth);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(256, (openAbove ? spaceAbove : spaceBelow) - gap));
    setMenuPosition({
      top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap,
      left: menuLeft,
      width: menuWidth,
      maxHeight
    });
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, filteredOptions.length]);

  function choose(option: SearchableSelectOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrapperRef} className="searchable-select relative">
      <div className="relative">
        <input
          value={visibleText}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            requestAnimationFrame(updateMenuPosition);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            requestAnimationFrame(updateMenuPosition);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filteredOptions[0]) {
              event.preventDefault();
              choose(filteredOptions[0]);
            }
            if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder={placeholder}
          className="searchable-select-input w-full rounded-lg border border-line bg-white py-2 pl-3 pr-9 text-sm outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen((current) => !current);
            setQuery("");
            requestAnimationFrame(updateMenuPosition);
          }}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          aria-label="展开选项"
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open ? createPortal(
        <div
          ref={menuRef}
          className="searchable-select-menu fixed z-[80] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-panel"
          style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
        >
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                key={`${option.value}-${option.label}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 ${option.value === value ? "bg-blue-50/70" : ""}`}
              >
                <span className="searchable-select-option-label font-medium text-ink">{option.label}</span>
                {option.meta ? <span className="searchable-select-option-meta mt-0.5 text-xs text-slate-500">{option.meta}</span> : null}
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-slate-500">没有匹配选项</div>
          )}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function DateTimeTextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draftValue, setDraftValue] = useState(formatDateTimeForInput(value));

  useEffect(() => {
    setDraftValue(formatDateTimeForInput(value));
  }, [value]);

  function commit() {
    const nextValue = parseDateTimeText(draftValue);
    if (nextValue) {
      onChange(nextValue);
      setDraftValue(formatDateTimeForInput(nextValue));
      return;
    }
    setDraftValue(formatDateTimeForInput(value));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      placeholder="2026/06/24 13:51"
      className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
    />
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  const options = React.Children.toArray(children)
    .filter(React.isValidElement)
    .map((child) => {
      const props = child.props as { value?: string; children?: React.ReactNode };
      const labelText = React.Children.toArray(props.children).join("");
      return {
        value: props.value ?? labelText,
        label: labelText
      };
    });
  return (
    <div className="min-w-40 text-sm">
      <span className="form-field-label mb-1 block">{label}</span>
      <SearchableSelect value={value} onChange={onChange} options={options} placeholder={`输入${label}`} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="form-field-label mb-1.5 block">{label}</span>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
