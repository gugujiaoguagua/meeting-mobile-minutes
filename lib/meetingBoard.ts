import { departments as seedDepartments, users as seedUsers } from "@/lib/orgPeopleData";
import type { ActivityLog, Department, Meeting, MeetingBoardResponse, MeetingBoardRow, MeetingBoardStatus, Task, User } from "@/lib/types";

function mergeById<T extends { id: string }>(baseItems: T[], incomingItems?: T[]) {
  const merged = new Map(baseItems.map((item) => [item.id, item]));
  for (const item of incomingItems ?? []) {
    if (item?.id) merged.set(item.id, { ...merged.get(item.id), ...item });
  }
  return Array.from(merged.values());
}

function findUser(userDirectory: User[], userId?: string) {
  return userId ? userDirectory.find((user) => user.id === userId) : undefined;
}

function findDepartment(departmentDirectory: Department[], departmentId?: string) {
  return departmentId ? departmentDirectory.find((department) => department.id === departmentId) : undefined;
}

function userDisplayName(userDirectory: User[], userId?: string) {
  const user = findUser(userDirectory, userId);
  if (user?.name) return user.name;
  return userId && !/^(emp|u|user)-/i.test(userId) ? userId : "未识别用户";
}

function sourceTypeFor(meeting: Meeting): MeetingBoardRow["sourceType"] {
  if (meeting.sourceTemplateName === "mobile-browser-recording" || meeting.id.startsWith("mobile-recording-")) return "mobile_recording";
  if (meeting.uploadedFileName || meeting.sourceFileName) return "desktop_upload";
  if (meeting.rawTranscript || meeting.transcript) return "manual";
  return "unknown";
}

function boardStatusFor(meeting: Meeting, decisionCount: number, totalTaskCount: number): MeetingBoardStatus {
  if (meeting.approvalStatus === "in_closed_loop") return "in_closed_loop";
  if (meeting.status === "closed") return "closed";
  if (meeting.recordingStatus === "transcribing") return "recording_transcribing";
  if (meeting.recordingStatus === "failed") return "recording_failed";
  if (!meeting.aiSummary && !meeting.minuteMarkdown) return "needs_minutes";
  if (meeting.approvalStatus === "pending_president_approval") return "pending_approval";
  if (decisionCount === 0 && totalTaskCount === 0) return "needs_approval_submission";
  return "needs_approval_submission";
}

function latestLogFor(meetingId: string, logs: ActivityLog[]) {
  return logs
    .filter((log) => log.meetingId === meetingId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function isToday(value?: string) {
  if (!value) return false;
  const raw = value.trim();
  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasTimeZone ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

function isCompletedTask(task: Task) {
  return task.status === "completed" || task.status === "已完成" || task.approvalStatus === "in_closed_loop";
}

function isOverdueTask(task: Task) {
  if (isCompletedTask(task) || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime() || task.status === "overdue";
}

export function buildMeetingBoardResponse(input: { meetings: Meeting[]; tasks: Task[]; activityLogs: ActivityLog[]; users?: User[]; departments?: Department[] }): MeetingBoardResponse {
  const userDirectory = mergeById(seedUsers, input.users);
  const departmentDirectory = mergeById(seedDepartments, input.departments);
  const rows = input.meetings.map((meeting) => {
    const host = findUser(userDirectory, meeting.hostId);
    const creator = findUser(userDirectory, meeting.createdBy);
    const department = findDepartment(departmentDirectory, meeting.departmentId);
    const formalTasks = input.tasks.filter((task) => task.meetingId === meeting.id);
    const draftTaskCount = meeting.tasks?.length ?? 0;
    const formalTaskCount = formalTasks.length;
    const totalTaskCount = draftTaskCount + formalTaskCount;
    const decisionCount = meeting.decisions?.length ?? 0;
    const latestLog = latestLogFor(meeting.id, input.activityLogs);
    const boardStatus = boardStatusFor(meeting, decisionCount, totalTaskCount);

    return {
      meetingId: meeting.id,
      title: meeting.title,
      meetingType: meeting.type,
      departmentId: meeting.departmentId,
      departmentName: department?.name ?? meeting.departmentId,
      hostId: meeting.hostId,
      hostName: host?.name ?? userDisplayName(userDirectory, meeting.hostId),
      hostEmployeeNo: host?.employeeNo,
      hostTitle: host?.title,
      createdBy: meeting.createdBy,
      createdByName: creator?.name,
      createdByEmployeeNo: creator?.employeeNo,
      sourceType: sourceTypeFor(meeting),
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      durationMinutes: meeting.durationMinutes,
      recordingStatus: meeting.recordingStatus,
      recordingStatusMessage: meeting.recordingStatusMessage,
      hasTranscript: Boolean((meeting.transcript || meeting.rawTranscript || "").trim()),
      hasAiSummary: Boolean((meeting.aiSummary || meeting.minuteMarkdown || "").trim()),
      decisionCount,
      draftTaskCount,
      formalTaskCount,
      totalTaskCount,
      approvalStatus: meeting.approvalStatus,
      status: meeting.status,
      boardStatus,
      lastAction: latestLog?.title,
      lastActionAt: latestLog?.createdAt,
      lastActorName: latestLog?.actorName
    } satisfies MeetingBoardRow;
  });

  return {
    rows,
    summary: {
      totalMeetings: rows.length,
      todayMeetings: rows.filter((row) => isToday(row.startTime)).length,
      mobileRecordings: rows.filter((row) => row.sourceType === "mobile_recording").length,
      transcribing: rows.filter((row) => row.boardStatus === "recording_transcribing").length,
      failedRecordings: rows.filter((row) => row.boardStatus === "recording_failed").length,
      needsMinutes: rows.filter((row) => row.boardStatus === "needs_minutes").length,
      needsApprovalSubmission: rows.filter((row) => row.boardStatus === "needs_approval_submission").length,
      pendingApproval: rows.filter((row) => row.boardStatus === "pending_approval").length,
      closed: rows.filter((row) => row.boardStatus === "closed" || row.boardStatus === "in_closed_loop").length,
      draftTaskCount: rows.reduce((sum, row) => sum + row.draftTaskCount, 0),
      formalTaskCount: rows.reduce((sum, row) => sum + row.formalTaskCount, 0),
      totalTaskCount: rows.reduce((sum, row) => sum + row.totalTaskCount, 0),
      activeTaskCount: input.tasks.filter((task) => !isCompletedTask(task)).length,
      reviewTaskCount: input.tasks.filter((task) => task.status === "pending_review").length,
      approvalTaskCount: input.tasks.filter((task) => task.approvalStatus === "pending_president_approval").length,
      overdueTaskCount: input.tasks.filter(isOverdueTask).length
    }
  };
}
