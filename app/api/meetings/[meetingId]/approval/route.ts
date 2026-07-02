import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { approveMeetingDb, rejectMeetingApprovalDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { approveMeetingAction, rejectMeetingApprovalAction } from "@/lib/meetingActions";
import type { Meeting, Task, User } from "@/lib/types";
import { notifyMeetingApprovalRejected, notifyTaskApprovalApproved } from "@/lib/wecomTaskNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApprovalBody = {
  action?: unknown;
  reason?: unknown;
};

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "meeting_not_found") return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

function notifyMeetingApprovalResult(params: { action: unknown; meeting?: Meeting; approvedTasks?: Task[]; currentUser: User }) {
  if (params.action === "approve") {
    for (const task of params.approvedTasks ?? []) {
      void notifyTaskApprovalApproved(task, params.currentUser).catch((error) => {
        console.warn("wecom_task_approval_approved_notification_unhandled", {
          taskId: task.id,
          message: error instanceof Error ? error.message : "unknown_error"
        });
      });
    }
  }
  if (params.action === "reject" && params.meeting) {
    void notifyMeetingApprovalRejected(params.meeting, params.currentUser).catch((error) => {
      console.warn("wecom_meeting_approval_rejected_notification_unhandled", {
        meetingId: params.meeting?.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ApprovalBody;
  const { meetingId } = await context.params;

  try {
    if (isDbStateReadEnabled()) {
      const result =
        body.action === "approve"
          ? await approveMeetingDb(currentUser, meetingId)
          : body.action === "reject"
            ? await rejectMeetingApprovalDb(currentUser, meetingId, typeof body.reason === "string" ? body.reason : undefined)
            : undefined;
      if (!result) throw new Error("invalid action");
      notifyMeetingApprovalResult({
        action: body.action,
        meeting: result.meeting,
        approvedTasks: "approvedTasks" in result && Array.isArray(result.approvedTasks) ? result.approvedTasks : undefined,
        currentUser
      });
      return NextResponse.json(result);
    }

    let meeting: Meeting | undefined;
    let approvedTasks: Task[] | undefined;
    await updateLocalStateWith((state) => {
      const result =
        body.action === "approve"
          ? approveMeetingAction(state, currentUser, meetingId)
          : body.action === "reject"
            ? rejectMeetingApprovalAction(state, currentUser, meetingId, typeof body.reason === "string" ? body.reason : undefined)
            : undefined;
      if (!result) throw new Error("invalid action");
      meeting = result.meeting;
      approvedTasks = result.approvedTasks;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    notifyMeetingApprovalResult({ action: body.action, meeting, approvedTasks, currentUser });
    return NextResponse.json({ meeting, approvedTasks });
  } catch (error) {
    return mapError(error);
  }
}
