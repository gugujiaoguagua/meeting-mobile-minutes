import { isDbStateReadEnabled } from "@/lib/db";
import { buildCanonicalUserDirectory, canonicalizeUserId, resolveCanonicalWecomUserId } from "@/lib/canonicalUsers";
import { readDbState } from "@/lib/dbStateStore";
import { readLocalState } from "@/lib/localStateStore";
import { getPresidentUserId, getTaskOwnerId, getTaskReviewerId } from "@/lib/permission";
import { departments, users } from "@/lib/orgPeopleData";
import { buildWecomEntryUrl } from "@/lib/wecomDeepLink";
import { escapeWecomText, sendWecomTextcard, type WecomSendResult } from "@/lib/wecomMessage";
import { createWecomOutbox, markWecomOutboxAttempt, markWecomOutboxResult, markWecomOutboxSkipped, type CreateOutboxResult } from "@/lib/wecomOutbox";
import type { Meeting, Task, TaskStatus, User } from "@/lib/types";

function getTaskContent(task: Task) {
  return task.content || task.description || task.title;
}

function getTaskStatusLabel(status?: TaskStatus) {
  const labels: Partial<Record<TaskStatus, string>> = {
    not_started: "未开始",
    in_progress: "进行中",
    pending_review: "已提交待复核",
    completed: "已完成",
    blocked: "已阻塞",
    overdue: "已逾期",
    未开始: "未开始",
    进行中: "进行中",
    已完成: "已完成"
  };
  return (status && labels[status]) || "待复核";
}

function uniqueUserIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function findDirectoryUser(userId: string, directory: ReturnType<typeof buildCanonicalUserDirectory>) {
  return directory.users.find((user) => user.id === userId) ?? users.find((user) => user.id === userId);
}

function getReviewTargetLabel(task: Task) {
  if (task.reviewTargetStatus === "completed") return "完成";
  if (task.reviewTargetStatus === "in_progress") return "进度";
  if (task.reviewTargetStatus === "blocked") return "阻塞";
  return getTaskStatusLabel(task.reviewTargetStatus);
}

async function readFullState() {
  return isDbStateReadEnabled() ? readDbState() : readLocalState();
}

async function resolveRecipient(userId: string) {
  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const canonicalUserId = canonicalizeUserId(userId, directory.aliasToCanonicalUserId) ?? userId;
  const recipient = directory.users.find((user) => user.id === canonicalUserId) ?? users.find((user) => user.id === canonicalUserId);
  const touser = resolveCanonicalWecomUserId(userId, directory);
  return { recipient, recipientUserId: canonicalUserId, touser };
}

function findMeetingForTask(task: Task, meetings: Meeting[]) {
  return meetings.find((meeting) => meeting.id === task.meetingId);
}

function line(label: string, value?: string) {
  return value ? `<div class=\"normal\">${escapeWecomText(label)}：${escapeWecomText(value)}</div>` : "";
}

function compactText(value?: string, maxLength = 120) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function sendTaskTextcardNotification(params: {
  task: Task;
  sourceType?: string;
  sourceId?: string;
  linkTaskId?: string;
  recipientUserId: string;
  eventType: string;
  dedupeKey: string;
  title: string;
  description: string;
  btntxt: string;
  missingUserReason: string;
}) {
  const { recipient, recipientUserId, touser } = await resolveRecipient(params.recipientUserId);
  const baseOutbox = {
    eventType: params.eventType,
    sourceType: params.sourceType ?? "task",
    sourceId: params.sourceId ?? params.task.id,
    dedupeKey: params.dedupeKey,
    recipientUserId,
    recipientName: recipient?.name,
    touser,
    title: params.title,
    description: params.description,
    btntxt: params.btntxt
  };

  if (!recipient || !touser) {
    const reason = recipient ? "missing_wecom_user_map" : params.missingUserReason;
    await markWecomOutboxSkipped(baseOutbox, reason).catch((error) => {
      console.warn("wecom_outbox_skipped_write_failed", {
        eventType: params.eventType,
        taskId: params.task.id,
        sourceId: params.sourceId ?? params.task.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
    console.warn("wecom_task_notification_skipped", {
      eventType: params.eventType,
      taskId: params.task.id,
      sourceId: params.sourceId ?? params.task.id,
      recipientUserId,
      reason
    });
    return { skipped: true, reason };
  }

  const url = buildWecomEntryUrl({ reviewerUserId: recipient.id, taskId: params.linkTaskId ?? params.task.id });
  const outbox: CreateOutboxResult = await createWecomOutbox({ ...baseOutbox, url }).catch((error) => {
    console.warn("wecom_outbox_create_failed", {
      eventType: params.eventType,
      taskId: params.task.id,
      sourceId: params.sourceId ?? params.task.id,
      message: error instanceof Error ? error.message : "unknown_error"
    });
    return { shouldSend: true } satisfies CreateOutboxResult;
  });
  if (!outbox.shouldSend) {
    console.warn("wecom_task_notification_duplicate_skipped", {
      eventType: params.eventType,
      taskId: params.task.id,
      sourceId: params.sourceId ?? params.task.id,
      recipientUserId,
      outboxId: outbox.id,
      status: outbox.existingStatus
    });
    return { skipped: true, reason: "duplicate_outbox" };
  }

  if (outbox.id) {
    await markWecomOutboxAttempt(outbox.id).catch((error) => {
      console.warn("wecom_outbox_attempt_write_failed", {
        eventType: params.eventType,
        taskId: params.task.id,
        sourceId: params.sourceId ?? params.task.id,
        outboxId: outbox.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }

  const result: WecomSendResult = await sendWecomTextcard({
    touser,
    title: params.title,
    description: params.description,
    url,
    btntxt: params.btntxt
  }).catch((error) => ({
    errcode: -1,
    errmsg: error instanceof Error ? error.message : "unknown_send_error"
  }));

  if (outbox.id) {
    await markWecomOutboxResult(outbox.id, result).catch((error) => {
      console.warn("wecom_outbox_result_write_failed", {
        eventType: params.eventType,
        taskId: params.task.id,
        outboxId: outbox.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }

  if (result.errcode !== 0) {
    console.warn("wecom_task_notification_failed", {
      eventType: params.eventType,
      taskId: params.task.id,
      sourceId: params.sourceId ?? params.task.id,
      recipientUserId,
      touser,
      errcode: result.errcode,
      errmsg: result.errmsg,
      invaliduser: result.invaliduser
    });
  }
  return result;
}

export async function notifyTaskReviewSubmitted(task: Task, currentUser: User) {
  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const permissionDirectory = { users: directory.users, departments: state.departments };
  const meeting = findMeetingForTask(task, state.meetings);
  const reviewerId = getTaskReviewerId(task, meeting, permissionDirectory);
  const reviewer = findDirectoryUser(reviewerId, directory);
  const title = "待办提交复核";
  const description = [
    `<div class=\"gray\">${escapeWecomText(task.reviewSubmittedAt || task.updatedAt)}</div>`,
    line("会议", meeting?.title ?? task.meetingId),
    line("待办", getTaskContent(task)),
    line("推进人", currentUser.name),
    line("复核人", reviewer?.name ?? reviewerId),
    line("复核类型", getReviewTargetLabel(task)),
    line("截止时间", task.dueDate),
    "<div class=\"highlight\">点击进入会议系统处理复核。</div>"
  ].join("");
  const dedupeKey = `task_review_submitted:${task.id}:${task.reviewSubmittedAt || task.updatedAt}:${reviewerId}`;

  return sendTaskTextcardNotification({
    task,
    eventType: "task_review_submitted",
    recipientUserId: reviewerId,
    dedupeKey,
    title,
    description,
    btntxt: "进入复核",
    missingUserReason: "reviewer_not_found"
  });
}

export async function notifyTaskReviewConfirmed(task: Task, currentUser: User) {
  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const permissionDirectory = { users: directory.users, departments: state.departments };
  const meeting = findMeetingForTask(task, state.meetings);
  const ownerId = getTaskOwnerId(task, permissionDirectory);
  const owner = findDirectoryUser(ownerId, directory);
  const reviewerId = getTaskReviewerId(task, meeting, permissionDirectory);
  const title = "待办复核通过";
  const description = [
    `<div class=\"gray\">${escapeWecomText(task.reviewedAt || task.updatedAt)}</div>`,
    line("会议", meeting?.title ?? task.meetingId),
    line("待办", getTaskContent(task)),
    line("推进人", owner?.name ?? ownerId),
    line("复核人", currentUser.name),
    line("当前状态", getTaskStatusLabel(task.status)),
    line("截止时间", task.dueDate),
    "<div class=\"highlight\">点击进入会议系统查看复核结果。</div>"
  ].join("");
  const dedupeKey = `task_review_confirmed:${task.id}:${task.reviewedAt || task.updatedAt}:${ownerId}:${reviewerId}`;

  return sendTaskTextcardNotification({
    task,
    eventType: "task_review_confirmed",
    recipientUserId: ownerId,
    dedupeKey,
    title,
    description,
    btntxt: "查看结果",
    missingUserReason: "owner_not_found"
  });
}

export async function notifyTaskReviewRejected(task: Task, currentUser: User) {
  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const permissionDirectory = { users: directory.users, departments: state.departments };
  const meeting = findMeetingForTask(task, state.meetings);
  const ownerId = getTaskOwnerId(task, permissionDirectory);
  const owner = findDirectoryUser(ownerId, directory);
  const reviewerId = getTaskReviewerId(task, meeting, permissionDirectory);
  const reason = compactText(task.reviewRejectedReason || task.reviewRejectedItems?.join("；")) ?? "请补充完成内容后重新提交复核。";
  const title = "待办复核驳回";
  const description = [
    `<div class=\"gray\">${escapeWecomText(task.reviewRejectedAt || task.updatedAt)}</div>`,
    line("会议", meeting?.title ?? task.meetingId),
    line("待办", getTaskContent(task)),
    line("推进人", owner?.name ?? ownerId),
    line("复核人", currentUser.name),
    line("驳回原因", reason),
    line("当前状态", getTaskStatusLabel(task.status)),
    "<div class=\"highlight\">点击进入会议系统修改后重新提交。</div>"
  ].join("");
  const dedupeKey = `task_review_rejected:${task.id}:${task.reviewRejectedAt || task.updatedAt}:${ownerId}:${reviewerId}`;

  return sendTaskTextcardNotification({
    task,
    eventType: "task_review_rejected",
    recipientUserId: ownerId,
    dedupeKey,
    title,
    description,
    btntxt: "处理驳回",
    missingUserReason: "owner_not_found"
  });
}

export async function notifyMeetingApprovalSubmitted(meeting: Meeting, currentUser: User) {
  const pendingTasks = (meeting.tasks ?? []).filter((task) => task.approvalStatus === "pending_president_approval");
  const firstTask = pendingTasks[0] ?? meeting.tasks?.[0];
  if (!firstTask) {
    console.warn("wecom_meeting_approval_notification_skipped", { meetingId: meeting.id, reason: "meeting_tasks_empty" });
    return { skipped: true, reason: "meeting_tasks_empty" };
  }

  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const president = directory.users.find((user) => user.role === "总裁") ?? users.find((user) => user.role === "总裁");
  const presidentId = president?.id ?? getPresidentUserId(directory.users);
  const department = state.departments.find((item) => item.id === meeting.departmentId) ?? departments.find((item) => item.id === meeting.departmentId);
  const taskCount = pendingTasks.length || meeting.tasks?.length || 0;
  const latestTaskUpdatedAt = (meeting.tasks ?? [])
    .map((task) => task.updatedAt || task.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const submittedAt = latestTaskUpdatedAt || meeting.createdAt;
  const title = "会议待办待总裁签批";
  const description = [
    `<div class=\"gray\">${escapeWecomText(submittedAt)}</div>`,
    line("会议", meeting.title),
    line("提交人", currentUser.name),
    line("部门", department?.name ?? meeting.departmentId),
    line("待办数量", `${taskCount} 项`),
    line("会议类型", meeting.type),
    "<div class=\"highlight\">点击进入会议系统处理总裁签批。</div>"
  ].join("");
  const dedupeKey = `meeting_approval_submitted:${meeting.id}:${submittedAt}:${presidentId}`;

  return sendTaskTextcardNotification({
    task: firstTask,
    sourceType: "meeting",
    sourceId: meeting.id,
    linkTaskId: firstTask.id,
    eventType: "meeting_approval_submitted",
    recipientUserId: presidentId,
    dedupeKey,
    title,
    description,
    btntxt: "进入签批",
    missingUserReason: president ? "missing_wecom_user_map" : "president_not_found"
  });
}

export async function notifyTaskApprovalApproved(task: Task, currentUser: User) {
  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const permissionDirectory = { users: directory.users, departments: state.departments };
  const canonicalUserId = (userId: string) => canonicalizeUserId(userId, directory.aliasToCanonicalUserId) ?? userId;
  const meeting = findMeetingForTask(task, state.meetings);
  const ownerId = canonicalUserId(getTaskOwnerId(task, permissionDirectory));
  const reviewerId = canonicalUserId(getTaskReviewerId(task, meeting, permissionDirectory));
  const owner = findDirectoryUser(ownerId, directory);
  const reviewer = findDirectoryUser(reviewerId, directory);
  const title = "待办签批通过";
  const description = [
    `<div class=\"gray\">${escapeWecomText(task.updatedAt || task.createdAt)}</div>`,
    line("会议", meeting?.title ?? task.meetingId),
    line("待办", getTaskContent(task)),
    line("签批人", currentUser.name),
    line("推进人", owner?.name ?? ownerId),
    line("复核人", reviewer?.name ?? reviewerId),
    line("截止时间", task.dueDate),
    "<div class=\"highlight\">点击进入会议系统查看签批结果。</div>"
  ].join("");

  return Promise.all(
    uniqueUserIds([ownerId, reviewerId]).map((recipientUserId) => {
      const recipientRole = recipientUserId === ownerId ? "owner" : "reviewer";
      return sendTaskTextcardNotification({
        task,
        eventType: "task_approval_approved",
        recipientUserId,
        dedupeKey: `task_approval_approved:${task.id}:${task.updatedAt || task.createdAt}:${recipientUserId}`,
        title,
        description,
        btntxt: "查看结果",
        missingUserReason: recipientRole === "owner" ? "owner_not_found" : "reviewer_not_found"
      });
    })
  );
}

export async function notifyTaskApprovalRejected(task: Task, currentUser: User) {
  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const permissionDirectory = { users: directory.users, departments: state.departments };
  const meeting = findMeetingForTask(task, state.meetings);
  const recipientUserId = meeting?.createdBy || meeting?.hostId || getTaskReviewerId(task, meeting, permissionDirectory) || getTaskOwnerId(task, permissionDirectory);
  const recipient = findDirectoryUser(recipientUserId, directory);
  const reason = compactText(task.rejectedReason) ?? "请主管补充待办推进人、复核人、截止时间和达成目标后重新提交。";
  const title = "待办签批驳回";
  const description = [
    `<div class=\"gray\">${escapeWecomText(task.updatedAt || task.createdAt)}</div>`,
    line("会议", meeting?.title ?? task.meetingId),
    line("待办", getTaskContent(task)),
    line("签批人", currentUser.name),
    line("接收人", recipient?.name ?? recipientUserId),
    line("驳回原因", reason),
    "<div class=\"highlight\">点击进入会议系统修改后重新提交签批。</div>"
  ].join("");

  return sendTaskTextcardNotification({
    task,
    eventType: "task_approval_rejected",
    recipientUserId,
    dedupeKey: `task_approval_rejected:${task.id}:${task.updatedAt || task.createdAt}:${recipientUserId}`,
    title,
    description,
    btntxt: "处理驳回",
    missingUserReason: "approval_submitter_not_found"
  });
}

export async function notifyMeetingApprovalRejected(meeting: Meeting, currentUser: User) {
  const firstTask = meeting.tasks?.[0];
  if (!firstTask) {
    console.warn("wecom_meeting_approval_reject_notification_skipped", { meetingId: meeting.id, reason: "meeting_tasks_empty" });
    return { skipped: true, reason: "meeting_tasks_empty" };
  }

  const state = await readFullState();
  const directory = buildCanonicalUserDirectory(state.users);
  const recipientUserId = meeting.createdBy || meeting.hostId;
  const recipient = findDirectoryUser(recipientUserId, directory);
  const department = state.departments.find((item) => item.id === meeting.departmentId) ?? departments.find((item) => item.id === meeting.departmentId);
  const reason = compactText(meeting.rejectedReason) ?? "请主管补充待办推进人、复核人、截止时间和达成目标后重新提交。";
  const taskCount = meeting.tasks?.length ?? 0;
  const title = "会议签批驳回";
  const description = [
    `<div class=\"gray\">${escapeWecomText(meeting.createdAt)}</div>`,
    line("会议", meeting.title),
    line("签批人", currentUser.name),
    line("接收人", recipient?.name ?? recipientUserId),
    line("部门", department?.name ?? meeting.departmentId),
    line("待办数量", `${taskCount} 项`),
    line("驳回原因", reason),
    "<div class=\"highlight\">点击进入会议系统修改后重新提交签批。</div>"
  ].join("");

  return sendTaskTextcardNotification({
    task: firstTask,
    sourceType: "meeting",
    sourceId: meeting.id,
    linkTaskId: firstTask.id,
    eventType: "meeting_approval_rejected",
    recipientUserId,
    dedupeKey: `meeting_approval_rejected:${meeting.id}:${meeting.createdAt}:${recipientUserId}:${reason}`,
    title,
    description,
    btntxt: "处理驳回",
    missingUserReason: "approval_submitter_not_found"
  });
}
