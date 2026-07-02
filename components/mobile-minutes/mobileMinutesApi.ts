import type { OkrProject, OkrTaskStatus } from "@/lib/okrTypes";
import type { MobileMessage } from "./mobileMinutesTypes";
import type { ActivityLog, Meeting, Task, User } from "@/lib/types";

const API_BASE = (process.env.NEXT_PUBLIC_MEETING_API_BASE || "/backend-api").replace(/\/+$/, "");

export const DEFAULT_MOBILE_USER_ID = process.env.NEXT_PUBLIC_DEFAULT_MOBILE_USER_ID || "emp-zy25013";

function apiPath(path: string) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface MeetingStateResponse {
  meetings: Meeting[];
  tasks: Task[];
  activityLogs: ActivityLog[];
  notificationReadIds: string[];
}

export interface MeetingDraftRequest {
  meetingId: string;
  title: string;
  departmentId: string;
  hostId: string;
  transcript: string;
  meetingDate?: string;
  meetingType?: string;
  participantNames?: string[];
  participantCount?: number;
  okrProjectName?: string;
  startTime?: string;
}

export interface MobileRecordingUpload {
  audioBlob: Blob;
  durationSeconds: number;
  transcript?: string;
  startedAt?: string;
  title?: string;
}

export async function fetchCurrentUser(): Promise<User | undefined> {
  const response = await fetch(apiPath("/api/auth/me"), { cache: "no-store" });
  if (response.status === 401) return undefined;
  if (!response.ok) throw new Error("无法读取当前用户");
  const payload = (await response.json()) as { user?: User };
  return payload.user;
}

export async function loginAsUser(userId: string): Promise<User> {
  const response = await fetch(apiPath("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId })
  });
  const payload = (await response.json().catch(() => ({}))) as { user?: User; error?: string };
  if (!response.ok || !payload.user) throw new Error(payload.error || "登录切换失败");
  return payload.user;
}

export async function fetchMeetingState(): Promise<MeetingStateResponse> {
  const response = await fetch(apiPath("/api/state"), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取会议状态");
  const payload = (await response.json()) as Partial<MeetingStateResponse>;
  return {
    meetings: Array.isArray(payload.meetings) ? payload.meetings : [],
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    activityLogs: Array.isArray(payload.activityLogs) ? payload.activityLogs : [],
    notificationReadIds: Array.isArray(payload.notificationReadIds) ? payload.notificationReadIds : []
  };
}

export async function fetchOkrProjects(): Promise<OkrProject[]> {
  const response = await fetch(apiPath("/api/okr/projects"), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取 OKR 待办");
  const payload = (await response.json()) as { projects?: OkrProject[] };
  return Array.isArray(payload.projects) ? payload.projects : [];
}

export async function fetchWecomMessages(): Promise<MobileMessage[]> {
  const response = await fetch(apiPath("/api/mobile/wecom-messages"), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取企业微信消息");
  const payload = (await response.json()) as { messages?: MobileMessage[] };
  return Array.isArray(payload.messages) ? payload.messages : [];
}

async function patchTaskAction(taskId: string, pathSuffix: string, body: unknown) {
  const response = await fetch(apiPath(`/api/tasks/${encodeURIComponent(taskId)}/${pathSuffix}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as { task?: Task; error?: string; detail?: string };
  if (!response.ok) throw new Error(payload.detail || payload.error || `任务操作失败：${response.status}`);
  return payload.task;
}

export async function saveTaskCompletion(taskId: string, completionItems: string[]) {
  return patchTaskAction(taskId, "completion", { completionItems });
}

export async function submitTaskReview(taskId: string, status = "completed") {
  return patchTaskAction(taskId, "status", { status });
}

export async function confirmTaskReview(taskId: string) {
  return patchTaskAction(taskId, "review", { action: "confirm" });
}

export async function rejectTaskReview(taskId: string, reasonItems: string[]) {
  return patchTaskAction(taskId, "review", { action: "reject", reasonItems });
}

export async function approveTask(taskId: string) {
  return patchTaskAction(taskId, "approval", { action: "approve" });
}

export async function rejectTaskApproval(taskId: string, reason: string) {
  return patchTaskAction(taskId, "approval", { action: "reject", reason });
}

export async function completeCompanySupport(taskId: string) {
  return patchTaskAction(taskId, "support", {});
}

async function patchOkrPdcaTask(taskId: string, body: unknown) {
  const response = await fetch(apiPath(`/api/okr/pdca-tasks/${encodeURIComponent(taskId)}/status`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; task?: unknown };
  if (!response.ok) throw new Error(payload.error || `OKR 待办操作失败：${response.status}`);
  return payload.task;
}

export async function saveOkrTaskCompletion(taskId: string, completionItems: string[]) {
  const response = await fetch(apiPath(`/api/okr/pdca-tasks/${encodeURIComponent(taskId)}/completion`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completionItems })
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; task?: unknown };
  if (!response.ok) throw new Error(payload.error || `OKR 完成内容保存失败：${response.status}`);
  return payload.task;
}

export async function submitOkrTaskReview(taskId: string, reviewTargetStatus: OkrTaskStatus = "已完成") {
  return patchOkrPdcaTask(taskId, {
    status: "已提交待复核",
    reviewTargetStatus,
    reviewAction: "submit"
  });
}

export async function confirmOkrTaskReview(taskId: string) {
  return patchOkrPdcaTask(taskId, {
    status: "已完成",
    reviewAction: "confirm"
  });
}

export async function rejectOkrTaskReview(taskId: string, reasonItems: string[]) {
  const normalizedItems = reasonItems.map((item) => item.trim()).filter(Boolean);
  return patchOkrPdcaTask(taskId, {
    status: "进行中",
    reviewAction: "reject",
    reviewRejectedItems: normalizedItems,
    reviewRejectedReason: normalizedItems.join("；") || "请补充完成内容后重新提交复核。"
  });
}

export async function saveNotificationReadIds(readIds: string[]) {
  const response = await fetch(apiPath("/api/notifications/read"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readIds })
  });
  const payload = (await response.json().catch(() => ({}))) as { readIds?: string[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "消息已读状态保存失败");
  return Array.isArray(payload.readIds) ? payload.readIds : readIds;
}

export async function generateMeetingDraft(request: MeetingDraftRequest) {
  const response = await fetch(apiPath("/api/ai/meeting-draft"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || "会议纪要生成失败");
  }
  return payload;
}

export async function submitMeetingApproval(meeting: Meeting) {
  const response = await fetch(apiPath("/api/meetings/approval-submissions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meeting })
  });
  const payload = (await response.json().catch(() => ({}))) as { meeting?: Meeting; error?: string };
  if (!response.ok || !payload.meeting) throw new Error(payload.error || "会议提交签批失败");
  return payload.meeting;
}

export async function uploadMobileRecording(input: MobileRecordingUpload) {
  const formData = new FormData();
  const fileName = `mobile-recording-${Date.now()}.webm`;
  formData.append("audio", input.audioBlob, fileName);
  formData.append("durationSeconds", String(input.durationSeconds));
  if (input.transcript) formData.append("transcript", input.transcript);
  if (input.startedAt) formData.append("startedAt", input.startedAt);
  if (input.title) formData.append("title", input.title);

  const response = await fetch(apiPath("/api/mobile/recordings"), {
    method: "POST",
    body: formData
  });
  const payload = (await response.json().catch(() => ({}))) as { meeting?: Meeting; error?: string; detail?: string };
  if (!response.ok || !payload.meeting) throw new Error(payload.detail || payload.error || `录音上传失败：${response.status}`);
  return payload.meeting;
}
