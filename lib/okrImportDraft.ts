import { generateDeepSeekJson } from "@/lib/aiMeetingDraft";
import { departments, users } from "@/lib/orgPeopleData";
import type { OkrKR, OkrMetric, OkrMetricStatus, OkrPDCATask, OkrPdcaStage, OkrPriority, OkrProject, OkrRiskLevel, OkrTaskStatus } from "@/lib/okrTypes";
import type { SpreadsheetSheetPayload, SpreadsheetWorkbookPayload } from "@/lib/okrSpreadsheetTypes";

export type OkrImportDraftResponse = {
  draftProject: OkrProject;
  notes: string[];
  model?: string;
  sourceName?: string;
  summary: {
    krCount: number;
    pdcaCount: number;
    metricCount: number;
  };
};

type RawOkrImportResult = Partial<{
  projectName: string;
  category: string;
  objective: string;
  background: string;
  owner: string;
  ownerDepartment: string;
  collaboratorDepartments: string[];
  startDate: string;
  endDate: string;
  priority: OkrPriority;
  riskLevel: OkrRiskLevel;
  krs: RawKr[];
  pdcaTasks: RawPdcaTask[];
  metrics: RawMetric[];
  supportRequests: string[];
  notes: string[];
}>;

type RawKr = Partial<{
  code: string;
  title: string;
  description: string;
  metric: string;
  targetValue: string;
  currentValue: string;
  weight: number;
  owner: string;
  department: string;
  reviewer: string;
  startDate: string;
  endDate: string;
  riskLevel: OkrRiskLevel;
}>;

type RawPdcaTask = Partial<{
  krCode: string;
  pdcaStage: OkrPdcaStage;
  title: string;
  content: string;
  owner: string;
  ownerDepartment: string;
  reviewer: string;
  collaboratorDepartments: string[];
  startDate: string;
  endDate: string;
  deliverable: string;
  status: OkrTaskStatus;
  riskLevel: OkrRiskLevel;
}>;

type RawMetric = Partial<{
  label: string;
  base: string;
  target: string;
  current: string;
  status: OkrMetricStatus;
}>;

const riskLevels: OkrRiskLevel[] = ["高", "中", "低"];
const priorities: OkrPriority[] = ["高", "中", "低"];
const pdcaStages: OkrPdcaStage[] = ["Plan", "Do", "Check", "Act"];
const metricStatuses: OkrMetricStatus[] = ["未开始", "进行中", "已达成", "有风险"];
const taskStatuses: OkrTaskStatus[] = ["未开始", "进行中", "已提交待复核", "已完成", "已延期", "阻塞中", "已取消"];
const MAX_SOURCE_CHARS = 16000;
const MAX_STRUCTURED_PDCA_TASKS = 240;
const DEFAULT_PROJECT_OWNER = "曹梦圆";

const departmentAliases: Record<string, string> = {
  IT: "IT部",
  it: "IT部",
  产品研发: "产品研发",
  研发: "产品研发",
  设计总监: "设计总监",
  设计: "设计部",
  审单: "审单",
  直营审核: "直营审核组",
  加盟审核组: "加盟审核组",
  运营赋能组: "运营赋能组",
  运营赋能: "运营赋能组",
  培训: "培训部",
  项目组全体: "项目组全体"
};

const userAliases: Record<string, string> = {
  美凤总: "美凤",
  林美凤: "美凤"
};

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeDate(value: unknown, fallback: string) {
  const text = asText(value);
  if (!text) return fallback;
  const matched = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!matched) return fallback;
  return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
}

function enumValue<T extends string>(value: unknown, allowed: T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function uniqText(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeLoose(value: string) {
  return value.replace(/\s+/g, "").replace(/[（）()：:]/g, "").toLowerCase();
}

function parsePdcaStage(value: unknown, fallback: OkrPdcaStage): OkrPdcaStage {
  const text = normalizeLoose(asText(value));
  if (!text) return fallback;
  if (text.includes("plan") || text.includes("计划")) return "Plan";
  if (text.includes("do") || text.includes("执行")) return "Do";
  if (text.includes("check") || text.includes("检查")) return "Check";
  if (text.includes("act") || text.includes("处理") || text.includes("行动")) return "Act";
  return fallback;
}

function normalizeStatus(value: unknown): OkrTaskStatus {
  const text = asText(value);
  if (taskStatuses.includes(text as OkrTaskStatus)) return text as OkrTaskStatus;
  if (text.includes("完成")) return "已完成";
  if (text.includes("进行")) return "进行中";
  if (text.includes("延期")) return "已延期";
  if (text.includes("阻塞")) return "阻塞中";
  if (text.includes("取消")) return "已取消";
  return "未开始";
}

function splitDepartmentText(value: unknown) {
  const text = asText(value);
  if (!text) return [];
  return uniqText(
    text
      .split(/[+＋、,，/／&和及；;]+/)
      .map((item) => item.trim())
      .filter((item) => item && item !== "各部门")
      .map((item) => departmentAliases[item] ?? item)
  );
}

function normalizeUserName(value: unknown, fallback = DEFAULT_PROJECT_OWNER) {
  const text = asText(value);
  if (!text || text === "各部门" || text === "项目组全体") return fallback;
  return userAliases[text] ?? text;
}

function bestHeaderScore(value: string, patterns: string[]) {
  const normalized = normalizeLoose(value);
  if (!normalized) return 0;
  return patterns.reduce((score, pattern) => {
    const target = normalizeLoose(pattern);
    if (!target) return score;
    if (normalized === target) return Math.max(score, 5);
    if (normalized.includes(target) || target.includes(normalized)) return Math.max(score, 3);
    return score;
  }, 0);
}

type StructuredColumnKey =
  | "taskPhase"
  | "pdcaStage"
  | "taskNo"
  | "taskTitle"
  | "content"
  | "ownerDepartment"
  | "owner"
  | "startDate"
  | "endDate"
  | "deliverable"
  | "status";

type StructuredColumnMap = Partial<Record<StructuredColumnKey, number>>;

const headerPatterns: Record<StructuredColumnKey, string[]> = {
  taskPhase: ["任务阶段", "项目阶段", "阶段"],
  pdcaStage: ["PDCA阶段", "PDCA", "计划执行检查处理"],
  taskNo: ["任务编号", "编号", "序号", "任务序号"],
  taskTitle: ["任务名称", "任务标题", "任务事项", "任务内容", "工作任务"],
  content: ["具体内容", "任务描述", "工作内容", "详细内容", "执行内容", "内容"],
  ownerDepartment: ["责任部门", "负责部门", "协同部门", "执行部门", "部门"],
  owner: ["责任人", "负责人", "推进人", "执行人", "人员", "姓名"],
  startDate: ["计划开始时间", "计划开始", "开始时间", "开始日期", "起始时间"],
  endDate: ["计划结束时间", "计划结束", "结束时间", "截止时间", "完成时间"],
  deliverable: ["输出成果", "交付物", "成果", "输出"],
  status: ["完成状态", "任务状态", "状态"]
};

function findHeaderRowIndex(rows: string[][]) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 25).forEach((row, index) => {
    const text = row.join(" ");
    const score =
      (/(任务|工作|事项)/.test(text) ? 2 : 0) +
      (/(责任|负责人|推进人|人员)/.test(text) ? 2 : 0) +
      (/(部门|协同)/.test(text) ? 2 : 0) +
      (/(开始|结束|截止|日期|时间)/.test(text) ? 2 : 0) +
      (/(PDCA|Plan|Do|Check|Act|计划|执行|检查|处理)/i.test(text) ? 1 : 0);
    if (score > best.score) best = { index, score };
  });
  return best.score >= 5 ? best.index : -1;
}

function pickColumn(header: string[], key: StructuredColumnKey, used: Set<number>) {
  let best = { index: -1, score: 0 };
  header.forEach((cell, index) => {
    if (used.has(index)) return;
    const score = bestHeaderScore(cell, headerPatterns[key]);
    if (score > best.score) best = { index, score };
  });
  if (best.score <= 0) return undefined;
  used.add(best.index);
  return best.index;
}

function looksLikeDate(value: string) {
  return /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(value);
}

function inferColumnMap(rows: string[][], headerIndex: number): StructuredColumnMap {
  const header = rows[headerIndex] ?? [];
  const used = new Set<number>();
  const map: StructuredColumnMap = {};
  ([
    "taskNo",
    "pdcaStage",
    "taskPhase",
    "ownerDepartment",
    "owner",
    "startDate",
    "endDate",
    "deliverable",
    "status",
    "taskTitle",
    "content"
  ] as StructuredColumnKey[]).forEach((key) => {
    const column = pickColumn(header, key, used);
    if (typeof column === "number") map[key] = column;
  });

  const dataRows = rows.slice(headerIndex + 1, headerIndex + 80);
  if (typeof map.startDate !== "number" || typeof map.endDate !== "number") {
    const dateColumns = header
      .map((_, index) => ({
        index,
        count: dataRows.filter((row) => looksLikeDate(asText(row[index]))).length
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .map((item) => item.index)
      .filter((index) => !used.has(index));
    if (typeof map.startDate !== "number" && typeof dateColumns[0] === "number") map.startDate = dateColumns[0];
    if (typeof map.endDate !== "number" && typeof dateColumns[1] === "number") map.endDate = dateColumns[1];
  }

  if (typeof map.content !== "number") {
    const longTextColumns = header
      .map((_, index) => ({
        index,
        total: dataRows.reduce((sum, row) => sum + asText(row[index]).length, 0)
      }))
      .filter((item) => item.total > 40 && ![map.ownerDepartment, map.owner, map.startDate, map.endDate, map.deliverable, map.status].includes(item.index))
      .sort((a, b) => b.total - a.total);
    if (typeof longTextColumns[0]?.index === "number") map.content = longTextColumns[0].index;
  }

  return map;
}

function cell(row: string[], column?: number) {
  return typeof column === "number" ? asText(row[column]) : "";
}

function rowHasTaskSignal(row: string[], columns: StructuredColumnMap) {
  return Boolean(
    cell(row, columns.taskNo) ||
      cell(row, columns.taskTitle) ||
      cell(row, columns.content) ||
      cell(row, columns.owner) ||
      cell(row, columns.ownerDepartment)
  );
}

function firstContentLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] ?? value;
}

function chooseTaskTitle(taskNo: string, title: string, content: string) {
  const text = title || firstContentLine(content);
  if (!taskNo) return text || "导入任务";
  if (!text) return `任务 ${taskNo}`;
  return text.startsWith(taskNo) ? text : `${taskNo} ${text}`;
}

function sheetTaskScore(sheet: SpreadsheetSheetPayload) {
  const headerIndex = findHeaderRowIndex(sheet.rows);
  if (headerIndex < 0) return 0;
  const headerText = sheet.rows[headerIndex].join(" ");
  const nameScore = /(详细任务|任务分解|任务明细|PDCA)/i.test(sheet.name) ? 8 : 0;
  const headerScore =
    (/(任务|工作|事项)/.test(headerText) ? 3 : 0) +
    (/(责任|负责人|推进人|人员)/.test(headerText) ? 3 : 0) +
    (/(部门|协同)/.test(headerText) ? 3 : 0) +
    (/(开始|结束|截止|日期|时间)/.test(headerText) ? 2 : 0);
  return nameScore + headerScore;
}

function selectTaskSheet(spreadsheet: SpreadsheetWorkbookPayload) {
  return spreadsheet.sheets
    .map((sheet) => ({ sheet, score: sheetTaskScore(sheet) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.sheet;
}

function parseProjectSheet(spreadsheet: SpreadsheetWorkbookPayload) {
  const allRows = spreadsheet.sheets.flatMap((sheet) => sheet.rows);
  const allText = allRows.flat().map((item) => item.trim()).filter(Boolean);
  const projectName =
    allText.find((item) => /项目$/.test(item) && item.length >= 6 && item.length <= 40) ??
    allText.find((item) => item.includes("项目名称")) ??
    "AI 导入 OKR 项目草稿";
  const projectOwner = allText.includes(DEFAULT_PROJECT_OWNER) ? DEFAULT_PROJECT_OWNER : undefined;
  const objectiveCell =
    allText.find((item) => item.includes("项目目标")) ??
    allText.find((item) => item.includes("效率") && item.includes("提升")) ??
    "";
  return {
    projectName: projectName.replace(/^项目名称[:：]?/, "").trim(),
    owner: projectOwner,
    objective: objectiveCell.replace(/^项目目标[:：]?/, "").trim()
  };
}

function buildStructuredRawImport(spreadsheet?: SpreadsheetWorkbookPayload): { raw: RawOkrImportResult; notes: string[] } | null {
  if (!spreadsheet?.sheets?.length) return null;
  const taskSheet = selectTaskSheet(spreadsheet);
  if (!taskSheet) return null;
  const headerIndex = findHeaderRowIndex(taskSheet.rows);
  if (headerIndex < 0) return null;
  const columns = inferColumnMap(taskSheet.rows, headerIndex);
  if (typeof columns.content !== "number" && typeof columns.taskTitle !== "number") return null;

  const projectMeta = parseProjectSheet(spreadsheet);
  const tasks: RawPdcaTask[] = [];
  const phaseOrder: string[] = [];
  let currentPhase = "";
  let currentPdcaStage: OkrPdcaStage = "Plan";

  taskSheet.rows.slice(headerIndex + 1).forEach((row) => {
    if (!rowHasTaskSignal(row, columns)) return;
    const phaseText = cell(row, columns.taskPhase);
    if (phaseText) currentPhase = phaseText;
    currentPdcaStage = parsePdcaStage(cell(row, columns.pdcaStage), currentPdcaStage);
    const taskNo = cell(row, columns.taskNo);
    const title = cell(row, columns.taskTitle);
    const content = cell(row, columns.content);
    const ownerDepartments = splitDepartmentText(cell(row, columns.ownerDepartment));
    const owner = normalizeUserName(cell(row, columns.owner), projectMeta.owner ?? DEFAULT_PROJECT_OWNER);
    if (!title && !content && !taskNo) return;
    const phaseKey = currentPhase || "导入任务";
    if (!phaseOrder.includes(phaseKey)) phaseOrder.push(phaseKey);
    const krCode = `KR${Math.min(Math.max(phaseOrder.indexOf(phaseKey) + 1, 1), 8)}`;
    tasks.push({
      krCode,
      pdcaStage: currentPdcaStage,
      title: chooseTaskTitle(taskNo, title, content),
      content: content || title || chooseTaskTitle(taskNo, title, content),
      owner,
      ownerDepartment: ownerDepartments[0] ?? "总裁办",
      reviewer: projectMeta.owner ?? DEFAULT_PROJECT_OWNER,
      collaboratorDepartments: ownerDepartments,
      startDate: cell(row, columns.startDate),
      endDate: cell(row, columns.endDate),
      deliverable: cell(row, columns.deliverable) || "待确认输出成果",
      status: normalizeStatus(cell(row, columns.status)),
      riskLevel: "中"
    });
  });

  if (!tasks.length) return null;
  const startDates = tasks.map((task) => normalizeDate(task.startDate, "")).filter(Boolean);
  const endDates = tasks.map((task) => normalizeDate(task.endDate, "")).filter(Boolean);
  const collaboratorDepartments = uniqText(tasks.flatMap((task) => task.collaboratorDepartments ?? []));
  const phaseNames = phaseOrder.slice(0, 8);
  const krs: RawKr[] = phaseNames.length
    ? phaseNames.map((phase, index) => ({
        code: `KR${index + 1}`,
        title: phase,
        description: `完成${phase}相关任务`,
        metric: `按计划完成${phase}阶段任务`,
        targetValue: "按期完成",
        currentValue: "未开始",
        weight: Math.round(100 / phaseNames.length),
        owner: projectMeta.owner ?? DEFAULT_PROJECT_OWNER,
        department: "总裁办",
        reviewer: projectMeta.owner ?? DEFAULT_PROJECT_OWNER,
        startDate: startDates[0],
        endDate: endDates[endDates.length - 1],
        riskLevel: "中"
      }))
    : [{ code: "KR1", title: "完成导入任务闭环", metric: "逐行完成表格导入任务", targetValue: "全部任务按期完成" }];

  return {
    raw: {
      projectName: projectMeta.projectName,
      category: "公司专项 OKR",
      objective: projectMeta.objective || `${projectMeta.projectName}按导入计划完成关键任务闭环。`,
      background: `由 ${taskSheet.name} 表格逐行解析生成，每一行保留为一项 PDCA 任务。`,
      owner: projectMeta.owner ?? DEFAULT_PROJECT_OWNER,
      ownerDepartment: "总裁办",
      collaboratorDepartments,
      startDate: startDates.sort()[0],
      endDate: endDates.sort()[endDates.length - 1],
      priority: "中",
      riskLevel: "中",
      krs,
      pdcaTasks: tasks.slice(0, MAX_STRUCTURED_PDCA_TASKS),
      metrics: [
        {
          label: "导入任务完成率",
          base: "0%",
          target: "100%",
          current: "未开始",
          status: "未开始"
        }
      ],
      supportRequests: [],
      notes: [
        `已按 ${taskSheet.name} 从上到下解析 ${tasks.length} 行任务。`,
        "空白 PDCA 阶段已继承上一行有效阶段；责任部门已拆分为协同部门。"
      ]
    },
    notes: [
      `已按 ${taskSheet.name} 从上到下解析 ${tasks.length} 行任务。`,
      "空白 PDCA 阶段已继承上一行有效阶段；责任部门已拆分为协同部门。"
    ]
  };
}

function mergeStructuredImport(aiRaw: RawOkrImportResult, structuredRaw: RawOkrImportResult): RawOkrImportResult {
  return {
    ...aiRaw,
    ...structuredRaw,
    projectName: asText(aiRaw.projectName, asText(structuredRaw.projectName, "AI 导入 OKR 项目草稿")),
    category: asText(aiRaw.category, asText(structuredRaw.category, "公司专项 OKR")),
    objective: asText(aiRaw.objective, asText(structuredRaw.objective, "请核对导入内容后补充项目总目标。")),
    background: asText(aiRaw.background, asText(structuredRaw.background, "由导入表格结构化解析生成。")),
    owner: asText(aiRaw.owner, asText(structuredRaw.owner, DEFAULT_PROJECT_OWNER)),
    ownerDepartment: asText(aiRaw.ownerDepartment, asText(structuredRaw.ownerDepartment, "总裁办")),
    collaboratorDepartments: structuredRaw.collaboratorDepartments,
    startDate: asText(structuredRaw.startDate, asText(aiRaw.startDate)),
    endDate: asText(structuredRaw.endDate, asText(aiRaw.endDate)),
    krs: aiRaw.krs?.length ? aiRaw.krs : structuredRaw.krs,
    pdcaTasks: structuredRaw.pdcaTasks,
    metrics: aiRaw.metrics?.length ? aiRaw.metrics : structuredRaw.metrics,
    notes: uniqText([...(aiRaw.notes ?? []), ...(structuredRaw.notes ?? [])])
  };
}

function buildPrompt(sourceText: string, sourceName?: string) {
  const candidateUsers = users.map((user) => `${user.id}:${user.name}:${user.title}`).join("；");
  const candidateDepartments = departments.map((department) => `${department.id}:${department.name}`).join("；");
  return [
    "你是企业 OKR 项目拆解助手。请从用户导入的文档或表格中识别并生成一个可编辑的 OKR 项目草稿。",
    "只输出严格 JSON，不要 Markdown，不要解释。",
    "字段要求：",
    "- projectName, category, objective, background, owner, ownerDepartment, collaboratorDepartments, startDate, endDate, priority, riskLevel",
    "- krs: 每项包含 code, title, description, metric, targetValue, currentValue, weight, owner, department, reviewer, startDate, endDate, riskLevel",
    "- pdcaTasks: 每项包含 krCode, pdcaStage, title, content, owner, ownerDepartment, reviewer, collaboratorDepartments, startDate, endDate, deliverable, status, riskLevel",
    "- metrics: 每项包含 label, base, target, current, status",
    "- supportRequests, notes",
    "枚举约束：priority 只能是 高/中/低；riskLevel 只能是 高/中/低；pdcaStage 只能是 Plan/Do/Check/Act；status 优先用 未开始。",
    "如果导入内容来自任务表格，每一行都是一个独立 PDCA 任务，必须保持从上到下的原始顺序，不能合并、重排或漏掉任务行。",
    "表格中空白的任务阶段或 PDCA 阶段应继承上一行有效值；责任部门应拆分为 ownerDepartment 和 collaboratorDepartments。",
    "如果原文缺少日期，请根据内容给出合理项目周期；如果无法判断负责人或部门，优先从候选用户和候选部门中选择最接近的名称。",
    "至少输出 1 个 KR 和 1 个 PDCA 任务；不要虚构原文完全没有依据的业务结论，不能确定的地方写入 notes。",
    `候选用户：${candidateUsers}`,
    `候选部门：${candidateDepartments}`,
    `来源文件：${sourceName || "粘贴内容"}`,
    "导入内容：",
    sourceText.slice(0, MAX_SOURCE_CHARS)
  ].join("\n");
}

function normalizeKr(raw: RawKr, projectId: string, index: number, project: RawOkrImportResult, startDate: string, endDate: string): OkrKR {
  const code = asText(raw.code, `KR${index + 1}`).toUpperCase().replace(/\s+/g, "");
  const owner = asText(raw.owner, asText(project.owner, "林昱辰"));
  const department = asText(raw.department, asText(project.ownerDepartment, "总裁办"));
  const title = asText(raw.title, `${code} 关键结果`);
  const metric = asText(raw.metric, asText(raw.description, title));
  return {
    id: `${projectId}-kr${index + 1}`,
    projectId,
    code,
    title,
    description: asText(raw.description, metric),
    metric,
    targetValue: asText(raw.targetValue, "待确认"),
    currentValue: asText(raw.currentValue, "未开始"),
    weight: Number.isFinite(Number(raw.weight)) ? Math.max(0, Math.min(100, Number(raw.weight))) : Math.round(100 / Math.max(1, project.krs?.length ?? 1)),
    owner,
    department,
    reviewer: asText(raw.reviewer, asText(project.owner, "林昱辰")),
    startDate: normalizeDate(raw.startDate, startDate),
    endDate: normalizeDate(raw.endDate, endDate),
    progress: 0,
    status: "未开始",
    riskLevel: enumValue(raw.riskLevel, riskLevels, "中")
  };
}

function normalizeTask(raw: RawPdcaTask, projectId: string, index: number, krs: OkrKR[], project: RawOkrImportResult, startDate: string, endDate: string): OkrPDCATask {
  const matchedKr = krs.find((kr) => kr.code === asText(raw.krCode).toUpperCase().replace(/\s+/g, "")) ?? krs[Math.min(index, krs.length - 1)] ?? krs[0];
  const owner = asText(raw.owner, asText(project.owner, matchedKr?.owner ?? "林昱辰"));
  const ownerDepartment = asText(raw.ownerDepartment, asText(project.ownerDepartment, matchedKr?.department ?? "总裁办"));
  const title = asText(raw.title, `${enumValue(raw.pdcaStage, pdcaStages, "Plan")} 任务`);
  return {
    id: `${projectId}-pdca${index + 1}`,
    projectId,
    krId: matchedKr?.id ?? `${projectId}-kr1`,
    pdcaStage: enumValue(raw.pdcaStage, pdcaStages, index % 4 === 0 ? "Plan" : index % 4 === 1 ? "Do" : index % 4 === 2 ? "Check" : "Act"),
    title,
    content: asText(raw.content, title),
    owner,
    ownerDepartment,
    reviewer: asText(raw.reviewer, asText(project.owner, "林昱辰")),
    collaboratorDepartments: Array.isArray(raw.collaboratorDepartments) ? raw.collaboratorDepartments.filter(Boolean).map(String) : [],
    startDate: normalizeDate(raw.startDate, startDate),
    endDate: normalizeDate(raw.endDate, endDate),
    deliverable: asText(raw.deliverable, "待确认输出成果"),
    status: enumValue(raw.status, taskStatuses, "未开始"),
    riskLevel: enumValue(raw.riskLevel, riskLevels, "中")
  };
}

function normalizeMetric(raw: RawMetric, index: number): OkrMetric {
  return {
    label: asText(raw.label, `核心指标 ${index + 1}`),
    base: asText(raw.base, "待确认"),
    target: asText(raw.target, "待确认"),
    current: asText(raw.current, "未开始"),
    status: enumValue(raw.status, metricStatuses, "未开始")
  };
}

function buildDraftProject(raw: RawOkrImportResult): OkrProject {
  const projectId = `okr-import-draft-${Date.now()}`;
  const startDate = normalizeDate(raw.startDate, "2026-07-08");
  const endDate = normalizeDate(raw.endDate, "2026-09-30");
  const fallbackKrs: RawKr[] = [{ code: "KR1", title: "完成导入内容确认", metric: "形成可执行 OKR 和 PDCA 清单" }];
  const krs = (raw.krs?.length ? raw.krs : fallbackKrs).slice(0, 8).map((kr, index) => normalizeKr(kr, projectId, index, raw, startDate, endDate));
  const fallbackTasks: RawPdcaTask[] = [{ krCode: krs[0]?.code ?? "KR1", pdcaStage: "Plan", title: "确认导入 OKR 草稿", content: "核对 AI 解析出的目标、KR 和任务责任人。", deliverable: "确认后的 OKR 项目草稿" }];
  const pdcaTasks = (raw.pdcaTasks?.length ? raw.pdcaTasks : fallbackTasks)
    .slice(0, MAX_STRUCTURED_PDCA_TASKS)
    .map((task, index) => normalizeTask(task, projectId, index, krs, raw, startDate, endDate));
  const fallbackMetrics: RawMetric[] = [{ label: "项目综合进度", base: "未开始", target: "按期完成", current: "待确认", status: "未开始" }];
  const metrics = (raw.metrics?.length ? raw.metrics : fallbackMetrics)
    .slice(0, 6)
    .map(normalizeMetric);

  return {
    id: projectId,
    name: asText(raw.projectName, "AI 导入 OKR 项目草稿"),
    category: asText(raw.category, "公司专项 OKR"),
    objective: asText(raw.objective, "请核对导入内容后补充项目总目标。"),
    background: asText(raw.background, "由导入文档或表格经 AI 解析生成，提交前请人工复核。"),
    owner: asText(raw.owner, "林昱辰"),
    ownerDepartment: asText(raw.ownerDepartment, "总裁办"),
    collaboratorDepartments: Array.isArray(raw.collaboratorDepartments) ? raw.collaboratorDepartments.filter(Boolean).map(String) : [],
    startDate,
    endDate,
    periodText: `${startDate} - ${endDate}`,
    priority: enumValue(raw.priority, priorities, "中"),
    riskLevel: enumValue(raw.riskLevel, riskLevels, "中"),
    status: "草稿",
    progress: 0,
    needPresidentDecisionCount: 1,
    krs,
    pdcaTasks,
    metrics,
    relatedMeetings: [],
    relatedTasks: [],
    risks: [],
    supportRequests: Array.isArray(raw.supportRequests) ? raw.supportRequests.filter(Boolean).map(String) : []
  };
}

export async function generateOkrImportDraftWithDeepSeek(sourceText: string, sourceName?: string, spreadsheet?: SpreadsheetWorkbookPayload): Promise<OkrImportDraftResponse> {
  const text = sourceText.trim();
  if (text.length < 20) throw new Error("导入内容过短，无法生成 OKR 草稿");
  const structuredImport = buildStructuredRawImport(spreadsheet);
  let aiResult: Awaited<ReturnType<typeof generateDeepSeekJson<RawOkrImportResult>>> | undefined;
  let rawResult: RawOkrImportResult;
  try {
    aiResult = await generateDeepSeekJson<RawOkrImportResult>(buildPrompt(text, sourceName));
    rawResult = structuredImport ? mergeStructuredImport(aiResult.json, structuredImport.raw) : aiResult.json;
  } catch (error) {
    if (!structuredImport) throw error;
    rawResult = structuredImport.raw;
  }
  const draftProject = buildDraftProject(rawResult);
  return {
    draftProject,
    notes: uniqText([
      ...(Array.isArray(rawResult.notes) ? rawResult.notes.filter(Boolean).map(String) : []),
      ...(structuredImport?.notes ?? [])
    ]),
    model: aiResult?.model,
    sourceName,
    summary: {
      krCount: draftProject.krs.length,
      pdcaCount: draftProject.pdcaTasks.length,
      metricCount: draftProject.metrics.length
    }
  };
}
