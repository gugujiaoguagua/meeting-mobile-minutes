import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { approveTasksDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { approveTaskAction } from "@/lib/taskActions";
import type { Task, User } from "@/lib/types";
import { notifyTaskApprovalApproved } from "@/lib/wecomTaskNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BatchApprovalBody = {
  action?: unknown;
  taskIds?: unknown;
};

function normalizeTaskIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function notifyApprovedTasks(tasks: Task[], currentUser: User) {
  tasks.forEach((task) => {
    void notifyTaskApprovalApproved(task, currentUser).catch((error) => {
      console.warn("wecom_task_batch_approval_notification_unhandled", {
        taskId: task.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (currentUser.role !== "总裁") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as BatchApprovalBody;
  if (body.action !== "approve") return NextResponse.json({ error: "invalid action" }, { status: 400 });

  const taskIds = normalizeTaskIds(body.taskIds);
  if (!taskIds.length) return NextResponse.json({ error: "taskIds_required" }, { status: 400 });

  if (isDbStateReadEnabled()) {
    const { approvedTasks, failed } = await approveTasksDb(currentUser, taskIds);
    notifyApprovedTasks(approvedTasks, currentUser);
    const status = approvedTasks.length ? 200 : 400;
    return NextResponse.json({ ok: approvedTasks.length > 0, approvedCount: approvedTasks.length, failed, tasks: approvedTasks }, { status });
  }

  const approvedTasks: Task[] = [];
  const failed: Array<{ taskId: string; error: string }> = [];
  await updateLocalStateWith((state) => {
    let nextState = state;
    taskIds.forEach((taskId) => {
      try {
        const result = approveTaskAction(nextState, currentUser, taskId);
        nextState = { ...nextState, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
        approvedTasks.push(result.task);
      } catch (error) {
        failed.push({ taskId, error: error instanceof Error ? error.message : "unknown_error" });
      }
    });
    return nextState;
  });

  notifyApprovedTasks(approvedTasks, currentUser);
  const status = approvedTasks.length ? 200 : 400;
  return NextResponse.json({ ok: approvedTasks.length > 0, approvedCount: approvedTasks.length, failed, tasks: approvedTasks }, { status });
}
