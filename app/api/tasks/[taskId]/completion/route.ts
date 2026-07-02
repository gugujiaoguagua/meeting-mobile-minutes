import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { saveTaskCompletionItemsDb } from "@/lib/dbWriteStore";
import { updateLocalStateWith } from "@/lib/localStateStore";
import { saveTaskCompletionItems } from "@/lib/taskActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompletionBody = {
  completionItems?: unknown;
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

  const body = (await request.json().catch(() => ({}))) as CompletionBody;
  if (!Array.isArray(body.completionItems) || !body.completionItems.every((item) => typeof item === "string")) {
    return NextResponse.json({ error: "completionItems must be a string array" }, { status: 400 });
  }

  const { taskId } = await context.params;
  try {
    if (isDbStateReadEnabled()) {
      const task = await saveTaskCompletionItemsDb(currentUser, taskId, body.completionItems as string[]);
      return NextResponse.json({ task });
    }

    let task = undefined;
    await updateLocalStateWith((state) => {
      const result = saveTaskCompletionItems(state, currentUser, taskId, body.completionItems as string[]);
      task = result.task;
      return { ...state, meetings: result.stateMeetings, tasks: result.stateTasks, activityLogs: result.activityLogs };
    });
    return NextResponse.json({ task });
  } catch (error) {
    return mapError(error);
  }
}
