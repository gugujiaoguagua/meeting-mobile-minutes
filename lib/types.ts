export type Role = "总裁" | "部门负责人" | "员工";

export type MeetingType =
  | "门店周会"
  | "研发会议"
  | "售后复盘"
  | "AI项目会议"
  | "经营例会"
  | "培训会议";

export type MeetingStatus = "draft" | "summarized" | "closed";

export type ApprovalStatus =
  | "draft"
  | "ai_generated"
  | "supervisor_edited"
  | "pending_president_approval"
  | "approved"
  | "rejected"
  | "in_closed_loop";

export type TaskStatus = "not_started" | "in_progress" | "pending_review" | "completed" | "overdue" | "blocked" | "未开始" | "进行中" | "已完成";

export type Priority = "高" | "中" | "低";

export type PageKey =
  | "notifications"
  | "dashboard"
  | "meetings"
  | "meeting-summaries"
  | "new-meeting"
  | "meeting-detail"
  | "tasks"
  | "my-tasks"
  | "departments"
  | "dictionary"
  | "kr-projects"
  | "wecom-outbox";

export interface Department {
  id: string;
  name: string;
  managerId: string;
  description: string;
  orgCode?: string;
  fullPath?: string;
  orgType?: string;
  source?: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  departmentId: string;
  title: string;
  employeeNo?: string;
  managerId?: string;
  source?: string;
}

export interface MeetingDecision {
  id: string;
  content: string;
  ownerId: string;
  impactScope: string;
  needPresidentConfirmation: boolean;
  sourceBatchId?: string;
  sourceText?: string;
}

export interface TaskProgressEntry {
  id: string;
  submittedAt: string;
  submittedBy?: string;
  targetStatus?: TaskStatus;
  items: string[];
}

export interface Meeting {
  id: string;
  title: string;
  departmentId: string;
  type: MeetingType;
  hostId: string;
  participantIds: string[];
  participantCount?: number;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  totalManHours?: number;
  rawTranscript: string;
  transcript?: string;
  uploadedFileName?: string;
  sourceBatchId?: string;
  sourceFileName?: string;
  sourceExtractedAt?: string;
  sourceTemplateName?: string;
  sourceTemplateVersion?: string;
  okrProjectId?: string;
  okrProjectName?: string;
  summary: string;
  aiSummary?: string;
  minuteMarkdown?: string;
  conclusions: string[];
  decisions?: MeetingDecision[];
  approvalStatus?: ApprovalStatus;
  tasks?: Task[];
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  status: MeetingStatus;
  createdAt: string;
}

export interface Task {
  id: string;
  content?: string;
  owner?: string;
  ownerDepartment?: string;
  collaboratorDepartments?: string[];
  reviewerId?: string;
  reviewSubmittedAt?: string;
  reviewTargetStatus?: TaskStatus;
  reviewedAt?: string;
  reviewRejectedAt?: string;
  reviewRejectedReason?: string;
  reviewRejectedItems?: string[];
  startDate?: string;
  goal?: string;
  companySupportRequest?: string;
  companySupportStatus?: "pending" | "completed";
  companySupportCompletedAt?: string;
  completionItems?: string[];
  completionHistory?: TaskProgressEntry[];
  sourceText?: string;
  sourceBatchId?: string;
  sourceMeetingId?: string;
  sourceFileName?: string;
  sourceDecisionId?: string;
  sourceTraceLabel?: string;
  approvalStatus?: ApprovalStatus;
  rejectedReason?: string;
  title: string;
  description: string;
  meetingId: string;
  ownerId: string;
  departmentId: string;
  collaboratorDepartmentIds: string[];
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  title: string;
  detail: string;
  meetingId?: string;
  taskId?: string;
  actorId?: string;
  actorName?: string;
  fromStatus?: string;
  toStatus?: string;
  createdAt: string;
}
