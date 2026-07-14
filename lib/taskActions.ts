import { getTaskDepartmentId, getTaskOwnerId, getTaskReviewerId } from "@/lib/permission";
import { users } from "@/lib/orgPeopleData";
import type { ActivityLog, ApprovalStatus, Department, Meeting, Task, TaskProgressEntry, TaskStatus, User } from "@/lib/types";

type TaskActionResult = {
  stateTasks: Task[];
  stateMeetings: Meeting[];
  activityLogs: ActivityLog[];
  task: Task;
};

type TaskActionState = {
  users?: User[];
  departments?: Department[];
  meetings: Meeting[];
  tasks: Task[];
  activityLogs: ActivityLog[];
};

function currentDateTime() {
  return new Date().toISOString();
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getTaskContent(task: Task) {
  return task.content ?? task.title;
}

function getTaskDescription(task: Task) {
  const base = task.description || task.sourceText || "来自会议闭环模板";
  return task.goal ? `${base} 目标：${task.goal}` : base;
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

function getApprovalStatusLabel(status?: ApprovalStatus) {
  const map: Record<string, string> = {
    draft: "草稿",
    ai_generated: "AI生成",
    supervisor_edited: "主管已修改",
    pending_president_approval: "待总裁签批",
    approved: "已签批",
    rejected: "已驳回",
    in_closed_loop: "进入闭环"
  };
  return status ? map[status] ?? status : "未设置";
}

function findTask(state: TaskActionState, taskId: string) {
  return state.tasks.find((task) => task.id === taskId) ?? state.meetings.flatMap((meeting) => meeting.tasks ?? []).find((task) => task.id === taskId);
}

function findMeeting(state: TaskActionState, task: Task) {
  return state.meetings.find((meeting) => meeting.id === task.meetingId);
}

function replaceTaskEverywhere(state: TaskActionState, nextTask: Task) {
  return {
    stateTasks: state.tasks.map((task) => (task.id === nextTask.id ? nextTask : task)),
    stateMeetings: state.meetings.map((meeting) => ({
      ...meeting,
      tasks: meeting.tasks?.map((task) => (task.id === nextTask.id ? nextTask : task))
    }))
  };
}

function getTaskCollaboratorDepartmentIds(task: Task) {
  return task.collaboratorDepartments ?? task.collaboratorDepartmentIds ?? [];
}

function permissionDirectory(state: TaskActionState) {
  return { users: state.users?.length ? state.users : users, departments: state.departments };
}

function getUserDepartmentId(state: TaskActionState, userId?: string) {
  return userId ? permissionDirectory(state).users.find((user) => user.id === userId)?.departmentId : undefined;
}

function assertTaskOwner(state: TaskActionState, currentUser: User, task: Task) {
  if (getTaskOwnerId(task, permissionDirectory(state)) !== currentUser.id) {
    throw new Error("forbidden_owner");
  }
}

function assertTaskReviewer(state: TaskActionState, currentUser: User, task: Task, meeting?: Meeting) {
  if (getTaskReviewerId(task, meeting, permissionDirectory(state)) !== currentUser.id) {
    throw new Error("forbidden_reviewer");
  }
}

function assertPresident(currentUser: User) {
  if (currentUser.role !== "总裁") {
    throw new Error("forbidden_president");
  }
}

function canManagerDeleteTask(state: TaskActionState, currentUser: User, task: Task, meeting?: Meeting) {
  const departmentId = currentUser.departmentId;
  if (!departmentId) return false;
  const directory = permissionDirectory(state);
  return (
    getTaskDepartmentId(task, directory) === departmentId ||
    getUserDepartmentId(state, getTaskOwnerId(task, directory)) === departmentId ||
    getUserDepartmentId(state, getTaskReviewerId(task, meeting, directory)) === departmentId ||
    getTaskCollaboratorDepartmentIds(task).includes(departmentId)
  );
}

function assertTaskDeletePermission(state: TaskActionState, currentUser: User, task: Task, meeting?: Meeting) {
  if (currentUser.role === "总裁") return;
  if (currentUser.role === "部门负责人" && canManagerDeleteTask(state, currentUser, task, meeting)) return;
  throw new Error("forbidden_delete_task");
}

function appendLog(state: TaskActionState, log: Omit<ActivityLog, "id">) {
  return [{ id: nextId("activity"), ...log }, ...state.activityLogs].slice(0, 300);
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

export function saveTaskCompletionItems(state: TaskActionState, currentUser: User, taskId: string, completionItems: string[]): TaskActionResult {
  const task = findTask(state, taskId);
  if (!task) throw new Error("task_not_found");
  assertTaskOwner(state, currentUser, task);

  const changedAt = currentDateTime();
  const normalizedItems = completionItems.map((item) => item.trim()).filter(Boolean);
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
  const nextTask: Task = {
    ...task,
    completionItems: normalizedItems,
    completionHistory: preservedEntry ? [...(task.completionHistory ?? []), preservedEntry] : task.completionHistory,
    updatedAt: changedAt
  };
  const nextParts = replaceTaskEverywhere(state, nextTask);
  return {
    ...nextParts,
    task: nextTask,
    activityLogs: appendLog(state, {
      action: "update_task_completion_items",
      title: "填写任务完成内容",
      detail: `待办「${getTaskContent(task)}」更新了 ${normalizedItems.length} 条完成内容。`,
      meetingId: task.meetingId,
      taskId: task.id,
      actorId: currentUser.id,
      actorName: currentUser.name,
      createdAt: changedAt
    })
  };
}

export function deleteTaskAction(state: TaskActionState, currentUser: User, taskId: string): TaskActionResult {
  const task = findTask(state, taskId);
  if (!task) throw new Error("task_not_found");
  const meeting = findMeeting(state, task);
  assertTaskDeletePermission(state, currentUser, task, meeting);

  const deletedAt = currentDateTime();
  const stateTasks = state.tasks.filter((item) => item.id !== taskId);
  const stateMeetings = state.meetings.map((item) => ({
    ...item,
    tasks: item.tasks?.filter((meetingTask) => meetingTask.id !== taskId)
  }));

  return {
    stateTasks,
    stateMeetings,
    task,
    activityLogs: appendLog(state, {
      action: "delete_task",
      title: "删除待办",
      detail: `${currentUser.name} 删除待办「${getTaskContent(task)}」。`,
      meetingId: task.meetingId,
      taskId: task.id,
      actorId: currentUser.id,
      actorName: currentUser.name,
      fromStatus: getTaskStatusLabel(task.status),
      toStatus: "已删除",
      createdAt: deletedAt
    })
  };
}

export function submitTaskReview(state: TaskActionState, currentUser: User, taskId: string, status: TaskStatus): TaskActionResult {
  const task = findTask(state, taskId);
  if (!task) throw new Error("task_not_found");
  assertTaskOwner(state, currentUser, task);

  const changedAt = currentDateTime();
  const meeting = findMeeting(state, task);
  const reviewTargetStatus = status === "pending_review" ? normalizeReviewTargetStatus(task.status) : normalizeReviewTargetStatus(status);
  const reviewTargetLabel = getReviewTargetLabel(reviewTargetStatus);
  const reviewerId = getTaskReviewerId(task, meeting, permissionDirectory(state));
  const progressEntry = createTaskProgressEntry(task, changedAt, reviewTargetStatus);
  const nextTask: Task = {
    ...task,
    status: "pending_review",
    reviewerId,
    reviewSubmittedAt: changedAt,
    reviewTargetStatus,
    reviewRejectedAt: undefined,
    reviewRejectedReason: undefined,
    reviewRejectedItems: undefined,
    completionHistory: progressEntry ? [...(task.completionHistory ?? []), progressEntry] : task.completionHistory,
    updatedAt: changedAt
  };
  const nextParts = replaceTaskEverywhere(state, nextTask);
  let activityLogs = appendLog(state, {
    action: "submit_review",
    title: `提交${reviewTargetLabel}复核`,
    detail: `待办「${getTaskContent(task)}」从 ${getTaskStatusLabel(task.status)} 变更为 待复核：${reviewTargetLabel}。`,
    meetingId: task.meetingId,
    taskId: task.id,
    actorId: currentUser.id,
    actorName: currentUser.name,
    fromStatus: getTaskStatusLabel(task.status),
    toStatus: `待复核：${reviewTargetLabel}`,
    createdAt: changedAt
  });
  if (currentUser.id === reviewerId) {
    activityLogs = [
      {
        id: nextId("activity"),
        action: "same_owner_reviewer_warning",
        title: "推进人与复核人相同",
        detail: `待办「${getTaskContent(task)}」的推进人与复核人都是 ${currentUser.name}，正式规则需要确认是否允许同人复核。`,
        meetingId: task.meetingId,
        taskId: task.id,
        actorId: currentUser.id,
        actorName: currentUser.name,
        createdAt: changedAt
      },
      ...activityLogs
    ].slice(0, 300);
  }
  return { ...nextParts, task: nextTask, activityLogs };
}

export function confirmTaskReviewAction(state: TaskActionState, currentUser: User, taskId: string): TaskActionResult {
  const task = findTask(state, taskId);
  if (!task) throw new Error("task_not_found");
  const meeting = findMeeting(state, task);
  assertTaskReviewer(state, currentUser, task, meeting);

  const changedAt = currentDateTime();
  const reviewTargetStatus = inferReviewTargetStatus(task, state.activityLogs);
  const reviewTargetLabel = getReviewTargetLabel(reviewTargetStatus);
  const nextTask: Task = {
    ...task,
    status: reviewTargetStatus,
    reviewerId: getTaskReviewerId(task, meeting, permissionDirectory(state)),
    reviewTargetStatus: undefined,
    reviewedAt: changedAt,
    reviewRejectedAt: undefined,
    reviewRejectedReason: undefined,
    reviewRejectedItems: undefined,
    updatedAt: changedAt
  };
  const nextParts = replaceTaskEverywhere(state, nextTask);
  return {
    ...nextParts,
    task: nextTask,
    activityLogs: appendLog(state, {
      action: "confirm_review",
      title: `复核确认${reviewTargetLabel}`,
      detail: `复核人 ${currentUser.name} 确认待办「${getTaskContent(task)}」${reviewTargetLabel}。`,
      meetingId: task.meetingId,
      taskId: task.id,
      actorId: currentUser.id,
      actorName: currentUser.name,
      fromStatus: getTaskStatusLabel(task.status),
      toStatus: getTaskStatusLabel(reviewTargetStatus),
      createdAt: changedAt
    })
  };
}

export function rejectTaskReviewAction(state: TaskActionState, currentUser: User, taskId: string, reasonItems: string[]): TaskActionResult {
  const task = findTask(state, taskId);
  if (!task) throw new Error("task_not_found");
  const meeting = findMeeting(state, task);
  assertTaskReviewer(state, currentUser, task, meeting);

  const changedAt = currentDateTime();
  const normalizedItems = reasonItems.map((item) => item.trim()).filter(Boolean);
  const reason = normalizedItems.join("；") || "复核未通过，请补充任务完成内容后重新提交复核。";
  const reviewTargetStatus = inferReviewTargetStatus(task, state.activityLogs);
  const rollbackStatus = reviewTargetStatus === "completed" ? "in_progress" : normalizeReviewTargetStatus(reviewTargetStatus);
  const nextTask: Task = {
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
  const nextParts = replaceTaskEverywhere(state, nextTask);
  return {
    ...nextParts,
    task: nextTask,
    activityLogs: appendLog(state, {
      action: "reject_review",
      title: "复核驳回任务",
      detail: `复核人 ${currentUser.name} 驳回待办「${getTaskContent(task)}」。原因：${reason}`,
      meetingId: task.meetingId,
      taskId: task.id,
      actorId: currentUser.id,
      actorName: currentUser.name,
      fromStatus: getTaskStatusLabel(task.status),
      toStatus: getTaskStatusLabel(rollbackStatus),
      createdAt: changedAt
    })
  };
}

export function approveTaskAction(state: TaskActionState, currentUser: User, taskId: string): TaskActionResult {
  assertPresident(currentUser);
  const sourceMeeting = state.meetings.find((meeting) => meeting.tasks?.some((task) => task.id === taskId));
  const sourceTask = sourceMeeting?.tasks?.find((task) => task.id === taskId);
  if (!sourceMeeting || !sourceTask) throw new Error("task_not_found");

  const approvedAt = currentDateTime();
  const directory = permissionDirectory(state);
  const ownerId = getTaskOwnerId(sourceTask, directory);
  const departmentId = getUserDepartmentId(state, ownerId) ?? getTaskDepartmentId(sourceTask, directory);
  const approvedTask: Task = {
    ...sourceTask,
    meetingId: sourceMeeting.id,
    title: getTaskContent(sourceTask),
    description: getTaskDescription(sourceTask),
    owner: ownerId,
    ownerId,
    ownerDepartment: departmentId,
    departmentId,
    reviewerId: getTaskReviewerId({ ...sourceTask, owner: ownerId, ownerId, ownerDepartment: departmentId, departmentId }, sourceMeeting, directory),
    collaboratorDepartmentIds: getTaskCollaboratorDepartmentIds(sourceTask),
    status: "not_started",
    approvalStatus: "in_closed_loop",
    rejectedReason: undefined,
    createdAt: sourceTask.createdAt || approvedAt,
    updatedAt: approvedAt
  };

  const stateMeetings = state.meetings.map((meeting) => {
    if (meeting.id !== sourceMeeting.id) return meeting;
    const nextTasks = (meeting.tasks ?? []).filter((task) => task.id !== taskId);
    const allApproved = nextTasks.length === 0;
    const hasRejected = nextTasks.some((task) => task.approvalStatus === "rejected");
    return {
      ...meeting,
      tasks: nextTasks,
      approvalStatus: (allApproved ? "in_closed_loop" : hasRejected ? "rejected" : "pending_president_approval") as ApprovalStatus,
      status: allApproved ? "closed" : meeting.status,
      approvedBy: allApproved ? currentUser.id : meeting.approvedBy,
      approvedAt: allApproved ? approvedAt : meeting.approvedAt
    };
  });

  const stateTasks = [approvedTask, ...state.tasks.filter((task) => task.id !== taskId)];
  return {
    stateMeetings,
    stateTasks,
    task: approvedTask,
    activityLogs: appendLog(state, {
      action: "approve_task",
      title: "总裁签批通过待办",
      detail: `会议《${sourceMeeting.title}》的待办「${getTaskContent(sourceTask)}」已签批通过并进入正式台账。`,
      meetingId: sourceMeeting.id,
      taskId,
      actorId: currentUser.id,
      actorName: currentUser.name,
      fromStatus: getApprovalStatusLabel(sourceTask.approvalStatus),
      toStatus: getApprovalStatusLabel("in_closed_loop"),
      createdAt: approvedAt
    })
  };
}

export function rejectTaskApprovalAction(state: TaskActionState, currentUser: User, taskId: string, reason?: string): TaskActionResult {
  assertPresident(currentUser);
  const rejectedAt = currentDateTime();
  const sourceMeeting = state.meetings.find((meeting) => meeting.tasks?.some((task) => task.id === taskId));
  const sourceTask = sourceMeeting?.tasks?.find((task) => task.id === taskId);
  if (!sourceMeeting || !sourceTask) throw new Error("task_not_found");
  const rejectedReason = reason?.trim() || "待办推进人、复核人、开始时间或截止日期不符合签批要求，请部门主管重新修改后提交。";

  let rejectedTask: Task = sourceTask;
  const stateMeetings = state.meetings.map((meeting) => {
    if (!meeting.tasks?.some((task) => task.id === taskId)) return meeting;
    const nextTasks = meeting.tasks.map((task) => {
      if (task.id !== taskId) return task;
      rejectedTask = {
        ...task,
        approvalStatus: "rejected",
        rejectedReason,
        updatedAt: rejectedAt
      };
      return rejectedTask;
    });
    return {
      ...meeting,
      tasks: nextTasks,
      approvalStatus: "rejected" as ApprovalStatus,
      rejectedReason
    };
  });

  return {
    stateMeetings,
    stateTasks: state.tasks,
    task: rejectedTask,
    activityLogs: appendLog(state, {
      action: "reject_task",
      title: "总裁驳回待办",
      detail: `会议《${sourceMeeting.title}》的待办「${getTaskContent(sourceTask)}」被驳回。原因：${rejectedReason}`,
      meetingId: sourceMeeting.id,
      taskId,
      actorId: currentUser.id,
      actorName: currentUser.name,
      fromStatus: getApprovalStatusLabel(sourceTask.approvalStatus),
      toStatus: getApprovalStatusLabel("rejected"),
      createdAt: rejectedAt
    })
  };
}

export function completeCompanySupportAction(state: TaskActionState, currentUser: User, taskId: string): TaskActionResult {
  assertPresident(currentUser);
  const task = findTask(state, taskId);
  if (!task) throw new Error("task_not_found");

  const changedAt = currentDateTime();
  const nextTask: Task = {
    ...task,
    companySupportStatus: "completed",
    companySupportCompletedAt: changedAt,
    updatedAt: changedAt
  };
  const nextParts = replaceTaskEverywhere(state, nextTask);
  return {
    ...nextParts,
    task: nextTask,
    activityLogs: appendLog(state, {
      action: "complete_company_support",
      title: "公司支持完成",
      detail: `公司支持事项「${task.companySupportRequest || getTaskContent(task)}」已完成。`,
      meetingId: task.meetingId,
      taskId: task.id,
      actorId: currentUser.id,
      actorName: currentUser.name,
      createdAt: changedAt
    })
  };
}
