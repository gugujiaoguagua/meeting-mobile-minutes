import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbStateReadEnabled } from "@/lib/db";
import { buildCanonicalUserDirectory, canonicalizeOkrProjectUsers } from "@/lib/canonicalUsers";
import { readDbState } from "@/lib/dbStateStore";
import { readLocalState } from "@/lib/localStateStore";
import { buildOkrProjectChangeFields, summarizeOkrProjectChange } from "@/lib/okrChangeRequests";
import {
  createOkrProjectChangeRequest,
  readOkrProjectChangeRequests,
  readOkrProjects,
  reviewOkrProjectChangeRequest,
  saveOkrProject
} from "@/lib/okrDbStore";
import type { OkrProject, OkrProjectChangeRequestStatus } from "@/lib/okrTypes";
import { canViewOkrProject } from "@/lib/permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "not authenticated" }, { status: 401 });
}

function isProject(value: unknown): value is OkrProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<OkrProject>;
  return typeof project.id === "string" && typeof project.name === "string" && Array.isArray(project.krs) && Array.isArray(project.pdcaTasks);
}

async function canonicalizeProject(project: OkrProject) {
  const state = isDbStateReadEnabled() ? await readDbState() : await readLocalState();
  const directory = buildCanonicalUserDirectory(state.users);
  return canonicalizeOkrProjectUsers(project, directory.aliasToCanonicalUserId);
}

function canReviewOkrChange(currentUser: { id: string; role: string }, requestedById?: string) {
  if (currentUser.role === "总裁") return true;
  if (currentUser.role === "部门负责人" && currentUser.id !== requestedById) return true;
  return false;
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  if (!isDbStateReadEnabled()) return NextResponse.json({ requests: [] });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const projects = await readOkrProjects();
  const visibleProjectIds = new Set(projects.filter((project) => canViewOkrProject(currentUser, project)).map((project) => project.id));
  const requests = (await readOkrProjectChangeRequests(projectId)).filter((item) => visibleProjectIds.has(item.projectId));
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { projectId?: string; proposedProject?: unknown; reason?: string };
  if (!body.projectId || !isProject(body.proposedProject)) {
    return NextResponse.json({ error: "invalid okr change request" }, { status: 400 });
  }

  const proposedProject = await canonicalizeProject(body.proposedProject);
  if (proposedProject.id !== body.projectId) {
    return NextResponse.json({ error: "project id mismatch" }, { status: 400 });
  }

  if (!isDbStateReadEnabled()) {
    return NextResponse.json({ request: undefined, project: proposedProject, applied: true });
  }

  const projects = await readOkrProjects();
  const project = projects.find((item) => item.id === body.projectId);
  if (!project) return NextResponse.json({ error: "okr project not found" }, { status: 404 });
  if (!canViewOkrProject(currentUser, project)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const changedFields = buildOkrProjectChangeFields(project, proposedProject);
  if (!changedFields.length) return NextResponse.json({ error: "no changes" }, { status: 400 });

  const approvalRequired = changedFields.some((field) => field.approvalRequired);
  const requestId = `okr-change-${project.id}-${Date.now()}`;
  const status: OkrProjectChangeRequestStatus = approvalRequired ? "待审批" : "已通过";

  if (!approvalRequired) {
    await saveOkrProject(proposedProject);
  }

  const changeRequest = await createOkrProjectChangeRequest({
    id: requestId,
    project,
    proposedProject,
    requestedById: currentUser.id,
    requestedByName: currentUser.name,
    reason: body.reason?.trim() || "未填写调整原因",
    approvalRequired,
    changeSummary: summarizeOkrProjectChange(changedFields),
    changedFields,
    status
  });

  return NextResponse.json({ request: changeRequest, project: approvalRequired ? undefined : proposedProject, applied: !approvalRequired });
}

export async function PATCH(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { requestId?: string; action?: "approve" | "reject"; comment?: string };
  if (!body.requestId || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json({ error: "invalid review action" }, { status: 400 });
  }

  if (!isDbStateReadEnabled()) return NextResponse.json({ request: undefined });

  const requests = await readOkrProjectChangeRequests();
  const changeRequest = requests.find((item) => item.id === body.requestId);
  if (!changeRequest) return NextResponse.json({ error: "okr change request not found" }, { status: 404 });
  const projects = await readOkrProjects();
  const project = projects.find((item) => item.id === changeRequest.projectId);
  if (project && !canViewOkrProject(currentUser, project)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canReviewOkrChange(currentUser, changeRequest.requestedById)) return NextResponse.json({ error: "review forbidden" }, { status: 403 });

  const reviewedRequest = await reviewOkrProjectChangeRequest({
    requestId: body.requestId,
    status: body.action === "approve" ? "已通过" : "已驳回",
    reviewedById: currentUser.id,
    reviewedByName: currentUser.name,
    reviewComment: body.comment
  });

  return NextResponse.json({ request: reviewedRequest, project: body.action === "approve" ? reviewedRequest.proposedProject : undefined });
}
