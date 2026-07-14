import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildCanonicalUserDirectory, canonicalizeUserId } from "@/lib/canonicalUsers";
import { isDbStateReadEnabled } from "@/lib/db";
import { readDbState } from "@/lib/dbStateStore";
import { readLocalState } from "@/lib/localStateStore";
import { readOkrProjects, updateOkrPdcaTaskEndDate } from "@/lib/okrDbStore";
import { canViewOkrProject } from "@/lib/permission";
import { notifyOkrPdcaDueDateChanged } from "@/lib/wecomOkrNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function canonicalizeExistingUserId(userId?: string) {
  if (!userId) return undefined;
  const state = isDbStateReadEnabled() ? await readDbState() : await readLocalState();
  const directory = buildCanonicalUserDirectory(state.users);
  return canonicalizeUserId(userId, directory.aliasToCanonicalUserId) ?? userId;
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    endDate?: unknown;
    reason?: unknown;
  };
  if (!isDateString(body.endDate)) {
    return NextResponse.json({ error: "invalid endDate" }, { status: 400 });
  }
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }

  const { taskId } = await context.params;
  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ task: { id: taskId, endDate: body.endDate }, changed: true });
  }

  try {
    const projects = await readOkrProjects();
    const project = projects.find((item) => item.pdcaTasks.some((task) => task.id === taskId));
    if (!project) return NextResponse.json({ error: "okr_pdca_task_not_found" }, { status: 404 });
    if (!canViewOkrProject(currentUser, project)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const task = project.pdcaTasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: "okr_pdca_task_not_found" }, { status: 404 });

    const canonicalOwnerId = await canonicalizeExistingUserId(task.ownerId);
    if (!canonicalOwnerId || canonicalOwnerId !== currentUser.id) {
      return NextResponse.json({ error: "forbidden_owner_only" }, { status: 403 });
    }
    if (body.endDate < task.startDate) {
      return NextResponse.json({ error: "endDate_before_startDate" }, { status: 400 });
    }
    if (body.endDate === task.endDate) {
      return NextResponse.json({ task, changed: false });
    }

    const previousEndDate = task.endDate;
    const updatedTask = await updateOkrPdcaTaskEndDate(taskId, body.endDate);
    const updatedProject = {
      ...project,
      pdcaTasks: project.pdcaTasks.map((item) => (item.id === updatedTask.id ? updatedTask : item))
    };
    void notifyOkrPdcaDueDateChanged(updatedProject, updatedTask, currentUser, previousEndDate, body.reason?.trim()).catch((error) => {
      console.warn("wecom_okr_pdca_due_date_changed_notification_unhandled", {
        taskId,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });

    return NextResponse.json({ task: updatedTask, changed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: message === "okr_pdca_task_not_found" ? 404 : 400 });
  }
}
