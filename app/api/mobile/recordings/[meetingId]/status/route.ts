import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readVisibleDbState } from "@/lib/dbStateStore";
import { readVisibleLocalState } from "@/lib/localStateStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { meetingId } = await context.params;
  const state = isDbStateReadEnabled() ? await readVisibleDbState(currentUser) : await readVisibleLocalState(currentUser);
  const meeting = state.meetings.find((item) => item.id === meetingId);
  if (!meeting) return NextResponse.json({ error: "meeting not found" }, { status: 404 });

  return NextResponse.json({
    meetingId,
    recordingStatus: meeting.recordingStatus ?? "transcribed",
    message: meeting.recordingStatusMessage ?? "",
    meeting
  });
}
