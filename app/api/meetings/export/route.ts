import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readVisibleDbState } from "@/lib/dbStateStore";
import { readVisibleLocalState } from "@/lib/localStateStore";
import { getMeetingObjectBuffer } from "@/lib/objectStorage";
import { canUserAccessStorageObject } from "@/lib/storageObjectAcl";
import { findStorageObjectsByOwner } from "@/lib/storageObjectDb";
import type { Department, Meeting, StorageObjectRecord, Task, User } from "@/lib/types";
import { createStoredZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 140) || fallback;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "未设置";
}

function getIds(request: Request) {
  const { searchParams } = new URL(request.url);
  return [...new Set(searchParams.getAll("meetingId").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}

function findUserName(users: User[], userId?: string) {
  return users.find((user) => user.id === userId)?.name ?? userId ?? "未设置";
}

function findDepartmentName(departments: Department[], departmentId?: string) {
  return departments.find((department) => department.id === departmentId)?.name ?? departmentId ?? "未设置";
}

function taskMarkdown(task: Task, users: User[], departments: Department[]) {
  return [
    `### ${task.title || task.content || task.id}`,
    "",
    `- 任务ID: ${task.id}`,
    `- 推进人: ${findUserName(users, task.ownerId) || task.owner || "未设置"}`,
    `- 责任部门: ${findDepartmentName(departments, task.departmentId) || task.ownerDepartment || "未设置"}`,
    `- 复核人: ${findUserName(users, task.reviewerId)}`,
    `- 开始日期: ${task.startDate || "未设置"}`,
    `- 截止日期: ${task.dueDate || "未设置"}`,
    `- 优先级: ${task.priority}`,
    `- 状态: ${task.status}`,
    `- 签批状态: ${task.approvalStatus || "未设置"}`,
    "",
    task.content || task.description || "",
    "",
    "达成目标：",
    task.goal || "未设置",
    "",
    "完成内容：",
    ...(task.completionItems?.length ? task.completionItems.map((item, index) => `${index + 1}. ${item}`) : ["暂无"])
  ].join("\n");
}

function meetingMarkdown(meeting: Meeting, tasks: Task[], users: User[], departments: Department[]) {
  return [
    `# ${meeting.title}`,
    "",
    "## 基本信息",
    "",
    `- 会议ID: ${meeting.id}`,
    `- 所属部门: ${findDepartmentName(departments, meeting.departmentId)}`,
    `- 会议类型: ${meeting.type}`,
    `- 主持人: ${findUserName(users, meeting.hostId)}`,
    `- 参会人: ${(meeting.participantIds ?? []).map((id) => findUserName(users, id)).join("、") || "未设置"}`,
    `- 开始时间: ${meeting.startTime}`,
    `- 时长: ${meeting.durationMinutes} 分钟`,
    `- 人工时: ${meeting.totalManHours ?? "未设置"}`,
    `- 状态: ${meeting.status}`,
    `- 签批状态: ${meeting.approvalStatus || "未设置"}`,
    `- 来源文件: ${meeting.sourceFileName || meeting.uploadedFileName || "未设置"}`,
    `- 关联 OKR: ${meeting.okrProjectName || meeting.okrProjectId || "无"}`,
    "",
    "## 会议摘要",
    "",
    meeting.aiSummary || meeting.summary || "暂无",
    "",
    "## 会议结论",
    "",
    ...(meeting.conclusions?.length ? meeting.conclusions.map((item, index) => `${index + 1}. ${item}`) : ["暂无"]),
    "",
    "## 决策",
    "",
    ...(meeting.decisions?.length
      ? meeting.decisions.map((decision, index) => `${index + 1}. ${decision.content}（决策人：${findUserName(users, decision.ownerId)}；影响范围：${decision.impactScope}）`)
      : ["暂无"]),
    "",
    "## 关联待办",
    "",
    ...(tasks.length ? tasks.map((task) => taskMarkdown(task, users, departments)) : ["暂无"]),
    "",
    "## AI 标准会议纪要",
    "",
    meeting.minuteMarkdown || "暂无",
    "",
    "## 原始记录 / 转写",
    "",
    meeting.transcript || meeting.rawTranscript || "暂无"
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

async function accessibleObjects(meeting: Meeting, currentUser: User) {
  if (!isDbStateReadEnabled()) return [];
  try {
    const objects = await findStorageObjectsByOwner("meeting", meeting.id);
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

  const ids = getIds(request);
  if (!ids.length) return NextResponse.json({ error: "missing meetingId" }, { status: 400 });

  const state = isDbStateReadEnabled() ? await readVisibleDbState(currentUser) : await readVisibleLocalState(currentUser);
  const idSet = new Set(ids);
  const meetings = state.meetings.filter((meeting) => idSet.has(meeting.id));
  if (!meetings.length) return NextResponse.json({ error: "no exportable meetings" }, { status: 404 });

  const entries: Array<{ name: string; data: Buffer | string }> = [];
  for (const meeting of meetings) {
    const folder = `meetings/${safeName(meeting.title, meeting.id)}-${meeting.id}`;
    const tasks = state.tasks.filter((task) => task.meetingId === meeting.id);
    entries.push({ name: `${folder}/会议导出.md`, data: meetingMarkdown(meeting, tasks, state.users, state.departments) });
    entries.push({ name: `${folder}/meeting.json`, data: JSON.stringify({ meeting, tasks }, null, 2) });

    const objects = await accessibleObjects(meeting, currentUser);
    for (const object of objects) {
      try {
        entries.push({
          name: `${folder}/attachments/${safeName(object.originalName, `${object.category}-${object.id}.bin`)}`,
          data: await getMeetingObjectBuffer(object.objectKey)
        });
      } catch (error) {
        entries.push({
          name: `${folder}/attachments/${safeName(object.originalName, object.id)}.download-error.txt`,
          data: `附件读取失败：${textValue(error instanceof Error ? error.message : "unknown_error")}`
        });
      }
    }
  }

  return zipResponse(createStoredZip(entries), `meetings-export-${Date.now()}.zip`);
}
