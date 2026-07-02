import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { deleteTaskDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { deleteTaskAction } from "@/lib/taskActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "task_not_found") return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("forbidden")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { taskId } = await context.params;
  try {
    if (isDbStateReadEnabled()) {
      const task = await deleteTaskDb(currentUser, taskId);
      return NextResponse.json({ deleted: true, taskId, task });
    }

    let task = undefined;
    await updateLocalStateWith((state) => {
      const result = deleteTaskAction(state, currentUser, taskId);
      task = result.task;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    return NextResponse.json({ deleted: true, taskId, task });
  } catch (error) {
    return mapError(error);
  }
}
