import { dbQuery, type DbExecutor } from "@/lib/db";
import { canViewActivityLog, canViewMeeting, canViewTask, filterMeetingTasks } from "@/lib/permission";
import type { LocalMeetingLoopState } from "@/lib/localStateStore";
import type {
  ActivityLog,
  ApprovalStatus,
  Department,
  Meeting,
  MeetingDecision,
  MeetingStatus,
  MeetingType,
  Priority,
  Role,
  Task,
  TaskProgressEntry,
  TaskStatus,
  User
} from "@/lib/types";

type DbRow = Record<string, unknown>;

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return undefined;
}

function booleanValue(value: unknown) {
  return value === true;
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stringArray(value: unknown) {
  return arrayValue(value).filter((item): item is string => typeof item === "string");
}

function dateTimeString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function optionalDateTimeString(value: unknown) {
  const normalized = dateTimeString(value);
  return normalized || undefined;
}

function dateString(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

function optionalDateString(value: unknown) {
  const normalized = dateString(value);
  return normalized || undefined;
}

function groupBy<T>(items: T[], getKey: (item: T) => string | undefined) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function mapDepartment(row: DbRow): Department {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    managerId: stringValue(row.manager_id),
    description: stringValue(row.description),
    orgCode: optionalString(row.org_code),
    fullPath: optionalString(row.full_path),
    orgType: optionalString(row.org_type),
    source: optionalString(row.source)
  };
}

function mapUser(row: DbRow): User {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    role: stringValue(row.role, "员工") as Role,
    departmentId: stringValue(row.department_id),
    title: stringValue(row.title),
    employeeNo: optionalString(row.employee_no),
    managerId: optionalString(row.manager_id),
    source: optionalString(row.source)
  };
}

function mapDecision(row: DbRow): MeetingDecision {
  return {
    id: stringValue(row.id),
    content: stringValue(row.content),
    ownerId: stringValue(row.owner_id),
    impactScope: stringValue(row.impact_scope),
    needPresidentConfirmation: booleanValue(row.need_president_confirmation),
    sourceBatchId: optionalString(row.source_batch_id),
    sourceText: optionalString(row.source_text)
  };
}

function mapProgressEntry(row: DbRow): TaskProgressEntry {
  return {
    id: stringValue(row.id),
    submittedAt: dateTimeString(row.submitted_at),
    submittedBy: optionalString(row.submitted_by),
    targetStatus: optionalString(row.target_status) as TaskStatus | undefined,
    items: stringArray(row.items)
  };
}

function mapTask(row: DbRow, progressEntries: TaskProgressEntry[]): Task {
  return {
    id: stringValue(row.id),
    content: optionalString(row.content),
    owner: optionalString(row.owner_label),
    ownerDepartment: optionalString(row.owner_department_label),
    collaboratorDepartments: stringArray(row.collaborator_department_labels),
    reviewerId: optionalString(row.reviewer_id),
    reviewSubmittedAt: optionalDateTimeString(row.review_submitted_at),
    reviewTargetStatus: optionalString(row.review_target_status) as TaskStatus | undefined,
    reviewedAt: optionalDateTimeString(row.reviewed_at),
    reviewRejectedAt: optionalDateTimeString(row.review_rejected_at),
    reviewRejectedReason: optionalString(row.review_rejected_reason),
    reviewRejectedItems: stringArray(row.review_rejected_items),
    startDate: optionalDateString(row.start_date),
    goal: optionalString(row.goal),
    companySupportRequest: optionalString(row.company_support_request),
    companySupportStatus: optionalString(row.company_support_status) as Task["companySupportStatus"],
    companySupportCompletedAt: optionalDateTimeString(row.company_support_completed_at),
    completionItems: stringArray(row.completion_items),
    completionHistory: progressEntries,
    sourceText: optionalString(row.source_text),
    sourceBatchId: optionalString(row.source_batch_id),
    sourceMeetingId: optionalString(row.source_meeting_id),
    sourceFileName: optionalString(row.source_file_name),
    sourceDecisionId: optionalString(row.source_decision_id),
    sourceTraceLabel: optionalString(row.source_trace_label),
    approvalStatus: optionalString(row.approval_status) as ApprovalStatus | undefined,
    rejectedReason: optionalString(row.rejected_reason),
    title: stringValue(row.title),
    description: stringValue(row.description),
    meetingId: stringValue(row.meeting_id),
    ownerId: stringValue(row.owner_id),
    departmentId: stringValue(row.department_id),
    collaboratorDepartmentIds: stringArray(row.collaborator_department_ids),
    dueDate: dateString(row.due_date),
    priority: stringValue(row.priority, "中") as Priority,
    status: stringValue(row.status, "not_started") as TaskStatus,
    createdAt: dateTimeString(row.created_at),
    updatedAt: dateTimeString(row.updated_at)
  };
}

function mapMeeting(row: DbRow, participantIds: string[], decisions: MeetingDecision[], tasks: Task[]): Meeting {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    departmentId: stringValue(row.department_id),
    type: stringValue(row.meeting_type, "经营例会") as MeetingType,
    hostId: stringValue(row.host_id),
    participantIds,
    participantCount: numberValue(row.participant_count) ?? participantIds.length,
    startTime: dateTimeString(row.start_time),
    endTime: optionalDateTimeString(row.end_time),
    durationMinutes: numberValue(row.duration_minutes) ?? 0,
    totalManHours: numberValue(row.total_man_hours),
    rawTranscript: stringValue(row.raw_transcript),
    transcript: optionalString(row.transcript),
    uploadedFileName: optionalString(row.uploaded_file_name),
    sourceBatchId: optionalString(row.source_batch_id),
    sourceFileName: optionalString(row.source_file_name),
    sourceExtractedAt: optionalDateTimeString(row.source_extracted_at),
    sourceTemplateName: optionalString(row.source_template_name),
    sourceTemplateVersion: optionalString(row.source_template_version),
    okrProjectId: optionalString(row.okr_project_id),
    okrProjectName: optionalString(row.okr_project_name),
    summary: stringValue(row.summary),
    aiSummary: optionalString(row.ai_summary),
    minuteMarkdown: optionalString(row.minute_markdown),
    conclusions: stringArray(row.conclusions),
    decisions,
    approvalStatus: optionalString(row.approval_status) as ApprovalStatus | undefined,
    tasks,
    createdBy: optionalString(row.created_by),
    approvedBy: optionalString(row.approved_by),
    approvedAt: optionalDateTimeString(row.approved_at),
    rejectedReason: optionalString(row.rejected_reason),
    status: stringValue(row.status, "summarized") as MeetingStatus,
    createdAt: dateTimeString(row.created_at)
  };
}

function mapActivityLog(row: DbRow): ActivityLog {
  return {
    id: stringValue(row.id),
    action: stringValue(row.action),
    title: stringValue(row.title),
    detail: stringValue(row.detail),
    meetingId: optionalString(row.meeting_id),
    taskId: optionalString(row.task_id),
    actorId: optionalString(row.actor_id),
    actorName: optionalString(row.actor_name),
    fromStatus: optionalString(row.from_status),
    toStatus: optionalString(row.to_status),
    createdAt: dateTimeString(row.created_at)
  };
}

function isTopLevelTask(task: Task) {
  return task.approvalStatus === "in_closed_loop" || task.approvalStatus === "approved" || !task.approvalStatus;
}

export async function readDbState(executor: DbExecutor = { query: dbQuery }): Promise<LocalMeetingLoopState> {
  const [
    departmentsResult,
    usersResult,
    meetingsResult,
    participantsResult,
    decisionsResult,
    tasksResult,
    progressResult,
    activityLogsResult,
    notificationReadsResult
  ] = await Promise.all([
    executor.query("select * from departments order by name, id"),
    executor.query("select * from users order by name, id"),
    executor.query("select * from meetings order by start_time desc, created_at desc, id"),
    executor.query("select meeting_id, user_id from meeting_participants order by meeting_id, user_id"),
    executor.query("select * from meeting_decisions order by created_at, id"),
    executor.query("select * from tasks order by created_at, id"),
    executor.query("select * from task_progress_entries order by submitted_at, id"),
    executor.query("select * from activity_logs order by created_at desc, id"),
    executor.query("select user_id, notification_id from notification_reads order by user_id, notification_id")
  ]);

  const progressRowsByTask = groupBy(tasksResult.rows.length ? progressResult.rows : [], (row) => stringValue(row.task_id));
  const allTasks = tasksResult.rows.map((row) => mapTask(row, (progressRowsByTask.get(stringValue(row.id)) ?? []).map(mapProgressEntry)));
  const topLevelTasks = allTasks.filter(isTopLevelTask);
  const pendingTasksByMeeting = groupBy(
    allTasks.filter((task) => !isTopLevelTask(task)),
    (task) => task.meetingId
  );
  const decisionRowsByMeeting = groupBy(decisionsResult.rows, (row) => stringValue(row.meeting_id));
  const participantIdsByMeeting = groupBy(participantsResult.rows, (row) => stringValue(row.meeting_id));
  const meetings = meetingsResult.rows.map((row) =>
    mapMeeting(
      row,
      (participantIdsByMeeting.get(stringValue(row.id)) ?? []).map((participant) => stringValue(participant.user_id)).filter(Boolean),
      (decisionRowsByMeeting.get(stringValue(row.id)) ?? []).map(mapDecision),
      pendingTasksByMeeting.get(stringValue(row.id)) ?? []
    )
  );

  const notificationReadIdsByUser: Record<string, string[]> = {};
  for (const row of notificationReadsResult.rows) {
    const userId = stringValue(row.user_id);
    const notificationId = stringValue(row.notification_id);
    if (!userId || !notificationId) continue;
    notificationReadIdsByUser[userId] = [...(notificationReadIdsByUser[userId] ?? []), notificationId];
  }

  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    departments: departmentsResult.rows.map(mapDepartment),
    users: usersResult.rows.map(mapUser),
    meetings,
    tasks: topLevelTasks,
    activityLogs: activityLogsResult.rows.map(mapActivityLog),
    notificationReadIdsByUser
  };
}

export async function readVisibleDbState(currentUser: User): Promise<LocalMeetingLoopState> {
  const state = await readDbState();
  const currentReadIds = state.notificationReadIdsByUser[currentUser.id] ?? [];
  if (currentUser.role === "总裁") {
    return {
      ...state,
      stateScope: "full",
      notificationReadIds: currentReadIds
    };
  }

  const visibleTasks = state.tasks.filter((task) => canViewTask(currentUser, task, state.meetings));
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
  const visibleMeetings = state.meetings
    .filter((meeting) => canViewMeeting(currentUser, meeting, visibleTasks))
    .map((meeting) => filterMeetingTasks(meeting, visibleTaskIds));
  const visibleMeetingIds = new Set(visibleMeetings.map((meeting) => meeting.id));
  const visibleActivityLogs = state.activityLogs.filter((log) => canViewActivityLog(currentUser, log, visibleMeetingIds, visibleTaskIds));

  return {
    ...state,
    meetings: visibleMeetings,
    tasks: visibleTasks,
    activityLogs: visibleActivityLogs,
    stateScope: "visible",
    notificationReadIdsByUser: {
      [currentUser.id]: currentReadIds
    },
    notificationReadIds: currentReadIds
  };
}
