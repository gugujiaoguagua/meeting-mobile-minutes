import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { readOkrProjects, updateOkrPdcaTaskCompletionItems } from "@/lib/okrDbStore";
import { canViewOkrProject } from "@/lib/permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function saveOkrPdcaTaskCompletion(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { completionItems?: unknown };
  if (!Array.isArray(body.completionItems) || !body.completionItems.every((item) => typeof item === "string")) {
    return NextResponse.json({ error: "invalid completionItems" }, { status: 400 });
  }

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ task: { id: (await context.params).taskId, completionItems: body.completionItems } });
  }

  const { taskId } = await context.params;
  try {
    const projects = await readOkrProjects();
    const project = projects.find((item) => item.pdcaTasks.some((task) => task.id === taskId));
    if (!project) return NextResponse.json({ error: "okr_pdca_task_not_found" }, { status: 404 });
    if (!canViewOkrProject(currentUser, project)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const task = await updateOkrPdcaTaskCompletionItems(taskId, body.completionItems);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: message === "okr_pdca_task_not_found" ? 404 : 400 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return saveOkrPdcaTaskCompletion(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return saveOkrPdcaTaskCompletion(request, context);
}
