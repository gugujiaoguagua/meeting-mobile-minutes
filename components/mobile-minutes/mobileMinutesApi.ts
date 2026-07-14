import type { OkrProject, OkrTaskStatus } from "@/lib/okrTypes";
import type { MeetingDictionaryEntry } from "@/lib/meetingDictionary";
import type { MobileMessage } from "./mobileMinutesTypes";
import type { ActivityLog, Department, Meeting, MeetingBoardResponse, MeetingDecision, MeetingSpeakerAssignment, Task, User } from "@/lib/types";

function resolveApiBase() {
  const configuredBase = process.env.NEXT_PUBLIC_MEETING_API_BASE;
  if (configuredBase) return configuredBase.replace(/\/+$/, "");
  if (typeof window !== "undefined" && ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname)) {
    return "";
  }
  return "/backend-api";
}

function apiPath(path: string) {
  const API_BASE = resolveApiBase();
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface MeetingStateResponse {
  departments: Department[];
  users: User[];
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
  participantIds?: string[];
  participantCount?: number;
  speakerAssignments?: MeetingDraftSpeakerAssignment[];
  okrProjectName?: string;
  startTime?: string;
}

export interface MeetingDraftSpeakerAssignment {
  speakerLabel: string;
  userId?: string;
  userName: string;
}

type MeetingDraftJob = {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  result?: MeetingDraftResponse;
  error?: string;
  errorDetail?: string;
};

type MeetingDraftResponse = {
  aiSummary?: string;
  minuteMarkdown?: string;
  decisions?: MeetingDecision[];
  tasks?: Task[];
  correctedTranscript?: string;
  dictionaryCorrections?: Array<{
    original?: string;
    standard?: string;
    category?: string;
    note?: string;
  }>;
};

export type MeetingFileTextResponse = {
  fileName?: string;
  text?: string;
  sourceType?: string;
  storageObject?: {
    id: string;
    ownerType: string;
    ownerId: string;
    category: string;
    originalName?: string;
    sizeBytes?: number;
    mimeType?: string;
  };
  error?: string;
  detail?: string;
};

export interface MobileRecordingUpload {
  audioBlob: Blob;
  durationSeconds: number;
  transcript?: string;
  startedAt?: string;
  title?: string;
  participantIds?: string[];
}

export interface TencentRealtimeAsrSession {
  url: string;
  voiceId: string;
  engineModelType: string;
  voiceFormat: number;
  sampleRate: number;
  expiresAt: string;
}

async function readJsonOrText(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 240) };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function fetchCurrentUser(): Promise<User | undefined> {
  const response = await fetch(apiPath("/api/accounts/me"), { cache: "no-store" });
  if (response.status === 401) return undefined;
  if (!response.ok) throw new Error("无法读取当前用户");
  const payload = (await response.json()) as { user?: User };
  return payload.user;
}

export async function loginWithAccount(username: string, password: string): Promise<User> {
  const response = await fetch(apiPath("/api/accounts/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const payload = (await response.json().catch(() => ({}))) as { user?: User; error?: string };
  if (!response.ok || !payload.user) throw new Error(payload.error || "账号或密码不正确");
  return payload.user;
}

export async function logoutAccount(): Promise<void> {
  await fetch(apiPath("/api/accounts/logout"), { method: "POST" });
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
    departments: Array.isArray(payload.departments) ? payload.departments : [],
    users: Array.isArray(payload.users) ? payload.users : [],
    meetings: Array.isArray(payload.meetings) ? payload.meetings : [],
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    activityLogs: Array.isArray(payload.activityLogs) ? payload.activityLogs : [],
    notificationReadIds: Array.isArray(payload.notificationReadIds) ? payload.notificationReadIds : []
  };
}

export async function fetchMeetingBoard(): Promise<MeetingBoardResponse> {
  const response = await fetch(apiPath("/api/meeting-board"), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取后端会议看板");
  const payload = (await response.json()) as MeetingBoardResponse;
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    summary: {
      totalMeetings: Number(payload.summary?.totalMeetings ?? 0),
      todayMeetings: Number(payload.summary?.todayMeetings ?? 0),
      mobileRecordings: Number(payload.summary?.mobileRecordings ?? 0),
      transcribing: Number(payload.summary?.transcribing ?? 0),
      failedRecordings: Number(payload.summary?.failedRecordings ?? 0),
      needsMinutes: Number(payload.summary?.needsMinutes ?? 0),
      needsApprovalSubmission: Number(payload.summary?.needsApprovalSubmission ?? 0),
      pendingApproval: Number(payload.summary?.pendingApproval ?? 0),
      closed: Number(payload.summary?.closed ?? 0),
      draftTaskCount: Number(payload.summary?.draftTaskCount ?? 0),
      formalTaskCount: Number(payload.summary?.formalTaskCount ?? 0),
      totalTaskCount: Number(payload.summary?.totalTaskCount ?? 0),
      activeTaskCount: Number(payload.summary?.activeTaskCount ?? 0),
      reviewTaskCount: Number(payload.summary?.reviewTaskCount ?? 0),
      approvalTaskCount: Number(payload.summary?.approvalTaskCount ?? 0),
      overdueTaskCount: Number(payload.summary?.overdueTaskCount ?? 0)
    }
  };
}

export async function fetchOkrProjects(): Promise<OkrProject[]> {
  const response = await fetch(apiPath("/api/okr/projects"), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取 OKR 待办");
  const payload = (await response.json()) as { projects?: OkrProject[] };
  return Array.isArray(payload.projects) ? payload.projects : [];
}

export async function createOkrProject(project: OkrProject): Promise<OkrProject> {
  const response = await fetch(apiPath("/api/okr/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project })
  });
  const payload = (await response.json().catch(() => ({}))) as { project?: OkrProject; error?: string };
  if (!response.ok || !payload.project) throw new Error(payload.error || "OKR 项目保存失败");
  return payload.project;
}

export async function fetchWecomMessages(): Promise<MobileMessage[]> {
  const response = await fetch(apiPath("/api/mobile/wecom-messages"), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取企业微信消息");
  const payload = (await response.json()) as { messages?: MobileMessage[] };
  return Array.isArray(payload.messages) ? payload.messages : [];
}

export async function fetchMeetingDictionary(): Promise<MeetingDictionaryEntry[]> {
  const response = await fetch(apiPath("/api/meeting-dictionary"), { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { entries?: MeetingDictionaryEntry[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "无法读取会议词典");
  return Array.isArray(payload.entries) ? payload.entries : [];
}

export async function createMeetingDictionaryEntry(input: {
  standard: string;
  variants: string;
  category: string;
  note: string;
}): Promise<MeetingDictionaryEntry> {
  const response = await fetch(apiPath("/api/meeting-dictionary"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as { entry?: MeetingDictionaryEntry; error?: string };
  if (!response.ok || !payload.entry) throw new Error(payload.error || "会议词典保存失败");
  return payload.entry;
}

export async function extractMeetingFileText(file: File, options?: { ownerType?: string; ownerId?: string }): Promise<MeetingFileTextResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.ownerType) formData.append("ownerType", options.ownerType);
  if (options?.ownerId) formData.append("ownerId", options.ownerId);
  const response = await fetch(apiPath("/api/meeting-file-text"), {
    method: "POST",
    body: formData
  });
  const payload = (await response.json().catch(() => ({}))) as MeetingFileTextResponse;
  if (!response.ok) throw new Error(payload.detail || payload.error || `文件解析失败：${response.status}`);
  return payload;
}

export function downloadStorageObject(objectId: string) {
  window.location.href = apiPath(`/api/storage/objects/${encodeURIComponent(objectId)}/download`);
}

export function downloadStorageObjectsByOwner(ownerType: string, ownerId: string, category?: string) {
  const params = new URLSearchParams({ ownerType, ownerId });
  if (category) params.set("category", category);
  window.location.href = apiPath(`/api/storage/objects/download-batch?${params.toString()}`);
}

export function downloadTaskExport(taskId?: string) {
  const suffix = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
  window.location.href = apiPath(`/api/tasks/download${suffix}`);
}

export async function deleteMeetingDictionaryEntry(entryId: string) {
  const response = await fetch(apiPath(`/api/meeting-dictionary?id=${encodeURIComponent(entryId)}`), {
    method: "DELETE"
  });
  const payload = (await response.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
  if (!response.ok || !payload.deleted) throw new Error(payload.error || "会议词典删除失败");
  return payload;
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

export async function approveTasksBatch(taskIds: string[]) {
  const response = await fetch(apiPath("/api/tasks/approval-batch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", taskIds })
  });
  const payload = (await response.json().catch(() => ({}))) as { approvedCount?: number; failed?: Array<{ taskId: string; error: string }>; error?: string };
  if (!response.ok) throw new Error(payload.error || `批量签批失败：${response.status}`);
  return payload;
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

export async function changeOkrTaskEndDate(taskId: string, endDate: string, reason: string) {
  const response = await fetch(apiPath(`/api/okr/pdca-tasks/${encodeURIComponent(taskId)}/end-date`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endDate, reason })
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; task?: unknown; changed?: boolean };
  if (!response.ok) throw new Error(payload.error || `OKR 结束时间调整失败：${response.status}`);
  return payload.task;
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

export async function generateMeetingDraft(request: MeetingDraftRequest, options?: { onStatus?: (message: string) => void }): Promise<MeetingDraftResponse> {
  const response = await fetch(apiPath("/api/ai/meeting-draft-jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = (await readJsonOrText(response)) as { job?: MeetingDraftJob; error?: string; detail?: string };
  if (!response.ok || !payload.job?.id) {
    throw new Error(payload.detail || payload.error || `会议纪要生成任务提交失败：${response.status}`);
  }
  options?.onStatus?.("已提交后台生成任务，正在等待 AI 生成会议纪要...");

  const startedAt = Date.now();
  let lastStatus = payload.job.status;
  while (Date.now() - startedAt < 8 * 60 * 1000) {
    await sleep(3000);
    const statusResponse = await fetch(apiPath(`/api/ai/meeting-draft-jobs/${encodeURIComponent(payload.job.id)}`), { cache: "no-store" });
    const statusPayload = (await readJsonOrText(statusResponse)) as { job?: MeetingDraftJob; error?: string; detail?: string };
    if (!statusResponse.ok || !statusPayload.job) {
      throw new Error(statusPayload.detail || statusPayload.error || `会议纪要生成状态读取失败：${statusResponse.status}`);
    }

    const job = statusPayload.job;
    if (job.status !== lastStatus) {
      lastStatus = job.status;
      options?.onStatus?.(job.status === "processing" ? "AI 正在生成会议纪要和待办草稿..." : "正在读取生成结果...");
    }
    if (job.status === "succeeded" && job.result) return job.result;
    if (job.status === "failed") {
      throw new Error(job.errorDetail || job.error || "会议纪要后台生成失败。");
    }
  }

  throw new Error("会议纪要生成仍在后台处理中，请稍后重新进入详情查看或再次点击生成。");
}

export async function fetchLatestMeetingDraft(meetingId: string): Promise<MeetingDraftResponse | undefined> {
  const response = await fetch(apiPath(`/api/ai/meeting-draft-jobs?meetingId=${encodeURIComponent(meetingId)}`), { cache: "no-store" });
  const payload = (await readJsonOrText(response)) as { job?: MeetingDraftJob | null; error?: string; detail?: string };
  if (!response.ok) throw new Error(payload.detail || payload.error || `会议纪要草稿读取失败：${response.status}`);
  return payload.job?.status === "succeeded" ? payload.job.result : undefined;
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

export async function saveMeetingSpeakerAssignments(meetingId: string, assignments: MeetingSpeakerAssignment[]) {
  const response = await fetch(apiPath(`/api/meetings/${encodeURIComponent(meetingId)}/speaker-assignments`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments })
  });
  const payload = (await response.json().catch(() => ({}))) as { meeting?: Meeting; error?: string; detail?: string };
  if (!response.ok || !payload.meeting) throw new Error(payload.detail || payload.error || `发言人标注保存失败：${response.status}`);
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
  if (input.participantIds?.length) formData.append("participantIds", JSON.stringify(input.participantIds));

  const response = await fetch(apiPath("/api/mobile/recordings"), {
    method: "POST",
    body: formData
  });
  const payload = (await response.json().catch(() => ({}))) as { meeting?: Meeting; error?: string; detail?: string };
  if (!response.ok || !payload.meeting) throw new Error(payload.detail || payload.error || `录音上传失败：${response.status}`);
  return payload.meeting;
}

export async function deleteMeeting(meetingId: string) {
  const response = await fetch(apiPath(`/api/meetings/${encodeURIComponent(meetingId)}`), {
    method: "DELETE"
  });
  const payload = (await response.json().catch(() => ({}))) as { deleted?: boolean; meetingId?: string; error?: string; detail?: string };
  if (!response.ok || !payload.deleted) throw new Error(payload.detail || payload.error || `妙记删除失败：${response.status}`);
  return payload;
}

export async function fetchMobileRecordingStatus(meetingId: string) {
  const response = await fetch(apiPath(`/api/mobile/recordings/${encodeURIComponent(meetingId)}/status`), { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { meetingId?: string; recordingStatus?: string; message?: string; meeting?: Meeting; error?: string };
  if (!response.ok || !payload.meeting) throw new Error(payload.error || `录音状态读取失败：${response.status}`);
  return payload;
}

export async function fetchTencentRealtimeAsrUrl() {
  const response = await fetch(apiPath("/api/mobile/asr/realtime-url"), {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const payload = (await response.json().catch(() => ({}))) as { realtime?: TencentRealtimeAsrSession; error?: string };
  if (!response.ok || !payload.realtime) throw new Error(payload.error || `实时转写签名失败：${response.status}`);
  return payload.realtime;
}
