import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { submitMeetingApprovalDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { submitMeetingApprovalAction } from "@/lib/meetingActions";
import type { Meeting } from "@/lib/types";
import { notifyMeetingApprovalSubmitted } from "@/lib/wecomTaskNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmissionBody = {
  meeting?: unknown;
};

function isMeetingLike(value: unknown): value is Meeting {
  if (!value || typeof value !== "object") return false;
  const meeting = value as Partial<Meeting>;
  return typeof meeting.id === "string" && typeof meeting.title === "string" && typeof meeting.hostId === "string";
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

function notifyApprovalSubmitted(meeting: Meeting, currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  void notifyMeetingApprovalSubmitted(meeting, currentUser).catch((error) => {
    console.warn("wecom_meeting_approval_notification_unhandled", {
      meetingId: meeting.id,
      message: error instanceof Error ? error.message : "unknown_error"
    });
  });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as SubmissionBody;
  if (!isMeetingLike(body.meeting)) {
    return NextResponse.json({ error: "invalid meeting" }, { status: 400 });
  }
  const submittedMeeting = body.meeting;

  try {
    if (isDbStateReadEnabled()) {
      const meeting = await submitMeetingApprovalDb(currentUser, submittedMeeting);
      notifyApprovalSubmitted(meeting, currentUser);
      return NextResponse.json({ meeting });
    }

    let meeting: Meeting | undefined;
    await updateLocalStateWith((state) => {
      const result = submitMeetingApprovalAction(state, currentUser, submittedMeeting);
      meeting = result.meeting;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    if (meeting) notifyApprovalSubmitted(meeting, currentUser);
    return NextResponse.json({ meeting });
  } catch (error) {
    return mapError(error);
  }
}
