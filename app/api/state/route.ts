import { NextResponse } from "next/server";
import { canResetState, getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readVisibleDbState } from "@/lib/dbStateStore";
import { readLocalState, readVisibleLocalState, resetLocalState, updateLocalState } from "@/lib/localStateStore";
import type { LocalMeetingLoopStatePatch } from "@/lib/localStateStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "not authenticated" }, { status: 401 });
}

function businessItemCount(state: { meetings?: unknown[]; tasks?: unknown[]; activityLogs?: unknown[] }) {
  return (state.meetings?.length ?? 0) + (state.tasks?.length ?? 0) + (state.activityLogs?.length ?? 0);
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  const state = isDbStateReadEnabled() ? await readVisibleDbState(currentUser) : await readVisibleLocalState(currentUser);
  return NextResponse.json(state);
}

export async function PUT(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();
  if (!canResetState(currentUser)) {
    return NextResponse.json({ error: "full state update requires president role" }, { status: 403 });
  }
  if (isDbStateReadEnabled()) {
    return NextResponse.json({ error: "full state update is disabled in database mode" }, { status: 409 });
  }

  const body = (await request.json()) as LocalMeetingLoopStatePatch;
  if (body.stateScope !== "full") {
    return NextResponse.json({ error: "full state update requires stateScope=full" }, { status: 409 });
  }
  if (body.meetings !== undefined && !Array.isArray(body.meetings)) {
    return NextResponse.json({ error: "meetings must be an array" }, { status: 400 });
  }
  if (body.tasks !== undefined && !Array.isArray(body.tasks)) {
    return NextResponse.json({ error: "tasks must be an array" }, { status: 400 });
  }
  if (body.activityLogs !== undefined && !Array.isArray(body.activityLogs)) {
    return NextResponse.json({ error: "activityLogs must be an array" }, { status: 400 });
  }
  const current = await readLocalState();
  const incoming = {
    meetings: body.meetings ?? current.meetings,
    tasks: body.tasks ?? current.tasks,
    activityLogs: body.activityLogs ?? current.activityLogs
  };
  if (businessItemCount(incoming) === 0) {
    return NextResponse.json({ error: "refuse_empty_state_overwrite" }, { status: 409 });
  }

  const state = await updateLocalState({
    meetings: body.meetings,
    tasks: body.tasks,
    activityLogs: body.activityLogs
  });
  return NextResponse.json(state);
}

export async function DELETE() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();
  if (!canResetState(currentUser)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isDbStateReadEnabled()) {
    return NextResponse.json({ error: "state reset is disabled in database mode" }, { status: 409 });
  }

  const state = await resetLocalState();
  return NextResponse.json(state);
}
