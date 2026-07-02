import { getTaskDepartmentId, getTaskOwnerId, getTaskReviewerId, getUserDepartmentId } from "@/lib/permission";
import type { Meeting, MeetingType, Task, User } from "@/lib/types";
import type { MobileGeneratedMinuteDraft } from "./mobileMinutesTypes";

function currentIsoTime() {
  return new Date().toISOString();
}

function safeMeetingType(meeting?: Meeting): MeetingType {
  return meeting?.type ?? "AI项目会议";
}

function submittedMeetingId(meeting: Meeting | undefined, generatedAt: string) {
  const sourceId = meeting?.id ?? "mobile-record";
  if (meeting?.status === "closed" || meeting?.approvalStatus === "in_closed_loop") {
    return `mobile-submit-${sourceId}-${Date.parse(generatedAt) || Date.now()}`;
  }
  return sourceId;
}

function normalizeTask(task: Task, meeting: Meeting, currentUser: User, index: number): Task {
  const ownerId = getTaskOwnerId(task) || currentUser.id;
  const departmentId = getTaskDepartmentId(task) || getUserDepartmentId(ownerId) || currentUser.departmentId;
  const withOwner = {
    ...task,
    owner: ownerId,
    ownerId,
    ownerDepartment: departmentId,
    departmentId
  };
  const reviewerId = getTaskReviewerId(withOwner, meeting);
  const createdAt = task.createdAt || meeting.createdAt;

  return {
    ...withOwner,
    id: `mobile-task-${meeting.id}-${index + 1}`,
    title: task.title || task.content || `会议待办 ${index + 1}`,
    content: task.content || task.title || `会议待办 ${index + 1}`,
    description: task.description || task.sourceText || "由手机端妙记确认生成",
    meetingId: meeting.id,
    sourceMeetingId: meeting.id,
    reviewerId,
    collaboratorDepartmentIds: task.collaboratorDepartmentIds ?? [],
    dueDate: task.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    priority: task.priority ?? "中",
    approvalStatus: "pending_president_approval",
    status: "not_started",
    createdAt,
    updatedAt: currentIsoTime()
  };
}

export function buildMobileSubmittedMeeting(params: {
  selectedMeeting?: Meeting;
  generatedDraft: MobileGeneratedMinuteDraft;
  currentUser: User;
}): Meeting {
  const { selectedMeeting, generatedDraft, currentUser } = params;
  const now = currentIsoTime();
  const meetingId = submittedMeetingId(selectedMeeting, generatedDraft.generatedAt);
  const participantIds = selectedMeeting?.participantIds?.length ? selectedMeeting.participantIds : [currentUser.id];
  const transcript = generatedDraft.correctedTranscript || selectedMeeting?.transcript || selectedMeeting?.rawTranscript || "";
  const baseMeeting: Meeting = {
    id: meetingId,
    title: selectedMeeting?.title || "手机端会议妙记",
    departmentId: selectedMeeting?.departmentId || currentUser.departmentId,
    type: safeMeetingType(selectedMeeting),
    hostId: selectedMeeting?.hostId || currentUser.id,
    participantIds,
    participantCount: selectedMeeting?.participantCount ?? participantIds.length,
    startTime: selectedMeeting?.startTime || now,
    endTime: selectedMeeting?.endTime,
    durationMinutes: selectedMeeting?.durationMinutes ?? 0,
    totalManHours: selectedMeeting?.totalManHours,
    rawTranscript: transcript,
    transcript,
    uploadedFileName: selectedMeeting?.uploadedFileName,
    sourceBatchId: selectedMeeting?.sourceBatchId,
    sourceFileName: selectedMeeting?.sourceFileName,
    sourceExtractedAt: selectedMeeting?.sourceExtractedAt,
    sourceTemplateName: selectedMeeting?.sourceTemplateName,
    sourceTemplateVersion: selectedMeeting?.sourceTemplateVersion,
    okrProjectId: selectedMeeting?.okrProjectId,
    okrProjectName: selectedMeeting?.okrProjectName,
    summary: generatedDraft.aiSummary,
    aiSummary: generatedDraft.aiSummary,
    minuteMarkdown: generatedDraft.minuteMarkdown || generatedDraft.aiSummary,
    conclusions: generatedDraft.decisions.map((decision) => decision.content).filter(Boolean),
    decisions: generatedDraft.decisions,
    approvalStatus: "pending_president_approval",
    tasks: [],
    createdBy: currentUser.id,
    status: "summarized",
    createdAt: now
  };

  return {
    ...baseMeeting,
    tasks: generatedDraft.tasks.map((task, index) => normalizeTask(task, baseMeeting, currentUser, index))
  };
}
