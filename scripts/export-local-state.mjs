import path from "node:path";
import {
  defaultExportDir,
  defaultStatePath,
  hasId,
  normalizeExportPath,
  parseArgs,
  readJson,
  timestampSlug,
  toArray,
  toJson,
  toPgDate,
  toPgTimestamp,
  unique,
  writeJson
} from "./migration-utils.mjs";

const args = parseArgs();
const statePath = args.state ? normalizeExportPath(args.state) : defaultStatePath;
const outputPath = args.out ? normalizeExportPath(args.out) : path.join(defaultExportDir, `meeting-loop-state-export-${timestampSlug()}.json`);

function makeWarning(warnings, code, detail) {
  warnings.push({ code, detail });
}

function normalizeStateToExport(state, sourceFile) {
  const warnings = [];
  const departments = toArray(state.departments);
  const users = toArray(state.users);
  const meetings = toArray(state.meetings);
  const topLevelTasks = toArray(state.tasks);
  const activityLogs = toArray(state.activityLogs);
  const notificationReadIdsByUser = state.notificationReadIdsByUser && typeof state.notificationReadIdsByUser === "object" ? state.notificationReadIdsByUser : {};

  const departmentIds = new Set(departments.map((item) => item.id));
  const userIds = new Set(users.map((item) => item.id));
  const meetingIds = new Set(meetings.map((item) => item.id));

  const exportedDepartments = departments.map((department) => ({
    id: department.id,
    name: department.name ?? "",
    manager_id: department.managerId ?? null,
    description: department.description ?? "",
    org_code: department.orgCode ?? null,
    full_path: department.fullPath ?? null,
    org_type: department.orgType ?? null,
    source: department.source ?? null
  }));

  const exportedUsers = users.map((user) => ({
    id: user.id,
    name: user.name ?? "",
    role: user.role ?? "员工",
    department_id: hasId(departmentIds, user.departmentId) ? user.departmentId : null,
    title: user.title ?? "",
    employee_no: user.employeeNo ?? null,
    manager_id: user.managerId ?? null,
    source: user.source ?? null
  }));

  const exportedMeetings = meetings.map((meeting) => {
    if (meeting.departmentId && !departmentIds.has(meeting.departmentId)) makeWarning(warnings, "unknown_meeting_department", { meetingId: meeting.id, departmentId: meeting.departmentId });
    if (meeting.hostId && !userIds.has(meeting.hostId)) makeWarning(warnings, "unknown_meeting_host", { meetingId: meeting.id, hostId: meeting.hostId });
    if (meeting.createdBy && !userIds.has(meeting.createdBy)) makeWarning(warnings, "unknown_meeting_created_by", { meetingId: meeting.id, createdBy: meeting.createdBy });
    if (meeting.approvedBy && !userIds.has(meeting.approvedBy)) makeWarning(warnings, "unknown_meeting_approved_by", { meetingId: meeting.id, approvedBy: meeting.approvedBy });
    return {
      id: meeting.id,
      title: meeting.title ?? "",
      department_id: hasId(departmentIds, meeting.departmentId) ? meeting.departmentId : null,
      meeting_type: meeting.type ?? "经营例会",
      host_id: hasId(userIds, meeting.hostId) ? meeting.hostId : null,
      participant_count: meeting.participantCount ?? toArray(meeting.participantIds).length,
      start_time: toPgTimestamp(meeting.startTime) ?? toPgTimestamp(meeting.createdAt),
      end_time: toPgTimestamp(meeting.endTime),
      duration_minutes: meeting.durationMinutes ?? 0,
      total_man_hours: meeting.totalManHours ?? null,
      raw_transcript: meeting.rawTranscript ?? "",
      transcript: meeting.transcript ?? null,
      uploaded_file_name: meeting.uploadedFileName ?? null,
      source_batch_id: meeting.sourceBatchId ?? null,
      source_file_name: meeting.sourceFileName ?? null,
      source_extracted_at: toPgTimestamp(meeting.sourceExtractedAt),
      source_template_name: meeting.sourceTemplateName ?? null,
      source_template_version: meeting.sourceTemplateVersion ?? null,
      okr_project_id: meeting.okrProjectId ?? null,
      okr_project_name: meeting.okrProjectName ?? null,
      summary: meeting.summary ?? "",
      ai_summary: meeting.aiSummary ?? null,
      minute_markdown: meeting.minuteMarkdown ?? null,
      conclusions: toJson(meeting.conclusions, []),
      approval_status: meeting.approvalStatus ?? null,
      status: meeting.status ?? "summarized",
      created_by: hasId(userIds, meeting.createdBy) ? meeting.createdBy : null,
      approved_by: hasId(userIds, meeting.approvedBy) ? meeting.approvedBy : null,
      approved_at: toPgTimestamp(meeting.approvedAt),
      rejected_reason: meeting.rejectedReason ?? null,
      created_at: toPgTimestamp(meeting.createdAt) ?? toPgTimestamp(meeting.startTime),
      updated_at: toPgTimestamp(meeting.approvedAt) ?? toPgTimestamp(meeting.createdAt) ?? toPgTimestamp(meeting.startTime)
    };
  });

  const meetingParticipants = [];
  for (const meeting of meetings) {
    for (const userId of unique(toArray(meeting.participantIds))) {
      if (!userIds.has(userId)) {
        makeWarning(warnings, "unknown_meeting_participant", { meetingId: meeting.id, userId });
        continue;
      }
      meetingParticipants.push({ meeting_id: meeting.id, user_id: userId });
    }
  }

  const meetingFiles = meetings
    .filter((meeting) => meeting.uploadedFileName || meeting.sourceFileName)
    .map((meeting) => ({
      id: `${meeting.id}-source-file`,
      meeting_id: meeting.id,
      file_name: meeting.sourceFileName ?? meeting.uploadedFileName,
      source_type: null,
      text_content: meeting.rawTranscript ?? meeting.transcript ?? null,
      status: "read",
      source_batch_id: meeting.sourceBatchId ?? null
    }));

  const meetingMinutes = meetings.map((meeting) => ({
    id: `${meeting.id}-minute`,
    meeting_id: meeting.id,
    summary: meeting.summary ?? "",
    ai_summary: meeting.aiSummary ?? null,
    minute_markdown: meeting.minuteMarkdown ?? null,
    source_template_name: meeting.sourceTemplateName ?? null,
    source_template_version: meeting.sourceTemplateVersion ?? null,
    created_at: toPgTimestamp(meeting.createdAt) ?? toPgTimestamp(meeting.startTime),
    updated_at: toPgTimestamp(meeting.approvedAt) ?? toPgTimestamp(meeting.createdAt) ?? toPgTimestamp(meeting.startTime)
  }));

  const meetingDecisions = [];
  for (const meeting of meetings) {
    for (const decision of toArray(meeting.decisions)) {
      meetingDecisions.push({
        id: decision.id,
        meeting_id: meeting.id,
        content: decision.content ?? "",
        owner_id: hasId(userIds, decision.ownerId) ? decision.ownerId : null,
        impact_scope: decision.impactScope ?? "",
        need_president_confirmation: Boolean(decision.needPresidentConfirmation),
        source_batch_id: decision.sourceBatchId ?? null,
        source_text: decision.sourceText ?? null
      });
    }
  }
  const decisionIds = new Set(meetingDecisions.map((decision) => decision.id));

  const taskMap = new Map();
  for (const task of topLevelTasks) taskMap.set(task.id, task);
  for (const meeting of meetings) {
    for (const task of toArray(meeting.tasks)) taskMap.set(task.id, { ...task, meetingId: meeting.id });
  }
  const allTasks = [...taskMap.values()];
  const taskIds = new Set(allTasks.map((task) => task.id));

  const exportedTasks = [];
  const taskProgressEntries = [];
  for (const task of allTasks) {
    if (!meetingIds.has(task.meetingId)) {
      makeWarning(warnings, "task_skipped_unknown_meeting", { taskId: task.id, meetingId: task.meetingId });
      continue;
    }
    if (task.sourceDecisionId && !decisionIds.has(task.sourceDecisionId)) makeWarning(warnings, "unknown_task_source_decision", { taskId: task.id, sourceDecisionId: task.sourceDecisionId });
    exportedTasks.push({
      id: task.id,
      meeting_id: task.meetingId,
      content: task.content ?? null,
      title: task.title ?? task.content ?? "",
      description: task.description ?? "",
      owner_id: hasId(userIds, task.ownerId) ? task.ownerId : null,
      owner_label: task.owner ?? null,
      department_id: hasId(departmentIds, task.departmentId) ? task.departmentId : null,
      owner_department_label: task.ownerDepartment ?? null,
      reviewer_id: hasId(userIds, task.reviewerId) ? task.reviewerId : null,
      collaborator_department_ids: toJson(task.collaboratorDepartmentIds, []),
      collaborator_department_labels: toJson(task.collaboratorDepartments, []),
      start_date: toPgDate(task.startDate),
      due_date: toPgDate(task.dueDate) ?? toPgDate(task.createdAt) ?? "1970-01-01",
      goal: task.goal ?? null,
      priority: task.priority ?? "中",
      status: task.status ?? "not_started",
      approval_status: task.approvalStatus ?? null,
      rejected_reason: task.rejectedReason ?? null,
      company_support_request: task.companySupportRequest ?? null,
      company_support_status: task.companySupportStatus ?? null,
      company_support_completed_at: toPgTimestamp(task.companySupportCompletedAt),
      completion_items: toJson(task.completionItems, []),
      review_submitted_at: toPgTimestamp(task.reviewSubmittedAt),
      review_target_status: task.reviewTargetStatus ?? null,
      reviewed_at: toPgTimestamp(task.reviewedAt),
      review_rejected_at: toPgTimestamp(task.reviewRejectedAt),
      review_rejected_reason: task.reviewRejectedReason ?? null,
      review_rejected_items: toJson(task.reviewRejectedItems, []),
      source_text: task.sourceText ?? null,
      source_batch_id: task.sourceBatchId ?? null,
      source_meeting_id: task.sourceMeetingId ?? null,
      source_file_name: task.sourceFileName ?? null,
      source_decision_id: decisionIds.has(task.sourceDecisionId) ? task.sourceDecisionId : null,
      source_trace_label: task.sourceTraceLabel ?? null,
      created_at: toPgTimestamp(task.createdAt),
      updated_at: toPgTimestamp(task.updatedAt) ?? toPgTimestamp(task.createdAt)
    });

    toArray(task.completionHistory).forEach((entry, index) => {
      taskProgressEntries.push({
        id: entry.id ?? `${task.id}-progress-${index + 1}`,
        task_id: task.id,
        submitted_at: toPgTimestamp(entry.submittedAt) ?? toPgTimestamp(task.updatedAt) ?? toPgTimestamp(task.createdAt),
        submitted_by: hasId(userIds, entry.submittedBy) ? entry.submittedBy : null,
        target_status: entry.targetStatus ?? null,
        items: toJson(entry.items, [])
      });
    });
  }

  const approvalActions = new Set(["submit_meeting_approval", "approve_meeting", "reject_meeting", "approve_task", "reject_task"]);
  const reviewActions = new Set(["submit_review", "confirm_review", "reject_review"]);
  const taskApprovalLogs = [];
  const taskReviewLogs = [];
  const exportedActivityLogs = [];

  for (const log of activityLogs) {
    const meetingId = hasId(meetingIds, log.meetingId) ? log.meetingId : null;
    const taskId = hasId(taskIds, log.taskId) ? log.taskId : null;
    const actorId = hasId(userIds, log.actorId) ? log.actorId : null;
    const base = {
      id: log.id,
      action: log.action ?? "",
      title: log.title ?? "",
      detail: log.detail ?? "",
      meeting_id: meetingId,
      task_id: taskId,
      actor_id: actorId,
      actor_name: log.actorName ?? null,
      from_status: log.fromStatus ?? null,
      to_status: log.toStatus ?? null,
      created_at: toPgTimestamp(log.createdAt)
    };
    exportedActivityLogs.push(base);
    if (approvalActions.has(log.action)) {
      taskApprovalLogs.push({
        id: `${log.id}-approval`,
        task_id: taskId,
        meeting_id: meetingId,
        action: log.action,
        actor_id: actorId,
        from_status: log.fromStatus ?? null,
        to_status: log.toStatus ?? null,
        reason: log.detail ?? null,
        created_at: toPgTimestamp(log.createdAt)
      });
    }
    if (reviewActions.has(log.action)) {
      taskReviewLogs.push({
        id: `${log.id}-review`,
        task_id: taskId,
        meeting_id: meetingId,
        action: log.action,
        actor_id: actorId,
        from_status: log.fromStatus ?? null,
        to_status: log.toStatus ?? null,
        reason: log.detail ?? null,
        reason_items: [],
        created_at: toPgTimestamp(log.createdAt)
      });
    }
  }

  const notificationReads = [];
  for (const [userId, readIds] of Object.entries(notificationReadIdsByUser)) {
    if (!userIds.has(userId)) {
      makeWarning(warnings, "notification_read_unknown_user", { userId });
      continue;
    }
    for (const notificationId of unique(toArray(readIds))) {
      notificationReads.push({ user_id: userId, notification_id: notificationId });
    }
  }

  const data = {
    departments: exportedDepartments,
    users: exportedUsers,
    meetings: exportedMeetings,
    meetingParticipants,
    meetingFiles,
    meetingMinutes,
    meetingDecisions,
    tasks: exportedTasks,
    taskProgressEntries,
    taskApprovalLogs,
    taskReviewLogs,
    notifications: [],
    notificationReads,
    activityLogs: exportedActivityLogs,
    userPreferences: []
  };

  const counts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length]));
  return {
    exportedAt: new Date().toISOString(),
    sourceFile,
    stateVersion: state.version,
    counts,
    warnings,
    data
  };
}

const state = await readJson(statePath);
const exportPackage = normalizeStateToExport(state, statePath);
await writeJson(outputPath, exportPackage);

console.log(`Exported local state to ${outputPath}`);
console.log(JSON.stringify({ counts: exportPackage.counts, warnings: exportPackage.warnings.length }, null, 2));
