import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { MeetingDictionaryEntry } from "@/lib/meetingDictionary";
import type { OkrPdcaStage, OkrProject } from "@/lib/okrTypes";
import type { Department, Meeting, MeetingBoardResponse, MeetingBoardRow, MeetingBoardStatus, MeetingDecision, MeetingType, Priority, Task as MeetingTask, User } from "@/lib/types";
import { resolveTaskDepartmentSelection } from "@/lib/taskDepartment";
import { ArrowLeft, BarChart3, BookOpen, Building2, CalendarDays, CheckSquare, ChevronDown, Download, FileText, Plus, RefreshCw, Search, Sparkles, Target, Trash2, X } from "lucide-react";
import { AppHeader, Tag } from "./MobileShell";
import { downloadStorageObject, downloadStorageObjectsByOwner, extractMeetingFileText, generateMeetingDraft, type MeetingFileTextResponse } from "./mobileMinutesApi";
import type { MobileBackendEntry, MobileBackendPage, MobileManagementMeetingRow, MobileManagementMetrics, MobileTask, Tone } from "./mobileMinutesTypes";
import styles from "./MobileMinutes.module.css";

type MeetingListFilter = "all" | "uploaded" | "duration" | "todos";
type MeetingBoardFilter = "all" | "mobile" | "needsMinutes" | "closed";
type DepartmentMetricFilter = "meetings" | "tasks" | "completion" | "overdue";
type OkrPortfolioMetric = "projects" | "krs" | "pdca" | "running" | "highRisk" | "delayedBlocked" | "president";
type DictionaryFilter = "all" | "employee" | "business";
type DictionaryBusy = "refresh" | "save" | `delete:${string}` | undefined;

type OkrPortfolioItem = {
  title: string;
  meta: string;
  detail: string;
  projectId: string;
  badge?: string;
};

type MobileSearchableOption = {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
};

type UploadedMeetingFile = {
  id: string;
  name: string;
  text: string;
  sourceType?: string;
  storageObjectId?: string;
  status: "read" | "name_only";
};

const meetingTypes: MeetingType[] = ["门店周会", "研发会议", "售后复盘", "AI项目会议", "经营例会", "培训会议"];
const taskPriorityOptions: Priority[] = ["高", "中", "低"];

function formatDateTime(value?: string) {
  if (!value) return "时间未定";
  const raw = value.trim();
  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasTimeZone ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function meetingStatus(meeting: Meeting) {
  if (meeting.recordingStatus === "transcribing") return { label: "精修中", tone: "wait" as const };
  if (meeting.recordingStatus === "failed") return { label: "转写异常", tone: "risk" as const };
  if (meeting.approvalStatus === "pending_president_approval") return { label: "待签批", tone: "wait" as const };
  if (meeting.status === "summarized" || meeting.aiSummary || meeting.minuteMarkdown) return { label: "已生成", tone: "success" as const };
  return { label: "待确认", tone: "normal" as const };
}

function boardStatusLabel(status: MeetingBoardStatus): { label: string; tone: Tone; priority: number } {
  if (status === "recording_failed") return { label: "转写异常", tone: "risk", priority: 5 };
  if (status === "recording_transcribing") return { label: "精修中", tone: "wait", priority: 4 };
  if (status === "pending_approval") return { label: "待签批", tone: "wait", priority: 3 };
  if (status === "needs_minutes" || status === "needs_approval_submission") return { label: "待确认", tone: "wait", priority: 2 };
  if (status === "closed" || status === "in_closed_loop") return { label: "已闭环", tone: "success", priority: 0 };
  return { label: "进行中", tone: "normal", priority: 1 };
}

function sourceTypeLabel(sourceType: MeetingBoardRow["sourceType"]) {
  if (sourceType === "mobile_recording") return "手机录音";
  if (sourceType === "desktop_upload") return "文件上传";
  if (sourceType === "manual") return "手动录入";
  return "未知来源";
}

function departmentName(departmentId: string | undefined, departments: Department[]) {
  return departments.find((department) => department.id === departmentId)?.name ?? departmentId ?? "未分组";
}

function userName(userId: string | undefined, users: User[], fallback = "未设置") {
  if (!userId) return fallback;
  return users.find((user) => user.id === userId)?.name ?? fallback;
}

function isActiveTask(task: MobileTask) {
  return task.tab !== "done";
}

function isDoneTask(task: MobileTask) {
  return task.tab === "done" || task.status.includes("完成") || task.rawTask?.status === "completed" || task.rawTask?.status === "已完成" || task.rawOkrTask?.status === "已完成";
}

function parseDateValue(value?: string) {
  if (!value || value === "未设置") return Number.NaN;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NaN : time;
}

function isOverdueTask(task: MobileTask) {
  if (task.status.includes("逾期") || task.status.includes("延期") || task.rawTask?.status === "overdue") return true;
  if (isDoneTask(task)) return false;
  const dueTime = parseDateValue(task.rawTask?.dueDate || task.rawOkrTask?.endDate || task.due);
  if (Number.isNaN(dueTime)) return false;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return dueTime < todayStart.getTime();
}

function taskMeetingId(task: MobileTask) {
  return task.rawTask?.meetingId || task.rawTask?.sourceMeetingId || task.rawMeeting?.id;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPercent(value: number) {
  return `${clampPercent(value)}%`;
}

function formatDecimal(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTimeForText(value: string) {
  if (!value) return "";
  return value.replace("T", " ").replaceAll("-", "/");
}

function parseDateTimeText(value: string) {
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function dateKeyFromDateTime(value: string) {
  return (value || "").slice(0, 10) || formatDateInput(new Date());
}

function formatDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTimeText(date = new Date()) {
  return date.toISOString();
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMinutes(date: Date, minutes: number) {
  const nextDate = new Date(date);
  nextDate.setMinutes(nextDate.getMinutes() + minutes);
  return nextDate;
}

function splitInputItems(value: string) {
  return value
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function nextMobileId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function userSearchValue(user: User, departments: Department[]) {
  const department = departments.find((item) => item.id === user.departmentId);
  return [user.name, user.employeeNo, user.title, user.role, department?.name, department?.fullPath].filter(Boolean).join(" ");
}

function departmentSearchValue(department: Department) {
  return [department.name, department.fullPath, department.orgCode, department.orgType, department.description].filter(Boolean).join(" ");
}

function composeTranscriptFromFiles(files: UploadedMeetingFile[]) {
  return files
    .map((file) => {
      const body = file.text.trim() || `已上传会议文稿文件：${file.name}。系统暂未读取正文，可以手动补充会议原文。`;
      return `【${file.name}】\n${body}`;
    })
    .join("\n\n");
}

function taskContentText(task: MeetingTask) {
  return task.content || task.title || "";
}

function dateInputValue(value?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return value.replaceAll("/", "-");
  const raw = value.trim();
  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const parsed = new Date(hasTimeZone ? raw : raw.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? "" : formatDateInput(parsed);
}

function MobileSearchableSelect({
  value,
  onChange,
  options,
  placeholder = "输入关键词选择",
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  options: MobileSearchableOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 260 });
  const normalizedQuery = query.trim().toLowerCase();
  const visibleText = open ? query : selected?.label ?? value;
  const filteredOptions = (normalizedQuery
    ? options.filter((option) => `${option.label} ${option.meta ?? ""} ${option.searchText ?? ""}`.toLowerCase().includes(normalizedQuery))
    : options
  ).slice(0, 80);

  function updateMenuPosition() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 14;
    const gap = 6;
    const menuWidth = Math.min(Math.max(rect.width, 300), window.innerWidth - viewportPadding * 2);
    const menuLeft = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - viewportPadding - menuWidth);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(150, Math.min(310, (openAbove ? spaceAbove : spaceBelow) - gap));
    setMenuPosition({
      top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap,
      left: menuLeft,
      width: menuWidth,
      maxHeight
    });
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, filteredOptions.length]);

  function choose(option: MobileSearchableOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filteredOptions[0]) {
      event.preventDefault();
      choose(filteredOptions[0]);
    }
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={wrapperRef} className={styles.mobileSearchSelect}>
      <div className={styles.mobileSearchSelectControl}>
        <input
          value={visibleText}
          title={selected ? [selected.label, selected.meta].filter(Boolean).join(" · ") : value}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            requestAnimationFrame(updateMenuPosition);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            requestAnimationFrame(updateMenuPosition);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label="展开选项"
          onClick={() => {
            setOpen((current) => !current);
            setQuery("");
            requestAnimationFrame(updateMenuPosition);
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.mobileSearchSelectMenu}
              style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
            >
              {filteredOptions.length ? (
                filteredOptions.map((option) => (
                  <button
                    className={`${styles.mobileSearchSelectOption} ${option.value === value ? styles.mobileSearchSelectOptionActive : ""}`}
                    type="button"
                    key={`${option.value}-${option.label}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    <span>{option.label}</span>
                    {option.meta ? <small>{option.meta}</small> : null}
                  </button>
                ))
              ) : (
                <div className={styles.mobileSearchSelectEmpty}>没有匹配选项</div>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function MobileDateTimeInput({ value, onChange, min }: { value: string; onChange: (value: string) => void; min?: string }) {
  return (
    <input
      className={styles.mobileDateTimeInput}
      type="datetime-local"
      value={value}
      min={min}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function chartStyle(value: number, color: string) {
  return { "--value": `${clampPercent(value)}%`, "--chart-color": color } as CSSProperties;
}

function pageTitle(page: MobileBackendPage) {
  if (page === "new-meeting") return "新建会议";
  if (page === "management-dashboard") return "管理驾驶舱";
  if (page === "meeting-list") return "会议列表";
  if (page === "departments") return "部门看板";
  if (page === "okr-projects") return "OKR 项目";
  if (page === "dictionary") return "会议词典";
  return "会议看板";
}

function isUploadedMeeting(meeting: Meeting) {
  return Boolean(meeting.uploadedFileName || meeting.sourceFileName || meeting.rawTranscript || meeting.transcript || meeting.recordingStatus || meeting.aiSummary || meeting.minuteMarkdown);
}

function isBusinessDictionaryEntry(entry: MeetingDictionaryEntry) {
  return entry.category !== "员工姓名";
}

function MetricFilterButton({
  active,
  label,
  value,
  hint,
  onClick
}: {
  active: boolean;
  label: string;
  value: string | number;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button className={`${styles.boardMetric} ${styles.metricFilterButton} ${active ? styles.metricFilterButtonActive : ""}`} type="button" onClick={onClick}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
      {hint ? <span className={styles.metricHint}>{hint}</span> : null}
    </button>
  );
}

export function MobileBackendPanel({
  activePage,
  entries,
  meetings,
  tasks,
  departments,
  meetingBoard,
  managementMetrics,
  okrProjects,
  dictionaryEntries,
  currentUser,
  userDirectory,
  onBack,
  onChangePage,
  onCreateDictionaryEntry,
  onCreateMeeting,
  onCreateOkrProject,
  onDeleteDictionaryEntry,
  onOpenMeeting,
  onOpenOkrTasks,
  onOpenTask,
  onRefreshDictionary
}: {
  activePage: MobileBackendPage;
  entries: MobileBackendEntry[];
  meetings: Meeting[];
  tasks: MobileTask[];
  departments: Department[];
  meetingBoard?: MeetingBoardResponse;
  managementMetrics?: MobileManagementMetrics;
  attentionMeetings?: MobileManagementMeetingRow[];
  okrProjects: OkrProject[];
  dictionaryEntries: MeetingDictionaryEntry[];
  currentUser?: User;
  userDirectory: User[];
  onBack: () => void;
  onChangePage: (page: MobileBackendPage) => void;
  onCreateDictionaryEntry: (input: { standard: string; variants: string; category: string; note: string }) => Promise<void>;
  onCreateMeeting: (meeting: Meeting) => Promise<Meeting>;
  onCreateOkrProject: (project: OkrProject) => Promise<void>;
  onDeleteDictionaryEntry: (entryId: string) => Promise<void>;
  onOpenMeeting: (meetingId: string) => void;
  onOpenOkrTasks: () => void;
  onOpenTask: (taskId: string) => void;
  onRefreshDictionary: () => Promise<void>;
}) {
  const [meetingFilter, setMeetingFilter] = useState<MeetingListFilter>("all");
  const [meetingBoardFilter, setMeetingBoardFilter] = useState<MeetingBoardFilter>("all");
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentMetricFilter>("meetings");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | undefined>();
  const [okrFilter, setOkrFilter] = useState<OkrPortfolioMetric>("projects");
  const [selectedOkrProjectId, setSelectedOkrProjectId] = useState<string | undefined>();
  const [isOkrCreateOpen, setIsOkrCreateOpen] = useState(false);
  const [okrCreateName, setOkrCreateName] = useState("新建 OKR 项目");
  const [okrCreateObjective, setOkrCreateObjective] = useState("填写本项目要达成的核心业务目标。");
  const [okrCreateBackground, setOkrCreateBackground] = useState("说明项目背景、为什么现在要推进。");
  const [okrCreatePriority, setOkrCreatePriority] = useState<"高" | "中" | "低">("中");
  const [okrCreateKrTitle, setOkrCreateKrTitle] = useState("建立关键结果");
  const [okrCreateKrCode, setOkrCreateKrCode] = useState("KR1");
  const [okrCreateKrMetric, setOkrCreateKrMetric] = useState("说明这个 KR 如何判断完成。");
  const [okrCreateKrTargetValue, setOkrCreateKrTargetValue] = useState("按期完成");
  const [okrCreateKrCurrentValue, setOkrCreateKrCurrentValue] = useState("未开始");
  const [okrCreateKrWeight, setOkrCreateKrWeight] = useState("50");
  const [okrCreateKrOwnerId, setOkrCreateKrOwnerId] = useState("");
  const [okrCreateKrReviewerId, setOkrCreateKrReviewerId] = useState("");
  const [okrCreateTaskTitle, setOkrCreateTaskTitle] = useState("梳理推进任务");
  const [okrCreatePdcaStage, setOkrCreatePdcaStage] = useState<OkrPdcaStage>("Plan");
  const [okrCreateTaskContent, setOkrCreateTaskContent] = useState("填写任务内容。");
  const [okrCreateTaskStartDate, setOkrCreateTaskStartDate] = useState(formatDateInput(new Date()));
  const [okrCreateTaskEndDate, setOkrCreateTaskEndDate] = useState(formatDateInput(addDays(new Date(), 14)));
  const [okrCreateTaskDeliverable, setOkrCreateTaskDeliverable] = useState("输出成果");
  const [okrCreateTaskOwnerId, setOkrCreateTaskOwnerId] = useState("");
  const [okrCreateTaskReviewerId, setOkrCreateTaskReviewerId] = useState("");
  const [okrCreateCollaboratorDepartmentIds, setOkrCreateCollaboratorDepartmentIds] = useState<string[]>([]);
  const [okrCreateExtraKrLines, setOkrCreateExtraKrLines] = useState("");
  const [okrCreateExtraTaskLines, setOkrCreateExtraTaskLines] = useState("");
  const [okrCreateMessage, setOkrCreateMessage] = useState("");
  const [isOkrCreateBusy, setIsOkrCreateBusy] = useState(false);
  const [dictionaryFilter, setDictionaryFilter] = useState<DictionaryFilter>("all");
  const [isDictionaryFormOpen, setIsDictionaryFormOpen] = useState(false);
  const [dictionaryStandard, setDictionaryStandard] = useState("");
  const [dictionaryVariants, setDictionaryVariants] = useState("");
  const [dictionaryCategory, setDictionaryCategory] = useState("业务词");
  const [dictionaryNote, setDictionaryNote] = useState("");
  const [dictionaryMessage, setDictionaryMessage] = useState("");
  const [dictionaryBusy, setDictionaryBusy] = useState<DictionaryBusy>();
  const initialStartTime = useMemo(() => new Date(), []);
  const [meetingCreateId, setMeetingCreateId] = useState(() => nextMobileId("mobile-manual"));
  const [meetingCreateTitle, setMeetingCreateTitle] = useState("");
  const [meetingCreateDepartmentId, setMeetingCreateDepartmentId] = useState("");
  const [meetingCreateHostId, setMeetingCreateHostId] = useState("");
  const [meetingCreateType, setMeetingCreateType] = useState<MeetingType | "">("");
  const [meetingCreateOkrProjectId, setMeetingCreateOkrProjectId] = useState("");
  const [meetingCreateParticipantIds, setMeetingCreateParticipantIds] = useState<string[]>([]);
  const [meetingCreateParticipantKeyword, setMeetingCreateParticipantKeyword] = useState("");
  const [meetingCreateStartTime, setMeetingCreateStartTime] = useState(formatDateTimeLocal(initialStartTime));
  const [meetingCreateEndTime, setMeetingCreateEndTime] = useState(formatDateTimeLocal(addMinutes(initialStartTime, 40)));
  const [meetingCreateTranscript, setMeetingCreateTranscript] = useState("");
  const [meetingCreateUploadedFiles, setMeetingCreateUploadedFiles] = useState<UploadedMeetingFile[]>([]);
  const [meetingCreateAiSummary, setMeetingCreateAiSummary] = useState("");
  const [meetingCreateMinuteMarkdown, setMeetingCreateMinuteMarkdown] = useState("");
  const [meetingCreateDecisions, setMeetingCreateDecisions] = useState<MeetingDecision[]>([]);
  const [meetingCreateDraftTasks, setMeetingCreateDraftTasks] = useState<MeetingTask[]>([]);
  const [meetingCreateTaskContent, setMeetingCreateTaskContent] = useState("");
  const [meetingCreateTaskOwnerId, setMeetingCreateTaskOwnerId] = useState("");
  const [meetingCreateTaskDueDate, setMeetingCreateTaskDueDate] = useState(formatDateInput(addDays(initialStartTime, 7)));
  const [meetingCreateMessage, setMeetingCreateMessage] = useState("");
  const [isMeetingFileBusy, setIsMeetingFileBusy] = useState(false);
  const [isMeetingAiBusy, setIsMeetingAiBusy] = useState(false);
  const [isMeetingCreateBusy, setIsMeetingCreateBusy] = useState(false);
  const meetingFileInputRef = useRef<HTMLInputElement | null>(null);

  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => Date.parse(b.startTime || b.createdAt || "") - Date.parse(a.startTime || a.createdAt || "")),
    [meetings]
  );
  const boardRows = useMemo(
    () => [...(meetingBoard?.rows ?? [])].sort((a, b) => Date.parse(b.startTime || "") - Date.parse(a.startTime || "")),
    [meetingBoard]
  );
  const meetingBoardFilterDetails: Record<MeetingBoardFilter, { title: string; empty: string; rows: MeetingBoardRow[] }> = {
    all: { title: "会议总数", empty: "当前账号暂无会议看板数据。", rows: boardRows },
    mobile: { title: "移动录音", empty: "当前没有手机录音会议。", rows: boardRows.filter((row) => row.sourceType === "mobile_recording") },
    needsMinutes: { title: "待生成纪要", empty: "当前没有待生成纪要的会议。", rows: boardRows.filter((row) => row.boardStatus === "needs_minutes" || row.boardStatus === "needs_approval_submission") },
    closed: { title: "已闭环", empty: "当前没有已闭环会议。", rows: boardRows.filter((row) => row.boardStatus === "closed" || row.boardStatus === "in_closed_loop") }
  };
  const activeMeetingBoardDetail = meetingBoardFilterDetails[meetingBoardFilter];
  const meetingRows = useMemo(
    () =>
      sortedMeetings.map((meeting) => {
        const relatedTasks = tasks.filter((task) => taskMeetingId(task) === meeting.id);
        return {
          meeting,
          relatedTasks,
          taskCount: relatedTasks.length,
          isUploaded: isUploadedMeeting(meeting)
        };
      }),
    [sortedMeetings, tasks]
  );
  const uploadedMeetingRows = meetingRows.filter((row) => row.isUploaded);
  const durationMeetingRows = [...meetingRows].filter((row) => row.meeting.durationMinutes > 0).sort((a, b) => b.meeting.durationMinutes - a.meeting.durationMinutes);
  const todoMeetingRows = meetingRows.filter((row) => row.taskCount > 0).sort((a, b) => b.taskCount - a.taskCount);
  const totalMeetingTodoCount = meetingRows.reduce((sum, row) => sum + row.taskCount, 0);
  const meetingFilterDetails: Record<MeetingListFilter, { title: string; empty: string; rows: typeof meetingRows }> = {
    all: { title: "监督对象", empty: "当前账号暂无可见会议。", rows: meetingRows },
    uploaded: { title: "会议上传", empty: "当前没有上传或录音沉淀的会议。", rows: uploadedMeetingRows },
    duration: { title: "会议总时长", empty: "当前没有记录会议时长的会议。", rows: durationMeetingRows },
    todos: { title: "待办推进", empty: "当前没有形成待办的会议。", rows: todoMeetingRows }
  };
  const activeMeetingDetail = meetingFilterDetails[meetingFilter];
  const currentUserId = currentUser?.id || userDirectory[0]?.id || "";
  const effectiveMeetingDepartmentId = meetingCreateDepartmentId;
  const effectiveMeetingHostId = meetingCreateHostId;
  const effectiveMeetingTaskOwnerId = meetingCreateTaskOwnerId || effectiveMeetingHostId;
  const selectedOkrForMeeting = meetingCreateOkrProjectId ? okrProjects.find((project) => project.id === meetingCreateOkrProjectId) : undefined;
  const departmentOptions = useMemo<MobileSearchableOption[]>(
    () =>
      departments.map((department) => ({
        value: department.id,
        label: department.name,
        meta: department.fullPath || department.description,
        searchText: departmentSearchValue(department)
      })),
    [departments]
  );
  const userOptions = useMemo<MobileSearchableOption[]>(
    () =>
      userDirectory.map((user) => ({
        value: user.id,
        label: `${user.name} / ${user.title || user.role}`,
        meta: departmentName(user.departmentId, departments),
        searchText: userSearchValue(user, departments)
      })),
    [departments, userDirectory]
  );
  const meetingTypeOptions = useMemo<MobileSearchableOption[]>(
    () => meetingTypes.map((meetingType) => ({ value: meetingType, label: meetingType })),
    []
  );
  const okrMeetingOptions = useMemo<MobileSearchableOption[]>(
    () => [
      { value: "", label: "无" },
      ...okrProjects.map((project) => ({
        value: project.id,
        label: project.name,
        meta: project.ownerDepartment,
        searchText: `${project.name} ${project.owner} ${project.ownerDepartment} ${project.objective}`
      }))
    ],
    [okrProjects]
  );
  const meetingParticipantIds = useMemo(
    () => [...new Set([effectiveMeetingHostId, ...meetingCreateParticipantIds].filter(Boolean))],
    [effectiveMeetingHostId, meetingCreateParticipantIds]
  );
  const meetingParticipantUsers = meetingParticipantIds
    .map((userId) => userDirectory.find((user) => user.id === userId))
    .filter((user): user is User => Boolean(user));
  const participantCandidateUsers = useMemo(() => {
    const keyword = meetingCreateParticipantKeyword.trim().toLowerCase();
    if (!keyword) return [];
    const selectedIds = new Set(meetingParticipantIds);
    return userDirectory
      .filter((user) => !selectedIds.has(user.id))
      .filter((user) => userSearchValue(user, departments).toLowerCase().includes(keyword))
      .slice(0, 12);
  }, [departments, meetingCreateParticipantKeyword, meetingParticipantIds, userDirectory]);
  const computedMeetingDurationMinutes = useMemo(() => {
    const startTime = new Date(meetingCreateStartTime).getTime();
    const endTime = new Date(meetingCreateEndTime).getTime();
    if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) return 40;
    return Math.max(1, Math.round((endTime - startTime) / 60000));
  }, [meetingCreateEndTime, meetingCreateStartTime]);

  const departmentRows = useMemo(
    () =>
      departments
        .map((department) => {
          const departmentMeetings = meetings.filter((meeting) => meeting.departmentId === department.id);
          const departmentTasks = tasks.filter((task) => task.rawTask?.departmentId === department.id || task.rawOkrTask?.ownerDepartmentId === department.id);
          const doneTaskCount = departmentTasks.filter(isDoneTask).length;
          const activeTaskCount = departmentTasks.filter(isActiveTask).length;
          const overdueTaskCount = departmentTasks.filter(isOverdueTask).length;
          const completionRate = departmentTasks.length ? (doneTaskCount / departmentTasks.length) * 100 : 0;
          return {
            id: department.id,
            name: department.name,
            meetings: departmentMeetings,
            tasks: departmentTasks,
            meetingCount: departmentMeetings.length,
            taskCount: departmentTasks.length,
            activeTaskCount,
            doneTaskCount,
            overdueTaskCount,
            completionRate
          };
        })
        .filter((row) => row.meetingCount || row.taskCount || row.overdueTaskCount)
        .sort((a, b) => b.activeTaskCount - a.activeTaskCount || b.meetingCount - a.meetingCount),
    [departments, meetings, tasks]
  );
  const departmentTaskCount = departmentRows.reduce((sum, row) => sum + row.taskCount, 0);
  const departmentDoneCount = departmentRows.reduce((sum, row) => sum + row.doneTaskCount, 0);
  const departmentOverdueCount = departmentRows.reduce((sum, row) => sum + row.overdueTaskCount, 0);
  const departmentCompletionRate = departmentTaskCount ? (departmentDoneCount / departmentTaskCount) * 100 : 0;
  const departmentFilterDetails: Record<DepartmentMetricFilter, { title: string; empty: string; rows: typeof departmentRows }> = {
    meetings: { title: "部门会议", empty: "当前没有可见部门会议。", rows: departmentRows.filter((row) => row.meetingCount > 0).sort((a, b) => b.meetingCount - a.meetingCount) },
    tasks: { title: "部门待办", empty: "当前没有可见部门待办。", rows: departmentRows.filter((row) => row.taskCount > 0).sort((a, b) => b.taskCount - a.taskCount) },
    completion: { title: "完成率", empty: "当前没有可计算完成率的部门。", rows: departmentRows.filter((row) => row.taskCount > 0).sort((a, b) => b.completionRate - a.completionRate) },
    overdue: { title: "逾期风险", empty: "当前没有逾期风险部门。", rows: departmentRows.filter((row) => row.overdueTaskCount > 0).sort((a, b) => b.overdueTaskCount - a.overdueTaskCount) }
  };
  const activeDepartmentDetail = departmentFilterDetails[departmentFilter];
  const selectedDepartment = selectedDepartmentId ? departmentRows.find((row) => row.id === selectedDepartmentId) : undefined;

  const activeOkrProjects = okrProjects.filter((project) => !["已完成", "已关闭"].includes(project.status));
  const okrPortfolio = useMemo(() => {
    const allKrs = okrProjects.flatMap((project) => project.krs);
    const allTasks = okrProjects.flatMap((project) => project.pdcaTasks);
    return {
      projectCount: okrProjects.length,
      krCount: allKrs.length,
      pdcaCount: allTasks.length,
      runningCount: okrProjects.filter((project) => project.status === "进行中").length,
      highRiskCount: okrProjects.filter((project) => project.riskLevel === "高").length,
      delayedBlockedCount: allTasks.filter((task) => task.status === "已延期" || task.status === "阻塞中").length,
      presidentAttentionCount: okrProjects.reduce((sum, project) => sum + project.needPresidentDecisionCount, 0)
    };
  }, [okrProjects]);
  const okrPortfolioDetails: Record<OkrPortfolioMetric, { title: string; empty: string; items: OkrPortfolioItem[] }> = {
    projects: {
      title: "OKR 项目明细",
      empty: "当前没有 OKR 项目。",
      items: okrProjects.map((project) => ({
        title: project.name,
        meta: `${project.category} · ${project.owner} · ${project.ownerDepartment}`,
        detail: `O：${project.objective}`,
        projectId: project.id,
        badge: project.status
      }))
    },
    krs: {
      title: "KR 明细",
      empty: "当前没有 KR 明细。",
      items: okrProjects.flatMap((project) =>
        project.krs.map((kr) => ({
          title: `${kr.code} ${kr.title}`,
          meta: `${project.name} · ${kr.owner} · ${kr.department}`,
          detail: `衡量标准：${kr.metric}`,
          projectId: project.id,
          badge: kr.status
        }))
      )
    },
    pdca: {
      title: "PDCA 任务明细",
      empty: "当前没有 PDCA 任务。",
      items: okrProjects.flatMap((project) =>
        project.pdcaTasks.map((task) => ({
          title: task.title,
          meta: `${project.name} · ${task.pdcaStage} · ${task.owner} · ${task.ownerDepartment}`,
          detail: `输出成果：${task.deliverable}；计划 ${task.startDate} 至 ${task.endDate}`,
          projectId: project.id,
          badge: task.status
        }))
      )
    },
    running: {
      title: "进行中项目明细",
      empty: "当前没有进行中项目。",
      items: okrProjects.filter((project) => project.status === "进行中").map((project) => ({
        title: project.name,
        meta: `${project.owner} · ${project.ownerDepartment} · 进度 ${project.progress}%`,
        detail: project.objective,
        projectId: project.id,
        badge: project.riskLevel
      }))
    },
    highRisk: {
      title: "高风险项目明细",
      empty: "当前没有高风险项目。",
      items: okrProjects.filter((project) => project.riskLevel === "高").map((project) => ({
        title: project.name,
        meta: `${project.owner} · ${project.ownerDepartment} · ${project.periodText ?? ""}`,
        detail: project.risks.map((risk) => risk.description).join("；") || project.objective,
        projectId: project.id,
        badge: project.status
      }))
    },
    delayedBlocked: {
      title: "延期 / 阻塞任务明细",
      empty: "当前没有延期或阻塞任务。",
      items: okrProjects.flatMap((project) =>
        project.pdcaTasks.filter((task) => task.status === "已延期" || task.status === "阻塞中").map((task) => ({
          title: task.title,
          meta: `${project.name} · ${task.owner} · ${task.ownerDepartment}`,
          detail: `状态：${task.status}；计划 ${task.startDate} 至 ${task.endDate}；输出成果：${task.deliverable}`,
          projectId: project.id,
          badge: task.riskLevel
        }))
      )
    },
    president: {
      title: "总裁关注事项明细",
      empty: "当前没有总裁关注事项。",
      items: okrProjects.flatMap((project) => [
        ...project.risks.filter((risk) => risk.needPresidentCoordination).map((risk) => ({
          title: risk.description,
          meta: `${project.name} · ${risk.departments.join("、")}`,
          detail: risk.suggestion,
          projectId: project.id,
          badge: risk.riskLevel
        })),
        ...project.supportRequests.map((request) => ({
          title: request,
          meta: `${project.name} · ${project.ownerDepartment}`,
          detail: "需要公司统一协调资源或决策支持。",
          projectId: project.id,
          badge: "需关注"
        }))
      ])
    }
  };
  const activeOkrDetail = okrPortfolioDetails[okrFilter];
  const selectedOkrProject = selectedOkrProjectId ? okrProjects.find((project) => project.id === selectedOkrProjectId) : undefined;
  const okrUserOptions = userDirectory.length ? userDirectory : currentUser ? [currentUser] : [];
  const defaultReviewerId = okrUserOptions.find((user) => user.role === "总裁")?.id ?? okrUserOptions.find((user) => user.id !== currentUser?.id)?.id ?? currentUser?.id ?? "";
  const okrProjectOwnerId = currentUser?.id ?? okrUserOptions[0]?.id ?? "mobile-okr-user";
  const krOwnerId = okrCreateKrOwnerId || okrProjectOwnerId;
  const krReviewerId = okrCreateKrReviewerId || defaultReviewerId;
  const taskOwnerId = okrCreateTaskOwnerId || krOwnerId;
  const taskReviewerId = okrCreateTaskReviewerId || defaultReviewerId;

  const dictionaryEmployeeCount = dictionaryEntries.filter((entry) => entry.category === "员工姓名").length;
  const dictionaryBusinessCount = dictionaryEntries.filter(isBusinessDictionaryEntry).length;
  const dictionaryFilterDetails: Record<DictionaryFilter, { title: string; empty: string; entries: MeetingDictionaryEntry[] }> = {
    all: { title: "全部词条", empty: "当前暂无会议词典。", entries: dictionaryEntries },
    employee: { title: "员工姓名", empty: "当前暂无员工姓名词条。", entries: dictionaryEntries.filter((entry) => entry.category === "员工姓名") },
    business: { title: "业务词", empty: "当前暂无业务词条。", entries: dictionaryEntries.filter(isBusinessDictionaryEntry) }
  };
  const activeDictionaryDetail = dictionaryFilterDetails[dictionaryFilter];

  const totalMeetingCount = managementMetrics?.totalMeetings ?? meetingBoard?.summary.totalMeetings ?? meetings.length;
  const settledMeetingCount = totalMeetingCount;
  const totalDurationMinutes = meetings.reduce((sum, meeting) => sum + (meeting.durationMinutes || 0), 0);
  const totalManHours = meetings.reduce((sum, meeting) => {
    const participantCount = meeting.participantCount ?? meeting.participantIds?.length ?? 0;
    return sum + (meeting.totalManHours ?? ((meeting.durationMinutes || 0) * participantCount) / 60);
  }, 0);
  const formedTodoCount = meetingBoard?.summary.totalTaskCount ?? tasks.length;
  const meetingInvestmentRate = totalMeetingCount > 0 ? (settledMeetingCount / totalMeetingCount) * 100 : 0;
  const allTodoCount = Math.max(tasks.length, meetingBoard?.summary.totalTaskCount ?? 0, managementMetrics?.activeMeetingTasks ?? 0);
  const completedTodoCount = tasks.filter(isDoneTask).length;
  const overdueTodoCount = Math.max(tasks.filter(isOverdueTask).length, managementMetrics?.overdueTasks ?? 0, meetingBoard?.summary.overdueTaskCount ?? 0);
  const onTimeDoneCount = tasks.filter((task) => isDoneTask(task) && !isOverdueTask(task)).length;
  const completionRate = allTodoCount > 0 ? (completedTodoCount / allTodoCount) * 100 : 0;

  async function handleRefreshDictionary() {
    setDictionaryBusy("refresh");
    setDictionaryMessage("");
    try {
      await onRefreshDictionary();
      setDictionaryMessage("会议词典已刷新。");
    } catch (error) {
      setDictionaryMessage(error instanceof Error ? error.message : "会议词典刷新失败。");
    } finally {
      setDictionaryBusy(undefined);
    }
  }

  async function handleCreateDictionaryEntry() {
    const standard = dictionaryStandard.trim();
    if (!standard) {
      setDictionaryMessage("请先填写标准词。");
      return;
    }
    setDictionaryBusy("save");
    setDictionaryMessage("");
    try {
      await onCreateDictionaryEntry({
        standard,
        variants: dictionaryVariants.trim(),
        category: dictionaryCategory,
        note: dictionaryNote.trim()
      });
      setDictionaryStandard("");
      setDictionaryVariants("");
      setDictionaryNote("");
      setDictionaryFilter("all");
      setDictionaryMessage("词条已保存。");
    } catch (error) {
      setDictionaryMessage(error instanceof Error ? error.message : "词条保存失败。");
    } finally {
      setDictionaryBusy(undefined);
    }
  }

  function addMeetingParticipant(userId: string) {
    setMeetingCreateParticipantIds((current) => (current.includes(userId) || userId === effectiveMeetingHostId ? current : [...current, userId]));
    setMeetingCreateParticipantKeyword("");
  }

  function removeMeetingParticipant(userId: string) {
    if (userId === effectiveMeetingHostId) return;
    setMeetingCreateParticipantIds((current) => current.filter((id) => id !== userId));
  }

  function clearMeetingGeneratedDraft(message = "会议基础信息或文稿已变化，请重新生成会议纪要。") {
    const hadDraft = Boolean(meetingCreateAiSummary || meetingCreateMinuteMarkdown || meetingCreateDecisions.length || meetingCreateDraftTasks.length);
    setMeetingCreateAiSummary("");
    setMeetingCreateMinuteMarkdown("");
    setMeetingCreateDecisions([]);
    setMeetingCreateDraftTasks([]);
    if (hadDraft) setMeetingCreateMessage(message);
  }

  async function handleMeetingFiles(files?: FileList | File[]) {
    const fileList = Array.from(files ?? []);
    if (!fileList.length) return;
    setIsMeetingFileBusy(true);
    setMeetingCreateMessage("正在读取会议文稿...");
    const parsedFiles: UploadedMeetingFile[] = [];
    for (const file of fileList) {
      try {
        const result: MeetingFileTextResponse = await extractMeetingFileText(file, { ownerType: "meeting", ownerId: meetingCreateId });
        parsedFiles.push({
          id: result.storageObject?.id || nextMobileId("meeting-file"),
          name: result.fileName || file.name,
          text: result.text || "",
          sourceType: result.sourceType,
          storageObjectId: result.storageObject?.id,
          status: "read"
        });
      } catch {
        parsedFiles.push({
          id: nextMobileId("meeting-file"),
          name: file.name,
          text: "",
          status: "name_only"
        });
      }
    }
    setMeetingCreateUploadedFiles((current) => {
      const nextFiles = [...current, ...parsedFiles];
      setMeetingCreateTranscript(composeTranscriptFromFiles(nextFiles));
      return nextFiles;
    });
    if (meetingFileInputRef.current) meetingFileInputRef.current.value = "";
    const readCount = parsedFiles.filter((file) => file.status === "read").length;
    clearMeetingGeneratedDraft(`${parsedFiles.length} 个文件已记录；${readCount} 个已读取正文。`);
    setIsMeetingFileBusy(false);
  }

  function removeMeetingFile(fileId: string) {
    setMeetingCreateUploadedFiles((current) => {
      const nextFiles = current.filter((file) => file.id !== fileId);
      setMeetingCreateTranscript(composeTranscriptFromFiles(nextFiles));
      return nextFiles;
    });
    clearMeetingGeneratedDraft("已删除文件，会议原文已重新整理，请重新生成会议纪要。");
  }

  function defaultMeetingTaskReviewerId(ownerId: string) {
    const owner = userDirectory.find((user) => user.id === ownerId);
    if (owner?.managerId) return owner.managerId;
    if (ownerId === effectiveMeetingHostId) {
      return userDirectory.find((user) => user.role === "总裁")?.id || currentUser?.managerId || effectiveMeetingHostId;
    }
    return effectiveMeetingHostId;
  }

  function normalizeMeetingDraftTask(task: Partial<MeetingTask>, index: number, createdAt = formatDateTimeText()): MeetingTask {
    const content = (task.content || task.title || meetingCreateTaskContent).trim();
    const ownerId = task.ownerId || task.owner || effectiveMeetingTaskOwnerId;
    const departmentId = resolveTaskDepartmentSelection({
      task: { departmentId: task.departmentId || "", ownerDepartment: task.ownerDepartment },
      departments,
      ownerDepartmentId: userDirectory.find((user) => user.id === ownerId)?.departmentId,
      meetingDepartmentId: effectiveMeetingDepartmentId
    });
    const startDate = dateInputValue(task.startDate) || dateKeyFromDateTime(meetingCreateStartTime);
    const dueDate = dateInputValue(task.dueDate) || meetingCreateTaskDueDate;
    const priority = taskPriorityOptions.includes(task.priority as Priority) ? (task.priority as Priority) : "中";

    return {
      id: task.id || `${meetingCreateId}-task-${index + 1}`,
      title: content,
      content,
      description: task.description || task.sourceText || meetingCreateTranscript.trim() || content,
      meetingId: meetingCreateId,
      sourceMeetingId: meetingCreateId,
      sourceText: task.sourceText || meetingCreateTranscript.trim() || content,
      sourceFileName: task.sourceFileName,
      sourceDecisionId: task.sourceDecisionId,
      sourceTraceLabel: task.sourceTraceLabel,
      ownerId,
      owner: ownerId,
      reviewerId: task.reviewerId || defaultMeetingTaskReviewerId(ownerId),
      ownerDepartment: task.ownerDepartment || departmentName(departmentId, departments),
      departmentId,
      collaboratorDepartmentIds: task.collaboratorDepartmentIds || [],
      dueDate,
      startDate,
      goal: task.goal || "",
      companySupportRequest: task.companySupportRequest || "",
      priority,
      status: "not_started",
      approvalStatus: "pending_president_approval",
      createdAt: task.createdAt || createdAt,
      updatedAt: task.updatedAt || createdAt
    };
  }

  function buildMeetingDraftTask(overrides: Partial<MeetingTask> = {}) {
    return normalizeMeetingDraftTask(
      {
        id: `${meetingCreateId}-task-${meetingCreateDraftTasks.length + 1}`,
        title: meetingCreateTaskContent,
        content: meetingCreateTaskContent,
        ownerId: effectiveMeetingTaskOwnerId,
        owner: effectiveMeetingTaskOwnerId,
        departmentId: effectiveMeetingDepartmentId,
        startDate: dateKeyFromDateTime(meetingCreateStartTime),
        dueDate: meetingCreateTaskDueDate,
        priority: "中",
        sourceText: "主管手动补充",
        ...overrides
      },
      meetingCreateDraftTasks.length
    );
  }

  function updateMeetingDraftTasks(updater: (tasks: MeetingTask[]) => MeetingTask[]) {
    setMeetingCreateDraftTasks((current) => {
      const baseTasks = current.length ? current : [buildMeetingDraftTask({ id: `${meetingCreateId}-task-1` })];
      return updater(baseTasks).map((task, index) => normalizeMeetingDraftTask(task, index));
    });
  }

  function addMeetingDraftTask() {
    updateMeetingDraftTasks((current) => [
      ...current,
      buildMeetingDraftTask({
        id: `${meetingCreateId}-task-${current.length + 1}`,
        title: "填写新增待办事项",
        content: "填写新增待办事项",
        sourceText: "主管手动补充"
      })
    ]);
  }

  function updateMeetingDraftTask(taskId: string, patch: Partial<MeetingTask>) {
    updateMeetingDraftTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  }

  function updateMeetingDraftTaskOwner(taskId: string, ownerId: string) {
    const ownerDepartmentId = userDirectory.find((user) => user.id === ownerId)?.departmentId || effectiveMeetingDepartmentId;
    updateMeetingDraftTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const previousOwnerId = task.ownerId || task.owner || effectiveMeetingTaskOwnerId;
        const previousDefaultReviewerId = defaultMeetingTaskReviewerId(previousOwnerId);
        const shouldRefreshReviewer = !task.reviewerId || task.reviewerId === previousDefaultReviewerId;
        return {
          ...task,
          ownerId,
          owner: ownerId,
          reviewerId: shouldRefreshReviewer ? defaultMeetingTaskReviewerId(ownerId) : task.reviewerId,
          departmentId: ownerDepartmentId,
          ownerDepartment: departmentName(ownerDepartmentId, departments)
        };
      })
    );
  }

  function updateMeetingDraftTaskDepartment(taskId: string, departmentId: string) {
    updateMeetingDraftTask(taskId, {
      departmentId,
      ownerDepartment: departmentName(departmentId, departments)
    });
  }

  function deleteMeetingDraftTask(taskId: string) {
    setMeetingCreateDraftTasks((current) => current.filter((task) => task.id !== taskId));
  }

  async function handleGenerateMeetingDraft() {
    const transcript = meetingCreateTranscript.trim();
    if (!transcript) {
      setMeetingCreateMessage("请先上传会议文稿，或粘贴会议原文 / 转写稿。");
      return;
    }
    if (!meetingCreateTitle.trim() || !effectiveMeetingDepartmentId || !effectiveMeetingHostId || !meetingCreateType) {
      setMeetingCreateMessage("请先填写会议主题，并选择所属部门、会议主持人和会议类型。");
      return;
    }
    setIsMeetingAiBusy(true);
    setMeetingCreateMessage("正在生成会议纪要、决策和待办...");
    try {
      const participantNames = meetingParticipantUsers.map((user) => user.name);
      const result = await generateMeetingDraft(
        {
          meetingId: meetingCreateId,
          title: meetingCreateTitle.trim(),
          departmentId: effectiveMeetingDepartmentId,
          hostId: effectiveMeetingHostId,
          transcript,
          meetingDate: dateKeyFromDateTime(meetingCreateStartTime),
          meetingType: meetingCreateType,
          participantNames,
          participantIds: meetingParticipantIds,
          participantCount: meetingParticipantIds.length,
          okrProjectName: selectedOkrForMeeting?.name || "无",
          startTime: meetingCreateStartTime
        },
        { onStatus: setMeetingCreateMessage }
      );
      const draftTasks = Array.isArray(result.tasks)
        ? (result.tasks as MeetingTask[]).map((task, index) => normalizeMeetingDraftTask(task, index))
        : [];
      setMeetingCreateAiSummary(result.aiSummary || "");
      setMeetingCreateMinuteMarkdown(result.minuteMarkdown || result.aiSummary || "");
      setMeetingCreateDecisions(Array.isArray(result.decisions) ? result.decisions : []);
      setMeetingCreateDraftTasks(draftTasks);
      if (draftTasks[0]) {
        setMeetingCreateTaskContent(draftTasks[0].content || draftTasks[0].title || meetingCreateTaskContent);
        setMeetingCreateTaskOwnerId(draftTasks[0].ownerId || draftTasks[0].owner || effectiveMeetingTaskOwnerId);
        setMeetingCreateTaskDueDate(draftTasks[0].dueDate || meetingCreateTaskDueDate);
      }
      setMeetingCreateMessage(`已生成会议纪要${draftTasks.length ? `，提取 ${draftTasks.length} 条待办` : ""}。`);
    } catch (error) {
      setMeetingCreateMessage(error instanceof Error ? `未生成正式会议纪要：${error.message}` : "未生成正式会议纪要。");
    } finally {
      setIsMeetingAiBusy(false);
    }
  }

  async function handleCreateMeeting() {
    const title = meetingCreateTitle.trim();
    if (!title) {
      setMeetingCreateMessage("请先填写会议主题。");
      return;
    }
    if (!effectiveMeetingDepartmentId || !effectiveMeetingHostId || !meetingCreateType) {
      setMeetingCreateMessage("请先选择所属部门、会议主持人和会议类型。");
      return;
    }

    const submissionDraftTasks = (meetingCreateDraftTasks.length ? meetingCreateDraftTasks : [buildMeetingDraftTask({ id: `${meetingCreateId}-task-1` })])
      .map((task, index) => normalizeMeetingDraftTask(task, index));
    const invalidTaskIndex = submissionDraftTasks.findIndex((task) => !taskContentText(task).trim() || !task.ownerId || !task.departmentId || !task.dueDate);
    if (!submissionDraftTasks.length || invalidTaskIndex >= 0) {
      setMeetingCreateMessage(`请先补齐第 ${Math.max(invalidTaskIndex + 1, 1)} 条待办的任务内容、推进人、责任部门和截止日期。`);
      return;
    }

    const startDate = new Date(meetingCreateStartTime);
    const endDate = new Date(meetingCreateEndTime);
    const durationMinutes = Math.max(
      1,
      Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
        ? 40
        : Math.round((endDate.getTime() - startDate.getTime()) / 60000)
    );
    const createdAt = formatDateTimeText();
    const meetingId = meetingCreateId;
    const meetingTasks = submissionDraftTasks.map((task, index) => {
      const ownerId = task.ownerId || task.owner || effectiveMeetingTaskOwnerId;
      const content = taskContentText(task).trim();
      return {
        ...task,
        id: task.id || `${meetingId}-task-${index + 1}`,
        title: content,
        content,
        description: task.description || task.sourceText || meetingCreateTranscript.trim() || "来自手机端新建会议。",
        meetingId,
        sourceMeetingId: meetingId,
        sourceText: task.sourceText || meetingCreateTranscript.trim() || content,
        ownerId,
        owner: ownerId,
        reviewerId: task.reviewerId || defaultMeetingTaskReviewerId(ownerId),
        departmentId: task.departmentId || userDirectory.find((user) => user.id === ownerId)?.departmentId || effectiveMeetingDepartmentId,
        collaboratorDepartmentIds: task.collaboratorDepartmentIds || [],
        dueDate: task.dueDate || meetingCreateTaskDueDate,
        startDate: task.startDate || dateKeyFromDateTime(meetingCreateStartTime),
        goal: task.goal || "",
        companySupportRequest: task.companySupportRequest || "",
        priority: task.priority || "中",
        status: "not_started" as const,
        approvalStatus: "pending_president_approval" as const,
        createdAt: task.createdAt || createdAt,
        updatedAt: createdAt
      };
    });
    const meeting: Meeting = {
      id: meetingId,
      title,
      departmentId: effectiveMeetingDepartmentId,
      type: meetingCreateType,
      hostId: effectiveMeetingHostId,
      participantIds: meetingParticipantIds,
      participantCount: meetingParticipantIds.length,
      startTime: meetingCreateStartTime.replace("T", " "),
      endTime: meetingCreateEndTime.replace("T", " "),
      durationMinutes,
      totalManHours: Number(((Math.max(meetingParticipantIds.length, 1) * durationMinutes) / 60).toFixed(1)),
      rawTranscript: meetingCreateTranscript.trim(),
      transcript: meetingCreateTranscript.trim() || undefined,
      sourceTemplateName: "mobile-manual-meeting",
      sourceTemplateVersion: "V1.0",
      okrProjectId: selectedOkrForMeeting?.id,
      okrProjectName: selectedOkrForMeeting?.name,
      summary: meetingCreateAiSummary || meetingCreateTranscript.trim() || taskContentText(meetingTasks[0]),
      aiSummary: meetingCreateAiSummary || (meetingCreateTranscript.trim() ? `手机端新建会议记录：${meetingCreateTranscript.trim().slice(0, 160)}` : undefined),
      minuteMarkdown: meetingCreateMinuteMarkdown || (meetingCreateTranscript.trim() ? `## 一、会议基础信息\n\n会议主题：${title}\n\n## 二、会议原文\n\n${meetingCreateTranscript.trim()}` : undefined),
      conclusions: meetingCreateDecisions.map((decision) => decision.content),
      decisions: meetingCreateDecisions,
      approvalStatus: "pending_president_approval",
      tasks: meetingTasks,
      createdBy: currentUserId,
      status: "summarized",
      createdAt
    };

    setIsMeetingCreateBusy(true);
    setMeetingCreateMessage("正在提交总裁签批...");
    try {
      const savedMeeting = await onCreateMeeting(meeting);
      setMeetingCreateMessage(`已提交总裁签批：${savedMeeting.title}`);
      setMeetingCreateId(nextMobileId("mobile-manual"));
      setMeetingCreateTitle("");
      setMeetingCreateDepartmentId("");
      setMeetingCreateHostId("");
      setMeetingCreateType("");
      setMeetingCreateOkrProjectId("");
      setMeetingCreateTranscript("");
      setMeetingCreateUploadedFiles([]);
      setMeetingCreateAiSummary("");
      setMeetingCreateMinuteMarkdown("");
      setMeetingCreateDecisions([]);
      setMeetingCreateDraftTasks([]);
      setMeetingCreateTaskContent("");
      setMeetingCreateParticipantIds([]);
      setMeetingCreateParticipantKeyword("");
    } catch (error) {
      setMeetingCreateMessage(error instanceof Error ? error.message : "会议提交失败。");
    } finally {
      setIsMeetingCreateBusy(false);
    }
  }

  async function handleDeleteDictionaryEntry(entry: MeetingDictionaryEntry) {
    setDictionaryBusy(`delete:${entry.id}`);
    setDictionaryMessage("");
    try {
      await onDeleteDictionaryEntry(entry.id);
      setDictionaryMessage(`已删除「${entry.standard}」。`);
    } catch (error) {
      setDictionaryMessage(error instanceof Error ? error.message : "词条删除失败。");
    } finally {
      setDictionaryBusy(undefined);
    }
  }

  async function handleCreateOkrProject() {
    const name = okrCreateName.trim();
    const objective = okrCreateObjective.trim();
    const background = okrCreateBackground.trim() || objective;
    const krCode = okrCreateKrCode.trim() || "KR1";
    const krTitle = okrCreateKrTitle.trim();
    const krMetric = okrCreateKrMetric.trim();
    const krTargetValue = okrCreateKrTargetValue.trim();
    const krCurrentValue = okrCreateKrCurrentValue.trim();
    const taskTitle = okrCreateTaskTitle.trim();
    const taskContent = okrCreateTaskContent.trim();
    const taskDeliverable = okrCreateTaskDeliverable.trim();
    const weight = Number.parseInt(okrCreateKrWeight, 10);
    if (!name || !objective || !krTitle || !krMetric || !krTargetValue || !taskTitle || !taskContent || !taskDeliverable) {
      setOkrCreateMessage("请先补齐项目、KR 和 PDCA 任务的核心字段。");
      return;
    }

    const ownerId = okrProjectOwnerId;
    const ownerName = userName(ownerId, okrUserOptions, currentUser?.name ?? "移动端用户");
    const ownerDepartmentId = currentUser?.departmentId ?? departments[0]?.id ?? "mobile-okr-department";
    const ownerDepartment = departmentName(ownerDepartmentId, departments);
    const krOwnerName = userName(krOwnerId, okrUserOptions, ownerName);
    const krReviewerName = userName(krReviewerId, okrUserOptions, "未设置");
    const taskOwnerName = userName(taskOwnerId, okrUserOptions, ownerName);
    const taskReviewerName = userName(taskReviewerId, okrUserOptions, krReviewerName);
    const krDepartmentId = okrUserOptions.find((user) => user.id === krOwnerId)?.departmentId ?? ownerDepartmentId;
    const krDepartment = departmentName(krDepartmentId, departments);
    const taskDepartmentId = okrUserOptions.find((user) => user.id === taskOwnerId)?.departmentId ?? krDepartmentId;
    const taskDepartment = departmentName(taskDepartmentId, departments);
    const projectId = `okr-mobile-${Date.now()}`;
    const startDate = formatDateInput(new Date());
    const endDate = formatDateInput(addDays(new Date(), 90));
    const taskStartDate = okrCreateTaskStartDate || startDate;
    const taskEndDate = okrCreateTaskEndDate || endDate;
    const collaboratorDepartmentIds = okrCreateCollaboratorDepartmentIds.filter((departmentId) => departmentId !== ownerDepartmentId);
    const collaboratorDepartments = collaboratorDepartmentIds.map((departmentId) => departmentName(departmentId, departments));
    const extraKrTitles = splitInputItems(okrCreateExtraKrLines);
    const extraTaskTitles = splitInputItems(okrCreateExtraTaskLines);

    const krs = [
      {
        code: krCode,
        title: krTitle,
        description: krTitle,
        metric: krMetric,
        targetValue: krTargetValue,
        currentValue: krCurrentValue || "未开始",
        weight: Number.isFinite(weight) ? Math.max(1, Math.min(100, weight)) : 50,
        owner: krOwnerName,
        ownerId: krOwnerId,
        department: krDepartment,
        departmentId: krDepartmentId,
        reviewer: krReviewerName,
        reviewerId: krReviewerId,
        startDate,
        endDate,
        progress: 0,
        status: "未开始" as const,
        riskLevel: "中" as const
      },
      ...extraKrTitles.map((title, index) => ({
        code: `KR${index + 2}`,
        title,
        description: title,
        metric: `完成「${title}」的量化衡量标准。`,
        targetValue: "按期完成",
        currentValue: "未开始",
        weight: 20,
        owner: krOwnerName,
        ownerId: krOwnerId,
        department: krDepartment,
        departmentId: krDepartmentId,
        reviewer: krReviewerName,
        reviewerId: krReviewerId,
        startDate,
        endDate,
        progress: 0,
        status: "未开始" as const,
        riskLevel: "中" as const
      }))
    ].map((kr, index) => ({ ...kr, id: `${projectId}-kr${index + 1}`, projectId }));

    const pdcaTasks = [
      {
        krIndex: 0,
        pdcaStage: okrCreatePdcaStage,
        title: taskTitle,
        content: taskContent,
        owner: taskOwnerName,
        ownerId: taskOwnerId,
        ownerDepartment: taskDepartment,
        ownerDepartmentId: taskDepartmentId,
        reviewer: taskReviewerName,
        reviewerId: taskReviewerId,
        collaboratorDepartments,
        collaboratorDepartmentIds,
        startDate: taskStartDate,
        endDate: taskEndDate,
        deliverable: taskDeliverable,
        status: "未开始" as const,
        riskLevel: "中" as const
      },
      ...extraTaskTitles.map((title, index) => ({
        krIndex: Math.min(index + 1, Math.max(krs.length - 1, 0)),
        pdcaStage: "Do" as const,
        title,
        content: title,
        owner: taskOwnerName,
        ownerId: taskOwnerId,
        ownerDepartment: taskDepartment,
        ownerDepartmentId: taskDepartmentId,
        reviewer: taskReviewerName,
        reviewerId: taskReviewerId,
        collaboratorDepartments,
        collaboratorDepartmentIds,
        startDate: taskStartDate,
        endDate: taskEndDate,
        deliverable: title,
        status: "未开始" as const,
        riskLevel: "中" as const
      }))
    ].map((task, index) => {
      const targetKr = krs[task.krIndex] ?? krs[0];
      return { ...task, id: `${projectId}-pdca${index + 1}`, projectId, krId: targetKr.id };
    });

    const project: OkrProject = {
      id: projectId,
      name,
      category: "公司专项 OKR",
      objective,
      background,
      owner: ownerName,
      ownerId,
      ownerDepartment,
      ownerDepartmentId,
      collaboratorDepartments,
      collaboratorDepartmentIds,
      startDate,
      endDate,
      periodText: `${startDate} - ${endDate}`,
      priority: okrCreatePriority,
      riskLevel: "中",
      status: "待总裁审批",
      progress: 0,
      needPresidentDecisionCount: 1,
      krs,
      pdcaTasks,
      metrics: [{ label: "项目综合进度", base: "未开始", target: "按期完成", current: "待总裁审批", status: "未开始" }],
      relatedMeetings: [],
      relatedTasks: [],
      risks: [],
      supportRequests: []
    };

    setIsOkrCreateBusy(true);
    setOkrCreateMessage("");
    try {
      await onCreateOkrProject(project);
      setOkrFilter("projects");
      setSelectedOkrProjectId(projectId);
      setIsOkrCreateOpen(false);
      setOkrCreateName("新建 OKR 项目");
      setOkrCreateObjective("填写本项目要达成的核心业务目标。");
      setOkrCreateBackground("说明项目背景、为什么现在要推进。");
      setOkrCreatePriority("中");
      setOkrCreateKrTitle("建立关键结果");
      setOkrCreateKrCode("KR1");
      setOkrCreateKrMetric("说明这个 KR 如何判断完成。");
      setOkrCreateKrTargetValue("按期完成");
      setOkrCreateKrCurrentValue("未开始");
      setOkrCreateKrWeight("50");
      setOkrCreateKrOwnerId("");
      setOkrCreateKrReviewerId("");
      setOkrCreateTaskTitle("梳理推进任务");
      setOkrCreatePdcaStage("Plan");
      setOkrCreateTaskContent("填写任务内容。");
      setOkrCreateTaskStartDate(formatDateInput(new Date()));
      setOkrCreateTaskEndDate(formatDateInput(addDays(new Date(), 14)));
      setOkrCreateTaskDeliverable("输出成果");
      setOkrCreateTaskOwnerId("");
      setOkrCreateTaskReviewerId("");
      setOkrCreateCollaboratorDepartmentIds([]);
      setOkrCreateExtraKrLines("");
      setOkrCreateExtraTaskLines("");
      setOkrCreateMessage("OKR 项目已新建。");
    } catch (error) {
      setOkrCreateMessage(error instanceof Error ? error.message : "OKR 项目保存失败。");
    } finally {
      setIsOkrCreateBusy(false);
    }
  }

  return (
    <div className={styles.content}>
      <AppHeader
        title={pageTitle(activePage)}
        right={
          <button className={styles.textIconButton} type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回
          </button>
        }
      />
      <div className={styles.sectionPad}>
        <section className={styles.backendSwitchGrid} aria-label="后台功能切换">
          {entries.map((entry) => (
            <button
              className={`${styles.backendSwitchButton} ${activePage === entry.id ? styles.backendSwitchButtonActive : ""}`}
              type="button"
              key={entry.id}
              onClick={() => onChangePage(entry.id)}
            >
              {entry.title}
            </button>
          ))}
        </section>

        {activePage === "new-meeting" ? (
          <section className={styles.detailList}>
            <section className={`${styles.card} ${styles.mobileFormCard}`}>
              <div className={styles.mobileFormSubsection}>
                <div className={styles.mobileFormSubhead}>
                  <CalendarDays size={16} aria-hidden="true" />
                  <span>1. 会议基础信息</span>
                </div>
                <label className={styles.mobileField}>
                  <span>会议主题</span>
                  <input value={meetingCreateTitle} onChange={(event) => setMeetingCreateTitle(event.target.value)} placeholder="输入会议主题" />
                </label>
                <div className={styles.mobileField}>
                  <span>所属部门</span>
                  <MobileSearchableSelect value={effectiveMeetingDepartmentId} onChange={(value) => { setMeetingCreateDepartmentId(value); clearMeetingGeneratedDraft(); }} options={departmentOptions} placeholder="输入部门名称或组织路径" />
                </div>
                <div className={styles.mobileField}>
                  <span>会议主持人</span>
                  <MobileSearchableSelect value={effectiveMeetingHostId} onChange={(value) => { setMeetingCreateHostId(value); clearMeetingGeneratedDraft(); }} options={userOptions} placeholder="输入姓名、工号或部门" />
                </div>
                <div className={styles.mobileField}>
                  <span>会议类型</span>
                  <MobileSearchableSelect value={meetingCreateType} onChange={(value) => { setMeetingCreateType(value as MeetingType); clearMeetingGeneratedDraft(); }} options={meetingTypeOptions} placeholder="输入会议类型" />
                </div>
                <div className={styles.mobileField}>
                  <span>关联 OKR 项目</span>
                  <MobileSearchableSelect value={meetingCreateOkrProjectId} onChange={(value) => { setMeetingCreateOkrProjectId(value); clearMeetingGeneratedDraft(); }} options={okrMeetingOptions} placeholder="输入 OKR 项目名称" />
                </div>
                <div className={styles.mobileField}>
                  <span>参会人员</span>
                  <div className={styles.mobileParticipantPicker}>
                    <div className={styles.mobileParticipantSearch}>
                      <Search size={16} aria-hidden="true" />
                      <input value={meetingCreateParticipantKeyword} onChange={(event) => setMeetingCreateParticipantKeyword(event.target.value)} placeholder="输入人名或部门，点击候选人加入" />
                    </div>
                    {meetingCreateParticipantKeyword.trim() ? (
                      <div className={styles.mobileParticipantResults}>
                        {participantCandidateUsers.length ? participantCandidateUsers.map((user) => (
                          <button type="button" key={user.id} onClick={() => { addMeetingParticipant(user.id); clearMeetingGeneratedDraft(); }}>
                            <b>{user.name} / {user.title || user.role}</b>
                            <span>{departmentName(user.departmentId, departments)}</span>
                          </button>
                        )) : <div className={styles.mobileSearchSelectEmpty}>没有可加入的匹配人员</div>}
                      </div>
                    ) : null}
                    <div className={styles.mobileParticipantSelected}>
                      <span>已加入参会人员</span>
                      {meetingParticipantUsers.length ? (
                        <div className={styles.mobileParticipantChips}>
                          {meetingParticipantUsers.map((user) => (
                            <span className={styles.mobileParticipantChip} key={user.id}>
                              {user.name} / {user.title || user.role}
                              {user.id !== effectiveMeetingHostId ? (
                                <button type="button" aria-label={`移除${user.name}`} onClick={() => { removeMeetingParticipant(user.id); clearMeetingGeneratedDraft(); }}>
                                  <X size={13} aria-hidden="true" />
                                </button>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <small>暂未选择参会人员</small>
                      )}
                    </div>
                  </div>
                </div>
                <p className={styles.mobileHelperText}>主持人会自动计入参会人员。当前参会人数：{meetingParticipantIds.length || 1} 人。</p>
              </div>

              <div className={styles.mobileFormSubsection}>
                <div className={styles.mobileFormSubhead}>
                  <CalendarDays size={16} aria-hidden="true" />
                  <span>2. 时间与文稿</span>
                </div>
                <div className={styles.mobileFieldGrid}>
                  <label className={styles.mobileField}>
                    <span>会议开始时间</span>
                    <MobileDateTimeInput value={meetingCreateStartTime} onChange={(value) => { setMeetingCreateStartTime(value); clearMeetingGeneratedDraft(); }} />
                  </label>
                  <label className={styles.mobileField}>
                    <span>会议结束时间</span>
                    <MobileDateTimeInput value={meetingCreateEndTime} min={meetingCreateStartTime} onChange={(value) => { setMeetingCreateEndTime(value); clearMeetingGeneratedDraft(); }} />
                  </label>
                </div>
                <div className={styles.mobileMeetingStats}>
                  <span>自动计算时长 <b>{computedMeetingDurationMinutes} 分钟</b></span>
                  <span>总参会人工时 <b>{Number(((Math.max(meetingParticipantIds.length, 1) * computedMeetingDurationMinutes) / 60).toFixed(1))} 人工时</b></span>
                </div>
              </div>

              <div className={styles.mobileFormSubsection}>
                <div className={styles.mobileFormSubhead}>
                  <FileText size={16} aria-hidden="true" />
                  <span>3. 会议文稿输入</span>
                </div>
                <div className={styles.mobileDocumentInputGrid}>
                  <div
                    className={styles.mobileFileDrop}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleMeetingFiles(event.dataTransfer.files);
                    }}
                  >
                    <FileText size={28} aria-hidden="true" />
                    <b>上传来源文件</b>
                    <span>可多选 TXT / DOCX，系统会自动读取正文</span>
                    <input
                      ref={meetingFileInputRef}
                      type="file"
                      multiple
                      accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(event) => void handleMeetingFiles(event.target.files ?? undefined)}
                      hidden
                    />
                    <button className={styles.smallButton} type="button" onClick={() => meetingFileInputRef.current?.click()} disabled={isMeetingFileBusy}>
                      {isMeetingFileBusy ? "读取中" : "选择文件"}
                    </button>
                  </div>
                  <label className={styles.mobileField}>
                  <span>会议原文 / 转写稿</span>
                    <textarea
                      value={meetingCreateTranscript}
                      onChange={(event) => {
                        setMeetingCreateTranscript(event.target.value);
                        clearMeetingGeneratedDraft();
                      }}
                      rows={8}
                      placeholder="上传 DOCX/TXT 后会自动读取正文；也可以手动粘贴会议转写稿或会议记录。"
                    />
                  </label>
                </div>
                {meetingCreateUploadedFiles.length ? (
                  <div className={styles.mobileUploadedFileList}>
                    {meetingCreateUploadedFiles.map((file) => (
                      <div className={styles.mobileUploadedFile} key={file.id}>
                        <span>{file.name}</span>
                        <small>{file.status === "read" ? "已读取" : "仅记录文件名"}</small>
                        {file.storageObjectId ? (
                          <button type="button" aria-label={`下载${file.name}`} onClick={() => downloadStorageObject(file.storageObjectId!)}>
                            <Download size={14} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button type="button" aria-label={`删除${file.name}`} onClick={() => removeMeetingFile(file.id)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className={styles.mobileAiGenerateCard}>
                  <div>
                    <b>AI 生成会议闭环模板</b>
                    <p>AI 会分三步处理：先用基础信息和当前文稿生成纪要，再从纪要抽取决策，最后根据纪要与决策生成待办。上传文稿不会覆盖基础信息。</p>
                  </div>
                  <button className={styles.primaryWideButton} type="button" onClick={handleGenerateMeetingDraft} disabled={isMeetingAiBusy || !meetingCreateTranscript.trim()}>
                    <Sparkles size={16} aria-hidden="true" />
                    {isMeetingAiBusy ? "生成中" : "一键生成会议纪要"}
                  </button>
                </div>
                {meetingCreateAiSummary || meetingCreateDraftTasks.length ? (
                  <div className={styles.mobileGeneratedSummary}>
                    <b>已生成草稿</b>
                    <span>{meetingCreateAiSummary || meetingCreateMinuteMarkdown.slice(0, 80) || "已生成会议纪要草稿。"}</span>
                    <small>决策 {meetingCreateDecisions.length} 条 · 待办 {meetingCreateDraftTasks.length} 条</small>
                  </div>
                ) : null}
              </div>

              <div className={styles.mobileFormSubsection}>
                <div className={styles.mobileTaskSectionHeader}>
                  <div className={styles.mobileFormSubhead}>
                    <CheckSquare size={16} aria-hidden="true" />
                    <span>4. 会议待办事项</span>
                  </div>
                </div>
                <p className={styles.mobileHelperText}>主管可修正 AI 待办，也可手动补充未识别的执行事项；提交后进入总裁签批，通过后才进入正式台账。</p>
                <div className={styles.mobileDraftTaskList}>
                  {(meetingCreateDraftTasks.length ? meetingCreateDraftTasks : [buildMeetingDraftTask({ id: `${meetingCreateId}-task-1` })]).map((task, index) => (
                    <article className={`${styles.mobileDraftTaskCard} ${index % 2 ? styles.mobileDraftTaskCardAlt : ""}`} key={task.id}>
                      <div className={styles.mobileDraftTaskHead}>
                        <div className={styles.mobileDraftTaskTitle}>
                          <span className={styles.mobileDraftTaskIndex}>{index + 1}</span>
                          <b>待办事项</b>
                          <small>{task.sourceText === "主管手动补充" ? "手动添加" : "AI 提取"}</small>
                          <small>{departmentName(task.departmentId, departments)}</small>
                        </div>
                        {meetingCreateDraftTasks.length ? (
                          <button className={styles.mobileDraftTaskDelete} type="button" onClick={() => deleteMeetingDraftTask(task.id)}>
                            删除
                          </button>
                        ) : null}
                      </div>

                      <div className={styles.mobileDraftTaskGrid}>
                        <label className={styles.mobileField}>
                          <span>任务内容</span>
                          <textarea
                            value={taskContentText(task)}
                            onChange={(event) => updateMeetingDraftTask(task.id, { content: event.target.value, title: event.target.value })}
                            rows={3}
                            placeholder="填写需要完成的具体任务"
                          />
                        </label>
                        <label className={styles.mobileField}>
                          <span>可量化达成目标</span>
                          <textarea
                            value={task.goal ?? ""}
                            onChange={(event) => updateMeetingDraftTask(task.id, { goal: event.target.value })}
                            rows={3}
                            placeholder="例如：输出 1 份方案，完成 10 家门店覆盖"
                          />
                        </label>
                      </div>

                      <div className={styles.mobileDraftTaskGrid}>
                        <div className={styles.mobileField}>
                          <span>待办推进人</span>
                          <MobileSearchableSelect value={task.ownerId || task.owner || effectiveMeetingTaskOwnerId} onChange={(value) => updateMeetingDraftTaskOwner(task.id, value)} options={userOptions} placeholder="输入推进人姓名或部门" />
                        </div>
                        <div className={styles.mobileField}>
                          <span>待办复核人</span>
                          <MobileSearchableSelect value={task.reviewerId || defaultMeetingTaskReviewerId(task.ownerId || task.owner || effectiveMeetingTaskOwnerId)} onChange={(value) => updateMeetingDraftTask(task.id, { reviewerId: value })} options={userOptions} placeholder="输入复核人姓名或部门" />
                        </div>
                        <div className={styles.mobileField}>
                          <span>责任部门</span>
                          <MobileSearchableSelect value={task.departmentId || effectiveMeetingDepartmentId} onChange={(value) => updateMeetingDraftTaskDepartment(task.id, value)} options={departmentOptions} placeholder="输入责任部门" />
                        </div>
                      </div>

                      <div className={styles.mobileDraftTaskMetaGrid}>
                        <label className={styles.mobileField}>
                          <span>开始日期</span>
                          <input type="date" value={dateInputValue(task.startDate) || dateKeyFromDateTime(meetingCreateStartTime)} onChange={(event) => updateMeetingDraftTask(task.id, { startDate: event.target.value })} />
                        </label>
                        <label className={styles.mobileField}>
                          <span>截止日期</span>
                          <input type="date" value={dateInputValue(task.dueDate) || meetingCreateTaskDueDate} onChange={(event) => updateMeetingDraftTask(task.id, { dueDate: event.target.value })} />
                        </label>
                        <div className={styles.mobileField}>
                          <span>优先级</span>
                          <MobileSearchableSelect value={task.priority || "中"} onChange={(value) => updateMeetingDraftTask(task.id, { priority: value as Priority })} options={taskPriorityOptions.map((priority) => ({ value: priority, label: priority }))} placeholder="优先级" />
                        </div>
                      </div>

                      <label className={styles.mobileField}>
                        <span>需要公司支持</span>
                        <textarea
                          value={task.companySupportRequest ?? ""}
                          onChange={(event) => updateMeetingDraftTask(task.id, { companySupportRequest: event.target.value })}
                          rows={3}
                          placeholder="填写需要公司提供的资源、协同部门、决策支持或其他保障事项"
                        />
                      </label>

                      <div className={styles.mobileDraftTaskTrace}>
                        <span>来源追溯</span>
                        <b>{task.sourceFileName || "当前会议文稿"}</b>
                        {task.sourceDecisionId ? <em>来源决策：{task.sourceDecisionId}</em> : null}
                        <small>{task.sourceTraceLabel || task.sourceText || "主管手动补充"}</small>
                      </div>
                    </article>
                  ))}
                </div>
                <button className={styles.mobileAddTaskButton} type="button" onClick={addMeetingDraftTask}>
                  <Plus size={15} aria-hidden="true" />
                  手动添加待办
                </button>
              </div>

              {meetingCreateMessage ? <p className={styles.formMessage}>{meetingCreateMessage}</p> : null}
              <button className={styles.primaryWideButton} type="button" onClick={handleCreateMeeting} disabled={isMeetingCreateBusy}>
                {isMeetingCreateBusy ? "提交中" : "提交总裁签批"}
              </button>
            </section>
          </section>
        ) : null}

        {activePage === "management-dashboard" ? (
          <section className={styles.dashboardChartList} aria-label="管理驾驶舱图表">
            <article className={`${styles.card} ${styles.dashboardChartCard}`}>
              <div className={styles.dashboardChartHeader}>
                <h2 className={styles.sectionTitle}>公司会议投入图</h2>
                <BarChart3 size={18} aria-hidden="true" />
              </div>
              <div className={styles.meetingInvestmentChart}>
                <div className={styles.chartDonut} style={chartStyle(meetingInvestmentRate, "#2f66f0")}>
                  <div className={styles.chartDonutCenter}>
                    <strong>{settledMeetingCount}场</strong>
                    <span>已沉淀会议</span>
                  </div>
                </div>
                <span className={styles.chartFootnote}>{settledMeetingCount}/{Math.max(totalMeetingCount, 0)}</span>
                <div className={styles.investmentBars}>
                  <div className={styles.investmentBarRow}>
                    <div className={styles.chartRowTop}><span>会议总数</span><b>{totalMeetingCount} 场</b></div>
                    <div className={styles.investmentBarTrack}><span className={styles.investmentBarFill} style={chartStyle(totalMeetingCount > 0 ? 100 : 0, "#2f66f0")} /></div>
                  </div>
                  <div className={styles.investmentBarRow}>
                    <div className={styles.chartRowTop}><span>会议总时长</span><b>{totalDurationMinutes} 分钟</b></div>
                    <div className={styles.investmentBarTrack}><span className={styles.investmentBarFill} style={chartStyle(totalDurationMinutes > 0 ? 100 : 0, "#7367f0")} /></div>
                  </div>
                  <div className={styles.investmentBarRow}>
                    <div className={styles.chartRowTop}><span>会议人工时</span><b>{formatDecimal(totalManHours)} 人工时</b></div>
                    <div className={styles.investmentBarTrack}><span className={styles.investmentBarFill} style={chartStyle(totalManHours > 0 ? 100 : 0, "#11b5c8")} /></div>
                  </div>
                  <div className={styles.investmentBarRow}>
                    <div className={styles.chartRowTop}><span>形成待办</span><b>{formedTodoCount} 项</b></div>
                    <div className={styles.investmentBarTrack}><span className={styles.investmentBarFill} style={chartStyle(formedTodoCount > 0 ? 100 : 0, "#425066")} /></div>
                  </div>
                </div>
              </div>
            </article>

            <article className={`${styles.card} ${styles.dashboardChartCard}`}>
              <div className={styles.dashboardChartHeader}>
                <h2 className={styles.sectionTitle}>待办执行情况</h2>
                <CheckSquare size={18} aria-hidden="true" />
              </div>
              <div className={styles.todoExecutionChart}>
                <div className={styles.chartDonut} style={chartStyle(completionRate, "#16bd8a")}>
                  <div className={styles.chartDonutCenter}>
                    <strong>{clampPercent(completionRate)}%</strong>
                    <span>完成率</span>
                  </div>
                </div>
                <span className={styles.chartFootnote}>{completedTodoCount}/{Math.max(allTodoCount, 0)}</span>
                <div className={styles.todoStatList}>
                  <div className={styles.todoStatPill}><span>全部待办</span><b>{allTodoCount} 项</b></div>
                  <div className={`${styles.todoStatPill} ${styles.todoStatPillDone}`}><span>已完成</span><b>{completedTodoCount} 项</b></div>
                  <div className={`${styles.todoStatPill} ${styles.todoStatPillWarm}`}><span>按时完成</span><b>{onTimeDoneCount} 项</b></div>
                  <div className={`${styles.todoStatPill} ${styles.todoStatPillRisk}`}><span>延期/逾期</span><b>{overdueTodoCount} 项</b></div>
                </div>
              </div>
            </article>
          </section>
        ) : null}

        {activePage === "meeting-board" ? (
          <section className={styles.detailList}>
            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>会议行为看板</h2>
              <Tag tone="navy">{activeMeetingBoardDetail.rows.length}</Tag>
            </div>
            {meetingBoard ? (
              <section className={styles.boardMetricGrid} aria-label="会议行为指标">
                <MetricFilterButton active={meetingBoardFilter === "all"} label="会议总数" value={meetingBoard.summary.totalMeetings} onClick={() => setMeetingBoardFilter("all")} />
                <MetricFilterButton active={meetingBoardFilter === "mobile"} label="移动录音" value={meetingBoard.summary.mobileRecordings} onClick={() => setMeetingBoardFilter("mobile")} />
                <MetricFilterButton active={meetingBoardFilter === "needsMinutes"} label="待生成纪要" value={meetingBoard.summary.needsMinutes} onClick={() => setMeetingBoardFilter("needsMinutes")} />
                <MetricFilterButton active={meetingBoardFilter === "closed"} label="已闭环" value={meetingBoard.summary.closed} onClick={() => setMeetingBoardFilter("closed")} />
              </section>
            ) : null}
            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>{activeMeetingBoardDetail.title}</h2>
              <Tag tone="navy">{activeMeetingBoardDetail.rows.length}</Tag>
            </div>
            {activeMeetingBoardDetail.rows.length ? activeMeetingBoardDetail.rows.slice(0, 30).map((row) => {
              const status = boardStatusLabel(row.boardStatus);
              return (
                <button className={styles.backendListCard} type="button" key={row.meetingId} onClick={() => onOpenMeeting(row.meetingId)}>
                  <div className={styles.backendListHead}>
                    <h3 className={styles.cardTitle}>{row.title}</h3>
                    <Tag tone={status.tone}>{status.label}</Tag>
                  </div>
                  <p className={styles.smallText}>{formatDateTime(row.startTime)} · {row.hostName} · {row.departmentName}</p>
                  <div className={styles.backendMetaLine}>
                    <span>{sourceTypeLabel(row.sourceType)}</span>
                    <span>{row.decisionCount} 决策</span>
                    <span>{row.totalTaskCount} 待办</span>
                  </div>
                </button>
              );
            }) : <div className={`${styles.card} ${styles.emptyCard}`}>{activeMeetingBoardDetail.empty}</div>}
          </section>
        ) : null}

        {activePage === "meeting-list" ? (
          <section className={styles.detailList}>
            <section className={styles.boardMetricGrid} aria-label="会议列表筛选指标">
              <MetricFilterButton active={meetingFilter === "all"} label="监督对象" value={`${meetingRows.length} 个`} hint="全部会议" onClick={() => setMeetingFilter("all")} />
              <MetricFilterButton active={meetingFilter === "uploaded"} label="会议上传" value={`${uploadedMeetingRows.length} 次`} hint="已沉淀" onClick={() => setMeetingFilter("uploaded")} />
              <MetricFilterButton active={meetingFilter === "duration"} label="会议总时长" value={`${totalDurationMinutes} 分钟`} hint="按时长排序" onClick={() => setMeetingFilter("duration")} />
              <MetricFilterButton active={meetingFilter === "todos"} label="待办推进" value={`${totalMeetingTodoCount} 项`} hint="有待办会议" onClick={() => setMeetingFilter("todos")} />
            </section>
            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>{activeMeetingDetail.title}</h2>
              <Tag tone="navy">{activeMeetingDetail.rows.length}</Tag>
            </div>
            {activeMeetingDetail.rows.length ? activeMeetingDetail.rows.slice(0, 30).map(({ meeting, taskCount }) => {
              const status = meetingStatus(meeting);
              return (
                <article
                  className={styles.backendListCard}
                  key={meeting.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenMeeting(meeting.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onOpenMeeting(meeting.id);
                  }}
                >
                  <div className={styles.backendListRow}>
                    <div className={styles.backendCardIcon}><CalendarDays size={18} aria-hidden="true" /></div>
                    <div className={styles.backendListMain}>
                      <div className={styles.backendListHead}>
                        <h3 className={styles.cardTitle}>{meeting.title}</h3>
                        <Tag tone={status.tone}>{status.label}</Tag>
                      </div>
                      <p className={styles.smallText}>{formatDateTime(meeting.startTime || meeting.createdAt)} · {departmentName(meeting.departmentId, departments)} · {meeting.durationMinutes || 0} 分钟</p>
                      <div className={styles.backendMetaLine}>
                        <span>{isUploadedMeeting(meeting) ? "已上传/录音" : "未上传录音"}</span>
                        <span>{taskCount} 项待办</span>
                      </div>
                      <button
                        className={styles.inlineDetailButton}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          downloadStorageObjectsByOwner("meeting", meeting.id);
                        }}
                      >
                        <Download size={14} aria-hidden="true" />
                        下载会议文件
                      </button>
                    </div>
                  </div>
                </article>
              );
            }) : <div className={`${styles.card} ${styles.emptyCard}`}>{activeMeetingDetail.empty}</div>}
          </section>
        ) : null}

        {activePage === "departments" ? (
          <section className={styles.detailList}>
            <section className={styles.boardMetricGrid} aria-label="部门看板筛选指标">
              <MetricFilterButton active={departmentFilter === "meetings"} label="部门会议" value={`${departmentRows.reduce((sum, row) => sum + row.meetingCount, 0)} 场`} hint="按会议数" onClick={() => { setDepartmentFilter("meetings"); setSelectedDepartmentId(undefined); }} />
              <MetricFilterButton active={departmentFilter === "tasks"} label="部门待办" value={`${departmentTaskCount} 项`} hint="按待办数" onClick={() => { setDepartmentFilter("tasks"); setSelectedDepartmentId(undefined); }} />
              <MetricFilterButton active={departmentFilter === "completion"} label="完成率" value={formatPercent(departmentCompletionRate)} hint="按完成率" onClick={() => { setDepartmentFilter("completion"); setSelectedDepartmentId(undefined); }} />
              <MetricFilterButton active={departmentFilter === "overdue"} label="逾期风险" value={`${departmentOverdueCount} 项`} hint="只看风险" onClick={() => { setDepartmentFilter("overdue"); setSelectedDepartmentId(undefined); }} />
            </section>
            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>{activeDepartmentDetail.title}</h2>
              <Tag tone="navy">{activeDepartmentDetail.rows.length}</Tag>
            </div>
            {activeDepartmentDetail.rows.length ? activeDepartmentDetail.rows.map((row) => (
              <button
                className={`${styles.backendListCard} ${selectedDepartmentId === row.id ? styles.focusCard : ""}`}
                type="button"
                key={row.id}
                onClick={() => setSelectedDepartmentId(row.id)}
              >
                <div className={styles.backendListRow}>
                  <div className={styles.backendCardIcon}><Building2 size={18} aria-hidden="true" /></div>
                  <div className={styles.backendListMain}>
                    <div className={styles.backendListHead}>
                      <h3 className={styles.cardTitle}>{row.name}</h3>
                      <Tag tone={row.overdueTaskCount ? "risk" : row.activeTaskCount ? "wait" : "success"}>{row.overdueTaskCount ? "有风险" : row.activeTaskCount ? "推进中" : "稳定"}</Tag>
                    </div>
                    <p className={styles.smallText}>{row.meetingCount} 场会议 · {row.taskCount} 个待办 · 完成率 {formatPercent(row.completionRate)}</p>
                    <div className={styles.backendMetaLine}>
                      <span>进行中 {row.activeTaskCount}</span>
                      <span>已完成 {row.doneTaskCount}</span>
                      <span>逾期 {row.overdueTaskCount}</span>
                    </div>
                  </div>
                </div>
              </button>
            )) : <div className={`${styles.card} ${styles.emptyCard}`}>{activeDepartmentDetail.empty}</div>}
            {selectedDepartment ? (
              <section className={`${styles.card} ${styles.mobileInfoCard}`}>
                <div>
                  <h2 className={styles.sectionTitle}>{selectedDepartment.name}</h2>
                  <p className={styles.smallText}>{selectedDepartment.meetingCount} 场会议 · {selectedDepartment.taskCount} 个待办 · 完成率 {formatPercent(selectedDepartment.completionRate)}</p>
                  <div className={styles.backendMetaLine}>
                    <span>进行中 {selectedDepartment.activeTaskCount}</span>
                    <span>已完成 {selectedDepartment.doneTaskCount}</span>
                    <span>逾期 {selectedDepartment.overdueTaskCount}</span>
                  </div>
                  {selectedDepartment.meetings.slice(0, 3).map((meeting) => (
                    <button className={styles.inlineDetailButton} type="button" key={meeting.id} onClick={() => onOpenMeeting(meeting.id)}>
                      {meeting.title}
                    </button>
                  ))}
                  {selectedDepartment.tasks.slice(0, 5).map((task) => (
                    <button className={styles.inlineDetailButton} type="button" key={task.id} onClick={() => onOpenTask(task.id)}>
                      待办：{task.title}
                    </button>
                  ))}
                </div>
                <Tag tone={selectedDepartment.overdueTaskCount ? "risk" : "navy"}>部门详情</Tag>
              </section>
            ) : null}
          </section>
        ) : null}

        {activePage === "okr-projects" ? (
          <section className={styles.detailList}>
            <div className={`${styles.card} ${styles.mobileInfoCard}`}>
              <div>
                <h2 className={styles.sectionTitle}>OKR 项目总览</h2>
                <p className={styles.smallText}>点击指标卡切换下方明细，口径与电脑端 OKR 项目页一致。</p>
              </div>
              <Tag tone="navy">{okrProjects.length} 个项目</Tag>
            </div>
            <section className={styles.overflowMetricScroller} aria-label="OKR 项目筛选指标">
              <MetricFilterButton active={okrFilter === "projects"} label="OKR 项目数" value={`${okrPortfolio.projectCount} 个`} onClick={() => { setOkrFilter("projects"); setSelectedOkrProjectId(undefined); }} />
              <MetricFilterButton active={okrFilter === "krs"} label="KR 总数" value={`${okrPortfolio.krCount} 个`} onClick={() => { setOkrFilter("krs"); setSelectedOkrProjectId(undefined); }} />
              <MetricFilterButton active={okrFilter === "pdca"} label="PDCA 任务数" value={`${okrPortfolio.pdcaCount} 项`} onClick={() => { setOkrFilter("pdca"); setSelectedOkrProjectId(undefined); }} />
              <MetricFilterButton active={okrFilter === "running"} label="进行中项目数" value={`${okrPortfolio.runningCount} 个`} onClick={() => { setOkrFilter("running"); setSelectedOkrProjectId(undefined); }} />
              <MetricFilterButton active={okrFilter === "highRisk"} label="高风险项目数" value={`${okrPortfolio.highRiskCount} 个`} onClick={() => { setOkrFilter("highRisk"); setSelectedOkrProjectId(undefined); }} />
              <MetricFilterButton active={okrFilter === "delayedBlocked"} label="延期 / 阻塞任务数" value={`${okrPortfolio.delayedBlockedCount} 项`} onClick={() => { setOkrFilter("delayedBlocked"); setSelectedOkrProjectId(undefined); }} />
              <MetricFilterButton active={okrFilter === "president"} label="总裁关注事项数" value={`${okrPortfolio.presidentAttentionCount} 项`} onClick={() => { setOkrFilter("president"); setSelectedOkrProjectId(undefined); }} />
              <button className={`${styles.boardMetric} ${styles.metricFilterButton} ${styles.okrCreateMetricButton}`} type="button" onClick={() => setIsOkrCreateOpen((open) => !open)}>
                <p className={styles.metricLabel}>新建 OKR 项目</p>
                <p className={styles.metricValue}><Plus size={20} aria-hidden="true" /> 新建</p>
                <span className={styles.metricHint}>创建项目</span>
              </button>
            </section>
            {okrCreateMessage ? <p className={styles.formMessage}>{okrCreateMessage}</p> : null}
            {isOkrCreateOpen ? (
              <section className={`${styles.card} ${styles.mobileFormCard}`}>
                <h2 className={styles.sectionTitle}>新建 OKR 项目</h2>
                <div className={styles.mobileFormSubsection}>
                  <div className={styles.mobileFormSubhead}>
                    <Target size={16} aria-hidden="true" />
                    <span>1. 项目基础信息</span>
                  </div>
                  <label className={styles.mobileField}>
                    <span>OKR 项目名称</span>
                    <input value={okrCreateName} onChange={(event) => setOkrCreateName(event.target.value)} placeholder="例如：门店交付效率提升" />
                  </label>
                  <label className={styles.mobileField}>
                    <span>项目总目标 O</span>
                    <textarea value={okrCreateObjective} onChange={(event) => setOkrCreateObjective(event.target.value)} rows={3} placeholder="填写本项目要达成的核心目标" />
                  </label>
                  <label className={styles.mobileField}>
                    <span>项目背景</span>
                    <textarea value={okrCreateBackground} onChange={(event) => setOkrCreateBackground(event.target.value)} rows={2} placeholder="说明为什么要建立这个 OKR 项目" />
                  </label>
                  <label className={styles.mobileField}>
                    <span>优先级</span>
                    <select value={okrCreatePriority} onChange={(event) => setOkrCreatePriority(event.target.value as "高" | "中" | "低")}>
                      {["高", "中", "低"].map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className={styles.mobileField}>
                    <span>协同部门</span>
                    <select multiple value={okrCreateCollaboratorDepartmentIds} onChange={(event) => setOkrCreateCollaboratorDepartmentIds(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}>
                      {departments.filter((department) => department.id !== currentUser?.departmentId).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </label>
                  <p className={styles.mobileHelperText}>项目负责人默认使用当前登录账号：{userName(okrProjectOwnerId, okrUserOptions, currentUser?.name ?? "移动端用户")} / {departmentName(currentUser?.departmentId, departments)}</p>
                </div>

                <div className={styles.mobileFormSubsection}>
                  <div className={styles.mobileFormSubhead}>
                    <Target size={16} aria-hidden="true" />
                    <span>2. KR 添加区</span>
                  </div>
                  <div className={styles.mobileFieldGrid}>
                    <label className={styles.mobileField}>
                      <span>KR 编号</span>
                      <input value={okrCreateKrCode} onChange={(event) => setOkrCreateKrCode(event.target.value)} />
                    </label>
                    <label className={styles.mobileField}>
                      <span>权重</span>
                      <input value={okrCreateKrWeight} onChange={(event) => setOkrCreateKrWeight(event.target.value)} inputMode="numeric" />
                    </label>
                  </div>
                  <label className={styles.mobileField}>
                    <span>KR 名称</span>
                    <input value={okrCreateKrTitle} onChange={(event) => setOkrCreateKrTitle(event.target.value)} placeholder="例如：建立跨部门交付标准" />
                  </label>
                  <label className={styles.mobileField}>
                    <span>量化衡量标准</span>
                    <textarea value={okrCreateKrMetric} onChange={(event) => setOkrCreateKrMetric(event.target.value)} rows={2} placeholder="说明这个 KR 怎么判断完成" />
                  </label>
                  <div className={styles.mobileFieldGrid}>
                    <label className={styles.mobileField}>
                      <span>目标值</span>
                      <input value={okrCreateKrTargetValue} onChange={(event) => setOkrCreateKrTargetValue(event.target.value)} />
                    </label>
                    <label className={styles.mobileField}>
                      <span>当前值</span>
                      <input value={okrCreateKrCurrentValue} onChange={(event) => setOkrCreateKrCurrentValue(event.target.value)} />
                    </label>
                  </div>
                  <label className={styles.mobileField}>
                    <span>KR 推进人</span>
                    <select value={krOwnerId} onChange={(event) => setOkrCreateKrOwnerId(event.target.value)}>
                      {okrUserOptions.map((user) => <option key={user.id} value={user.id}>{user.name} / {departmentName(user.departmentId, departments)}</option>)}
                    </select>
                  </label>
                  <label className={styles.mobileField}>
                    <span>KR 复核人</span>
                    <select value={krReviewerId} onChange={(event) => setOkrCreateKrReviewerId(event.target.value)}>
                      {okrUserOptions.map((user) => <option key={user.id} value={user.id}>{user.name} / {user.role}</option>)}
                    </select>
                  </label>
                  <label className={styles.mobileField}>
                    <span>更多 KR（每行一个）</span>
                    <textarea value={okrCreateExtraKrLines} onChange={(event) => setOkrCreateExtraKrLines(event.target.value)} rows={3} placeholder="可继续填写 KR2、KR3，每行一个" />
                  </label>
                  <p className={styles.mobileHelperText}>当前归档状态：未开始。推进人提交完成后，复核人确认前不会计入已完成 KR。</p>
                </div>

                <div className={styles.mobileFormSubsection}>
                  <div className={styles.mobileFormSubhead}>
                    <CheckSquare size={16} aria-hidden="true" />
                    <span>3. PDCA 任务添加区</span>
                  </div>
                  <label className={styles.mobileField}>
                    <span>所属 KR</span>
                    <input value={`${okrCreateKrCode || "KR1"} ${okrCreateKrTitle}`} disabled />
                  </label>
                  <div className={styles.mobileFieldGrid}>
                    <label className={styles.mobileField}>
                      <span>PDCA 阶段</span>
                      <select value={okrCreatePdcaStage} onChange={(event) => setOkrCreatePdcaStage(event.target.value as OkrPdcaStage)}>
                        {["Plan", "Do", "Check", "Act"].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className={styles.mobileField}>
                      <span>任务名称</span>
                      <input value={okrCreateTaskTitle} onChange={(event) => setOkrCreateTaskTitle(event.target.value)} placeholder="例如：梳理交付卡点" />
                    </label>
                  </div>
                  <label className={styles.mobileField}>
                    <span>任务内容</span>
                    <textarea value={okrCreateTaskContent} onChange={(event) => setOkrCreateTaskContent(event.target.value)} rows={2} placeholder="填写任务内容" />
                  </label>
                  <div className={styles.mobileFieldGrid}>
                    <label className={styles.mobileField}>
                      <span>计划开始</span>
                      <input value={okrCreateTaskStartDate} onChange={(event) => setOkrCreateTaskStartDate(event.target.value)} type="date" />
                    </label>
                    <label className={styles.mobileField}>
                      <span>计划结束</span>
                      <input value={okrCreateTaskEndDate} onChange={(event) => setOkrCreateTaskEndDate(event.target.value)} type="date" />
                    </label>
                  </div>
                  <label className={styles.mobileField}>
                    <span>输出成果</span>
                    <input value={okrCreateTaskDeliverable} onChange={(event) => setOkrCreateTaskDeliverable(event.target.value)} />
                  </label>
                  <label className={styles.mobileField}>
                    <span>推进人</span>
                    <select value={taskOwnerId} onChange={(event) => setOkrCreateTaskOwnerId(event.target.value)}>
                      {okrUserOptions.map((user) => <option key={user.id} value={user.id}>{user.name} / {departmentName(user.departmentId, departments)}</option>)}
                    </select>
                  </label>
                  <label className={styles.mobileField}>
                    <span>复核人</span>
                    <select value={taskReviewerId} onChange={(event) => setOkrCreateTaskReviewerId(event.target.value)}>
                      {okrUserOptions.map((user) => <option key={user.id} value={user.id}>{user.name} / {user.role}</option>)}
                    </select>
                  </label>
                  <label className={styles.mobileField}>
                    <span>更多 PDCA 任务（每行一个）</span>
                    <textarea value={okrCreateExtraTaskLines} onChange={(event) => setOkrCreateExtraTaskLines(event.target.value)} rows={3} placeholder="可继续填写更多任务，每行一个" />
                  </label>
                  <p className={styles.mobileHelperText}>归属部门自动跟随推进人。推进人提交完成后，由复核人确认才算完成。</p>
                </div>

                <p className={styles.mobileHelperText}>提交后项目状态变为“待总裁审批”，并出现在 OKR 项目总览页。</p>
                <button className={styles.primaryWideButton} type="button" onClick={handleCreateOkrProject} disabled={isOkrCreateBusy}>
                  {isOkrCreateBusy ? "保存中" : "提交总裁审批"}
                </button>
              </section>
            ) : null}
            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>{activeOkrDetail.title}</h2>
              <Tag tone="navy">{activeOkrDetail.items.length}</Tag>
            </div>
            {activeOkrDetail.items.length ? activeOkrDetail.items.slice(0, 30).map((item) => (
              <button
                className={`${styles.backendListCard} ${selectedOkrProjectId === item.projectId ? styles.focusCard : ""}`}
                type="button"
                key={`${okrFilter}-${item.projectId}-${item.title}`}
                onClick={() => setSelectedOkrProjectId(item.projectId)}
              >
                <div className={styles.backendListRow}>
                  <div className={styles.backendCardIcon}><Target size={18} aria-hidden="true" /></div>
                  <div className={styles.backendListMain}>
                    <div className={styles.backendListHead}>
                      <h3 className={styles.cardTitle}>{item.title}</h3>
                      {item.badge ? <Tag tone={item.badge.includes("风险") || item.badge === "高" ? "risk" : "normal"}>{item.badge}</Tag> : null}
                    </div>
                    <p className={styles.smallText}>{item.meta}</p>
                    <p className={styles.smallText}>{item.detail}</p>
                  </div>
                </div>
              </button>
            )) : <div className={`${styles.card} ${styles.emptyCard}`}>{activeOkrDetail.empty}</div>}
            {selectedOkrProject ? (
              <section className={`${styles.card} ${styles.mobileInfoCard}`}>
                <div>
                  <h2 className={styles.sectionTitle}>{selectedOkrProject.name}</h2>
                  <p className={styles.smallText}>{selectedOkrProject.owner} · {selectedOkrProject.ownerDepartment} · 进度 {selectedOkrProject.progress}%</p>
                  <p className={styles.smallText}>O：{selectedOkrProject.objective}</p>
                  <div className={styles.backendMetaLine}>
                    <span>KR {selectedOkrProject.krs.length}</span>
                    <span>PDCA {selectedOkrProject.pdcaTasks.length}</span>
                    <span>风险 {selectedOkrProject.risks.length}</span>
                    <span>总裁关注 {selectedOkrProject.needPresidentDecisionCount}</span>
                  </div>
                  {selectedOkrProject.krs.map((kr) => (
                    <p className={styles.smallText} key={kr.id}>{kr.code}：{kr.title}</p>
                  ))}
                  {selectedOkrProject.pdcaTasks.map((task) => (
                    <button className={styles.inlineDetailButton} type="button" key={task.id} onClick={() => onOpenTask(task.id)}>
                      {task.pdcaStage}：{task.title}
                    </button>
                  ))}
                  <button className={styles.inlineDetailButton} type="button" onClick={onOpenOkrTasks}>查看项目待办</button>
                  <button className={styles.inlineDetailButton} type="button" onClick={() => downloadStorageObjectsByOwner("okr_project", selectedOkrProject.id)}>
                    <Download size={14} aria-hidden="true" />
                    下载项目文件
                  </button>
                </div>
                <Tag tone={selectedOkrProject.riskLevel === "高" ? "risk" : "navy"}>项目详情</Tag>
              </section>
            ) : null}
          </section>
        ) : null}

        {activePage === "dictionary" ? (
          <section className={styles.detailList}>
            <section className={styles.boardMetricGrid} aria-label="会议词典筛选指标">
              <MetricFilterButton active={dictionaryFilter === "all"} label="词条数" value={`${dictionaryEntries.length} 条`} onClick={() => setDictionaryFilter("all")} />
              <MetricFilterButton active={dictionaryFilter === "employee"} label="员工姓名" value={`${dictionaryEmployeeCount} 条`} onClick={() => setDictionaryFilter("employee")} />
              <MetricFilterButton active={dictionaryFilter === "business"} label="业务词" value={`${dictionaryBusinessCount} 条`} onClick={() => setDictionaryFilter("business")} />
              <button className={`${styles.boardMetric} ${styles.metricFilterButton}`} type="button" onClick={handleRefreshDictionary} disabled={dictionaryBusy === "refresh"}>
                <p className={styles.metricLabel}>刷新</p>
                <p className={styles.metricValue}><RefreshCw size={20} aria-hidden="true" /></p>
                <span className={styles.metricHint}>{dictionaryBusy === "refresh" ? "读取中" : "重新读取"}</span>
              </button>
            </section>

            <button className={styles.primaryWideButton} type="button" onClick={() => setIsDictionaryFormOpen((open) => !open)}>
              {isDictionaryFormOpen ? "收起新增词条" : "新增词条"}
            </button>
            {dictionaryMessage ? <p className={styles.formMessage}>{dictionaryMessage}</p> : null}

            {isDictionaryFormOpen ? (
              <section className={`${styles.card} ${styles.mobileFormCard}`}>
                <h2 className={styles.sectionTitle}>新增词条</h2>
                <label className={styles.mobileField}>
                  <span>标准词</span>
                  <input value={dictionaryStandard} onChange={(event) => setDictionaryStandard(event.target.value)} placeholder="例如：拉迷" />
                </label>
                <label className={styles.mobileField}>
                  <span>常见误写 / 谐音</span>
                  <input value={dictionaryVariants} onChange={(event) => setDictionaryVariants(event.target.value)} placeholder="例如：拉米、腊米" />
                </label>
                <label className={styles.mobileField}>
                  <span>词条类型</span>
                  <select value={dictionaryCategory} onChange={(event) => setDictionaryCategory(event.target.value)}>
                    {["业务词", "品牌词", "员工姓名", "部门名称", "系统名"].map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className={styles.mobileField}>
                  <span>说明</span>
                  <textarea value={dictionaryNote} onChange={(event) => setDictionaryNote(event.target.value)} rows={3} placeholder="例如：拉手的拉，迷人的迷" />
                </label>
                <button className={styles.primaryWideButton} type="button" onClick={handleCreateDictionaryEntry} disabled={dictionaryBusy === "save"}>
                  {dictionaryBusy === "save" ? "保存中" : "添加到会议词典"}
                </button>
              </section>
            ) : null}

            <div className={styles.sectionHeaderCompact}>
              <h2 className={styles.sectionTitle}>{activeDictionaryDetail.title}</h2>
              <Tag tone="navy">{activeDictionaryDetail.entries.length}</Tag>
            </div>
            {activeDictionaryDetail.entries.length ? activeDictionaryDetail.entries.slice(0, 50).map((entry) => (
              <article className={styles.backendListCard} key={entry.id}>
                <div className={styles.backendListRow}>
                  <div className={styles.backendCardIcon}><BookOpen size={18} aria-hidden="true" /></div>
                  <div className={styles.backendListMain}>
                    <div className={styles.backendListHead}>
                      <h3 className={styles.cardTitle}>{entry.standard}</h3>
                      <Tag tone="normal">{entry.category}</Tag>
                    </div>
                    <p className={styles.smallText}>{entry.variants}</p>
                    {entry.note ? <p className={styles.smallText}>{entry.note}</p> : null}
                    <button className={styles.inlineDangerButton} type="button" onClick={() => handleDeleteDictionaryEntry(entry)} disabled={dictionaryBusy === `delete:${entry.id}`}>
                      <Trash2 size={14} aria-hidden="true" />
                      {dictionaryBusy === `delete:${entry.id}` ? "删除中" : "删除"}
                    </button>
                  </div>
                </div>
              </article>
            )) : <div className={`${styles.card} ${styles.emptyCard}`}>{activeDictionaryDetail.empty}</div>}
          </section>
        ) : null}
      </div>
    </div>
  );
}
