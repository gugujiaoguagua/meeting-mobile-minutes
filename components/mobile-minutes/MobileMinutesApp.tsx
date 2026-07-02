"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, User } from "lucide-react";
import { BottomNav } from "./BottomNav";
import { MinuteDetail } from "./MinuteDetail";
import { MobileMessages } from "./MobileMessages";
import { MobileShell } from "./MobileShell";
import { MobileTasks } from "./MobileTasks";
import { RecordingPanel } from "./RecordingPanel";
import { RecordHome } from "./RecordHome";
import {
  approveTask,
  completeCompanySupport,
  confirmTaskReview,
  confirmOkrTaskReview,
  DEFAULT_MOBILE_USER_ID,
  fetchCurrentUser,
  fetchMeetingState,
  fetchOkrProjects,
  fetchTencentRealtimeAsrUrl,
  fetchWecomMessages,
  generateMeetingDraft,
  loginAsUser,
  rejectTaskApproval,
  rejectOkrTaskReview,
  rejectTaskReview,
  saveNotificationReadIds,
  saveOkrTaskCompletion,
  saveTaskCompletion,
  submitOkrTaskReview,
  submitMeetingApproval,
  submitTaskReview,
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
import type { DetailTab, MainTab, MobileGeneratedMinuteDraft, MobileMessage, MobileReviewTargetStatus, MobileTask, RecordState, TaskTab, TranscriptLine } from "./mobileMinutesTypes";
import { departments, userSearchText, users } from "@/lib/orgPeopleData";
import type { Meeting, Task, User as MeetingUser } from "@/lib/types";
import styles from "./MobileMinutes.module.css";

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

function elapsedMsSince(value?: string) {
  if (!value) return 0;
  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function userLoginLabel(user: MeetingUser) {
  return [user.name, user.title || user.role, user.employeeNo].filter(Boolean).join(" / ");
}

function userLoginMeta(user: MeetingUser) {
  const department = departments.find((item) => item.id === user.departmentId);
  return [department?.name, user.role, user.employeeNo].filter(Boolean).join(" · ");
}

function normalizeSearchValue(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function buildTranscriptForDraft(meeting?: Meeting) {
  const transcript = meeting?.transcript || meeting?.rawTranscript || "";
  return transcript.trim();
}

function countTranscriptWords(text: string) {
  const chinese = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const words = text.replace(/[\u4e00-\u9fa5]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return chinese + words;
}

function isSameLocalDate(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
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

type AudioContextWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

const TENCENT_REALTIME_SAMPLE_RATE = 16000;
const TENCENT_REALTIME_PACKET_SAMPLES = 3200;

function ProfilePage({
  user,
  isSwitchingUser,
  onLoginAsUser
}: {
  user?: MeetingUser;
  isSwitchingUser?: boolean;
  onLoginAsUser?: (userId: string) => void;
}) {
  const userOptions = useMemo(
    () =>
      users.map((item) => {
        const department = departments.find((departmentItem) => departmentItem.id === item.departmentId);
        return {
          id: item.id,
          label: userLoginLabel(item),
          name: item.name,
          role: item.role,
          title: item.title || item.role,
          employeeNo: item.employeeNo || "",
          meta: userLoginMeta(item),
          searchText: userSearchText(item, department)
        };
      }),
    []
  );
  const [loginQuery, setLoginQuery] = useState(user ? userLoginLabel(user) : "");
  const [isLoginMenuOpen, setIsLoginMenuOpen] = useState(false);
  const filteredUserOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(loginQuery);
    if (!normalizedQuery) return userOptions.slice(0, 12);
    return userOptions
      .map((item, index) => {
        const name = normalizeSearchValue(item.name);
        const label = normalizeSearchValue(item.label);
        const meta = normalizeSearchValue(item.meta);
        const employeeNo = normalizeSearchValue(item.employeeNo);
        const title = normalizeSearchValue(item.title);
        const searchText = normalizeSearchValue(item.searchText);
        let score = 999;
        if (name === normalizedQuery) score = 0;
        else if (employeeNo === normalizedQuery) score = 1;
        else if (name.startsWith(normalizedQuery) && item.role === "部门负责人") score = 10;
        else if (name.startsWith(normalizedQuery)) score = 20;
        else if (employeeNo.startsWith(normalizedQuery)) score = 30;
        else if (label.includes(normalizedQuery)) score = 40;
        else if (title.includes(normalizedQuery) && item.role === "部门负责人") score = 50;
        else if (`${meta} ${searchText}`.includes(normalizedQuery)) score = 80;
        return { item, score, index };
      })
      .filter((entry) => entry.score < 999)
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name, "zh-Hans-CN") || a.index - b.index)
      .slice(0, 12)
      .map((entry) => entry.item);
  }, [loginQuery, userOptions]);

  useEffect(() => {
    setLoginQuery(user ? userLoginLabel(user) : "");
  }, [user]);

  function handlePickUser(userId: string, label: string) {
    setLoginQuery(label);
    setIsLoginMenuOpen(false);
    if (userId !== user?.id) onLoginAsUser?.(userId);
  }

  function handleLoginKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filteredUserOptions[0]) {
      event.preventDefault();
      handlePickUser(filteredUserOptions[0].id, filteredUserOptions[0].label);
    }
    if (event.key === "Escape") {
      setLoginQuery(user ? userLoginLabel(user) : "");
      setIsLoginMenuOpen(false);
    }
  }

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
            <p className={styles.smallText}>{user ? `${user.role} / ${user.title}` : "会议记录与任务协同"}</p>
          </div>
        </div>
        <label className={styles.formLabel} htmlFor="mobile-user-login">切换登录账号</label>
        <div className={styles.profileLoginBox}>
          <div className={styles.profileLoginControl}>
            <input
              className={styles.profileInput}
              id="mobile-user-login"
              value={loginQuery}
              disabled={isSwitchingUser}
              onBlur={() =>
                window.setTimeout(() => {
                  setIsLoginMenuOpen(false);
                  setLoginQuery(user ? userLoginLabel(user) : "");
                }, 100)
              }
              onChange={(event) => {
                setLoginQuery(event.target.value);
                setIsLoginMenuOpen(true);
              }}
              onFocus={(event) => {
                if (user && event.currentTarget.value === userLoginLabel(user)) setLoginQuery("");
                event.currentTarget.select();
                setIsLoginMenuOpen(true);
              }}
              onKeyDown={handleLoginKeyDown}
              placeholder="输入姓名 / 岗位 / 工号"
              role="combobox"
              aria-controls="mobile-user-login-options"
              aria-expanded={isLoginMenuOpen}
            />
            <button
              className={styles.profileLoginToggle}
              type="button"
              disabled={isSwitchingUser}
              aria-label="展开账号列表"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (user && loginQuery === userLoginLabel(user)) setLoginQuery("");
                setIsLoginMenuOpen((current) => !current);
              }}
            >
              <ChevronDown aria-hidden="true" size={16} />
            </button>
          </div>
          {isLoginMenuOpen ? (
            <div className={styles.profileDropdown} id="mobile-user-login-options" role="listbox">
              {filteredUserOptions.length > 0 ? (
                filteredUserOptions.map((item) => (
                  <button
                    className={`${styles.profileOption} ${item.id === user?.id ? styles.profileOptionActive : ""}`}
                    type="button"
                    key={item.id}
                    role="option"
                    aria-selected={item.id === user?.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handlePickUser(item.id, item.label)}
                  >
                    <span className={styles.profileOptionName}>{item.name} / {item.label.replace(`${item.name} / `, "")}</span>
                    <span className={styles.profileOptionMeta}>{item.meta}</span>
                  </button>
                ))
              ) : (
                <div className={styles.profileEmptyOption}>没有匹配账号</div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function MobileMinutesApp() {
  const [mainTab, setMainTab] = useState<MainTab>("record");
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [detailTab, setDetailTab] = useState<DetailTab>("transcript");
  const [taskTab, setTaskTab] = useState<TaskTab>("mine");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [currentUser, setCurrentUser] = useState<MeetingUser | undefined>();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
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
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState<MobileGeneratedMinuteDraft | undefined>();
  const [isConfirmingGeneratedMeeting, setIsConfirmingGeneratedMeeting] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [submittedGeneratedMeetingId, setSubmittedGeneratedMeetingId] = useState<string | undefined>();
  const [recordingStatus, setRecordingStatus] = useState<"requesting" | "recording" | "uploading" | "error">("recording");
  const [recordingMessage, setRecordingMessage] = useState("");
  const [uploadWaitSeconds, setUploadWaitSeconds] = useState(0);
  const [liveTranscriptLines, setLiveTranscriptLines] = useState<TranscriptLine[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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

  useEffect(() => {
    if (recordState !== "recording" || recordingStatus !== "recording") return;
    const startedAt = Date.now() - recordingSeconds * 1000;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recordState, recordingSeconds, recordingStatus]);

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
        let user = await fetchCurrentUser();
        if (!user) {
          user = await loginAsUser(DEFAULT_MOBILE_USER_ID);
        }
        if (!user) {
          setCurrentUser(undefined);
          setMeetings([]);
          setMessages(sampleMessages);
          setTasks(sampleTasks);
          setNotificationReadIds([]);
          setDataState("demo");
          setDataMessage("当前未登录，手机端暂用演示数据；登录后将读取后端消息与待办。");
          return;
        }

        const [state, okrProjects, wecomMessages] = await Promise.all([fetchMeetingState(), fetchOkrProjects().catch(() => []), fetchWecomMessages().catch(() => [])]);

        setCurrentUser(user);
        setMeetings(state.meetings);
        setNotificationReadIds(state.notificationReadIds);
        const mappedMessages = mergeMobileMessages(
          [
            ...mapBackendNotificationsToMessages({
              meetings: state.meetings,
              tasks: state.tasks,
              activityLogs: state.activityLogs,
              readIds: state.notificationReadIds,
              currentUser: user
            }),
            ...wecomMessages
          ],
          state.notificationReadIds
        );
        const mappedTasks = [...mapTasksToMobileTasks(state.tasks, user, state.meetings), ...mapOkrProjectsToMobileTasks(okrProjects, user)];
        setMessages(mappedMessages);
        setTasks(mappedTasks);
        setDataState("live");
        setDataMessage(`当前账号：${user.name} / ${user.role}`);
      } catch (error) {
        setDataState("error");
        setDataMessage(error instanceof Error ? error.message : "后端数据读取失败，当前显示演示数据。");
      }
  }, []);

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
  const displayMeetings = useMemo(() => meetings.filter(isMobileDisplayMeeting), [meetings]);
  const recentMinutes = useMemo(() => mapMeetingsToMobileMinuteCards(meetings), [meetings]);
  const homeMetrics = useMemo(
    () => ({
      todayMeetings: displayMeetings.filter((meeting) => isSameLocalDate(meeting.startTime || meeting.createdAt)).length,
      pendingMinutes: recentMinutes.filter((item) => item.status === "待确认").length,
      activeTasks: tasks.filter((task) => task.tab !== "done").length
    }),
    [displayMeetings, recentMinutes, tasks]
  );
  const unreadMessageCount = useMemo(() => messages.filter((message) => !message.isRead).length, [messages]);
  const inDetail = recordState === "detail" || recordState === "generated";
  const connectionLabel = dataState === "live" ? "已连接" : dataState === "loading" ? "连接中" : dataState === "error" ? "连接失败" : "演示";
  const connectionPill = (
    <div className={styles.connectionPill} title={dataMessage} aria-label={dataMessage}>
      <span className={`${styles.connectionDot} ${styles[`connectionDot_${dataState}`]}`} aria-hidden="true" />
      <span>{connectionLabel}</span>
    </div>
  );
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
      const meeting = await uploadMobileRecording({
        audioBlob: blob,
        durationSeconds,
        startedAt,
        transcript: liveTranscriptRef.current.map((line) => line.text).join("\n"),
        title: `手机录音 ${new Date().toLocaleString("zh-CN", { hour12: false })}`
      });
      setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
      setSelectedMeetingId(meeting.id);
      setDetailTab("transcript");
      setRecordState("detail");
      setMainTab("record");
      setUploadWaitSeconds(0);
      setActionMessage("录音已上传，妙记已生成。");
      setRecordingMessage("");
      void loadBackendState({ silent: true });
    } catch (error) {
      setRecordingStatus("error");
      setRecordingMessage(error instanceof Error ? `录音上传失败：${error.message}` : "录音上传失败。");
      setActionMessage(error instanceof Error ? `录音上传失败：${error.message}` : "录音上传失败。");
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
    setSelectedMeetingId(meetingId);
    setGeneratedDraft(undefined);
    setSubmittedGeneratedMeetingId(undefined);
    setGenerationMessage("");
    setConfirmMessage("");
    setDetailTab("transcript");
    setRecordState("detail");
    setMainTab("record");
  }

  function backToRecordHome() {
    setRecordState("idle");
    setMainTab("record");
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

  async function handleApproveTask(task: MobileTask) {
    await runTaskAction(task, "签批通过", () => approveTask(task.id));
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

  async function handleLoginAsUser(userId: string) {
    if (!userId || userId === currentUser?.id) return;
    setIsSwitchingUser(true);
    setActionMessage("");
    try {
      const user = await loginAsUser(userId);
      setCurrentUser(user);
      setFocusedTaskId(undefined);
      setTaskTab("mine");
      await loadBackendState({ silent: true });
    } catch (error) {
      setActionMessage(error instanceof Error ? `登录切换失败：${error.message}` : "登录切换失败。");
    } finally {
      setIsSwitchingUser(false);
    }
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
      const transcript = buildTranscriptForDraft(selectedMeeting);
      const wordCount = countTranscriptWords(transcript);
      if (!transcript || wordCount < 200) {
        throw new Error(transcript ? "当前转写内容过短，不能生成正式会议纪要。" : "暂无真实转写内容，不能生成正式会议纪要。");
      }
      const participantNames = (selectedMeeting?.participantIds ?? [])
        .map((userId) => users.find((user) => user.id === userId)?.name)
        .filter((name): name is string => Boolean(name));
      const draftTitle = selectedMeeting?.title || "产品周会 / 移动端闭环";
      const result = await generateMeetingDraft({
        meetingId: selectedMeeting?.id || `mobile-minutes-${Date.now()}`,
        title: draftTitle,
        departmentId: selectedMeeting?.departmentId || currentUser.departmentId,
        hostId: selectedMeeting?.hostId || currentUser.id,
        transcript,
        meetingDate: (selectedMeeting?.startTime || new Date().toISOString()).slice(0, 10),
        meetingType: selectedMeeting?.type || "AI项目会议",
        participantNames,
        participantCount: selectedMeeting?.participantCount ?? selectedMeeting?.participantIds?.length,
        okrProjectName: selectedMeeting?.okrProjectName,
        startTime: selectedMeeting?.startTime
      });

      const draftTasks = Array.isArray(result.tasks) ? (result.tasks as Task[]) : [];
      setGeneratedDraft({
        aiSummary: typeof result.aiSummary === "string" ? result.aiSummary : "",
        minuteMarkdown: typeof result.minuteMarkdown === "string" ? result.minuteMarkdown : "",
        decisions: Array.isArray(result.decisions) ? result.decisions : [],
        tasks: draftTasks,
        correctedTranscript: typeof result.correctedTranscript === "string" ? result.correctedTranscript : undefined,
        dictionaryCorrections: Array.isArray(result.dictionaryCorrections) ? result.dictionaryCorrections : [],
        sourceMeetingId: selectedMeeting?.id,
        generatedAt: new Date().toISOString()
      });
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
  if (recordState === "recording") {
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
        isGenerating={isGeneratingDraft}
        isConfirmingGeneratedMeeting={isConfirmingGeneratedMeeting}
        generationMessage={generationMessage}
        confirmMessage={confirmMessage}
        generatedDraft={generatedDraft}
        submittedGeneratedMeetingId={submittedGeneratedMeetingId}
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
          recentMinutes={recentMinutes}
          metrics={homeMetrics}
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
  } else {
    screen = (
      <>
        {actionMessage ? <div className={styles.actionNotice}>{actionMessage}</div> : null}
        <ProfilePage user={currentUser} isSwitchingUser={isSwitchingUser} onLoginAsUser={handleLoginAsUser} />
      </>
    );
  }

  return (
    <MobileShell>
      <div className={styles.screen}>{screen}</div>
      {!inDetail && recordState !== "recording" ? <BottomNav activeTab={mainTab} onChange={setMainTab} unreadMessageCount={unreadMessageCount} /> : null}
    </MobileShell>
  );
}
