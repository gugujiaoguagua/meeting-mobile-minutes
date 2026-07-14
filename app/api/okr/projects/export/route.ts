import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { getMeetingObjectBuffer } from "@/lib/objectStorage";
import { readOkrProjects } from "@/lib/okrDbStore";
import type { OkrProject } from "@/lib/okrTypes";
import { canViewOkrProject } from "@/lib/permission";
import { canUserAccessStorageObject } from "@/lib/storageObjectAcl";
import { findStorageObjectsByOwner } from "@/lib/storageObjectDb";
import type { StorageObjectRecord, User } from "@/lib/types";
import { createStoredZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 140) || fallback;
}

function getIds(request: Request) {
  const { searchParams } = new URL(request.url);
  return [...new Set(searchParams.getAll("projectId").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}

function list(items: string[]) {
  return items.length ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "暂无";
}

function projectMarkdown(project: OkrProject) {
  return [
    `# ${project.name}`,
    "",
    "## 基本信息",
    "",
    `- 项目ID: ${project.id}`,
    `- 类型: ${project.category}`,
    `- O 目标: ${project.objective}`,
    `- 背景: ${project.background || "未设置"}`,
    `- 负责人: ${project.owner}`,
    `- 主责部门: ${project.ownerDepartment}`,
    `- 协同部门: ${project.collaboratorDepartments.join("、") || "未设置"}`,
    `- 周期: ${project.periodText || `${project.startDate} - ${project.endDate}`}`,
    `- 优先级: ${project.priority}`,
    `- 风险: ${project.riskLevel}`,
    `- 状态: ${project.status}`,
    `- 当前进度: ${project.progress}%`,
    `- 总裁关注事项: ${project.needPresidentDecisionCount}`,
    "",
    "## 核心指标",
    "",
    list(project.metrics.map((metric) => `${metric.label}：基准 ${metric.base}；目标 ${metric.target}；当前 ${metric.current}；状态 ${metric.status}`)),
    "",
    "## KR",
    "",
    list(project.krs.map((kr) => `${kr.code} ${kr.title}：${kr.metric}；负责人 ${kr.owner}；部门 ${kr.department}；进度 ${kr.progress}%；状态 ${kr.status}；风险 ${kr.riskLevel}`)),
    "",
    "## PDCA 任务",
    "",
    list(project.pdcaTasks.map((task) => `${task.pdcaStage} / ${task.title}：${task.content}；负责人 ${task.owner}；部门 ${task.ownerDepartment}；计划 ${task.startDate} 至 ${task.endDate}；输出 ${task.deliverable}；状态 ${task.status}；风险 ${task.riskLevel}`)),
    "",
    "## 关联会议",
    "",
    list(project.relatedMeetings.map((meeting) => `${meeting.title}：${meeting.date}；主持人 ${meeting.host}；决策 ${meeting.decision}；待办 ${meeting.todoCount} 项；状态 ${meeting.status}`)),
    "",
    "## 关联待办",
    "",
    list(project.relatedTasks.map((task) => `${task.content}：来源 ${task.sourceMeeting}；责任人 ${task.owner}；部门 ${task.ownerDepartment}；截止 ${task.dueDate}；状态 ${task.status}；风险 ${task.riskLevel}`)),
    "",
    "## 风险与卡点",
    "",
    list(project.risks.map((risk) => `${risk.description}：部门 ${risk.departments.join("、")}；风险 ${risk.riskLevel}；影响 ${risk.impact}；建议 ${risk.suggestion}`)),
    "",
    "## 公司支持",
    "",
    list(project.supportRequests)
  ].join("\n");
}

function zipResponse(zip: Buffer, fileName: string) {
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store"
    }
  });
}

async function accessibleObjects(project: OkrProject, currentUser: User) {
  if (!isDbStateReadEnabled()) return [];
  try {
    const objects = await findStorageObjectsByOwner("okr_project", project.id);
    if (currentUser.role === "总裁") return objects;
    const accessible: StorageObjectRecord[] = [];
    for (const object of objects) {
      if (await canUserAccessStorageObject(object.id, currentUser.id)) accessible.push(object);
    }
    return accessible;
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!isDbStateReadEnabled()) return NextResponse.json({ error: "okr export requires database state" }, { status: 409 });

  const ids = getIds(request);
  if (!ids.length) return NextResponse.json({ error: "missing projectId" }, { status: 400 });

  const idSet = new Set(ids);
  const projects = (await readOkrProjects()).filter((project) => idSet.has(project.id) && canViewOkrProject(currentUser, project));
  if (!projects.length) return NextResponse.json({ error: "no exportable okr projects" }, { status: 404 });

  const entries: Array<{ name: string; data: Buffer | string }> = [];
  for (const project of projects) {
    const folder = `okr-projects/${safeName(project.name, project.id)}-${project.id}`;
    entries.push({ name: `${folder}/OKR项目导出.md`, data: projectMarkdown(project) });
    entries.push({ name: `${folder}/okr-project.json`, data: JSON.stringify(project, null, 2) });

    const objects = await accessibleObjects(project, currentUser);
    for (const object of objects) {
      try {
        entries.push({
          name: `${folder}/attachments/${safeName(object.originalName, `${object.category}-${object.id}.bin`)}`,
          data: await getMeetingObjectBuffer(object.objectKey)
        });
      } catch (error) {
        entries.push({
          name: `${folder}/attachments/${safeName(object.originalName, object.id)}.download-error.txt`,
          data: `附件读取失败：${error instanceof Error ? error.message : "unknown_error"}`
        });
      }
    }
  }

  return zipResponse(createStoredZip(entries), `okr-projects-export-${Date.now()}.zip`);
}
