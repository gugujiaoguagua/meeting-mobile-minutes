import { getTaskDepartmentId, getTaskOwnerId, getTaskReviewerId } from "@/lib/permission";
import { buildCanonicalUserDirectory, canonicalizeMeetingUsers, canonicalizeUserId } from "@/lib/canonicalUsers";
import { users } from "@/lib/orgPeopleData";
import type { ActivityLog, ApprovalStatus, Department, Meeting, Task, User } from "@/lib/types";

type MeetingActionState = {
  users?: User[];
  departments?: Department[];
  meetings: Meeting[];
  tasks: Task[];
  activityLogs: ActivityLog[];
};

type MeetingSubmissionResult = {
  stateMeetings: Meeting[];
  stateTasks: Task[];
  activityLogs: ActivityLog[];
  meeting: Meeting;
};

type MeetingApprovalResult = MeetingSubmissionResult & {
  approvedTasks?: Task[];
};

function currentDateTime() {
  return new Date().toISOString();
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

function assertCanSubmitMeeting(currentUser: User, meeting: Meeting) {
  if (currentUser.role === "总裁") return;
  if (meeting.hostId === currentUser.id) return;
  throw new Error("forbidden_meeting_submitter");
}

function canonicalContext(state: MeetingActionState, currentUser: User) {
  const directory = buildCanonicalUserDirectory(state.users?.length ? state.users : users);
  const canonicalUserId = canonicalizeUserId(currentUser.id, directory.aliasToCanonicalUserId) ?? currentUser.id;
  const effectiveCurrentUser = directory.users.find((user) => user.id === canonicalUserId) ?? currentUser;
  return {
    aliases: directory.aliasToCanonicalUserId,
    currentUser: effectiveCurrentUser,
    directory: { users: directory.users, departments: state.departments }
  };
}

function assertPresident(currentUser: User) {
  if (currentUser.role !== "总裁") {
    throw new Error("forbidden_president_only");
  }
}

function getTaskContent(task: Task) {
  return task.content ?? task.title;
}

function getTaskDescription(task: Task) {
  const base = task.description || task.sourceText || "来自会议闭环模板";
  return task.goal ? `${base} 目标：${task.goal}` : base;
}

function getTaskCollaboratorDepartmentIds(task: Task) {
  return task.collaboratorDepartments ?? task.collaboratorDepartmentIds ?? [];
}

function getUserDepartmentId(userDirectory: User[], userId?: string) {
  return userId ? userDirectory.find((user) => user.id === userId)?.departmentId : undefined;
}

function normalizePendingMeeting(meeting: Meeting, currentUser: User, submittedAt: string): Meeting {
  return {
    ...meeting,
    approvalStatus: "pending_president_approval",
    status: "summarized",
    createdBy: meeting.createdBy ?? currentUser.id,
    createdAt: meeting.createdAt || submittedAt,
    rejectedReason: undefined,
    tasks: (meeting.tasks ?? []).map((task) => ({
      ...task,
      meetingId: meeting.id,
      approvalStatus: "pending_president_approval",
      status: "not_started",
      rejectedReason: undefined,
      updatedAt: submittedAt
    }))
  };
}

export function submitMeetingApprovalAction(state: MeetingActionState, currentUser: User, meeting: Meeting): MeetingSubmissionResult {
  const context = canonicalContext(state, currentUser);
  const submittedMeeting = canonicalizeMeetingUsers(meeting, context.aliases);
  if (!submittedMeeting?.id) throw new Error("invalid_meeting");
  if (!Array.isArray(submittedMeeting.tasks) || submittedMeeting.tasks.length === 0) throw new Error("meeting_tasks_required");
  assertCanSubmitMeeting(context.currentUser, submittedMeeting);

  const submittedAt = currentDateTime();
  const nextMeeting = normalizePendingMeeting(submittedMeeting, context.currentUser, submittedAt);
  const exists = state.meetings.some((item) => item.id === nextMeeting.id);
  const stateMeetings = exists
    ? state.meetings.map((item) => (item.id === nextMeeting.id ? nextMeeting : item))
    : [nextMeeting, ...state.meetings];

  const submitLog: ActivityLog = {
    id: nextId("activity"),
    action: "submit_meeting_approval",
    title: "提交会议签批",
    detail: `会议《${nextMeeting.title}》已提交总裁签批，包含 ${(nextMeeting.tasks ?? []).length} 项待办。`,
    meetingId: nextMeeting.id,
    actorId: context.currentUser.id,
    actorName: context.directory.users.find((user) => user.id === context.currentUser.id)?.name ?? context.currentUser.name,
    toStatus: getApprovalStatusLabel("pending_president_approval"),
    createdAt: submittedAt
  };
  const dedupedLogs = state.activityLogs.filter((log) => !(log.action === "submit_meeting_approval" && log.meetingId === nextMeeting.id));

  return {
    stateMeetings,
    stateTasks: state.tasks,
    activityLogs: [submitLog, ...dedupedLogs].slice(0, 300),
    meeting: nextMeeting
  };
}

export function approveMeetingAction(state: MeetingActionState, currentUser: User, meetingId: string): MeetingApprovalResult {
  const context = canonicalContext(state, currentUser);
  assertPresident(context.currentUser);
  const rawSourceMeeting = state.meetings.find((meeting) => meeting.id === meetingId);
  const sourceMeeting = rawSourceMeeting ? canonicalizeMeetingUsers(rawSourceMeeting, context.aliases) : undefined;
  if (!sourceMeeting) throw new Error("meeting_not_found");

  const approvedAt = currentDateTime();
  const approvedTasks: Task[] = (sourceMeeting.tasks ?? []).map((task) => {
    const ownerId = getTaskOwnerId(task, context.directory);
    const departmentId = getUserDepartmentId(context.directory.users, ownerId) ?? getTaskDepartmentId(task, context.directory);
    return {
      ...task,
      meetingId,
      title: getTaskContent(task),
      description: getTaskDescription(task),
      owner: ownerId,
      ownerId,
      ownerDepartment: departmentId,
      departmentId,
      reviewerId: getTaskReviewerId({ ...task, owner: ownerId, ownerId, ownerDepartment: departmentId, departmentId }, sourceMeeting, context.directory),
      collaboratorDepartmentIds: getTaskCollaboratorDepartmentIds(task),
      status: "not_started",
      approvalStatus: "in_closed_loop",
      rejectedReason: undefined,
      createdAt: task.createdAt || approvedAt,
      updatedAt: approvedAt
    };
  });

  const stateMeetings = state.meetings.map((meeting) =>
    meeting.id === meetingId
      ? {
          ...meeting,
          approvalStatus: "in_closed_loop" as ApprovalStatus,
          status: "closed" as const,
          approvedBy: context.currentUser.id,
          approvedAt,
          tasks: []
        }
      : meeting
  );
  const approvedTaskIds = new Set(approvedTasks.map((task) => task.id));
  const stateTasks = [...approvedTasks, ...state.tasks.filter((task) => !approvedTaskIds.has(task.id))];

  const approveLog: ActivityLog = {
    id: nextId("activity"),
    action: "approve_meeting",
    title: "总裁批量签批通过",
    detail: `会议《${sourceMeeting.title}》已签批通过，${approvedTasks.length} 项待办进入正式台账。`,
    meetingId,
    actorId: context.currentUser.id,
    actorName: context.currentUser.name,
    fromStatus: getApprovalStatusLabel(sourceMeeting.approvalStatus),
    toStatus: getApprovalStatusLabel("in_closed_loop"),
    createdAt: approvedAt
  };

  return {
    stateMeetings,
    stateTasks,
    activityLogs: [approveLog, ...state.activityLogs].slice(0, 300),
    meeting: stateMeetings.find((meeting) => meeting.id === meetingId) ?? sourceMeeting,
    approvedTasks
  };
}

export function rejectMeetingApprovalAction(state: MeetingActionState, currentUser: User, meetingId: string, reason?: string): MeetingApprovalResult {
  const context = canonicalContext(state, currentUser);
  assertPresident(context.currentUser);
  const rawSourceMeeting = state.meetings.find((meeting) => meeting.id === meetingId);
  const sourceMeeting = rawSourceMeeting ? canonicalizeMeetingUsers(rawSourceMeeting, context.aliases) : undefined;
  if (!sourceMeeting) throw new Error("meeting_not_found");

  const rejectedAt = currentDateTime();
  const rejectedReason = reason?.trim() || "请主管补充待办推进人、复核人、截止时间和达成目标后重新提交。";
  const stateMeetings = state.meetings.map((meeting) =>
    meeting.id === meetingId
      ? {
          ...meeting,
          approvalStatus: "rejected" as ApprovalStatus,
          rejectedReason
        }
      : meeting
  );

  const rejectLog: ActivityLog = {
    id: nextId("activity"),
    action: "reject_meeting",
    title: "总裁驳回会议签批",
    detail: `会议《${sourceMeeting.title}》被驳回。原因：${rejectedReason}`,
    meetingId,
    actorId: context.currentUser.id,
    actorName: context.currentUser.name,
    fromStatus: getApprovalStatusLabel(sourceMeeting.approvalStatus),
    toStatus: getApprovalStatusLabel("rejected"),
    createdAt: rejectedAt
  };

  return {
    stateMeetings,
    stateTasks: state.tasks,
    activityLogs: [rejectLog, ...state.activityLogs].slice(0, 300),
    meeting: stateMeetings.find((meeting) => meeting.id === meetingId) ?? sourceMeeting
  };
}
