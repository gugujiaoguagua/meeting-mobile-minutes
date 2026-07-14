import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readVisibleDbState } from "@/lib/dbStateStore";
import { readVisibleLocalState } from "@/lib/localStateStore";
import { buildMeetingBoardResponse } from "@/lib/meetingBoard";
import { canViewMeetingBoard } from "@/lib/permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!canViewMeetingBoard(currentUser)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const state = isDbStateReadEnabled() ? await readVisibleDbState(currentUser) : await readVisibleLocalState(currentUser);
  return NextResponse.json(
    buildMeetingBoardResponse({
      meetings: state.meetings,
      tasks: state.tasks,
      activityLogs: state.activityLogs,
      users: state.users,
      departments: state.departments
    })
  );
}
