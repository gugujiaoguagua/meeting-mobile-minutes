import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readDbState } from "@/lib/dbStateStore";
import { saveMeetingSpeakerAssignmentsDb } from "@/lib/dbWriteStore";
import { readLocalState, updateLocalStateWith } from "@/lib/localStateStore";
import { canViewMeeting, canViewTask } from "@/lib/permission";
import type { Meeting, MeetingSpeakerAssignment, User } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SpeakerAssignmentPayload = {
  assignments?: unknown;
};

function safeSpeakerLabel(value: unknown) {
  return typeof value === "string" && /^发言人\d{1,2}$/.test(value.trim()) ? value.trim() : "";
}

function sanitizeAssignments(value: unknown, currentUser: User): MeetingSpeakerAssignment[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  const deduped = new Map<string, MeetingSpeakerAssignment>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const assignment = item as Record<string, unknown>;
    const speakerLabel = safeSpeakerLabel(assignment.speakerLabel);
    const userId = typeof assignment.userId === "string" ? assignment.userId.trim() : "";
    if (!speakerLabel || !userId) continue;
    deduped.set(speakerLabel, {
      speakerLabel,
      userId,
      assignedAt: typeof assignment.assignedAt === "string" && assignment.assignedAt ? assignment.assignedAt : now,
      assignedBy: currentUser.id
    });
  }
  return [...deduped.values()].sort((a, b) => a.speakerLabel.localeCompare(b.speakerLabel, "zh-CN"));
}

function canEditSpeakerAssignments(currentUser: User, meeting: Meeting, meetings: Meeting[], tasks: Meeting["tasks"] = []) {
  const visibleTasks = tasks.filter((task) => canViewTask(currentUser, task, meetings));
  return canViewMeeting(currentUser, meeting, visibleTasks);
}

function validateAssignments(meeting: Meeting, assignments: MeetingSpeakerAssignment[]) {
  const participantIds = new Set(meeting.participantIds);
  return assignments.every((item) => participantIds.has(item.userId));
}

export async function PUT(request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { meetingId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SpeakerAssignmentPayload;
  const assignments = sanitizeAssignments(body.assignments, currentUser);

  try {
    if (isDbStateReadEnabled()) {
      const state = await readDbState();
      const meeting = state.meetings.find((item) => item.id === meetingId);
      if (!meeting) return NextResponse.json({ error: "meeting_not_found" }, { status: 404 });
      if (!canEditSpeakerAssignments(currentUser, meeting, state.meetings, state.tasks)) {
        return NextResponse.json({ error: "forbidden", detail: "当前用户无权标注这场会议的发言人。" }, { status: 403 });
      }
      if (!validateAssignments(meeting, assignments)) {
        return NextResponse.json({ error: "invalid_assignment", detail: "发言人只能标注为本次参会人员。" }, { status: 400 });
      }
      const updatedMeeting = await saveMeetingSpeakerAssignmentsDb(currentUser, meetingId, assignments);
      return NextResponse.json({ meeting: updatedMeeting });
    }

    const state = await readLocalState();
    const meeting = state.meetings.find((item) => item.id === meetingId);
    if (!meeting) return NextResponse.json({ error: "meeting_not_found" }, { status: 404 });
    if (!canEditSpeakerAssignments(currentUser, meeting, state.meetings, state.tasks)) {
      return NextResponse.json({ error: "forbidden", detail: "当前用户无权标注这场会议的发言人。" }, { status: 403 });
    }
    if (!validateAssignments(meeting, assignments)) {
      return NextResponse.json({ error: "invalid_assignment", detail: "发言人只能标注为本次参会人员。" }, { status: 400 });
    }

    let updatedMeeting: Meeting | undefined;
    await updateLocalStateWith((current) => {
      const nextMeetings = current.meetings.map((item) => {
        if (item.id !== meetingId) return item;
        updatedMeeting = { ...item, speakerAssignments: assignments };
        return updatedMeeting;
      });
      return {
        ...current,
        meetings: nextMeetings
      };
    });
    return NextResponse.json({ meeting: updatedMeeting });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "meeting_not_found") return NextResponse.json({ error: message }, { status: 404 });
    if (message === "invalid_speaker_assignment_user") return NextResponse.json({ error: "invalid_assignment", detail: "发言人只能标注为本次参会人员。" }, { status: 400 });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
