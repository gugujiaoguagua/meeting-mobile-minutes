import type { PoolClient } from "pg";
import { dbQuery, withDbTransaction, type DbExecutor } from "@/lib/db";
import type {
  OkrKR,
  OkrKrStatus,
  OkrPDCATask,
  OkrPdcaStage,
  OkrPriority,
  OkrProject,
  OkrProjectStatus,
  OkrRiskLevel,
  OkrTaskProgressEntry,
  OkrTaskStatus
} from "@/lib/okrTypes";

type DbRow = Record<string, unknown>;

function toJson(value: unknown, fallback: unknown[] = []) {
  return JSON.stringify(value ?? fallback);
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stringArray(value: unknown) {
  return arrayValue(value).filter((item): item is string => typeof item === "string");
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function dateString(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

function optionalDateTimeString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : undefined;
}

function jsonArray<T>(value: unknown): T[] {
  return arrayValue(value) as T[];
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function mapKr(row: DbRow): OkrKR {
  return {
    id: stringValue(row.id),
    projectId: stringValue(row.project_id),
    code: stringValue(row.code),
    title: stringValue(row.title),
    description: stringValue(row.description),
    metric: stringValue(row.metric),
    targetValue: optionalString(row.target_value),
    currentValue: optionalString(row.current_value),
    weight: numberValue(row.weight),
    owner: stringValue(row.owner_label),
    ownerId: optionalString(row.owner_id),
    department: stringValue(row.department_label),
    departmentId: optionalString(row.department_id),
    reviewer: optionalString(row.reviewer_label),
    reviewerId: optionalString(row.reviewer_id),
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    progress: numberValue(row.progress),
    status: stringValue(row.status, "未开始") as OkrKrStatus,
    riskLevel: stringValue(row.risk_level, "中") as OkrRiskLevel
  };
}

function mapOkrTaskProgressEntry(row: DbRow): OkrTaskProgressEntry {
  return {
    id: stringValue(row.id),
    submittedAt: optionalDateTimeString(row.submitted_at) ?? "",
    submittedBy: optionalString(row.submitted_by),
    targetStatus: optionalString(row.target_status) as OkrTaskStatus | undefined,
    items: stringArray(row.items)
  };
}

function mapPdcaTask(row: DbRow, completionHistory: OkrTaskProgressEntry[] = []): OkrPDCATask {
  return {
    id: stringValue(row.id),
    projectId: stringValue(row.project_id),
    krId: stringValue(row.kr_id),
    pdcaStage: stringValue(row.pdca_stage, "Plan") as OkrPdcaStage,
    title: stringValue(row.title),
    content: stringValue(row.content),
    owner: stringValue(row.owner_label),
    ownerId: optionalString(row.owner_id),
    ownerDepartment: stringValue(row.owner_department_label),
    ownerDepartmentId: optionalString(row.owner_department_id),
    reviewer: optionalString(row.reviewer_label),
    reviewerId: optionalString(row.reviewer_id),
    collaboratorDepartments: stringArray(row.collaborator_department_labels),
    collaboratorDepartmentIds: stringArray(row.collaborator_department_ids),
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    deliverable: stringValue(row.deliverable),
    status: stringValue(row.status, "未开始") as OkrTaskStatus,
    riskLevel: stringValue(row.risk_level, "中") as OkrRiskLevel,
    completionItems: stringArray(row.completion_items),
    reviewSubmittedAt: optionalDateTimeString(row.review_submitted_at),
    reviewTargetStatus: optionalString(row.review_target_status) as OkrTaskStatus | undefined,
    reviewedAt: optionalDateTimeString(row.reviewed_at),
    reviewRejectedAt: optionalDateTimeString(row.review_rejected_at),
    reviewRejectedReason: optionalString(row.review_rejected_reason),
    reviewRejectedItems: stringArray(row.review_rejected_items),
    completionHistory
  };
}

function mapProject(row: DbRow, krs: OkrKR[], pdcaTasks: OkrPDCATask[]): OkrProject {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    category: stringValue(row.category),
    objective: stringValue(row.objective),
    background: stringValue(row.background),
    owner: stringValue(row.owner_label),
    ownerId: optionalString(row.owner_id),
    ownerDepartment: stringValue(row.owner_department_label),
    ownerDepartmentId: optionalString(row.owner_department_id),
    collaboratorDepartments: stringArray(row.collaborator_department_labels),
    collaboratorDepartmentIds: stringArray(row.collaborator_department_ids),
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    periodText: optionalString(row.period_text),
    priority: stringValue(row.priority, "中") as OkrPriority,
    riskLevel: stringValue(row.risk_level, "中") as OkrRiskLevel,
    status: stringValue(row.status, "草稿") as OkrProjectStatus,
    progress: numberValue(row.progress),
    needPresidentDecisionCount: numberValue(row.need_president_decision_count),
    krs,
    pdcaTasks,
    metrics: jsonArray(row.metrics),
    relatedMeetings: jsonArray(row.related_meetings),
    relatedTasks: jsonArray(row.related_tasks),
    risks: jsonArray(row.risks),
    supportRequests: stringArray(row.support_requests)
  };
}

async function upsertProject(client: PoolClient, project: OkrProject) {
  await client.query(
    `
      insert into okr_projects (
        id, name, category, objective, background, owner_id, owner_label,
        owner_department_id, owner_department_label, collaborator_department_ids,
        collaborator_department_labels, start_date, end_date, period_text, priority,
        risk_level, status, progress, need_president_decision_count, metrics,
        related_meetings, related_tasks, risks, support_requests, updated_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,
        $21,$22,$23,$24,now()
      )
      on conflict (id) do update set
        name = excluded.name,
        category = excluded.category,
        objective = excluded.objective,
        background = excluded.background,
        owner_id = excluded.owner_id,
        owner_label = excluded.owner_label,
        owner_department_id = excluded.owner_department_id,
        owner_department_label = excluded.owner_department_label,
        collaborator_department_ids = excluded.collaborator_department_ids,
        collaborator_department_labels = excluded.collaborator_department_labels,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        period_text = excluded.period_text,
        priority = excluded.priority,
        risk_level = excluded.risk_level,
        status = excluded.status,
        progress = excluded.progress,
        need_president_decision_count = excluded.need_president_decision_count,
        metrics = excluded.metrics,
        related_meetings = excluded.related_meetings,
        related_tasks = excluded.related_tasks,
        risks = excluded.risks,
        support_requests = excluded.support_requests,
        updated_at = excluded.updated_at
    `,
    [
      project.id,
      project.name,
      project.category,
      project.objective,
      project.background,
      project.ownerId ?? null,
      project.owner,
      project.ownerDepartmentId ?? null,
      project.ownerDepartment,
      toJson(project.collaboratorDepartmentIds),
      toJson(project.collaboratorDepartments),
      project.startDate,
      project.endDate,
      project.periodText ?? null,
      project.priority,
      project.riskLevel,
      project.status,
      project.progress,
      project.needPresidentDecisionCount,
      toJson(project.metrics),
      toJson(project.relatedMeetings),
      toJson(project.relatedTasks),
      toJson(project.risks),
      toJson(project.supportRequests)
    ]
  );
}

async function syncKrs(client: PoolClient, project: OkrProject) {
  const ids = project.krs.map((kr) => kr.id);
  if (ids.length) {
    await client.query("delete from okr_krs where project_id = $1 and not (id = any($2::text[]))", [project.id, ids]);
  } else {
    await client.query("delete from okr_krs where project_id = $1", [project.id]);
  }

  for (const kr of project.krs) {
    await client.query(
      `
        insert into okr_krs (
          id, project_id, code, title, description, metric, target_value, current_value,
          weight, owner_id, owner_label, department_id, department_label, reviewer_id,
          reviewer_label, start_date, end_date, progress, status, risk_level, updated_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
        on conflict (id) do update set
          project_id = excluded.project_id,
          code = excluded.code,
          title = excluded.title,
          description = excluded.description,
          metric = excluded.metric,
          target_value = excluded.target_value,
          current_value = excluded.current_value,
          weight = excluded.weight,
          owner_id = excluded.owner_id,
          owner_label = excluded.owner_label,
          department_id = excluded.department_id,
          department_label = excluded.department_label,
          reviewer_id = excluded.reviewer_id,
          reviewer_label = excluded.reviewer_label,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          progress = excluded.progress,
          status = excluded.status,
          risk_level = excluded.risk_level,
          updated_at = excluded.updated_at
      `,
      [
        kr.id,
        project.id,
        kr.code,
        kr.title,
        kr.description,
        kr.metric,
        kr.targetValue ?? null,
        kr.currentValue ?? null,
        kr.weight,
        kr.ownerId ?? null,
        kr.owner,
        kr.departmentId ?? null,
        kr.department,
        kr.reviewerId ?? null,
        kr.reviewer ?? null,
        kr.startDate,
        kr.endDate,
        kr.progress,
        kr.status,
        kr.riskLevel
      ]
    );
  }
}

async function syncPdcaTasks(client: PoolClient, project: OkrProject) {
  const ids = project.pdcaTasks.map((task) => task.id);
  if (ids.length) {
    await client.query("delete from okr_pdca_tasks where project_id = $1 and not (id = any($2::text[]))", [project.id, ids]);
  } else {
    await client.query("delete from okr_pdca_tasks where project_id = $1", [project.id]);
  }

  for (const task of project.pdcaTasks) {
    await client.query(
      `
        insert into okr_pdca_tasks (
          id, project_id, kr_id, pdca_stage, title, content, owner_id, owner_label,
          owner_department_id, owner_department_label, reviewer_id, reviewer_label,
          collaborator_department_ids, collaborator_department_labels, start_date, end_date,
          deliverable, status, risk_level, completion_items, review_submitted_at,
          review_target_status, reviewed_at, review_rejected_at, review_rejected_reason,
          review_rejected_items, updated_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,now())
        on conflict (id) do update set
          project_id = excluded.project_id,
          kr_id = excluded.kr_id,
          pdca_stage = excluded.pdca_stage,
          title = excluded.title,
          content = excluded.content,
          owner_id = excluded.owner_id,
          owner_label = excluded.owner_label,
          owner_department_id = excluded.owner_department_id,
          owner_department_label = excluded.owner_department_label,
          reviewer_id = excluded.reviewer_id,
          reviewer_label = excluded.reviewer_label,
          collaborator_department_ids = excluded.collaborator_department_ids,
          collaborator_department_labels = excluded.collaborator_department_labels,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          deliverable = excluded.deliverable,
          status = excluded.status,
          risk_level = excluded.risk_level,
          completion_items = excluded.completion_items,
          review_submitted_at = excluded.review_submitted_at,
          review_target_status = excluded.review_target_status,
          reviewed_at = excluded.reviewed_at,
          review_rejected_at = excluded.review_rejected_at,
          review_rejected_reason = excluded.review_rejected_reason,
          review_rejected_items = excluded.review_rejected_items,
          updated_at = excluded.updated_at
      `,
      [
        task.id,
        project.id,
        task.krId,
        task.pdcaStage,
        task.title,
        task.content,
        task.ownerId ?? null,
        task.owner,
        task.ownerDepartmentId ?? null,
        task.ownerDepartment,
        task.reviewerId ?? null,
        task.reviewer ?? null,
        toJson(task.collaboratorDepartmentIds),
        toJson(task.collaboratorDepartments),
        task.startDate,
        task.endDate,
        task.deliverable,
        task.status,
        task.riskLevel,
        toJson(task.completionItems),
        task.reviewSubmittedAt ?? null,
        task.reviewTargetStatus ?? null,
        task.reviewedAt ?? null,
        task.reviewRejectedAt ?? null,
        task.reviewRejectedReason ?? null,
        toJson(task.reviewRejectedItems)
      ]
    );
  }
}

export async function readOkrProjects(executor: DbExecutor = { query: dbQuery }) {
  const [projectsResult, krsResult, pdcaTasksResult, progressResult] = await Promise.all([
    executor.query("select * from okr_projects order by created_at desc, id"),
    executor.query("select * from okr_krs order by project_id, code, id"),
    executor.query("select * from okr_pdca_tasks order by project_id, kr_id, start_date, id"),
    executor.query("select * from okr_pdca_task_progress_entries order by submitted_at, id")
  ]);
  const krsByProject = groupBy(krsResult.rows.map(mapKr), (kr) => kr.projectId);
  const progressByTask = groupBy(
    progressResult.rows.map((row) => ({
      taskId: stringValue(row.task_id),
      entry: mapOkrTaskProgressEntry(row)
    })),
    (item) => item.taskId
  );
  const tasksByProject = groupBy(
    pdcaTasksResult.rows.map((row) => mapPdcaTask(row, (progressByTask.get(stringValue(row.id)) ?? []).map((item) => item.entry))),
    (task) => task.projectId
  );
  return projectsResult.rows.map((row) => {
    const id = stringValue(row.id);
    return mapProject(row, krsByProject.get(id) ?? [], tasksByProject.get(id) ?? []);
  });
}

export async function saveOkrProject(project: OkrProject) {
  return withDbTransaction(async (client) => {
    await upsertProject(client, project);
    await syncKrs(client, project);
    await syncPdcaTasks(client, project);
    return project;
  });
}

export async function deleteOkrProject(projectId: string) {
  const result = await dbQuery("delete from okr_projects where id = $1 returning id", [projectId]);
  return Boolean(result.rowCount);
}

export async function updateOkrKrStatus(krId: string, status: OkrKrStatus) {
  const result = await dbQuery<OkrKR & { project_id: string }>(
    `
      update okr_krs
      set status = $2, updated_at = now()
      where id = $1
      returning *
    `,
    [krId, status]
  );
  if (!result.rowCount) throw new Error("okr_kr_not_found");
  return mapKr(result.rows[0]);
}

export async function updateOkrPdcaTaskStatus(
  taskId: string,
  status: OkrTaskStatus,
  reviewTargetStatus?: OkrTaskStatus,
  reviewAction?: "submit" | "confirm" | "reject",
  reviewRejectedReason?: string,
  reviewRejectedItems?: string[],
  submittedBy?: string
) {
  const now = new Date().toISOString();
  const reviewSubmittedAt = status === "已提交待复核" ? now : null;
  const reviewedAt = reviewAction === "confirm" || status === "已完成" ? now : null;
  return withDbTransaction(async (client) => {
    const result = await client.query(
    `
      update okr_pdca_tasks
      set
        status = $2,
        review_submitted_at = coalesce($3::timestamptz, review_submitted_at),
        review_target_status = case when $2 = '已提交待复核' then coalesce($5::text, '已完成') else null end,
        reviewed_at = case
          when $2 = '已提交待复核' then null
          when $6 = 'confirm' or $2 = '已完成' then $4::timestamptz
          else reviewed_at
        end,
        review_rejected_at = case
          when $6 = 'reject' then now()
          when $2 = '已提交待复核' or $6 = 'confirm' then null
          else review_rejected_at
        end,
        review_rejected_reason = case
          when $6 = 'reject' then $7::text
          when $2 = '已提交待复核' or $6 = 'confirm' then null
          else review_rejected_reason
        end,
        review_rejected_items = case
          when $6 = 'reject' then $8::jsonb
          when $2 = '已提交待复核' or $6 = 'confirm' then '[]'::jsonb
          else review_rejected_items
        end,
        updated_at = now()
      where id = $1
      returning *
    `,
    [taskId, status, reviewSubmittedAt, reviewedAt, reviewTargetStatus ?? null, reviewAction ?? null, reviewRejectedReason ?? null, toJson(reviewRejectedItems ?? [])]
    );
    if (!result.rowCount) throw new Error("okr_pdca_task_not_found");

    if (reviewAction === "submit") {
      await client.query(
        `
          insert into okr_pdca_task_progress_entries (id, task_id, submitted_at, submitted_by, target_status, items)
          select $1, id, $2::timestamptz, $3, coalesce($4::text, '已完成'), completion_items
          from okr_pdca_tasks
          where id = $5 and jsonb_array_length(completion_items) > 0
          on conflict (id) do nothing
        `,
        [`okr-task-progress-${taskId}-${Date.now()}`, now, submittedBy ?? null, reviewTargetStatus ?? "已完成", taskId]
      );
    }

    const progressResult = await client.query("select * from okr_pdca_task_progress_entries where task_id = $1 order by submitted_at, id", [taskId]);
    return mapPdcaTask(result.rows[0], progressResult.rows.map(mapOkrTaskProgressEntry));
  });
}

export async function updateOkrPdcaTaskCompletionItems(taskId: string, completionItems: string[]) {
  const result = await dbQuery(
    `
      update okr_pdca_tasks
      set completion_items = $2, updated_at = now()
      where id = $1
      returning *
    `,
    [taskId, toJson(completionItems)]
  );
  if (!result.rowCount) throw new Error("okr_pdca_task_not_found");
  return mapPdcaTask(result.rows[0]);
}
