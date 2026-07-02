import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { approveTaskDb, rejectTaskApprovalDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { approveTaskAction, rejectTaskApprovalAction } from "@/lib/taskActions";
import type { Task, User } from "@/lib/types";
import { notifyTaskApprovalApproved, notifyTaskApprovalRejected } from "@/lib/wecomTaskNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApprovalBody = {
  action?: unknown;
  reason?: unknown;
};

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "task_not_found") return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

function notifyTaskApprovalResult(task: Task, currentUser: User, action: unknown) {
  if (action === "approve") {
    void notifyTaskApprovalApproved(task, currentUser).catch((error) => {
      console.warn("wecom_task_approval_approved_notification_unhandled", {
        taskId: task.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }
  if (action === "reject") {
    void notifyTaskApprovalRejected(task, currentUser).catch((error) => {
      console.warn("wecom_task_approval_rejected_notification_unhandled", {
        taskId: task.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ApprovalBody;
  const { taskId } = await context.params;

  try {
    if (isDbStateReadEnabled()) {
      const task =
        body.action === "approve"
          ? await approveTaskDb(currentUser, taskId)
          : body.action === "reject"
            ? await rejectTaskApprovalDb(currentUser, taskId, typeof body.reason === "string" ? body.reason : undefined)
            : undefined;
      if (!task) throw new Error("invalid action");
      notifyTaskApprovalResult(task, currentUser, body.action);
      return NextResponse.json({ task });
    }

    let task: Task | undefined = undefined;
    await updateLocalStateWith((state) => {
      const result =
        body.action === "approve"
          ? approveTaskAction(state, currentUser, taskId)
          : body.action === "reject"
            ? rejectTaskApprovalAction(state, currentUser, taskId, typeof body.reason === "string" ? body.reason : undefined)
            : undefined;
      if (!result) throw new Error("invalid action");
      task = result.task;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    if (task) notifyTaskApprovalResult(task, currentUser, body.action);
    return NextResponse.json({ task });
  } catch (error) {
    return mapError(error);
  }
}
