import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { deleteDraftRecordingMeetingDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import type { Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canDeleteMeeting(meeting: Meeting, currentUserId: string) {
  const isMobileRecording = meeting.sourceTemplateName === "mobile-browser-recording" || meeting.id.startsWith("mobile-recording-");
  const isDraft = meeting.status === "draft" && (meeting.approvalStatus === "draft" || !meeting.approvalStatus);
  const isOwner = meeting.createdBy === currentUserId || meeting.hostId === currentUserId;
  return isMobileRecording && isDraft && isOwner;
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "meeting_not_found") return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden", detail: "只能删除本人创建的手机录音草稿妙记。" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { meetingId } = await context.params;
  try {
    if (isDbStateReadEnabled()) {
      await deleteDraftRecordingMeetingDb(currentUser, meetingId);
      return NextResponse.json({ deleted: true, meetingId });
    }

    let deletedMeeting: Meeting | undefined;
    await updateLocalStateWith((state) => {
      const meeting = state.meetings.find((item) => item.id === meetingId);
      if (!meeting) throw new Error("meeting_not_found");
      if (!canDeleteMeeting(meeting, currentUser.id)) throw new Error("forbidden_delete_meeting");
      deletedMeeting = meeting;
      return {
        ...state,
        meetings: state.meetings.filter((item) => item.id !== meetingId),
        tasks: state.tasks.filter((task) => task.meetingId !== meetingId),
        activityLogs: state.activityLogs.filter((log) => log.meetingId !== meetingId)
      };
    });
    return NextResponse.json({ deleted: true, meetingId, meeting: deletedMeeting });
  } catch (error) {
    return mapError(error);
  }
}
