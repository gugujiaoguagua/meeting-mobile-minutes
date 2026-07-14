import { readFile } from "node:fs/promises";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { departments, users } from "@/lib/orgPeopleData";
import { canonicalizeMeetingLoopState } from "@/lib/canonicalUsers";
import { isDbStateReadEnabled } from "@/lib/db";
import { readDbState } from "@/lib/dbStateStore";
import { readLocalState } from "@/lib/localStateStore";
import type { ApprovalStatus, Department, MeetingDecision, Priority, Task, TaskStatus, User } from "@/lib/types";

export type AiMeetingDraftRequest = {
  meetingId: string;
  title: string;
  departmentId: string;
  hostId: string;
  transcript: string;
  meetingDate?: string;
  meetingType?: string;
  participantNames?: string[];
  participantIds?: string[];
  participantCount?: number;
  speakerAssignments?: AiMeetingDraftSpeakerAssignment[];
  okrProjectName?: string;
  startTime?: string;
  directoryUsers?: User[];
  directoryDepartments?: Department[];
};

type AiMeetingDraftSpeakerAssignment = {
  speakerLabel: string;
  userId?: string;
  userName: string;
};

export type AiMeetingDraftResponse = {
  aiSummary: string;
  minuteMarkdown: string;
  decisions: MeetingDecision[];
  tasks: Task[];
  provider: "deepseek";
  model: string;
};

type RawMinuteResult = Partial<{
  aiSummary: string;
  minuteMarkdown: string;
}>;

type RawAiDecision = Partial<{
  content: string;
  ownerId: string;
  impactScope: string;
  needPresidentConfirmation: boolean;
  sourceText: string;
}>;

type RawDecisionResult = Partial<{
  decisions: RawAiDecision[];
}>;

type RawAiTask = Partial<{
  title: string;
  content: string;
  description: string;
  ownerId: string;
  departmentId: string;
  reviewerId: string;
  collaboratorDepartmentIds: string[];
  startDate: string;
  dueDate: string;
  goal: string;
  priority: Priority;
  companySupportRequest: string;
  sourceText: string;
  sourceDecisionId: string;
}>;

type RawTaskResult = Partial<{
  tasks: RawAiTask[];
}>;

const DEFAULT_KEY_FILE = "D:\\我的应用\\claude安装测试\\claude一键安装\\deepseek密钥.txt";
const MEETING_MINUTE_TEMPLATE_FILE = "会议闭环系统会议纪要模板.md";
const DEFAULT_ANTHROPIC_URL = "https://api.deepseek.com/anthropic/v1/messages";
const DEFAULT_OPENAI_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_OPENAI_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 60000;
let proxyAgent: ProxyAgent | undefined;
let proxyAgentUrl = "";

type DeepSeekConfig = {
  apiKey: string;
  openAiUrl: string;
};

type MeetingContext = {
  departmentName: string;
  hostName: string;
  participantNames: string[];
  meetingType: string;
  okrProjectName: string;
  meetingDate: string;
  speakerAssignmentText: string;
  candidateUserOptions: string;
  candidateDepartmentOptions: string;
  templateGuide: string;
  sourcePhrases: string[];
};

type CandidateUser = {
  id: string;
  name: string;
  title: string;
};

export class MeetingDraftValidationError extends Error {
  status = 422;

  constructor(message: string) {
    super(message);
    this.name = "MeetingDraftValidationError";
  }
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function toChatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
}

function getProxyAgent(proxyUrl: string) {
  if (!proxyAgent || proxyAgentUrl !== proxyUrl) {
    proxyAgent = new ProxyAgent(proxyUrl);
    proxyAgentUrl = proxyUrl;
  }
  return proxyAgent;
}

async function deepSeekFetch(url: string, init: RequestInit) {
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const requestInit = {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs)
  };
  const proxyUrl = process.env.DEEPSEEK_PROXY_URL?.trim();
  if (!proxyUrl) return fetch(url, requestInit);
  return undiciFetch(url, { ...(requestInit as object), dispatcher: getProxyAgent(proxyUrl) });
}

function extractDeepSeekConfig(raw: string): DeepSeekConfig {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const baseUrl = lines.map((line) => line.match(/https?:\/\/\S+/i)?.[0]).find(Boolean);
  const envBaseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  const openAiUrl = process.env.DEEPSEEK_OPENAI_URL || (envBaseUrl ? toChatCompletionsUrl(envBaseUrl) : baseUrl ? toChatCompletionsUrl(baseUrl) : DEFAULT_OPENAI_URL);

  const explicitKey = lines
    .map((line) => line.match(/sk-[A-Za-z0-9_-]{20,}/)?.[0])
    .find(Boolean);
  if (explicitKey) return { apiKey: explicitKey, openAiUrl };

  for (const line of lines) {
    if (/https?:\/\//i.test(line) || /^api[:：]/i.test(line)) continue;
    const value = line.includes("=") ? line.split("=").slice(1).join("=").trim() : line;
    const cleaned = value.replace(/^['"]|['"]$/g, "").trim();
    if (cleaned.length > 20) return { apiKey: cleaned, openAiUrl };
  }
  return { apiKey: "", openAiUrl };
}

async function readDeepSeekConfig(): Promise<DeepSeekConfig> {
  const keyFile = process.env.DEEPSEEK_API_KEY_FILE || DEFAULT_KEY_FILE;
  try {
    const raw = await readFile(keyFile, "utf8");
    const config = extractDeepSeekConfig(raw);
    if (config.apiKey) return config;
  } catch {
    // Fall back to environment variables when the local test key file is absent.
  }

  const envApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!envApiKey) throw new Error("DeepSeek API key is empty");
  const envBaseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  return {
    apiKey: envApiKey,
    openAiUrl: process.env.DEEPSEEK_OPENAI_URL || (envBaseUrl ? toChatCompletionsUrl(envBaseUrl) : DEFAULT_OPENAI_URL)
  };
}

async function readMeetingMinuteTemplate() {
  try {
    return await readFile(`${process.cwd()}\\${MEETING_MINUTE_TEMPLATE_FILE}`, "utf8");
  } catch {
    return [
      "# 简化版智能会议纪要模板 V1.0",
      "## 一、会议基础信息",
      "## 二、会议摘要",
      "## 三、会议主要讨论点",
      "## 四、会议形成的决策",
      "## 五、会议待办事项",
      "## 六、检索标签"
    ].join("\n");
  }
}

function compactTemplateGuide(template: string) {
  const allowedLines = template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^#\s/.test(line)) return false;
      if (/使用原则|本模板|占位|示例|---/.test(line)) return false;
      return /^##\s/.test(line) || /^\|/.test(line);
    })
    .slice(0, 42);

  return [
    "模板只提供以下结构和字段名，不能复制模板标题、说明或占位内容：",
    ...allowedLines,
    "正式输出第一行必须是当前会议标题，不得出现“简化版智能会议纪要模板”或“使用原则”。"
  ].join("\n");
}

function normalizeForMatch(value: string) {
  return value.replace(/\s+/g, "").replace(/[，。、“”‘’：:；;,.!?！？|#>\-—_]/g, "");
}

function uniqueBigrams(value: string) {
  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

function hasConservativeTextOverlap(supportText: string, candidateText: string) {
  const support = normalizeForMatch(supportText);
  const candidate = normalizeForMatch(candidateText);
  if (!candidate) return false;
  if (candidate.length <= 8) return support.includes(candidate);
  if (support.includes(candidate) || support.includes(candidate.slice(0, Math.min(12, candidate.length)))) return true;

  const supportBigrams = uniqueBigrams(support);
  const candidateBigrams = uniqueBigrams(candidate);
  const overlapCount = [...candidateBigrams].filter((gram) => supportBigrams.has(gram)).length;
  return overlapCount >= 4 && overlapCount / candidateBigrams.size >= 0.5;
}

export function isMeetingDraftEvidenceSupported(input: { supportText: string; content: string; sourceText?: string }) {
  if (!input.supportText.trim()) return true;
  return [input.sourceText, input.content]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => hasConservativeTextOverlap(input.supportText, value));
}

function stripTranscriptScaffolding(transcript: string) {
  return transcript
    .replace(/^【[^】]+】\s*$/gm, "")
    .replace(/已上传会议文稿文件：[^。\n]+。系统(?:暂未读取正文，可以手动补充会议原文|模拟读取文件内容并生成会议闭环模板)。?/g, "")
    .replace(/^\s*[\u4e00-\u9fa5A-Za-z]{1,12}\s+\d{1,2}:\d{2}\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BUSINESS_SIGNAL_TERMS = [
  "讨论",
  "决定",
  "确认",
  "安排",
  "推进",
  "负责",
  "完成",
  "截止",
  "方案",
  "问题",
  "风险",
  "项目",
  "客户",
  "订单",
  "门店",
  "部门",
  "数据",
  "接口",
  "系统",
  "流程",
  "会议",
  "任务",
  "复盘",
  "优化",
  "需求",
  "交付",
  "验收",
  "跟进",
  "支持",
  "签批",
  "目标",
  "OKR"
];

const AUDIO_CHECK_TERMS = ["能听到", "听得到", "听到吗", "声音", "麦克风", "试音", "测试", "喂", "稍等", "好的", "收到"];

const UNSUPPORTED_DOMAIN_TERMS = [
  "Femod",
  "Claude",
  "Claude Code",
  "Angular",
  "SaaS",
  "Git",
  "讯飞",
  "飞书",
  "企业微信",
  "豆包",
  "数据库",
  "云存储",
  "图片资源",
  "项目协同"
];

const MODEL_SELF_REFERENCE_TERMS = ["DeepSeek", "deepseek-chat", "deepseek-reasoner"];

const TRACEABLE_TOPIC_TERMS = Array.from(new Set([...BUSINESS_SIGNAL_TERMS, ...UNSUPPORTED_DOMAIN_TERMS]));
const NO_DECISION_PATTERN = /未形成正式决策|无正式决策/;
const NO_TASK_PATTERN = /未形成可执行待办|无可执行待办/;
const ACTION_SIGNAL_PATTERN = /决定|决策|确认|安排|推进|负责|完成|截止|验收|待办|需要|要实现|要能|先在|测试|推广|自研|交付风险|客户需求|管理驾驶舱|责任人/;

function splitTranscriptClauses(transcript: string) {
  return stripTranscriptScaffolding(transcript)
    .split(/[。！？!?；;\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsBusinessSignal(text: string) {
  return BUSINESS_SIGNAL_TERMS.some((term) => text.includes(term));
}

function isMostlyAudioCheck(text: string) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return true;
  const matchedLength = AUDIO_CHECK_TERMS.reduce((sum, term) => (normalized.includes(normalizeForMatch(term)) ? sum + normalizeForMatch(term).length : sum), 0);
  return matchedLength > 0 && matchedLength / normalized.length >= 0.35;
}

function assertTranscriptCanGenerateMinute(input: AiMeetingDraftRequest) {
  const cleaned = stripTranscriptScaffolding(input.transcript);
  const normalized = normalizeForMatch(cleaned);
  const clauses = splitTranscriptClauses(input.transcript);
  const substantiveClauses = clauses.filter((clause) => normalizeForMatch(clause).length >= 12 && !isMostlyAudioCheck(clause));
  const businessSignals = BUSINESS_SIGNAL_TERMS.filter((term) => cleaned.includes(term));

  if (normalized.length < 40) {
    throw new MeetingDraftValidationError("当前会议原文太短，缺少可生成正式纪要的有效内容。请上传或粘贴完整会议转写稿后再生成。");
  }

  if (normalized.length < 80 && (substantiveClauses.length < 1 || businessSignals.length < 2)) {
    throw new MeetingDraftValidationError("当前会议原文太短，缺少可生成正式纪要的有效内容。请上传或粘贴完整会议转写稿后再生成。");
  }

  if (substantiveClauses.length < 2 && businessSignals.length < 2) {
    throw new MeetingDraftValidationError("当前会议原文主要是试音、寒暄或零散片段，缺少明确议题、讨论、决策或待办。请补充完整会议正文后再生成。");
  }

  if (!containsBusinessSignal(cleaned) && substantiveClauses.length < 4) {
    throw new MeetingDraftValidationError("当前会议原文没有明显的会议议题或业务动作，系统已停止生成，避免编造会议纪要。");
  }
}

function extractSourcePhrases(transcript: string) {
  const cleaned = stripTranscriptScaffolding(transcript);
  const compact = normalizeForMatch(cleaned).slice(0, 5000);
  const phrases = new Set<string>();
  const importantTerms = ["会议闭环", "企业微信", "飞书", "门店", "待办", "总裁", "管理驾驶舱", "会议纪要", "DeepSeek", "客户", "数据", "任务", "决策", "验收", "截止"];
  importantTerms.forEach((term) => {
    if (compact.includes(term)) phrases.add(term);
  });

  splitTranscriptClauses(cleaned).forEach((clause) => {
    const normalized = normalizeForMatch(clause);
    if (phrases.size >= 16) return;
    if (normalized.length < 8 || isMostlyAudioCheck(clause)) return;
    if (containsBusinessSignal(clause) || normalized.length >= 16) phrases.add(normalized.slice(0, Math.min(18, normalized.length)));
  });

  for (let index = 0; index < compact.length && phrases.size < 16; index += 160) {
    const phrase = compact.slice(index, index + 14);
    if (phrase.length >= 10 && !/^\d+$/.test(phrase)) phrases.add(phrase);
  }

  return Array.from(phrases).slice(0, 16);
}

async function buildMeetingContext(input: AiMeetingDraftRequest): Promise<MeetingContext> {
  const userDirectory = input.directoryUsers?.length ? input.directoryUsers : users;
  const departmentDirectory = input.directoryDepartments?.length ? input.directoryDepartments : departments;
  const department = departmentDirectory.find((item) => item.id === input.departmentId);
  const host = userDirectory.find((item) => item.id === input.hostId);
  const departmentManager = department?.managerId ? userDirectory.find((user) => user.id === department.managerId) : undefined;
  const speakerAssignments = (input.speakerAssignments ?? [])
    .map((assignment) => ({
      speakerLabel: assignment.speakerLabel?.trim(),
      userId: assignment.userId?.trim(),
      userName: assignment.userName?.trim()
    }))
    .filter((assignment) => assignment.speakerLabel && assignment.userName);
  const assignedUsers = speakerAssignments
    .map((assignment): CandidateUser | undefined => {
      const matchedUser = userDirectory.find((user) => user.id === assignment.userId) ?? userDirectory.find((user) => user.name === assignment.userName);
      if (matchedUser) return { id: matchedUser.id, name: matchedUser.name, title: matchedUser.title };
      if (assignment.userId) return { id: assignment.userId, name: assignment.userName, title: "本次已标注发言人" };
      return undefined;
    })
    .filter((user): user is CandidateUser => Boolean(user));
  const participantUsers = (input.participantIds ?? [])
    .map((userId) => userDirectory.find((user) => user.id === userId))
    .filter((user): user is User => Boolean(user))
    .map((user) => ({ id: user.id, name: user.name, title: user.title }));
  const candidateUsers = [
    host ? { id: host.id, name: host.name, title: host.title } : undefined,
    departmentManager ? { id: departmentManager.id, name: departmentManager.name, title: departmentManager.title } : undefined,
    ...participantUsers,
    ...assignedUsers
  ].filter((user, index, items): user is CandidateUser => Boolean(user) && items.findIndex((item) => item?.id === user?.id) === index);
  const minuteTemplate = await readMeetingMinuteTemplate();

  return {
    departmentName: department?.name ?? input.departmentId,
    hostName: host?.name ?? input.hostId,
    participantNames: input.participantNames?.filter(Boolean) ?? [],
    meetingType: input.meetingType || "未填写",
    okrProjectName: input.okrProjectName || "无",
    meetingDate: safeDateKey(input.meetingDate),
    speakerAssignmentText: speakerAssignments.map((assignment) => `${assignment.speakerLabel}=${assignment.userName}`).join("；") || "无",
    candidateUserOptions: candidateUsers.map((user) => `${user.id}:${user.name}:${user.title}`).join("；") || `${input.hostId}:当前主持人`,
    candidateDepartmentOptions: department ? `${department.id}:${department.name}` : `${input.departmentId}:当前会议部门`,
    templateGuide: compactTemplateGuide(minuteTemplate),
    sourcePhrases: extractSourcePhrases(input.transcript)
  };
}

function parseJsonObject<T>(content: string): T {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? content;
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI response does not contain JSON");
  return JSON.parse(source.slice(first, last + 1)) as T;
}

function isAllowedUserId(value: unknown, input: AiMeetingDraftRequest): value is string {
  if (typeof value !== "string") return false;
  const userDirectory = input.directoryUsers?.length ? input.directoryUsers : users;
  if (userDirectory.some((user) => user.id === value)) return true;
  if (value === input.hostId) return true;
  return (input.speakerAssignments ?? []).some((assignment) => assignment.userId === value);
}

function isValidDepartmentId(value: unknown, input: AiMeetingDraftRequest): value is string {
  const departmentDirectory = input.directoryDepartments?.length ? input.directoryDepartments : departments;
  return typeof value === "string" && departmentDirectory.some((department) => department.id === value);
}

function isValidPriority(value: unknown): value is Priority {
  return value === "高" || value === "中" || value === "低";
}

function nextId(prefix: string, index: number) {
  return `${prefix}-${Date.now()}-${index}`;
}

function dateKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function currentDateTime() {
  return new Date().toISOString();
}

function safeDateKey(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKey(new Date());
}

function addDaysToDateKey(baseDate: string, days: number) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function sectionText(markdown: string, title: string) {
  const pattern = new RegExp(`^##\\s*[^\\n]*${title}[^\\n]*$`, "m");
  const match = markdown.match(pattern);
  if (!match || match.index === undefined) return "";
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^##\s/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function hasActionableSignals(text: string) {
  return ACTION_SIGNAL_PATTERN.test(text);
}

function buildBasicInfoSection(input: AiMeetingDraftRequest, context: MeetingContext) {
  const participantText = context.participantNames.length ? context.participantNames.join("、") : `未选择参会人员（表单人数：${input.participantCount ?? 0}）`;
  return [
    "## 一、会议基础信息",
    "",
    "| 项目 | 内容 |",
    "|---|---|",
    `| 会议名称 | ${input.title} |`,
    `| 会议日期 | ${context.meetingDate} |`,
    `| 会议类型 | ${context.meetingType} |`,
    `| 所属业务范围 | ${context.departmentName} |`,
    `| 主持人 | ${context.hostName} |`,
    `| 参会人 | ${participantText} |`,
    "| 记录人 | AI 会议纪要转写员 |",
    `| 关联对象 | ${context.okrProjectName} |`
  ].join("\n");
}

function replaceBasicInfoSection(markdown: string, basicInfoSection: string) {
  const startMatch = markdown.match(/^##\s*一[、.．]\s*会议基础信息.*$/m);
  if (startMatch?.index !== undefined) {
    const restStart = startMatch.index + startMatch[0].length;
    const rest = markdown.slice(restStart);
    const nextMatch = rest.match(/^##\s*二[、.．]\s*会议摘要.*$/m);
    const endIndex = nextMatch?.index === undefined ? markdown.length : restStart + nextMatch.index;
    return `${markdown.slice(0, startMatch.index)}${basicInfoSection}\n\n${markdown.slice(endIndex).trimStart()}`.trim();
  }
  return markdown.replace(/^#\s.*$/m, (title) => `${title}\n\n${basicInfoSection}`);
}

function normalizeMinuteMarkdown(markdown: unknown, input: AiMeetingDraftRequest) {
  let text = String(markdown || "").trim();
  const firstSectionIndex = text.search(/^##\s*一[、.．]\s*会议基础信息/m);
  if (firstSectionIndex >= 0) {
    text = `# ${input.title} 会议纪要\n\n${text.slice(firstSectionIndex).trim()}`;
  }
  text = text
    .replace(/^#\s*简化版智能会议纪要模板.*$/gim, `# ${input.title} 会议纪要`)
    .replace(/^>\s*使用原则[:：].*$/gim, "")
    .replace(/^\s*---\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text.startsWith("# ")) return `# ${input.title} 会议纪要\n\n${text}`;
  return text;
}

function removeModelSelfReferences(text: string, input: AiMeetingDraftRequest) {
  const normalizedTranscript = normalizeForMatch(input.transcript);
  return MODEL_SELF_REFERENCE_TERMS.reduce((current, term) => {
    if (normalizedTranscript.includes(normalizeForMatch(term))) return current;
    return current.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "AI");
  }, text);
}

function escapeTableCell(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, " / ")
    .replace(/\*\*/g, "")
    .trim();
}

function replaceMarkdownSection(markdown: string, title: string, body: string) {
  const pattern = new RegExp(`(^##\\s*[^\\n]*${title}[^\\n]*\\n)[\\s\\S]*?(?=^##\\s|$)`, "m");
  if (!pattern.test(markdown)) return markdown;
  return markdown.replace(pattern, `$1\n${body.trim()}\n\n`);
}

function isMarkdownTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function discussionItemsFromMinute(minuteMarkdown: string, input: AiMeetingDraftRequest) {
  const discussionSection = sectionText(minuteMarkdown, "会议主要讨论点");
  const items = discussionSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^\d+[.、]\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("|") && !isMarkdownTableSeparator(line))
    .slice(0, 5);
  if (items.length) return items;
  return splitTranscriptClauses(input.transcript).filter((item) => normalizeForMatch(item).length >= 12).slice(0, 5);
}

function buildDiscussionTable(input: AiMeetingDraftRequest, minuteMarkdown: string) {
  const rows = discussionItemsFromMinute(minuteMarkdown, input);
  const fallback = rows.length ? rows : ["本次会议围绕当前业务问题和后续闭环动作展开讨论"];
  return [
    "| 讨论编号 | 讨论主题 | 背景事实 | 核心问题 | 主要观点 | 涉及对象 | 初步结论 |",
    "|---|---|---|---|---|---|---|",
    ...fallback.map((item, index) => {
      const text = escapeTableCell(item);
      const topic = text.replace(/[:：].*$/, "").slice(0, 28) || `讨论-${String(index + 1).padStart(3, "0")}`;
      return `| 讨论-${String(index + 1).padStart(3, "0")} | ${escapeTableCell(topic)} | ${text.slice(0, 80)} | ${text.slice(0, 80)} | ${text.slice(0, 120)} | 相关部门 | 纳入会议闭环跟进 |`;
    })
  ].join("\n");
}

function userName(userId: string | undefined, input: AiMeetingDraftRequest) {
  const userDirectory = input.directoryUsers?.length ? input.directoryUsers : users;
  return userDirectory.find((user) => user.id === userId)?.name ?? input.speakerAssignments?.find((assignment) => assignment.userId === userId)?.userName ?? userId ?? "待确认";
}

function buildDecisionTable(decisions: MeetingDecision[], input: AiMeetingDraftRequest) {
  if (!decisions.length) return "本次未形成正式决策。";
  return [
    "| 决策编号 | 对应讨论编号 | 决策内容 | 决策人 | 决策依据 | 影响范围 | 复盘时间 |",
    "|---|---|---|---|---|---|---|",
    ...decisions.map((decision, index) => {
      const decisionNo = String(index + 1).padStart(3, "0");
      return `| 决策-${decisionNo} | 讨论-${decisionNo} | ${escapeTableCell(decision.content)} | ${escapeTableCell(userName(decision.ownerId, input))} | ${escapeTableCell(decision.sourceText || "会议摘要和讨论点")} | ${escapeTableCell(decision.impactScope)} | 待办完成后复盘 |`;
    })
  ].join("\n");
}

function buildTaskTable(tasks: Task[], decisions: MeetingDecision[], input: AiMeetingDraftRequest) {
  if (!tasks.length) return "本次未形成可执行待办。";
  return [
    "| 待办编号 | 来源决策 | 待办事项 | 待办推进人 | 待办复核人 | 截止时间 | 交付结果 | 验收标准 | 当前状态 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...tasks.map((task, index) => {
      const taskNo = String(index + 1).padStart(3, "0");
      const decisionIndex = Math.max(0, decisions.findIndex((decision) => decision.id === task.sourceDecisionId));
      const decisionNo = String((decisionIndex >= 0 ? decisionIndex : Math.min(index, Math.max(decisions.length - 1, 0))) + 1).padStart(3, "0");
      return `| 待办-${taskNo} | ${decisions.length ? `决策-${decisionNo}` : "无来源决策"} | ${escapeTableCell(task.content || task.title)} | ${escapeTableCell(userName(task.ownerId, input))} | ${escapeTableCell(userName(task.reviewerId, input))} | ${escapeTableCell(task.dueDate)} | ${escapeTableCell(task.title || task.content)} | ${escapeTableCell(task.goal)} | 未开始 |`;
    })
  ].join("\n");
}

function ensureStructuredMinuteMarkdown(minuteMarkdown: string, input: AiMeetingDraftRequest, decisions: MeetingDecision[], tasks: Task[]) {
  let structured = minuteMarkdown;
  structured = replaceMarkdownSection(structured, "会议主要讨论点", buildDiscussionTable(input, structured));
  structured = replaceMarkdownSection(structured, "会议形成的决策", buildDecisionTable(decisions, input));
  structured = replaceMarkdownSection(structured, "会议待办事项", buildTaskTable(tasks, decisions, input));
  return structured;
}

function extractActionSourceText(input: AiMeetingDraftRequest, minuteMarkdown: string) {
  const candidates = splitTranscriptClauses(input.transcript)
    .concat(splitTranscriptClauses(sectionText(minuteMarkdown, "会议摘要")))
    .concat(splitTranscriptClauses(sectionText(minuteMarkdown, "会议主要讨论点")));
  const source = candidates.find((item) => hasActionableSignals(item)) || stripTranscriptScaffolding(input.transcript) || sectionText(minuteMarkdown, "会议摘要");
  return source.slice(0, 160);
}

function fallbackDecisionContent(input: AiMeetingDraftRequest, minuteMarkdown: string) {
  const source = `${input.transcript}\n${minuteMarkdown}`;
  if (/自研|会议闭环系统|录音转文字|管理驾驶舱/.test(source)) {
    return "推进自研会议闭环系统，并先在直营门店内部测试后逐步推广";
  }
  if (/客户需求|交付风险/.test(source)) {
    return "将客户需求记录与交付风险管控纳入会议闭环跟进";
  }
  return "将本次会议明确的行动方向纳入会议闭环推进";
}

function buildFallbackDecision(input: AiMeetingDraftRequest, minuteMarkdown: string, index = 0): MeetingDecision {
  return {
    id: nextId("ai-decision", index),
    content: fallbackDecisionContent(input, minuteMarkdown).slice(0, 200),
    ownerId: input.hostId,
    impactScope: "会议相关部门和任务责任人",
    needPresidentConfirmation: true,
    sourceText: extractActionSourceText(input, minuteMarkdown)
  };
}

function buildFallbackTasks(input: AiMeetingDraftRequest, minuteMarkdown: string, decisions: MeetingDecision[]): Task[] {
  const source = `${input.transcript}\n${minuteMarkdown}`;
  const baseDate = safeDateKey(input.meetingDate);
  const createdAt = currentDateTime();
  const sourceDecisionId = decisions[0]?.id ?? "";
  const sourceText = extractActionSourceText(input, minuteMarkdown);
  const specs = [
    /客户需求|交付风险/.test(source)
      ? {
          content: "梳理客户需求记录与交付风险管控问题清单",
          goal: "输出可复核的问题清单，明确客户需求遗漏点、交付风险点和改进建议",
          dueDays: 3,
          priority: "高" as Priority
        }
      : undefined,
    /自研|会议闭环系统|录音转文字|管理驾驶舱/.test(source)
      ? {
          content: "制定会议闭环系统内部测试方案",
          goal: "明确录音转文字、纪要生成、待办分配、验收标准和管理驾驶舱的试点流程",
          dueDays: 5,
          priority: "高" as Priority
        }
      : undefined,
    /测试|推广|逐步推广|先在/.test(source)
      ? {
          content: "制定直营门店试点与后续推广计划",
          goal: "明确试点门店、测试周期、反馈收集方式和推广节奏",
          dueDays: 7,
          priority: "中" as Priority
        }
      : undefined
  ].filter((item): item is { content: string; goal: string; dueDays: number; priority: Priority } => Boolean(item));

  const fallbackSpecs = specs.length
    ? specs
    : [
        {
          content: "补充本次会议行动项并纳入闭环跟进",
          goal: "明确责任人、截止时间、交付物和验收标准",
          dueDays: 3,
          priority: "中" as Priority
        }
      ];

  return fallbackSpecs.slice(0, 4).map((item, index) => ({
    id: nextId("ai-task", index),
    meetingId: input.meetingId,
    content: item.content,
    title: item.content,
    description: "由 AI 根据会议摘要和讨论点恢复生成，主管可在提交前修正。",
    owner: input.hostId,
    ownerId: input.hostId,
    ownerDepartment: input.departmentId,
    departmentId: input.departmentId,
    reviewerId: input.hostId,
    collaboratorDepartments: [],
    collaboratorDepartmentIds: [],
    startDate: baseDate,
    dueDate: addDaysToDateKey(baseDate, item.dueDays),
    goal: item.goal,
    status: "not_started" satisfies TaskStatus,
    priority: item.priority,
    companySupportRequest: "",
    sourceText,
    sourceDecisionId,
    approvalStatus: "pending_president_approval" satisfies ApprovalStatus,
    createdAt,
    updatedAt: createdAt
  }));
}

function assertMinuteLooksLikeTranscript(minuteMarkdown: string, input: AiMeetingDraftRequest, sourcePhrases: string[]) {
  const normalizedMinute = normalizeForMatch(minuteMarkdown);
  const normalizedTranscript = normalizeForMatch(stripTranscriptScaffolding(input.transcript));
  if (/简化版智能会议纪要模板|使用原则|本模板只保留|占位/.test(minuteMarkdown)) {
    throw new MeetingDraftValidationError("AI 结果仍包含模板标题、使用原则或占位内容，系统已拦截。请重新生成。");
  }
  if (!sectionText(minuteMarkdown, "会议摘要") || !sectionText(minuteMarkdown, "会议主要讨论点")) {
    throw new MeetingDraftValidationError("AI 结果缺少会议摘要或主要讨论点，系统已拦截。请重新生成。");
  }
  const matched = sourcePhrases.filter((phrase) => normalizeForMatch(phrase).length >= 2 && normalizedMinute.includes(normalizeForMatch(phrase)));
  const transcriptTopicTerms = TRACEABLE_TOPIC_TERMS.filter((term) => normalizedTranscript.includes(normalizeForMatch(term)));
  const matchedTopicTerms = transcriptTopicTerms.filter((term) => normalizedMinute.includes(normalizeForMatch(term)));
  const requiredMatches = sourcePhrases.length >= 6 ? Math.min(4, Math.ceil(sourcePhrases.length * 0.25)) : Math.min(2, sourcePhrases.length);
  const requiredTopicMatches = transcriptTopicTerms.length >= 8 ? 4 : Math.min(3, transcriptTopicTerms.length);
  if (input.transcript.trim().length > 100 && matched.length < requiredMatches && matchedTopicTerms.length < requiredTopicMatches) {
    throw new MeetingDraftValidationError("AI 结果没有充分贴合当前上传文稿的关键词和正文片段，系统已拦截，避免生成跑题纪要。请确认文稿完整后重新生成。");
  }
  const unsupportedTerms = UNSUPPORTED_DOMAIN_TERMS.filter((term) => minuteMarkdown.includes(term) && !normalizedTranscript.includes(normalizeForMatch(term)));
  if (unsupportedTerms.length) {
    throw new MeetingDraftValidationError(`AI 结果包含当前会议原文中没有出现的关键信息：${unsupportedTerms.slice(0, 5).join("、")}。系统已拦截，避免生成跑题纪要。`);
  }
}

function buildMinutePrompt(input: AiMeetingDraftRequest, context: MeetingContext) {
  return [
    "你是会议纪要转写员。本阶段只做一件事：根据【本次上传文稿】生成正式 Markdown 会议纪要。",
    "关键要求：上传文稿是唯一事实来源，模板只是字段结构；不得复制模板标题、模板说明、使用原则、示例或占位文字。",
    "会议基础信息必须完全使用【表单基础信息】，不得从上传文稿中提取或覆盖。",
    "正式纪要不得出现模型名、供应商名或“由 DeepSeek 生成”等自称说明；记录人固定写“AI 会议纪要转写员”。",
    "三、会议主要讨论点、四、会议形成的决策、五、会议待办事项必须使用 Markdown 表格，不要使用项目符号列表。",
    "如果上传文稿中出现“决定、最终决定、需要、要实现、先在、测试、推广、待办、责任人、截止、验收”等行动信号，必须写入决策和待办表格，不得在摘要里说已决定、却在四/五段写未形成。",
    `缺少明确责任人时用主持人“${context.hostName}”兜底；缺少截止时间时用会议日期后 3 天；缺少验收标准时写可复核交付物。`,
    `正式纪要第一行必须是：# ${input.title} 会议纪要`,
    "只输出 JSON：{\"aiSummary\":\"string\",\"minuteMarkdown\":\"string\"}",
    "minuteMarkdown 必须包含六段：一、会议基础信息；二、会议摘要；三、会议主要讨论点；四、会议形成的决策；五、会议待办事项；六、检索标签。",
    "只有全文完全没有行动信号时，才允许在对应段落写“本次未形成正式决策”或“本次未形成可执行待办”。",
    `会议主题：${input.title}`,
    `会议日期：${context.meetingDate}`,
    `会议部门：${context.departmentName}`,
    `会议主持人：${context.hostName}`,
    `人工发言人标注：${context.speakerAssignmentText}`,
    "如有人工发言人标注，已标注姓名优先于发言人编号；未标注编号不得臆测真实姓名。",
    "【表单基础信息，必须原样用于第一段】",
    buildBasicInfoSection(input, context),
    `必须尽量保留这些上传文稿中的关键信号：${context.sourcePhrases.join("、") || "无"}`,
    "【本次上传文稿，唯一事实来源】",
    input.transcript || "未提供会议正文。",
    "【模板结构参考，只能参考字段，不得复制原文】",
    context.templateGuide
  ].join("\n");
}

function buildDecisionPrompt(input: AiMeetingDraftRequest, context: MeetingContext, minuteMarkdown: string) {
  return [
    "你是会议闭环系统的数据抽取员。本阶段只做一件事：从【已生成的正式会议纪要】抽取 decisions。",
    "只输出 JSON：{\"decisions\":[{\"content\":\"string\",\"ownerId\":\"string\",\"impactScope\":\"string\",\"needPresidentConfirmation\":true,\"sourceText\":\"string\"}]}",
    "优先从“会议形成的决策”部分抽取；如果该段写未形成，但摘要或讨论点出现“决定、最终决定、确认、需要、要实现、先在、测试、推广”等行动信号，必须从摘要和讨论点恢复抽取，不得返回空数组。",
    "content 必须能在会议纪要中找到直接依据，不得根据模板、历史会议或组织清单发挥。",
    `人工发言人标注：${context.speakerAssignmentText}`,
    "如内容来自已标注发言人的发言，可优先选择该发言人作为 ownerId；未标注编号不得臆测真实姓名。",
    `候选用户：${context.candidateUserOptions}`,
    `候选部门：${context.candidateDepartmentOptions}`,
    `主持人兜底 ID：${input.hostId}`,
    "【已生成的正式会议纪要】",
    minuteMarkdown
  ].join("\n");
}

function buildTaskPrompt(input: AiMeetingDraftRequest, context: MeetingContext, minuteMarkdown: string, decisions: MeetingDecision[]) {
  const decisionLines = decisions.map((decision, index) => `${index + 1}. ${decision.id}｜${decision.content}`).join("\n") || "本次没有正式决策。";
  return [
    "你是会议闭环系统的待办抽取员。本阶段只做一件事：从【已生成的正式会议纪要】和【已确认决策】抽取 tasks。",
    "只输出 JSON：{\"tasks\":[{\"title\":\"string\",\"content\":\"string\",\"description\":\"string\",\"ownerId\":\"string\",\"departmentId\":\"string\",\"reviewerId\":\"string\",\"collaboratorDepartmentIds\":[\"string\"],\"startDate\":\"YYYY-MM-DD\",\"dueDate\":\"YYYY-MM-DD\",\"goal\":\"string\",\"priority\":\"高|中|低\",\"companySupportRequest\":\"string\",\"sourceText\":\"string\",\"sourceDecisionId\":\"string\"}]}",
    "只生成纪要中已经出现、且具备推进人/截止时间/验收标准或可由主持人兜底确认的待办。",
    "如果纪要的待办段写未形成，但摘要、讨论点或决策中出现“需要、要实现、先在、测试、推广、待办、责任人、截止、验收”等行动信号，必须恢复生成待办，不得返回空数组。",
    "sourceDecisionId 必须从【已确认决策】中的 ID 选择；如果待办没有来源决策但纪要明确是行动项，填空字符串。",
    "不得基于模板、历史会议、组织人员清单或其他附件生成待办。",
    `人工发言人标注：${context.speakerAssignmentText}`,
    "如待办来自已标注发言人的明确承诺，可优先选择该发言人作为 ownerId；未标注编号不得臆测真实姓名。",
    `候选用户：${context.candidateUserOptions}`,
    `候选部门：${context.candidateDepartmentOptions}`,
    `主持人兜底 ID：${input.hostId}`,
    `默认日期：${safeDateKey(input.meetingDate)}`,
    "【已确认决策】",
    decisionLines,
    "【已生成的正式会议纪要】",
    minuteMarkdown
  ].join("\n");
}

function sanitizeDecision(decision: RawAiDecision, input: AiMeetingDraftRequest, index: number, decisionSection: string): MeetingDecision {
  const ownerId = isAllowedUserId(decision.ownerId, input) ? decision.ownerId : input.hostId;
  const content = removeModelSelfReferences(String(decision.content || ""), input).trim().slice(0, 200);
  if (!content) throw new Error("AI decision missed content");
  const sourceText = removeModelSelfReferences(String(decision.sourceText || content), input).slice(0, 160);
  if (!isMeetingDraftEvidenceSupported({ supportText: decisionSection, content, sourceText })) {
    throw new MeetingDraftValidationError("AI 提取的会议决策与会议纪要依据不一致，请重试生成。");
  }
  return {
    id: nextId("ai-decision", index),
    content,
    ownerId,
    impactScope: String(decision.impactScope || "相关部门和任务责任人").slice(0, 120),
    needPresidentConfirmation: Boolean(decision.needPresidentConfirmation),
    sourceText
  };
}

function sanitizeTask(task: RawAiTask, input: AiMeetingDraftRequest, index: number, decisions: MeetingDecision[], taskSection: string): Task {
  const title = removeModelSelfReferences(String(task.title || task.content || "补充会议待办事项"), input).slice(0, 100);
  const ownerId = isAllowedUserId(task.ownerId, input) ? task.ownerId : input.hostId;
  const departmentId = isValidDepartmentId(task.departmentId, input) ? task.departmentId : input.departmentId;
  const reviewerId = isAllowedUserId(task.reviewerId, input) ? task.reviewerId : input.hostId;
  const collaboratorDepartmentIds = Array.isArray(task.collaboratorDepartmentIds)
    ? task.collaboratorDepartmentIds.filter((id) => isValidDepartmentId(id, input)).filter((id) => id !== departmentId)
    : [];
  const baseDate = safeDateKey(input.meetingDate);
  const startDate = String(task.startDate || baseDate);
  const dueDate = String(task.dueDate || addDaysToDateKey(startDate, 3));
  const sourceDecisionId = decisions.some((decision) => decision.id === task.sourceDecisionId) ? task.sourceDecisionId : decisions[0]?.id;
  const createdAt = currentDateTime();
  const content = removeModelSelfReferences(String(task.content || title), input).slice(0, 120);
  const sourceText = removeModelSelfReferences(String(task.sourceText || content), input).slice(0, 120);

  if (!isMeetingDraftEvidenceSupported({ supportText: taskSection, content, sourceText })) {
    throw new MeetingDraftValidationError("AI 提取的待办事项与会议纪要依据不一致，请重试生成。");
  }

  return {
    id: nextId("ai-task", index),
    meetingId: input.meetingId,
    content,
    title,
    description: removeModelSelfReferences(String(task.description || "由 AI 根据正式会议纪要和会议决策生成，主管可在提交前修正。"), input).slice(0, 240),
    owner: ownerId,
    ownerId,
    ownerDepartment: departmentId,
    departmentId,
    reviewerId,
    collaboratorDepartments: collaboratorDepartmentIds,
    collaboratorDepartmentIds,
    startDate,
    dueDate,
    goal: removeModelSelfReferences(String(task.goal || "按截止时间提交可复核的完成结果"), input).slice(0, 180),
    status: "not_started" satisfies TaskStatus,
    priority: isValidPriority(task.priority) ? task.priority : "中",
    companySupportRequest: removeModelSelfReferences(String(task.companySupportRequest || ""), input).slice(0, 180),
    sourceText,
    sourceDecisionId,
    approvalStatus: "pending_president_approval" satisfies ApprovalStatus,
    createdAt,
    updatedAt: createdAt
  };
}

function normalizeDecisions(raw: RawDecisionResult, input: AiMeetingDraftRequest, minuteMarkdown: string) {
  const decisionSection = sectionText(minuteMarkdown, "会议形成的决策");
  const supportSection = NO_DECISION_PATTERN.test(decisionSection) && hasActionableSignals(minuteMarkdown) ? minuteMarkdown : decisionSection;
  if (NO_DECISION_PATTERN.test(decisionSection) && !hasActionableSignals(minuteMarkdown)) return [];
  const decisions = (raw.decisions ?? []).slice(0, 5).map((decision, index) => sanitizeDecision(decision, input, index, supportSection));
  return decisions.length ? decisions : hasActionableSignals(minuteMarkdown) ? [buildFallbackDecision(input, minuteMarkdown)] : [];
}

function normalizeTasks(raw: RawTaskResult, input: AiMeetingDraftRequest, minuteMarkdown: string, decisions: MeetingDecision[]) {
  const taskSection = sectionText(minuteMarkdown, "会议待办事项");
  const supportSection = NO_TASK_PATTERN.test(taskSection) && hasActionableSignals(minuteMarkdown) ? minuteMarkdown : taskSection;
  if (NO_TASK_PATTERN.test(taskSection) && !hasActionableSignals(minuteMarkdown)) return [];
  const tasks = (raw.tasks ?? []).slice(0, 6).map((task, index) => sanitizeTask(task, input, index, decisions, supportSection));
  return tasks.length ? tasks : hasActionableSignals(minuteMarkdown) ? buildFallbackTasks(input, minuteMarkdown, decisions) : [];
}

async function callDeepSeekOpenAiJson<T>(apiKey: string, openAiUrl: string, prompt: string) {
  const model = process.env.DEEPSEEK_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const response = await deepSeekFetch(openAiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4200,
      temperature: 0.1,
      messages: [
        { role: "system", content: "你只输出严格 JSON。不要输出 Markdown 代码块，不要输出解释。" },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`DeepSeek OpenAI API failed: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("DeepSeek OpenAI API returned empty content");
  return { json: parseJsonObject<T>(text), model };
}

async function callDeepSeekAnthropicJson<T>(apiKey: string, prompt: string) {
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const response = await deepSeekFetch(process.env.DEEPSEEK_ANTHROPIC_URL || DEFAULT_ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4200,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`DeepSeek Anthropic API failed: ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = data.content?.map((item) => item.text ?? "").join("\n").trim() ?? "";
  if (!text) throw new Error("DeepSeek Anthropic API returned empty content");
  return { json: parseJsonObject<T>(text), model };
}

export async function generateDeepSeekJson<T>(prompt: string) {
  const { apiKey, openAiUrl } = await readDeepSeekConfig();
  const mode = process.env.DEEPSEEK_API_MODE || "auto";

  if (mode === "openai") return callDeepSeekOpenAiJson<T>(apiKey, openAiUrl, prompt);
  if (mode === "anthropic") return callDeepSeekAnthropicJson<T>(apiKey, prompt);

  try {
    return await callDeepSeekOpenAiJson<T>(apiKey, openAiUrl, prompt);
  } catch (openAiError) {
    try {
      return await callDeepSeekAnthropicJson<T>(apiKey, prompt);
    } catch (anthropicError) {
      throw new Error(
        `${openAiError instanceof Error ? openAiError.message : "DeepSeek OpenAI API failed"}; ${
          anthropicError instanceof Error ? anthropicError.message : "DeepSeek Anthropic API failed"
        }`
      );
    }
  }
}

async function generateWithOpenAi(apiKey: string, openAiUrl: string, input: AiMeetingDraftRequest): Promise<AiMeetingDraftResponse> {
  const context = await buildMeetingContext(input);
  const minuteResult = await callDeepSeekOpenAiJson<RawMinuteResult>(apiKey, openAiUrl, buildMinutePrompt(input, context));
  const aiSummary = removeModelSelfReferences(String(minuteResult.json.aiSummary || ""), input).slice(0, 1200);
  const minuteMarkdown = removeModelSelfReferences(
    replaceBasicInfoSection(normalizeMinuteMarkdown(minuteResult.json.minuteMarkdown || aiSummary, input), buildBasicInfoSection(input, context)),
    input
  ).slice(0, 8000);
  if (!aiSummary || !minuteMarkdown) throw new Error("AI minute stage missed required fields");
  assertMinuteLooksLikeTranscript(minuteMarkdown, input, context.sourcePhrases);

  const decisionResult = await callDeepSeekOpenAiJson<RawDecisionResult>(apiKey, openAiUrl, buildDecisionPrompt(input, context, minuteMarkdown));
  const decisions = normalizeDecisions(decisionResult.json, input, minuteMarkdown);
  const taskResult = await callDeepSeekOpenAiJson<RawTaskResult>(apiKey, openAiUrl, buildTaskPrompt(input, context, minuteMarkdown, decisions));
  const tasks = normalizeTasks(taskResult.json, input, minuteMarkdown, decisions);

  return { aiSummary, minuteMarkdown: ensureStructuredMinuteMarkdown(minuteMarkdown, input, decisions, tasks), decisions, tasks, provider: "deepseek", model: minuteResult.model };
}

async function generateWithAnthropic(apiKey: string, input: AiMeetingDraftRequest): Promise<AiMeetingDraftResponse> {
  const context = await buildMeetingContext(input);
  const minuteResult = await callDeepSeekAnthropicJson<RawMinuteResult>(apiKey, buildMinutePrompt(input, context));
  const aiSummary = removeModelSelfReferences(String(minuteResult.json.aiSummary || ""), input).slice(0, 1200);
  const minuteMarkdown = removeModelSelfReferences(
    replaceBasicInfoSection(normalizeMinuteMarkdown(minuteResult.json.minuteMarkdown || aiSummary, input), buildBasicInfoSection(input, context)),
    input
  ).slice(0, 8000);
  if (!aiSummary || !minuteMarkdown) throw new Error("AI minute stage missed required fields");
  assertMinuteLooksLikeTranscript(minuteMarkdown, input, context.sourcePhrases);

  const decisionResult = await callDeepSeekAnthropicJson<RawDecisionResult>(apiKey, buildDecisionPrompt(input, context, minuteMarkdown));
  const decisions = normalizeDecisions(decisionResult.json, input, minuteMarkdown);
  const taskResult = await callDeepSeekAnthropicJson<RawTaskResult>(apiKey, buildTaskPrompt(input, context, minuteMarkdown, decisions));
  const tasks = normalizeTasks(taskResult.json, input, minuteMarkdown, decisions);

  return { aiSummary, minuteMarkdown: ensureStructuredMinuteMarkdown(minuteMarkdown, input, decisions, tasks), decisions, tasks, provider: "deepseek", model: minuteResult.model };
}

export async function generateMeetingDraftWithDeepSeek(input: AiMeetingDraftRequest): Promise<AiMeetingDraftResponse> {
  let runtimeInput = input;
  try {
    const state = canonicalizeMeetingLoopState(isDbStateReadEnabled() ? await readDbState() : await readLocalState());
    runtimeInput = {
      ...input,
      directoryUsers: state.users,
      directoryDepartments: state.departments
    };
  } catch {
    // Keep the public-demo directory only as a local fallback when the live directory is unavailable.
  }
  assertTranscriptCanGenerateMinute(runtimeInput);
  const { apiKey, openAiUrl } = await readDeepSeekConfig();
  const mode = process.env.DEEPSEEK_API_MODE || "auto";

  if (mode === "openai") return generateWithOpenAi(apiKey, openAiUrl, runtimeInput);
  if (mode === "anthropic") return generateWithAnthropic(apiKey, runtimeInput);

  try {
    return await generateWithOpenAi(apiKey, openAiUrl, runtimeInput);
  } catch (openAiError) {
    if (openAiError instanceof MeetingDraftValidationError) throw openAiError;
    try {
      return await generateWithAnthropic(apiKey, runtimeInput);
    } catch (anthropicError) {
      if (anthropicError instanceof MeetingDraftValidationError) throw anthropicError;
      throw new Error(
        `${openAiError instanceof Error ? openAiError.message : "DeepSeek OpenAI API failed"}; ${
          anthropicError instanceof Error ? anthropicError.message : "DeepSeek Anthropic API failed"
        }`
      );
    }
  }
}
