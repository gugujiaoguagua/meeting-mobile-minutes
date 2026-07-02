import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { submitTaskReviewDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { submitTaskReview } from "@/lib/taskActions";
import type { TaskStatus } from "@/lib/types";
import { notifyTaskReviewSubmitted } from "@/lib/wecomTaskNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses: TaskStatus[] = ["in_progress", "completed", "blocked", "pending_review"];

type StatusBody = {
  status?: unknown;
};

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "task_not_found") return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as StatusBody;
  if (typeof body.status !== "string" || !allowedStatuses.includes(body.status as TaskStatus)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const { taskId } = await context.params;
  try {
    if (isDbStateReadEnabled()) {
      const task = await submitTaskReviewDb(currentUser, taskId, body.status as TaskStatus);
      void notifyTaskReviewSubmitted(task, currentUser).catch((error) => {
        console.warn("wecom_review_notification_unhandled", { taskId, message: error instanceof Error ? error.message : "unknown_error" });
      });
      return NextResponse.json({ task });
    }

    let task = undefined;
    await updateLocalStateWith((state) => {
      const result = submitTaskReview(state, currentUser, taskId, body.status as TaskStatus);
      task = result.task;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    if (task) {
      void notifyTaskReviewSubmitted(task, currentUser).catch((error) => {
        console.warn("wecom_review_notification_unhandled", { taskId, message: error instanceof Error ? error.message : "unknown_error" });
      });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return mapError(error);
  }
}
