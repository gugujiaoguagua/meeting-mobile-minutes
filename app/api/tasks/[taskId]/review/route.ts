import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { confirmTaskReviewDb, rejectTaskReviewDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { confirmTaskReviewAction, rejectTaskReviewAction } from "@/lib/taskActions";
import type { Task, User } from "@/lib/types";
import { notifyTaskReviewConfirmed, notifyTaskReviewRejected } from "@/lib/wecomTaskNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewBody = {
  action?: unknown;
  reasonItems?: unknown;
};

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "task_not_found") return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

function notifyReviewResult(task: Task, currentUser: User, action: unknown) {
  if (action === "confirm") {
    void notifyTaskReviewConfirmed(task, currentUser).catch((error) => {
      console.warn("wecom_review_confirm_notification_unhandled", { taskId: task.id, message: error instanceof Error ? error.message : "unknown_error" });
    });
  }
  if (action === "reject") {
    void notifyTaskReviewRejected(task, currentUser).catch((error) => {
      console.warn("wecom_review_reject_notification_unhandled", { taskId: task.id, message: error instanceof Error ? error.message : "unknown_error" });
    });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ReviewBody;
  const { taskId } = await context.params;

  try {
    if (isDbStateReadEnabled()) {
      const task =
        body.action === "confirm"
          ? await confirmTaskReviewDb(currentUser, taskId)
          : body.action === "reject"
            ? await rejectTaskReviewDb(
                currentUser,
                taskId,
                Array.isArray(body.reasonItems) && body.reasonItems.every((item) => typeof item === "string") ? body.reasonItems : []
              )
            : undefined;
      if (!task) throw new Error("invalid action");
      notifyReviewResult(task, currentUser, body.action);
      return NextResponse.json({ task });
    }

    let task: Task | undefined = undefined;
    await updateLocalStateWith((state) => {
      const result =
        body.action === "confirm"
          ? confirmTaskReviewAction(state, currentUser, taskId)
          : body.action === "reject"
            ? rejectTaskReviewAction(
                state,
                currentUser,
                taskId,
                Array.isArray(body.reasonItems) && body.reasonItems.every((item) => typeof item === "string") ? body.reasonItems : []
              )
            : undefined;
      if (!result) throw new Error("invalid action");
      task = result.task;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    if (task) notifyReviewResult(task, currentUser, body.action);
    return NextResponse.json({ task });
  } catch (error) {
    return mapError(error);
  }
}
