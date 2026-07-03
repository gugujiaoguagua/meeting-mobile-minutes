import type { PoolClient } from "pg";
import { withDbTransaction } from "@/lib/db";
import { readDbState } from "@/lib/dbStateStore";
import {
  approveMeetingAction,
  rejectMeetingApprovalAction,
  submitMeetingApprovalAction
} from "@/lib/meetingActions";
import {
  approveTaskAction,
  completeCompanySupportAction,
  confirmTaskReviewAction,
  deleteTaskAction,
  rejectTaskApprovalAction,
  rejectTaskReviewAction,
  saveTaskCompletionItems,
  submitTaskReview
} from "@/lib/taskActions";
import type { ActivityLog, Meeting, MeetingDecision, Task, TaskProgressEntry, TaskStatus, User } from "@/lib/types";

function toJson(value: unknown, fallback: unknown[] | Record<string, unknown> = []) {
  return JSON.stringify(value ?? fallback);
}

function taskContent(task: Task) {
  return task.content ?? task.title;
}

function currentIds(items: { id: string }[]) {
  return new Set(items.map((item) => item.id));
}

async function insertActivityLogs(client: PoolClient, logs: ActivityLog[]) {
  for (const log of logs) {
    await client.query(
      `
        insert into activity_logs (
          id, action, title, detail, meeting_id, task_id, actor_id, actor_name,
          from_status, to_status, created_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (id) do nothing
      `,
      [
        log.id,
        log.action,
        log.title,
        log.detail,
        log.meetingId ?? null,
        log.taskId ?? null,
        log.actorId ?? null,
        log.actorName ?? null,
        log.fromStatus ?? null,
        log.toStatus ?? null,
        log.createdAt
      ]
    );
    await insertDerivedActionLog(client, log);
  }
}

async function insertDerivedActionLog(client: PoolClient, log: ActivityLog) {
  if (["submit_meeting_approval", "approve_meeting", "reject_meeting", "approve_task", "reject_task"].includes(log.action)) {
    await client.query(
      `
        insert into task_approval_logs (
          id, task_id, meeting_id, action, actor_id, from_status, to_status, reason, created_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (id) do nothing
      `,
      [`${log.id}-approval`, log.taskId ?? null, log.meetingId ?? null, log.action, log.actorId ?? null, log.fromStatus ?? null, log.toStatus ?? null, log.detail, log.createdAt]
    );
  }
  if (["submit_review", "confirm_review", "reject_review"].includes(log.action)) {
    await client.query(
      `
        insert into task_review_logs (
          id, task_id, meeting_id, action, actor_id, from_status, to_status, reason, reason_items, created_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (id) do nothing
      `,
      [`${log.id}-review`, log.taskId ?? null, log.meetingId ?? null, log.action, log.actorId ?? null, log.fromStatus ?? null, log.toStatus ?? null, log.detail, toJson([]), log.createdAt]
    );
  }
}

async function upsertTask(client: PoolClient, task: Task) {
  await client.query(
    `
      insert into tasks (
        id, meeting_id, content, title, description, owner_id, owner_label,
        department_id, owner_department_label, reviewer_id, collaborator_department_ids,
        collaborator_department_labels, start_date, due_date, goal, priority, status,
        approval_status, rejected_reason, company_support_request, company_support_status,
        company_support_completed_at, completion_items, review_submitted_at,
        review_target_status, reviewed_at, review_rejected_at, review_rejected_reason,
        review_rejected_items, source_text, source_batch_id, source_meeting_id,
        source_file_name, source_decision_id, source_trace_label, created_at, updated_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,
        $22,$23,$24,
        $25,$26,$27,$28,
        $29,$30,$31,$32,
        $33,$34,$35,$36,$37
      )
      on conflict (id) do update set
        meeting_id = excluded.meeting_id,
        content = excluded.content,
        title = excluded.title,
        description = excluded.description,
        owner_id = excluded.owner_id,
        owner_label = excluded.owner_label,
        department_id = excluded.department_id,
        owner_department_label = excluded.owner_department_label,
        reviewer_id = excluded.reviewer_id,
        collaborator_department_ids = excluded.collaborator_department_ids,
        collaborator_department_labels = excluded.collaborator_department_labels,
        start_date = excluded.start_date,
        due_date = excluded.due_date,
        goal = excluded.goal,
        priority = excluded.priority,
        status = excluded.status,
        approval_status = excluded.approval_status,
        rejected_reason = excluded.rejected_reason,
        company_support_request = excluded.company_support_request,
        company_support_status = excluded.company_support_status,
        company_support_completed_at = excluded.company_support_completed_at,
        completion_items = excluded.completion_items,
        review_submitted_at = excluded.review_submitted_at,
        review_target_status = excluded.review_target_status,
        reviewed_at = excluded.reviewed_at,
        review_rejected_at = excluded.review_rejected_at,
        review_rejected_reason = excluded.review_rejected_reason,
        review_rejected_items = excluded.review_rejected_items,
        source_text = excluded.source_text,
        source_batch_id = excluded.source_batch_id,
        source_meeting_id = excluded.source_meeting_id,
        source_file_name = excluded.source_file_name,
        source_decision_id = excluded.source_decision_id,
        source_trace_label = excluded.source_trace_label,
        updated_at = excluded.updated_at
    `,
    [
      task.id,
      task.meetingId,
      task.content ?? null,
      task.title,
      task.description,
      task.ownerId || null,
      task.owner ?? null,
      task.departmentId || null,
      task.ownerDepartment ?? null,
      task.reviewerId ?? null,
      toJson(task.collaboratorDepartmentIds),
      toJson(task.collaboratorDepartments ?? []),
      task.startDate ?? null,
      task.dueDate,
      task.goal ?? null,
      task.priority,
      task.status,
      task.approvalStatus ?? null,
      task.rejectedReason ?? null,
      task.companySupportRequest ?? null,
      task.companySupportStatus ?? null,
      task.companySupportCompletedAt ?? null,
      toJson(task.completionItems ?? []),
      task.reviewSubmittedAt ?? null,
      task.reviewTargetStatus ?? null,
      task.reviewedAt ?? null,
      task.reviewRejectedAt ?? null,
      task.reviewRejectedReason ?? null,
      toJson(task.reviewRejectedItems ?? []),
      task.sourceText ?? null,
      task.sourceBatchId ?? null,
      task.sourceMeetingId ?? null,
      task.sourceFileName ?? null,
      task.sourceDecisionId ?? null,
      task.sourceTraceLabel ?? null,
      task.createdAt,
      task.updatedAt
    ]
  );
  await syncTaskProgressEntries(client, task);
}

async function syncTaskProgressEntries(client: PoolClient, task: Task) {
  for (const entry of task.completionHistory ?? []) {
    await upsertTaskProgressEntry(client, task.id, entry);
  }
}

async function upsertTaskProgressEntry(client: PoolClient, taskId: string, entry: TaskProgressEntry) {
  await client.query(
    `
      insert into task_progress_entries (id, task_id, submitted_at, submitted_by, target_status, items)
      values ($1,$2,$3,$4,$5,$6)
      on conflict (id) do update set
        task_id = excluded.task_id,
        submitted_at = excluded.submitted_at,
        submitted_by = excluded.submitted_by,
        target_status = excluded.target_status,
        items = excluded.items
    `,
    [entry.id, taskId, entry.submittedAt, entry.submittedBy ?? null, entry.targetStatus ?? null, toJson(entry.items)]
  );
}

async function upsertMeeting(client: PoolClient, meeting: Meeting) {
  await client.query(
    `
      insert into meetings (
        id, title, department_id, meeting_type, host_id, participant_count,
        start_time, end_time, duration_minutes, total_man_hours, raw_transcript,
        transcript, uploaded_file_name, source_batch_id, source_file_name,
        source_extracted_at, source_template_name, source_template_version,
        okr_project_id, okr_project_name, summary, ai_summary, minute_markdown,
        conclusions, approval_status, status, created_by, approved_by, approved_at,
        rejected_reason, created_at, updated_at
      )
      values (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,
        $30,$31,$32
      )
      on conflict (id) do update set
        title = excluded.title,
        department_id = excluded.department_id,
        meeting_type = excluded.meeting_type,
        host_id = excluded.host_id,
        participant_count = excluded.participant_count,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        duration_minutes = excluded.duration_minutes,
        total_man_hours = excluded.total_man_hours,
        raw_transcript = excluded.raw_transcript,
        transcript = excluded.transcript,
        uploaded_file_name = excluded.uploaded_file_name,
        source_batch_id = excluded.source_batch_id,
        source_file_name = excluded.source_file_name,
        source_extracted_at = excluded.source_extracted_at,
        source_template_name = excluded.source_template_name,
        source_template_version = excluded.source_template_version,
        okr_project_id = excluded.okr_project_id,
        okr_project_name = excluded.okr_project_name,
        summary = excluded.summary,
        ai_summary = excluded.ai_summary,
        minute_markdown = excluded.minute_markdown,
        conclusions = excluded.conclusions,
        approval_status = excluded.approval_status,
        status = excluded.status,
        created_by = excluded.created_by,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        rejected_reason = excluded.rejected_reason,
        updated_at = excluded.updated_at
    `,
    [
      meeting.id,
      meeting.title,
      meeting.departmentId || null,
      meeting.type,
      meeting.hostId || null,
      meeting.participantCount ?? meeting.participantIds.length,
      meeting.startTime,
      meeting.endTime ?? null,
      meeting.durationMinutes,
      meeting.totalManHours ?? null,
      meeting.rawTranscript,
      meeting.transcript ?? null,
      meeting.uploadedFileName ?? null,
      meeting.sourceBatchId ?? null,
      meeting.sourceFileName ?? null,
      meeting.sourceExtractedAt ?? null,
      meeting.sourceTemplateName ?? null,
      meeting.sourceTemplateVersion ?? null,
      meeting.okrProjectId ?? null,
      meeting.okrProjectName ?? null,
      meeting.summary,
      meeting.aiSummary ?? null,
      meeting.minuteMarkdown ?? null,
      toJson(meeting.conclusions),
      meeting.approvalStatus ?? null,
      meeting.status,
      meeting.createdBy ?? null,
      meeting.approvedBy ?? null,
      meeting.approvedAt ?? null,
      meeting.rejectedReason ?? null,
      meeting.createdAt,
      meeting.approvedAt ?? meeting.createdAt
    ]
  );
  await syncMeetingParticipants(client, meeting);
  await syncMeetingDecisions(client, meeting);
  await upsertMeetingMinute(client, meeting);
  for (const task of meeting.tasks ?? []) {
    await upsertTask(client, { ...task, meetingId: meeting.id });
  }
}

async function syncMeetingParticipants(client: PoolClient, meeting: Meeting) {
  await client.query("delete from meeting_participants where meeting_id = $1", [meeting.id]);
  for (const userId of [...new Set(meeting.participantIds)]) {
    await client.query(
      `
        insert into meeting_participants (meeting_id, user_id)
        values ($1, $2)
        on conflict (meeting_id, user_id) do nothing
      `,
      [meeting.id, userId]
    );
  }
}

async function syncMeetingDecisions(client: PoolClient, meeting: Meeting) {
  for (const decision of meeting.decisions ?? []) {
    await upsertMeetingDecision(client, meeting.id, decision);
  }
}

async function upsertMeetingDecision(client: PoolClient, meetingId: string, decision: MeetingDecision) {
  await client.query(
    `
      insert into meeting_decisions (
        id, meeting_id, content, owner_id, impact_scope,
        need_president_confirmation, source_batch_id, source_text
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (id) do update set
        meeting_id = excluded.meeting_id,
        content = excluded.content,
        owner_id = excluded.owner_id,
        impact_scope = excluded.impact_scope,
        need_president_confirmation = excluded.need_president_confirmation,
        source_batch_id = excluded.source_batch_id,
        source_text = excluded.source_text
    `,
    [
      decision.id,
      meetingId,
      decision.content,
      decision.ownerId || null,
      decision.impactScope,
      decision.needPresidentConfirmation,
      decision.sourceBatchId ?? null,
      decision.sourceText ?? null
    ]
  );
}

async function upsertMeetingMinute(client: PoolClient, meeting: Meeting) {
  await client.query(
    `
      insert into meeting_minutes (
        id, meeting_id, summary, ai_summary, minute_markdown,
        source_template_name, source_template_version, created_at, updated_at
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (id) do update set
        meeting_id = excluded.meeting_id,
        summary = excluded.summary,
        ai_summary = excluded.ai_summary,
        minute_markdown = excluded.minute_markdown,
        source_template_name = excluded.source_template_name,
        source_template_version = excluded.source_template_version,
        updated_at = excluded.updated_at
    `,
    [
      `${meeting.id}-minute`,
      meeting.id,
      meeting.summary,
      meeting.aiSummary ?? null,
      meeting.minuteMarkdown ?? null,
      meeting.sourceTemplateName ?? null,
      meeting.sourceTemplateVersion ?? null,
      meeting.createdAt,
      meeting.approvedAt ?? meeting.createdAt
    ]
  );
}

async function applyTaskAction(
  currentUser: User,
  action: (state: Awaited<ReturnType<typeof readDbState>>) => { stateMeetings: Meeting[]; stateTasks: Task[]; activityLogs: ActivityLog[]; task: Task }
) {
  return withDbTransaction(async (client) => {
    const state = await readDbState(client);
    const beforeLogIds = currentIds(state.activityLogs);
    const result = action(state);
    await upsertTask(client, result.task);
    const affectedMeeting = result.stateMeetings.find((meeting) => meeting.id === result.task.meetingId);
    if (affectedMeeting) {
      await upsertMeeting(client, affectedMeeting);
    }
    const newLogs = result.activityLogs.filter((log) => !beforeLogIds.has(log.id));
    await insertActivityLogs(client, newLogs);
    return result.task;
  });
}

export async function saveTaskCompletionItemsDb(currentUser: User, taskId: string, completionItems: string[]) {
  return applyTaskAction(currentUser, (state) => saveTaskCompletionItems(state, currentUser, taskId, completionItems));
}

export async function submitTaskReviewDb(currentUser: User, taskId: string, status: TaskStatus) {
  return applyTaskAction(currentUser, (state) => submitTaskReview(state, currentUser, taskId, status));
}

export async function confirmTaskReviewDb(currentUser: User, taskId: string) {
  return applyTaskAction(currentUser, (state) => confirmTaskReviewAction(state, currentUser, taskId));
}

export async function rejectTaskReviewDb(currentUser: User, taskId: string, reasonItems: string[]) {
  return applyTaskAction(currentUser, (state) => rejectTaskReviewAction(state, currentUser, taskId, reasonItems));
}

export async function approveTaskDb(currentUser: User, taskId: string) {
  return applyTaskAction(currentUser, (state) => approveTaskAction(state, currentUser, taskId));
}

export async function rejectTaskApprovalDb(currentUser: User, taskId: string, reason?: string) {
  return applyTaskAction(currentUser, (state) => rejectTaskApprovalAction(state, currentUser, taskId, reason));
}

export async function completeCompanySupportDb(currentUser: User, taskId: string) {
  return applyTaskAction(currentUser, (state) => completeCompanySupportAction(state, currentUser, taskId));
}

export async function deleteTaskDb(currentUser: User, taskId: string) {
  return withDbTransaction(async (client) => {
    const state = await readDbState(client);
    const beforeLogIds = currentIds(state.activityLogs);
    const result = deleteTaskAction(state, currentUser, taskId);
    const newLogs = result.activityLogs.filter((log) => !beforeLogIds.has(log.id));
    await insertActivityLogs(client, newLogs);
    await client.query("delete from tasks where id = $1", [taskId]);
    return result.task;
  });
}

export async function submitMeetingApprovalDb(currentUser: User, submittedMeeting: Meeting) {
  return withDbTransaction(async (client) => {
    const state = await readDbState(client);
    const beforeLogIds = currentIds(state.activityLogs);
    const result = submitMeetingApprovalAction(state, currentUser, submittedMeeting);
    await upsertMeeting(client, result.meeting);
    await client.query("delete from activity_logs where action = $1 and meeting_id = $2", ["submit_meeting_approval", result.meeting.id]);
    await insertActivityLogs(client, result.activityLogs.filter((log) => !beforeLogIds.has(log.id)));
    return result.meeting;
  });
}

export async function saveRecordedMeetingDb(currentUser: User, meeting: Meeting) {
  return withDbTransaction(async (client) => {
    await upsertMeeting(client, meeting);
    await insertActivityLogs(client, [
      {
        id: `${meeting.id}-recording-uploaded`,
        action: "mobile_recording_uploaded",
        title: "手机端录音已上传",
        detail: `手机端已上传录音文件：${meeting.uploadedFileName || meeting.sourceFileName || meeting.id}`,
        meetingId: meeting.id,
        actorId: currentUser.id,
        actorName: currentUser.name,
        createdAt: meeting.createdAt
      }
    ]);
    return meeting;
  });
}

export async function deleteDraftRecordingMeetingDb(currentUser: User, meetingId: string) {
  return withDbTransaction(async (client) => {
    const state = await readDbState(client);
    const meeting = state.meetings.find((item) => item.id === meetingId);
    if (!meeting) throw new Error("meeting_not_found");
    const isMobileRecording = meeting.sourceTemplateName === "mobile-browser-recording" || meeting.id.startsWith("mobile-recording-");
    const isDraft = meeting.status === "draft" && (meeting.approvalStatus === "draft" || !meeting.approvalStatus);
    const isOwner = meeting.createdBy === currentUser.id || meeting.hostId === currentUser.id;
    if (!isMobileRecording || !isDraft || !isOwner) throw new Error("forbidden_delete_meeting");
    await client.query("delete from meetings where id = $1", [meetingId]);
    return meeting;
  });
}

export async function approveMeetingDb(currentUser: User, meetingId: string) {
  return withDbTransaction(async (client) => {
    const state = await readDbState(client);
    const beforeLogIds = currentIds(state.activityLogs);
    const result = approveMeetingAction(state, currentUser, meetingId);
    await upsertMeeting(client, result.meeting);
    for (const task of result.approvedTasks ?? []) {
      await upsertTask(client, task);
    }
    await insertActivityLogs(client, result.activityLogs.filter((log) => !beforeLogIds.has(log.id)));
    return { meeting: result.meeting, approvedTasks: result.approvedTasks };
  });
}

export async function rejectMeetingApprovalDb(currentUser: User, meetingId: string, reason?: string) {
  return withDbTransaction(async (client) => {
    const state = await readDbState(client);
    const beforeLogIds = currentIds(state.activityLogs);
    const result = rejectMeetingApprovalAction(state, currentUser, meetingId, reason);
    await upsertMeeting(client, result.meeting);
    await insertActivityLogs(client, result.activityLogs.filter((log) => !beforeLogIds.has(log.id)));
    return { meeting: result.meeting };
  });
}

export async function readNotificationReadIdsDb(currentUser: User) {
  const state = await readDbState();
  return state.notificationReadIdsByUser[currentUser.id] ?? [];
}

export async function replaceNotificationReadIdsDb(currentUser: User, readIds: string[]) {
  return withDbTransaction(async (client) => {
    await client.query("delete from notification_reads where user_id = $1", [currentUser.id]);
    for (const notificationId of readIds) {
      await client.query(
        `
          insert into notification_reads (user_id, notification_id)
          values ($1, $2)
          on conflict (user_id, notification_id) do nothing
        `,
        [currentUser.id, notificationId]
      );
    }
    return readIds;
  });
}
