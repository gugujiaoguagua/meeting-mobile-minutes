"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { User } from "lucide-react";
import { BottomNav } from "./BottomNav";
import { MobileBackendPanel } from "./MobileBackendPanel";
import { MinuteDetail } from "./MinuteDetail";
import { MobileManagementBoard } from "./MobileManagementBoard";
import { MobileMessages } from "./MobileMessages";
import { MobileShell } from "./MobileShell";
import { MobileTasks } from "./MobileTasks";
import { ParticipantPickerSheet } from "./ParticipantPickerSheet";
import { RecordingPanel } from "./RecordingPanel";
import { RecordHome } from "./RecordHome";
import {
  approveTask,
  approveTasksBatch,
  changeOkrTaskEndDate,
  completeCompanySupport,
  confirmTaskReview,
  confirmOkrTaskReview,
  createMeetingDictionaryEntry,
  createOkrProject,
  deleteMeetingDictionaryEntry,
  deleteMeeting,
  fetchCurrentUser,
  fetchLatestMeetingDraft,
  fetchMeetingBoard,
  fetchMeetingDictionary,
  fetchMeetingState,
  fetchMobileRecordingStatus,
  fetchOkrProjects,
  fetchTencentRealtimeAsrUrl,
  fetchWecomMessages,
  generateMeetingDraft,
  loginWithAccount,
  logoutAccount,
  rejectTaskApproval,
  rejectOkrTaskReview,
  rejectTaskReview,
  saveNotificationReadIds,
  saveMeetingSpeakerAssignments,
  saveOkrTaskCompletion,
  saveTaskCompletion,
  submitOkrTaskReview,
  submitMeetingApproval,
  submitTaskReview,
  type MeetingDraftSpeakerAssignment,
  uploadMobileRecording
} from "./mobileMinutesApi";
import {
  isMobileDisplayMeeting,
  mapBackendNotificationsToMessages,
  mapMeetingsToMobileMinuteCards,
  mapOkrProjectsToMobileTasks,
  mapTasksToMobileTasks,
  mergeMobileMessages
} from "./mobileMinutesMappers";
import { buildMobileSubmittedMeeting } from "./mobileMinuteDraftPayload";
import { sampleMessages, sampleTasks } from "./mobileMinutesMock";
import type {
  DetailTab,
  MainTab,
  MobileBackendEntry,
  MobileBackendPage,
  MobileGeneratedMinuteDraft,
  MobileManagementMeetingRow,
  MobileManagementMetrics,
  MobileMessage,
  MobileMinuteCard,
  MobileReviewTargetStatus,
  MobileTask,
  RecordState,
  TaskTab,
  TranscriptLine
} from "./mobileMinutesTypes";
import type { MeetingDictionaryEntry } from "@/lib/meetingDictionary";
import type { OkrProject } from "@/lib/okrTypes";
import { departments as fallbackDepartments, users as fallbackUsers } from "@/lib/orgPeopleData";
import type { Department, Meeting, MeetingBoardResponse, MeetingBoardRow, MeetingBoardStatus, MeetingSpeakerAssignment, Task, User as MeetingUser } from "@/lib/types";
import styles from "./MobileMinutes.module.css";

const SHOW_PARTICIPANT_SELECTION = false;
const USE_SPEAKER_ASSIGNMENT_CONTEXT = false;

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatTranscriptTimeFromMs(milliseconds?: number) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0) return "00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDisplayDate(value: string) {
  const raw = value.trim();
  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasTimeZone ? raw : raw.replace(" ", "T"));
}

function elapsedMsSince(value?: string) {
  if (!value) return 0;
  const startedAt = parseDisplayDate(value).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function userDisplayName(userId: string | undefined, userDirectory: MeetingUser[]) {
  if (!userId) return "";
  return userDirectory.find((user) => user.id === userId)?.name ?? fallbackUsers.find((user) => user.id === userId)?.name ?? "";
}

function userDedupeKeys(user: MeetingUser) {
  const keys: string[] = [];
  if (user.employeeNo) keys.push(`employee:${user.employeeNo.trim().toLowerCase()}`);
  if ((user.source === "wecom" || user.id.startsWith("emp-")) && user.name && user.departmentId) {
    keys.push(`name-department:${user.name.trim().toLowerCase()}:${user.departmentId.trim().toLowerCase()}`);
  }
  if ((user.source === "wecom" || user.id.startsWith("emp-")) && user.name && user.title) {
    keys.push(`name-title:${user.name.trim().toLowerCase()}:${user.title.trim().toLowerCase()}`);
  }
  if (user.id.startsWith("u-") && user.name && user.role !== "员工") {
    keys.push(`legacy-name-role:${user.name.trim().toLowerCase()}:${user.role}`);
  }
  if (user.id.startsWith("emp-") && user.name && user.role !== "员工") {
    keys.push(`legacy-name-role:${user.name.trim().toLowerCase()}:${user.role}`);
  }
  return keys;
}

function rolePriority(user: MeetingUser) {
  if (user.role === "总裁") return 0;
  if (user.role === "部门负责人") return 1;
  return 2;
}

function isBusinessDirectoryUser(user: MeetingUser) {
  return user.source !== "wecom" && !user.id.startsWith("u-");
}

function userPriority(user: MeetingUser) {
  return [rolePriority(user), isBusinessDirectoryUser(user) ? 0 : 1, user.employeeNo ? 0 : 1, user.source === "wecom" ? 1 : 0, user.id.startsWith("u-") ? 1 : 0, user.id] as const;
}

function compareUserPriority(a: MeetingUser, b: MeetingUser) {
  const left = userPriority(a);
  const right = userPriority(b);
  for (let index = 0; index < left.length; index += 1) {
    const diff = String(left[index]).localeCompare(String(right[index]));
    if (diff !== 0) return diff;
  }
  return 0;
}

function dedupeMobileUsers(users: MeetingUser[]) {
  const kept = new Map<string, MeetingUser>();
  const keyToUserId = new Map<string, string>();
  for (const user of users) {
    const keys = userDedupeKeys(user);
    const matchedId = keys.map((key) => keyToUserId.get(key)).find(Boolean);
    if (!matchedId) {
      kept.set(user.id, user);
      keys.forEach((key) => keyToUserId.set(key, user.id));
      continue;
    }
    const current = kept.get(matchedId);
    if (!current || compareUserPriority(user, current) < 0) {
      kept.delete(matchedId);
      kept.set(user.id, user);
      keys.forEach((key) => keyToUserId.set(key, user.id));
      if (current) userDedupeKeys(current).forEach((key) => keyToUserId.set(key, user.id));
    }
  }
  return [...kept.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.id.localeCompare(b.id));
}

function buildDraftSpeakerAssignments(meeting: Meeting | undefined, userDirectory: MeetingUser[]): MeetingDraftSpeakerAssignment[] {
  if (!USE_SPEAKER_ASSIGNMENT_CONTEXT) return [];
  return (meeting?.speakerAssignments ?? [])
    .map((assignment) => ({
      speakerLabel: assignment.speakerLabel.trim(),
      userId: assignment.userId,
      userName: userDisplayName(assignment.userId, userDirectory).trim()
    }))
    .filter((assignment) => assignment.speakerLabel && assignment.userName);
}

function applySpeakerAssignmentsToTranscript(transcript: string, assignments: MeetingDraftSpeakerAssignment[]) {
  if (!assignments.length) return transcript;
  const speakerNames = new Map(assignments.map((assignment) => [assignment.speakerLabel, assignment.userName]));
  return transcript
    .split(/\r?\n/)
    .map((line) =>
      line.replace(
        /^(\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:[·\-.]\s*)?)?)(发言人\d{1,2})(\s*[：:])/,
        (matched, prefix: string, speakerLabel: string, suffix: string) => {
          const speakerName = speakerNames.get(speakerLabel);
          return speakerName ? `${prefix}${speakerName}${suffix}` : matched;
        }
      )
    )
    .join("\n");
}

function buildTranscriptForDraft(meeting: Meeting | undefined, userDirectory: MeetingUser[]) {
  const transcript = meeting?.transcript || meeting?.rawTranscript || "";
  const assignments = buildDraftSpeakerAssignments(meeting, userDirectory);
  return applySpeakerAssignmentsToTranscript(transcript, assignments).trim();
}

function countTranscriptWords(text: string) {
  const chinese = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const words = text.replace(/[\u4e00-\u9fa5]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return chinese + words;
}

function isSameLocalDate(value?: string) {
  if (!value) return false;
  const date = parseDisplayDate(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

function isManagerUser(user?: MeetingUser) {
  return user?.role === "总裁" || user?.role === "部门负责人";
}

function managerScopeLabel(user?: MeetingUser) {
  if (user?.role === "总裁") return "全公司";
  if (user?.role === "部门负责人") return "本部门";
  return "个人";
}

function normalizeParticipantIds(user?: MeetingUser, ids: string[] = []) {
  return [...new Set([user?.id, ...ids].filter((value): value is string => Boolean(value)))];
}

function boardStatusLabel(status: MeetingBoardStatus): { status: string; tone: "normal" | "success" | "wait" | "risk"; priority: number } {
  if (status === "recording_failed") return { status: "转写异常", tone: "risk", priority: 5 };
  if (status === "recording_transcribing") return { status: "精修中", tone: "wait", priority: 4 };
  if (status === "pending_approval") return { status: "待签批", tone: "wait", priority: 3 };
  if (status === "needs_minutes" || status === "needs_approval_submission") return { status: "待确认", tone: "wait", priority: 2 };
  if (status === "closed" || status === "in_closed_loop") return { status: "已闭环", tone: "success", priority: 0 };
  return { status: "进行中", tone: "normal", priority: 1 };
}

function liveTranscriptText(lines: TranscriptLine[]) {
  return lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

type PendingRecordingUpload = {
  id: string;
  title: string;
  startedAt?: string;
  durationSeconds: number;
  createdAt: string;
};

function pendingRecordingMeta(item: PendingRecordingUpload) {
  const durationMinutes = item.durationSeconds > 0 ? Math.max(1, Math.ceil(item.durationSeconds / 60)) : 0;
  const durationLabel = durationMinutes ? `${durationMinutes} 分钟` : "未计时";
  return `刚刚 · ${durationLabel} · 后台上传和云端精修中`;
}

function pendingRecordingCard(item: PendingRecordingUpload): MobileMinuteCard {
  return {
    id: item.id,
    title: item.title,
    meta: pendingRecordingMeta(item),
    status: "处理中",
    tone: "wait",
    isPending: true
  };
}

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

function isTransientRecordingNetworkError(error: unknown) {
  const message = rawErrorMessage(error).toLowerCase();
  return ["load failed", "failed to fetch", "networkerror", "network request failed", "fetch failed", "the network connection was lost"].some((item) => message.includes(item));
}

function recordingUploadMessage(error: unknown) {
  const message = rawErrorMessage(error);
  if (isTransientRecordingNetworkError(error)) {
    return "网络暂时不稳定，录音状态暂未刷新；请稍后在最近妙记查看，系统会继续同步云端精修状态。";
  }
  if (message.includes("audio too large")) return "录音文件过大，当前版本暂不支持这段长录音上传。";
  if (message.includes("not authenticated")) return "登录状态已过期，请重新进入后再录音。";
  return message ? `录音上传暂未完成：${message}` : "录音上传暂未完成，请稍后重试。";
}

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type TencentRealtimeAsrMessage = {
  code?: number;
  message?: string;
  final?: number;
  result?: {
    slice_type?: number;
    index?: number;
    start_time?: number;
    voice_text_str?: string;
  };
};

type MobileConfirmDialogState = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
};

type AudioContextWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

const TENCENT_REALTIME_SAMPLE_RATE = 16000;
const TENCENT_REALTIME_PACKET_SAMPLES = 3200;
const HIDDEN_MOBILE_MINUTES_KEY = "mobile-minutes-hidden-meetings-v1";
const GENERATED_DRAFTS_KEY = "mobile-minutes-generated-drafts-v1";

function MobileLoginPage({
  username,
  password,
  message,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: {
  username: string;
  password: string;
  message: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <h1 className={styles.title}>AI 会议闭环</h1>
      </header>
      <section className={`${styles.card} ${styles.profileCard}`}>
        <div className={styles.profileRow}>
          <div className={styles.profileAvatar}>
            <User aria-hidden="true" />
          </div>
          <div className={styles.profileMain}>
            <h2 className={styles.cardTitle}>账号登录</h2>
            <p className={styles.smallText}>使用姓名账号和密码进入系统</p>
          </div>
        </div>
        <form className={styles.mobileFormGrid} onSubmit={onSubmit}>
          <label className={styles.mobileField}>
            <span>账号</span>
            <input value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="请输入姓名账号" autoComplete="username" />
          </label>
          <label className={styles.mobileField}>
            <span>密码</span>
            <input value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="请输入密码" type="password" autoComplete="current-password" />
          </label>
          <button className={styles.primaryWideButton} type="submit">登录</button>
          {message ? <p className={styles.formMessage}>{message}</p> : null}
        </form>
      </section>
    </div>
  );
}

function ProfilePage({
  user,
  departmentDirectory,
  onLogout
}: {
  user?: MeetingUser;
  departmentDirectory: Department[];
  onLogout?: () => void;
}) {
  const department = departmentDirectory.find((item) => item.id === user?.departmentId);
  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <h1 className={styles.title}>我的</h1>
      </header>
      <section className={`${styles.card} ${styles.profileCard}`}>
        <div className={styles.profileRow}>
          <div className={styles.profileAvatar}>
            <User aria-hidden="true" />
          </div>
          <div className={styles.profileMain}>
            <h2 className={styles.cardTitle}>{user ? user.name : "企业内部用户"}</h2>
            <p className={styles.smallText}>{user ? [user.role, user.title, department?.name].filter(Boolean).join(" / ") : "会议记录与任务协同"}</p>
          </div>
        </div>
        <p className={styles.formMessage}>当前登录账号：{user?.name ?? "未登录"}</p>
        <button className={styles.primaryWideButton} type="button" onClick={onLogout}>退出登录</button>
      </section>
    </div>
  );
}

export function MobileMinutesApp() {
  const [mainTab, setMainTab] = useState<MainTab>("record");
  const [activeBackendPage, setActiveBackendPage] = useState<MobileBackendPage>("management-dashboard");
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [detailTab, setDetailTab] = useState<DetailTab>("transcript");
  const [taskTab, setTaskTab] = useState<TaskTab>("mine");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [currentUser, setCurrentUser] = useState<MeetingUser | undefined>();
  const [userDirectory, setUserDirectory] = useState<MeetingUser[]>(fallbackUsers);
  const [departmentDirectory, setDepartmentDirectory] = useState<Department[]>(fallbackDepartments);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingBoard, setMeetingBoard] = useState<MeetingBoardResponse | undefined>();
  const [okrProjects, setOkrProjects] = useState<OkrProject[]>([]);
  const [dictionaryEntries, setDictionaryEntries] = useState<MeetingDictionaryEntry[]>([]);
  const [localMessages, setLocalMessages] = useState<MobileMessage[]>([]);
  const [messages, setMessages] = useState<MobileMessage[]>(sampleMessages);
  const [tasks, setTasks] = useState<MobileTask[]>(sampleTasks);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | undefined>();
  const [notificationReadIds, setNotificationReadIds] = useState<string[]>([]);
  const [focusedTaskId, setFocusedTaskId] = useState<string | undefined>();
  const [dataState, setDataState] = useState<"loading" | "demo" | "live" | "error">("loading");
  const [dataMessage, setDataMessage] = useState("正在读取后端数据...");
  const [actionMessage, setActionMessage] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | undefined>();
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState<MobileGeneratedMinuteDraft | undefined>();
  const [generatedDraftsByMeetingId, setGeneratedDraftsByMeetingId] = useState<Record<string, MobileGeneratedMinuteDraft>>({});
  const [isConfirmingGeneratedMeeting, setIsConfirmingGeneratedMeeting] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [submittedGeneratedMeetingId, setSubmittedGeneratedMeetingId] = useState<string | undefined>();
  const [transcriptionStatusMessage, setTranscriptionStatusMessage] = useState("");
  const [recordingStatus, setRecordingStatus] = useState<"requesting" | "recording" | "uploading" | "error">("recording");
  const [recordingMessage, setRecordingMessage] = useState("");
  const [uploadWaitSeconds, setUploadWaitSeconds] = useState(0);
  const [liveTranscriptLines, setLiveTranscriptLines] = useState<TranscriptLine[]>([]);
  const [pendingDeleteMeetingId, setPendingDeleteMeetingId] = useState<string | undefined>();
  const [isDeletingMinute, setIsDeletingMinute] = useState(false);
  const [hiddenMeetingIds, setHiddenMeetingIds] = useState<string[]>([]);
  const [pendingRecordingUpload, setPendingRecordingUpload] = useState<PendingRecordingUpload | undefined>();
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [isParticipantPickerOpen, setIsParticipantPickerOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const launchRouteRef = useRef<{ key: string; resolved: boolean } | undefined>(undefined);
  const mobileConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<string | undefined>(undefined);
  const recordingStoppedSecondsRef = useRef<number | undefined>(undefined);
  const liveTranscriptRef = useRef<TranscriptLine[]>([]);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeAudioContextRef = useRef<AudioContext | null>(null);
  const realtimeSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const realtimeProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const realtimeSendTimerRef = useRef<number | undefined>(undefined);
  const realtimePcmSamplesRef = useRef<number[]>([]);
  const realtimeSegmentMapRef = useRef<Map<number, TranscriptLine>>(new Map());
  const [mobileConfirmDialog, setMobileConfirmDialog] = useState<MobileConfirmDialogState | undefined>();

  function requestMobileConfirm(dialog: MobileConfirmDialogState) {
    mobileConfirmResolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      mobileConfirmResolverRef.current = resolve;
      setMobileConfirmDialog(dialog);
    });
  }

  function closeMobileConfirm(confirmed: boolean) {
    mobileConfirmResolverRef.current?.(confirmed);
    mobileConfirmResolverRef.current = null;
    setMobileConfirmDialog(undefined);
  }

  useEffect(() => {
    if (recordState !== "recording" || recordingStatus !== "recording") return;
    const startedAt = Date.now() - recordingSeconds * 1000;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recordState, recordingSeconds, recordingStatus]);

  useEffect(() => {
    if (!currentUser) return;
    setSelectedParticipantIds((current) => normalizeParticipantIds(currentUser, SHOW_PARTICIPANT_SELECTION ? current : []));
  }, [currentUser]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_MOBILE_MINUTES_KEY) || "[]");
      if (Array.isArray(parsed)) setHiddenMeetingIds(parsed.filter((item): item is string => typeof item === "string"));
    } catch {
      setHiddenMeetingIds([]);
    }
  }, []);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(GENERATED_DRAFTS_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setGeneratedDraftsByMeetingId(parsed as Record<string, MobileGeneratedMinuteDraft>);
      }
    } catch {
      setGeneratedDraftsByMeetingId({});
    }
  }, []);

  useEffect(() => {
    if (recordState !== "recording" || recordingStatus !== "uploading") return;
    const startedAt = Date.now();
    setUploadWaitSeconds(0);
    const timer = window.setInterval(() => {
      setUploadWaitSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recordState, recordingStatus]);

  const loadBackendState = useCallback(async (options?: { silent?: boolean }) => {
      try {
        if (!options?.silent) {
          setDataState("loading");
          setDataMessage("正在读取后端数据...");
        }
        const user = await fetchCurrentUser();
        if (!user) {
          setCurrentUser(undefined);
          setMeetings([]);
          setMeetingBoard(undefined);
          setOkrProjects([]);
          setDictionaryEntries([]);
          setMessages([]);
          setTasks([]);
          setNotificationReadIds([]);
          setDataState("error");
          setDataMessage("当前未登录，请使用账号密码登录。");
          return;
        }

        const [state, nextOkrProjects, nextDictionaryEntries, wecomMessages, board] = await Promise.all([
          fetchMeetingState(),
          fetchOkrProjects().catch(() => []),
          fetchMeetingDictionary().catch(() => []),
          fetchWecomMessages().catch(() => []),
          fetchMeetingBoard().catch(() => undefined)
        ]);
        const nextUsers = dedupeMobileUsers(state.users.length ? state.users : fallbackUsers);
        const nextDepartments = state.departments.length ? state.departments : fallbackDepartments;

        setCurrentUser(user);
        setUserDirectory(nextUsers);
        setDepartmentDirectory(nextDepartments);
        setMeetings(state.meetings);
        setMeetingBoard(board);
        setOkrProjects(nextOkrProjects);
        setDictionaryEntries(nextDictionaryEntries);
        setNotificationReadIds(state.notificationReadIds);
        const mappedMessages = mergeMobileMessages(
          [
            ...localMessages,
            ...mapBackendNotificationsToMessages({
              meetings: state.meetings,
              tasks: state.tasks,
              activityLogs: state.activityLogs,
              readIds: state.notificationReadIds,
              currentUser: user,
              userDirectory: nextUsers
            }),
            ...wecomMessages
          ],
          state.notificationReadIds
        );
        const mappedTasks = [...mapTasksToMobileTasks(state.tasks, user, state.meetings, nextUsers), ...mapOkrProjectsToMobileTasks(nextOkrProjects, user, nextUsers)];
        setMessages(mappedMessages);
        setTasks(mappedTasks);
        setDataState("live");
        setDataMessage(`当前账号：${user.name} / ${user.role}`);
      } catch (error) {
        setDataState("error");
        setDataMessage(error instanceof Error ? error.message : "后端数据读取失败，当前显示演示数据。");
      }
  }, [localMessages]);

  useEffect(() => {
    loadBackendState();
  }, [loadBackendState]);

  useEffect(() => {
    return () => {
      stopTencentRealtimeAsr(false);
      stopSpeechRecognition();
      stopMediaStream();
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void loadBackendState({ silent: true });
    };
    const timer = window.setInterval(refresh, 25000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [loadBackendState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page");
    const taskId = params.get("taskId") || undefined;
    if (!page && !taskId) return;

    const key = `${page || "my-tasks"}:${taskId || ""}`;
    if (launchRouteRef.current?.key === key && launchRouteRef.current.resolved) return;

    if (taskId) {
      const target = tasks.find((task) => task.id === taskId);
      setFocusedTaskId(taskId);
      setTaskTab(target?.tab ?? "mine");
      setMainTab("tasks");
      launchRouteRef.current = { key, resolved: Boolean(target) || tasks.length > 0 };
      return;
    }

    if (page === "notifications") {
      setMainTab("messages");
      launchRouteRef.current = { key, resolved: true };
      return;
    }

    if (page === "tasks" || page === "my-tasks") {
      setTaskTab("mine");
      setFocusedTaskId(undefined);
      setMainTab("tasks");
      launchRouteRef.current = { key, resolved: true };
    }
  }, [tasks]);

  async function runTaskAction(task: MobileTask | undefined, message: string, action: () => Promise<unknown>) {
    if (!task?.rawTask && !task?.rawOkrTask) {
      setActionMessage("当前是演示数据，不能提交到后端。");
      return;
    }
    setBusyTaskId(task.id);
    setActionMessage(`${message}...`);
    try {
      await action();
      setFocusedTaskId(undefined);
      await loadBackendState({ silent: true });
      setActionMessage(`${message}成功。`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("task_not_found")) {
        await loadBackendState({ silent: true });
        setFocusedTaskId(undefined);
        setActionMessage(`${message}已同步，请查看最新列表。`);
        return;
      }
      setActionMessage(error instanceof Error ? `${message}失败：${error.message}` : `${message}失败。`);
    } finally {
      setBusyTaskId(undefined);
    }
  }

  const elapsedTime = useMemo(() => formatElapsed(recordingSeconds), [recordingSeconds]);
  const uploadElapsedTime = useMemo(() => formatElapsed(uploadWaitSeconds), [uploadWaitSeconds]);
  const selectedMeeting = useMemo(() => meetings.find((meeting) => meeting.id === selectedMeetingId), [meetings, selectedMeetingId]);
  const visibleMeetings = useMemo(() => meetings.filter((meeting) => !hiddenMeetingIds.includes(meeting.id)), [hiddenMeetingIds, meetings]);
  const displayMeetings = useMemo(() => visibleMeetings.filter(isMobileDisplayMeeting), [visibleMeetings]);
  const recentMinutes = useMemo(() => {
    const mapped = mapMeetingsToMobileMinuteCards(visibleMeetings);
    return pendingRecordingUpload ? [pendingRecordingCard(pendingRecordingUpload), ...mapped].slice(0, 20) : mapped;
  }, [pendingRecordingUpload, visibleMeetings]);
  const homeMetrics = useMemo(
    () => ({
      todayMeetings: displayMeetings.filter((meeting) => isSameLocalDate(meeting.startTime || meeting.createdAt)).length,
      pendingMinutes: recentMinutes.filter((item) => item.status === "待确认").length,
      activeTasks: tasks.filter((task) => task.tab !== "done").length
    }),
    [displayMeetings, recentMinutes, tasks]
  );
  const selectedParticipants = useMemo(() => {
    const ids = normalizeParticipantIds(currentUser, selectedParticipantIds);
    return ids.map((userId) => userDirectory.find((user) => user.id === userId) ?? fallbackUsers.find((user) => user.id === userId)).filter((user): user is MeetingUser => Boolean(user));
  }, [currentUser, selectedParticipantIds, userDirectory]);
  const selectedParticipantNames = useMemo(() => selectedParticipants.map((user) => user.name), [selectedParticipants]);
  const managementMetrics = useMemo<MobileManagementMetrics | undefined>(() => {
    if (!isManagerUser(currentUser) || !meetingBoard) return undefined;
    const summary = meetingBoard.summary;
    return {
      scopeLabel: managerScopeLabel(currentUser),
      totalMeetings: summary.totalMeetings,
      todayMeetings: summary.todayMeetings,
      transcribingMeetings: summary.transcribing,
      failedMeetings: summary.failedRecordings,
      pendingMinutes: summary.needsMinutes + summary.needsApprovalSubmission,
      pendingApprovalMeetings: summary.pendingApproval,
      activeMeetingTasks: summary.activeTaskCount,
      reviewTasks: summary.reviewTaskCount,
      approvalTasks: summary.approvalTaskCount,
      overdueTasks: summary.overdueTaskCount
    };
  }, [currentUser, meetingBoard]);
  const managementAttentionMeetings = useMemo<MobileManagementMeetingRow[]>(() => {
    if (!managementMetrics || !meetingBoard) return [];
    return meetingBoard.rows
      .map((row: MeetingBoardRow) => {
        const status = boardStatusLabel(row.boardStatus);
        const startedAt = row.startTime ? parseDisplayDate(row.startTime) : undefined;
        const timeLabel = startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "时间未定";
        return {
          id: row.meetingId,
          title: row.title,
          meta: `${timeLabel} · ${row.hostName} · ${row.durationMinutes || 0} 分钟`,
          status: status.status,
          tone: status.tone,
          priority: status.priority,
          sortTime: Date.parse(row.startTime || "")
        };
      })
      .filter((row) => row.priority > 0)
      .sort((a, b) => b.priority - a.priority || (Number.isFinite(b.sortTime) ? b.sortTime : 0) - (Number.isFinite(a.sortTime) ? a.sortTime : 0))
      .slice(0, 6)
      .map(({ priority, sortTime, ...row }) => row);
  }, [managementMetrics, meetingBoard]);
  const backendEntries = useMemo<MobileBackendEntry[]>(() => {
    if (!currentUser) return [];
    const manager = isManagerUser(currentUser);
    const entries: MobileBackendEntry[] = [];
    entries.push({
      id: "new-meeting",
      title: "新建会议",
      description: "手机端录入会议并提交签批",
      status: "新建",
      tone: "navy"
    });
    if (manager && managementMetrics) {
      entries.push({
        id: "management-dashboard",
        title: "管理驾驶舱",
        description: `${managementMetrics.scopeLabel} · ${managementMetrics.totalMeetings} 场会议 · ${managementMetrics.activeMeetingTasks} 个待办`,
        status: managementMetrics.failedMeetings + managementMetrics.overdueTasks > 0 ? "需关注" : "查看",
        tone: managementMetrics.failedMeetings + managementMetrics.overdueTasks > 0 ? "risk" : "navy"
      });
      entries.push({
        id: "meeting-board",
        title: "会议看板",
        description: `${managementMetrics.totalMeetings} 场会议 · ${managementMetrics.activeMeetingTasks} 个会议待办`,
        status: "查看",
        tone: managementMetrics.failedMeetings + managementMetrics.overdueTasks > 0 ? "risk" : "navy"
      });
      entries.push({
        id: "meeting-list",
        title: "会议列表",
        description: `${visibleMeetings.length} 场可见会议`,
        status: "进入",
        tone: "navy"
      });
      entries.push({
        id: "departments",
        title: "部门看板",
        description: `${departmentDirectory.length} 个部门 · 按可见数据统计`,
        status: "进入",
        tone: "navy"
      });
      entries.push({
        id: "okr-projects",
        title: "OKR 项目",
        description: `${okrProjects.length} 个可见项目`,
        status: "进入",
        tone: okrProjects.some((project) => project.riskLevel === "高") ? "risk" : "navy"
      });
    } else {
      entries.push({
        id: "meeting-list",
        title: "我的会议",
        description: `${visibleMeetings.length} 场与我相关`,
        status: "查看",
        tone: "navy"
      });
    }
    entries.push({
      id: "dictionary",
      title: "会议词典",
      description: `${dictionaryEntries.length} 条转写纠错词`,
      status: "查看",
      tone: "normal"
    });
    return entries;
  }, [currentUser, departmentDirectory.length, dictionaryEntries.length, managementMetrics, okrProjects, visibleMeetings.length]);
  const unreadMessageCount = useMemo(() => messages.filter((message) => !message.isRead).length, [messages]);
  const inDetail = recordState === "detail" || recordState === "generated";
  const detailTranscriptionStatusMessage =
    transcriptionStatusMessage ||
    (selectedMeeting?.recordingStatus === "transcribing" ? selectedMeeting.recordingStatusMessage || "云端精修中，完成后会自动更新转写。" : "");
  const connectionLabel = dataState === "live" ? "已连接" : dataState === "loading" ? "连接中" : dataState === "error" ? "连接失败" : "演示";
  const connectionPill = (
    <div className={styles.connectionPill} title={dataMessage} aria-label={dataMessage}>
      <span className={`${styles.connectionDot} ${styles[`connectionDot_${dataState}`]}`} aria-hidden="true" />
      <span>{connectionLabel}</span>
    </div>
  );

  function addLocalMessage(message: MobileMessage) {
    setLocalMessages((current) => [message, ...current.filter((item) => item.id !== message.id)].slice(0, 10));
  }

  function openBackendPage(page: MobileBackendPage) {
    setActiveBackendPage(page);
    setMainTab("backend");
  }
  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function stopSpeechRecognition() {
    try {
      speechRecognitionRef.current?.stop();
      speechRecognitionRef.current?.abort?.();
    } catch {
      // Browser speech-recognition implementations can throw after auto-stop.
    }
    speechRecognitionRef.current = null;
  }

  function pcmSamplesToBuffer(samples: number[]) {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);
    samples.forEach((sample, index) => {
      const clamped = Math.max(-32768, Math.min(32767, sample));
      view.setInt16(index * 2, clamped, true);
    });
    return buffer;
  }

  function downsampleTo16BitPcm(input: Float32Array, inputSampleRate: number) {
    if (inputSampleRate === TENCENT_REALTIME_SAMPLE_RATE) {
      return Array.from(input, (sample) => Math.max(-1, Math.min(1, sample)) * 0x7fff);
    }

    const ratio = inputSampleRate / TENCENT_REALTIME_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const output: number[] = [];
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.min(Math.floor((outputIndex + 1) * ratio), input.length);
      let sum = 0;
      let count = 0;
      for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
        sum += input[inputIndex] ?? 0;
        count += 1;
      }
      const sample = Math.max(-1, Math.min(1, count ? sum / count : 0));
      output.push(sample * 0x7fff);
    }
    return output;
  }

  function refreshTencentRealtimeTranscript() {
    const next = [...realtimeSegmentMapRef.current.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, line]) => line)
      .filter((line) => Boolean(line.text.trim()))
      .slice(-24);
    liveTranscriptRef.current = next;
    setLiveTranscriptLines(next);
  }

  function handleTencentRealtimeMessage(payload: TencentRealtimeAsrMessage) {
    if (payload.code && payload.code !== 0) {
      setRecordingMessage(`实时转写暂不可用：${payload.message || payload.code}。结束后会上传音频生成云端转写。`);
      stopTencentRealtimeAsr(false);
      return;
    }

    const result = payload.result;
    const text = result?.voice_text_str?.replace(/\s+/g, " ").trim();
    if (result && text) {
      const index = typeof result.index === "number" ? result.index : realtimeSegmentMapRef.current.size;
      realtimeSegmentMapRef.current.set(index, {
        time: formatTranscriptTimeFromMs(result.start_time),
        speaker: `发言人${Math.min((index % 3) + 1, 3)}`,
        text
      });
      refreshTencentRealtimeTranscript();
    }

    if (payload.final === 1) {
      realtimeSocketRef.current = null;
    }
  }

  function sendTencentRealtimePacket(sampleCount = TENCENT_REALTIME_PACKET_SAMPLES) {
    const socket = realtimeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const queue = realtimePcmSamplesRef.current;
    if (queue.length < sampleCount) return false;
    const samples = queue.splice(0, sampleCount);
    socket.send(pcmSamplesToBuffer(samples));
    return true;
  }

  function startTencentAudioStreaming(stream: MediaStream, socket: WebSocket) {
    if (realtimeAudioContextRef.current) return;
    const AudioContextConstructor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("current browser does not support Web Audio");

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    realtimeAudioContextRef.current = audioContext;
    realtimeSourceRef.current = source;
    realtimeProcessorRef.current = processor;
    realtimePcmSamplesRef.current = [];

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      realtimePcmSamplesRef.current.push(...downsampleTo16BitPcm(input, audioContext.sampleRate));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    realtimeSendTimerRef.current = window.setInterval(() => {
      sendTencentRealtimePacket();
    }, 200);
    setRecordingMessage("正在录音并使用腾讯云实时转写。");
    if (audioContext.state === "suspended") void audioContext.resume();
  }

  function stopTencentRealtimeAsr(sendEnd = true) {
    if (realtimeSendTimerRef.current) {
      window.clearInterval(realtimeSendTimerRef.current);
      realtimeSendTimerRef.current = undefined;
    }

    try {
      realtimeProcessorRef.current?.disconnect();
      realtimeSourceRef.current?.disconnect();
    } catch {
      // Audio nodes may already be disconnected by the browser.
    }
    realtimeProcessorRef.current = null;
    realtimeSourceRef.current = null;
    const audioContext = realtimeAudioContextRef.current;
    realtimeAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();

    const socket = realtimeSocketRef.current;
    realtimeSocketRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const remaining = realtimePcmSamplesRef.current.splice(0);
      if (remaining.length > 0) socket.send(pcmSamplesToBuffer(remaining));
      if (sendEnd) {
        socket.send(JSON.stringify({ type: "end" }));
        window.setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
        }, 500);
      } else {
        socket.close();
      }
    }
    realtimePcmSamplesRef.current = [];
  }

  async function startTencentRealtimeAsr(stream: MediaStream) {
    if (typeof WebSocket === "undefined") return false;
    const AudioContextConstructor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
    if (!AudioContextConstructor) return false;

    try {
      const session = await fetchTencentRealtimeAsrUrl();
      const socket = new WebSocket(session.url);
      let audioStarted = false;
      realtimeSocketRef.current = socket;
      realtimeSegmentMapRef.current = new Map();
      setRecordingMessage("正在连接腾讯云实时转写...");

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let payload: TencentRealtimeAsrMessage;
        try {
          payload = JSON.parse(event.data) as TencentRealtimeAsrMessage;
        } catch {
          return;
        }
        if (!audioStarted && payload.code === 0 && !payload.result) {
          audioStarted = true;
          startTencentAudioStreaming(stream, socket);
          return;
        }
        handleTencentRealtimeMessage(payload);
      };
      socket.onerror = () => {
        setRecordingMessage("实时转写连接异常，结束后会上传音频生成云端转写。");
      };
      socket.onclose = () => {
        realtimeSocketRef.current = null;
      };
      return true;
    } catch {
      setRecordingMessage("腾讯云实时转写未启用，正在尝试浏览器实时转写。");
      return false;
    }
  }

  function appendLiveTranscript(text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const next = [
      ...liveTranscriptRef.current,
      {
        time: formatTranscriptTimeFromMs(elapsedMsSince(recordingStartedAtRef.current)),
        speaker: `发言人${Math.min((liveTranscriptRef.current.length % 3) + 1, 3)}`,
        text: normalized
      }
    ].slice(-24);
    liveTranscriptRef.current = next;
    setLiveTranscriptLines(next);
  }

  function startBrowserSpeechRecognition() {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setRecordingMessage("正在录音；当前浏览器未提供实时转写，结束后上传音频。");
      return;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result?.isFinal) appendLiveTranscript(result[0]?.transcript ?? "");
        }
      };
      recognition.onerror = () => {
        setRecordingMessage("正在录音；实时转写暂不可用，结束后上传音频。");
      };
      recognition.start();
      speechRecognitionRef.current = recognition;
      setRecordingMessage("正在录音并尝试实时转写。");
    } catch {
      setRecordingMessage("正在录音；实时转写启动失败，结束后上传音频。");
    }
  }

  async function startRecording() {
    if (!currentUser) {
      setActionMessage("请先在“我的”里切换到真实账号，再开始录音。");
      setMainTab("me");
      return;
    }
    if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setActionMessage("当前公网是 HTTP，浏览器不会开放麦克风权限；需要 HTTPS 或本地预览环境才能真实录音。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setActionMessage("当前浏览器不支持 MediaRecorder，无法进行真实录音。");
      return;
    }

    setRecordingSeconds(0);
    setSelectedMeetingId(undefined);
    setGeneratedDraft(undefined);
    setSubmittedGeneratedMeetingId(undefined);
    setGenerationMessage("");
    setConfirmMessage("");
    setTranscriptionStatusMessage("");
    setActionMessage("");
    setRecordingStatus("requesting");
    setRecordingMessage("正在请求麦克风权限...");
    setUploadWaitSeconds(0);
    setLiveTranscriptLines([]);
    liveTranscriptRef.current = [];
    realtimeSegmentMapRef.current = new Map();
    audioChunksRef.current = [];
    recordingStoppedSecondsRef.current = undefined;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = new Date().toISOString();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void uploadRecordedAudio();
      };
      recorder.start(1000);
      setRecordingStatus("recording");
      setRecordState("recording");
      setMainTab("record");
      const tencentRealtimeStarted = await startTencentRealtimeAsr(stream);
      if (!tencentRealtimeStarted) startBrowserSpeechRecognition();
    } catch (error) {
      stopMediaStream();
      setRecordState("idle");
      setRecordingStatus("error");
      setRecordingMessage("");
      setActionMessage(error instanceof Error ? `麦克风授权失败：${error.message}` : "麦克风授权失败。");
    }
  }

  async function uploadRecordedAudio() {
    stopTencentRealtimeAsr();
    stopSpeechRecognition();
    const recorder = mediaRecorderRef.current;
    const mimeType = recorder?.mimeType || "audio/webm";
    const blob = new Blob(audioChunksRef.current, { type: mimeType });
    stopMediaStream();

    try {
      if (!blob.size) throw new Error("录音数据为空");
      const startedAt = recordingStartedAtRef.current;
      const durationSeconds = recordingStoppedSecondsRef.current ?? (startedAt ? Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)) : recordingSeconds);
      const liveTranscript = liveTranscriptText(liveTranscriptRef.current);
      const title = `手机录音 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      const pendingId = `pending-recording-${Date.now()}`;
      setPendingRecordingUpload({
        id: pendingId,
        title,
        startedAt,
        durationSeconds,
        createdAt: new Date().toISOString()
      });
      setUploadWaitSeconds(0);
      setTranscriptionStatusMessage("");
      setActionMessage("录音已结束，正在后台上传和云端精修。你可以先离开此页，完成后会在消息里提醒。");
      setRecordingMessage("");
      setRecordState("idle");
      setMainTab("record");
      const meeting = await uploadMobileRecording({
        audioBlob: blob,
        durationSeconds,
        startedAt,
        transcript: liveTranscript,
        title,
        participantIds: normalizeParticipantIds(currentUser, SHOW_PARTICIPANT_SELECTION ? selectedParticipantIds : [])
      });
      setPendingRecordingUpload(undefined);
      setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
      setSelectedMeetingId(meeting.id);
      setDetailTab("transcript");
      setRecordState("idle");
      setMainTab("record");
      setUploadWaitSeconds(0);
      setTranscriptionStatusMessage(meeting.recordingStatus === "transcribing" ? meeting.recordingStatusMessage || "录音已保存，云端精修中，完成后会自动更新。" : "云端精修转写已完成，已自动更新为最终妙记。");
      setActionMessage(meeting.recordingStatus === "transcribing" ? "录音已保存，云端精修中。你可以在最近妙记查看，完成后会在消息里提醒。" : "云端精修已完成，已生成最近妙记。");
      setRecordingMessage("");
      if (meeting.recordingStatus !== "transcribing") {
        addLocalMessage({
          id: `recording-ready-${meeting.id}`,
          title: "云端精修已完成",
          source: meeting.title,
          time: "刚刚",
          body: "录音已完成云端精修，可进入最近妙记查看转写并生成会议纪要。",
          actionLabel: "查看妙记",
          tone: "success",
          meetingId: meeting.id,
          sortTime: Date.now()
        });
      }
      void loadBackendState({ silent: true });
    } catch (error) {
      setPendingRecordingUpload(undefined);
      setRecordingStatus("error");
      const message = recordingUploadMessage(error);
      setRecordingMessage("");
      setTranscriptionStatusMessage("");
      setActionMessage(message);
      setRecordState("idle");
      setMainTab("record");
      void loadBackendState({ silent: true });
    } finally {
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      recordingStartedAtRef.current = undefined;
      recordingStoppedSecondsRef.current = undefined;
    }
  }

  function endRecording() {
    if (recordingStatus === "uploading" || recordingStatus === "requesting") return;
    const startedAt = recordingStartedAtRef.current;
    const stoppedSeconds = startedAt ? Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)) : Math.max(1, recordingSeconds);
    recordingStoppedSecondsRef.current = stoppedSeconds;
    setRecordingSeconds(stoppedSeconds);
    setRecordingStatus("uploading");
    setUploadWaitSeconds(0);
    setRecordingMessage("正在上传录音并等待云端转写...");
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    void uploadRecordedAudio();
  }

  function openDetail(meetingId?: string) {
    const existingDraft = meetingId ? generatedDraftsByMeetingId[meetingId] : undefined;
    setSelectedMeetingId(meetingId);
    setGeneratedDraft(existingDraft);
    setSubmittedGeneratedMeetingId(undefined);
    setGenerationMessage("");
    setConfirmMessage("");
    setTranscriptionStatusMessage("");
    setDetailTab(existingDraft ? "summary" : "transcript");
    setRecordState(existingDraft ? "generated" : "detail");
    setMainTab("record");
    if (meetingId && !existingDraft) void restoreLatestGeneratedDraft(meetingId);
  }

  function persistGeneratedDraft(meetingId: string, draft: MobileGeneratedMinuteDraft) {
    setGeneratedDraftsByMeetingId((current) => {
      const next = { ...current, [meetingId]: draft };
      window.localStorage.setItem(GENERATED_DRAFTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function handleUpdateGeneratedDraft(nextDraft: MobileGeneratedMinuteDraft) {
    setGeneratedDraft(nextDraft);
    const meetingId = nextDraft.sourceMeetingId || selectedMeetingId || selectedMeeting?.id;
    if (!meetingId) return;
    persistGeneratedDraft(meetingId, nextDraft);
    setMeetings((current) =>
      current.map((meeting) =>
        meeting.id === meetingId
          ? {
              ...meeting,
              aiSummary: nextDraft.aiSummary || meeting.aiSummary,
              minuteMarkdown: nextDraft.minuteMarkdown || meeting.minuteMarkdown,
              decisions: nextDraft.decisions.length ? nextDraft.decisions : meeting.decisions,
              tasks: nextDraft.tasks.length ? nextDraft.tasks : meeting.tasks,
              status: nextDraft.aiSummary || nextDraft.minuteMarkdown ? "summarized" : meeting.status
            }
          : meeting
      )
    );
  }

  async function handleSaveSpeakerAssignments(meetingId: string, assignments: MeetingSpeakerAssignment[]) {
    const updatedMeeting = await saveMeetingSpeakerAssignments(meetingId, assignments);
    setMeetings((current) => current.map((meeting) => (meeting.id === updatedMeeting.id ? updatedMeeting : meeting)));
    setSelectedMeetingId(updatedMeeting.id);
  }

  function normalizeGeneratedDraftResult(result: Awaited<ReturnType<typeof fetchLatestMeetingDraft>>, meetingId?: string): MobileGeneratedMinuteDraft | undefined {
    if (!result) return undefined;
    return {
      aiSummary: typeof result.aiSummary === "string" ? result.aiSummary : "",
      minuteMarkdown: typeof result.minuteMarkdown === "string" ? result.minuteMarkdown : "",
      decisions: Array.isArray(result.decisions) ? result.decisions : [],
      tasks: Array.isArray(result.tasks) ? result.tasks : [],
      correctedTranscript: typeof result.correctedTranscript === "string" ? result.correctedTranscript : undefined,
      dictionaryCorrections: Array.isArray(result.dictionaryCorrections) ? result.dictionaryCorrections : [],
      sourceMeetingId: meetingId,
      generatedAt: new Date().toISOString()
    };
  }

  async function restoreLatestGeneratedDraft(meetingId: string) {
    try {
      const draft = normalizeGeneratedDraftResult(await fetchLatestMeetingDraft(meetingId), meetingId);
      if (!draft) return;
      persistGeneratedDraft(meetingId, draft);
      setGeneratedDraft(draft);
      setRecordState("generated");
      setDetailTab("summary");
    } catch (error) {
      console.warn("mobile_latest_generated_draft_restore_failed", {
        meetingId,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  }

  function backToRecordHome() {
    setTranscriptionStatusMessage("");
    setRecordState("idle");
    setMainTab("record");
  }

  function hideMeetingFromMobileList(meetingId: string) {
    setHiddenMeetingIds((current) => {
      const next = [...new Set([...current, meetingId])];
      window.localStorage.setItem(HIDDEN_MOBILE_MINUTES_KEY, JSON.stringify(next));
      return next;
    });
    setMeetings((current) => current.filter((item) => item.id !== meetingId));
  }

  function handleDeleteMinute(meetingId: string) {
    setPendingDeleteMeetingId(meetingId);
  }

  async function confirmDeleteMinute() {
    const meetingId = pendingDeleteMeetingId;
    if (!meetingId) return;
    const meeting = meetings.find((item) => item.id === meetingId);
    const title = meeting?.title || "这条妙记";
    setIsDeletingMinute(true);
    try {
      await deleteMeeting(meetingId);
      hideMeetingFromMobileList(meetingId);
      if (selectedMeetingId === meetingId) {
        setSelectedMeetingId(undefined);
        setRecordState("idle");
      }
      setActionMessage("已删除该条妙记。");
      setPendingDeleteMeetingId(undefined);
      void loadBackendState({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败。";
      if (message.includes("404")) {
        hideMeetingFromMobileList(meetingId);
        setActionMessage(`已从本机最近妙记隐藏「${title}」。后端删除接口上线后可执行真实删除。`);
        setPendingDeleteMeetingId(undefined);
      } else {
        setActionMessage(`删除失败：${message}`);
      }
    } finally {
      setIsDeletingMinute(false);
    }
  }

  function openGeneratedMessages() {
    setRecordState("idle");
    setMainTab("messages");
  }

  function openGeneratedTasks() {
    setRecordState("idle");
    setTaskTab("approval");
    setMainTab("tasks");
  }

  useEffect(() => {
    if (!selectedMeetingId || selectedMeeting?.recordingStatus !== "transcribing") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await fetchMobileRecordingStatus(selectedMeetingId);
        if (cancelled) return;
        if (status.meeting) {
          setMeetings((current) => [status.meeting!, ...current.filter((item) => item.id !== status.meeting!.id)]);
          if (status.recordingStatus === "transcribed") {
            setTranscriptionStatusMessage(status.message || "云端精修转写已完成，已自动更新为最终妙记。");
            setActionMessage("云端精修已完成，已更新到最近妙记。");
            addLocalMessage({
              id: `recording-ready-${status.meeting.id}`,
              title: "云端精修已完成",
              source: status.meeting.title,
              time: "刚刚",
              body: "录音已完成云端精修，可进入最近妙记查看转写并生成会议纪要。",
              actionLabel: "查看妙记",
              tone: "success",
              meetingId: status.meeting.id,
              sortTime: Date.now()
            });
          } else if (status.recordingStatus === "failed") {
            const failedMessage = status.message && isTransientRecordingNetworkError(status.message) ? recordingUploadMessage(status.message) : status.message ? `云端精修暂未完成：${status.message}` : "云端精修暂未完成，已保留当前转写。";
            setTranscriptionStatusMessage(failedMessage);
            setActionMessage(failedMessage);
          } else {
            setTranscriptionStatusMessage(status.message || "云端精修中，完成后会自动更新转写。");
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = isTransientRecordingNetworkError(error) ? "云端精修状态暂未刷新，可稍后在最近妙记查看。" : error instanceof Error ? `录音状态暂未刷新：${error.message}` : "录音状态暂未刷新。";
          setTranscriptionStatusMessage(message);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedMeeting?.recordingStatus, selectedMeetingId]);

  async function handleSaveCompletion(task: MobileTask, items: string[]) {
    await runTaskAction(task, "保存完成内容", () => (task.sourceKind === "okr" ? saveOkrTaskCompletion(task.id, items) : saveTaskCompletion(task.id, items)));
  }

  function mapMobileStatusToOkrStatus(status: MobileReviewTargetStatus) {
    if (status === "completed") return "已完成";
    if (status === "blocked") return "阻塞中";
    return "进行中";
  }

  async function handleSubmitReview(task: MobileTask, status: MobileReviewTargetStatus = "completed") {
    const items = task.completionItems?.map((item) => item.trim()).filter(Boolean) ?? [];
    if (items.length === 0) {
      setFocusedTaskId(task.id);
      setActionMessage("请先填写完成内容，再提交复核。");
      return;
    }
    await runTaskAction(task, "提交复核", () => (task.sourceKind === "okr" ? submitOkrTaskReview(task.id, mapMobileStatusToOkrStatus(status)) : submitTaskReview(task.id, status)));
  }

  async function handleConfirmReview(task: MobileTask) {
    await runTaskAction(task, "复核通过", () => (task.sourceKind === "okr" ? confirmOkrTaskReview(task.id) : confirmTaskReview(task.id)));
  }

  async function handleRejectReview(task: MobileTask, reasonItems: string[]) {
    await runTaskAction(task, "复核驳回", () => (task.sourceKind === "okr" ? rejectOkrTaskReview(task.id, reasonItems) : rejectTaskReview(task.id, reasonItems)));
  }

  async function handleChangeOkrEndDate(task: MobileTask, endDate: string, reason: string) {
    await runTaskAction(task, "调整 OKR 结束时间", () => changeOkrTaskEndDate(task.id, endDate, reason));
  }

  async function handleApproveTask(task: MobileTask) {
    const confirmed = await requestMobileConfirm({
      title: "确认签批通过待办？",
      message: "通过后会进入正式会议闭环台账。",
      confirmText: "签批通过"
    });
    if (!confirmed) return;
    await runTaskAction(task, "签批通过", () => approveTask(task.id));
  }

  async function handleApproveAllApprovalTasks(tasksToApprove: MobileTask[]) {
    const taskIds = tasksToApprove.map((task) => task.id).filter(Boolean);
    if (!taskIds.length) return;
    const confirmed = await requestMobileConfirm({
      title: "确认全部签批通过？",
      message: `确认通过全部 ${taskIds.length} 条待签批？通过后会进入正式会议闭环台账。`,
      confirmText: "全部通过"
    });
    if (!confirmed) return;
    setBusyTaskId("batch-approval");
    setActionMessage(`正在通过 ${taskIds.length} 条待签批...`);
    try {
      const result = await approveTasksBatch(taskIds);
      await loadBackendState({ silent: true });
      const failedCount = result.failed?.length ?? 0;
      setFocusedTaskId(undefined);
      setActionMessage(failedCount ? `已通过 ${result.approvedCount ?? 0} 条，${failedCount} 条未通过。` : `已通过 ${result.approvedCount ?? taskIds.length} 条待签批。`);
    } catch (error) {
      setActionMessage(error instanceof Error ? `一键通过失败：${error.message}` : "一键通过失败。");
    } finally {
      setBusyTaskId(undefined);
    }
  }

  async function handleRejectApproval(task: MobileTask, reason: string) {
    await runTaskAction(task, "签批驳回", () => rejectTaskApproval(task.id, reason));
  }

  async function handleCompleteSupport(task: MobileTask) {
    await runTaskAction(task, "公司支持完成", () => completeCompanySupport(task.id));
  }

  async function handleMarkMessageRead(messageId: string) {
    const nextReadIds = [...new Set([...notificationReadIds, messageId])];
    setNotificationReadIds(nextReadIds);
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, isRead: true } : message)));
    try {
      const saved = await saveNotificationReadIds(nextReadIds);
      setNotificationReadIds(saved);
      setActionMessage("");
    } catch (error) {
      setActionMessage(error instanceof Error ? `消息已读状态保存失败：${error.message}` : "消息已读状态保存失败。");
    }
  }

  async function handleMarkAllMessagesRead() {
    const nextReadIds = [...new Set([...notificationReadIds, ...messages.map((message) => message.id)])];
    setNotificationReadIds(nextReadIds);
    setMessages((current) => current.map((message) => ({ ...message, isRead: true })));
    try {
      const saved = await saveNotificationReadIds(nextReadIds);
      setNotificationReadIds(saved);
      setActionMessage("");
    } catch (error) {
      setActionMessage(error instanceof Error ? `全部已读保存失败：${error.message}` : "全部已读保存失败。");
    }
  }

  async function handleAccountLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = loginUsername.trim();
    if (!username || !loginPassword) {
      setLoginMessage("请输入账号和密码。");
      return;
    }
    setLoginMessage("正在登录...");
    try {
      const user = await loginWithAccount(username, loginPassword);
      setCurrentUser(user);
      setLoginPassword("");
      setLoginMessage("");
      setFocusedTaskId(undefined);
      setTaskTab("mine");
      await loadBackendState({ silent: true });
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "账号或密码不正确。");
    }
  }

  async function handleLogoutAccount() {
    await logoutAccount();
    setCurrentUser(undefined);
    setMeetings([]);
    setMeetingBoard(undefined);
    setOkrProjects([]);
    setDictionaryEntries([]);
    setMessages([]);
    setTasks([]);
    setNotificationReadIds([]);
    setDataState("error");
    setDataMessage("当前未登录，请使用账号密码登录。");
    setMainTab("record");
    setActionMessage("");
  }

  async function handleRefreshDictionary() {
    const nextEntries = await fetchMeetingDictionary();
    setDictionaryEntries(nextEntries);
    setActionMessage("会议词典已刷新。");
  }

  async function handleCreateDictionaryEntry(input: { standard: string; variants: string; category: string; note: string }) {
    const entry = await createMeetingDictionaryEntry(input);
    setDictionaryEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
    setActionMessage("词条已保存，后续 AI 生成会议纪要前会参与纠错。");
  }

  async function handleCreateOkrProject(project: OkrProject) {
    const savedProject = await createOkrProject(project);
    setOkrProjects((current) => [savedProject, ...current.filter((item) => item.id !== savedProject.id)]);
    await loadBackendState({ silent: true });
    setActionMessage("OKR 项目已新建。");
  }

  async function handleCreateManualMeeting(meeting: Meeting) {
    const savedMeeting = await submitMeetingApproval(meeting);
    setMeetings((current) => [savedMeeting, ...current.filter((item) => item.id !== savedMeeting.id)]);
    setSelectedMeetingId(savedMeeting.id);
    await loadBackendState({ silent: true });
    setActionMessage("会议已提交总裁签批。");
    return savedMeeting;
  }

  async function handleDeleteDictionaryEntry(entryId: string) {
    await deleteMeetingDictionaryEntry(entryId);
    setDictionaryEntries((current) => current.filter((entry) => entry.id !== entryId));
    setActionMessage("词条已删除。");
  }

  function handleOpenMessageTask(message: MobileMessage) {
    if (message.taskId) {
      setFocusedTaskId(message.taskId);
      const target = tasks.find((task) => task.id === message.taskId);
      setTaskTab(target?.tab ?? "mine");
      setMainTab("tasks");
      void handleMarkMessageRead(message.id);
      return;
    }
    void handleMarkMessageRead(message.id);
  }

  async function handleGenerateMeetingDraft() {
    if (!currentUser) {
      setRecordState("generated");
      setDetailTab("summary");
      setGenerationMessage("当前未读取到登录用户，已完成演示生成；登录后将调用后端 AI 生成接口。");
      return;
    }

    setIsGeneratingDraft(true);
    setDetailTab("summary");
    setGenerationMessage("正在调用后端 AI 会议纪要接口...");
    setConfirmMessage("");
    setSubmittedGeneratedMeetingId(undefined);

    try {
      const speakerAssignments = buildDraftSpeakerAssignments(selectedMeeting, userDirectory);
      const transcript = buildTranscriptForDraft(selectedMeeting, userDirectory);
      const wordCount = countTranscriptWords(transcript);
      if (!transcript || wordCount < 200) {
        throw new Error(transcript ? "当前转写内容过短，不能生成正式会议纪要。" : "暂无真实转写内容，不能生成正式会议纪要。");
      }
      const participantNames = (selectedMeeting?.participantIds ?? [])
        .map((userId) => userDirectory.find((user) => user.id === userId)?.name ?? fallbackUsers.find((user) => user.id === userId)?.name)
        .filter((name): name is string => Boolean(name));
      const draftTitle = selectedMeeting?.title || "产品周会 / 移动端闭环";
      const result = await generateMeetingDraft(
        {
          meetingId: selectedMeeting?.id || `mobile-minutes-${Date.now()}`,
          title: draftTitle,
          departmentId: selectedMeeting?.departmentId || currentUser.departmentId,
          hostId: selectedMeeting?.hostId || currentUser.id,
          transcript,
          meetingDate: (selectedMeeting?.startTime || new Date().toISOString()).slice(0, 10),
          meetingType: selectedMeeting?.type || "AI项目会议",
          participantNames,
          participantCount: selectedMeeting?.participantCount ?? selectedMeeting?.participantIds?.length,
          speakerAssignments,
          okrProjectName: selectedMeeting?.okrProjectName,
          startTime: selectedMeeting?.startTime
        },
        { onStatus: setGenerationMessage }
      );

      const draftTasks = Array.isArray(result.tasks) ? (result.tasks as Task[]) : [];
      const nextDraft: MobileGeneratedMinuteDraft = {
        aiSummary: typeof result.aiSummary === "string" ? result.aiSummary : "",
        minuteMarkdown: typeof result.minuteMarkdown === "string" ? result.minuteMarkdown : "",
        decisions: Array.isArray(result.decisions) ? result.decisions : [],
        tasks: draftTasks,
        correctedTranscript: typeof result.correctedTranscript === "string" ? result.correctedTranscript : undefined,
        dictionaryCorrections: Array.isArray(result.dictionaryCorrections) ? result.dictionaryCorrections : [],
        sourceMeetingId: selectedMeeting?.id,
        generatedAt: new Date().toISOString()
      };
      setGeneratedDraft(nextDraft);
      if (selectedMeeting?.id) {
        persistGeneratedDraft(selectedMeeting.id, nextDraft);
        setMeetings((current) =>
          current.map((meeting) =>
            meeting.id === selectedMeeting.id
              ? {
                  ...meeting,
                  aiSummary: nextDraft.aiSummary || meeting.aiSummary,
                  minuteMarkdown: nextDraft.minuteMarkdown || meeting.minuteMarkdown,
                  decisions: nextDraft.decisions.length ? nextDraft.decisions : meeting.decisions,
                  tasks: nextDraft.tasks.length ? nextDraft.tasks : meeting.tasks,
                  status: nextDraft.aiSummary || nextDraft.minuteMarkdown ? "summarized" : meeting.status
                }
              : meeting
          )
        );
      }
      setMessages([
        {
          id: `mobile-generated-${Date.now()}`,
          title: "会议纪要已生成",
          source: draftTitle,
          time: "刚刚",
          body: `后端 AI 已生成纪要${draftTasks.length ? `，提取 ${draftTasks.length} 个待办` : ""}。`,
          actionLabel: "查看纪要",
          tone: "success"
        },
        ...messages
      ]);
      setRecordState("generated");
      setDetailTab("summary");
      setGenerationMessage("后端 AI 已完成会议纪要生成。");
    } catch (error) {
      setGenerationMessage(error instanceof Error ? `未生成正式会议纪要：${error.message}` : "未生成正式会议纪要：未知错误");
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  async function handleConfirmGeneratedMeeting() {
    if (!currentUser) {
      setConfirmMessage("当前未读取到登录用户，不能提交签批。");
      return;
    }
    if (!generatedDraft) {
      setConfirmMessage("请先生成会议纪要草稿，再确认提交。");
      return;
    }
    if (!generatedDraft.tasks.length) {
      setConfirmMessage("本次未生成待办，不能提交签批。请补充可执行待办后再提交。");
      return;
    }

    setIsConfirmingGeneratedMeeting(true);
    setConfirmMessage("正在提交会议签批...");
    try {
      const meeting = buildMobileSubmittedMeeting({ selectedMeeting, generatedDraft, currentUser });
      const submittedMeeting = await submitMeetingApproval(meeting);
      setSubmittedGeneratedMeetingId(submittedMeeting.id);
      setSelectedMeetingId(submittedMeeting.id);
      await loadBackendState({ silent: true });
      setConfirmMessage(`已提交总裁签批，包含 ${submittedMeeting.tasks?.length ?? generatedDraft.tasks.length} 个待办。`);
      setGenerationMessage("会议纪要已确认并进入后端签批流程。");
    } catch (error) {
      setConfirmMessage(error instanceof Error ? `提交签批失败：${error.message}` : "提交签批失败。");
    } finally {
      setIsConfirmingGeneratedMeeting(false);
    }
  }

  let screen = null;
  if (!currentUser && dataState === "loading") {
    screen = (
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>AI 会议闭环</h1>
        </header>
        <section className={`${styles.card} ${styles.profileCard}`}>
          <p className={styles.formMessage}>{dataMessage}</p>
        </section>
      </div>
    );
  } else if (!currentUser) {
    screen = (
      <MobileLoginPage
        username={loginUsername}
        password={loginPassword}
        message={loginMessage || dataMessage}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleAccountLogin}
      />
    );
  } else if (recordState === "recording") {
    screen = (
      <RecordingPanel
        elapsedTime={elapsedTime}
        message={recordingMessage}
        onEndRecording={endRecording}
        status={recordingStatus}
        transcriptLines={liveTranscriptLines}
        uploadElapsedTime={recordingStatus === "uploading" ? uploadElapsedTime : ""}
      />
    );
  } else if (inDetail) {
    screen = (
      <MinuteDetail
        state={recordState}
        detailTab={detailTab}
        meeting={selectedMeeting}
        onBack={backToRecordHome}
        onGenerate={handleGenerateMeetingDraft}
        onConfirmGeneratedMeeting={handleConfirmGeneratedMeeting}
        onOpenMessages={openGeneratedMessages}
        onOpenTasks={openGeneratedTasks}
        onTabChange={setDetailTab}
        onUpdateGeneratedDraft={handleUpdateGeneratedDraft}
        onSaveSpeakerAssignments={handleSaveSpeakerAssignments}
        isGenerating={isGeneratingDraft}
        isConfirmingGeneratedMeeting={isConfirmingGeneratedMeeting}
        generationMessage={generationMessage}
        confirmMessage={confirmMessage}
        transcriptionStatusMessage={detailTranscriptionStatusMessage}
        generatedDraft={generatedDraft}
        submittedGeneratedMeetingId={submittedGeneratedMeetingId}
        userDirectory={userDirectory}
      />
    );
  } else if (mainTab === "record") {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <RecordHome
          connectionStatus={connectionPill}
          onStartRecording={startRecording}
          onOpenDetail={openDetail}
          onOpenManagement={() => openBackendPage("management-dashboard")}
          onOpenParticipants={SHOW_PARTICIPANT_SELECTION ? () => setIsParticipantPickerOpen(true) : undefined}
          onOpenBackendEntry={openBackendPage}
          onDeleteMinute={handleDeleteMinute}
          recentMinutes={recentMinutes}
          metrics={homeMetrics}
          managementMetrics={managementMetrics}
          backendEntries={backendEntries}
          participantNames={SHOW_PARTICIPANT_SELECTION ? selectedParticipantNames : undefined}
        />
      </>
    );
  } else if (mainTab === "messages") {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <MobileMessages messages={messages} onMarkRead={handleMarkMessageRead} onMarkAllRead={handleMarkAllMessagesRead} onOpenTask={handleOpenMessageTask} />
      </>
    );
  } else if (mainTab === "tasks") {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <MobileTasks
          activeTab={taskTab}
          busyTaskId={busyTaskId}
          focusedTaskId={focusedTaskId}
          onChangeOkrEndDate={handleChangeOkrEndDate}
          onApproveAllTasks={handleApproveAllApprovalTasks}
          onApproveTask={handleApproveTask}
          onCompleteSupport={handleCompleteSupport}
          onConfirmReview={handleConfirmReview}
          onRejectApproval={handleRejectApproval}
          onRejectReview={handleRejectReview}
          onSaveCompletion={handleSaveCompletion}
          onSubmitReview={handleSubmitReview}
          onTabChange={(tab) => {
            setTaskTab(tab);
            setFocusedTaskId(undefined);
          }}
          tasks={tasks}
        />
      </>
    );
  } else if (mainTab === "management" && managementMetrics) {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <MobileManagementBoard metrics={managementMetrics} attentionMeetings={managementAttentionMeetings} onOpenMeeting={openDetail} />
      </>
    );
  } else if (mainTab === "backend") {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <MobileBackendPanel
          activePage={activeBackendPage}
          entries={backendEntries}
          meetings={visibleMeetings}
          tasks={tasks}
          departments={departmentDirectory}
          meetingBoard={meetingBoard}
          managementMetrics={managementMetrics}
          attentionMeetings={managementAttentionMeetings}
          okrProjects={isManagerUser(currentUser) ? okrProjects : []}
          dictionaryEntries={dictionaryEntries}
          currentUser={currentUser}
          userDirectory={userDirectory}
          onBack={() => setMainTab("record")}
          onChangePage={openBackendPage}
          onCreateDictionaryEntry={handleCreateDictionaryEntry}
          onCreateMeeting={handleCreateManualMeeting}
          onCreateOkrProject={handleCreateOkrProject}
          onDeleteDictionaryEntry={handleDeleteDictionaryEntry}
          onOpenMeeting={openDetail}
          onOpenOkrTasks={() => {
            setTaskTab("mine");
            setFocusedTaskId(undefined);
            setMainTab("tasks");
          }}
          onOpenTask={(taskId) => {
            const target = tasks.find((task) => task.id === taskId);
            setFocusedTaskId(taskId);
            setTaskTab(target?.tab ?? "mine");
            setMainTab("tasks");
          }}
          onRefreshDictionary={handleRefreshDictionary}
        />
      </>
    );
  } else {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <ProfilePage
          user={currentUser}
          departmentDirectory={departmentDirectory}
          onLogout={handleLogoutAccount}
        />
      </>
    );
  }

  const pendingDeleteMeeting = pendingDeleteMeetingId ? meetings.find((item) => item.id === pendingDeleteMeetingId) : undefined;
  const showBottomNav = Boolean(currentUser && !inDetail && recordState !== "recording");

  return (
    <MobileShell>
      <div className={`${styles.screen} ${showBottomNav ? styles.screenWithNav : ""}`}>{screen}</div>
      {showBottomNav ? <BottomNav activeTab={mainTab} onChange={setMainTab} unreadMessageCount={unreadMessageCount} /> : null}
      {SHOW_PARTICIPANT_SELECTION && isParticipantPickerOpen ? (
        <ParticipantPickerSheet
          currentUserId={currentUser?.id}
          departments={departmentDirectory}
          selectedIds={normalizeParticipantIds(currentUser, selectedParticipantIds)}
          users={userDirectory}
          onClose={() => setIsParticipantPickerOpen(false)}
          onConfirm={(participantIds) => {
            setSelectedParticipantIds(normalizeParticipantIds(currentUser, participantIds));
            setIsParticipantPickerOpen(false);
          }}
        />
      ) : null}
      {mobileConfirmDialog ? (
        <div className={styles.mobileDialogOverlay} role="dialog" aria-modal="true" aria-labelledby="mobile-confirm-title">
          <div className={styles.mobileDialog}>
            <h2 className={styles.dialogTitle} id="mobile-confirm-title">{mobileConfirmDialog.title}</h2>
            <p className={styles.dialogBody}>{mobileConfirmDialog.message}</p>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => closeMobileConfirm(false)}>
                {mobileConfirmDialog.cancelText ?? "取消"}
              </button>
              <button className={styles.successAction} type="button" onClick={() => closeMobileConfirm(true)}>
                {mobileConfirmDialog.confirmText ?? "确认"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingDeleteMeetingId ? (
        <div className={styles.mobileDialogOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-minute-title">
          <div className={styles.mobileDialog}>
            <h2 className={styles.dialogTitle} id="delete-minute-title">删除妙记</h2>
            <p className={styles.dialogBody}>
              确认删除「{pendingDeleteMeeting?.title || "这条妙记"}」吗？删除后不会出现在最近妙记中。
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setPendingDeleteMeetingId(undefined)} disabled={isDeletingMinute}>
                取消
              </button>
              <button className={styles.dangerButton} type="button" onClick={confirmDeleteMinute} disabled={isDeletingMinute}>
                {isDeletingMinute ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </MobileShell>
  );
}
