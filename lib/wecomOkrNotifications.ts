import { users } from "@/lib/orgPeopleData";
import type { OkrPDCATask, OkrProject } from "@/lib/okrTypes";
import type { User } from "@/lib/types";
import { createWecomOutbox, markWecomOutboxAttempt, markWecomOutboxResult, markWecomOutboxSkipped, type CreateOutboxResult } from "@/lib/wecomOutbox";
import { createSignedDeepLink, buildWecomEntryUrl } from "@/lib/wecomDeepLink";
import { getMeetingPublicBaseUrl, getWecomOAuthCorpId, getWecomDeepLinkSecret } from "@/lib/wecomConfig";
import { escapeWecomText, sendWecomTextcard, type WecomSendResult } from "@/lib/wecomMessage";
import { resolveWecomUserId } from "@/lib/wecomUserMap";

type OkrRecipient = {
  userId: string;
  roles: Set<string>;
  taskId?: string;
};

function line(label: string, value?: string | number) {
  const text = value === undefined || value === null ? "" : String(value);
  return text ? `<div class=\"normal\">${escapeWecomText(label)}：${escapeWecomText(text)}</div>` : "";
}

function compactText(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
}

function okrTaskEntryId(taskId?: string) {
  return taskId ? `okr-task-${taskId}` : undefined;
}

function buildOkrEntryUrl(params: { userId: string; taskId?: string }) {
  const taskId = okrTaskEntryId(params.taskId);
  if (taskId) return buildWecomEntryUrl({ reviewerUserId: params.userId, taskId });

  if (getWecomOAuthCorpId() && getWecomDeepLinkSecret()) {
    const search = new URLSearchParams({ page: "my-tasks" });
    return `${getMeetingPublicBaseUrl()}/api/wecom/oauth/start?${search.toString()}`;
  }

  const signedToken = createSignedDeepLink({ userId: params.userId, page: "my-tasks" });
  if (signedToken) return `${getMeetingPublicBaseUrl()}/api/wecom/deeplink?token=${encodeURIComponent(signedToken)}`;

  return `${getMeetingPublicBaseUrl()}/?page=my-tasks`;
}

function getUserName(userId?: string) {
  return users.find((user) => user.id === userId)?.name ?? userId ?? "";
}

function addRecipient(recipients: Map<string, OkrRecipient>, userId: string | undefined, role: string, taskId?: string) {
  if (!userId) return;
  const existing = recipients.get(userId);
  if (existing) {
    existing.roles.add(role);
    existing.taskId = existing.taskId ?? taskId;
    return;
  }
  recipients.set(userId, {
    userId,
    roles: new Set([role]),
    taskId
  });
}

async function sendOkrTextcardNotification(params: {
  eventType: string;
  sourceType: string;
  sourceId: string;
  recipientUserId?: string;
  dedupeKey: string;
  title: string;
  description: string;
  btntxt: string;
  taskId?: string;
  missingUserReason: string;
}) {
  const recipient = params.recipientUserId ? users.find((user) => user.id === params.recipientUserId) : undefined;
  const touser = params.recipientUserId ? resolveWecomUserId(params.recipientUserId) : undefined;
  const url = buildOkrEntryUrl({ userId: params.recipientUserId ?? "", taskId: params.taskId });
  const baseOutbox = {
    eventType: params.eventType,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    dedupeKey: params.dedupeKey,
    recipientUserId: params.recipientUserId,
    recipientName: recipient?.name,
    touser,
    title: params.title,
    description: params.description,
    url,
    btntxt: params.btntxt
  };

  if (!recipient || !touser) {
    const reason = params.recipientUserId && recipient ? "missing_wecom_user_map" : params.missingUserReason;
    await markWecomOutboxSkipped(baseOutbox, reason).catch((error) => {
      console.warn("wecom_okr_outbox_skipped_write_failed", {
        eventType: params.eventType,
        sourceId: params.sourceId,
        recipientUserId: params.recipientUserId,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
    console.warn("wecom_okr_notification_skipped", {
      eventType: params.eventType,
      sourceId: params.sourceId,
      recipientUserId: params.recipientUserId,
      reason
    });
    return { skipped: true, reason };
  }

  const outbox: CreateOutboxResult = await createWecomOutbox(baseOutbox).catch((error) => {
    console.warn("wecom_okr_outbox_create_failed", {
      eventType: params.eventType,
      sourceId: params.sourceId,
      message: error instanceof Error ? error.message : "unknown_error"
    });
    return { shouldSend: true } satisfies CreateOutboxResult;
  });

  if (!outbox.shouldSend) {
    console.warn("wecom_okr_notification_duplicate_skipped", {
      eventType: params.eventType,
      sourceId: params.sourceId,
      recipientUserId: params.recipientUserId,
      outboxId: outbox.id,
      status: outbox.existingStatus
    });
    return { skipped: true, reason: "duplicate_outbox" };
  }

  if (outbox.id) {
    await markWecomOutboxAttempt(outbox.id).catch((error) => {
      console.warn("wecom_okr_outbox_attempt_write_failed", {
        eventType: params.eventType,
        sourceId: params.sourceId,
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
      console.warn("wecom_okr_outbox_result_write_failed", {
        eventType: params.eventType,
        sourceId: params.sourceId,
        outboxId: outbox.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }

  if (result.errcode !== 0) {
    console.warn("wecom_okr_notification_failed", {
      eventType: params.eventType,
      sourceId: params.sourceId,
      recipientUserId: params.recipientUserId,
      touser,
      errcode: result.errcode,
      errmsg: result.errmsg,
      invaliduser: result.invaliduser
    });
  }

  return result;
}

export async function notifyOkrProjectCreated(project: OkrProject, currentUser: User) {
  const recipients = new Map<string, OkrRecipient>();
  addRecipient(recipients, project.ownerId, "项目负责人", project.pdcaTasks[0]?.id);
  project.krs.forEach((kr) => addRecipient(recipients, kr.ownerId, `KR负责人(${kr.code})`, project.pdcaTasks.find((task) => task.krId === kr.id)?.id));
  project.pdcaTasks.forEach((task) => addRecipient(recipients, task.ownerId, `PDCA负责人(${task.pdcaStage})`, task.id));

  const eventAt = new Date().toISOString();
  const title = "新 OKR 待办已分配";

  return Promise.all(
    [...recipients.values()].map((recipient) => {
      const description = [
        `<div class=\"gray\">${escapeWecomText(eventAt)}</div>`,
        line("OKR项目", project.name),
        line("创建人", currentUser.name),
        line("项目负责人", project.owner),
        line("KR数量", `${project.krs.length} 项`),
        line("PDCA待办", `${project.pdcaTasks.length} 项`),
        line("你的角色", [...recipient.roles].join("、")),
        "<div class=\"highlight\">点击进入会议系统查看 OKR 待办。</div>"
      ].join("");

      return sendOkrTextcardNotification({
        eventType: "okr_project_created",
        sourceType: "okr_project",
        sourceId: project.id,
        recipientUserId: recipient.userId,
        dedupeKey: `okr_project_created:${project.id}:${eventAt}:${recipient.userId}`,
        title,
        description,
        btntxt: "查看 OKR",
        taskId: recipient.taskId,
        missingUserReason: "okr_project_recipient_not_found"
      });
    })
  );
}

export async function notifyOkrPdcaReviewSubmitted(project: OkrProject, task: OkrPDCATask, currentUser: User) {
  const reviewerId = task.reviewerId;
  const submittedAt = task.reviewSubmittedAt || new Date().toISOString();
  const title = "OKR 待办提交复核";
  const description = [
    `<div class=\"gray\">${escapeWecomText(submittedAt)}</div>`,
    line("OKR项目", project.name),
    line("待办", task.title),
    line("提交人", currentUser.name),
    line("复核人", getUserName(reviewerId)),
    line("目标状态", task.reviewTargetStatus),
    line("截止日期", task.endDate),
    "<div class=\"highlight\">点击进入会议系统处理 OKR 复核。</div>"
  ].join("");

  return sendOkrTextcardNotification({
    eventType: "okr_pdca_review_submitted",
    sourceType: "okr_pdca_task",
    sourceId: task.id,
    recipientUserId: reviewerId,
    dedupeKey: `okr_pdca_review_submitted:${task.id}:${submittedAt}:${reviewerId ?? "missing_reviewer"}`,
    title,
    description,
    btntxt: "进入复核",
    taskId: task.id,
    missingUserReason: "okr_pdca_reviewer_not_found"
  });
}

export async function notifyOkrPdcaReviewConfirmed(project: OkrProject, task: OkrPDCATask, currentUser: User) {
  const ownerId = task.ownerId;
  const reviewerId = task.reviewerId;
  const reviewedAt = task.reviewedAt || new Date().toISOString();
  const title = "OKR 待办复核通过";
  const description = [
    `<div class=\"gray\">${escapeWecomText(reviewedAt)}</div>`,
    line("OKR项目", project.name),
    line("待办", task.title),
    line("复核人", currentUser.name),
    line("当前状态", task.status),
    line("截止日期", task.endDate),
    "<div class=\"highlight\">点击进入会议系统查看 OKR 复核结果。</div>"
  ].join("");

  return sendOkrTextcardNotification({
    eventType: "okr_pdca_review_confirmed",
    sourceType: "okr_pdca_task",
    sourceId: task.id,
    recipientUserId: ownerId,
    dedupeKey: `okr_pdca_review_confirmed:${task.id}:${reviewedAt}:${ownerId ?? "missing_owner"}:${reviewerId ?? "missing_reviewer"}`,
    title,
    description,
    btntxt: "查看结果",
    taskId: task.id,
    missingUserReason: "okr_pdca_owner_not_found"
  });
}

export async function notifyOkrPdcaReviewRejected(project: OkrProject, task: OkrPDCATask, currentUser: User) {
  const ownerId = task.ownerId;
  const reviewerId = task.reviewerId;
  const rejectedAt = task.reviewRejectedAt || new Date().toISOString();
  const reason = compactText(task.reviewRejectedReason || task.reviewRejectedItems?.join("；")) ?? "请补充完成内容后重新提交复核。";
  const title = "OKR 待办复核驳回";
  const description = [
    `<div class=\"gray\">${escapeWecomText(rejectedAt)}</div>`,
    line("OKR项目", project.name),
    line("待办", task.title),
    line("复核人", currentUser.name),
    line("驳回原因", reason),
    line("当前状态", task.status),
    "<div class=\"highlight\">点击进入会议系统处理 OKR 驳回。</div>"
  ].join("");

  return sendOkrTextcardNotification({
    eventType: "okr_pdca_review_rejected",
    sourceType: "okr_pdca_task",
    sourceId: task.id,
    recipientUserId: ownerId,
    dedupeKey: `okr_pdca_review_rejected:${task.id}:${rejectedAt}:${ownerId ?? "missing_owner"}:${reviewerId ?? "missing_reviewer"}`,
    title,
    description,
    btntxt: "处理驳回",
    taskId: task.id,
    missingUserReason: "okr_pdca_owner_not_found"
  });
}
