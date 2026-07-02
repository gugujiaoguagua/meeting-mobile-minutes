import type { OkrPDCATask, OkrProject } from "@/lib/okrTypes";
import type { ActivityLog, Meeting, MeetingDecision, Task, TaskStatus, User } from "@/lib/types";

export type MainTab = "record" | "messages" | "tasks" | "me";
export type RecordState = "idle" | "recording" | "detail" | "generated";
export type DetailTab = "summary" | "transcript" | "draft";
export type TaskTab = "mine" | "review" | "approval" | "done";
export type Tone = "normal" | "navy" | "success" | "wait" | "risk";
export type MobileTaskActionKind = "completion" | "submit_review" | "review" | "approval" | "support" | "view";
export type MobileReviewTargetStatus = Extract<TaskStatus, "in_progress" | "completed" | "blocked">;

export interface TranscriptLine {
  time: string;
  speaker: string;
  text: string;
}

export interface MobileMessage {
  id: string;
  title: string;
  source: string;
  time: string;
  body: string;
  actionLabel: string;
  tone: Tone;
  taskId?: string;
  meetingId?: string;
  isRead?: boolean;
  sortTime?: number;
}

export interface MobileTask {
  id: string;
  sourceKind?: "meeting" | "okr";
  title: string;
  source: string;
  meetingTitle?: string;
  owner: string;
  reviewer?: string;
  due: string;
  status: string;
  latestAction: string;
  actionLabel: string;
  actionKind: MobileTaskActionKind;
  tone: Tone;
  tab: TaskTab;
  isCurrentUserOwner?: boolean;
  description?: string;
  goal?: string;
  completionItems?: string[];
  reviewRejectedItems?: string[];
  companySupportRequest?: string;
  rawTask?: Task;
  rawOkrTask?: OkrPDCATask;
  rawOkrProject?: OkrProject;
  rawMeeting?: Meeting;
}

export interface MobileMinuteCard {
  id: string;
  title: string;
  meta: string;
  status: string;
  tone: Tone;
  rawMeeting?: Meeting;
}

export interface MobileGeneratedMinuteDraft {
  aiSummary: string;
  minuteMarkdown: string;
  decisions: MeetingDecision[];
  tasks: Task[];
  correctedTranscript?: string;
  dictionaryCorrections?: Array<{
    original?: string;
    standard?: string;
    category?: string;
    note?: string;
  }>;
  sourceMeetingId?: string;
  generatedAt: string;
}

export interface MobileMinutesState {
  currentUser?: User;
  tasks: Task[];
  activityLogs: ActivityLog[];
}
