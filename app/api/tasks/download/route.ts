import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readDbState, readVisibleDbState } from "@/lib/dbStateStore";
import { readLocalState, readVisibleLocalState } from "@/lib/localStateStore";
import { readOkrProjects } from "@/lib/okrDbStore";
import type { OkrPDCATask, OkrProject } from "@/lib/okrTypes";
import { canViewOkrProject, canViewTask } from "@/lib/permission";
import type { Meeting, Task, User } from "@/lib/types";
import { createStoredZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || fallback;
}

function taskMarkdown(task: Task, meeting?: Meeting) {
  return [
    `# ${task.title || task.content || task.id}`,
    "",
    `- 类型: 会议待办`,
    `- 任务ID: ${task.id}`,
    `- 来源会议: ${meeting?.title || task.meetingId || task.sourceMeetingId || "未关联"}`,
    `- 负责人: ${task.owner || task.ownerId || "未设置"}`,
    `- 责任部门: ${task.ownerDepartment || task.departmentId || "未设置"}`,
    `- 复核人: ${task.reviewerId || "未设置"}`,
    `- 开始日期: ${task.startDate || "未设置"}`,
    `- 截止日期: ${task.dueDate || "未设置"}`,
    `- 优先级: ${task.priority}`,
    `- 状态: ${task.status}`,
    `- 签批状态: ${task.approvalStatus || "未设置"}`,
    "",
    "## 任务内容",
    task.content || task.description || "",
    "",
    "## 达成目标",
    task.goal || "",
    "",
    "## 完成内容",
    ...(task.completionItems?.length ? task.completionItems.map((item, index) => `${index + 1}. ${item}`) : ["暂无"]),
    "",
    "## 来源追溯",
    task.sourceTraceLabel || task.sourceText || task.sourceFileName || ""
  ].join("\n");
}

function okrTaskMarkdown(project: OkrProject, task: OkrPDCATask) {
  const kr = project.krs.find((item) => item.id === task.krId);
  return [
    `# ${task.title || task.id}`,
    "",
    `- 类型: OKR PDCA 任务`,
    `- 任务ID: ${task.id}`,
    `- OKR项目: ${project.name}`,
    `- KR: ${kr ? `${kr.code} ${kr.title}` : task.krId}`,
    `- PDCA阶段: ${task.pdcaStage}`,
    `- 负责人: ${task.owner || task.ownerId || "未设置"}`,
    `- 责任部门: ${task.ownerDepartment || task.ownerDepartmentId || "未设置"}`,
    `- 复核人: ${task.reviewer || task.reviewerId || "未设置"}`,
    `- 计划日期: ${task.startDate} 至 ${task.endDate}`,
    `- 状态: ${task.status}`,
    `- 风险: ${task.riskLevel}`,
    "",
    "## 任务内容",
    task.content || "",
    "",
    "## 输出成果",
    task.deliverable || "",
    "",
    "## 完成内容",
    ...(task.completionItems?.length ? task.completionItems.map((item, index) => `${index + 1}. ${item}`) : ["暂无"])
  ].join("\n");
}

function downloadResponse(body: Buffer | string, fileName: string, contentType: string) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store"
    }
  });
}

async function visibleMeetingTasks(currentUser: User) {
  const state = isDbStateReadEnabled() ? await readVisibleDbState(currentUser) : await readVisibleLocalState(currentUser);
  return {
    meetings: state.meetings,
    tasks: state.tasks
  };
}

async function visibleOkrProjects(currentUser: User) {
  if (!isDbStateReadEnabled()) return [];
  return (await readOkrProjects()).filter((project) => canViewOkrProject(currentUser, project));
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId")?.trim();
  if (taskId) {
    const fullState = isDbStateReadEnabled() ? await readDbState() : await readLocalState();
    const task = fullState.tasks.find((item) => item.id === taskId);
    if (task) {
      if (!canViewTask(currentUser, task, fullState.meetings, fullState)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const meeting = fullState.meetings.find((item) => item.id === task.meetingId || item.id === task.sourceMeetingId);
      return downloadResponse(taskMarkdown(task, meeting), `${safeName(task.title || task.content, task.id)}.md`, "text/markdown; charset=utf-8");
    }

    const okrProjects = await visibleOkrProjects(currentUser);
    for (const project of okrProjects) {
      const okrTask = project.pdcaTasks.find((item) => item.id === taskId);
      if (okrTask) {
        return downloadResponse(okrTaskMarkdown(project, okrTask), `${safeName(okrTask.title, okrTask.id)}.md`, "text/markdown; charset=utf-8");
      }
    }
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const [{ meetings, tasks }, okrProjects] = await Promise.all([visibleMeetingTasks(currentUser), visibleOkrProjects(currentUser)]);
  const entries = [
    ...tasks.map((task) => ({
      name: `meeting-tasks/${safeName(task.title || task.content, task.id)}-${task.id}.md`,
      data: taskMarkdown(task, meetings.find((meeting) => meeting.id === task.meetingId || meeting.id === task.sourceMeetingId))
    })),
    ...okrProjects.flatMap((project) =>
      project.pdcaTasks.map((task) => ({
        name: `okr-tasks/${safeName(project.name, project.id)}/${safeName(task.title, task.id)}-${task.id}.md`,
        data: okrTaskMarkdown(project, task)
      }))
    )
  ];

  if (!entries.length) return NextResponse.json({ error: "no downloadable tasks" }, { status: 404 });
  return downloadResponse(createStoredZip(entries), `meeting-tasks-${Date.now()}.zip`, "application/zip");
}
