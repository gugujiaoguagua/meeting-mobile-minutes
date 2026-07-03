import { getPresidentUserId, getTaskOwnerId, getTaskReviewerId } from "@/lib/permission";
import { users as fallbackUsers } from "@/lib/orgPeopleData";
import type { OkrPDCATask, OkrProject, OkrTaskStatus } from "@/lib/okrTypes";
import type { ActivityLog, Meeting, Task, User } from "@/lib/types";
import type { MobileMessage, MobileMinuteCard, MobileTask, MobileTaskActionKind, TaskTab, Tone } from "./mobileMinutesTypes";

function shortTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function meetingDateLabel(value?: string) {
  if (!value) return "未设置时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const label = sameDay ? "今天" : `${date.getMonth() + 1}/${date.getDate()}`;
  return `${label} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function meetingStatus(meeting: Meeting): { status: string; tone: Tone } {
  if (meeting.approvalStatus === "rejected") return { status: "已驳回", tone: "risk" };
  if (meeting.status === "closed") return { status: "已闭环", tone: "success" };
  if (meeting.status === "summarized" || meeting.minuteMarkdown || meeting.aiSummary || meeting.summary) {
    return { status: "已生成", tone: "success" };
  }
  return { status: "待确认", tone: "wait" };
}

function meetingDurationText(meeting: Meeting) {
  if (!meeting.durationMinutes || meeting.durationMinutes <= 0) return "未计时";
  return `${meeting.durationMinutes} 分钟`;
}

export function isMobileDisplayMeeting(meeting: Meeting) {
  const marker = `${meeting.id} ${meeting.title}`.toUpperCase();
  return !marker.includes("MOBILE_STAGE6_TEST");
}

function toneFromAction(action: string): Tone {
  if (action.includes("reject") || action.includes("驳回")) return "risk";
  if (action.includes("approve") || action.includes("completed") || action.includes("通过")) return "success";
  if (action.includes("review") || action.includes("pending") || action.includes("submit")) return "wait";
  return "normal";
}

function timeValue(value?: string) {
  if (!value) return 0;
  const normalized = value.length <= 10 ? `${value}T00:00:00` : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function taskTone(task: Task): Tone {
  if (task.status === "completed" || task.status === "已完成") return "success";
  if (task.approvalStatus === "rejected" || task.status === "blocked" || task.status === "overdue") return "risk";
  if (task.status === "in_progress" || task.status === "进行中") return "navy";
  return "wait";
}

function taskStatusText(task: Task) {
  if (task.approvalStatus === "rejected") return "驳回";
  if (task.approvalStatus === "pending_president_approval") return "待签批";
  if (task.status === "pending_review") return "待复核";
  if (task.status === "completed" || task.status === "已完成") return "已完成";
  if (task.status === "in_progress" || task.status === "进行中") return "进行中";
  if (task.status === "not_started" || task.status === "未开始") return "未开始";
  if (task.approvalStatus === "approved" || task.approvalStatus === "in_closed_loop") return "签批通过";
  return "待处理";
}

function taskTab(task: Task, currentUser?: User, meeting?: Meeting): TaskTab {
  if (task.status === "completed" || task.status === "已完成" || task.approvalStatus === "rejected") {
    return "done";
  }
  if (task.approvalStatus === "pending_president_approval") return "approval";
  if (task.status === "pending_review" && (!currentUser || getTaskReviewerId(task, meeting) === currentUser.id || task.reviewerId === currentUser.id)) return "review";
  return "mine";
}

function taskActionKind(task: Task, tab: TaskTab, currentUser?: User): MobileTaskActionKind {
  if (tab === "approval") return "approval";
  if (tab === "review") return "review";
  if (tab === "done") return "view";
  if (currentUser && getTaskOwnerId(task) !== currentUser.id) return "view";
  if (task.status === "pending_review") return "view";
  if (task.companySupportRequest && task.companySupportStatus !== "completed") return "support";
  if (task.completionItems?.length) return "submit_review";
  return "completion";
}

function taskAction(task: Task, tab: TaskTab, currentUser?: User) {
  const kind = taskActionKind(task, tab, currentUser);
  if (kind === "approval") return "签批通过 / 驳回";
  if (kind === "review") return "通过 / 驳回";
  if (kind === "support") return "完成公司支持";
  if (kind === "submit_review") return "提交复核";
  if (kind === "completion") return "填写完成";
  return "查看详情";
}

function okrTaskTone(task: OkrPDCATask): Tone {
  if (task.status === "已完成") return "success";
  if (task.status === "已延期" || task.status === "阻塞中") return "risk";
  if (task.status === "进行中") return "navy";
  return "wait";
}

function okrStatusText(status: OkrTaskStatus) {
  if (status === "已提交待复核") return "待复核";
  if (status === "已取消") return "已取消";
  return status;
}

function okrTaskTab(task: OkrPDCATask, currentUser?: User): TaskTab | undefined {
  const isOwner = !currentUser || task.ownerId === currentUser.id;
  const isReviewer = !currentUser || task.reviewerId === currentUser.id;
  if (task.status === "已完成" || task.status === "已取消") return isOwner || isReviewer ? "done" : undefined;
  if (task.status === "已提交待复核" && isReviewer) return "review";
  if (isOwner) return "mine";
  return undefined;
}

function okrTaskActionKind(task: OkrPDCATask, tab: TaskTab): MobileTaskActionKind {
  if (tab === "review") return "review";
  if (tab === "done") return "view";
  if (task.status === "已提交待复核") return "view";
  if (task.completionItems?.length) return "submit_review";
  return "completion";
}

function okrTaskAction(task: OkrPDCATask, tab: TaskTab) {
  const kind = okrTaskActionKind(task, tab);
  if (kind === "review") return "通过 / 驳回";
  if (kind === "submit_review") return "提交复核";
  if (kind === "completion") return "填写完成";
  return "查看详情";
}

function userName(userId?: string, userDirectory: User[] = fallbackUsers) {
  if (!userId) return "未指定";
  return userDirectory.find((user) => user.id === userId)?.name ?? fallbackUsers.find((user) => user.id === userId)?.name ?? userId;
}

function taskContent(task: Task) {
  return task.content || task.title || "未命名任务";
}

function meetingTitle(task: Task, meeting?: Meeting) {
  return meeting?.title || task.sourceMeetingId || task.meetingId || "会议纪要";
}

function taskDescription(task: Task) {
  return task.description || task.sourceText || task.goal || "来自后端任务池";
}

function mergeMeetingTasks(tasks: Task[], meetings: Meeting[]) {
  const merged = new Map<string, { task: Task; meeting?: Meeting }>();
  tasks.forEach((task) => merged.set(task.id, { task, meeting: meetings.find((item) => item.id === task.meetingId) }));
  meetings.forEach((meeting) => {
    (meeting.tasks ?? []).forEach((task) => merged.set(task.id, { task: { ...task, meetingId: task.meetingId || meeting.id }, meeting }));
  });
  return [...merged.values()];
}

function normalizeReviewTargetStatus(status?: Task["status"]): Task["status"] {
  if (status === "completed" || status === "已完成") return "completed";
  if (status === "in_progress" || status === "进行中") return "in_progress";
  if (status === "blocked") return "blocked";
  if (status === "not_started" || status === "未开始") return "not_started";
  return "completed";
}

function inferReviewTargetStatus(task: Task, activityLogs: ActivityLog[] = []) {
  if (task.reviewTargetStatus) return normalizeReviewTargetStatus(task.reviewTargetStatus);
  const submitLog = activityLogs.find((log) => log.taskId === task.id && log.action === "submit_review");
  return normalizeReviewTargetStatus(submitLog?.fromStatus as Task["status"] | undefined);
}

function reviewTargetLabel(status: Task["status"]) {
  return normalizeReviewTargetStatus(status) === "completed" ? "完成" : "进度";
}

function isTaskCompleted(task: Task) {
  return task.status === "completed" || task.status === "已完成";
}

function notificationForUser(recipientIds: string[], currentUser?: User) {
  if (!currentUser) return true;
  return recipientIds.length === 0 || recipientIds.includes(currentUser.id);
}

type MobileNotificationSeed = Omit<MobileMessage, "time" | "isRead"> & {
  rawTime?: string;
  actorId?: string;
  recipientIds: string[];
};

function makeMessage(seed: MobileNotificationSeed, readSet: Set<string>, currentUser?: User): MobileMessage | undefined {
  if (!notificationForUser(seed.recipientIds, currentUser)) return undefined;
  return {
    id: seed.id,
    title: seed.title,
    source: seed.source,
    time: shortTime(seed.rawTime),
    body: seed.body,
    actionLabel: seed.actionLabel,
    tone: seed.tone,
    taskId: seed.taskId,
    meetingId: seed.meetingId,
    isRead: readSet.has(seed.id) || seed.actorId === currentUser?.id,
    sortTime: "sortTime" in seed && typeof seed.sortTime === "number" ? seed.sortTime : timeValue(seed.rawTime)
  };
}

export function mapBackendNotificationsToMessages({
  meetings,
  tasks,
  activityLogs,
  readIds = [],
  currentUser,
  userDirectory = fallbackUsers
}: {
  meetings: Meeting[];
  tasks: Task[];
  activityLogs: ActivityLog[];
  readIds?: string[];
  currentUser?: User;
  userDirectory?: User[];
}): MobileMessage[] {
  const readSet = new Set(readIds);
  const items: Array<MobileNotificationSeed & { sortTime: number }> = [];
  const mergedTasks = mergeMeetingTasks(tasks, meetings);

  meetings.forEach((meeting) => {
    (meeting.tasks ?? []).forEach((task) => {
      const ownerId = getTaskOwnerId(task);
      const reviewerId = getTaskReviewerId(task, meeting);
      const ownerName = userName(ownerId, userDirectory);
      const reviewerName = userName(reviewerId, userDirectory);
      if (task.approvalStatus === "pending_president_approval") {
        const rawTime = task.updatedAt || meeting.createdAt;
        items.push({
          id: `approval-pending-${task.id}`,
          title: "待办已提交总裁签批",
          source: ownerName,
          rawTime,
          sortTime: timeValue(rawTime),
          body: `会议《${meeting.title}》的待办「${taskContent(task)}」已进入待签批池。推进人：${ownerName}；复核人：${reviewerName}。`,
          actionLabel: "查看待办",
          tone: "wait",
          meetingId: meeting.id,
          taskId: task.id,
          actorId: ownerId,
          recipientIds: [getPresidentUserId()]
        });
      }
      if (task.approvalStatus === "rejected") {
        const rawTime = task.updatedAt || meeting.createdAt;
        items.push({
          id: `approval-rejected-${task.id}`,
          title: "待办被驳回修改",
          source: "林昱辰",
          rawTime,
          sortTime: timeValue(rawTime),
          body: `会议《${meeting.title}》的待办「${taskContent(task)}」被驳回。原因：${task.rejectedReason || meeting.rejectedReason || "请补充责任边界和时间要求后重新提交。"}`,
          actionLabel: "查看待办",
          tone: "risk",
          meetingId: meeting.id,
          taskId: task.id,
          actorId: getPresidentUserId(),
          recipientIds: [ownerId]
        });
      }
    });
  });

  mergedTasks.forEach(({ task, meeting }) => {
    const sourceTitle = meetingTitle(task, meeting);
    const ownerId = getTaskOwnerId(task);
    const reviewerId = getTaskReviewerId(task, meeting);
    const ownerName = userName(ownerId, userDirectory);
    const reviewerName = userName(reviewerId, userDirectory);
    const approvedForClosedLoop = task.approvalStatus === "in_closed_loop" || task.approvalStatus === "approved";
    const enteredReviewFlow = task.status === "pending_review" || Boolean(task.reviewSubmittedAt || task.reviewedAt || task.reviewRejectedAt);

    if (approvedForClosedLoop && !enteredReviewFlow) {
      const rawTime = task.updatedAt || meeting?.createdAt || task.createdAt;
      items.push({
        id: `approval-approved-${task.id}`,
        title: "待办签批通过",
        source: "林昱辰",
        rawTime,
        sortTime: timeValue(rawTime),
        body: `会议《${sourceTitle}》的待办「${taskContent(task)}」已进入正式会议闭环台账。推进人：${ownerName}；复核人：${reviewerName}；当前状态：${taskStatusText(task)}。`,
        actionLabel: "查看待办",
        tone: "success",
        meetingId: task.meetingId,
        taskId: task.id,
        actorId: getPresidentUserId(),
        recipientIds: [...new Set([ownerId, reviewerId].filter(Boolean))]
      });
    }

    if (task.status === "pending_review") {
      const targetLabel = reviewTargetLabel(inferReviewTargetStatus(task, activityLogs));
      const rawTime = task.reviewSubmittedAt || task.updatedAt;
      items.push({
        id: `review-pending-${task.id}-${rawTime}`,
        title: `待办已提交${targetLabel}复核`,
        source: ownerName,
        rawTime,
        sortTime: timeValue(rawTime),
        body: `会议《${sourceTitle}》的待办「${taskContent(task)}」已由推进人 ${ownerName} 提交${targetLabel}，等待复核人 ${reviewerName} 确认。`,
        actionLabel: "查看待办",
        tone: "wait",
        meetingId: task.meetingId,
        taskId: task.id,
        actorId: ownerId,
        recipientIds: [reviewerId]
      });
    }

    if (task.reviewedAt) {
      const rawTime = task.reviewedAt;
      items.push({
        id: `review-approved-${task.id}-${rawTime}`,
        title: "待办复核通过",
        source: reviewerName,
        rawTime,
        sortTime: timeValue(rawTime),
        body: isTaskCompleted(task)
          ? `会议《${sourceTitle}》的待办「${taskContent(task)}」已由复核人 ${reviewerName} 确认完成，并正式归档。`
          : `会议《${sourceTitle}》的待办「${taskContent(task)}」已由复核人 ${reviewerName} 确认进度，当前继续推进。`,
        actionLabel: "查看待办",
        tone: "success",
        meetingId: task.meetingId,
        taskId: task.id,
        actorId: reviewerId,
        recipientIds: [ownerId]
      });
    }

    if (task.reviewRejectedAt) {
      const rawTime = task.reviewRejectedAt;
      items.push({
        id: `review-rejected-${task.id}-${rawTime}`,
        title: "待办复核驳回",
        source: reviewerName,
        rawTime,
        sortTime: timeValue(rawTime),
        body: `会议《${sourceTitle}》的待办「${taskContent(task)}」被复核人 ${reviewerName} 驳回。原因：${task.reviewRejectedReason || "请补充完成内容后重新提交复核。"}`,
        actionLabel: "查看待办",
        tone: "risk",
        meetingId: task.meetingId,
        taskId: task.id,
        actorId: reviewerId,
        recipientIds: [ownerId]
      });
    }

    if (task.companySupportStatus === "completed") {
      const rawTime = task.companySupportCompletedAt || task.updatedAt;
      items.push({
        id: `support-completed-${task.id}`,
        title: "公司支持事项已完成",
        source: "总裁办",
        rawTime,
        sortTime: timeValue(rawTime),
        body: `会议《${sourceTitle}》的公司支持事项「${task.companySupportRequest || taskContent(task)}」已标记为已完成，可继续推进对应待办。`,
        actionLabel: "查看待办",
        tone: "navy",
        meetingId: task.meetingId,
        taskId: task.id,
        actorId: getPresidentUserId(),
        recipientIds: [ownerId]
      });
    }
  });

  return items
    .sort((a, b) => b.sortTime - a.sortTime || b.id.localeCompare(a.id))
    .map((item) => makeMessage(item, readSet, currentUser))
    .filter((item): item is MobileMessage => Boolean(item))
    .slice(0, 30);
}

export function mapMeetingsToMobileMinuteCards(meetings: Meeting[]): MobileMinuteCard[] {
  return [...meetings]
    .filter(isMobileDisplayMeeting)
    .sort((a, b) => timeValue(b.startTime || b.createdAt) - timeValue(a.startTime || a.createdAt))
    .slice(0, 20)
    .map((meeting) => {
      const state = meetingStatus(meeting);
      return {
        id: meeting.id,
        title: meeting.title || "未命名会议",
        meta: `${meetingDateLabel(meeting.startTime || meeting.createdAt)} · ${meetingDurationText(meeting)}`,
        status: state.status,
        tone: state.tone,
        rawMeeting: meeting
      };
    });
}

export function mapActivityLogsToMessages(activityLogs: ActivityLog[], readIds: string[] = []): MobileMessage[] {
  const readSet = new Set(readIds);
  return activityLogs.slice(0, 30).map((log) => ({
    id: log.id,
    title: log.title || "业务消息",
    source: log.actorName || log.meetingId || log.taskId || "会议闭环系统",
    time: shortTime(log.createdAt),
    body: log.detail || log.action,
    actionLabel: log.taskId ? "查看待办" : "查看详情",
    tone: toneFromAction(log.action),
    taskId: log.taskId,
    meetingId: log.meetingId,
    isRead: readSet.has(log.id),
    sortTime: timeValue(log.createdAt)
  }));
}

export function mergeMobileMessages(messages: MobileMessage[], readIds: string[] = []): MobileMessage[] {
  const readSet = new Set(readIds);
  const byId = new Map<string, MobileMessage>();
  messages.forEach((message) => {
    byId.set(message.id, {
      ...message,
      isRead: message.isRead || readSet.has(message.id)
    });
  });

  return [...byId.values()]
    .sort((a, b) => (b.sortTime ?? 0) - (a.sortTime ?? 0) || b.id.localeCompare(a.id))
    .slice(0, 40);
}

export function mapTasksToMobileTasks(tasks: Task[], currentUser?: User, meetings: Meeting[] = [], userDirectory: User[] = fallbackUsers): MobileTask[] {
  return mergeMeetingTasks(tasks, meetings).slice(0, 120).map(({ task, meeting }) => {
    const tab = taskTab(task, currentUser, meeting);
    const actionKind = taskActionKind(task, tab, currentUser);
    return {
      id: task.id,
      sourceKind: "meeting",
      title: task.title || task.content || "未命名任务",
      source: meetingTitle(task, meeting),
      meetingTitle: meeting?.title,
      owner: userName(getTaskOwnerId(task), userDirectory),
      reviewer: userName(getTaskReviewerId(task, meeting), userDirectory),
      due: task.dueDate || "未设置",
      status: taskStatusText(task),
      latestAction: task.reviewRejectedReason || task.rejectedReason || taskDescription(task),
      actionLabel: taskAction(task, tab, currentUser),
      actionKind,
      tone: taskTone(task),
      tab,
      isCurrentUserOwner: currentUser ? getTaskOwnerId(task) === currentUser.id : undefined,
      description: taskDescription(task),
      goal: task.goal,
      completionItems: task.completionItems ?? [],
      reviewRejectedItems: task.reviewRejectedItems ?? [],
      companySupportRequest: task.companySupportRequest,
      rawTask: task,
      rawMeeting: meeting
    };
  });
}

export function mapOkrProjectsToMobileTasks(projects: OkrProject[], currentUser?: User, userDirectory: User[] = fallbackUsers): MobileTask[] {
  const mappedTasks: MobileTask[] = [];
  projects.forEach((project) => {
    (project.pdcaTasks ?? []).forEach((task) => {
        const tab = okrTaskTab(task, currentUser);
        if (!tab) return;
        const kr = project.krs.find((item) => item.id === task.krId);
        const actionKind = okrTaskActionKind(task, tab);
        const latestAction = task.reviewRejectedReason || task.deliverable || task.content || "来自 OKR 待办";
        mappedTasks.push({
          id: task.id,
          sourceKind: "okr" as const,
          title: task.title || task.content || "未命名 OKR 待办",
          source: `${project.name}${kr?.code ? ` / ${kr.code}` : ""}`,
          meetingTitle: project.name,
          owner: task.owner || userName(task.ownerId, userDirectory),
          reviewer: task.reviewer || userName(task.reviewerId, userDirectory),
          due: task.endDate || project.endDate || "未设置",
          status: okrStatusText(task.status),
          latestAction,
          actionLabel: okrTaskAction(task, tab),
          actionKind,
          tone: okrTaskTone(task),
          tab,
          isCurrentUserOwner: currentUser ? task.ownerId === currentUser.id : undefined,
          description: task.content || task.deliverable || "来自 OKR PDCA 待办",
          goal: task.deliverable ? `交付物：${task.deliverable}` : kr?.title,
          completionItems: task.completionItems ?? [],
          reviewRejectedItems: task.reviewRejectedItems ?? [],
          rawOkrTask: task,
          rawOkrProject: project
        });
      });
  });
  return mappedTasks
    .sort((a, b) => timeValue(b.rawOkrTask?.reviewSubmittedAt || b.rawOkrTask?.startDate || b.rawOkrTask?.endDate) - timeValue(a.rawOkrTask?.reviewSubmittedAt || a.rawOkrTask?.startDate || a.rawOkrTask?.endDate));
}
