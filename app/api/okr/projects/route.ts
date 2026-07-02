import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { deleteOkrProject, readOkrProjects, saveOkrProject } from "@/lib/okrDbStore";
import type { OkrProject } from "@/lib/okrTypes";
import { canViewOkrProject } from "@/lib/permission";
import { notifyOkrProjectCreated } from "@/lib/wecomOkrNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "not authenticated" }, { status: 401 });
}

function isOkrProject(value: unknown): value is OkrProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<OkrProject>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.objective === "string" &&
    typeof project.ownerId === "string" &&
    typeof project.ownerDepartmentId === "string" &&
    Array.isArray(project.krs) &&
    Array.isArray(project.pdcaTasks)
  );
}

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ projects: [] });
  }

  const projects = (await readOkrProjects()).filter((project) => canViewOkrProject(currentUser, project));
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { project?: unknown };
  if (!isOkrProject(body.project)) {
    return NextResponse.json({ error: "invalid okr project" }, { status: 400 });
  }
  const incomingProject = body.project;

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ project: incomingProject });
  }

  const existingProjects = await readOkrProjects();
  const isNewProject = !existingProjects.some((project) => project.id === incomingProject.id);
  const project = await saveOkrProject(incomingProject);
  if (isNewProject) {
    void notifyOkrProjectCreated(project, currentUser).catch((error) => {
      console.warn("wecom_okr_project_created_notification_unhandled", {
        projectId: project.id,
        message: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }
  return NextResponse.json({ project });
}

export async function DELETE(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "missing projectId" }, { status: 400 });
  }

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ deleted: true, projectId });
  }

  const projects = await readOkrProjects();
  const project = projects.find((item) => item.id === projectId);
  if (project && !canViewOkrProject(currentUser, project)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = project ? await deleteOkrProject(projectId) : false;
  return NextResponse.json({ deleted, projectId });
}
