import type { OkrProject, OkrProjectChangeField } from "@/lib/okrTypes";

function text(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  if (value === undefined || value === null || value === "") return "未设置";
  return String(value);
}
function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function addField(
  fields: OkrProjectChangeField[],
  original: unknown,
  proposed: unknown,
  field: string,
  label: string,
  approvalRequired: boolean
) {
  if (sameValue(original, proposed)) return;
  fields.push({
    field,
    label,
    before: text(original),
    after: text(proposed),
    approvalRequired
  });
}

function fieldById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

export function buildOkrProjectChangeFields(original: OkrProject, proposed: OkrProject) {
  const fields: OkrProjectChangeField[] = [];
  addField(fields, original.name, proposed.name, "name", "项目名称", true);
  addField(fields, original.objective, proposed.objective, "objective", "O 目标", true);
  addField(fields, original.background, proposed.background, "background", "项目背景", false);
  addField(fields, original.ownerId ?? original.owner, proposed.ownerId ?? proposed.owner, "owner", "项目负责人", true);
  addField(fields, original.ownerDepartmentId ?? original.ownerDepartment, proposed.ownerDepartmentId ?? proposed.ownerDepartment, "ownerDepartment", "主责部门", true);
  addField(fields, original.collaboratorDepartmentIds ?? original.collaboratorDepartments, proposed.collaboratorDepartmentIds ?? proposed.collaboratorDepartments, "collaboratorDepartments", "协作部门", true);
  addField(fields, original.startDate, proposed.startDate, "startDate", "项目开始时间", true);
  addField(fields, original.endDate, proposed.endDate, "endDate", "项目结束时间", true);
  addField(fields, original.periodText, proposed.periodText, "periodText", "项目周期说明", true);
  addField(fields, original.priority, proposed.priority, "priority", "优先级", true);
  addField(fields, original.riskLevel, proposed.riskLevel, "riskLevel", "风险等级", false);
  addField(fields, original.status, proposed.status, "status", "项目状态", true);
  addField(fields, original.progress, proposed.progress, "progress", "项目进度", false);

  const originalKrs = fieldById(original.krs);
  const proposedKrs = fieldById(proposed.krs);
  proposed.krs.forEach((kr) => {
    const before = originalKrs.get(kr.id);
    if (!before) {
      fields.push({ field: `kr.${kr.id}`, label: `新增 KR：${kr.code}`, before: "无", after: kr.title, approvalRequired: true });
      return;
    }
    addField(fields, before.title, kr.title, `kr.${kr.id}.title`, `${kr.code} 标题`, true);
    addField(fields, before.metric, kr.metric, `kr.${kr.id}.metric`, `${kr.code} 衡量标准`, true);
    addField(fields, before.ownerId ?? before.owner, kr.ownerId ?? kr.owner, `kr.${kr.id}.owner`, `${kr.code} 负责人`, true);
    addField(fields, before.endDate, kr.endDate, `kr.${kr.id}.endDate`, `${kr.code} 截止时间`, true);
    addField(fields, before.progress, kr.progress, `kr.${kr.id}.progress`, `${kr.code} 进度`, false);
    addField(fields, before.status, kr.status, `kr.${kr.id}.status`, `${kr.code} 状态`, false);
  });
  original.krs.forEach((kr) => {
    if (!proposedKrs.has(kr.id)) {
      fields.push({ field: `kr.${kr.id}`, label: `删除 KR：${kr.code}`, before: kr.title, after: "已删除", approvalRequired: true });
    }
  });

  const originalTasks = fieldById(original.pdcaTasks);
  const proposedTasks = fieldById(proposed.pdcaTasks);
  proposed.pdcaTasks.forEach((task) => {
    const before = originalTasks.get(task.id);
    if (!before) {
      fields.push({ field: `task.${task.id}`, label: `新增任务：${task.pdcaStage}`, before: "无", after: task.title, approvalRequired: true });
      return;
    }
    addField(fields, before.title, task.title, `task.${task.id}.title`, `任务标题：${before.title}`, true);
    addField(fields, before.ownerId ?? before.owner, task.ownerId ?? task.owner, `task.${task.id}.owner`, `任务负责人：${before.title}`, true);
    addField(fields, before.ownerDepartmentId ?? before.ownerDepartment, task.ownerDepartmentId ?? task.ownerDepartment, `task.${task.id}.department`, `任务责任部门：${before.title}`, true);
    addField(fields, before.endDate, task.endDate, `task.${task.id}.endDate`, `任务截止时间：${before.title}`, true);
    addField(fields, before.deliverable, task.deliverable, `task.${task.id}.deliverable`, `任务交付物：${before.title}`, false);
    addField(fields, before.status, task.status, `task.${task.id}.status`, `任务状态：${before.title}`, false);
  });
  original.pdcaTasks.forEach((task) => {
    if (!proposedTasks.has(task.id)) {
      fields.push({ field: `task.${task.id}`, label: `删除任务：${task.pdcaStage}`, before: task.title, after: "已删除", approvalRequired: true });
    }
  });

  return fields;
}

export function summarizeOkrProjectChange(fields: OkrProjectChangeField[]) {
  if (!fields.length) return "无字段变更";
  const critical = fields.filter((field) => field.approvalRequired).length;
  const light = fields.length - critical;
  return `${fields.length} 项变更，其中 ${critical} 项影响周期、责任、目标或任务结构，${light} 项为轻量信息调整。`;
}
